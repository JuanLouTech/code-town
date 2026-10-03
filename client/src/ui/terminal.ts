import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Building, ServerMsg } from '../../../shared/protocol.ts';
import type { Net, Store } from '../net.ts';
import { h } from './panel.ts';

const PAPER_THEME = {
  background: '#fffaf0',
  foreground: '#4a3a2c',
  cursor: '#19b89c',
  cursorAccent: '#fffaf0',
  selectionBackground: '#ffe16999',
  black: '#4a3a2c', red: '#d9483b', green: '#3f8f4a', yellow: '#b88410',
  blue: '#3d6fb6', magenta: '#9b59b6', cyan: '#11927b', white: '#a89a88',
  brightBlack: '#8b7560', brightRed: '#e8645c', brightGreen: '#4fa83a', brightYellow: '#d9a441',
  brightBlue: '#5b8fd9', brightMagenta: '#b07cd1', brightCyan: '#19b89c', brightWhite: '#6b5a45',
};

interface Letter {
  id: string;
  building: Building;
  cwd?: string;
  win: HTMLElement;
  chip: HTMLElement;
  term: Terminal;
  fit: FitAddon;
  minimized: boolean;
  exited: boolean;
}

let zTop = 20;

/**
 * Mailbox terminals: a real shell in a house's folder, styled as a letter.
 * They float above everything, so you can keep one open while chatting with
 * a villager (handy for sudo and interactive commands Claude can't run).
 */
export class Mailboxes {
  private letters = new Map<string, Letter>();
  private dock = h('div', { class: 'letter-dock' });
  onChange?: (openBuildings: Set<string>) => void;
  onToast?: (text: string) => void;

  constructor(private root: HTMLElement, private net: Net, store: Store) {
    root.append(this.dock);
    store.on((msg: ServerMsg) => {
      if (msg.t === 'term.data') this.letters.get(msg.termId)?.term.write(msg.data);
      else if (msg.t === 'term.exit') {
        const l = this.letters.get(msg.termId);
        if (msg.closed && l) {
          l.exited = true;
          this.close(l);
          this.returnFocus();
        } else this.exited(msg.termId, msg.code, msg.error);
      } else if (msg.t === 'term.busy') {
        const l = this.letters.get(msg.termId);
        if (l) {
          this.minimize(l);
          this.returnFocus();
          this.onToast?.(`📮 \`${msg.process}\` is still running in ${l.building.name.split('/').pop()}: folded the letter into the dock instead of closing it.`);
        }
      }
    });
  }

  /** Opens (or brings back) the mailbox terminal for a house, optionally in a session's worktree. */
  open(building: Building, cwd?: string) {
    for (const l of this.letters.values()) {
      if (l.building.id === building.id && (l.cwd ?? '') === (cwd ?? '') && !l.exited) {
        this.restore(l);
        return;
      }
    }
    const id = Math.random().toString(36).slice(2);
    const name = building.name.split('/').pop()!;
    const where = cwd && cwd !== building.path ? cwd.replace(building.path, '…') : building.path;
    const title = h('div', { class: 'letter-title' },
      h('div', { class: 'letter-to' }, `📮 To: ${name}`),
      h('div', { class: 'letter-where' }, where));
    const min = h('button', { class: 'letter-btn', title: 'Fold the letter (minimize)' }, '–');
    const close = h('button', { class: 'letter-btn', title: 'Close (ends the shell)' }, '✕');
    const stamp = h('div', { class: 'letter-stamp' }, '🏝️');
    const head = h('div', { class: 'letter-head' }, stamp, title, min, close);
    const body = h('div', { class: 'letter-body' });
    const win = h('div', { class: 'letter' }, head, body);
    const n = this.letters.size;
    win.style.left = `${Math.max(16, window.innerWidth - 720 - 40 * n)}px`;
    win.style.top = `${90 + 36 * n}px`;
    this.root.append(win);

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      theme: PAPER_THEME,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(body);
    const chip = h('button', { class: 'letter-chip', title: where }, `📮 ${name}`);
    const letter: Letter = { id, building, cwd, win, chip, term, fit, minimized: false, exited: false };
    this.letters.set(id, letter);

    requestAnimationFrame(() => {
      fit.fit();
      this.net.send({ t: 'term.open', termId: id, buildingId: building.id, cwd, cols: term.cols, rows: term.rows });
      term.focus();
    });
    term.onData((data) => {
      if (!letter.exited) this.net.send({ t: 'term.input', termId: id, data });
    });
    // Esc closes the letter from a plain prompt. Full-screen programs (vim, less,
    // htop…) run on the alternate screen and keep getting their Esc.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key !== 'Escape' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return true;
      if (term.buffer.active.type === 'alternate') return true;
      if (e.type === 'keydown') {
        if (letter.exited) {
          this.close(letter);
          this.returnFocus();
        } else this.net.send({ t: 'term.escape', termId: id });
      }
      return false;
    });
    let resizeTimer = 0;
    new ResizeObserver(() => {
      if (letter.minimized) return;
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fit.fit();
        if (!letter.exited) this.net.send({ t: 'term.resize', termId: id, cols: term.cols, rows: term.rows });
      }, 60);
    }).observe(body);

    min.addEventListener('click', () => this.minimize(letter));
    close.addEventListener('click', () => this.close(letter));
    chip.addEventListener('click', () => this.restore(letter));
    win.addEventListener('mousedown', () => this.raise(letter));
    this.drag(head, win);
    this.raise(letter);
    this.changed();
  }

  private drag(handle: HTMLElement, win: HTMLElement) {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const sx = e.clientX, sy = e.clientY;
      const ox = win.offsetLeft, oy = win.offsetTop;
      const move = (ev: PointerEvent) => {
        win.style.left = `${Math.min(window.innerWidth - 80, Math.max(-200, ox + ev.clientX - sx))}px`;
        win.style.top = `${Math.min(window.innerHeight - 40, Math.max(0, oy + ev.clientY - sy))}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** Hands the keyboard back to the island after a letter goes away. */
  private returnFocus() {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private raise(l: Letter) {
    l.win.style.zIndex = String(++zTop);
  }

  private minimize(l: Letter) {
    l.minimized = true;
    l.win.style.display = 'none';
    this.dock.append(l.chip);
    l.term.blur();
  }

  private restore(l: Letter) {
    l.minimized = false;
    l.win.style.display = 'flex';
    l.chip.remove();
    this.raise(l);
    requestAnimationFrame(() => {
      l.fit.fit();
      l.term.focus();
    });
  }

  private close(l: Letter) {
    if (!l.exited) this.net.send({ t: 'term.close', termId: l.id });
    l.term.dispose();
    l.win.remove();
    l.chip.remove();
    this.letters.delete(l.id);
    this.changed();
  }

  private exited(id: string, code: number, error?: string) {
    const l = this.letters.get(id);
    if (!l) return;
    l.exited = true;
    l.term.write(`\r\n\x1b[90m${error ? `✉️ ${error}` : `✉️ The shell finished (exit ${code}). Close the letter or open a new one from the mailbox.`}\x1b[0m\r\n`);
    this.changed();
  }

  private changed() {
    const open = new Set<string>();
    for (const l of this.letters.values()) if (!l.exited) open.add(l.building.id);
    this.onChange?.(open);
  }

  /** True while a terminal has keyboard focus (so game keys stay out of the way). */
  focused() {
    return Boolean(document.activeElement?.closest('.letter'));
  }

  closeAll() {
    for (const l of [...this.letters.values()]) this.close(l);
  }
}

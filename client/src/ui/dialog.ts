import type { Voice } from './audio.ts';
import { fileDrop, filePaste } from './drop.ts';
import { scrollKeyLabel } from './keys.ts';
import { renderMarkdown } from './markdown.ts';
import { SlashMenu, type CommandInfo } from './slash.ts';

export interface Speaker {
  name: string;
  color: string;
  voice: number;
}

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
  /** Shows a colour swatch before the label. */
  swatch?: string;
}

export interface DialogTool {
  label: string;
  key?: string;
  onClick: () => void;
}

/** Returned by an interruptible wait when something else (usually the session) changed underneath it. */
export const INTERRUPTED = Symbol('interrupted');
export type Interrupted = typeof INTERRUPTED;

const TYPE_LIMIT = 600; // longer texts appear at once: nobody wants to wait for a novel to type out

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * The speech bubble at the bottom of the screen: typewriter text (plain or
 * markdown, scrollable), a live status line, choices and an inline composer.
 */
export class Dialog {
  layer = el('div', 'dialog-layer');
  private box = el('div', 'dialog');
  private nameEl = el('div', 'dialog-name');
  private toolsEl = el('div', 'dialog-tools');
  private textEl = el('div', 'dialog-text ui-scroll');
  private detailEl = el('div', 'dialog-detail ui-scroll');
  private statusEl = el('div', 'dialog-status');
  private composeEl = el('div', 'dialog-compose');
  private nextEl = el('div', 'dialog-next', '▼');
  private choicesEl = el('div', 'dialog-choices');
  isOpen = false;
  private speaker?: Speaker;
  private typing = false;
  private finishTyping?: () => void;
  private advance?: (v: void | Interrupted) => void;
  private choices?: { items: Choice<unknown>[]; sel: number; resolve: (v: unknown) => void; cancel?: unknown; hasCancel: boolean };
  private tools: DialogTool[] = [];
  private token = 0;
  private composing?: (v: string | null) => void;
  onToast?: (text: string) => void;

  constructor(root: HTMLElement, private voice: Voice) {
    this.box.append(this.nameEl, this.toolsEl, this.textEl, this.detailEl, this.statusEl, this.composeEl, this.nextEl);
    this.layer.append(this.box, this.choicesEl);
    root.append(this.layer);
    this.detailEl.style.display = 'none';
    this.box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.dialog-tools, .dialog-detail, .dialog-compose, a, pre, code')) return;
      if (!window.getSelection()?.isCollapsed) return; // selecting text, not advancing
      this.press();
    });
    new ResizeObserver(() => this.placeChoices()).observe(this.box);
    fileDrop(this.box, () => this.composeEl.querySelector('textarea'), (m) => this.onToast?.(m));
  }

  /** Scrolls the reply text (the keyboard scroll shortcut). */
  scrollText(dy: number) {
    this.textEl.scrollBy({ top: dy });
  }

  open(sp: Speaker) {
    this.speaker = sp;
    this.nameEl.textContent = sp.name;
    this.nameEl.style.background = sp.color;
    this.layer.classList.add('open');
    this.isOpen = true;
    this.setTools([]);
    this.setStatus(null);
  }

  close() {
    this.interrupt();
    this.token++;
    this.layer.classList.remove('open');
    this.isOpen = false;
    this.typing = false;
    this.cancelCompose();
    this.setStatus(null);
  }

  get composingNow() {
    return Boolean(this.composing);
  }

  setTools(tools: DialogTool[]) {
    this.tools = tools;
    this.toolsEl.innerHTML = '';
    for (const t of tools) {
      const b = el('button', 'dialog-tool', t.label);
      if (t.key) b.append(el('kbd', '', t.key));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        t.onClick();
      });
      this.toolsEl.append(b);
    }
  }

  /** A live line under the text ("Running tests…") with animated dots. `null` hides it. */
  setStatus(html: string | null) {
    if (!html) {
      this.statusEl.style.display = 'none';
      this.statusEl.innerHTML = '';
      return;
    }
    this.statusEl.style.display = 'flex';
    this.statusEl.innerHTML = `<span class="dialog-status-text">${html}</span><span class="dots"><i></i><i></i><i></i></span>`;
  }

  private setDetail(detail?: HTMLElement) {
    this.detailEl.innerHTML = '';
    if (detail) {
      this.detailEl.append(detail);
      this.detailEl.style.display = 'block';
    } else {
      this.detailEl.style.display = 'none';
    }
  }

  /**
   * Puts text in the bubble. NPC lines are light HTML (`**bold**` works);
   * pass `md` for Claude's markdown replies. Long texts skip the typewriter.
   */
  show(content: string, opts: { md?: boolean; type?: boolean; detail?: HTMLElement; keepChoices?: boolean } = {}): Promise<void> {
    if (!opts.keepChoices) this.clearChoices();
    this.setDetail(opts.detail);
    const html = opts.md ? renderMarkdown(content) : content.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    this.textEl.classList.toggle('md', Boolean(opts.md));
    const type = opts.type ?? content.length <= TYPE_LIMIT;
    this.textEl.scrollTop = 0;
    if (!type) {
      this.token++;
      this.typing = false;
      this.textEl.innerHTML = html;
      this.linkify();
      return Promise.resolve();
    }
    return this.type(html);
  }

  private linkify() {
    for (const a of this.textEl.querySelectorAll('a')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }

  private type(html: string): Promise<void> {
    const token = ++this.token;
    this.textEl.innerHTML = html;
    this.linkify();
    const nodes: { node: Text; text: string }[] = [];
    const walker = document.createTreeWalker(this.textEl, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push({ node: n as Text, text: n.textContent ?? '' });
    for (const x of nodes) x.node.textContent = '';
    const total = nodes.reduce((a, x) => a + x.text.length, 0);
    const cps = Math.max(50, total / 3);
    this.typing = true;
    this.nextEl.classList.remove('show');
    return new Promise((resolve) => {
      let shown = 0;
      let last = performance.now();
      const done = () => {
        for (const x of nodes) x.node.textContent = x.text;
        this.typing = false;
        this.finishTyping = undefined;
        resolve();
      };
      this.finishTyping = done;
      const step = (now: number) => {
        if (token !== this.token || !this.typing) {
          resolve();
          return;
        }
        if (now - last < 1000 / cps) {
          requestAnimationFrame(step);
          return;
        }
        const add = Math.max(1, Math.floor(((now - last) / 1000) * cps));
        last = now;
        for (let i = 0; i < add && shown < total; i++) {
          let idx = shown;
          for (const x of nodes) {
            if (idx < x.text.length) {
              x.node.textContent = x.text.slice(0, idx + 1);
              if (shown % 2 === 0) this.voice.blip(x.text[idx], this.speaker?.voice ?? 1);
              break;
            }
            idx -= x.text.length;
          }
          shown++;
        }
        const t = this.textEl;
        if (t.scrollHeight > t.clientHeight) t.scrollTop = t.scrollHeight;
        if (shown >= total) done();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Waits for the player to press on (E / click). */
  waitAdvance(): Promise<void | Interrupted> {
    this.nextEl.classList.add('show');
    return new Promise<void | Interrupted>((resolve) => {
      this.advance = (v) => {
        this.advance = undefined;
        this.nextEl.classList.remove('show');
        resolve(v);
      };
    });
  }

  async say(html: string, opts: { detail?: HTMLElement; md?: boolean } = {}): Promise<void> {
    await this.show(html, opts);
    if (!this.isOpen) return;
    await this.waitAdvance();
  }

  async ask<T>(html: string, items: Choice<T>[], opts: { detail?: HTMLElement; cancel?: T; md?: boolean } = {}): Promise<T> {
    await this.show(html, opts);
    const v = await this.choose(items, opts);
    return (v === INTERRUPTED ? opts.cancel : v) as T;
  }

  choose<T>(items: Choice<T>[], opts: { cancel?: T } = {}): Promise<T | Interrupted> {
    this.clearChoices();
    return new Promise<T | Interrupted>((resolve) => {
      this.choices = { items, sel: 0, resolve: resolve as (v: unknown) => void, cancel: opts.cancel, hasCancel: 'cancel' in opts };
      this.renderChoices();
    });
  }

  /** Resolves any pending choice / advance with INTERRUPTED. */
  interrupt() {
    const c = this.choices;
    this.choices = undefined;
    this.choicesEl.innerHTML = '';
    c?.resolve(INTERRUPTED);
    this.advance?.(INTERRUPTED);
  }

  private clearChoices() {
    if (this.choices) this.interrupt();
  }

  /** An inline text box inside the bubble. Resolves with the text, or null if cancelled. */
  input(opts: { placeholder: string; commands?: () => CommandInfo[]; send?: string }): Promise<string | null> {
    this.clearChoices();
    this.cancelCompose();
    this.composeEl.innerHTML = '';
    const ta = el('textarea', 'dialog-input') as HTMLTextAreaElement;
    ta.rows = 2;
    ta.placeholder = opts.placeholder;
    const send = el('button', 'btn primary small', opts.send ?? '✉️ Send');
    const cancel = el('button', 'btn small', 'Cancel');
    const btns = el('div', 'dialog-compose-btns');
    btns.append(send, cancel);
    const row = el('div', 'dialog-compose-row');
    row.append(ta, btns);
    const hint = el('div', 'dialog-compose-hint', 'Enter to send · Shift+Enter for a new line · Esc to cancel' + (opts.commands ? ' · / for commands' : '') +
      ` · ${scrollKeyLabel()} to scroll · drop files to attach`);
    this.composeEl.append(row, hint);
    this.composeEl.style.display = 'block';
    const menu = opts.commands ? new SlashMenu(ta, opts.commands) : undefined;
    filePaste(ta, (m) => this.onToast?.(m));
    return new Promise<string | null>((resolve) => {
      const finish = (v: string | null) => {
        if (this.composing !== finish) return;
        this.composing = undefined;
        menu?.destroy();
        this.composeEl.style.display = 'none';
        this.composeEl.innerHTML = '';
        resolve(v);
      };
      this.composing = finish;
      send.addEventListener('click', () => ta.value.trim() && finish(ta.value.trim()));
      cancel.addEventListener('click', () => finish(null));
      ta.addEventListener('keydown', (e) => {
        if (menu?.handleKey(e)) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (ta.value.trim()) finish(ta.value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      });
      setTimeout(() => ta.focus(), 30);
    });
  }

  private cancelCompose() {
    this.composing?.(null);
  }

  private placeChoices() {
    this.choicesEl.style.bottom = `${this.box.offsetHeight + 44}px`;
  }

  private renderChoices() {
    const c = this.choices;
    this.choicesEl.innerHTML = '';
    if (!c) return;
    this.placeChoices();
    c.items.forEach((item, i) => {
      const b = el('button', 'choice' + (i === c.sel ? ' sel' : ''));
      if (item.swatch) {
        const sw = el('span', 'swatch');
        sw.style.background = item.swatch;
        b.append(sw);
      }
      b.append(item.label);
      if (item.hint) b.append(el('span', 'hint', item.hint));
      b.addEventListener('mouseenter', () => {
        c.sel = i;
        for (const [j, node] of [...this.choicesEl.children].entries()) node.classList.toggle('sel', j === i);
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pick(i);
      });
      this.choicesEl.append(b);
    });
  }

  private pick(i: number) {
    const c = this.choices;
    if (!c) return;
    this.choices = undefined;
    this.choicesEl.innerHTML = '';
    this.voice.pop();
    c.resolve(c.items[i].value);
  }

  private press() {
    if (this.typing) {
      this.finishTyping?.();
      return;
    }
    if (this.choices) return;
    this.advance?.();
  }

  /** Keyboard handling while the dialog is open. Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    const c = this.choices;
    const tool = this.tools.find((t) => t.key && e.key.toUpperCase() === t.key);
    if (tool && !this.typing && !e.metaKey && !e.ctrlKey) {
      tool.onClick();
      return true;
    }
    switch (e.code) {
      case 'Enter':
      case 'KeyE':
        if (c && !this.typing) this.pick(c.sel);
        else this.press();
        return true;
      case 'ArrowDown':
      case 'KeyS':
        if (e.shiftKey) this.textEl.scrollBy({ top: 60 });
        else if (c) {
          c.sel = (c.sel + 1) % c.items.length;
          this.renderChoices();
        }
        return true;
      case 'ArrowUp':
      case 'KeyW':
        if (e.shiftKey) this.textEl.scrollBy({ top: -60 });
        else if (c) {
          c.sel = (c.sel - 1 + c.items.length) % c.items.length;
          this.renderChoices();
        }
        return true;
      case 'PageDown':
        this.textEl.scrollBy({ top: this.textEl.clientHeight * 0.8 });
        return true;
      case 'PageUp':
        this.textEl.scrollBy({ top: -this.textEl.clientHeight * 0.8 });
        return true;
      case 'Escape':
        if (this.typing) this.finishTyping?.();
        else if (c && c.hasCancel) {
          this.choices = undefined;
          this.choicesEl.innerHTML = '';
          c.resolve(c.cancel);
        } else if (!c) this.advance?.();
        return true;
      default:
        return ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code);
    }
  }
}

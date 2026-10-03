export interface CommandInfo {
  name: string;
  description?: string;
  hint?: string;
  local?: boolean;
}

/** Commands the island handles itself (the CLI doesn't offer them in SDK mode). */
export const LOCAL_COMMANDS: CommandInfo[] = [
  { name: 'btw', hint: '<question>', description: 'Ask a quick side question without interrupting the job (answered from context, no tools)', local: true },
  { name: 'stop', description: 'Interrupt what they are doing right now', local: true },
  { name: 'mailbox', description: 'Open a terminal (mailbox) in this folder', local: true },
];

/** Autocomplete popup for `/commands` above a textarea. */
export class SlashMenu {
  private box = document.createElement('div');
  private items: CommandInfo[] = [];
  private sel = 0;
  private visible = false;
  private onInput = () => this.update();
  private onBlur = () => setTimeout(() => this.hide(), 150);

  constructor(private ta: HTMLTextAreaElement, private source: () => CommandInfo[]) {
    this.box.className = 'slash-menu ui-scroll';
    document.body.append(this.box);
    ta.addEventListener('input', this.onInput);
    ta.addEventListener('blur', this.onBlur);
  }

  private update() {
    const v = this.ta.value;
    const m = v.match(/^\/([\w:.-]*)$/);
    if (!m) {
      this.hide();
      return;
    }
    const q = m[1].toLowerCase();
    const all = this.source();
    const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    this.items = [...starts, ...contains].slice(0, 9);
    if (!this.items.length) {
      this.hide();
      return;
    }
    this.sel = Math.min(this.sel, this.items.length - 1);
    this.render();
  }

  private render() {
    this.box.innerHTML = '';
    this.items.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'slash-item' + (i === this.sel ? ' sel' : '');
      const line = document.createElement('div');
      line.className = 'slash-line';
      const name = document.createElement('b');
      name.textContent = `/${c.name}`;
      line.append(name);
      if (c.hint) {
        const hint = document.createElement('span');
        hint.className = 'slash-hint';
        hint.textContent = ` ${c.hint}`;
        line.append(hint);
      }
      row.append(line);
      if (c.description) {
        const d = document.createElement('div');
        d.className = 'slash-desc';
        d.textContent = (c.local ? '🏝️ ' : '') + c.description;
        row.append(d);
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.sel = i;
        this.complete();
      });
      this.box.append(row);
    });
    const r = this.ta.getBoundingClientRect();
    this.box.style.left = `${r.left}px`;
    this.box.style.width = `${Math.max(320, Math.min(560, r.width))}px`;
    this.box.style.bottom = `${window.innerHeight - r.top + 6}px`;
    this.box.style.display = 'block';
    this.visible = true;
  }

  private complete() {
    const c = this.items[this.sel];
    if (!c) return;
    this.ta.value = `/${c.name} `;
    this.ta.focus();
    this.hide();
  }

  hide() {
    this.visible = false;
    this.box.style.display = 'none';
  }

  /** Returns true when the key was consumed by the menu. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length;
      this.render();
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && this.ta.value.trim() !== `/${this.items[this.sel]?.name}`)) {
      e.preventDefault();
      this.complete();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      return true;
    }
    return false;
  }

  destroy() {
    this.ta.removeEventListener('input', this.onInput);
    this.ta.removeEventListener('blur', this.onBlur);
    this.box.remove();
  }
}

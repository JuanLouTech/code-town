export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> & { class?: string } = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export type CloseReason = 'close' | 'minimize';

export interface PanelOptions {
  title: string;
  subtitle?: HTMLElement | string;
  color?: string;
  body: HTMLElement;
  foot?: HTMLElement;
  form?: boolean;
  /** Adds a "back to chat" button; Esc then minimizes instead of closing. */
  minimizable?: boolean;
  headButtons?: HTMLElement[];
  /** Names what's open (e.g. 'pockets'), so its hotkey can close it again. */
  kind?: string;
  onClose?: (reason: CloseReason) => void;
}

/** The big notebook overlay used for long replies, conversations and forms. */
export class Panel {
  layer = h('div', { class: 'panel-layer' });
  private panel = h('div', { class: 'panel' });
  private onClose?: (reason: CloseReason) => void;
  isOpen = false;
  minimizable = false;
  kind?: string;

  constructor(root: HTMLElement) {
    this.layer.append(this.panel);
    root.append(this.layer);
    this.layer.addEventListener('mousedown', (e) => {
      if (e.target === this.layer) this.escape();
    });
  }

  open(o: PanelOptions) {
    const prev = this.onClose;
    this.onClose = undefined;
    prev?.('close');
    this.panel.className = 'panel' + (o.form ? ' form' : '');
    this.panel.innerHTML = '';
    const x = h('button', { class: 'x', title: o.minimizable ? 'Close and walk away' : 'Close (Esc)' }, '✕');
    x.addEventListener('click', () => this.close('close'));
    const titles = h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'title' }, o.title));
    if (o.subtitle) titles.append(typeof o.subtitle === 'string' ? h('div', { class: 'subtitle' }, o.subtitle) : o.subtitle);
    const head = h('div', { class: 'panel-head' }, titles, ...(o.headButtons ?? []));
    if (o.minimizable) {
      const min = h('button', { class: 'head-btn', title: 'Back to the chat bubble (Esc / R)' }, '⤡ Back to chat');
      min.addEventListener('click', () => this.close('minimize'));
      head.append(min);
    }
    head.append(x);
    this.minimizable = Boolean(o.minimizable);
    this.kind = o.kind;
    if (o.color) head.style.background = o.color;
    const body = h('div', { class: 'panel-body ui-scroll' });
    body.append(o.body);
    this.panel.append(head, body);
    if (o.foot) this.panel.append(h('div', { class: 'panel-foot' }, o.foot));
    this.layer.classList.add('open');
    this.isOpen = true;
    this.onClose = o.onClose;
    return body;
  }

  close(reason: CloseReason = 'close') {
    if (!this.isOpen) return;
    this.layer.classList.remove('open');
    this.isOpen = false;
    this.minimizable = false;
    this.kind = undefined;
    this.panel.innerHTML = '';
    const cb = this.onClose;
    this.onClose = undefined;
    cb?.(reason);
  }

  /** What Esc does: minimize back to the dialog when possible. */
  escape() {
    this.close(this.minimizable ? 'minimize' : 'close');
  }

  bodyEl(): HTMLElement | null {
    return this.panel.querySelector('.panel-body');
  }
}

/**
 * A row of choice chips that behaves like one keyboard stop: Tab lands on the
 * row, ←/→ changes the choice (the mouse still works per chip).
 */
export function chipGroup(options: { value: string; label: string; hint?: string }[], initial: string, onChange?: (v: string) => void) {
  let value = initial;
  const wrap = h('div', { class: 'chips', tabindex: '0', role: 'radiogroup', 'data-field': '' });
  const set = (v: string) => {
    value = v;
    render();
    onChange?.(value);
  };
  const render = () => {
    wrap.innerHTML = '';
    for (const o of options) {
      const b = h('button', { class: 'chip' + (o.value === value ? ' on' : ''), title: o.hint ?? '', type: 'button', tabindex: '-1', role: 'radio', 'aria-checked': String(o.value === value) }, o.label);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the row
      b.addEventListener('click', () => {
        set(o.value);
        wrap.focus();
      });
      wrap.append(b);
    }
  };
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = options.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    set(options[next].value);
  });
  render();
  return { el: wrap, get value() { return value; } };
}

export function field(label: string, control: HTMLElement, note?: string) {
  return h('div', { class: 'field' }, h('div', { class: 'label' }, label), control, note ? h('div', { class: 'note' }, note) : null);
}

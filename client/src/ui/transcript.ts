import type { TranscriptEntry } from '../../../shared/protocol.ts';
import { mdElement } from './markdown.ts';
import { h } from './panel.ts';

const TOOL_ICON: Record<string, string> = {
  Read: '📖', Edit: '✏️', MultiEdit: '✏️', Write: '📝', Bash: '💻', Grep: '🔎', Glob: '🗂️', WebFetch: '🌐', WebSearch: '🌐',
  Agent: '🧙', Task: '🧙', TodoWrite: '✅', Skill: '🎒', AskUserQuestion: '❓', ExitPlanMode: '🗺️',
};

/** Renders a conversation, grouping runs of tool calls into collapsible "steps". */
export class TranscriptView {
  el = h('div', { class: 'transcript' });
  private steps?: { details: HTMLDetailsElement; list: HTMLUListElement; count: number; summary: HTMLElement };
  private count = 0;

  constructor(private who: string, private scroller?: () => HTMLElement | null) {}

  set(entries: TranscriptEntry[]) {
    this.el.innerHTML = '';
    this.steps = undefined;
    this.count = 0;
    this.append(entries);
  }

  append(entries: TranscriptEntry[]) {
    const sc = this.scroller?.();
    const atBottom = !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    for (const e of entries) this.add(e);
    this.count += entries.length;
    if (sc && atBottom) requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight));
  }

  private add(e: TranscriptEntry) {
    if (e.kind === 'tool') {
      if (!this.steps) {
        const details = h('details', { class: 'steps' }) as HTMLDetailsElement;
        const summary = h('summary');
        const list = h('ul');
        details.append(summary, list);
        this.el.append(details);
        this.steps = { details, list, count: 0, summary };
      }
      const s = this.steps;
      s.count++;
      const icon = e.agentId ? '🧙' : TOOL_ICON[e.tool ?? ''] ?? '🔧';
      const li = h('li', { class: (e.isError ? 'err ' : '') + (e.agentId ? 'gnome' : '') }, `${e.agentId ? '' : icon + ' '}${e.text}`);
      if (e.detail) li.title = e.detail;
      s.list.append(li);
      s.summary.textContent = `🔧 ${s.count} step${s.count === 1 ? '' : 's'} · ${icon} ${e.text}`;
      return;
    }
    this.steps = undefined;
    switch (e.kind) {
      case 'user': {
        const m = h('div', { class: 'msg user' });
        m.append(mdElement(e.text));
        this.el.append(m);
        break;
      }
      case 'assistant': {
        const m = h('div', { class: 'msg assistant' }, h('div', { class: 'who' }, this.who));
        m.append(mdElement(e.text));
        this.el.append(m);
        break;
      }
      case 'aside': {
        const m = h('div', { class: 'msg aside' }, h('div', { class: 'who' }, `💭 ${this.who}, on the side`));
        m.append(mdElement(e.text));
        this.el.append(m);
        break;
      }
      case 'result':
        this.el.append(h('div', { class: 'msg result' }, `✔ ${e.text}`));
        break;
      case 'error': {
        const m = h('div', { class: 'msg error' });
        m.append(mdElement(e.text));
        this.el.append(m);
        break;
      }
      default:
        this.el.append(h('div', { class: 'msg system' }, e.text));
    }
  }
}

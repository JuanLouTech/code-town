import type { Building, HistoryItem, PendingRequest, Property, StartOptions, TranscriptEntry, WorldState } from '../../../shared/protocol.ts';
import { EFFORT_CHOICES, MODEL_CHOICES, PERMISSION_CHOICES } from '../../../shared/protocol.ts';
import type { Store } from '../net.ts';
import { mdElement } from './markdown.ts';
import { chipGroup, field, h, type Panel } from './panel.ts';
import { buttonRowNav, formNav, listNav } from './keys.ts';
import { TranscriptView } from './transcript.ts';
import { statusOf } from './hud.ts';

const DEFAULTS_KEY = 'codetown.jobDefaults';

function loadDefaults(): StartOptions {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveDefaults(o: StartOptions) {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ ...o, worktree: undefined }));
  } catch {
    // ignore
  }
}

export function timeAgo(ms: number) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function worktreeMode(world: WorldState, b: Building): 'native' | 'town' | null {
  if (b.role === 'main') {
    const p = world.properties.find((x) => x.id === b.propertyId);
    if (p && p.kind === 'town') return 'town';
  }
  return b.isRepo ? 'native' : null;
}

function optionFields(world: WorldState, b: Building, withWorktree: boolean) {
  const d = loadDefaults();
  const model = chipGroup(MODEL_CHOICES, d.model ?? '');
  const effort = chipGroup(EFFORT_CHOICES, d.effort ?? '');
  const perm = chipGroup(PERMISSION_CHOICES, d.permissionMode ?? '');
  const wt = worktreeMode(world, b);
  const wtBox = h('input', { type: 'checkbox', 'data-field': '' }) as HTMLInputElement;
  const wrap = h('div', {},
    field('Model', model.el),
    field('Effort', effort.el),
    field('Permissions', perm.el, 'How much freedom they get. You can always answer their questions from the island.'),
  );
  if (withWorktree && wt) {
    wrap.append(field('Worktree', h('label', { class: 'toggle' }, wtBox,
      wt === 'native' ? 'Work in a fresh git worktree' : 'Use git worktrees in every repo they touch'),
      wt === 'native'
        ? 'Keeps this job on its own branch in .claude/worktrees/ so it never collides with other villagers.'
        : 'This is a town: they will create a worktree per repository before editing anything.'));
  }
  return {
    el: wrap,
    get(): StartOptions {
      const o: StartOptions = { model: model.value, effort: effort.value, permissionMode: perm.value, worktree: wtBox.checked };
      saveDefaults(o);
      return o;
    },
  };
}

export function jobForm(panel: Panel, world: WorldState, b: Building, o: { title: string; who: string; color: string }) {
  return new Promise<{ prompt: string; opts: StartOptions } | null>((resolve) => {
    let done = false;
    const finish = (v: { prompt: string; opts: StartOptions } | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const prompt = h('textarea', { class: 'big', rows: '5', placeholder: `What should ${o.who} do in ${b.name}?`, 'data-field': '' }) as HTMLTextAreaElement;
    const opts = optionFields(world, b, true);
    const start = h('button', { class: 'btn primary', 'data-field': '' }, '🌱 Start the job');
    const cancel = h('button', { class: 'btn' }, 'Never mind');
    const submit = () => {
      if (!prompt.value.trim()) {
        prompt.focus();
        return;
      }
      finish({ prompt: prompt.value.trim(), opts: opts.get() });
    };
    start.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(null));
    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    });
    const row = h('div', { class: 'row end' }, h('div', { class: 'kbd-hint' }, 'Tab / ↑↓ rows · ←→ choose · Enter start · Esc back'), cancel, start);
    buttonRowNav(row);
    const body = panel.open({
      title: o.title,
      subtitle: `📁 ${b.path}`,
      color: o.color,
      form: true,
      body: h('div', {}, field('The job', prompt, '⌘/Ctrl + Enter to start · Tab or ↓ to the options'), opts.el),
      foot: row,
      onClose: () => finish(null),
    });
    formNav(body.parentElement!, { submit, home: prompt });
    setTimeout(() => prompt.focus(), 50);
  });
}

export function historyPicker(panel: Panel, items: HistoryItem[], o: { title: string; color: string }) {
  return new Promise<HistoryItem | null>((resolve) => {
    let done = false;
    const finish = (v: HistoryItem | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const body = h('div');
    for (const it of items) {
      const b = h('button', { class: 'list-item' },
        h('div', { class: 't' }, (it.liveSessionId ? '🌱 ' : '📜 ') + it.title),
        h('div', { class: 's' }, [timeAgo(it.lastModified), it.gitBranch ? `⎇ ${it.gitBranch}` : '', it.liveSessionId ? 'happening right now' : '']
          .filter(Boolean).join(' · ')),
        it.firstPrompt && it.firstPrompt !== it.title ? h('div', { class: 's' }, `“${it.firstPrompt.slice(0, 140)}”`) : null,
      ) as HTMLButtonElement;
      if (it.liveSessionId) b.disabled = true;
      b.addEventListener('click', () => finish(it));
      body.append(b);
    }
    const nav = listNav(body, '.list-item');
    panel.open({ title: o.title, subtitle: '↑↓ to choose · Enter to open · Esc to go back', color: o.color, body, onClose: () => {
      nav.destroy();
      finish(null);
    } });
    nav.reset();
  });
}

export function resumeForm(panel: Panel, world: WorldState, b: Building, item: HistoryItem, entries: TranscriptEntry[], o: { who: string; color: string }) {
  return new Promise<{ prompt: string; opts: StartOptions } | null>((resolve) => {
    let done = false;
    const finish = (v: { prompt: string; opts: StartOptions } | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const view = new TranscriptView(o.who, () => panel.bodyEl());
    view.set(entries.length ? entries : [{ id: 'x', ts: 0, kind: 'system', text: 'No readable messages in this conversation.' }]);
    const prompt = h('textarea', { class: 'big', rows: '2', placeholder: `What should ${o.who} do next?`, 'data-field': '' }) as HTMLTextAreaElement;
    const opts = optionFields(world, b, false);
    opts.el.style.display = 'none';
    const toggle = h('button', { class: 'btn small', title: 'Model, effort and permissions' }, '⚙️ Options');
    toggle.addEventListener('click', () => {
      opts.el.style.display = opts.el.style.display === 'none' ? 'block' : 'none';
      if (opts.el.style.display === 'block') opts.el.querySelector<HTMLElement>('[data-field]')?.focus();
    });
    const go = h('button', { class: 'btn primary' }, '▶ Continue');
    const back = h('button', { class: 'btn' }, 'Back');
    const submit = () => {
      if (!prompt.value.trim()) {
        prompt.focus();
        return;
      }
      finish({ prompt: prompt.value.trim(), opts: opts.get() });
    };
    go.addEventListener('click', submit);
    back.addEventListener('click', () => finish(null));
    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    const body = panel.open({
      title: `📜 ${item.title}`,
      subtitle: `${timeAgo(item.lastModified)}${item.gitBranch ? ` · ⎇ ${item.gitBranch}` : ''}`,
      color: o.color,
      body: view.el,
      foot: h('div', {}, opts.el, h('div', { class: 'composer' }, prompt, h('div', { class: 'row' }, toggle, back, go))),
      onClose: () => finish(null),
    });
    formNav(body.parentElement!, { submit, home: prompt });
    requestAnimationFrame(() => (body.scrollTop = body.scrollHeight));
    setTimeout(() => prompt.focus(), 50);
  });
}

export function pickBuilding(panel: Panel, store: Store, o: { title: string; color: string; propertiesOnly?: boolean }) {
  return new Promise<{ building?: Building; property: Property } | null>((resolve) => {
    let done = false;
    const finish = (v: { building?: Building; property: Property } | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const world = store.world!;
    const search = h('input', { class: 'big', placeholder: '🔎 Search farms…' }) as HTMLInputElement;
    const list = h('div');
    const busy = new Map<string, number>();
    for (const s of store.live()) busy.set(s.buildingId, (busy.get(s.buildingId) ?? 0) + 1);
    const render = () => {
      const q = search.value.toLowerCase();
      list.innerHTML = '';
      for (const p of world.properties) {
        const bs = p.buildings.filter((b) => !q || b.id.toLowerCase().includes(q));
        if (!bs.length) continue;
        if (o.propertiesOnly) {
          const btn = h('button', { class: 'list-item' },
            h('div', { class: 't' }, `${p.kind === 'town' ? '🏘️' : '🏡'} ${p.name}`),
            h('div', { class: 's' }, p.kind === 'town' ? `${p.buildings.length - 1} repos inside` : p.isRepo ? 'git repo' : 'folder'));
          btn.addEventListener('click', () => finish({ property: p }));
          list.append(btn);
          continue;
        }
        list.append(h('div', { class: 'group-title' }, `${p.kind === 'town' ? '🏘️' : '🏡'} ${p.name}`));
        const grid = h('div', { class: 'grid-picks' });
        for (const b of bs) {
          const n = busy.get(b.id) ?? 0;
          const btn = h('button', { class: 'list-item' },
            h('div', { class: 't' }, b.role === 'main' ? (p.kind === 'town' ? '🏛️ Town hall' : `🏡 ${b.name}`) : `🏠 ${b.name}`),
            h('div', { class: 's' }, [b.isRepo ? 'git repo' : 'folder', n ? `${n} busy` : 'quiet'].join(' · ')));
          btn.addEventListener('click', () => finish({ building: b, property: p }));
          grid.append(btn);
        }
        list.append(grid);
      }
    };
    const nav = listNav(list, '.list-item');
    search.addEventListener('input', () => {
      render();
      nav.reset();
    });
    render();
    panel.open({
      title: o.title, subtitle: 'Type to search · ↑↓←→ to choose · Enter to pick', color: o.color,
      body: h('div', {}, search, h('div', { style: 'height:12px' }), list),
      onClose: () => {
        nav.destroy();
        finish(null);
      },
    });
    nav.reset();
    setTimeout(() => search.focus(), 50);
  });
}

export function nameForm(panel: Panel, o: { title: string; subtitle: string; color: string; git: 'ask' | 'always' }) {
  return new Promise<{ name: string; git: boolean } | null>((resolve) => {
    let done = false;
    const finish = (v: { name: string; git: boolean } | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const name = h('input', { class: 'big', placeholder: 'my-new-project', 'data-field': '' }) as HTMLInputElement;
    const git = h('input', { type: 'checkbox', checked: '', 'data-field': '' }) as HTMLInputElement;
    const ok = h('button', { class: 'btn primary' }, '🔨 Build it');
    const cancel = h('button', { class: 'btn' }, 'Never mind');
    const submit = () => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name.value.trim())) {
        name.focus();
        name.style.borderColor = '#ff7a6b';
        return;
      }
      finish({ name: name.value.trim(), git: o.git === 'always' || git.checked });
    };
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => finish(null));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const body = h('div', {}, field('Folder name', name, 'Letters, numbers, dots, dashes and underscores.'));
    if (o.git === 'ask') body.append(field('Git', h('label', { class: 'toggle' }, git, 'Initialise a git repository')));
    else body.append(h('div', { class: 'note', style: 'font-weight:700;color:var(--ink-soft)' }, 'It will be initialised as a git repository, so it gets its own building.'));
    const row = h('div', { class: 'row end' }, cancel, ok);
    buttonRowNav(row);
    const pbody = panel.open({ title: o.title, subtitle: o.subtitle, color: o.color, form: true, body, foot: row, onClose: () => finish(null) });
    formNav(pbody.parentElement!, { submit, home: name });
    setTimeout(() => name.focus(), 50);
  });
}

export function confirmBox(panel: Panel, o: { title: string; text: string; ok: string; cancel: string; color?: string; danger?: boolean }) {
  // Dangerous confirmations start on the safe button; ←/→ switch, Enter picks, Esc cancels.
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const ok = h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary') }, o.ok);
    const cancel = h('button', { class: 'btn' }, o.cancel);
    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    const row = h('div', { class: 'row end' }, h('div', { class: 'kbd-hint' }, '←→ choose · Enter confirm · Esc cancel'), cancel, ok);
    buttonRowNav(row);
    panel.open({ title: o.title, color: o.color, form: true, body: mdElement(o.text), foot: row, onClose: () => finish(false) });
    setTimeout(() => (o.danger ? cancel : ok).focus(), 50);
  });
}

export function textPrompt(panel: Panel, o: { title: string; placeholder: string; color?: string; ok?: string }) {
  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      resolve(v);
      panel.close();
    };
    const text = h('textarea', { class: 'big', rows: '3', placeholder: o.placeholder }) as HTMLTextAreaElement;
    const ok = h('button', { class: 'btn primary' }, o.ok ?? 'Send');
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    ok.addEventListener('click', () => finish(text.value.trim() || null));
    cancel.addEventListener('click', () => finish(null));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(text.value.trim() || null);
      }
    });
    panel.open({ title: o.title, color: o.color, form: true, body: text, foot: h('div', { class: 'row end' }, cancel, ok), onClose: () => finish(null) });
    setTimeout(() => text.focus(), 50);
  });
}

/** Controls for answering a pending permission / question / plan, used inside the conversation notebook. */
export function pendingCard(p: PendingRequest, respond: (decision: 'allow' | 'always' | 'deny', extra?: { message?: string; answers?: Record<string, string> }) => void) {
  const card = h('div', { class: 'pending-card' });
  const who = p.fromAgent ? ` (for a gnome: ${p.fromAgent})` : '';
  card.append(h('h4', {}, `${p.kind === 'question' ? '❓' : p.kind === 'plan' ? '🗺️' : '🔐'} ${p.title}${who}`));
  if (p.kind === 'question' && p.questions) {
    const answers: Record<string, string> = {};
    for (const q of p.questions) {
      const box = h('div', { class: 'question' }, h('div', { class: 'q' }, q.question));
      const selected = new Set<string>();
      const chips = h('div', { class: 'chips' });
      const other = h('input', { class: 'big', placeholder: 'Or type your own answer…', style: 'margin-top:6px;padding:6px 12px;font-size:14px' }) as HTMLInputElement;
      const sync = () => {
        answers[q.question] = other.value.trim() || [...selected].join(', ');
      };
      for (const opt of q.options) {
        const c = h('button', { class: 'chip', title: opt.description ?? '', type: 'button' }, opt.label);
        c.addEventListener('click', () => {
          if (!q.multiSelect) {
            selected.clear();
            for (const x of chips.children) x.classList.remove('on');
          }
          if (selected.has(opt.label)) selected.delete(opt.label);
          else selected.add(opt.label);
          c.classList.toggle('on', selected.has(opt.label));
          sync();
        });
        chips.append(c);
      }
      other.addEventListener('input', sync);
      box.append(chips, other);
      card.append(box);
    }
    const send = h('button', { class: 'btn primary' }, '✅ Answer');
    const skip = h('button', { class: 'btn danger' }, 'Skip');
    send.addEventListener('click', () => respond('allow', { answers }));
    skip.addEventListener('click', () => respond('deny'));
    card.append(h('div', { class: 'row end' }, skip, send));
    return card;
  }
  if (p.detail) card.append(mdElement(p.detail));
  const reason = h('input', { class: 'big', placeholder: p.kind === 'plan' ? 'What should change in the plan?' : 'Optional: tell them why / what to do instead', style: 'padding:6px 12px;font-size:14px;margin-bottom:8px' }) as HTMLInputElement;
  card.append(reason);
  const row = h('div', { class: 'row end' });
  const btn = (label: string, cls: string, fn: () => void) => {
    const b = h('button', { class: `btn ${cls}` }, label);
    b.addEventListener('click', fn);
    row.append(b);
  };
  if (p.kind === 'plan') {
    btn('✏️ Keep planning', 'danger', () => respond('deny', { message: reason.value.trim() || undefined }));
    btn('✅ Approve', '', () => respond('allow'));
    btn('✅ Approve + auto-accept edits', 'primary', () => respond('always'));
  } else {
    btn('🚫 No', 'danger', () => respond('deny', { message: reason.value.trim() || undefined }));
    if (p.canAlwaysAllow) btn('✅ Yes, don’t ask again', '', () => respond('always'));
    btn('✅ Yes', 'primary', () => respond('allow'));
  }
  card.append(row);
  return card;
}

export { statusOf };

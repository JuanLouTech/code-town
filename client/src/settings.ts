import { curve, view } from './game/engine.ts';
import type { Island } from './game/island.ts';
import { formNav } from './ui/keys.ts';
import { chipGroup, field, h, type Panel } from './ui/panel.ts';

/** Display options. They depend on the device, so they're kept per browser (not with the save). */
export interface Settings {
  distance: 'near' | 'normal' | 'far' | 'max';
  curve: 'gentle' | 'classic' | 'round';
  shadows: 'off' | 'normal' | 'wide';
  resolution: 'sharp' | 'balanced' | 'fast';
}

const KEY = 'codetown.settings';
const DEFAULTS: Settings = { distance: 'far', curve: 'classic', shadows: 'normal', resolution: 'sharp' };

const DISTANCE = { near: 120, normal: 180, far: 260, max: 380 };
const CURVE = { gentle: 0.0013, classic: 0.0021, round: 0.003 };
const SHADOWS = { off: [0, 0], normal: [45, 2048], wide: [90, 4096] } as const;
const RESOLUTION = { sharp: 2, balanced: 1.5, fast: 1 };

const OPTIONS: { key: keyof Settings; label: string; note: string; choices: { value: string; label: string; hint?: string }[] }[] = [
  {
    key: 'distance', label: '🔭 View distance', note: 'How far away houses and trees are still drawn. Farther looks nicer, nearer is lighter.',
    choices: [
      { value: 'near', label: 'Near' }, { value: 'normal', label: 'Normal' }, { value: 'far', label: 'Far' }, { value: 'max', label: 'Very far' },
    ],
  },
  {
    key: 'curve', label: '🌍 Horizon curve', note: 'The island bends away like a rolling log. Rounder brings far-away places into view sooner; gentler keeps them flatter and truer to size.',
    choices: [{ value: 'gentle', label: 'Gentle' }, { value: 'classic', label: 'Classic' }, { value: 'round', label: 'Round' }],
  },
  {
    key: 'shadows', label: '🌗 Shadows', note: 'Wide shadows reach farther from you (and cost more).',
    choices: [{ value: 'off', label: 'Off' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }],
  },
  {
    key: 'resolution', label: '🖼️ Resolution', note: 'Lower it if the island feels slow on a big or high-density screen.',
    choices: [{ value: 'sharp', label: 'Sharp' }, { value: 'balanced', label: 'Balanced' }, { value: 'fast', label: 'Fast' }],
  },
];

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const out = { ...DEFAULTS };
    for (const o of OPTIONS) {
      const v = raw[o.key];
      if (v && o.choices.some((c) => c.value === v)) (out as Record<string, string>)[o.key] = v;
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not remembered, still applied
  }
}

export function applySettings(s: Settings, island: Island) {
  view.distance = DISTANCE[s.distance];
  curve.value = CURVE[s.curve];
  island.applyView();
  const [extent, size] = SHADOWS[s.shadows];
  island.engine.setShadows(extent, size);
  island.engine.setPixelRatio(RESOLUTION[s.resolution]);
}

/** The ⚙️ options notebook. Changes apply straight away. */
export function openSettings(panel: Panel, s: Settings, island: Island) {
  const body = h('div');
  for (const o of OPTIONS) {
    const chips = chipGroup(o.choices, s[o.key], (v) => {
      (s as unknown as Record<string, string>)[o.key] = v;
      saveSettings(s);
      applySettings(s, island);
    });
    body.append(field(o.label, chips.el, o.note));
  }
  const reset = h('button', { class: 'btn' }, '↩️ Defaults');
  const done = h('button', { class: 'btn primary', 'data-field': '' }, '👍 Done');
  const foot = h('div', { class: 'row end' }, h('div', { class: 'kbd-hint' }, 'Tab / ↑↓ rows · ←→ choose · Esc close'), reset, done);
  done.addEventListener('click', () => panel.close());
  reset.addEventListener('click', () => {
    Object.assign(s, DEFAULTS);
    saveSettings(s);
    applySettings(s, island);
    panel.close();
    openSettings(panel, s, island);
  });
  const root = panel.open({ title: '⚙️ Options', color: '#6d7f99', body, foot, form: true, kind: 'options' });
  formNav(root.parentElement!, { submit: () => panel.close() });
  setTimeout(() => body.querySelector<HTMLElement>('[data-field]')?.focus(), 50);
}

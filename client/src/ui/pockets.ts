import { BY_ID, CATALOG, HATS, KART, SHIRTS, type Category, type CatalogItem } from '../game/catalog.ts';
import type { Saves } from '../save.ts';
import { listNav } from './keys.ts';
import { h, type Panel } from './panel.ts';

export interface PocketItem { uid: string; id: string; size?: number }
export interface SaveData {
  coins: number;
  items: PocketItem[];
  caught: Record<string, { count: number; best?: number }>;
  hat: string;
  shirt: string;
  hatColor?: string;
  owned: string[];
  /** Where the go-kart is parked (once bought). */
  kart?: { x: number; z: number; h: number; color?: string };
}

function normalize(d: Partial<SaveData>): SaveData {
  return {
    coins: d.coins ?? 0, items: d.items ?? [], caught: d.caught ?? {},
    hat: d.hat ?? 'none', shirt: d.shirt ?? SHIRTS[0], hatColor: d.hatColor, owned: d.owned ?? ['none'], kart: d.kart,
  };
}

const CAT_LABEL: Record<Category, string> = { fish: '🐟 Fish', bug: '🦋 Bugs', fossil: '🦴 Fossils', shell: '🐚 Shells', fruit: '🍎 Fruit' };
/** Where to look, for the field guide's undiscovered entries (same wording as the pockets tab). */
const CAT_HINT: Record<Category, string> = {
  fish: 'Fish at the sea, the pier or a pond.', bug: 'Sneak up on butterflies.', fruit: 'Shake fruit trees.',
  fossil: 'Dig at ✖ marks.', shell: 'Pick up shells on the beach.',
};
const WHERE_LABEL = { sea: '🌊 Sea', pond: '🏞️ Pond' };
/** The field guide's reading order: by category, then catalog order. */
const GUIDE_ORDER = (Object.keys(CAT_LABEL) as Category[]).flatMap((cat) => CATALOG.filter((x) => x.category === cat));

/** What the player carries, what they've discovered, and their coins. Saved on the server. */
export class Pockets {
  data: SaveData;
  capacity = 20;
  onChange?: () => void;

  constructor(private saves: Saves) {
    this.data = normalize(saves.local<Partial<SaveData>>('pockets') ?? {});
  }

  /** Swaps in the server's copy (on connecting). */
  replace(d: Partial<SaveData>) {
    this.data = normalize(d);
    this.onChange?.();
  }

  /**
   * Folds pockets from before saves lived on the server into the server's copy, so progress
   * made on another port or host isn't lost: the richer side wins each part.
   */
  static merge(server: Partial<SaveData>, local: Partial<SaveData>): SaveData {
    const a = normalize(server), b = normalize(local);
    const caught = { ...b.caught };
    for (const [id, x] of Object.entries(a.caught)) {
      const y = caught[id];
      caught[id] = y ? { count: Math.max(x.count, y.count), best: Math.max(x.best ?? 0, y.best ?? 0) || undefined } : x;
    }
    return {
      ...a,
      coins: Math.max(a.coins, b.coins),
      items: a.items.length >= b.items.length ? a.items : b.items,
      caught,
      owned: [...new Set([...a.owned, ...b.owned])],
      kart: a.kart ?? b.kart,
    };
  }

  private save() {
    this.saves.set('pockets', this.data);
    this.onChange?.();
  }

  get full() {
    return this.data.items.length >= this.capacity;
  }

  /** Adds a find. Returns whether it's a first-time discovery, or null if the pockets are full. */
  add(id: string, size?: number): { first: boolean; record: boolean } | null {
    const first = !this.data.caught[id];
    const prev = this.data.caught[id];
    const record = Boolean(size && (!prev?.best || size > prev.best));
    this.data.caught[id] = { count: (prev?.count ?? 0) + 1, best: record ? size : prev?.best };
    if (this.full) {
      this.save();
      return null;
    }
    this.data.items.push({ uid: Math.random().toString(36).slice(2), id, size });
    this.save();
    return { first, record };
  }

  value() {
    return this.data.items.reduce((a, it) => a + (BY_ID.get(it.id)?.value ?? 0), 0);
  }

  sellAll(): number {
    const v = this.value();
    this.data.coins += v;
    this.data.items = [];
    this.save();
    return v;
  }

  addCoins(n: number) {
    this.data.coins += n;
    this.save();
  }

  buyHat(id: string): boolean {
    const hat = HATS.find((x) => x.id === id);
    if (!hat) return false;
    if (!this.data.owned.includes(id)) {
      if (this.data.coins < hat.price) return false;
      this.data.coins -= hat.price;
      this.data.owned.push(id);
    }
    this.data.hat = id;
    this.save();
    return true;
  }

  get hasKart() {
    return this.data.owned.includes(KART.id);
  }

  buyKart(): boolean {
    if (this.hasKart) return true;
    if (this.data.coins < KART.price) return false;
    this.data.coins -= KART.price;
    this.data.owned.push(KART.id);
    this.save();
    return true;
  }

  parkKart(x: number, z: number, h: number, color?: string) {
    this.data.kart = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, h: Math.round(h * 1000) / 1000, color: color ?? this.data.kart?.color };
    this.save();
  }

  setHatColor(color: string) {
    this.data.hatColor = color;
    this.save();
  }

  setShirt(color: string) {
    this.data.shirt = color;
    this.save();
  }

  /** The pockets + field guide notebook. Resolves when it closes. */
  open(panel: Panel): Promise<void> {
    let tab: 'pockets' | 'guide' = 'pockets';
    /** The field-guide entry being read, or null for the grid. */
    let detail: string | null = null;
    let gridScroll = 0;
    let nav: ReturnType<typeof listNav> | undefined;
    const cards = new Map<string, HTMLElement>();
    const body = h('div');
    const tabs = h('div', { class: 'row', style: 'margin-bottom:14px' });
    const scroller = () => body.parentElement;
    const show = (id: string) => {
      if (!detail) gridScroll = scroller()?.scrollTop ?? 0;
      detail = id;
      render();
      scroller()?.scrollTo({ top: 0 });
    };
    const step = (dir: 1 | -1) => {
      const i = GUIDE_ORDER.findIndex((c) => c.id === detail);
      show(GUIDE_ORDER[(i + dir + GUIDE_ORDER.length) % GUIDE_ORDER.length].id);
    };
    // Back to the grid, with the entry that was open highlighted and in view.
    const back = () => {
      const id = detail;
      detail = null;
      render();
      scroller()?.scrollTo({ top: gridScroll });
      const card = id ? cards.get(id) : undefined;
      if (card) nav?.select(card);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!detail || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest?.('.letter')) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') step(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') step(1);
      else if (e.code === 'Escape' || e.code === 'Backspace') back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const render = () => {
      nav?.destroy();
      nav = undefined;
      body.innerHTML = '';
      tabs.innerHTML = '';
      for (const [id, label] of [['pockets', '🎒 Pockets'], ['guide', '📗 Field guide']] as const) {
        const b = h('button', { class: 'chip' + (tab === id ? ' on' : '') }, label);
        b.addEventListener('click', () => {
          if (id === 'guide' && detail) return back();
          tab = id;
          detail = null;
          render();
        });
        tabs.append(b);
      }
      body.append(tabs);
      if (tab === 'pockets') {
        body.append(h('div', { class: 'coins-line' }, `🪙 ${this.data.coins.toLocaleString()} coins · ${this.data.items.length}/${this.capacity} slots · worth ${this.value().toLocaleString()} at the market stall`));
        const grid = h('div', { class: 'pocket-grid' });
        for (let i = 0; i < this.capacity; i++) {
          const it = this.data.items[i];
          const c = it ? BY_ID.get(it.id) : undefined;
          const slot = h('div', { class: 'pocket' + (c ? ` r${c.rarity}` : ''), title: c ? `${c.name}${it?.size ? ` · ${it.size} cm` : ''} · 🪙 ${c.value}` : '' }, c ? c.emoji : '');
          if (c) slot.append(h('span', { class: 'pocket-name' }, c.name));
          grid.append(slot);
        }
        body.append(grid);
        body.append(h('div', { class: 'note', style: 'margin-top:10px;font-weight:700;color:var(--ink-soft)' },
          'Fish at the sea, the pier or a pond · sneak up on butterflies · shake fruit trees · dig at ✖ marks · pick up shells on the beach. Sell everything at the fruit stall on the plaza.'));
      } else if (detail) {
        body.append(this.guideEntry(BY_ID.get(detail)!, { back, step }));
      } else {
        const found = Object.keys(this.data.caught).length;
        body.append(h('div', { class: 'coins-line' }, `Discovered ${found} of ${CATALOG.length} · tap a card for details`));
        const guide = h('div');
        cards.clear();
        for (const cat of Object.keys(CAT_LABEL) as Category[]) {
          guide.append(h('div', { class: 'group-title' }, CAT_LABEL[cat]));
          const grid = h('div', { class: 'guide-grid' });
          for (const c of CATALOG.filter((x) => x.category === cat)) {
            const got = this.data.caught[c.id];
            const card = h('button', { class: 'guide' + (got ? '' : ' unknown'), type: 'button' },
              h('div', { class: 'guide-emoji' }, got ? c.emoji : '❔'),
              h('div', { class: 'guide-name' }, got ? c.name : '???'),
              h('div', { class: 'guide-sub' }, got
                ? `×${got.count}${got.best ? ` · best ${got.best} cm` : ''} · 🪙 ${c.value}${c.where ? ` · ${c.where}` : ''}`
                : `${'★'.repeat(c.rarity)}${c.where ? ` · ${c.where}` : ''}`));
            if (got && c.quip) card.title = c.quip;
            card.addEventListener('click', () => show(c.id));
            cards.set(c.id, card);
            grid.append(card);
          }
          guide.append(grid);
        }
        body.append(guide);
        nav = listNav(guide, '.guide', { letters: true });
        nav.reset();
      }
    };
    render();
    return new Promise((resolve) => {
      panel.open({ title: '🎒 Pockets & field guide', color: '#8fae5f', body, kind: 'pockets', onClose: () => {
        nav?.destroy();
        window.removeEventListener('keydown', onKey, true);
        resolve();
      } });
    });
  }

  /** One field-guide entry: everything about it once caught, only a hint until then. */
  private guideEntry(c: CatalogItem, o: { back: () => void; step: (dir: 1 | -1) => void }) {
    const got = this.data.caught[c.id];
    const pos = GUIDE_ORDER.indexOf(c);
    const btn = (label: string, title: string, onClick: () => void, extra = '') => {
      const b = h('button', { class: 'btn small' + extra, type: 'button', title }, label);
      b.addEventListener('click', onClick);
      return b;
    };
    const top = h('div', { class: 'row guide-entry-top' },
      btn('← Field guide', 'Back to the field guide (Esc)', o.back),
      h('div', { class: 'spacer' }),
      btn('‹', 'Previous (← / A)', () => o.step(-1), ' guide-entry-step'),
      h('span', { class: 'guide-entry-pos' }, `${pos + 1} / ${GUIDE_ORDER.length}`),
      btn('›', 'Next (→ / D)', () => o.step(1), ' guide-entry-step'));
    const stars = h('span', { class: 'guide-stars', title: `Rarity ${c.rarity} of 5` }, '★'.repeat(c.rarity) + '☆'.repeat(5 - c.rarity));
    const facts = h('div', { class: 'guide-facts' });
    const fact = (text: string) => facts.append(h('span', {}, text));
    if (c.where) fact(WHERE_LABEL[c.where]);
    if (got) {
      fact(`Caught ×${got.count}`);
      if (got.best || c.size) fact(`📏 ${got.best ? `best ${got.best} cm` : ''}${got.best && c.size ? ' · ' : ''}${c.size ? `${c.size[0]}–${c.size[1]} cm` : ''}`);
      fact(`🪙 ${c.value.toLocaleString()} coins`);
    }
    const card = h('div', { class: `guide-entry r${c.rarity}` + (got ? '' : ' unknown') },
      h('div', { class: 'guide-entry-emoji' }, got ? c.emoji : '❔'),
      h('div', { class: 'guide-entry-text' },
        h('div', { class: 'guide-entry-name' }, got ? c.name : '???'),
        h('div', { class: 'guide-entry-sub' }, `${CAT_LABEL[c.category]} · `, stars),
        facts.childElementCount ? facts : null,
        got && c.quip ? h('div', { class: 'catch-quip' }, `“${c.quip}”`) : null,
        got ? null : h('div', { class: 'guide-entry-hint' }, `💡 ${CAT_HINT[c.category]}`)));
    return h('div', {}, top, card, h('div', { class: 'kbd-hint guide-entry-keys' }, '←/→ or A/D previous/next · Esc back to the guide'));
  }
}

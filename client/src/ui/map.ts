import * as THREE from 'three';
import { isHole, orderOf, packBlocks, type PackItem } from '../../../shared/pack.ts';
import { CIRCUIT_ID, FAIR_ID, type Block, type Building, type Property, type SessionSummary, type WorldState } from '../../../shared/protocol.ts';
import { HALF, PITCH, blockBounds, buildingCenter, lotCell, plazaLayout } from '../game/layout.ts';
import type { Island } from '../game/island.ts';
import type { Store } from '../net.ts';
import { statusOf } from './hud.ts';
import { h } from './panel.ts';

const STATUS_COLOR: Record<string, string> = {
  working: '#3f8f4a', starting: '#3f8f4a', waiting: '#ef7d2d', done: '#f2a516', error: '#e05252', idle: '#4a74b8',
};

/** Something you can pick on the map with the keyboard. */
export type MapTarget =
  | { kind: 'building'; id: string; label: string; x: number; z: number; building: Building }
  | { kind: 'plaza' | 'fair' | 'circuit'; id: string; label: string; x: number; z: number };

const RESERVED_LABEL: Record<string, string> = { [FAIR_ID]: '🎡 Fun fair', [CIRCUIT_ID]: '🏁 Kart circuit' };

const DIRS: Record<string, { x: number; z: number }> = {
  KeyW: { x: 0, z: -1 }, ArrowUp: { x: 0, z: -1 }, KeyS: { x: 0, z: 1 }, ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 }, ArrowLeft: { x: -1, z: 0 }, KeyD: { x: 1, z: 0 }, ArrowRight: { x: 1, z: 0 },
};

/** The nearest point in roughly the pressed direction (on the map, up is -z). */
function nearestIn<T extends { id: string; x: number; z: number }>(from: T, dir: { x: number; z: number }, all: T[]): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const c of all) {
    if (c.id === from.id) continue;
    const dx = c.x - from.x, dz = c.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) continue;
    const cos = (dx * dir.x + dz * dir.z) / d;
    if (cos < 0.3) continue;
    const score = d * (1 + (1 - cos) * 3);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Rearranging: the island is an order of blocks packed around the plaza; towns map houses to lots. */
interface Arrange {
  order: PackItem[];                              // includes placeholders for empty lots
  blocks: Record<string, Block>;                  // the preview (placeholders too)
  slots: Record<string, Record<string, number>>;  // town → building → lot, where changed
  /** The layout couldn't be rebuilt from an order (it has odd gaps): the first move tidies it. */
  untidy: boolean;
  town?: string;                                  // moving houses inside this town
  lot?: number;                                   // selected lot inside the town
  carrying?: string;                              // a block id, or a building id inside the town
  before?: Pick<Arrange, 'order' | 'blocks' | 'slots' | 'lot'>;
  resolve: () => void;
}

/**
 * Top-down island map. Click anywhere to travel there, or pick a property with WASD / arrows.
 * In arrange mode (from the builder) properties can be picked up and swapped around.
 */
export class IslandMap {
  layer = h('div', { class: 'map-layer' });
  private canvas = h('canvas');
  private titleEl = h('div', { class: 'map-title' }, '🗺️ Island map');
  private hintEl = h('div', { class: 'map-hint' });
  isOpen = false;
  private scale = 1;
  private origin = { x: 0, z: 0 };
  private sel?: string;
  private arr?: Arrange;
  onTravel?: (p: THREE.Vector3) => void;
  onPick?: (t: MapTarget) => void;
  onMailbox?: (b: Building) => void;
  onArrange?: (change: { blocks?: Record<string, { gx: number; gz: number }>; slots?: Record<string, Record<string, number>> }) => void;

  constructor(root: HTMLElement, private island: Island, private store: Store) {
    const box = h('div', { class: 'map' }, this.titleEl, this.canvas, this.hintEl);
    this.layer.append(box);
    root.append(this.layer);
    this.layer.addEventListener('mousedown', (e) => {
      if (e.target === this.layer) this.close();
    });
    this.canvas.addEventListener('click', (e) => {
      if (this.arr) return;
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / this.scale + this.origin.x;
      const z = (e.clientY - r.top) / this.scale + this.origin.z;
      this.onTravel?.(new THREE.Vector3(x, 0, z));
      this.close();
    });
  }

  get arranging() {
    return Boolean(this.arr);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.layer.classList.add('open');
    this.titleEl.textContent = '🗺️ Island map';
    // Start on whatever is closest to the player.
    const p = this.island.player.pos;
    let best: MapTarget | undefined;
    for (const t of this.targets()) if (!best || Math.hypot(t.x - p.x, t.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = t;
    this.sel = best?.id;
    this.draw();
  }

  /** The builder's rearrange mode. Resolves when the map closes. */
  arrange(): Promise<void> {
    const world = this.store.world!;
    const current = this.blocksOf(world);
    const order = orderOf(current, [world.plaza]);
    const packed = packBlocks(order, [world.plaza]);
    const untidy = Object.keys(current).some((id) => packed[id].gx !== current[id].gx || packed[id].gz !== current[id].gz);
    this.close();
    return new Promise((resolve) => {
      this.arr = { order, blocks: untidy ? current : packed, slots: {}, untidy, resolve };
      this.isOpen = true;
      this.layer.classList.add('open');
      this.titleEl.textContent = '🏗️ Rearrange the island';
      this.sel = order.find((o) => !isHole(o.id) && !o.id.startsWith('.'))?.id ?? order[0]?.id;
      this.draw();
    });
  }

  close() {
    this.isOpen = false;
    this.layer.classList.remove('open');
    const a = this.arr;
    this.arr = undefined;
    a?.resolve();
  }

  /** The currently selected target (travel mode). */
  selected(): MapTarget | undefined {
    return this.targets().find((t) => t.id === this.sel);
  }

  /** Keys while the map is open. Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    const dir = DIRS[e.code];
    if (this.arr) return this.arrangeKey(e, dir);
    if (dir) {
      const all = this.targets();
      const cur = all.find((t) => t.id === this.sel) ?? all[0];
      const next = cur ? nearestIn(cur, dir, all) : undefined;
      if (next) this.sel = next.id;
      this.draw();
      return true;
    }
    const t = this.selected();
    switch (e.code) {
      case 'Enter':
      case 'KeyE':
        if (t) {
          this.close();
          this.onPick?.(t);
        }
        return true;
      case 'KeyT':
        if (t?.kind === 'building') {
          this.close();
          this.onMailbox?.(t.building);
        }
        return true;
      case 'Escape':
      case 'KeyM':
        this.close();
        return true;
      default:
        return false;
    }
  }

  private arrangeKey(e: KeyboardEvent, dir?: { x: number; z: number }): boolean {
    return this.arr!.town ? this.townKey(e, dir) : this.blockKey(e, dir);
  }

  private repack() {
    const a = this.arr!;
    a.blocks = packBlocks(a.order, [this.store.world!.plaza]);
  }

  private saveBlocks() {
    const a = this.arr!;
    const out: Record<string, { gx: number; gz: number }> = {};
    for (const [id, b] of Object.entries(a.blocks)) if (!isHole(id)) out[id] = { gx: b.gx, gz: b.gz };
    this.onArrange?.({ blocks: out });
  }

  private snapshot(): NonNullable<Arrange['before']> {
    const a = this.arr!;
    return { order: [...a.order], blocks: { ...a.blocks }, slots: structuredClone(a.slots), lot: a.lot };
  }

  /** Moving whole properties (and the fair / circuit). */
  private blockKey(e: KeyboardEvent, dir?: { x: number; z: number }): boolean {
    const a = this.arr!;
    if (dir) {
      const all = Object.keys(a.blocks).filter((id) => a.order.some((o) => o.id === id)).map((id) => {
        const bb = blockBounds(a.blocks[id]);
        return { id, x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 };
      });
      const cur = all.find((t) => t.id === this.sel) ?? all[0];
      const next = cur ? nearestIn(cur, dir, all) : undefined;
      if (next && a.carrying) {
        // Trade places in the packing order; the island re-packs, always compact (live preview).
        if (a.untidy) {
          a.order = a.order.filter((o) => !isHole(o.id));
          a.untidy = false;
        }
        const i = a.order.findIndex((o) => o.id === a.carrying), j = a.order.findIndex((o) => o.id === next.id);
        if (i >= 0 && j >= 0) [a.order[i], a.order[j]] = [a.order[j], a.order[i]];
        this.repack();
      } else if (next) this.sel = next.id;
      this.draw();
      return true;
    }
    switch (e.code) {
      case 'Enter':
      case 'KeyE':
        if (!a.carrying && this.sel && !isHole(this.sel)) {
          a.before = this.snapshot();
          a.carrying = this.sel;
        } else if (a.carrying) {
          a.carrying = undefined;
          a.before = undefined;
          this.saveBlocks();
        }
        this.draw();
        return true;
      case 'Space': {
        const p = this.store.world!.properties.find((x) => x.id === this.sel);
        if (!a.carrying && p?.kind === 'town') {
          a.town = p.id;
          a.lot = p.buildings.find((b) => b.role === 'main')?.slot ?? 0;
          this.draw();
        }
        return true;
      }
      case 'KeyC':
        // Close every gap: pack the properties with no empty lots between them.
        if (!a.carrying) {
          a.order = a.order.filter((o) => !isHole(o.id));
          a.untidy = false;
          this.repack();
          if (this.sel && isHole(this.sel)) this.sel = a.order[0]?.id;
          this.saveBlocks();
          this.draw();
        }
        return true;
      case 'Escape':
        if (a.carrying) {
          Object.assign(a, a.before);
          a.carrying = undefined;
          a.before = undefined;
          this.draw();
        } else this.close();
        return true;
      case 'KeyM':
        if (!a.carrying) this.close();
        return true;
      default:
        return false;
    }
  }

  /** The town being rearranged, as it looks in the preview. */
  private town(): Property | undefined {
    const a = this.arr!;
    return this.view()?.properties.find((p) => p.id === a.town);
  }

  /** Moving houses between the lots of one town. */
  private townKey(e: KeyboardEvent, dir?: { x: number; z: number }): boolean {
    const a = this.arr!;
    const town = this.town();
    if (!town) {
      a.town = undefined;
      return true;
    }
    const lots = Array.from({ length: town.cols * town.rows }, (_, slot) => {
      const c = lotCell(town, slot);
      return { id: String(slot), slot, x: c.gx * PITCH, z: c.gz * PITCH };
    });
    const at = (slot: number) => town.buildings.find((b) => b.slot === slot);
    if (dir) {
      const cur = lots[a.lot ?? 0];
      const next = cur ? nearestIn(cur, dir, lots) : undefined;
      if (next && a.carrying) {
        // Swap the carried house with whatever is on that lot (maybe nothing).
        const map = Object.fromEntries(town.buildings.map((b) => [b.id, b.slot]));
        const other = at(next.slot);
        if (other) map[other.id] = a.lot!;
        map[a.carrying] = next.slot;
        a.slots[town.id] = map;
      }
      if (next) a.lot = next.slot;
      this.draw();
      return true;
    }
    switch (e.code) {
      case 'Enter':
      case 'KeyE': {
        const here = at(a.lot ?? -1);
        if (!a.carrying && here) {
          a.before = this.snapshot();
          a.carrying = here.id;
        } else if (a.carrying) {
          a.carrying = undefined;
          a.before = undefined;
          if (a.slots[town.id]) this.onArrange?.({ slots: { [town.id]: a.slots[town.id] } });
        }
        this.draw();
        return true;
      }
      case 'Escape':
      case 'Space':
        if (a.carrying && e.code === 'Escape') {
          Object.assign(a, a.before);
          a.carrying = undefined;
          a.before = undefined;
        } else if (!a.carrying) {
          this.sel = a.town;
          a.town = undefined;
        }
        this.draw();
        return true;
      default:
        return false;
    }
  }

  /** Every block on the island, by property id (plus the fair and the circuit). */
  private blocksOf(world: WorldState): Record<string, Block> {
    const out: Record<string, Block> = {};
    for (const p of world.properties) out[p.id] = { gx: p.gx, gz: p.gz, cols: p.cols, rows: p.rows };
    if (world.fair) out[FAIR_ID] = { ...world.fair };
    if (world.circuit) out[CIRCUIT_ID] = { ...world.circuit };
    return out;
  }

  /** The world as drawn: the live one, or the arrange preview. */
  private view(): WorldState | undefined {
    const world = this.store.world;
    if (!world || !this.arr) return world;
    const b = this.arr.blocks, slots = this.arr.slots;
    return {
      ...world,
      fair: b[FAIR_ID] ?? world.fair,
      circuit: b[CIRCUIT_ID] ?? world.circuit,
      properties: world.properties.map((p) => ({
        ...p, ...(b[p.id] ?? {}),
        buildings: slots[p.id] ? p.buildings.map((x) => ({ ...x, slot: slots[p.id][x.id] ?? x.slot })) : p.buildings,
      })),
    };
  }

  private targets(): MapTarget[] {
    const world = this.store.world;
    if (!world) return [];
    const out: MapTarget[] = [];
    const L = plazaLayout(world);
    out.push({ kind: 'plaza', id: 'plaza', label: '⛲ Plaza', x: L.center.x, z: L.center.z });
    for (const [kind, id, b] of [['fair', FAIR_ID, world.fair], ['circuit', CIRCUIT_ID, world.circuit]] as const) {
      if (!b) continue;
      const bb = blockBounds(b);
      out.push({ kind, id, label: RESERVED_LABEL[id], x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 });
    }
    for (const p of world.properties) {
      for (const b of p.buildings) {
        const c = buildingCenter(world, b);
        out.push({ kind: 'building', id: b.id, label: b.role === 'main' && p.kind === 'town' ? `🏛️ ${b.name}` : `🏠 ${b.name}`, x: c.x, z: c.z, building: b });
      }
    }
    return out;
  }

  private hint() {
    const a = this.arr;
    if (a) {
      const name = (id?: string) => (!id ? '' : RESERVED_LABEL[id] ?? (isHole(id) ? 'an empty spot' : id.split('/').pop()!));
      const town = a.town ? this.town() : undefined;
      if (town) {
        const here = town.buildings.find((b) => b.slot === a.lot);
        this.hintEl.textContent = a.carrying
          ? `🏘️ Moving ${name(a.carrying)} in ${town.name} · WASD/arrows move · E drop · Esc put it back`
          : `🏘️ ${town.name}: ▶ ${here ? name(here.id) : 'an empty lot'} · WASD/arrows pick · E pick up · Space/Esc back to the island`;
        return;
      }
      const isTown = this.store.world?.properties.find((p) => p.id === this.sel)?.kind === 'town';
      this.hintEl.textContent = a.carrying
        ? `📦 Moving ${name(a.carrying)} · WASD/arrows trade places · E drop · Esc put it back`
        : `▶ ${name(this.sel)} · WASD/arrows pick · E pick up${isTown ? ' · Space move its houses' : ''} · C close the gaps${a.untidy ? ' (the island is untidy)' : ''} · Esc done`;
      return;
    }
    const t = this.selected();
    this.hintEl.textContent = `${t ? `▶ ${t.label} · ` : ''}WASD/arrows pick · E/Enter travel${t?.kind === 'building' ? ' · T mailbox' : ''} · click to travel · M close`;
  }

  draw() {
    this.hint();
    const world = this.view();
    const shape = this.island.shape;
    if (!world || !shape) return;
    const b = shape.bounds;
    const pad = 30;
    const minX = b.minX + pad, maxX = b.maxX - pad, minZ = b.minZ + pad, maxZ = b.maxZ - pad;
    const maxW = window.innerWidth - 120, maxH = window.innerHeight - 140;
    this.scale = Math.min(maxW / (maxX - minX), maxH / (maxZ - minZ));
    this.origin = { x: minX, z: minZ };
    const W = Math.round((maxX - minX) * this.scale), H = Math.round((maxZ - minZ) * this.scale);
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = (x: number) => (x - minX) * this.scale;
    const Z = (z: number) => (z - minZ) * this.scale;

    // Sea and land.
    ctx.fillStyle = '#6fcbe0';
    ctx.fillRect(0, 0, W, H);
    const step = 2;
    for (let z = minZ; z < maxZ; z += step) {
      for (let x = minX; x < maxX; x += step) {
        const s = shape.sdf(x, z);
        if (s > 0) continue;
        ctx.fillStyle = s > -6 ? '#f4e4b0' : '#8fd06a';
        ctx.fillRect(X(x), Z(z), step * this.scale + 0.6, step * this.scale + 0.6);
      }
    }

    // Plaza and lots.
    const pb = blockBounds(world.plaza);
    ctx.fillStyle = '#eadfc8';
    ctx.fillRect(X(pb.minX + 2), Z(pb.minZ + 2), (pb.maxX - pb.minX - 4) * this.scale, (pb.maxZ - pb.minZ - 4) * this.scale);
    const L = plazaLayout(world);
    ctx.font = `800 ${Math.round(Math.min(15, Math.max(10, this.scale * 1.7)))}px Nunito, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [label, p] of [['🏢 Hiring', L.hiring], ['🏗️ Builder', L.construction], ['⛲', L.fountain]] as const) {
      ctx.fillStyle = '#5b4636';
      ctx.fillText(label, X(p.x), Z(p.z));
    }
    for (const [id, b, color] of [[FAIR_ID, world.fair, '#ffd6e7'], [CIRCUIT_ID, world.circuit, '#d9d6e6']] as const) {
      if (!b) continue;
      const fb = blockBounds(b);
      ctx.fillStyle = color;
      roundRect(ctx, X(fb.minX + 2), Z(fb.minZ + 2), (fb.maxX - fb.minX - 4) * this.scale, (fb.maxZ - fb.minZ - 4) * this.scale, 10);
      ctx.fill();
      ctx.fillStyle = '#5b4636';
      ctx.fillText(RESERVED_LABEL[id], X((fb.minX + fb.maxX) / 2), Z((fb.minZ + fb.maxZ) / 2));
    }
    // Empty lots kept in the arrange order: somewhere a property can move to.
    if (this.arr && !this.arr.untidy) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(91,70,54,0.45)';
      ctx.lineWidth = 2;
      for (const [id, b] of Object.entries(this.arr.blocks)) {
        if (!isHole(id)) continue;
        roundRect(ctx, X(b.gx * PITCH - HALF), Z(b.gz * PITCH - HALF), LOTPX(this.scale), LOTPX(this.scale), 6);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of world.properties) {
      const bb = blockBounds(p);
      if (p.kind === 'town') {
        ctx.fillStyle = 'rgba(217,208,193,0.9)';
        ctx.fillRect(X(bb.minX + 0.5), Z(bb.minZ + 0.5), (bb.maxX - bb.minX - 1) * this.scale, (bb.maxZ - bb.minZ - 1) * this.scale);
      }
      for (let slot = 0; slot < p.cols * p.rows; slot++) {
        const c = lotCell(p, slot);
        const cx = c.gx * PITCH, cz = c.gz * PITCH;
        const bld = p.buildings.find((x) => x.slot === slot);
        ctx.fillStyle = bld ? (bld.role === 'main' ? '#ffe9a8' : '#bfe3a4') : 'rgba(191,227,164,0.5)';
        roundRect(ctx, X(cx - HALF), Z(cz - HALF), LOTPX(this.scale), LOTPX(this.scale), 6);
        ctx.fill();
        if (bld) {
          ctx.fillStyle = '#5b4636';
          const name = bld.name.split('/').pop()!;
          if (bld.role === 'main' && p.kind === 'town') {
            ctx.fillText('🏛️', X(cx), Z(cz) - LOTPX(this.scale) * 0.28);
          }
          wrapText(ctx, name, X(cx), Z(cz), LOTPX(this.scale) - 8);
        }
      }
    }

    if (!this.arr) {
      // Busy villagers.
      for (const s of this.store.live()) this.marker(ctx, world, s, X, Z);
      // Player.
      const pp = this.island.player.pos;
      ctx.fillStyle = '#ff5a5f';
      ctx.beginPath();
      ctx.arc(X(pp.x), Z(pp.z), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Keyboard selection.
    const sel = this.selectionRect(world);
    if (sel) {
      ctx.save();
      ctx.strokeStyle = this.arr?.carrying ? '#e8645c' : '#ff9f1c';
      ctx.lineWidth = 4;
      if (this.arr?.carrying) ctx.setLineDash([10, 6]);
      roundRect(ctx, X(sel.minX), Z(sel.minZ), (sel.maxX - sel.minX) * this.scale, (sel.maxZ - sel.minZ) * this.scale, 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  private selectionRect(world: WorldState) {
    if (!this.sel) return undefined;
    const inset = (b: Block) => {
      const bb = blockBounds(b);
      return { minX: bb.minX + 1, maxX: bb.maxX - 1, minZ: bb.minZ + 1, maxZ: bb.maxZ - 1 };
    };
    if (this.arr?.town) {
      const town = world.properties.find((p) => p.id === this.arr!.town);
      if (!town) return undefined;
      const c = lotCell(town, this.arr.lot ?? 0);
      return { minX: c.gx * PITCH - HALF - 1, maxX: c.gx * PITCH + HALF + 1, minZ: c.gz * PITCH - HALF - 1, maxZ: c.gz * PITCH + HALF + 1 };
    }
    if (this.arr) {
      const b = this.arr.blocks[this.sel];
      return b ? inset(b) : undefined;
    }
    if (this.sel === 'plaza') return inset(world.plaza);
    if (this.sel === FAIR_ID) return world.fair ? inset(world.fair) : undefined;
    if (this.sel === CIRCUIT_ID) return world.circuit ? inset(world.circuit) : undefined;
    const t = this.selected();
    if (t?.kind !== 'building') return undefined;
    return { minX: t.x - HALF - 1, maxX: t.x + HALF + 1, minZ: t.z - HALF - 1, maxZ: t.z + HALF + 1 };
  }

  private marker(ctx: CanvasRenderingContext2D, world: WorldState, s: SessionSummary, X: (x: number) => number, Z: (z: number) => number) {
    const b = world.properties.flatMap((p) => p.buildings).find((x) => x.id === s.buildingId);
    if (!b) return;
    const c = buildingCenter(world, b);
    const st = statusOf(s);
    ctx.fillStyle = STATUS_COLOR[st] ?? '#888';
    ctx.beginPath();
    ctx.arc(X(c.x + HALF - 2), Z(c.z - HALF + 2), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

const LOTPX = (scale: number) => (HALF * 2) * scale;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number) {
  if (ctx.measureText(text).width <= max) {
    ctx.fillText(text, x, y);
    return;
  }
  const parts = text.split(/(?<=[-_.])/);
  let a = '';
  let i = 0;
  while (i < parts.length && ctx.measureText(a + parts[i]).width <= max) a += parts[i++];
  if (!a) {
    fitText(ctx, text, x, y, max);
    return;
  }
  const lh = parseInt(ctx.font.match(/(\d+)px/)?.[1] ?? '12', 10) + 1;
  fitText(ctx, a, x, y - lh / 2, max);
  fitText(ctx, parts.slice(i).join(''), x, y + lh / 2, max);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number) {
  let t = text;
  while (ctx.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + '…';
  ctx.fillText(t, x, y);
}

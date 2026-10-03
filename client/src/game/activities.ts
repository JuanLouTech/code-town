import * as THREE from 'three';
import type { Butterfly } from './ambient.ts';
import { ModelBuilder } from './builder.ts';
import { BY_ID, CATALOG, pickWeighted, type CatalogItem } from './catalog.ts';
import { colorMat, curved, vertexMat } from './engine.ts';
import type { Island } from './island.ts';
import { PITCH, nearReserved } from './layout.ts';
import { FONT } from './props.ts';
import { pondDepth } from './terrain.ts';

export type Activity =
  | { kind: 'fish'; label: string; target: THREE.Vector3; where: 'sea' | 'pond'; luck: number }
  | { kind: 'bug'; label: string; butterfly: Butterfly }
  | { kind: 'shake'; label: string; tree: { id: string; pos: THREE.Vector3; fruit: string } }
  | { kind: 'dig'; label: string; spot: Spot }
  | { kind: 'pick'; label: string; spot: Spot };

interface Spot { id: string; pos: THREE.Vector3; mesh: THREE.Object3D; itemId?: string }

export interface Catch { item: CatalogItem; size?: number }

const FRUIT_ID: Record<string, string> = { '#e8423b': 'apple', '#f28c28': 'orange', '#ffd94a': 'pear' };

export interface DayState { date: string; dug: string[]; picked: string[]; shaken: string[] }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashStr(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Phase = 'cast' | 'wait' | 'approach' | 'nibble' | 'bite' | 'done';

/** The island's minigames: fishing, bug catching, fruit shaking, digging and beachcombing. */
export class Activities {
  group = new THREE.Group();
  busy = false;
  onCatch?: (c: Catch) => boolean; // returns false when the pockets are full
  onMessage?: (text: string) => void;
  onSound?: (kind: 'splash' | 'bite' | 'pop' | 'dig') => void;
  /** Called when today's digs / pickings change, to save them. */
  onDay?: (day: DayState) => void;
  private spots: Spot[] = [];
  private day: DayState = { date: today(), dug: [], picked: [], shaken: [] };
  private fishing?: {
    phase: Phase; timer: number; nibbles: number; target: THREE.Vector3; where: 'sea' | 'pond'; luck: number;
    bobber: THREE.Group; line: THREE.Line; shadow: THREE.Mesh; fish: CatalogItem; waterY: number;
  };
  private holding?: { mesh: THREE.Mesh; until: number };
  private action?: { until: number; done: () => void };
  private emojiTex = new Map<string, THREE.Texture>();

  constructor(private island: Island) {}

  /** Restores today's digs and pickings (yesterday's don't count). */
  setDay(d: DayState | undefined) {
    this.day = d && d.date === today() ? d : { date: today(), dug: [], picked: [], shaken: [] };
    if (this.island.shape) this.setWorld();
  }

  private saveDay() {
    this.onDay?.(this.day);
  }

  /** Lays out today's dig spots and seashells. */
  setWorld() {
    for (const s of this.spots) this.group.remove(s.mesh);
    this.spots = [];
    const shape = this.island.shape!;
    const occ = this.island.occ!;
    const plan = this.island.plan!;
    const rnd = seeded(hashStr(today()));
    const b = shape.bounds;
    const nearLots = (x: number, z: number) => {
      const gx = Math.round(x / PITCH), gz = Math.round(z / PITCH);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!occ.lots.has(`${gx + dx},${gz + dz}`)) continue;
        if (Math.abs(x - (gx + dx) * PITCH) < PITCH / 2 + 2 && Math.abs(z - (gz + dz) * PITCH) < PITCH / 2 + 2) return true;
      }
      return false;
    };
    const blocked = (x: number, z: number) => nearLots(x, z) || nearReserved(occ, x, z, 2) || plan.clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1);
    let dig = 0, shells = 0;
    for (let tries = 0; tries < 4000 && (dig < 7 || shells < 9); tries++) {
      const x = b.minX + rnd() * (b.maxX - b.minX);
      const z = b.minZ + rnd() * (b.maxZ - b.minZ);
      const s = shape.sdf(x, z);
      const id = `${Math.round(x)},${Math.round(z)}`;
      if (dig < 7 && s < -9 && !blocked(x, z)) {
        dig++;
        if (this.day.dug.includes(id)) continue;
        const mb = new ModelBuilder();
        for (const r of [0.75, -0.75]) mb.box(0.9, 0.03, 0.14, '#6f4529', [0, 0.03, 0], [0, r, 0]);
        mb.sphere(0.25, '#9a6b43', [0.35, 0.05, 0.3], [1, 0.4, 1], 0);
        const m = new THREE.Mesh(mb.build(), vertexMat);
        m.position.set(x, 0, z);
        this.group.add(m);
        this.spots.push({ id, pos: new THREE.Vector3(x, 0, z), mesh: m, itemId: 'dig' });
      } else if (shells < 9 && s > -5.5 && s < -2.2) {
        shells++;
        if (this.day.picked.includes(id)) continue;
        const item = pickWeighted(CATALOG.filter((c) => c.category === 'shell'));
        const mb = new ModelBuilder();
        const col = item.id === 'pearl' ? '#f2e9f7' : item.id === 'sand-dollar' ? '#f1e3c4' : item.id === 'console-conch' ? '#ffb38a' : '#ffd6e0';
        mb.sphere(0.22, col, [0, 0.05, 0], [1, 0.45, 0.8], 1);
        mb.box(0.3, 0.02, 0.04, '#ffffff', [0, 0.14, 0]);
        const m = new THREE.Mesh(mb.build(), vertexMat);
        m.position.set(x, -0.25, z);
        m.rotation.y = rnd() * 6;
        this.group.add(m);
        this.spots.push({ id, pos: new THREE.Vector3(x, 0, z), mesh: m, itemId: item.id });
      }
    }
  }

  /** The activity the player could do right now, if any. */
  find(pos: THREE.Vector3, facing: number): Activity | undefined {
    if (this.busy) return undefined;
    const island = this.island;
    // Butterflies within net reach.
    let bestB: Butterfly | undefined;
    let bd = 2.4;
    for (const b of island.ambient.butterflies) {
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d < bd) {
        bd = d;
        bestB = b;
      }
    }
    if (bestB) return { kind: 'bug', label: `🦋 Swing the net`, butterfly: bestB };
    // Things on the ground.
    for (const s of this.spots) {
      if (Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) > 1.5) continue;
      if (s.itemId === 'dig') return { kind: 'dig', label: '⛏️ Dig here', spot: s };
      const it = BY_ID.get(s.itemId!);
      return { kind: 'pick', label: `✋ Pick up the ${it?.name ?? 'thing'}`, spot: s };
    }
    // Fruit trees.
    for (const t of island.nature?.fruitTrees ?? []) {
      if (Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z) > 1.9) continue;
      const id = `${Math.round(t.pos.x)},${Math.round(t.pos.z)}`;
      return { kind: 'shake', label: '🌳 Shake the tree', tree: { id, pos: t.pos, fruit: t.fruit } };
    }
    // Water in front of us?
    const shape = island.shape!;
    const ponds = island.plan?.ponds ?? [];
    const onPier = island.plan?.walk.some((r) => pos.x > r.minX && pos.x < r.maxX && pos.z > r.minZ && pos.z < r.maxZ);
    for (const dist of [3.2, 2.4]) {
      const ahead = new THREE.Vector3(pos.x + Math.sin(facing) * dist, 0, pos.z + Math.cos(facing) * dist);
      if (pondDepth(ponds, ahead.x, ahead.z) > 0.3 && pondDepth(ponds, pos.x, pos.z) === 0) {
        return { kind: 'fish', label: '🎣 Cast your line', target: ahead, where: 'pond', luck: 1 };
      }
      if (shape.sdf(ahead.x, ahead.z) > 0.8 && (shape.sdf(pos.x, pos.z) > -4.5 || onPier)) {
        return { kind: 'fish', label: '🎣 Cast your line', target: ahead, where: 'sea', luck: onPier ? 1.6 : 1 };
      }
    }
    return undefined;
  }

  start(a: Activity) {
    const player = this.island.player;
    switch (a.kind) {
      case 'fish':
        this.startFishing(a.target, a.where, a.luck);
        break;
      case 'bug':
        player.busyAction = 'net';
        player.char.actionTime = 0;
        player.char.setAction('idle');
        player.char.setAction('net');
        this.busy = true;
        this.action = {
          until: performance.now() + 550,
          done: () => {
            const b = a.butterfly;
            const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
            player.busyAction = undefined;
            this.busy = false;
            if (d < 2.2 && b.flee <= 0 && !b.caught) {
              b.caught = true;
              this.island.ambient.removeButterfly(b);
              this.award(BY_ID.get(b.kind.id)!);
            } else {
              this.onMessage?.('Whoosh… it got away! Try sneaking up slowly (don’t run).');
            }
          },
        };
        break;
      case 'shake': {
        player.busyAction = 'shake';
        this.busy = true;
        this.island.effects.poof(new THREE.Vector3(a.tree.pos.x, 1.6, a.tree.pos.z), 12, '#6cc452', 1.2);
        this.action = {
          until: performance.now() + 900,
          done: () => {
            player.busyAction = undefined;
            this.busy = false;
            if (this.day.shaken.includes(a.tree.id)) {
              this.onMessage?.('Nothing fell… this tree is resting until tomorrow. 🌙');
              return;
            }
            this.day.shaken.push(a.tree.id);
            this.saveDay();
            const n = 2 + Math.floor(Math.random() * 2);
            const fruitId = FRUIT_ID[a.tree.fruit] ?? 'apple';
            for (let i = 0; i < n; i++) {
              const ang = Math.random() * Math.PI * 2;
              const p = new THREE.Vector3(a.tree.pos.x + Math.cos(ang) * 1.4, 0, a.tree.pos.z + Math.sin(ang) * 1.4);
              const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), colorMat(a.tree.fruit));
              m.position.set(p.x, 0.2, p.z);
              m.castShadow = true;
              this.group.add(m);
              this.spots.push({ id: `fruit-${Math.random()}`, pos: p, mesh: m, itemId: fruitId });
            }
            this.onSound?.('pop');
          },
        };
        break;
      }
      case 'dig': {
        player.busyAction = 'dig';
        this.busy = true;
        this.onSound?.('dig');
        this.action = {
          until: performance.now() + 1300,
          done: () => {
            player.busyAction = undefined;
            this.busy = false;
            this.island.effects.poof(a.spot.pos, 10, '#9a6b43', 0.8);
            this.removeSpot(a.spot);
            this.day.dug.push(a.spot.id);
            this.saveDay();
            if (Math.random() < 0.18) {
              this.award({ id: 'coins', name: 'bag of coins', category: 'fossil', emoji: '💰', value: 500, rarity: 1 }, undefined, true);
            } else {
              this.award(pickWeighted(CATALOG.filter((c) => c.category === 'fossil')));
            }
          },
        };
        break;
      }
      case 'pick': {
        const it = BY_ID.get(a.spot.itemId!);
        if (!it) return;
        if (!this.award(it)) return;
        this.removeSpot(a.spot);
        if (!a.spot.id.startsWith('fruit-')) {
          this.day.picked.push(a.spot.id);
          this.saveDay();
        }
        break;
      }
    }
  }

  private removeSpot(s: Spot) {
    this.group.remove(s.mesh);
    this.spots = this.spots.filter((x) => x !== s);
  }

  private award(item: CatalogItem, size?: number, coins = false) {
    const ok = this.onCatch?.({ item, size }) ?? true;
    if (!ok) return false;
    if (!coins) this.holdUp(item.emoji);
    return true;
  }

  /** The player lifts the find above their head to show it off. */
  private holdUp(emoji: string) {
    let tex = this.emojiTex.get(emoji);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      ctx.font = `96px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 64, 70);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.emojiTex.set(emoji, tex);
    }
    if (this.holding) this.group.remove(this.holding.mesh);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), curved(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })));
    m.renderOrder = 6;
    this.group.add(m);
    this.holding = { mesh: m, until: performance.now() + 2200 };
    this.island.player.busyAction = 'hold';
    this.island.effects.poof(this.island.player.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), 8, '#fff6c2', 0.6);
  }

  // --- fishing -------------------------------------------------------------------------------

  private startFishing(target: THREE.Vector3, where: 'sea' | 'pond', luck: number) {
    const player = this.island.player;
    const waterY = where === 'sea' ? -0.26 : -0.2;
    const bobber = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), colorMat('#e8423b'));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), colorMat('#ffffff'));
    bobber.add(top, bot);
    bobber.position.copy(player.pos).setY(1.5);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineGeo, curved(new THREE.LineBasicMaterial({ color: '#ffffff' })));
    line.frustumCulled = false;
    const pool = CATALOG.filter((c) => c.category === 'fish' && c.where === where);
    const fish = pickWeighted(pool, luck);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), curved(new THREE.MeshBasicMaterial({ color: '#10324a', transparent: true, opacity: 0, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    const s = 0.6 + fish.rarity * 0.25;
    shadow.scale.set(s * 0.6, s * 1.5, 1);
    this.group.add(bobber, line, shadow);
    this.fishing = { phase: 'cast', timer: 0.45, nibbles: 0, target, where, luck, bobber, line, shadow, fish, waterY };
    player.busyAction = 'fish';
    player.onBusyMove = () => this.stopFishing('You reeled in your line.');
    this.busy = true;
    this.onSound?.('pop');
  }

  private stopFishing(message?: string) {
    const f = this.fishing;
    if (!f) return;
    this.group.remove(f.bobber, f.line, f.shadow);
    this.fishing = undefined;
    this.busy = false;
    this.island.player.char.setEmote(null, 0);
    if (this.island.player.busyAction === 'fish') this.island.player.busyAction = undefined;
    this.island.player.onBusyMove = undefined;
    if (message) this.onMessage?.(message);
  }

  /** E / Enter while fishing: hook the fish, or pull out too early. Esc reels in. */
  handleKey(e: KeyboardEvent): boolean {
    const f = this.fishing;
    if (!f) return this.busy;
    if (e.code === 'Escape') {
      this.stopFishing('You reeled in your line.');
      return true;
    }
    if (e.code !== 'KeyE' && e.code !== 'Enter') return true;
    if (f.phase === 'bite') {
      const size = f.fish.size ? Math.round(f.fish.size[0] + Math.random() * (f.fish.size[1] - f.fish.size[0])) : undefined;
      this.island.effects.poof(f.bobber.position.clone(), 12, '#bff0ff', 0.8);
      this.onSound?.('splash');
      const fish = f.fish;
      this.stopFishing();
      this.award(fish, size);
    } else if (f.phase === 'nibble' || f.phase === 'approach') {
      this.stopFishing('Too eager! The fish got spooked and swam away. Wait for the big splash.');
    } else {
      this.stopFishing('You reeled in your line.');
    }
    return true;
  }

  update(dt: number, t: number) {
    const player = this.island.player;
    if (this.action && performance.now() > this.action.until) {
      const a = this.action;
      this.action = undefined;
      a.done();
    }
    if (this.holding) {
      const p = player.pos;
      this.holding.mesh.position.set(p.x, 2.75 + Math.sin(t * 5) * 0.06, p.z);
      this.holding.mesh.quaternion.copy(this.island.engine.camera.quaternion);
      if (performance.now() > this.holding.until) {
        this.group.remove(this.holding.mesh);
        this.holding = undefined;
        if (player.busyAction === 'hold') player.busyAction = undefined;
      }
    }
    for (const s of this.spots) {
      if (s.itemId && s.itemId !== 'dig' && s.id.startsWith('fruit-')) s.mesh.rotation.y += dt;
    }

    const f = this.fishing;
    if (!f) return;
    f.timer -= dt;
    const bob = f.bobber.position;
    switch (f.phase) {
      case 'cast': {
        const k = 1 - Math.max(0, f.timer) / 0.45;
        bob.lerpVectors(player.pos.clone().setY(1.6), f.target.clone().setY(f.waterY), k);
        bob.y += Math.sin(k * Math.PI) * 1.4;
        if (f.timer <= 0) {
          f.phase = 'wait';
          f.timer = 1.5 + Math.random() * 3.5;
          this.onSound?.('splash');
        }
        break;
      }
      case 'wait':
        bob.y = f.waterY + Math.sin(t * 2.5) * 0.03;
        if (f.timer <= 0) {
          f.phase = 'approach';
          f.timer = 2.2;
          const a = Math.random() * Math.PI * 2;
          f.shadow.position.set(f.target.x + Math.cos(a) * 4, f.waterY - 0.05, f.target.z + Math.sin(a) * 4);
          f.shadow.rotation.z = -a + Math.PI / 2;
        }
        break;
      case 'approach': {
        bob.y = f.waterY + Math.sin(t * 2.5) * 0.03;
        const mat = f.shadow.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.min(0.45, mat.opacity + dt * 0.5);
        f.shadow.position.lerp(new THREE.Vector3(f.target.x, f.waterY - 0.05, f.target.z + 0.3), 1 - Math.exp(-dt * 1.4));
        if (f.timer <= 0) {
          f.phase = 'nibble';
          f.nibbles = 1 + Math.floor(Math.random() * 3);
          f.timer = 0.8;
        }
        break;
      }
      case 'nibble': {
        const k = f.timer / 0.8;
        bob.y = f.waterY - (k > 0.7 ? (1 - k) * 0.25 : 0) + Math.sin(t * 2.5) * 0.02;
        if (f.timer <= 0) {
          f.nibbles--;
          if (f.nibbles > 0) f.timer = 0.6 + Math.random() * 0.6;
          else {
            f.phase = 'bite';
            f.timer = 0.9;
            this.island.effects.poof(bob.clone(), 10, '#bff0ff', 0.6);
            player.char.setEmote('alert', t);
            this.onSound?.('bite');
          }
        }
        break;
      }
      case 'bite':
        bob.y = f.waterY - 0.28;
        if (f.timer <= 0) {
          player.char.setEmote(null, t);
          this.stopFishing('It got away… Press E right when the bobber gets pulled under!');
        }
        break;
      default:
        break;
    }
    if (f && f.phase !== 'bite' && player.char.emote.kind === 'alert') player.char.setEmote(null, t);
    const tip = player.char.rodTip() ?? player.pos.clone().setY(2);
    const attr = f.line.geometry.attributes.position as THREE.BufferAttribute;
    attr.setXYZ(0, tip.x, tip.y, tip.z);
    attr.setXYZ(1, bob.x, bob.y + 0.1, bob.z);
    attr.needsUpdate = true;
  }
}

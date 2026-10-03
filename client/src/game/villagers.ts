import * as THREE from 'three';
import type { AgentInfo, Building, Look, Resident, SessionSummary, Species, VisitorInfo, WorldState } from '../../../shared/protocol.ts';
import { Character, type Action } from './character.ts';
import type { Effects } from './effects.ts';
import { PITCH, attentionSpot, frameFace, frameOf, frameToWorld, lotSpots, plazaLayout, route, type Occupancy } from './layout.ts';
import type { Emote } from './props.ts';

export type ActorKind = 'resident' | 'mercenary' | 'gnome' | 'npc' | 'visitor';

interface Goal {
  key: string;
  pos: THREE.Vector3;
  face: number;
  action: Action;
  seatY?: number;
  onArrive?: () => void;
}

const SEAT_Y = [0.5, 0.2, 0.16];
const TRAVELLER_NAMES = ['Rambler', 'Nomad', 'Pilgrim', 'Voyager', 'Roamer', 'Hiker', 'Drifter', 'Wayfarer'];
const TRAVELLER_SPECIES: Species[] = ['cat', 'dog', 'rabbit', 'fox', 'bear', 'duck', 'mouse', 'koala'];
const TRAVELLER_FUR = ['#f2c48d', '#c98b56', '#9aa2ad', '#f5f0e6', '#e8743b', '#7d8ba0'];
/** Where visitors (sessions running in a terminal) hang around in a lot, by the fence (lot-local). */
const VISITOR_SPOTS = [{ x: 6.4, z: 4.6 }, { x: 6.4, z: 3.2 }, { x: 5.2, z: 2.2 }, { x: 4.8, z: 3.4 }];
const GNOME_LOOK = (seed: number): Look => ({
  species: 'gnome',
  fur: '#f7c9a5',
  shirt: ['#4f86c6', '#59a85a', '#8e6cc2', '#d9824b'][seed % 4],
  accent: '#ffffff',
  hat: 'cone',
});

function angleLerp(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export class Actor {
  char: Character;
  path: THREE.Vector3[] = [];
  goal?: Goal;
  speed = 3.4;
  talking = false;
  talkTarget?: THREE.Vector3;
  arrived = true;
  idleUntil = 0;
  finishingAt = 0;
  now = 0;
  /** After a chat, stay put until this time (quick follow-ups shouldn't send them back and forth). */
  lingerUntil = 0;
  lingerAction: Action = 'idle';
  sessionId?: string;
  agent?: AgentInfo;
  /** For a visitor: the outside (terminal) session it stands for. */
  visitor?: VisitorInfo;
  voice: number;
  building?: Building;
  resident?: Resident;

  constructor(public id: string, public name: string, public kind: ActorKind, public look: Look, scale = 1) {
    this.char = new Character(look, scale);
    this.voice = 0.8 + (hashStr(id) % 100) / 180 + (kind === 'gnome' ? 0.5 : 0);
  }

  get pos() {
    return this.char.root.position;
  }

  goTo(goal: Goal, occ: Occupancy) {
    this.goal = goal;
    this.path = route(occ, this.pos, goal.pos);
    this.arrived = false;
  }

  teleport(goal: Goal) {
    this.goal = goal;
    this.pos.copy(goal.pos);
    this.char.root.rotation.y = goal.face;
    this.path = [];
    this.arrived = true;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    this.now = t;
    const root = this.char.root;
    if (this.talking && this.talkTarget) {
      const want = Math.atan2(this.talkTarget.x - root.position.x, this.talkTarget.z - root.position.z);
      root.rotation.y = angleLerp(root.rotation.y, want, 1 - Math.exp(-dt * 8));
      this.char.setAction('talk');
      this.char.update(dt, t, camera);
      return;
    }
    if (t < this.lingerUntil) {
      this.char.seatY = 0;
      root.position.y = 0;
      this.char.setAction(this.lingerAction);
      this.char.update(dt, t, camera);
      return;
    }
    if (this.path.length) {
      const next = this.path[0];
      const dx = next.x - root.position.x;
      const dz = next.z - root.position.z;
      const dist = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (dist <= step) {
        root.position.x = next.x;
        root.position.z = next.z;
        this.path.shift();
      } else {
        root.position.x += (dx / dist) * step;
        root.position.z += (dz / dist) * step;
        root.rotation.y = angleLerp(root.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
      }
      this.char.seatY = 0;
      root.position.y = 0;
      this.char.setAction(this.speed > 4.5 ? 'run' : 'walk');
    } else if (this.goal) {
      if (!this.arrived) {
        this.arrived = true;
        this.goal.onArrive?.();
      }
      root.rotation.y = angleLerp(root.rotation.y, this.goal.face, 1 - Math.exp(-dt * 6));
      this.char.seatY = this.goal.seatY ?? 0;
      this.char.setAction(this.goal.action);
    }
    this.char.update(dt, t, camera);
  }
}

/** Keeps every character on the island in sync with the sessions the server reports. */
export class Director {
  actors = new Map<string, Actor>();
  group = new THREE.Group();
  private world!: WorldState;
  private occ!: Occupancy;
  private sessions = new Map<string, SessionSummary>();
  private chairs = new Map<string, THREE.Object3D>(); // residentId -> chair pivot
  private lastPlan = 0;
  onSpeak?: (actor: Actor) => void;

  constructor(private effects: Effects, private camera: THREE.Camera) {}

  setWorld(world: WorldState, occ: Occupancy, chairs: Map<string, THREE.Object3D>) {
    this.world = world;
    this.occ = occ;
    this.chairs = chairs;
    const plaza = plazaLayout(world);
    const residents = new Map<string, { r: Resident; b: Building }>();
    for (const p of world.properties) for (const b of p.buildings) for (const r of b.residents) residents.set(r.id, { r, b });

    for (const [id, a] of this.actors) {
      if (a.kind === 'resident' && !residents.has(id)) this.removeActor(id, false);
    }
    for (const [id, { r, b }] of residents) {
      let a = this.actors.get(id);
      if (!a) {
        a = new Actor(id, r.name, 'resident', r.look);
        this.addActor(a);
      }
      a.building = b;
      a.resident = r;
      a.teleport(this.seatGoal(a));
    }

    // Plaza staff.
    if (!this.actors.has('npc:receptionist')) {
      this.addActor(new Actor('npc:receptionist', 'Tansy', 'npc', { species: 'sheep', fur: '#fffaf0', shirt: '#7ec4ff', accent: '#ffffff', hat: 'bow' }));
      this.addActor(new Actor('npc:architect', 'Timber', 'npc', { species: 'bear', fur: '#b07a4f', shirt: '#f28c28', accent: '#ffffff', hat: 'hardhat' }));
      this.addActor(new Actor('npc:shop', 'Kip', 'npc', { species: 'fox', fur: '#f08a3c', shirt: '#58b368', accent: '#ffffff', hat: 'cap' }));
    }
    this.actors.get('npc:shop')!.teleport({ key: 'post', pos: plaza.shop.clone(), face: 0, action: 'idle' });
    this.actors.get('npc:receptionist')!.teleport({ key: 'post', pos: plaza.receptionist.clone(), face: 0, action: 'idle' });
    this.actors.get('npc:architect')!.teleport({ key: 'post', pos: plaza.architect.clone(), face: 0.3, action: 'think' });

    // Anyone mid-walk gets placed where they were heading; the next plan fixes the rest.
    for (const a of this.actors.values()) {
      if (a.kind === 'mercenary' || a.kind === 'gnome') a.path = [];
    }
    this.lastPlan = 0;
  }

  /** Claude Code sessions running in a terminal show up as visitors hanging around their lot. */
  setVisitors(list: VisitorInfo[]) {
    if (!this.world) return;
    const live = new Set(list.map((v) => `visitor:${v.sessionId}`));
    for (const [id, a] of this.actors) if (a.kind === 'visitor' && !live.has(id)) this.removeActor(id);
    const perBuilding = new Map<string, number>();
    for (const v of list) {
      const b = this.building(v.buildingId);
      if (!b) continue;
      const id = `visitor:${v.sessionId}`;
      const i = perBuilding.get(b.id) ?? 0;
      perBuilding.set(b.id, i + 1);
      const f = frameOf(this.occ, this.world, b);
      const spot = VISITOR_SPOTS[i % VISITOR_SPOTS.length];
      const goal: Goal = { key: `visit:${b.id}:${i}:${f.cx},${f.cz}`, pos: frameToWorld(f, spot.x, spot.z), face: frameFace(f, -0.4), action: 'think' };
      let a = this.actors.get(id);
      if (!a) {
        const seed = hashStr(v.sessionId);
        a = new Actor(id, TRAVELLER_NAMES[seed % TRAVELLER_NAMES.length], 'visitor', {
          species: TRAVELLER_SPECIES[(seed >> 3) % TRAVELLER_SPECIES.length],
          fur: TRAVELLER_FUR[(seed >> 5) % TRAVELLER_FUR.length],
          shirt: ['#5b8fd9', '#58b368', '#e0645c', '#9b6fd1', '#f2a516'][(seed >> 7) % 5],
          accent: '#ffffff',
          hat: 'straw',
        });
        this.addActor(a);
        a.teleport(goal);
        a.char.setEmote('note', 0);
        this.effects.poof(a.pos);
      } else if (a.goal?.key !== goal.key) a.teleport(goal);
      a.visitor = v;
      a.building = b;
    }
  }

  setSessions(list: SessionSummary[]) {
    this.sessions = new Map(list.map((s) => [s.id, s]));
    this.lastPlan = 0;
  }

  upsertSession(s: SessionSummary) {
    this.sessions.set(s.id, s);
    this.lastPlan = 0;
  }

  removeSession(id: string) {
    this.sessions.delete(id);
    this.lastPlan = 0;
  }

  sessionOf(actor: Actor): SessionSummary | undefined {
    if (actor.kind === 'mercenary') return actor.sessionId ? this.sessions.get(actor.sessionId) : undefined;
    if (actor.kind !== 'resident') return undefined;
    let best: SessionSummary | undefined;
    for (const s of this.sessions.values()) {
      if (s.characterId !== actor.id || s.status === 'closed') continue;
      if (!best || s.startedAt > best.startedAt) best = s;
    }
    return best;
  }

  actorForSession(s: SessionSummary): Actor | undefined {
    return this.actors.get(s.mercenary ? `merc:${s.id}` : s.characterId);
  }

  private addActor(a: Actor) {
    this.actors.set(a.id, a);
    this.group.add(a.char.root);
  }

  private removeActor(id: string, poof = true) {
    const a = this.actors.get(id);
    if (!a) return;
    if (poof) this.effects.poof(a.pos, 10, '#ffffff', a.kind === 'gnome' ? 0.6 : 1);
    this.group.remove(a.char.root);
    this.actors.delete(id);
  }

  private building(id: string): Building | undefined {
    for (const p of this.world.properties) for (const b of p.buildings) if (b.id === id) return b;
    return undefined;
  }

  private seatGoal(a: Actor): Goal {
    const b = a.building!;
    const f = frameOf(this.occ, this.world, b);
    const spots = lotSpots(b.role);
    const seat = spots.seats[a.resident!.seat] ?? spots.seats[0];
    return { key: 'seat', pos: frameToWorld(f, seat.x, seat.z), face: frameFace(f, seat.face), action: 'sit', seatY: SEAT_Y[a.resident!.seat] ?? 0.2 };
  }

  /** Re-plans where everyone should be. Cheap enough to run a few times a second. */
  private plan(t: number) {
    const plaza = plazaLayout(this.world);
    const work = new Map<string, Actor[]>();
    const attention = new Map<string, Actor[]>();
    const push = (m: Map<string, Actor[]>, k: string, a: Actor) => {
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    };

    // Hired hands appear at the office door.
    for (const s of this.sessions.values()) {
      if (!s.mercenary || s.status === 'closed') continue;
      const id = `merc:${s.id}`;
      if (this.actors.has(id)) continue;
      const a = new Actor(id, s.mercenary.name, 'mercenary', s.mercenary.look);
      a.sessionId = s.id;
      a.speed = 3.8;
      this.addActor(a);
      a.teleport({ key: 'spawn', pos: plaza.officeDoor.clone(), face: 0, action: 'idle' });
      this.effects.poof(a.pos);
    }

    // Villagers.
    const states = new Map<Actor, { type: string; s?: SessionSummary }>();
    for (const a of this.actors.values()) {
      if (a.kind !== 'resident' && a.kind !== 'mercenary') continue;
      const s = this.sessionOf(a);
      if (a.kind === 'mercenary') a.building = s ? this.building(s.buildingId) : a.building;
      let type: string;
      if (!s || s.status === 'closed') type = a.kind === 'mercenary' ? 'leave' : 'seat';
      else if (s.status === 'starting' || s.status === 'working') type = 'work';
      else if (s.status === 'waiting' || s.unread) type = 'attention';
      else type = 'wander';
      states.set(a, { type, s });
      if (a.building && type === 'work') push(work, a.building.id, a);
      if (a.building && type === 'attention') push(attention, a.building.id, a);
    }
    for (const m of [work, attention]) for (const arr of m.values()) arr.sort((x, y) => x.id.localeCompare(y.id));

    for (const [a, { type, s }] of states) {
      if (a.talking || a.now < a.lingerUntil) {
        // Standing next to the player: don't wander off yet, just look busy.
        a.lingerAction = type === 'work' ? 'think' : type === 'attention' ? 'wave' : 'idle';
        if (!a.talking) {
          const m = s?.activity?.mode;
          a.char.setEmote(type === 'work' ? (m === 'read' ? 'read' : m === 'write' ? 'write' : 'think')
            : type === 'attention' ? (s?.status === 'waiting' ? 'question' : s?.status === 'error' ? 'error' : 'alert') : null, t);
        }
        continue;
      }
      const b = a.building;
      if (!b) {
        if (a.kind === 'mercenary') this.removeActor(a.id);
        continue;
      }
      const f = frameOf(this.occ, this.world, b);
      const spots = lotSpots(b.role);
      let goal: Goal;
      let emote: Emote | null = null;
      if (type === 'seat') {
        goal = this.seatGoal(a);
      } else if (type === 'leave') {
        goal = {
          key: 'leave', pos: plaza.officeDoor.clone(), face: Math.PI, action: 'wave',
          onArrive: () => this.removeActor(a.id),
        };
      } else if (type === 'work') {
        const i = work.get(b.id)!.indexOf(a);
        const spot = spots.work[i % spots.work.length];
        const action: Action = Math.floor((t + hashStr(a.id) % 40) / 25) % 3 === 2 ? 'water' : 'hoe';
        goal = { key: `work:${i}:${action}`, pos: frameToWorld(f, spot.x, spot.z), face: frameFace(f, spot.face), action };
        const mode = s?.activity?.mode;
        emote = mode === 'read' ? 'read' : mode === 'write' ? 'write' : 'think';
      } else if (type === 'attention') {
        const i = attention.get(b.id)!.indexOf(a);
        const spot = attentionSpot(spots, i);
        goal = { key: `attn:${i}`, pos: frameToWorld(f, spot.x, spot.z), face: frameFace(f, spot.face), action: s?.status === 'error' ? 'sad' : 'wave' };
        emote = s?.status === 'waiting' ? 'question' : s?.status === 'error' ? 'error' : 'alert';
      } else {
        // Stroll around the front yard while the session stays open.
        if (a.goal?.key.startsWith('wander') && (!a.arrived || t < a.idleUntil)) {
          goal = a.goal;
        } else {
          const w = spots.wander;
          const p = frameToWorld(f, w.minX + Math.random() * (w.maxX - w.minX), w.minZ + Math.random() * (w.maxZ - w.minZ));
          a.idleUntil = Infinity;
          goal = {
            key: `wander:${t.toFixed(2)}`, pos: p, face: Math.random() * 1.2 - 0.6,
            action: Math.random() < 0.25 ? 'think' : 'idle',
            onArrive: () => (a.idleUntil = a.now + 3 + Math.random() * 5),
          };
        }
        emote = Math.sin(t * 0.4 + hashStr(a.id)) > 0.85 ? 'note' : null;
      }
      if (a.goal?.key !== goal.key) {
        a.speed = type === 'attention' ? 4.8 : a.kind === 'mercenary' ? 3.8 : 3.4;
        a.goTo(goal, this.occ);
      } else if (a.goal !== goal && a.goal) {
        a.goal.action = goal.action;
      }
      if (!a.talking) a.char.setEmote(a.path.length && type !== 'attention' ? null : emote, t);
    }

    this.planGnomes(t, work);
  }

  private planGnomes(t: number, work: Map<string, Actor[]>) {
    const live = new Set<string>();
    const readers = new Map<string, number>();
    const workers = new Map<string, number>();
    for (const s of this.sessions.values()) {
      for (const agent of s.agents) {
        const id = `gnome:${s.id}:${agent.id}`;
        live.add(id);
        let g = this.actors.get(id);
        if (!g) {
          if (agent.status !== 'running') continue;
          const owner = this.actorForSession(s);
          g = new Actor(id, agent.subagentType ? `${agent.subagentType} gnome` : 'Gnome', 'gnome', GNOME_LOOK(hashStr(agent.id)), 0.55);
          g.sessionId = s.id;
          this.addActor(g);
          const at = owner ? owner.pos.clone().add(new THREE.Vector3(Math.random() - 0.5, 0, 0.8)) : plazaLayout(this.world).officeDoor.clone();
          g.teleport({ key: 'spawn', pos: at, face: 0, action: 'cheer' });
          this.effects.poof(at, 8, '#ffffff', 0.6);
        }
        g.agent = agent;
        if (agent.status !== 'running') {
          if (!g.finishingAt) {
            g.finishingAt = t;
            g.path = [];
            g.goal = { key: 'done', pos: g.pos.clone(), face: 0, action: 'cheer' };
            g.char.setEmote('heart', t);
          } else if (t - g.finishingAt > 1.6) {
            this.removeActor(id);
          }
          continue;
        }
        const b = this.building(agent.buildingId) ?? this.building(s.buildingId);
        if (!b) continue;
        const f = frameOf(this.occ, this.world, b);
        const spots = lotSpots(b.role);
        let goal: Goal;
        if (agent.mode === 'write') {
          const i = (work.get(b.id)?.length ?? 0) + (workers.get(b.id) ?? 0);
          workers.set(b.id, (workers.get(b.id) ?? 0) + 1);
          const spot = spots.work[(i + 1) % spots.work.length];
          goal = { key: `g-work:${b.id}:${i}`, pos: frameToWorld(f, spot.x + 0.5, spot.z + 0.3), face: frameFace(f, spot.face), action: 'hammer' };
        } else {
          const i = readers.get(b.id) ?? 0;
          readers.set(b.id, i + 1);
          const spot = spots.read[i % spots.read.length];
          const ring = Math.floor(i / spots.read.length) * 0.7;
          goal = { key: `g-read:${b.id}:${i}`, pos: frameToWorld(f, spot.x + ring, spot.z + ring), face: frameFace(f, spot.face), action: 'read' };
        }
        if (g.goal?.key !== goal.key) {
          g.speed = 5.5;
          const far = g.pos.distanceTo(goal.pos) > 3.5 * PITCH;
          if (far) {
            // Long trips: vanish and pop up at the destination's gate.
            this.effects.poof(g.pos, 8, '#ffffff', 0.6);
            const gate = frameToWorld(f, 0, PITCH / 2);
            g.teleport({ ...goal, pos: gate });
            this.effects.poof(gate, 8, '#ffffff', 0.6);
          }
          g.goTo(goal, this.occ);
        }
        if (!g.path.length) g.char.setEmote(agent.mode === 'write' ? 'write' : 'read', t);
        else g.char.setEmote(null, t);
      }
    }
    for (const [id, a] of this.actors) {
      if (a.kind === 'gnome' && !live.has(id)) this.removeActor(id);
    }
  }

  update(dt: number, t: number) {
    if (!this.world) return;
    if (t - this.lastPlan > 0.35) {
      this.plan(t);
      this.lastPlan = t;
    }
    for (const a of this.actors.values()) {
      a.update(dt, t, this.camera);
      if (a.kind === 'resident' && a.goal?.key === 'seat' && a.arrived) {
        const chair = this.chairs.get(a.id);
        if (chair) {
          chair.rotation.x = Math.sin(t * 1.6 + a.voice * 3) * 0.1;
          a.char.rock = chair.rotation.x;
        }
      }
    }
  }

  /** The actor the player would talk to from `pos`, facing `facing`. */
  nearest(pos: THREE.Vector3, facing: number, maxDist = 2.8): Actor | undefined {
    let best: Actor | undefined;
    let bestScore = Infinity;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const a of this.actors.values()) {
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      const reach = a.kind === 'npc' ? maxDist + 1.2 : maxDist;
      if (d > reach) continue;
      const front = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d - front * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }
}

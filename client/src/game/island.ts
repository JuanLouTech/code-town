import * as THREE from 'three';
import type { Building, SessionSummary, WorldState } from '../../../shared/protocol.ts';
import { Ambient } from './ambient.ts';
import { buildLot, buildPlaza, buildTownSign, setClock, type Collider, type TowerClock } from './buildings.ts';
import { Effects } from './effects.ts';
import { buildCircuit, type CircuitObjects } from './circuit.ts';
import { buildFair, type FairObjects } from './fair.ts';
import { Engine, fadedMat, vertexMat, view, world as shaderWorld } from './engine.ts';
import { buildLandscape, planLandscape, type LandscapePlan } from './landscape.ts';
import { HALF, frameOf, frameToWorld, islandShape, lotAt, lotCell, occupancy, plazaLayout, type IslandShape, type Occupancy } from './layout.ts';
import { buildNature, type NatureInfo } from './nature.ts';
import { Player } from './player.ts';
import { PumpkinPatch } from './pumpkins.ts';
import type { Farm } from './props.ts';
import { buildGround, buildWater } from './terrain.ts';
import { Director } from './villagers.ts';

interface SkyKey { h: number; top: string; bottom: string; sun: string; sunI: number; hemiI: number; hemiSky: string; hemiGround: string; tint: string; night: number }
const SKY: SkyKey[] = [
  { h: 0, top: '#0f1a3a', bottom: '#223a6e', sun: '#8fb0ff', sunI: 0.55, hemiI: 1.0, hemiSky: '#5b78c9', hemiGround: '#2c4a3a', tint: '#8ea4e0', night: 1 },
  { h: 5.2, top: '#2d4a86', bottom: '#f6b9a3', sun: '#ffc1a0', sunI: 1.1, hemiI: 1.1, hemiSky: '#c3b4e8', hemiGround: '#6f8f5a', tint: '#e0c6d8', night: 0.45 },
  { h: 7.2, top: '#7fcbff', bottom: '#e6f6ff', sun: '#fff1d6', sunI: 2.2, hemiI: 1.3, hemiSky: '#dff3ff', hemiGround: '#9ccf73', tint: '#ffffff', night: 0 },
  { h: 16.8, top: '#7fcbff', bottom: '#e6f6ff', sun: '#fff1d6', sunI: 2.2, hemiI: 1.3, hemiSky: '#dff3ff', hemiGround: '#9ccf73', tint: '#ffffff', night: 0 },
  { h: 18.9, top: '#f4935f', bottom: '#ffd9a0', sun: '#ffab66', sunI: 1.8, hemiI: 1.15, hemiSky: '#ffd2b0', hemiGround: '#8fae5f', tint: '#ffe0c0', night: 0.15 },
  { h: 20.4, top: '#27366b', bottom: '#8a6aa6', sun: '#b8a4ff', sunI: 0.9, hemiI: 1.05, hemiSky: '#8a86d8', hemiGround: '#3f5a4a', tint: '#a8a4e0', night: 0.8 },
  { h: 24, top: '#0f1a3a', bottom: '#223a6e', sun: '#8fb0ff', sunI: 0.55, hemiI: 1.0, hemiSky: '#5b78c9', hemiGround: '#2c4a3a', tint: '#8ea4e0', night: 1 },
];

function skyAt(hour: number) {
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].h <= hour) i++;
  const a = SKY[i], b = SKY[i + 1];
  const f = THREE.MathUtils.clamp((hour - a.h) / (b.h - a.h), 0, 1);
  const mix = (x: string, y: string) => new THREE.Color(x).lerp(new THREE.Color(y), f);
  const num = (x: number, y: number) => x + (y - x) * f;
  return {
    top: mix(a.top, b.top), bottom: mix(a.bottom, b.bottom), sun: mix(a.sun, b.sun), tint: mix(a.tint, b.tint),
    hemiSky: mix(a.hemiSky, b.hemiSky), hemiGround: mix(a.hemiGround, b.hemiGround),
    sunI: num(a.sunI, b.sunI), hemiI: num(a.hemiI, b.hemiI), night: num(a.night, b.night),
  };
}

export class Island {
  engine: Engine;
  effects = new Effects();
  ambient = new Ambient();
  director: Director;
  player: Player;
  world?: WorldState;
  occ?: Occupancy;
  shape?: IslandShape;
  plan?: LandscapePlan;
  nature?: NatureInfo;
  fair?: FairObjects;
  circuit?: CircuitObjects;
  pumpkins = new PumpkinPatch();
  private statics = new THREE.Group();
  private water?: ReturnType<typeof buildWater>;
  private farms = new Map<string, Farm>();
  private houses: { mesh: THREE.Mesh; pos: THREE.Vector3; halfWidth: number; clock?: TowerClock }[] = [];
  mailboxes: { building: Building; pos: THREE.Vector3; flag: THREE.Object3D }[] = [];
  private openMail = new Set<string>();
  private growth: Record<string, number> = {};
  private seenTools = new Map<string, number>();
  private lastSky = -1;
  private lantern = new THREE.PointLight('#ffcf7a', 0, 16, 1.6);
  night = 0;
  hourOverride?: number;
  /** Called when crops grow, to save them. */
  onGrowth?: (growth: Record<string, number>) => void;

  constructor(container: HTMLElement) {
    this.engine = new Engine(container);
    this.player = new Player(this.engine.camera);
    this.director = new Director(this.effects, this.engine.camera);
    const scene = this.engine.scene;
    scene.add(this.statics, this.pumpkins.group, this.effects.group, this.ambient.group, this.director.group, this.player.char.root, this.lantern);
    this.engine.onTick((dt, t) => this.tick(dt, t));
  }

  start() {
    this.engine.start();
  }

  setWorld(world: WorldState) {
    const first = !this.world;
    this.world = world;
    const occ = (this.occ = occupancy(world));
    const shape = (this.shape = islandShape(occ));
    const plan = (this.plan = planLandscape(world, occ, shape));

    for (const child of [...this.statics.children]) {
      this.statics.remove(child);
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    }
    this.farms.clear();
    this.mailboxes = [];
    this.houses = [];

    const colliders: Collider[] = [];
    const ground = buildGround(world, occ, shape, plan.ponds);
    this.statics.add(ground.mesh);
    this.water = buildWater(shape);
    this.statics.add(this.water.mesh);
    this.applyView();

    const plaza = buildPlaza(world);
    this.statics.add(plaza.group);
    colliders.push(...plaza.colliders);

    const chairs = new Map<string, THREE.Object3D>();
    const chimneys = new Map<string, THREE.Vector3[]>();
    for (const p of world.properties) {
      for (let slot = 0; slot < p.cols * p.rows; slot++) {
        const b = p.buildings.find((x) => x.slot === slot);
        const c = lotCell(p, slot);
        const frame = occ.frames.get(`${c.gx},${c.gz}`)!;
        const lot = buildLot(b, p, frame);
        this.statics.add(lot.group);
        colliders.push(...lot.colliders);
        if (lot.house) this.houses.push({ ...lot.house, clock: lot.clock });
        if (!b) continue;
        if (lot.farm) this.farms.set(b.id, lot.farm);
        if (lot.mailbox) this.mailboxes.push({ building: b, ...lot.mailbox });
        chimneys.set(b.id, lot.chimneys);
        for (const ch of lot.chairs) {
          const r = b.residents.find((x) => x.seat === ch.seat);
          if (r) chairs.set(r.id, ch.pivot);
        }
      }
      if (p.kind === 'town') {
        const main = p.buildings.find((b) => b.role === 'main')!;
        const f = frameOf(occ, world, main);
        const ts = buildTownSign(p, new THREE.Vector3(f.cx, 0, f.cz));
        this.statics.add(ts.sign);
        colliders.push(...ts.colliders);
      }
    }
    this.fair = world.fair ? buildFair(world.fair) : undefined;
    this.circuit = world.circuit ? buildCircuit(world.circuit) : undefined;
    for (const x of [this.fair, this.circuit]) {
      if (!x) continue;
      this.statics.add(x.group);
      colliders.push(...x.colliders);
    }
    const landscape = buildLandscape(plan);
    this.statics.add(landscape.group);
    colliders.push(...landscape.colliders);
    const nature = (this.nature = buildNature(occ, shape, plan.clear));
    this.statics.add(nature.group);
    colliders.push(...nature.colliders);

    this.ambient.setWorld({
      chimneys, flowers: nature.flowers, fires: landscape.fires, sails: landscape.sails,
      ponds: plan.ponds, trees: nature.fruitTrees.map((t) => t.pos),
    });
    const walk = plan.walk;
    this.player.setWorld(colliders, (x, z) => shape.sdf(x, z) < -1.4 || walk.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ));
    this.director.setWorld(world, occ, chairs);
    for (const [id, farm] of this.farms) farm.setStage(this.stageFor(id));

    this.setOpenMailboxes(this.openMail);
    const L = plazaLayout(world);
    if (first || shape.sdf(this.player.pos.x, this.player.pos.z) > -1.4) this.player.place(L.spawn, Math.PI);
  }

  /** Raises the flag on every mailbox whose terminal is open. */
  setOpenMailboxes(open: Set<string>) {
    this.openMail = open;
    for (const m of this.mailboxes) m.flag.rotation.x = open.has(m.building.id) ? 0 : -Math.PI / 2;
  }

  nearestMailbox(pos: THREE.Vector3, facing: number, reach = 1.9) {
    let best: (typeof this.mailboxes)[number] | undefined;
    let bestScore = Infinity;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const m of this.mailboxes) {
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const score = d - ((dx * fx + dz * fz) / Math.max(d, 0.01)) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best ? { mailbox: best, score: bestScore } : undefined;
  }

  /** Crop growth per building (restored from the save). */
  setGrowth(growth: Record<string, number>) {
    this.growth = { ...growth };
    for (const [id, farm] of this.farms) farm.setStage(this.stageFor(id));
  }

  private stageFor(buildingId: string) {
    const g = this.growth[buildingId] ?? 0;
    return g >= 45 ? 3 : g >= 18 ? 2 : g >= 5 ? 1 : 0;
  }

  /** Crops grow with the tool calls made on each farm. */
  trackGrowth(s: SessionSummary) {
    const prev = this.seenTools.get(s.id);
    this.seenTools.set(s.id, s.toolCount);
    if (prev === undefined || s.toolCount <= prev) return;
    const delta = s.toolCount - prev;
    this.growth[s.buildingId] = (this.growth[s.buildingId] ?? 0) + delta;
    for (const a of s.agents) {
      if (a.buildingId !== s.buildingId) this.growth[a.buildingId] = (this.growth[a.buildingId] ?? 0) + 1;
    }
    this.onGrowth?.(this.growth);
    for (const id of [s.buildingId, ...s.agents.map((a) => a.buildingId)]) this.farms.get(id)?.setStage(this.stageFor(id));
  }

  private sessions = new Map<string, SessionSummary>();

  private refreshBusy() {
    const busy = new Set<string>();
    for (const s of this.sessions.values()) {
      if (s.status !== 'working' && s.status !== 'starting' && s.status !== 'waiting') continue;
      busy.add(s.buildingId);
      for (const a of s.agents) if (a.status === 'running') busy.add(a.buildingId);
    }
    this.ambient.setBusy(busy);
  }

  setSessions(list: SessionSummary[]) {
    for (const s of list) this.seenTools.set(s.id, s.toolCount);
    this.sessions = new Map(list.map((s) => [s.id, s]));
    this.refreshBusy();
    this.director.setSessions(list);
  }

  upsertSession(s: SessionSummary) {
    this.trackGrowth(s);
    this.sessions.set(s.id, s);
    this.refreshBusy();
    this.director.upsertSession(s);
  }

  removeSession(id: string) {
    this.seenTools.delete(id);
    this.sessions.delete(id);
    this.refreshBusy();
    this.director.removeSession(id);
  }

  /** Where fast travel to a building lands: on the road just outside its front gate. */
  roadSpot(b: Building): THREE.Vector3 {
    return frameToWorld(frameOf(this.occ!, this.world!, b), 0, HALF + 2);
  }

  /** The building whose lot contains (x, z), if any (vacant lots have none). */
  buildingAt(x: number, z: number): Building | undefined {
    return lotAt(this.occ!, x, z)?.building;
  }

  /**
   * Fast travel (map, villagers list). A spot inside a lot means that property, so the player
   * lands on the road in front of it; anywhere else lands on the nearest free ground.
   */
  travelTo(p: THREE.Vector3) {
    const lot = lotAt(this.occ!, p.x, p.z);
    let target = p.clone().setY(0);
    if (lot) {
      const f = this.occ!.frames.get(`${lot.gx},${lot.gz}`)!;
      target = frameToWorld(f, 0, HALF + 2);
    }
    this.jumpTo(target);
  }

  travelToBuilding(b: Building) {
    this.jumpTo(this.roadSpot(b));
  }

  private jumpTo(target: THREE.Vector3) {
    this.effects.poof(this.player.pos);
    let spot = this.player.findFree(target);
    if (this.shape!.sdf(spot.x, spot.z) > -1.4) spot = this.player.findFree(plazaLayout(this.world!).spawn);
    this.player.place(spot, Math.PI);
    this.player.autoTarget = undefined;
    this.effects.poof(this.player.pos);
  }

  /** Applies the view distance to the fog (land and sea). */
  applyView() {
    const fog = this.engine.scene.fog as THREE.Fog;
    fog.near = view.distance * 0.42;
    fog.far = view.distance;
    if (this.water) {
      this.water.uniforms.fogNear.value = fog.near;
      this.water.uniforms.fogFar.value = fog.far;
    }
  }

  /** The island's time of day (real time, unless the debug override is set). */
  clockTime() {
    if (this.hourOverride !== undefined) {
      const h = Math.floor(this.hourOverride);
      return { h, m: (this.hourOverride - h) * 60, s: 0 };
    }
    const now = new Date();
    return { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() + now.getMilliseconds() / 1000 };
  }

  private applySky(hour: number) {
    const s = skyAt(hour);
    const e = this.engine;
    e.sun.color.copy(s.sun);
    e.sun.intensity = s.sunI;
    e.hemi.intensity = s.hemiI;
    e.hemi.color.copy(s.hemiSky);
    e.hemi.groundColor.copy(s.hemiGround);
    this.night = s.night;
    shaderWorld.uNight.value = THREE.MathUtils.smoothstep(s.night, 0.25, 0.9);
    this.lantern.intensity = THREE.MathUtils.smoothstep(s.night, 0.4, 1) * 14;
    const fog = s.bottom.clone().lerp(s.top, 0.25);
    (e.scene.fog as THREE.Fog).color.copy(fog);
    if (this.water) {
      this.water.uniforms.fogColor.value.copy(fog);
      this.water.uniforms.uTint.value.copy(s.tint);
    }
    document.documentElement.style.setProperty('--sky-top', '#' + s.top.getHexString());
    document.documentElement.style.setProperty('--sky-bottom', '#' + s.bottom.getHexString());
  }

  private tick(dt: number, t: number) {
    if (!this.world) return;
    shaderWorld.uTime.value = t;
    this.player.update(dt, t);
    this.director.update(dt, t);
    this.effects.update(dt);
    this.fair?.update(dt, t);
    this.circuit?.update(dt, t);
    this.pumpkins.update(t);
    this.ambient.update(dt, t, this.player.pos, this.player.moving && this.player.running, this.night);
    if (this.water) this.water.uniforms.uTime.value = t;
    this.engine.followLight(this.player.pos);
    this.lantern.position.set(this.player.pos.x, 2.6, this.player.pos.z + 0.6);
    const time = this.clockTime();
    const hour = time.h + time.m / 60;
    if (Math.abs(hour - this.lastSky) > 0.02) {
      this.lastSky = hour;
      this.applySky(hour);
    }
    // Houses between the camera and the player turn see-through.
    const pp = this.player.pos;
    for (const h of this.houses) {
      const dz = h.pos.z - pp.z;
      const hide = dz > 2.2 && dz < 17 && Math.abs(h.pos.x - pp.x) < h.halfWidth + 2.5;
      const mat = hide ? fadedMat : vertexMat;
      if (h.mesh.material !== mat) h.mesh.material = mat;
      if (h.clock) {
        h.clock.face.visible = !hide;
        setClock(h.clock, time.h, time.m, time.s);
      }
    }
    // Villagers past the view distance are lost in the fog anyway; skip drawing them.
    const far = view.distance * view.distance;
    for (const a of this.director.actors.values()) {
      a.char.root.visible = a.pos.distanceToSquared(this.player.pos) < far;
    }
  }
}

import * as THREE from 'three';
import type { Block, Building, Property, WorldState } from '../../../shared/protocol.ts';

export const PITCH = 20;       // distance between lot centres
export const LOT = 16;         // lot interior size (the rest is road)
export const HALF = LOT / 2;
export const GATE_HALF = 1.3;  // half-width of the fence opening at the front of a lot

export interface Spot {
  x: number;
  z: number;
  face: number; // rotation.y the character should have when there
}

export function cellCenter(gx: number, gz: number) {
  return new THREE.Vector3(gx * PITCH, 0, gz * PITCH);
}

export function blockBounds(b: Block) {
  return {
    minX: (b.gx - 0.5) * PITCH, maxX: (b.gx + b.cols - 0.5) * PITCH,
    minZ: (b.gz - 0.5) * PITCH, maxZ: (b.gz + b.rows - 0.5) * PITCH,
  };
}

export function lotCell(p: Property, slot: number) {
  return { gx: p.gx + (slot % p.cols), gz: p.gz + Math.floor(slot / p.cols) };
}

export function buildingCenter(world: WorldState, b: Building) {
  const p = world.properties.find((x) => x.id === b.propertyId)!;
  const c = lotCell(p, b.slot);
  return cellCenter(c.gx, c.gz);
}

const FACE_FRONT = 0;           // looking towards +z (the camera)
const FACE_LEFT = -Math.PI / 2;
const FACE_RIGHT = Math.PI / 2;

/** Named places inside a lot, relative to the lot centre. */
export function lotSpots(role: Building['role']) {
  const main = role === 'main';
  return {
    seats: main
      ? [
          { x: 2.9, z: 0.35, face: FACE_FRONT + 0.3 },
          { x: 5.6, z: 1.3, face: FACE_FRONT - 0.2 },
          { x: -5.2, z: 0.7, face: FACE_FRONT + 0.5 },
        ]
      : [{ x: 2.05, z: 0.2, face: FACE_FRONT + 0.3 }],
    work: [
      { x: -5.9, z: 3.8, face: FACE_FRONT },
      { x: -2.9, z: 5.4, face: FACE_FRONT },
      { x: -4.4, z: 3.8, face: FACE_FRONT },
      { x: -5.9, z: 5.4, face: FACE_FRONT },
      { x: -2.9, z: 3.8, face: FACE_FRONT },
      { x: -4.4, z: 5.4, face: FACE_FRONT },
      { x: -4.4, z: 7.0, face: FACE_FRONT },
      { x: -6.2, z: 7.0, face: FACE_FRONT },
    ],
    read: [
      { x: 2.6, z: 4.4, face: FACE_RIGHT - 0.5 },
      { x: 5.4, z: 4.0, face: FACE_LEFT + 0.5 },
      { x: 3.9, z: 2.6, face: FACE_FRONT },
      { x: 4.2, z: 6.2, face: FACE_FRONT + 0.4 },
      { x: 6.4, z: 2.4, face: FACE_LEFT + 0.2 },
      { x: 1.6, z: 2.4, face: FACE_RIGHT - 0.2 },
    ],
    attention: [
      { x: 1.1, z: 6.3, face: FACE_FRONT },
      { x: 3.5, z: 5.9, face: FACE_FRONT },
      { x: -1.2, z: 6.6, face: FACE_FRONT },
    ],
    wander: { minX: -0.8, maxX: 6.8, minZ: 1.6, maxZ: 6.8 },
    sign: { x: 5.1, z: 7.25 },
    gateIn: { x: 0, z: HALF - 0.6 },
  };
}

/**
 * The i-th spot for villagers waving for attention: the front row by the gate first, then
 * extra rows further into the yard, so a crowd never stacks up on one spot.
 */
export function attentionSpot(spots: ReturnType<typeof lotSpots>, i: number): Spot {
  const row = Math.floor(i / spots.attention.length);
  const base = spots.attention[i % spots.attention.length];
  return { x: base.x + row * 0.55, z: base.z - row * 1.5, face: base.face };
}

export function toWorld(center: THREE.Vector3, s: { x: number; z: number }) {
  return new THREE.Vector3(center.x + s.x, 0, center.z + s.z);
}

// --- Plaza --------------------------------------------------------------------

export function plazaLayout(world: WorldState) {
  const b = blockBounds(world.plaza);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return {
    bounds: { minX: b.minX + 2, maxX: b.maxX - 2, minZ: b.minZ + 2, maxZ: b.maxZ - 2 },
    center: new THREE.Vector3(cx, 0, cz),
    fountain: new THREE.Vector3(cx, 0, cz - 2),
    hiring: new THREE.Vector3(cx - 16, 0, cz - 9),
    construction: new THREE.Vector3(cx + 16, 0, cz - 9),
    receptionist: new THREE.Vector3(cx - 17.2, 0, cz - 5.4),
    architect: new THREE.Vector3(cx + 14.2, 0, cz - 3.8),
    officeDoor: new THREE.Vector3(cx - 13.4, 0, cz - 5.6),
    spawn: new THREE.Vector3(cx, 0, cz + 8),
    arch: new THREE.Vector3(cx, 0, cz + 14.5),
    shop: new THREE.Vector3(cx + 8, 0, cz + 1.9),
  };
}

// --- Lot frames: each lot sits a little crooked, so the island isn't a spreadsheet ----

export interface LotFrame {
  cx: number; // cell centre
  cz: number;
  ox: number; // offset of the lot contents
  oz: number;
  angle: number;
  mirror: boolean; // farm on the right instead of the left
}

export function hashCell(gx: number, gz: number) {
  let h = Math.imul(gx * 73856093, 1) ^ Math.imul(gz * 19349663, 1) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeFrame(gx: number, gz: number, seed: number, town: boolean): LotFrame {
  const r = (shift: number) => ((seed >>> shift) % 1000) / 1000 - 0.5;
  const k = town ? 0.45 : 1;
  return {
    cx: gx * PITCH, cz: gz * PITCH,
    ox: r(3) * 1.3 * k, oz: r(11) * 0.9 * k,
    angle: r(19) * 0.11 * k,
    mirror: ((seed >>> 7) & 1) === 1,
  };
}

/** Lot-local (x, z) → world, honouring mirror, rotation and offset. */
export function frameToWorld(f: LotFrame, x: number, z: number, out = new THREE.Vector3()) {
  const mx = f.mirror ? -x : x;
  const c = Math.cos(f.angle), s = Math.sin(f.angle);
  return out.set(f.cx + f.ox + mx * c + z * s, 0, f.cz + f.oz - mx * s + z * c);
}

/** Lot-local facing (rotation.y) → world facing. */
export function frameFace(f: LotFrame, face: number) {
  return (f.mirror ? -face : face) + f.angle;
}

// --- Occupancy ------------------------------------------------------------------

export interface Occupancy {
  lots: Map<string, { property: Property; building?: Building; slot: number }>;
  frames: Map<string, LotFrame>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  blocks: { block: Block; town: boolean }[];
  /** Blocks that aren't lots but still need roads around them and no trees inside: the plaza and the fair. */
  reserved: Block[];
}

/** True if (x, z) is within `margin` of a reserved block (plaza, fair). */
export function nearReserved(occ: Occupancy, x: number, z: number, margin: number) {
  return occ.reserved.some((b) => {
    const bb = blockBounds(b);
    return x > bb.minX - margin && x < bb.maxX + margin && z > bb.minZ - margin && z < bb.maxZ + margin;
  });
}

/** True if grid cell (gx, gz) belongs to a reserved block. */
export function reservedCell(occ: Occupancy, gx: number, gz: number) {
  return occ.reserved.some((b) => gx >= b.gx && gx < b.gx + b.cols && gz >= b.gz && gz < b.gz + b.rows);
}

export function frameOf(occ: Occupancy, world: WorldState, b: Building): LotFrame {
  const p = world.properties.find((x) => x.id === b.propertyId)!;
  const c = lotCell(p, b.slot);
  return occ.frames.get(`${c.gx},${c.gz}`) ?? makeFrame(c.gx, c.gz, b.style, p.kind === 'town');
}

export function occupancy(world: WorldState): Occupancy {
  const lots = new Map<string, { property: Property; building?: Building; slot: number }>();
  const frames = new Map<string, LotFrame>();
  const blocks: { block: Block; town: boolean }[] = [{ block: world.plaza, town: false }];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const grow = (b: Block) => {
    const bb = blockBounds(b);
    minX = Math.min(minX, bb.minX); maxX = Math.max(maxX, bb.maxX);
    minZ = Math.min(minZ, bb.minZ); maxZ = Math.max(maxZ, bb.maxZ);
  };
  grow(world.plaza);
  const reserved = [world.plaza];
  for (const b of [world.fair, world.circuit]) {
    if (!b) continue;
    grow(b);
    reserved.push(b);
  }
  for (const p of world.properties) {
    grow(p);
    blocks.push({ block: p, town: p.kind === 'town' });
    for (let slot = 0; slot < p.cols * p.rows; slot++) {
      const c = lotCell(p, slot);
      const building = p.buildings.find((b) => b.slot === slot);
      lots.set(`${c.gx},${c.gz}`, { property: p, building, slot });
      frames.set(`${c.gx},${c.gz}`, makeFrame(c.gx, c.gz, building?.style ?? hashCell(c.gx, c.gz), p.kind === 'town'));
    }
  }
  return { lots, frames, blocks, reserved, bounds: { minX, maxX, minZ, maxZ } };
}

export function cellOf(x: number, z: number) {
  return { gx: Math.round(x / PITCH), gz: Math.round(z / PITCH) };
}

/** True if (x, z) lies inside a lot's fenced interior. */
export function lotAt(occ: Occupancy, x: number, z: number) {
  const c = cellOf(x, z);
  const lot = occ.lots.get(`${c.gx},${c.gz}`);
  if (!lot) return null;
  if (Math.abs(x - c.gx * PITCH) > HALF || Math.abs(z - c.gz * PITCH) > HALF) return null;
  return { ...lot, ...c };
}

// --- Island shape ---------------------------------------------------------------

export interface IslandShape {
  sdf: (x: number, z: number) => number; // < 0 on land
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function islandShape(occ: Occupancy): IslandShape {
  const m = 20;
  const b = { minX: occ.bounds.minX - m, maxX: occ.bounds.maxX + m, minZ: occ.bounds.minZ - m, maxZ: occ.bounds.maxZ + m + 6 };
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const hx = (b.maxX - b.minX) / 2;
  const hz = (b.maxZ - b.minZ) / 2;
  const r = Math.min(34, hx * 0.8, hz * 0.8);
  const sdf = (x: number, z: number) => {
    const qx = Math.abs(x - cx) - (hx - r);
    const qz = Math.abs(z - cz) - (hz - r);
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
    const inside = Math.min(Math.max(qx, qz), 0);
    const wobble = Math.sin(x * 0.07 + 1.3) * 2.6 + Math.sin(z * 0.09 + x * 0.03) * 2.2 + Math.sin((x + z) * 0.15) * 0.9;
    return outside + inside - r + wobble;
  };
  return { sdf, bounds: { minX: b.minX - 30, maxX: b.maxX + 30, minZ: b.minZ - 30, maxZ: b.maxZ + 30 } };
}

// --- Routing along the road grid ------------------------------------------------

const boundary = (v: number) => Math.round((v - PITCH / 2) / PITCH) * PITCH + PITCH / 2;

/**
 * A walkable path between two points: out through the lot gate, along the
 * roads that run between lots, and in through the destination gate.
 */
export function route(occ: Occupancy, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
  const la = lotAt(occ, from.x, from.z);
  const lb = lotAt(occ, to.x, to.z);
  if (la && lb && la.gx === lb.gx && la.gz === lb.gz) return [to.clone()];
  const pts: THREE.Vector3[] = [];
  let p: THREE.Vector3;
  const gate = (gx: number, gz: number, inside: boolean) => {
    const f = occ.frames.get(`${gx},${gz}`);
    return f ? frameToWorld(f, 0, inside ? HALF - 0.6 : HALF + 0.9) : new THREE.Vector3(gx * PITCH, 0, gz * PITCH + (inside ? HALF - 0.6 : HALF + 0.9));
  };
  if (la) {
    pts.push(gate(la.gx, la.gz, true), gate(la.gx, la.gz, false));
    const out = pts[pts.length - 1];
    p = new THREE.Vector3(out.x, 0, la.gz * PITCH + PITCH / 2);
  } else {
    p = new THREE.Vector3(from.x, 0, boundary(from.z));
  }
  pts.push(p);
  const target = lb
    ? new THREE.Vector3(gate(lb.gx, lb.gz, false).x, 0, lb.gz * PITCH + PITCH / 2)
    : new THREE.Vector3(to.x, 0, boundary(to.z));
  if (Math.abs(p.z - target.z) > 0.01) {
    const vx = boundary(target.x + (p.x < target.x ? -1 : 1));
    pts.push(new THREE.Vector3(vx, 0, p.z), new THREE.Vector3(vx, 0, target.z));
  }
  pts.push(target);
  if (lb) pts.push(gate(lb.gx, lb.gz, false), gate(lb.gx, lb.gz, true));
  pts.push(to.clone());
  // Drop consecutive duplicates.
  return pts.filter((q, i) => i === 0 || q.distanceToSquared(pts[i - 1]) > 0.01);
}

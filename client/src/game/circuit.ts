import * as THREE from 'three';
import type { Block } from '../../../shared/protocol.ts';
import type { TrackDef } from '../../../shared/tracks.ts';
import { ModelBuilder } from './builder.ts';
import { smallTree, type Collider } from './buildings.ts';
import { colorMat } from './engine.ts';
import {
  EDGE, FLAGS, PINK, RED, SKY, STONE, TEAL, WHITE, WOOD, YELLOW, CREAM,
  bunting, fenceRun, flagPole, flatGeometry, flowerPatch, lampPost, staticMesh, stripedPost, tyreStack, type V3,
} from './fair.ts';
import { blockBounds } from './layout.ts';
import { makeSign } from './props.ts';
import { HALF_WIDTH, WALL, distToTrack, planTrack, trackArea, type P2, type TrackPlan } from './trackplan.ts';

export interface FairTrack {
  /** Closed centerline, evenly spaced samples (~0.6 apart), world XZ (y = 0). */
  points: THREE.Vector3[];
  halfWidth: number;          // drivable half-width of the asphalt
  startIndex: number;         // index in points of the start/finish line
  startPos: THREE.Vector3;    // grid spot just behind the start line, on the centerline
  startHeading: number;       // rotation.y (atan2(dx, dz) convention) facing along the racing direction
}

export interface CircuitObjects {
  group: THREE.Group;
  colliders: Collider[];
  track: FairTrack;
  /** The track this circuit was built from. */
  def: TrackDef;
  /** Where the player stands at the race booth's window (track workshop). */
  booth: THREE.Vector3;
  /** The chequered pad in the paddock: drive onto it to start a time trial; karts come back here after. */
  pad: THREE.Vector3;
  /** On the road just outside the circuit's gate (fast-travel spot). */
  entrance: THREE.Vector3;
  /** True on the circuit's grass (inside its fence, off the asphalt and kerbs): karts are slow there. */
  offTrack(x: number, z: number): boolean;
  update(dt: number, t: number): void;
}

const KERB = 0.45;
/** Wall collider half-size, and the spacing of the collider chain along each wall. */
const WALL_BOX = 0.3;
const WALL_STEP = 0.5;

/** The paddock, along the south fence: the gate from the road, the start pad and the booth. */
const GATE_X = 30;
const GATE_HALF = 3;

// --- track -----------------------------------------------------------------------------

/** The nearest centerline sample to (x, z) and how far away it is. */
export function trackProgress(track: FairTrack, x: number, z: number): { index: number; dist: number } {
  let index = 0, best = Infinity;
  const pts = track.points;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return { index, dist: Math.sqrt(best) };
}

/** Asphalt, kerbs, the chequered line and the grid boxes: one flat, shadow-receiving mesh. */
function trackSurface(plan: TrackPlan, startIndex: number, gridIndices: number[]) {
  const { pts, left, tan } = plan;
  const n = pts.length;
  const strip = (o0: number, o1: number, y: number, pick: (i: number) => boolean) => {
    const tris: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!pick(i)) continue;
      const j = (i + 1) % n;
      const at = (k: number, o: number) => [pts[k].x + left[k].x * o, y, pts[k].z + left[k].z * o];
      const a0 = at(i, o0), a1 = at(i, o1), b0 = at(j, o0), b1 = at(j, o1);
      tris.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0);
    }
    return flatGeometry(tris);
  };
  const mb = new ModelBuilder();
  mb.add(strip(-HALF_WIDTH - 0.02, HALF_WIDTH + 0.02, 0.025, () => true), '#5c5f66');
  // Dashed centre line on the straights.
  mb.add(strip(-0.08, 0.08, 0.032, (i) => i % 6 < 3 && Math.abs(tan[i].x * tan[(i + 5) % n].z - tan[i].z * tan[(i + 5) % n].x) < 0.01), '#e9e6dc');
  for (const side of [-1, 1]) {
    const o0 = side * HALF_WIDTH, o1 = side * (HALF_WIDTH + KERB);
    mb.add(strip(o0, o1, 0.04, (i) => Math.floor(i / 2) % 2 === 0), RED);
    mb.add(strip(o0, o1, 0.04, (i) => Math.floor(i / 2) % 2 === 1), WHITE);
  }
  const frame = (i: number) => {
    const p = pts[i], l = left[i], t = tan[i];
    return { rotY: Math.atan2(t.x, t.z), at: (across: number, along: number, y = 0.036): V3 => [p.x + l.x * across + t.x * along, y, p.z + l.z * across + t.z * along] };
  };
  // Chequered start/finish line: two rows of squares across the asphalt.
  {
    const f = frame(startIndex);
    const cells = 14, size = (2 * HALF_WIDTH) / cells;
    for (let r = 0; r < 2; r++) {
      for (let k = 0; k < cells; k++) {
        mb.box(size, 0.02, size, (k + r) % 2 ? '#222226' : WHITE, f.at(-HALF_WIDTH + size * (k + 0.5), (r - 0.5) * size), [0, f.rotY, 0]);
      }
    }
  }
  // Grid boxes: white brackets where karts wait (the first one on the centerline is startPos).
  gridIndices.forEach((gi, k) => {
    const f = frame(gi);
    const lat = k === 0 ? 0 : (k % 2 ? -1.6 : 1.6);
    mb.box(2.0, 0.02, 0.14, WHITE, f.at(lat, 1.1), [0, f.rotY, 0]);
    mb.box(0.14, 0.02, 1.2, WHITE, f.at(lat - 1.0, 0.55), [0, f.rotY, 0]);
    mb.box(0.14, 0.02, 1.2, WHITE, f.at(lat + 1.0, 0.55), [0, f.rotY, 0]);
  });
  return staticMesh(mb, false);
}

/** One side's barrier as a closed polyline at `WALL` from the centerline. */
function wallLine(plan: TrackPlan, side: number) {
  return plan.pts.map((p, i) => new THREE.Vector2(p.x + plan.left[i].x * side * WALL, p.z + plan.left[i].z * side * WALL));
}

/** Evenly spaced points along a closed polyline, with the local direction. */
function along(poly: THREE.Vector2[], step: number) {
  const m = poly.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + poly[i].distanceTo(poly[(i + 1) % m]));
  const total = cum[m];
  const n = Math.max(1, Math.round(total / step));
  const out: { x: number; z: number }[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * total) / n;
    while (cum[seg + 1] < s) seg++;
    const a = poly[seg], b = poly[(seg + 1) % m];
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    out.push({ x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Is (x, z) inside the closed centerline? */
function insideTrack(pts: P2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** A tiny deterministic hash, so decorations land in the same places every time a track is built. */
function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// --- grandstand ------------------------------------------------------------------------

function grandstand(mb: ModelBuilder, x0: number, x1: number, back: number, front: number, seed: number) {
  const gx = (x0 + x1) / 2, w = x1 - x0;
  const tiers = 3, depth = (front - back - 0.4) / tiers;
  mb.box(w, 4.0, 0.3, CREAM, [gx, 2.0, back + 0.15]);
  const seatCols = [PINK, YELLOW, TEAL, SKY];
  const fans = ['#ff8c69', '#7ec4ff', '#95e1a4', '#c3a6ff', '#ffd94a', '#ff7eb6'];
  const skin = ['#f6d2b5', '#e0b48f', '#c68d63', '#f1c9a5'];
  const seats = Math.round(w - 1);
  for (let k = 0; k < tiers; k++) {
    const h = 0.45 * (k + 1);
    const cz = front - depth * (k + 0.5);
    mb.box(w, h, depth, STONE, [gx, h / 2, cz]);
    mb.box(w, 0.06, 0.1, WHITE, [gx, h + 0.03, cz + depth / 2 - 0.05]);
    for (let i = 0; i < seats; i++) {
      const sx = x0 + 0.5 + i * ((w - 1) / (seats - 1));
      const col = seatCols[(i + k) % seatCols.length];
      mb.box(0.8, 0.2, 0.55, col, [sx, h + 0.1, cz + 0.1]);
      mb.box(0.8, 0.4, 0.08, col, [sx, h + 0.4, cz - 0.2]);
      if ((i * 5 + k * 3 + seed) % 4 === 1) {
        mb.sphere(0.28, fans[(i + k * 2) % fans.length], [sx, h + 0.5, cz + 0.05], [1, 1.15, 0.9], 1);
        mb.sphere(0.22, skin[(i + k) % skin.length], [sx, h + 0.95, cz + 0.05], 1, 1);
      }
    }
  }
  // Tilted, striped roof on posts, flags along the top.
  const roofBack = 4.2, roofFront = 3.4, rd = front - back + 0.4;
  const tilt = Math.atan2(roofBack - roofFront, rd);
  const stripes = Math.max(4, Math.round(w / 1.6));
  for (let i = 0; i < stripes; i++) {
    mb.box(w / stripes + 0.02, 0.12, rd / Math.cos(tilt), i % 2 ? WHITE : PINK, [x0 + (i + 0.5) * (w / stripes), (roofBack + roofFront) / 2, (back + front) / 2 + 0.2], [tilt, 0, 0]);
  }
  const posts = Math.max(2, Math.round(w / 6) + 1);
  for (let i = 0; i < posts; i++) mb.cyl(0.1, 0.1, roofFront, WHITE, [x0 + 0.2 + i * ((w - 0.4) / (posts - 1)), roofFront / 2, front + 0.2], undefined, 8);
  const flags = Math.max(2, Math.round(w / 4));
  for (let i = 0; i < flags; i++) flagPole(mb, x0 + 0.6 + i * ((w - 1.2) / (flags - 1)), roofBack, back, 1.3, FLAGS[(i + seed) % FLAGS.length], WHITE);
}

// --- the circuit -----------------------------------------------------------------------

/**
 * The kart circuit: a track (from a saved TrackDef) with red/white barrier walls on both sides,
 * a start gantry, grandstands along the north and a paddock along the south (gate, start pad,
 * time-trial booth). Built block-local; the group sits at the block's north-west corner.
 */
export function buildCircuit(block: Block, def: TrackDef): CircuitObjects {
  const bb = blockBounds(block);
  const ox = bb.minX, oz = bb.minZ;
  const W = bb.maxX - bb.minX, D = bb.maxZ - bb.minZ;
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  const colliders: Collider[] = [];
  const collide = (x: number, z: number, hw: number, hd: number) => colliders.push({ x: ox + x, z: oz + z, hw, hd });
  const mb = new ModelBuilder();

  // --- Track -------------------------------------------------------------------------
  const plan = planTrack(def.corners);
  const n = plan.pts.length;
  const step = plan.length / n;
  const startIndex = plan.startIndex;
  const behind = (d: number) => (startIndex - Math.round(d / step) + n) % n;
  const gridIndices = [behind(3), behind(6), behind(9), behind(12)];
  group.add(trackSurface(plan, startIndex, gridIndices));
  const st = plan.tan[startIndex];
  const track: FairTrack = {
    points: plan.pts.map((p) => new THREE.Vector3(ox + p.x, 0, oz + p.z)),
    halfWidth: HALF_WIDTH,
    startIndex,
    startPos: new THREE.Vector3(ox + plan.pts[gridIndices[0]].x, 0, oz + plan.pts[gridIndices[0]].z),
    startHeading: Math.atan2(st.x, st.z),
  };

  // --- Barrier walls on both sides (closed: karts are put on the grid for a race) -------
  for (const side of [-1, 1]) {
    const line = wallLine(plan, side);
    // Colliders: a tight chain of small boxes, so nothing slips between them.
    for (const p of along(line, WALL_STEP)) collide(p.x, p.z, WALL_BOX, WALL_BOX);
    // Looks: low concrete blocks in alternating red and white, with a white cap stripe.
    const pts = along(line, 1.2);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.05) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const rotY = Math.atan2(b.x - a.x, b.z - a.z);
      mb.box(0.5, 0.55, len + 0.03, k % 2 ? WHITE : RED, [mx, 0.275, mz], [0, rotY, 0]);
      mb.box(0.54, 0.06, len + 0.03, k % 2 ? '#e6e1d6' : WHITE, [mx, 0.58, mz], [0, rotY, 0]);
    }
  }

  // --- Start gantry with lights over the line ------------------------------------------
  const lightOn: THREE.Mesh[] = [];
  const gantryLegs: V3[] = [];
  {
    const p = plan.pts[startIndex], l = plan.left[startIndex], t = plan.tan[startIndex];
    const reach = WALL + 1.0, top = 4.8;
    for (const s of [-1, 1]) gantryLegs.push([p.x + l.x * s * reach, 0, p.z + l.z * s * reach]);
    for (const [x, , z] of gantryLegs) {
      mb.box(0.5, 0.3, 0.5, STONE, [x, 0.15, z]);
      stripedPost(mb, x, z, top, 0.16, WHITE, RED, 0.6);
      collide(x, z, 0.3, 0.3);
    }
    const rotY = Math.atan2(l.x, l.z);
    const span = reach * 2 + 0.4;
    mb.box(0.35, 0.35, span, '#e9e6dc', [p.x, top, p.z], [0, rotY, 0]);
    mb.box(0.3, 0.3, span, '#e9e6dc', [p.x, top + 0.8, p.z], [0, rotY, 0]);
    for (let i = 0; i <= 10; i++) {
      const s = -reach + (i / 10) * 2 * reach;
      const x = p.x + l.x * s, z = p.z + l.z * s;
      mb.box(0.08, 0.8, 0.08, '#b8b3a8', [x, top + 0.4, z]);
    }
    // Light box, facing oncoming karts and the camera.
    mb.box(0.5, 0.6, 3.2, '#2b2d31', [p.x - t.x * 0.1, top + 0.4, p.z - t.z * 0.1], [0, rotY, 0]);
    // Banner on top of the gantry, facing oncoming karts.
    const banner = makeSign('START · FINISH', { posts: 0, width: 4.2, height: 0.7, bg: '#ffffff' });
    banner.position.set(p.x - t.x * 0.2, top + 1.3 - 1.35, p.z - t.z * 0.2);
    banner.rotation.y = Math.atan2(-t.x, -t.z);
    group.add(banner);
    const onMat = colorMat('#ff3b3b', { emissive: 1.2 });
    for (let i = 0; i < 5; i++) {
      const s = -1.2 + i * 0.6;
      const x = p.x + l.x * s - t.x * 0.37, z = p.z + l.z * s - t.z * 0.37;
      const off = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), colorMat('#5a1f1f'));
      off.position.set(x, top + 0.4, z);
      group.add(off);
      const on = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), onMat);
      on.position.copy(off.position);
      on.visible = false;
      group.add(on);
      lightOn.push(on);
    }
  }

  // --- Perimeter fence with a gate in the south side -------------------------------------
  const eMin = EDGE, eMaxX = W - EDGE, eMaxZ = D - EDGE;
  const gateL = GATE_X - GATE_HALF - 0.3, gateR = GATE_X + GATE_HALF + 0.3;
  for (const [x0, z0, x1, z1] of [[eMin, eMin, eMaxX, eMin], [eMin, eMin, eMin, eMaxZ], [eMaxX, eMin, eMaxX, eMaxZ], [eMin, eMaxZ, gateL, eMaxZ], [gateR, eMaxZ, eMaxX, eMaxZ]] as const) {
    const c = fenceRun(mb, x0, z0, x1, z1);
    collide(c.x, c.z, c.hw, c.hd);
  }
  for (const x of [gateL, gateR]) {
    // Chequered gate posts.
    for (let i = 0; i < 6; i++) mb.box(0.4, 0.45, 0.4, i % 2 ? '#222226' : WHITE, [x, 0.225 + i * 0.45, eMaxZ]);
    mb.with({ glow: 1 }, () => mb.sphere(0.25, YELLOW, [x, 2.95, eMaxZ], 1, 1));
    collide(x, eMaxZ, 0.35, 0.35);
  }
  bunting(mb, [gateL, 2.8, eMaxZ], [gateR, 2.8, eMaxZ], 0.35, 2);

  // --- Grandstands along the north, clear of the gantry ----------------------------------
  const grandstands: [number, number][] = [];
  for (let x0 = 14; x0 + 16 <= W - 14; x0 += 30) {
    const x1 = x0 + 18;
    if (gantryLegs.some(([gx, , gz]) => gz < 12 && gx > x0 - 1.5 && gx < x1 + 1.5)) continue;
    grandstands.push([x0, Math.min(x1, W - 14)]);
  }
  grandstands.forEach(([x0, x1], i) => {
    const back = eMin + 0.7, front = eMin + 5.3;
    grandstand(mb, x0, x1, back, front, i);
    collide((x0 + x1) / 2, (back + front) / 2 + 0.1, (x1 - x0) / 2 + 0.1, (front - back) / 2 + 0.3);
  });

  // Lamp posts with flags along the fence.
  const lamps: [number, number][] = [];
  for (let x = 8; x < W - 4; x += 12) lamps.push([x, eMaxZ], [x + 4, eMin]);
  for (let z = 14; z < D - 8; z += 14) lamps.push([eMin, z], [eMaxX, z]);
  lamps.forEach(([x, z], i) => {
    if (Math.abs(x - GATE_X) < GATE_HALF + 1.5 && z === eMaxZ) return;
    if (z === eMin && grandstands.some(([a, b]) => x > a - 1 && x < b + 1)) return;
    if (gantryLegs.some(([gx, , gz]) => Math.hypot(gx - x, gz - z) < 1.5)) return;
    lampPost(mb, x, z, 3.2, FLAGS[i % FLAGS.length]);
    collide(x, z, 0.2, 0.2);
  });

  // --- Paddock: start pad inside the gate, and the race booth -----------------------------
  const pad = { x: GATE_X, z: D - 5.6 };
  const BOOTH = { x: GATE_X + 7.5, z: D - 4.8 };
  {
    // Chequered pad where karts line up for a time trial.
    const cells = 6, size = 0.8;
    for (let i = 0; i < cells; i++) {
      for (let k = 0; k < cells; k++) {
        mb.box(size, 0.02, size, (i + k) % 2 ? '#222226' : WHITE, [pad.x + (i - (cells - 1) / 2) * size, 0.03, pad.z + (k - (cells - 1) / 2) * size]);
      }
    }
    for (const s of [-1, 1]) {
      const x = pad.x + s * 4.2, z = pad.z - 1.6;
      flagPole(mb, x, 0, z, 2.4, '#222226', WHITE);
      collide(x, z, 0.15, 0.15);
    }
    const padSign = makeSign('🏁 Start line', { sub: 'drive on to race', posts: 2, width: 2.4, height: 0.8, bg: '#fff9e8' });
    padSign.position.set(pad.x - 4.6, 0, pad.z + 1.4);
    padSign.scale.setScalar(0.8);
    group.add(padSign);
    for (const s of [-1, 1]) collide(pad.x - 4.6 + s * 0.85, pad.z + 1.2, 0.2, 0.2);

    const { x: rx, z: rz } = BOOTH;
    mb.box(3.2, 0.2, 2.2, STONE, [rx, 0.1, rz]);
    mb.box(2.8, 1.9, 1.8, CREAM, [rx, 1.15, rz]);
    // Window and counter facing the pad (west).
    mb.with({ glow: 1 }, () => mb.box(0.06, 0.7, 1.2, '#bfe6ff', [rx - 1.41, 1.5, rz]));
    mb.box(0.45, 0.1, 1.5, WOOD, [rx - 1.6, 1.05, rz]);
    mb.box(3.1, 0.18, 2.1, TEAL, [rx, 2.19, rz]);
    for (let i = 0; i < 15; i++) {
      for (let r = 0; r < 2; r++) mb.box(0.2, 0.1, 0.02, (i + r) % 2 ? '#222226' : WHITE, [rx - 1.4 + i * 0.2, 2.14 + r * 0.1, rz + 1.06]);
    }
    flagPole(mb, rx + 1.3, 2.28, rz - 0.8, 1.6, '#222226', WHITE);
    collide(rx, rz, 1.6, 1.1);
    const sign = makeSign(`🏁 ${def.name}`, { sub: 'time trials · track workshop', posts: 0, width: 2.8, height: 0.95, bg: '#fff9e8' });
    sign.position.set(rx, 2.85 - 1.35, rz + 0.75);
    group.add(sign);
    // A board by the gate, outside, facing the camera.
    const board = makeSign('Kart Circuit', { sub: def.name, posts: 2, width: 3.0, height: 0.9, bg: '#fff6dc' });
    const bx = GATE_X - GATE_HALF - 3.2;
    board.position.set(bx, 0, eMaxZ - 1.0);
    board.scale.setScalar(0.85);
    group.add(board);
    for (const s of [-1, 1]) collide(bx + s * 1.07, eMaxZ - 1.2, 0.2, 0.2);
  }

  // --- Infield and trackside decorations, wherever there's room -------------------------
  {
    const area = trackArea(W, D);
    const clear = (x: number, z: number, r: number) => distToTrack(plan.pts, x, z) >= WALL + WALL_BOX + r;
    const spots: { x: number; z: number; h: number; d: number; inside: boolean }[] = [];
    for (let z = area.minZ - 3; z <= area.maxZ + 3; z += 5.5) {
      for (let x = area.minX - 3; x <= area.maxX + 3; x += 5.5) {
        const h = hash2(x, z);
        const jx = x + (h - 0.5) * 2.5, jz = z + (hash2(z, x) - 0.5) * 2.5;
        if (jx < EDGE + 2 || jx > W - EDGE - 2 || jz < eMin + 7 || jz > D - 10) continue;
        const d = distToTrack(plan.pts, jx, jz);
        if (d < WALL + WALL_BOX + 1.6) continue;
        spots.push({ x: jx, z: jz, h, d, inside: insideTrack(plan.pts, jx, jz) });
      }
    }
    // A giant trophy in the roomiest bit of infield.
    const trophy = spots.filter((s) => s.inside).sort((a, b) => b.d - a.d)[0];
    if (trophy) {
      const { x: tx, z: tz } = trophy;
      mb.box(1.6, 0.7, 1.6, STONE, [tx, 0.35, tz]);
      mb.box(1.7, 0.1, 1.7, WHITE, [tx, 0.72, tz]);
      mb.cyl(0.22, 0.36, 0.6, '#f2c94c', [tx, 1.07, tz], undefined, 10);
      mb.cyl(0.7, 0.25, 1.0, '#f2c94c', [tx, 1.87, tz], undefined, 12);
      mb.add(new THREE.TorusGeometry(0.34, 0.07, 6, 12), '#f2c94c', [tx - 0.7, 1.95, tz]);
      mb.add(new THREE.TorusGeometry(0.34, 0.07, 6, 12), '#f2c94c', [tx + 0.7, 1.95, tz]);
      mb.sphere(0.17, PINK, [tx, 2.45, tz], 1, 0);
      collide(tx, tz, 0.9, 0.9);
    }
    let stacks = 0, trees = 0, flowers = 0;
    for (const s of spots) {
      if (s === trophy || Math.hypot(s.x - (trophy?.x ?? -99), s.z - (trophy?.z ?? -99)) < 3) continue;
      if (s.h < 0.16 && stacks < 16 && s.d < WALL + 4 && clear(s.x, s.z, 1.2)) {
        // Tyre stacks guard the outside of the walls.
        tyreStack(mb, s.x, s.z, 3, stacks % 2 ? RED : WHITE);
        tyreStack(mb, s.x + 0.95, s.z + 0.3, 2, stacks % 2 ? WHITE : RED);
        collide(s.x + 0.45, s.z + 0.15, 0.95, 0.65);
        stacks++;
      } else if (s.h > 0.55 && s.h < 0.75 && trees < 26 && clear(s.x, s.z, 1.4)) {
        smallTree(mb, s.x, s.z, 0.9 + s.h * 0.3, undefined);
        collide(s.x, s.z, 0.4, 0.4);
        trees++;
      } else if (s.h > 0.88 && flowers < 12 && clear(s.x, s.z, 1.3)) {
        flowerPatch(mb, s.x, s.z, 2.0, 1.1, Math.round(s.x * 7 + s.z));
        flowers++;
      }
    }
  }

  group.add(staticMesh(mb));

  // Asphalt map for offTrack: half-unit cells within the asphalt and kerbs of the centerline.
  const CELL = 0.5;
  const cols = Math.ceil(W / CELL), rows = Math.ceil(D / CELL);
  const paved = new Uint8Array(cols * rows);
  {
    const reach = HALF_WIDTH + KERB + 0.3;
    const rc = Math.ceil(reach / CELL);
    for (const p of plan.pts) {
      const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
      for (let dz = -rc; dz <= rc; dz++) {
        for (let dx = -rc; dx <= rc; dx++) {
          const gx = cx + dx, gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) continue;
          if (Math.hypot((gx + 0.5) * CELL - p.x, (gz + 0.5) * CELL - p.z) <= reach) paved[gz * cols + gx] = 1;
        }
      }
    }
  }
  const pad0 = { x: pad.x - 3, z: pad.z - 3 };

  const world = (x: number, z: number) => new THREE.Vector3(ox + x, 0, oz + z);
  return {
    group,
    colliders,
    track,
    def,
    booth: world(BOOTH.x - 2.4, BOOTH.z),
    pad: world(pad.x, pad.z),
    entrance: world(GATE_X, D - 1),
    offTrack(x: number, z: number) {
      const lx = x - ox, lz = z - oz;
      if (lx < EDGE || lz < EDGE || lx > W - EDGE || lz > D - EDGE) return false;
      if (lx > pad0.x && lx < pad0.x + 6 && lz > pad0.z && lz < pad0.z + 6) return false; // the start pad
      return !paved[Math.floor(lz / CELL) * cols + Math.floor(lx / CELL)];
    },
    update(_dt: number, t: number) {
      // Idle start-light sequence: five reds come on one by one, hold, then all go out.
      const phase = t % 7;
      const lit = phase < 5 ? Math.floor(phase) + 1 : phase < 6 ? 5 : 0;
      lightOn.forEach((m, i) => (m.visible = i < lit));
    },
  };
}

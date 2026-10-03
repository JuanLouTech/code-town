import * as THREE from 'three';
import type { Block } from '../../../shared/protocol.ts';
import { ModelBuilder } from './builder.ts';
import { smallTree, type Collider } from './buildings.ts';
import { colorMat } from './engine.ts';
import {
  EDGE, FLAGS, PINK, RED, SKY, STONE, TEAL, WHITE, WOOD, YELLOW, CREAM,
  bunting, fenceRun, flagPole, flatGeometry, flowerPatch, lampPost, staticMesh, stripedPost, tyreStack, type V3,
} from './fair.ts';
import { blockBounds } from './layout.ts';
import { makeSign } from './props.ts';

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
  /** Where the player stands at the race booth / start sign (reachable on foot from the entrance). */
  booth: THREE.Vector3;
  /** On the road just outside the circuit's opening (fast-travel spot). */
  entrance: THREE.Vector3;
  update(dt: number, t: number): void;
}

const HALF_WIDTH = 3.5;
const KERB = 0.45;
/** Distance from the centerline to the middle of the barrier walls. */
const WALL = 4.25;
/** Wall collider half-size, and the spacing of the collider chain along each wall. */
const WALL_BOX = 0.3;
const WALL_STEP = 0.5;
const SAMPLE = 0.6;

/**
 * The circuit as a polygon whose corners are rounded with the given radii
 * (block-local x, z from the block's north-west corner; designed for a 5×3
 * block, 100×60). Racing direction: east along the south straight, a
 * sweeping S up the east side, two deep hairpin dives from the north, and a
 * chicane down the west side.
 */
const CORNERS: [number, number, number][] = [
  [9, 48, 8],       // south-west
  [91, 48, 8],      // south-east
  [91, 34.5, 6],    // east S
  [84, 28, 5.5],
  [91, 22, 6],
  [91, 13, 6],      // north-east
  [73, 13, 5.5],    // dive 2
  [73, 37.5, 6.5],
  [60, 37.5, 6.5],
  [60, 13, 5.5],
  [47, 13, 5.5],    // dive 1
  [47, 37.5, 6.5],
  [34, 37.5, 6.5],
  [34, 13, 5.5],
  [9, 13, 7],       // north-west
  [9, 23.5, 5],     // west chicane
  [16.5, 30, 5],
  [9, 36.5, 5],
];

const START_X = 54;           // start/finish line on the south straight
const OPENING = { x: 30, half: 3 };   // gap in the outer wall / fence, pit lane from the south road
const BOOTH = { x: 38.5, z: 55 };
const GRANDSTANDS: [number, number][] = [[12, 32], [76.5, 88.5]]; // x ranges, north side

// --- track -----------------------------------------------------------------------------

interface TrackPlan {
  pts: THREE.Vector3[];   // block-local
  left: THREE.Vector3[];  // unit normal to the left of the racing direction
  tan: THREE.Vector3[];
  inward: number;         // +1 if the infield is on the left, -1 if on the right
  length: number;
}

/** Straights joined by circular fillets, as a dense closed polyline. */
function filletPath(corners: [number, number, number][]) {
  const n = corners.length;
  const fil = corners.map(([x, z, r], i) => {
    const [ax, az] = corners[(i - 1 + n) % n], [bx, bz] = corners[(i + 1) % n];
    const u = new THREE.Vector2(ax - x, az - z).normalize(), v = new THREE.Vector2(bx - x, bz - z).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    const t = r / Math.tan(phi / 2);
    const bis = u.clone().add(v).normalize();
    const c = new THREE.Vector2(x, z).addScaledVector(bis, r / Math.sin(phi / 2));
    return { t1: new THREE.Vector2(x, z).addScaledVector(u, t), t2: new THREE.Vector2(x, z).addScaledVector(v, t), c, r, t };
  });
  for (let i = 0; i < n; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % n];
    if (fil[i].t + fil[(i + 1) % n].t > Math.hypot(x1 - x0, z1 - z0) + 1e-6) console.warn('[circuit] corner radii too big for edge', i);
  }
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const f = fil[i];
    const a0 = Math.atan2(f.t1.y - f.c.y, f.t1.x - f.c.x);
    let da = Math.atan2(f.t2.y - f.c.y, f.t2.x - f.c.x) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const arcSteps = Math.max(2, Math.ceil((Math.abs(da) * f.r) / 0.05));
    for (let k = 0; k < arcSteps; k++) {
      const a = a0 + (da * k) / arcSteps;
      out.push(new THREE.Vector2(f.c.x + Math.cos(a) * f.r, f.c.y + Math.sin(a) * f.r));
    }
    const next = fil[(i + 1) % n].t1;
    const lineSteps = Math.max(1, Math.ceil(f.t2.distanceTo(next) / 0.05));
    for (let k = 0; k < lineSteps; k++) out.push(f.t2.clone().lerp(next, k / lineSteps));
  }
  return out;
}

/** Resamples a closed polyline at even arc-length steps of about `step`. */
function resample(poly: THREE.Vector2[], step: number) {
  const m = poly.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + poly[i].distanceTo(poly[(i + 1) % m]));
  const total = cum[m];
  const n = Math.round(total / step);
  const pts: THREE.Vector3[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * total) / n;
    while (cum[seg + 1] < s) seg++;
    const a = poly[seg], b = poly[(seg + 1) % m];
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t));
  }
  return pts;
}

function planTrack(): TrackPlan {
  const pts = resample(filletPath(CORNERS), SAMPLE);
  const n = pts.length;
  const tan: THREE.Vector3[] = [];
  const left: THREE.Vector3[] = [];
  let area = 0, length = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], p = pts[i];
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    tan.push(t);
    left.push(new THREE.Vector3(t.z, 0, -t.x));
    area += p.x * b.z - b.x * p.z;
    length += p.distanceTo(b);
  }
  // Left of (tx, tz) with y up is (tz, -tx); with this orientation a positive shoelace area puts the infield on the right.
  return { pts, left, tan, inward: area > 0 ? -1 : 1, length };
}

/**
 * Sanity numbers for a closed track: its length, the smallest distance
 * between samples more than 20 units apart along the track (must exceed
 * 2 * halfWidth + 3 so both walls fit between neighbouring stretches), and
 * the tightest radius of curvature (must exceed halfWidth + 1).
 */
export function checkTrack(points: THREE.Vector3[], halfWidth: number) {
  const n = points.length;
  let length = 0;
  for (let i = 0; i < n; i++) length += points[i].distanceTo(points[(i + 1) % n]);
  const window = Math.ceil(20 / (length / n));
  let minGap = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.min(j - i, n - (j - i)) < window) continue;
      minGap = Math.min(minGap, Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z));
    }
  }
  let minRadius = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[(i - 3 + n) % n], b = points[i], c = points[(i + 3) % n];
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (cross < 1e-9) continue;
    const r = (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(a.x - c.x, a.z - c.z)) / (2 * cross);
    minRadius = Math.min(minRadius, r);
  }
  return { length, samples: n, minGap, minRadius, ok: minGap > 2 * halfWidth + 3 && minRadius > halfWidth + 1 };
}

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

function nearestIndex(plan: TrackPlan, x: number, z: number) {
  let index = 0, best = Infinity;
  plan.pts.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return index;
}

/** Distance from (x, z) to the closest centerline sample. */
function distToTrack(plan: TrackPlan, x: number, z: number) {
  let best = Infinity;
  for (const p of plan.pts) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
  return Math.sqrt(best);
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
 * The kart circuit: a 5×3 block holding a ~330-unit track with red/white
 * barrier walls on both sides, a pit lane in from the south road, a start
 * gantry, the time-trial booth and grandstands along the north. Built
 * block-local; the group sits at the block's north-west corner.
 */
export function buildCircuit(block: Block): CircuitObjects {
  const bb = blockBounds(block);
  const ox = bb.minX, oz = bb.minZ;
  const W = bb.maxX - bb.minX, D = bb.maxZ - bb.minZ;
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  const colliders: Collider[] = [];
  const collide = (x: number, z: number, hw: number, hd: number) => colliders.push({ x: ox + x, z: oz + z, hw, hd });
  const mb = new ModelBuilder();

  // --- Track -------------------------------------------------------------------------
  const plan = planTrack();
  const n = plan.pts.length;
  const step = plan.length / n;
  const startZ = plan.pts[nearestIndex(plan, START_X, 60)].z;
  const startIndex = nearestIndex(plan, START_X, startZ);
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
  const check = checkTrack(plan.pts, HALF_WIDTH);
  if (!check.ok) console.warn('[circuit] kart track too tight', check);

  // --- Barrier walls on both sides, with the opening in the outer wall ----------------
  const outer = -plan.inward;
  const openIndex = nearestIndex(plan, OPENING.x, startZ);
  const op = plan.pts[openIndex], ol = plan.left[openIndex];
  const openAt = new THREE.Vector2(op.x + ol.x * outer * WALL, op.z + ol.z * outer * WALL);
  const inOpening = (x: number, z: number, side: number) => side === outer && Math.hypot(x - openAt.x, z - openAt.y) < OPENING.half;
  for (const side of [-1, 1]) {
    const line = wallLine(plan, side);
    // Colliders: a tight chain of small boxes, so nothing slips between them.
    for (const p of along(line, WALL_STEP)) {
      if (!inOpening(p.x, p.z, side)) collide(p.x, p.z, WALL_BOX, WALL_BOX);
    }
    // Looks: low concrete blocks in alternating red and white, with a white cap stripe.
    const pts = along(line, 1.2);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (inOpening(mx, mz, side) || inOpening(a.x, a.z, side) || inOpening(b.x, b.z, side)) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.05) continue;
      const rotY = Math.atan2(b.x - a.x, b.z - a.z);
      mb.box(0.5, 0.55, len + 0.03, k % 2 ? WHITE : RED, [mx, 0.275, mz], [0, rotY, 0]);
      mb.box(0.54, 0.06, len + 0.03, k % 2 ? '#e6e1d6' : WHITE, [mx, 0.58, mz], [0, rotY, 0]);
    }
  }
  // Bollards at the ends of the opening.
  {
    const t = plan.tan[openIndex];
    for (const s of [-1, 1]) {
      const x = openAt.x + t.x * s * (OPENING.half + 0.1), z = openAt.y + t.z * s * (OPENING.half + 0.1);
      stripedPost(mb, x, z, 1.1, 0.25, YELLOW, '#2b2d31', 0.22);
      mb.sphere(0.2, YELLOW, [x, 1.15, z], 1, 0);
      collide(x, z, 0.3, 0.3);
    }
  }

  // --- Pit lane from the road to the opening --------------------------------------------
  const eMin = EDGE, eMaxX = W - EDGE, eMaxZ = D - EDGE;
  {
    const z0 = startZ + HALF_WIDTH + 0.1, z1 = eMaxZ + 0.3;
    const x0 = OPENING.x - OPENING.half, x1 = OPENING.x + OPENING.half;
    mb.box(x1 - x0, 0.02, z1 - z0, '#6e7178', [OPENING.x, 0.02, (z0 + z1) / 2]);
    for (const x of [x0 + 0.15, x1 - 0.15]) mb.box(0.14, 0.02, z1 - z0, WHITE, [x, 0.032, (z0 + z1) / 2]);
    for (let z = z0 + 1; z < z1 - 0.5; z += 1.6) mb.box(0.14, 0.02, 0.8, YELLOW, [OPENING.x, 0.032, z]);
    // "PIT" chevrons pointing into the track.
    for (let i = 0; i < 2; i++) {
      const cz = z1 - 1.3 - i * 1.1;
      for (const s of [-1, 1]) mb.box(1.1, 0.02, 0.18, WHITE, [OPENING.x + s * 0.42, 0.034, cz + 0.28], [0, s * 0.8, 0]);
    }
  }

  // --- Perimeter fence with the same entrance gap, and a gate ----------------------------
  const gateL = OPENING.x - OPENING.half - 0.3, gateR = OPENING.x + OPENING.half + 0.3;
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
  // Lamp posts with flags along the fence.
  const lamps: [number, number][] = [];
  for (let x = 8; x < W - 4; x += 12) lamps.push([x, eMaxZ], [x + 4, eMin]);
  for (let z = 14; z < D - 8; z += 14) lamps.push([eMin, z], [eMaxX, z]);
  lamps.forEach(([x, z], i) => {
    if (Math.abs(x - OPENING.x) < OPENING.half + 1.5 && z === eMaxZ) return;
    if (z === eMin && GRANDSTANDS.some(([a, b]) => x > a - 1 && x < b + 1)) return;
    lampPost(mb, x, z, 3.2, FLAGS[i % FLAGS.length]);
    collide(x, z, 0.2, 0.2);
  });

  // --- Race booth next to the pit lane --------------------------------------------------
  {
    const { x: rx, z: rz } = BOOTH;
    mb.box(3.2, 0.2, 2.2, STONE, [rx, 0.1, rz]);
    mb.box(2.8, 1.9, 1.8, CREAM, [rx, 1.15, rz]);
    // Window and counter facing the pit lane (west).
    mb.with({ glow: 1 }, () => mb.box(0.06, 0.7, 1.2, '#bfe6ff', [rx - 1.41, 1.5, rz]));
    mb.box(0.45, 0.1, 1.5, WOOD, [rx - 1.6, 1.05, rz]);
    mb.box(3.1, 0.18, 2.1, TEAL, [rx, 2.19, rz]);
    for (let i = 0; i < 15; i++) {
      for (let r = 0; r < 2; r++) mb.box(0.2, 0.1, 0.02, (i + r) % 2 ? '#222226' : WHITE, [rx - 1.4 + i * 0.2, 2.14 + r * 0.1, rz + 1.06]);
    }
    flagPole(mb, rx + 1.3, 2.28, rz - 0.8, 1.6, '#222226', WHITE);
    collide(rx, rz, 1.6, 1.1);
    const sign = makeSign('🏁 Time trial', { sub: 'kart owners only', posts: 0, width: 2.8, height: 0.95, bg: '#fff9e8' });
    sign.position.set(rx, 2.85 - 1.35, rz + 0.75);
    group.add(sign);
    // A leaderboard post by the lane, facing the camera.
    const board = makeSign('Kart Circuit', { sub: 'enter by the pit lane', posts: 2, width: 3.0, height: 0.9, bg: '#fff6dc' });
    const bx = OPENING.x - OPENING.half - 3.2;
    board.position.set(bx, 0, eMaxZ - 1.0);
    board.scale.setScalar(0.85);
    group.add(board);
    for (const s of [-1, 1]) collide(bx + s * 1.07, eMaxZ - 1.2, 0.2, 0.2);
  }

  // --- Start gantry with lights over the line ------------------------------------------
  const lightOn: THREE.Mesh[] = [];
  {
    const p = plan.pts[startIndex], l = plan.left[startIndex], t = plan.tan[startIndex];
    const reach = WALL + 1.0, top = 4.8;
    const legs: V3[] = [-1, 1].map((s) => [p.x + l.x * s * reach, 0, p.z + l.z * s * reach] as V3);
    for (const [x, , z] of legs) {
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

  // --- Grandstands along the north, outside the outer wall -----------------------------
  GRANDSTANDS.forEach(([x0, x1], i) => {
    const back = eMin + 0.7, front = Math.min(eMin + 5.3, 13 - WALL - 0.9);
    grandstand(mb, x0, x1, back, front, i);
    collide((x0 + x1) / 2, (back + front) / 2 + 0.1, (x1 - x0) / 2 + 0.1, (front - back) / 2 + 0.3);
  });

  // --- Infield and hairpin decorations (only where clear of the walls) ------------------
  {
    const clear = (x: number, z: number, r: number) => distToTrack(plan, x, z) >= WALL + WALL_BOX + r;
    const stacks: [number, number][] = [
      [66.5, 30], [40.5, 30], [66.5, 27.4], [40.5, 27.4], [53.5, 21], [53.5, 31], [22, 18], [22.5, 42.5], [81, 18], [80.5, 41],
    ];
    stacks.forEach(([x, z], i) => {
      if (!clear(x, z, 0.6)) return;
      tyreStack(mb, x, z, 3, i % 2 ? RED : WHITE);
      tyreStack(mb, x + 0.95, z + 0.3, 2, i % 2 ? WHITE : RED);
      collide(x + 0.45, z + 0.15, 0.95, 0.65);
    });
    const trees: [number, number][] = [[22, 26], [25, 34], [53.5, 26], [80, 32], [66.5, 20], [40.5, 20], [21, 38]];
    for (const [x, z] of trees) {
      if (!clear(x, z, 1.4)) continue;
      smallTree(mb, x, z, 1.05, undefined);
      collide(x, z, 0.4, 0.4);
    }
    for (const [x, z, w, d] of [[53.5, 16.5, 2.2, 1.0], [26, 22, 2.0, 1.0], [80.5, 25, 1.4, 2.0]] as const) {
      if (!clear(x, z, Math.max(w, d) / 2 + 0.2)) continue;
      flowerPatch(mb, x, z, w, d, Math.round(x));
    }
    // A giant trophy in the west infield.
    const [tx, tz] = [25, 29];
    if (clear(tx, tz, 1.2)) {
      mb.box(1.6, 0.7, 1.6, STONE, [tx, 0.35, tz]);
      mb.box(1.7, 0.1, 1.7, WHITE, [tx, 0.72, tz]);
      mb.cyl(0.22, 0.36, 0.6, '#f2c94c', [tx, 1.07, tz], undefined, 10);
      mb.cyl(0.7, 0.25, 1.0, '#f2c94c', [tx, 1.87, tz], undefined, 12);
      mb.add(new THREE.TorusGeometry(0.34, 0.07, 6, 12), '#f2c94c', [tx - 0.7, 1.95, tz]);
      mb.add(new THREE.TorusGeometry(0.34, 0.07, 6, 12), '#f2c94c', [tx + 0.7, 1.95, tz]);
      mb.sphere(0.17, PINK, [tx, 2.45, tz], 1, 0);
      collide(tx, tz, 0.9, 0.9);
    }
  }

  group.add(staticMesh(mb));

  const world = (x: number, z: number) => new THREE.Vector3(ox + x, 0, oz + z);
  return {
    group,
    colliders,
    track,
    booth: world(BOOTH.x - 2.4, BOOTH.z),
    entrance: world(OPENING.x, D - 1),
    update(_dt: number, t: number) {
      // Idle start-light sequence: five reds come on one by one, hold, then all go out.
      const phase = t % 7;
      const lit = phase < 5 ? Math.floor(phase) + 1 : phase < 6 ? 5 : 0;
      lightOn.forEach((m, i) => (m.visible = i < lit));
    },
  };
}

// Track geometry without three.js, shared by the 3D circuit and the 2D track editor.

import type { TrackCorner } from '../../../shared/tracks.ts';

export interface P2 { x: number; z: number }

/** Drivable half-width of the asphalt. */
export const HALF_WIDTH = 3.5;
/** Distance from the centerline to the middle of the barrier walls. */
export const WALL = 4.25;
export const SAMPLE = 0.6;
/** Tightest corner radius the editor allows. */
export const MIN_RADIUS = HALF_WIDTH + 1.5;
export const MAX_RADIUS = 40;
/** Where along the first straight the start/finish line sits. */
const START_AT = 0.55;
/** The grid needs this much straight behind the line. */
const GRID_BEHIND = 14;
const MIN_START_STRAIGHT = 26;

/** Where the centerline may go inside a circuit block of W×D: the north strip holds grandstands, the south one the paddock. */
export function trackArea(W: number, D: number) {
  return { minX: 9, maxX: W - 9, minZ: 13, maxZ: D - 14 };
}

interface Fillet { t1: P2; t2: P2; c: P2; r: number; t: number; ok: boolean }

function fillets(corners: TrackCorner[]): Fillet[] {
  const n = corners.length;
  return corners.map(([x, z, r], i) => {
    const [ax, az] = corners[(i - 1 + n) % n], [bx, bz] = corners[(i + 1) % n];
    let ux = ax - x, uz = az - z, vx = bx - x, vz = bz - z;
    const ul = Math.hypot(ux, uz) || 1e-9, vl = Math.hypot(vx, vz) || 1e-9;
    ux /= ul; uz /= ul; vx /= vl; vz /= vl;
    const phi = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    // A straight-through corner (phi ≈ π) has no fillet; a hairpin back on itself (phi ≈ 0) can't have one.
    if (phi > Math.PI - 1e-3) return { t1: { x, z }, t2: { x, z }, c: { x, z }, r: 0, t: 0, ok: true };
    if (phi < 1e-3) return { t1: { x, z }, t2: { x, z }, c: { x, z }, r: 0, t: 0, ok: false };
    const t = r / Math.tan(phi / 2);
    let bx2 = ux + vx, bz2 = uz + vz;
    const bl = Math.hypot(bx2, bz2) || 1e-9;
    bx2 /= bl; bz2 /= bl;
    const d = r / Math.sin(phi / 2);
    return {
      t1: { x: x + ux * t, z: z + uz * t },
      t2: { x: x + vx * t, z: z + vz * t },
      c: { x: x + bx2 * d, z: z + bz2 * d },
      r, t, ok: true,
    };
  });
}

/** Straights joined by circular fillets, as a dense closed polyline. */
function filletPath(fil: Fillet[]): P2[] {
  const n = fil.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const f = fil[i];
    if (f.r > 0) {
      const a0 = Math.atan2(f.t1.z - f.c.z, f.t1.x - f.c.x);
      let da = Math.atan2(f.t2.z - f.c.z, f.t2.x - f.c.x) - a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const arcSteps = Math.max(2, Math.ceil((Math.abs(da) * f.r) / 0.05));
      for (let k = 0; k < arcSteps; k++) {
        const a = a0 + (da * k) / arcSteps;
        out.push({ x: f.c.x + Math.cos(a) * f.r, z: f.c.z + Math.sin(a) * f.r });
      }
    }
    const from = f.t2, next = fil[(i + 1) % n].t1;
    const len = Math.hypot(next.x - from.x, next.z - from.z);
    const lineSteps = Math.max(1, Math.ceil(len / 0.05));
    for (let k = 0; k < lineSteps; k++) out.push({ x: from.x + ((next.x - from.x) * k) / lineSteps, z: from.z + ((next.z - from.z) * k) / lineSteps });
  }
  return out;
}

/** Resamples a closed polyline at even arc-length steps of about `step`. */
export function resample(poly: P2[], step: number): P2[] {
  const m = poly.length;
  const cum = [0];
  for (let i = 0; i < m; i++) cum.push(cum[i] + Math.hypot(poly[(i + 1) % m].x - poly[i].x, poly[(i + 1) % m].z - poly[i].z));
  const total = cum[m];
  const n = Math.max(3, Math.round(total / step));
  const pts: P2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k * total) / n;
    while (cum[seg + 1] < s) seg++;
    const a = poly[seg], b = poly[(seg + 1) % m];
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return pts;
}

export interface TrackPlan {
  pts: P2[];
  /** Unit normal to the left of the racing direction. */
  left: P2[];
  tan: P2[];
  /** +1 if the infield is on the left, -1 if on the right. */
  inward: number;
  length: number;
  startIndex: number;
  /** Each corner's radius fits between its neighbours. */
  cornerOk: boolean[];
  /** Length of the straight the start line sits on. */
  startStraight: number;
}

export function planTrack(corners: TrackCorner[]): TrackPlan {
  const fil = fillets(corners);
  const cornerOk = fil.map((f) => f.ok);
  const n0 = corners.length;
  for (let i = 0; i < n0; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % n0];
    if (fil[i].t + fil[(i + 1) % n0].t > Math.hypot(x1 - x0, z1 - z0) + 1e-6) cornerOk[i] = cornerOk[(i + 1) % n0] = false;
  }
  const pts = resample(filletPath(fil), SAMPLE);
  const n = pts.length;
  const tan: P2[] = [];
  const left: P2[] = [];
  let area = 0, length = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], p = pts[i], q = pts[(i + 1) % n];
    const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1e-9;
    tan.push({ x: tx / l, z: tz / l });
    left.push({ x: tz / l, z: -tx / l });
    area += p.x * q.z - q.x * p.z;
    length += Math.hypot(q.x - p.x, q.z - p.z);
  }
  // The start line: part-way along the straight from corner 0 to corner 1.
  const s0 = fil[0].t2, s1 = fil[1 % n0].t1;
  const startStraight = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  const along = Math.max(Math.min(GRID_BEHIND, startStraight), startStraight * START_AT);
  const sx = s0.x + ((s1.x - s0.x) * along) / (startStraight || 1), sz = s0.z + ((s1.z - s0.z) * along) / (startStraight || 1);
  // Left of (tx, tz) with y up is (tz, -tx); with this orientation a positive shoelace area puts the infield on the right.
  return { pts, left, tan, inward: area > 0 ? -1 : 1, length, startIndex: nearest(pts, sx, sz), cornerOk, startStraight };
}

export function nearest(pts: P2[], x: number, z: number) {
  let index = 0, best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) ** 2 + (pts[i].z - z) ** 2;
    if (d < best) {
      best = d;
      index = i;
    }
  }
  return index;
}

/** Distance from (x, z) to the closest centerline sample. */
export function distToTrack(pts: P2[], x: number, z: number) {
  let best = Infinity;
  for (const p of pts) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
  return Math.sqrt(best);
}

export interface TrackCheck {
  ok: boolean;
  length: number;
  problems: string[];
  /** Spots to highlight in the editor. */
  bad: P2[];
  /** Corners whose radius doesn't fit or that leave the area. */
  badCorners: Set<number>;
}

/**
 * Can this track be built in a W×D circuit block? Neighbouring stretches must leave room for both
 * walls, bends can't be tighter than a kart can take, the centerline has to stay in the track
 * area, and the start straight needs room for the grid.
 */
export function checkTrack(corners: TrackCorner[], W: number, D: number, plan = planTrack(corners)): TrackCheck {
  const problems: string[] = [];
  const bad: P2[] = [];
  const badCorners = new Set<number>();
  const { pts } = plan;
  const n = pts.length;
  const step = plan.length / n;
  const area = trackArea(W, D);

  plan.cornerOk.forEach((ok, i) => !ok && badCorners.add(i));
  if (badCorners.size) problems.push('Some corners are too round for the straights around them (shrink the radius or move them apart).');
  corners.forEach(([, , r], i) => {
    if (r < MIN_RADIUS - 1e-6) badCorners.add(i);
  });

  let outside = false;
  for (const p of pts) {
    if (p.x < area.minX || p.x > area.maxX || p.z < area.minZ || p.z > area.maxZ) {
      outside = true;
      bad.push(p);
    }
  }
  if (outside) problems.push('The track leaves the circuit area (keep it inside the dashed box).');

  // Stretches more than ~20 apart along the track must be far enough apart for both walls.
  const minGap = 2 * WALL + 1.5;
  const window = Math.ceil(20 / step);
  const stride = 2;
  let tooClose = false;
  for (let i = 0; i < n; i += stride) {
    for (let j = i + window; j < n; j += stride) {
      if (n - (j - i) < window) break;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      if (d < minGap) {
        tooClose = true;
        if (bad.length < 400) bad.push(pts[i], pts[j]);
      }
    }
  }
  if (tooClose) problems.push('Two parts of the track are too close (or cross): the walls need room between them.');

  let tight = false;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 3 + n) % n], b = pts[i], c = pts[(i + 3) % n];
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (cross < 1e-9) continue;
    const r = (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(a.x - c.x, a.z - c.z)) / (2 * cross);
    if (r < HALF_WIDTH + 1) {
      tight = true;
      bad.push(b);
    }
  }
  if (tight) problems.push(`Some bends are too tight (corner radius at least ${MIN_RADIUS}).`);

  if (plan.startStraight < MIN_START_STRAIGHT) {
    problems.push(`The start straight (corner 1 → 2) needs at least ${MIN_START_STRAIGHT} units of straight for the grid.`);
    badCorners.add(0);
    badCorners.add(1 % corners.length);
  }
  if (corners.length < 3) problems.push('A track needs at least 3 corners.');
  return { ok: problems.length === 0, length: plan.length, problems, bad, badCorners };
}

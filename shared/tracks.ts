// Kart tracks: the circuit's layout as data, so it can be edited, saved as JSON files
// (`.data/tracks/`, one file per saved version) and loaded back with its own best times.

/** A corner of the track polygon: block-local x, z (from the circuit block's north-west corner) and the fillet radius. */
export type TrackCorner = [number, number, number];

export interface TrackRun { timeMs: number; date: number }

export interface TrackDef {
  /** File name without `.json`; also the id the player's active-track save points at. */
  id: string;
  name: string;
  /** When this version was saved. */
  created: number;
  /** The id this version was edited from, if any. */
  parent?: string;
  /**
   * Corners in racing order. The track is the closed polygon through them with each corner
   * rounded to its radius; the start/finish line sits on the straight from corner 0 to corner 1.
   */
  corners: TrackCorner[];
  /** Best runs, fastest first (at most MAX_TIMES). */
  times: TrackRun[];
}

export const MAX_TIMES = 10;
export const MAX_CORNERS = 60;

/** Adds a run to a top-10 board. Returns the new board and the run's rank (1-based), or 0 if it didn't make it. */
export function rankRun(board: TrackRun[], run: TrackRun): { board: TrackRun[]; rank: number } {
  const all = [...board, run].sort((a, b) => a.timeMs - b.timeMs).slice(0, MAX_TIMES);
  return { board: all, rank: all.indexOf(run) + 1 };
}

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A track from untrusted JSON, or null if it isn't one. */
export function sanitizeTrack(raw: unknown): Omit<TrackDef, 'id'> & { id?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.corners) || r.corners.length < 3 || r.corners.length > MAX_CORNERS) return null;
  const corners: TrackCorner[] = [];
  for (const c of r.corners) {
    if (!Array.isArray(c) || c.length !== 3 || !num(c[0], -1000, 1000) || !num(c[1], -1000, 1000) || !num(c[2], 0.5, 200)) return null;
    corners.push([c[0], c[1], c[2]]);
  }
  const times: TrackRun[] = Array.isArray(r.times)
    ? r.times
      .filter((t): t is TrackRun => Boolean(t) && num((t as TrackRun).timeMs, 1, 1e8) && num((t as TrackRun).date, 0, 1e14))
      .map((t) => ({ timeMs: Math.round(t.timeMs), date: t.date }))
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, MAX_TIMES)
    : [];
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : 'Untitled track';
  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    name,
    created: num(r.created, 0, 1e14) ? (r.created as number) : Date.now(),
    parent: typeof r.parent === 'string' ? r.parent.slice(0, 120) : undefined,
    corners,
    times,
  };
}

/** Ids of the tracks every island starts with. */
export const GRAND_PRIX_ID = 'grand-prix';
export const CLASSIC_ID = 'classic';

/**
 * Starter tracks, in block-local units for the 8×5 circuit block (160×100). The track must stay
 * inside x 9…151, z 13…88: the north strip holds the grandstands, the south one the paddock.
 */
export const STARTER_TRACKS: { id: string; name: string; corners: TrackCorner[] }[] = [
  {
    id: GRAND_PRIX_ID,
    name: 'Grand Prix',
    corners: [
      [12, 86, 9],      // south-west: the long main straight runs east
      [122, 86, 9],
      [148, 74, 10],    // fast kink into the east side
      [148, 50, 7],
      [134, 41, 6],     // esses
      [148, 31, 7],
      [148, 14, 8],     // north-east
      [112, 14, 6],     // the dive: down and back up
      [112, 56, 7],
      [94, 56, 7],
      [94, 14, 6],
      [62, 14, 8],      // north straight
      [48, 34, 8],      // sweeping S through the middle
      [64, 52, 8],
      [50, 70, 8],
      [30, 66, 8],
      [30, 42, 6],      // west hairpin
      [12, 32, 7],
    ],
  },
  {
    id: CLASSIC_ID,
    name: 'Classic',
    // The island's original circuit (designed for the old 5×3 block), moved to the middle of the new one.
    corners: ([
      [9, 48, 8], [91, 48, 8], [91, 34.5, 6], [84, 28, 5.5], [91, 22, 6], [91, 13, 6], [73, 13, 5.5], [73, 37.5, 6.5],
      [60, 37.5, 6.5], [60, 13, 5.5], [47, 13, 5.5], [47, 37.5, 6.5], [34, 37.5, 6.5], [34, 13, 5.5], [9, 13, 7],
      [9, 23.5, 5], [16.5, 30, 5], [9, 36.5, 5],
    ] as TrackCorner[]).map(([x, z, r]) => [x + 30, z + 20, r] as TrackCorner),
  },
];

/** A blank-canvas starting point for the editor. */
export const OVAL_TRACK: TrackCorner[] = [[30, 80, 16], [130, 80, 16], [130, 24, 16], [30, 24, 16]];

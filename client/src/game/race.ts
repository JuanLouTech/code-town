import { trackProgress, type FairTrack } from './circuit.ts';
import type { Player } from './player.ts';

export const LAPS = 3;
const CHECKPOINTS = 12;
const COUNTDOWN = 3;

export interface RaceRun { timeMs: number; date: number }
export interface RaceResult { timeMs: number; laps: number[] }

/** Formats a race time as m:ss.cc. */
export function raceTime(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Adds a run to a top-10 board. Returns the new board and the run's rank (1-based), or 0 if it didn't make it. */
export function rankRun(board: RaceRun[], run: RaceRun): { board: RaceRun[]; rank: number } {
  const all = [...board, run].sort((a, b) => a.timeMs - b.timeMs).slice(0, 10);
  return { board: all, rank: all.indexOf(run) + 1 };
}

/**
 * A time trial on the fair's track: countdown, laps, and checkpoints that have to be passed in
 * order (so cutting across the infield doesn't count).
 */
export class Race {
  private countdown = 0;
  private lastBeep = 0;
  private startedAt = 0;
  private lapStart = 0;
  private laps: number[] = [];
  private next = 1;
  private cps: number[];
  private done = false;
  onBeep?: (go: boolean) => void;
  onCheckpoint?: () => void;
  onLap?: (lap: number, ms: number) => void;
  onFinish?: (r: RaceResult) => void;

  constructor(private track: FairTrack, private player: Player) {
    const n = track.points.length;
    this.cps = Array.from({ length: CHECKPOINTS }, (_, k) => (track.startIndex + Math.round((k * n) / CHECKPOINTS)) % n);
    const k = player.kart!;
    k.park(track.startPos.x, track.startPos.z, track.startHeading);
    player.pos.set(k.pos.x, 0, k.pos.z);
    player.facing = track.startHeading;
    this.countdown = COUNTDOWN;
    this.lastBeep = COUNTDOWN + 1;
  }

  /** The kart can't move until GO. */
  get frozen() {
    return this.countdown > 0;
  }

  get finished() {
    return this.done;
  }

  /** What the HUD shows. */
  status(now: number) {
    if (this.countdown > 0) return { big: String(Math.ceil(this.countdown)), lap: 1, lapMs: 0, totalMs: 0, laps: this.laps };
    const since = now - this.startedAt;
    return { big: since < 800 ? 'GO!' : '', lap: Math.min(LAPS, this.laps.length + 1), lapMs: now - this.lapStart, totalMs: since, laps: this.laps };
  }

  update(dt: number, now: number) {
    if (this.done) return;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const tick = Math.ceil(this.countdown);
      if (tick < this.lastBeep) {
        this.lastBeep = tick;
        this.onBeep?.(tick <= 0);
      }
      if (this.countdown <= 0) this.startedAt = this.lapStart = now;
      return;
    }
    const p = this.player.pos;
    const { index, dist } = trackProgress(this.track, p.x, p.z);
    if (dist > this.track.halfWidth + 2.5) return;
    const n = this.track.points.length;
    const target = this.cps[this.next % CHECKPOINTS];
    const gap = Math.min(Math.abs(index - target), n - Math.abs(index - target));
    if (gap > 4) return;
    if (this.next % CHECKPOINTS !== 0) {
      this.next++;
      this.onCheckpoint?.();
      return;
    }
    // Back at the start line with every checkpoint done: a lap.
    const lapMs = now - this.lapStart;
    this.laps.push(lapMs);
    this.lapStart = now;
    this.next = 1;
    this.onLap?.(this.laps.length, lapMs);
    if (this.laps.length >= LAPS) {
      this.done = true;
      this.onFinish?.({ timeMs: now - this.startedAt, laps: this.laps });
    }
  }
}

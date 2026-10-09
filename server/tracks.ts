import fs from 'node:fs';
import path from 'node:path';
import { CLASSIC_ID, STARTER_TRACKS, rankRun, sanitizeTrack, type TrackDef, type TrackRun } from '../shared/tracks.ts';

const VALID_ID = /^[a-z0-9][a-z0-9-]{0,100}$/;

/**
 * Kart tracks, one JSON file per saved version in `.data/tracks/` (gitignored). Editing a track
 * and saving it writes a new file, so older versions (and their best times) can still be loaded.
 * Files can also be copied in or out by hand; anything that isn't a valid track is skipped.
 */
export class TrackStore {
  private dir: string;

  constructor(dataDir: string, legacyBoard?: unknown) {
    this.dir = path.join(dataDir, 'tracks');
    const fresh = !fs.existsSync(this.dir);
    fs.mkdirSync(this.dir, { recursive: true });
    if (fresh) this.seed(legacyBoard);
  }

  /** The starter tracks. The old circuit's times move to Classic, which is the same layout. */
  private seed(legacyBoard: unknown) {
    const now = Date.now();
    for (const t of STARTER_TRACKS) {
      const times = t.id === CLASSIC_ID ? sanitizeTrack({ corners: t.corners, times: legacyBoard })?.times ?? [] : [];
      this.write({ ...t, created: now, times });
    }
  }

  list(): TrackDef[] {
    const out: TrackDef[] = [];
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return out;
    }
    for (const f of files) {
      const id = f.slice(0, -5);
      if (!VALID_ID.test(id)) continue;
      try {
        const t = sanitizeTrack(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')));
        if (t) out.push({ ...t, id });
      } catch {
        // not a track: leave it alone
      }
    }
    return out.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  }

  /** Saves a new version; returns its id. */
  save(raw: unknown): string {
    const t = sanitizeTrack(raw);
    if (!t) throw new Error('That isn’t a valid track.');
    const created = Date.now();
    const stamp = new Date(created).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const slug = t.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'track';
    let id = `${slug}-${stamp}`;
    for (let k = 2; fs.existsSync(this.file(id)); k++) id = `${slug}-${stamp}-${k}`;
    const parent = t.parent && VALID_ID.test(t.parent) ? t.parent : undefined;
    this.write({ id, name: t.name, created, parent, corners: t.corners, times: [] });
    return id;
  }

  delete(id: string) {
    if (!VALID_ID.test(id)) return;
    fs.rmSync(this.file(id), { force: true });
  }

  /** Records a finished run on a track's board. */
  addTime(id: string, run: TrackRun) {
    if (!VALID_ID.test(id) || !fs.existsSync(this.file(id))) return;
    if (!(run?.timeMs > 0 && run.timeMs < 1e8) || !Number.isFinite(run.date)) return;
    const t = sanitizeTrack(JSON.parse(fs.readFileSync(this.file(id), 'utf8')));
    if (!t) return;
    this.write({ ...t, id, times: rankRun(t.times, { timeMs: Math.round(run.timeMs), date: run.date }).board });
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  /** Readable JSON: one corner and one time per line. */
  private write(t: TrackDef) {
    const lines = [
      '{',
      `  "name": ${JSON.stringify(t.name)},`,
      `  "created": ${t.created},`,
      ...(t.parent ? [`  "parent": ${JSON.stringify(t.parent)},`] : []),
      '  "corners": [',
      t.corners.map((c) => `    ${JSON.stringify(c)}`).join(',\n'),
      '  ],',
      `  "times": [${t.times.length ? '\n' + t.times.map((r) => `    ${JSON.stringify(r)}`).join(',\n') + '\n  ' : ''}]`,
      '}',
      '',
    ];
    const tmp = `${this.file(t.id)}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'));
    fs.renameSync(tmp, this.file(t.id));
  }
}

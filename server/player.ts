import fs from 'node:fs';
import path from 'node:path';

const VALID_KEY = /^[a-z][A-Za-z0-9_-]{0,40}$/;
const MAX_BYTES = 1_000_000;

/**
 * The player's own things (pockets, crops, today's digs, minigame records), saved next to the
 * island data. Browsers only keep a cache: localStorage is per origin, so it's lost whenever the
 * port or host changes.
 */
export class PlayerStore {
  private file: string;
  private data: Record<string, unknown> = {};
  private timer?: NodeJS.Timeout;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'player.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.data = raw;
    } catch {
      this.data = {};
    }
  }

  all(): Record<string, unknown> {
    return this.data;
  }

  set(key: string, value: unknown) {
    if (!VALID_KEY.test(key)) throw new Error(`Bad save key: ${key}`);
    if (JSON.stringify(value ?? null).length > MAX_BYTES) throw new Error(`Save data for ${key} is too big.`);
    this.data[key] = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

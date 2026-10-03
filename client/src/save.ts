import type { Net } from './net.ts';

const SYNCED_KEY = 'codetown.synced';
const UNSENT_KEY = 'codetown.unsent';

type Merge = ((server: never, local: never) => unknown) | null;

/**
 * The player's progress (pockets, crops, today's digs, minigame records). The server keeps the
 * real copy in `.data/player.json`; localStorage is only a cache, because it belongs to one
 * origin and is lost whenever the port or host changes.
 *
 * Changes the server hasn't received yet (socket down, page closed within the send delay) are
 * remembered as "unsent" and win over the server's copy on the next connection; everything else
 * follows the server, which also relays saves between open tabs.
 */
export class Saves {
  private values = new Map<string, unknown>();
  private timers = new Map<string, number>();
  private unsent: Set<string>;
  /** Called when another tab saved something (after this one has synced). */
  onRemote?: (key: string, value: unknown) => void;

  constructor(private net: Net) {
    this.unsent = new Set(this.read<string[]>(UNSENT_KEY) ?? []);
    window.addEventListener('pagehide', () => this.flushAll());
  }

  private read<T>(k: string): T | undefined {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }

  private write(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // storage unavailable: the server copy still has it
    }
  }

  private markUnsent(key: string, on: boolean) {
    if (on === this.unsent.has(key)) return;
    if (on) this.unsent.add(key);
    else this.unsent.delete(key);
    this.write(UNSENT_KEY, [...this.unsent]);
  }

  /** The cached value, available straight away at startup. */
  local<T>(key: string): T | undefined {
    if (this.values.has(key)) return this.values.get(key) as T;
    return this.read<T>(`codetown.${key}`);
  }

  set(key: string, value: unknown) {
    this.values.set(key, value);
    this.write(`codetown.${key}`, value);
    this.markUnsent(key, true);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, window.setTimeout(() => this.flush(key), 300));
  }

  private flush(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (!this.net.connected || !this.unsent.has(key)) return;
    this.net.send({ t: 'save', key, value: this.local(key) });
    this.markUnsent(key, false);
  }

  private flushAll() {
    for (const key of [...this.unsent]) this.flush(key);
  }

  /** Another tab saved `key`: take it, unless this tab has a newer change of its own on the way. */
  remote(key: string, value: unknown) {
    if (this.unsent.has(key)) return;
    this.values.set(key, value);
    this.write(`codetown.${key}`, value);
    this.onRemote?.(key, value);
  }

  /**
   * On (re)connecting: decides each key's value and returns the ones to use. Unsent local changes
   * win (and are sent now); otherwise the server's copy wins. A key the server doesn't have yet
   * is uploaded from the cache. The first time an origin syncs, `merge` folds progress made before
   * saves lived on the server into the server's copy.
   */
  sync(server: Record<string, unknown> | undefined, keys: Record<string, Merge>) {
    const out: Record<string, unknown> = {};
    const firstTime = this.read<string>(SYNCED_KEY) !== '1';
    for (const [key, merge] of Object.entries(keys)) {
      const local = this.local(key);
      const remote = server?.[key];
      let v: unknown;
      if (remote === undefined) v = local;
      else if (local !== undefined && this.unsent.has(key)) v = local;
      else if (local !== undefined && firstTime && merge) v = merge(remote as never, local as never);
      else v = remote;
      if (v === undefined) continue;
      out[key] = v;
      this.values.set(key, v);
      this.write(`codetown.${key}`, v);
      if (v !== remote) this.markUnsent(key, true);
    }
    this.write(SYNCED_KEY, '1');
    this.flushAll();
    return out;
  }
}

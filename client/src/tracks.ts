import { GRAND_PRIX_ID, rankRun, type TrackDef, type TrackRun } from '../../shared/tracks.ts';
import type { Island } from './game/island.ts';
import type { Net } from './net.ts';
import type { Saves } from './save.ts';

export interface TrackSave { id: string }

/**
 * The saved kart tracks (files on the server) and which one the circuit is built with. The
 * choice is a player save (`track`), so it follows across tabs and reloads.
 */
export class Tracks {
  list: TrackDef[] = [];
  /** Set while racing: switching tracks then would pull the circuit out from under the kart. */
  hold = false;
  private pending = false;
  /** Called when the list changes (the workshop refreshes). */
  onChange?: () => void;

  constructor(private island: Island, private net: Net, private saves: Saves) {}

  get activeId(): string {
    const want = this.saves.local<TrackSave>('track')?.id;
    if (want && this.list.some((t) => t.id === want)) return want;
    return this.list.find((t) => t.id === GRAND_PRIX_ID)?.id ?? this.list[0]?.id ?? '';
  }

  /** The track the circuit shows (the built-in Grand Prix until the server's list arrives). */
  get active(): TrackDef {
    return this.list.find((t) => t.id === this.activeId) ?? this.island.trackDef;
  }

  setList(list: TrackDef[]) {
    this.list = list;
    this.apply();
    this.onChange?.();
  }

  /** Builds the circuit with the active track (later, if a race is on). */
  apply() {
    if (this.hold) {
      this.pending = true;
      return;
    }
    this.pending = false;
    if (this.list.length) this.island.setTrack(this.active);
  }

  release() {
    this.hold = false;
    if (this.pending) this.apply();
  }

  activate(id: string) {
    this.saves.set('track', { id } satisfies TrackSave);
    this.apply();
    this.onChange?.();
  }

  save(def: Pick<TrackDef, 'name' | 'corners' | 'parent'>) {
    return this.net.saveTrack({ name: def.name, corners: def.corners, parent: def.parent });
  }

  delete(id: string) {
    this.list = this.list.filter((t) => t.id !== id);
    this.net.send({ t: 'track.delete', id });
    this.onChange?.();
  }

  /** Records a finished run on the active track. Returns its rank on the board (0 if it didn't make it) and the board. */
  addRun(run: TrackRun) {
    const t = this.active;
    const { board, rank } = rankRun(t.times, run);
    t.times = board;
    if (t.id) this.net.send({ t: 'track.time', id: t.id, run });
    return { board, rank };
  }
}

import type * as THREE from 'three';
import type { Garage } from './garage.ts';
import type { Island } from './game/island.ts';
import { LAPS, Race, raceTime, rankRun, type RaceResult, type RaceRun } from './game/race.ts';
import type { Saves } from './save.ts';
import type { Voice } from './ui/audio.ts';
import type { Hud } from './ui/hud.ts';
import { openNonogram, type NonogramSave } from './ui/nonogram.ts';
import { h, type Panel } from './ui/panel.ts';
import type { Pockets } from './ui/pockets.ts';

export interface RaceSave { board: RaceRun[] }

export type FairSpot = 'race' | 'raceLocked' | 'nonogram';

const FINISH_COINS = 100;
const RECORD_COINS = 300;

/** The fun fair's minigames: kart time trials and the picross corner. */
export class FunFair {
  race?: Race;
  private hudEl = h('div', { class: 'race-hud' });
  private bigEl = h('div', { class: 'race-count' });
  private lastPop = 0;

  constructor(
    ui: HTMLElement, private island: Island, private garage: Garage, private panel: Panel,
    private hud: Hud, private voice: Voice, private saves: Saves, private pockets: Pockets,
  ) {
    ui.append(this.hudEl, this.bigEl);
  }

  get racing() {
    return Boolean(this.race && !this.race.finished);
  }

  /** What the player could do at the fair from here, if anything. */
  spotAt(pos: THREE.Vector3): { kind: FairSpot; label: string } | undefined {
    const { fair, circuit } = this.island;
    if (this.racing) return undefined;
    const start = circuit?.track.startPos;
    if (this.garage.driving) {
      return start && pos.distanceTo(start) < 7 ? { kind: 'race', label: `🏁 Start a time trial (${LAPS} laps)` } : undefined;
    }
    if (fair && pos.distanceTo(fair.booths.nonogram) < 2.6) return { kind: 'nonogram', label: '🧩 Play picross' };
    if (circuit && start && (pos.distanceTo(circuit.booth) < 3 || pos.distanceTo(start) < 4)) {
      return { kind: 'raceLocked', label: this.garage.owned ? '🏁 Hop in your kart (K) to race' : '🏁 Time trial · kart owners only' };
    }
    return undefined;
  }

  interact(kind: FairSpot) {
    if (kind === 'race') this.startRace();
    else if (kind === 'nonogram') void this.picross();
    else this.hud.toast(this.garage.owned ? '🏎️ Press K to hop in your kart, then drive onto the start line.' : '🏎️ Only kart owners can race. Kip sells karts at the plaza stall!');
  }

  /** Esc during a race gives up. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.racing) return false;
    if (e.code === 'Escape') {
      this.endRace();
      this.hud.toast('🏳️ Race abandoned.');
      return true;
    }
    return false;
  }

  update(dt: number) {
    const race = this.race;
    if (!race) return;
    const now = performance.now();
    if (!this.garage.driving && !race.finished) {
      this.endRace();
      this.hud.toast('🏳️ You got out of the kart, so the race is off.');
      return;
    }
    race.update(dt, now);
    this.island.player.enabled = this.island.player.enabled && !race.frozen;
    if (!this.race) return; // finished during this update
    const st = race.status(now);
    this.bigEl.textContent = st.big;
    this.bigEl.classList.toggle('show', Boolean(st.big));
    const best = this.board()[0];
    this.hudEl.innerHTML = '';
    this.hudEl.append(
      h('div', { class: 'race-lap' }, `Lap ${st.lap}/${LAPS}`),
      h('div', { class: 'race-time' }, raceTime(st.totalMs)),
      h('div', { class: 'race-sub' }, [
        `this lap ${raceTime(st.lapMs)}`,
        ...st.laps.map((l, i) => `L${i + 1} ${raceTime(l)}`),
        best ? `record ${raceTime(best.timeMs)}` : '',
      ].filter(Boolean).join(' · ')),
      h('div', { class: 'race-sub' }, 'Esc to give up'));
  }

  private board(): RaceRun[] {
    return this.saves.local<RaceSave>('circuit')?.board ?? [];
  }

  private startRace() {
    const circuit = this.island.circuit;
    if (!circuit || !this.garage.driving) return;
    const race = new Race(circuit.track, this.island.player);
    race.onBeep = (go) => this.voice.beep(go);
    race.onCheckpoint = () => this.voice.pop();
    race.onLap = (lap, ms) => {
      if (lap < LAPS) this.hud.toast(`🏁 Lap ${lap}: ${raceTime(ms)}`);
    };
    race.onFinish = (r) => void this.finish(r);
    this.race = race;
    this.hudEl.classList.add('show');
    this.island.effects.poof(this.island.player.pos.clone(), 12, '#ffffff', 1);
  }

  private endRace() {
    this.race = undefined;
    this.hudEl.classList.remove('show');
    this.bigEl.classList.remove('show');
  }

  private async finish(r: RaceResult) {
    this.endRace();
    const run = { timeMs: Math.round(r.timeMs), date: Date.now() };
    const prev = this.board();
    const { board, rank } = rankRun(prev, run);
    this.saves.set('circuit', { board } satisfies RaceSave);
    const record = rank === 1;
    const coins = FINISH_COINS + (record ? RECORD_COINS : 0);
    this.pockets.addCoins(coins);
    this.voice.fanfare();
    const table = h('div', { class: 'race-board' });
    board.forEach((b, i) => table.append(h('div', { class: 'race-row' + (b === run ? ' mine' : '') },
      h('span', { class: 'race-rank' }, `${i + 1}.`),
      h('span', { class: 'race-t' }, raceTime(b.timeMs)),
      h('span', { class: 'race-date' }, new Date(b.date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))));
    const again = h('button', { class: 'btn primary' }, '🔁 Race again');
    const done = h('button', { class: 'btn' }, '👋 Done');
    const body = h('div', { class: 'race-result' },
      h('div', { class: 'race-big' }, raceTime(run.timeMs)),
      h('div', { class: 'race-note' }, rank
        ? (record ? (prev.length ? '🏆 New island record!' : '🏆 The first record on the board!') : `You placed #${rank} on the board!`)
        : 'Not in the top 10 this time. Keep practising!'),
      h('div', { class: 'race-note' }, r.laps.map((l, i) => `Lap ${i + 1}: ${raceTime(l)}`).join(' · ')),
      h('div', { class: 'race-note' }, `🪙 +${coins} coins`),
      h('div', { class: 'group-title' }, '🏁 Top 10'),
      table);
    await new Promise<void>((resolve) => {
      again.addEventListener('click', () => {
        this.panel.close();
        this.startRace();
      });
      done.addEventListener('click', () => this.panel.close());
      this.panel.open({ title: '🏁 Time trial', color: '#e8645c', body, foot: h('div', { class: 'row end' }, done, again), form: true, onClose: () => resolve() });
      setTimeout(() => again.focus(), 50);
    });
  }

  private async picross() {
    const save = this.saves.local<NonogramSave>('nonogram') ?? { solved: {} };
    await openNonogram(this.panel, {
      save,
      onSave: (s) => this.saves.set('nonogram', s),
      onReward: (c) => this.pockets.addCoins(c),
      onSound: (k) => {
        if (k === 'fanfare') this.voice.fanfare();
        else if (k === 'error') this.voice.bump();
        else if (k === 'timeout') this.voice.close();
        else if (performance.now() - this.lastPop > 60) {
          this.lastPop = performance.now();
          this.voice.pop();
        }
      },
    });
  }
}

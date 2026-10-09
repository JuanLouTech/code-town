import * as THREE from 'three';
import type { SessionSummary, Species } from '../../../shared/protocol.ts';
import { curvedProject } from '../game/engine.ts';
import type { Island } from '../game/island.ts';
import type { Actor } from '../game/villagers.ts';
import type { Store } from '../net.ts';
import { h } from './panel.ts';

export const SPECIES_EMOJI: Record<Species, string> = {
  cat: '🐱', dog: '🐶', bear: '🐻', rabbit: '🐰', frog: '🐸', duck: '🦆', mouse: '🐭', fox: '🦊',
  pig: '🐷', sheep: '🐑', koala: '🐨', penguin: '🐧', human: '🧑', gnome: '🧙',
};

export const STATUS_LABEL: Record<string, string> = {
  starting: '⏳ Starting', working: '🌱 Working', waiting: '❓ Needs you', done: '❗ Done', idle: '💬 Idle', error: '⚠️ Trouble', closed: '🌙 Closed',
};

export function statusOf(s: SessionSummary) {
  if (s.status === 'idle' && s.unread) return 'done';
  return s.status;
}

export function colorFor(species: Species | undefined) {
  const map: Partial<Record<Species, string>> = {
    cat: '#f29e4c', dog: '#c98b56', bear: '#9c6b43', rabbit: '#f28fb1', frog: '#5cb85c', duck: '#e6b422', mouse: '#9aa2ad',
    fox: '#e8743b', pig: '#ef8fa3', sheep: '#b59ad9', koala: '#7d8ba0', penguin: '#4a6f8a', gnome: '#d9534f',
  };
  return (species && map[species]) ?? '#19b89c';
}

export class Hud {
  private clock = h('div', { class: 'hud-clock' });
  private timeEl = h('div', { class: 'time' });
  private dateEl = h('div', { class: 'date' });
  private buttons = h('div', { class: 'hud-buttons' });
  private listBtn = h('button', { class: 'btn', title: 'Villagers (Tab)' }, '📋 Villagers');
  private soundBtn = h('button', { class: 'btn', title: 'Sound' });
  prompt = h('div', { class: 'prompt' });
  private sessions = h('div', { class: 'sessions ui-scroll' });
  private toasts = h('div', { class: 'toasts' });
  private hint = h('div', { class: 'hud-hint' });
  private tags: HTMLElement[] = [];
  private coinsEl = h('div', { class: 'coins' });
  private card = h('div', { class: 'catch-card' });
  private cardTimer = 0;
  private tagLayer = h('div', { style: 'position:fixed;inset:0;pointer-events:none' });
  onMap?: () => void;
  onLeave?: () => void;
  onSound?: () => boolean;
  onOptions?: () => void;
  onTravel?: (s: SessionSummary) => void;
  private v = new THREE.Vector3();

  constructor(root: HTMLElement, private store: Store, private island: Island, muted: boolean) {
    this.clock.append(this.timeEl, this.dateEl, h('div', { class: 'island' }, '🏝️ Code Town'), this.coinsEl);
    const mapBtn = h('button', { class: 'btn', title: 'Map (M)' }, '🗺️ Map');
    const leaveBtn = h('button', { class: 'btn', title: 'Leave the island' }, '🚪 Leave');
    mapBtn.addEventListener('click', () => this.onMap?.());
    leaveBtn.addEventListener('click', () => this.onLeave?.());
    this.listBtn.addEventListener('click', () => this.toggleList());
    this.soundBtn.textContent = muted ? '🔇' : '🔊';
    this.soundBtn.addEventListener('click', () => {
      const m = this.onSound?.();
      this.soundBtn.textContent = m ? '🔇' : '🔊';
    });
    const optionsBtn = h('button', { class: 'btn', title: 'Options (O)' }, '⚙️');
    optionsBtn.addEventListener('click', () => this.onOptions?.());
    this.buttons.append(this.listBtn, mapBtn, this.soundBtn, optionsBtn, leaveBtn);
    this.setHint(false);
    root.append(this.tagLayer, this.clock, this.buttons, this.sessions, this.prompt, this.toasts, this.hint, this.card);
    this.refreshClock();
    setInterval(() => this.refreshClock(), 10_000);
  }

  /** The key hints at the bottom left (they change while driving the kart). */
  setHint(driving: boolean) {
    this.hint.innerHTML = driving
      ? '<kbd>W</kbd>/<kbd>S</kbd> drive · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>Space</kbd> + steer drift · <kbd>E</kbd> get out · <kbd>K</kbd> park · <kbd>M</kbd> map · <kbd>Esc</kbd> leave'
      : '<kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> talk · <kbd>T</kbd> mailbox · <kbd>M</kbd> map · <kbd>Tab</kbd>/<kbd>V</kbd> villagers · <kbd>I</kbd> pockets · <kbd>O</kbd> options · <kbd>Esc</kbd> leave · scroll to zoom';
  }

  /** Shows the island's time (the debug time override moves it too). */
  refreshClock() {
    const t = this.island.clockTime();
    const d = new Date();
    d.setHours(t.h, Math.floor(t.m));
    this.timeEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.dateEl.textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  setCoins(n: number) {
    this.coinsEl.textContent = `🪙 ${n.toLocaleString()}`;
  }

  /** The big "You caught…!" card. */
  showCatch(o: { emoji: string; title: string; sub: string; quip?: string; badge?: string }) {
    this.card.innerHTML = '';
    this.card.append(h('div', { class: 'catch-emoji' }, o.emoji), h('div', { class: 'catch-title' }, o.title), h('div', { class: 'catch-sub' }, o.sub));
    if (o.quip) this.card.append(h('div', { class: 'catch-quip' }, `“${o.quip}”`));
    if (o.badge) this.card.append(h('div', { class: 'catch-badge' }, o.badge));
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('show'), 3800);
  }

  get listOpen() {
    return this.sessions.classList.contains('show');
  }

  private listSel = 0;
  private listed: SessionSummary[] = [];

  toggleList(force?: boolean) {
    const show = force ?? !this.sessions.classList.contains('show');
    this.sessions.classList.toggle('show', show);
    if (show) {
      this.listSel = 0;
      this.renderSessions();
    }
  }

  /** W/S or ↑/↓ in the villagers list. */
  moveList(dir: 1 | -1) {
    if (!this.listed.length) return;
    this.listSel = (this.listSel + dir + this.listed.length) % this.listed.length;
    this.paintListSel();
  }

  /** Enter in the villagers list: travel to the highlighted villager. */
  pickList() {
    const s = this.listed[this.listSel];
    if (s) this.onTravel?.(s);
  }

  private paintListSel() {
    const rows = [...this.sessions.querySelectorAll<HTMLElement>('.srow')];
    rows.forEach((r, i) => r.classList.toggle('kbd-sel', i === this.listSel));
    rows[this.listSel]?.scrollIntoView({ block: 'nearest' });
  }

  toast(text: string, level: 'info' | 'error' = 'info') {
    const t = h('div', { class: 'toast' + (level === 'error' ? ' error' : '') }, text);
    this.toasts.append(t);
    setTimeout(() => t.remove(), level === 'error' ? 7000 : 4000);
  }

  renderSessions() {
    const live = this.store.live();
    const needs = live.filter((s) => ['waiting', 'done', 'error'].includes(statusOf(s))).length;
    this.listBtn.innerHTML = '';
    this.listBtn.append('📋 Villagers');
    if (needs) this.listBtn.append(h('span', { class: 'badge' }, String(needs)));
    if (!this.sessions.classList.contains('show')) return;
    const selId = this.listed[this.listSel]?.id;
    this.sessions.innerHTML = '';
    this.sessions.append(h('h3', {}, `Busy villagers (${live.length})`));
    const order = { waiting: 0, done: 1, error: 2, working: 3, starting: 4, idle: 5, closed: 6 } as Record<string, number>;
    this.listed = live.sort((a, b) => order[statusOf(a)] - order[statusOf(b)] || b.updatedAt - a.updatedAt);
    if (!live.length) {
      this.sessions.append(h('div', { class: 'empty' }, 'Everyone is relaxing on their porch. Walk up to someone and give them a job!'));
      return;
    }
    const kept = this.listed.findIndex((s) => s.id === selId);
    this.listSel = kept >= 0 ? kept : Math.min(this.listSel, this.listed.length - 1);
    this.listed.forEach((s, i) => {
      const actor = this.island.director.actorForSession(s);
      const st = statusOf(s);
      const gnomes = s.agents.filter((a) => a.status === 'running').length;
      const row = h('div', { class: 'srow', title: s.title },
        h('div', { class: 'face' }, SPECIES_EMOJI[actor?.look.species ?? 'human']),
        h('div', { class: 'who' },
          h('div', { class: 'name' }, actor?.name ?? s.mercenary?.name ?? 'Villager'),
          h('div', { class: 'where' }, `${s.buildingId.split('/').pop()}${gnomes ? ` · 🧙 ${gnomes} gnome${gnomes > 1 ? 's' : ''}` : ''}`),
          h('div', { class: 'thread' }, s.title)),
        h('span', { class: `status-chip st-${st}` }, STATUS_LABEL[st]));
      row.addEventListener('click', () => this.onTravel?.(s));
      row.addEventListener('mouseenter', () => {
        this.listSel = i;
        this.paintListSel();
      });
      this.sessions.append(row);
    });
    this.sessions.append(h('div', { class: 'list-hint' }, 'W/S or ↑/↓ to pick · Enter to travel · Tab/V/Esc to close'));
    this.paintListSel();
  }

  private promptText?: string;

  setPrompt(label?: string) {
    if (label === this.promptText) return;
    this.promptText = label;
    if (!label) {
      this.prompt.classList.remove('show');
      return;
    }
    this.prompt.innerHTML = '';
    this.prompt.append(h('kbd', {}, 'E'), label);
    this.prompt.classList.add('show');
  }

  /** Floating name tags above nearby villagers (and anyone waving for attention). */
  updateTags(camera: THREE.Camera, focus?: Actor) {
    const player = this.island.player.pos;
    let used = 0;
    const W = window.innerWidth, H = window.innerHeight;
    for (const a of this.island.director.actors.values()) {
      if (!a.char.root.visible) continue;
      const d = a.pos.distanceTo(player);
      const s = this.island.director.sessionOf(a);
      const attn = s && ['waiting', 'done', 'error'].includes(statusOf(s));
      if (d > 11 && !attn && a !== focus) continue;
      if (d > 60) continue;
      const height = a.kind === 'gnome' ? 1.45 : 2.05;
      this.v.set(a.pos.x, a.pos.y + height + (a.char.emote.kind ? 0.9 * a.char.scale : 0), a.pos.z);
      curvedProject(this.v, camera, this.v);
      if (this.v.z > 1) continue;
      const x = (this.v.x * 0.5 + 0.5) * W;
      const y = (-this.v.y * 0.5 + 0.5) * H;
      if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
      let tag = this.tags[used];
      if (!tag) {
        tag = h('div', { class: 'tag' });
        this.tags.push(tag);
        this.tagLayer.append(tag);
      }
      used++;
      tag.className = 'tag' + (attn ? ' attn' : '') + (a.kind === 'gnome' ? ' gnome' : '');
      const sub = a.kind === 'gnome'
        ? (a.agent?.mode === 'write' ? 'working' : 'reading')
        : s ? STATUS_LABEL[statusOf(s)] : a.kind === 'npc' ? '' : a.building?.name.split('/').pop() ?? '';
      tag.innerHTML = '';
      tag.append(a.name);
      if (sub) tag.append(h('span', { class: 'sub' }, sub));
      tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      tag.style.display = 'block';
    }
    for (let i = used; i < this.tags.length; i++) this.tags[i].style.display = 'none';
  }
}

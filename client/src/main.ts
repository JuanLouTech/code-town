import './migrate.ts';
import * as THREE from 'three';
import './styles.css';
import type { SessionSummary, WorldState } from '../../shared/protocol.ts';
import { Flows, type App } from './flows.ts';
import { FunFair, type FairSpot } from './funfair.ts';
import { Garage } from './garage.ts';
import { curvedProject } from './game/engine.ts';
import { Island } from './game/island.ts';
import { buildingCenter } from './game/layout.ts';
import { isTyping } from './game/player.ts';
import type { Actor } from './game/villagers.ts';
import { Net, Store } from './net.ts';
import { Saves } from './save.ts';
import { applySettings, loadSettings, openSettings } from './settings.ts';
import { Voice } from './ui/audio.ts';
import { Dialog } from './ui/dialog.ts';
import { Hud, statusOf } from './ui/hud.ts';
import { scrollKey } from './ui/keys.ts';
import { IslandMap } from './ui/map.ts';
import { Panel, h } from './ui/panel.ts';
import { Mailboxes } from './ui/terminal.ts';
import { Pockets } from './ui/pockets.ts';
import { Activities, type Activity, type DayState } from './game/activities.ts';

const ui = document.getElementById('ui')!;
const store = new Store();
const net = new Net(store);
const saves = new Saves(net);
const island = new Island(document.getElementById('game')!);
const settings = loadSettings();
applySettings(settings, island);
const voice = new Voice();
const dialog = new Dialog(ui, voice);
const panel = new Panel(ui);
const hud = new Hud(ui, store, island, voice.muted);
const map = new IslandMap(ui, island, store);
const mailboxes = new Mailboxes(ui, net, store);
mailboxes.onChange = (open) => island.setOpenMailboxes(open);
mailboxes.onToast = (text) => hud.toast(text);
dialog.onToast = (text) => hud.toast(text, 'error');
const pockets = new Pockets(saves);
const activities = new Activities(island);
island.engine.scene.add(activities.group);
island.setGrowth(saves.local<Record<string, number>>('growth') ?? {});
island.onGrowth = (g) => saves.set('growth', g);
activities.setDay(saves.local<DayState>('day'));
activities.onDay = (d) => saves.set('day', d);
const garage = new Garage(island, pockets, hud, voice);
const app: App = { island, store, net, dialog, panel, hud, voice, map, mailboxes, pockets, garage };
const funfair = new FunFair(ui, island, garage, panel, hud, voice, saves, pockets);

// --- minigames -------------------------------------------------------------------------

hud.setCoins(pockets.data.coins);
pockets.onChange = () => hud.setCoins(pockets.data.coins);
const dressPlayer = () => {
  const d = pockets.data, look = island.player.char.look;
  if (look.hat === d.hat && look.shirt === d.shirt && look.hatColor === d.hatColor) return;
  island.player.setLook({ hat: d.hat as never, shirt: d.shirt, hatColor: d.hatColor });
};
dressPlayer();

/** Progress lives on the server (localStorage is only a per-origin cache). */
function applySaves(player: Record<string, unknown> | undefined) {
  const got = saves.sync(player, {
    pockets: Pockets.merge,
    growth: (a: Record<string, number>, b: Record<string, number>) => {
      const out = { ...b };
      for (const [k, v] of Object.entries(a)) out[k] = Math.max(v, out[k] ?? 0);
      return out;
    },
    day: null,
    circuit: (a: { board?: { timeMs: number }[] }, b: { board?: { timeMs: number }[] }) =>
      ({ board: [...(a.board ?? []), ...(b.board ?? [])].sort((x, y) => x.timeMs - y.timeMs).slice(0, 10) }),
    nonogram: null,
  });
  for (const [key, value] of Object.entries(got)) applySave(key, value);
  if (island.world) garage.restore();
}

function applySave(key: string, value: unknown) {
  if (key === 'pockets') {
    pockets.replace(value as never);
    dressPlayer();
    if (island.world) garage.restore();
  } else if (key === 'growth') island.setGrowth(value as Record<string, number>);
  else if (key === 'day') activities.setDay(value as DayState);
  // races / nonogram are read from the saves when needed
}
saves.onRemote = applySave;
activities.onMessage = (text) => hud.toast(text);
activities.onSound = (k) => (k === 'splash' ? voice.splash() : k === 'bite' ? voice.bite() : k === 'dig' ? voice.dig() : voice.pop());
activities.onCatch = ({ item, size }) => {
  if (item.id === 'coins') {
    pockets.addCoins(item.value);
    hud.showCatch({ emoji: '💰', title: 'You dug up a bag of coins!', sub: `+${item.value} coins` });
    voice.fanfare();
    return true;
  }
  const res = pockets.add(item.id, size);
  if (!res) {
    hud.toast('Your pockets are full! Sell your finds at Kip’s stall on the plaza. 🎒', 'error');
    return false;
  }
  const verb = item.category === 'fish' ? 'caught' : item.category === 'bug' ? 'caught' : item.category === 'fossil' ? 'dug up' : 'found';
  const article = /^[AEIOU]/i.test(item.name) ? 'an' : 'a';
  hud.showCatch({
    emoji: item.emoji,
    title: `You ${verb} ${item.name.startsWith('The ') ? item.name : `${article} ${item.name}`}!`,
    sub: [size ? `${size} cm` : '', `🪙 ${item.value.toLocaleString()}`, '★'.repeat(item.rarity)].filter(Boolean).join(' · '),
    quip: item.quip,
    badge: res.first ? 'NEW!' : res.record ? 'RECORD!' : undefined,
  });
  voice.fanfare();
  return true;
};
const flows = new Flows(app);

// --- splash --------------------------------------------------------------------------

const status = h('div', { class: 'status' }, 'Rowing to the island…');
const startBtn = h('button', { class: 'btn primary' }, '▶ Visit the island') as HTMLButtonElement;
startBtn.disabled = true;
const splash = h('div', { class: 'splash' },
  h('div', { class: 'logo' }, 'Code Town ', h('span', { class: 'leaf' }, '🍃')),
  h('div', { class: 'tagline' }, 'Every folder a farm · every session a villager'),
  status, startBtn);
document.body.append(splash);
let started = false;
const begin = () => {
  if (started || startBtn.disabled) return;
  started = true;
  voice.unlock();
  voice.pop();
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 700);
};
startBtn.addEventListener('click', begin);

net.onStatus = (ok) => {
  if (!ok) {
    status.textContent = 'Lost the ferry connection… retrying 🚣';
    if (started) hud.toast('Connection to the island lost — reconnecting…', 'error');
  }
};

// --- store → game --------------------------------------------------------------------

let lastWorld: WorldState | undefined;
const attention = new Map<string, boolean>();

function needsYou(s: SessionSummary) {
  return ['waiting', 'done', 'error'].includes(statusOf(s));
}

function nameFor(s: SessionSummary) {
  return island.director.actorForSession(s)?.name ?? s.mercenary?.name ?? 'A villager';
}

function updateTitle() {
  const n = store.live().filter(needsYou).length;
  document.title = n ? `(${n}❗) Code Town` : 'Code Town';
}

let outsideKey = '';
/** Pumpkins (worktrees) and visitors (terminal sessions); rebuilt only when something they show changed. */
function refreshOutside(force = false) {
  const w = island.world;
  if (!w || !island.occ) return;
  const inside = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir + '/');
  const busy = new Set(store.worktrees.filter((wt) =>
    store.live().some((s) => inside(s.cwd, wt.path)) || store.visitors.some((v) => inside(v.cwd, wt.path))).map((wt) => wt.path));
  const key = JSON.stringify([w.version, store.worktrees, [...busy]]);
  if (force || key !== outsideKey) {
    outsideKey = key;
    island.pumpkins.set(w, island.occ, store.worktrees, busy);
  }
  island.director.setVisitors(store.visitors);
}

function setWorld(w: WorldState) {
  const before = new Set(lastWorld?.properties.flatMap((p) => p.buildings.map((b) => b.id)) ?? []);
  const hadWorld = Boolean(lastWorld);
  lastWorld = w;
  island.setWorld(w);
  activities.setWorld();
  garage.restore();
  refreshOutside(true);
  if (map.isOpen) map.draw();
  if (!hadWorld) return;
  for (const p of w.properties) {
    for (const b of p.buildings) {
      if (before.has(b.id)) continue;
      const c = buildingCenter(w, b);
      island.effects.poof(new THREE.Vector3(c.x, 1, c.z - 3), 24, '#f5efe6', 2.4);
      hud.toast(`🏗️ A new ${b.role === 'child' ? 'building' : 'property'} appeared: ${b.id}`);
    }
  }
}

// Signs are drawn onto canvases, so wait for the rounded font before building the world.
const fontsReady = Promise.race([
  document.fonts.load('800 40px Nunito').then(() => document.fonts.ready),
  new Promise((r) => setTimeout(r, 2500)),
]);

store.on((msg) => void fontsReady.then(() => handle(msg)));

function handle(msg: Parameters<Parameters<Store['on']>[0]>[0]) {
  switch (msg.t) {
    case 'hello': {
      applySaves(msg.player);
      if (!lastWorld || lastWorld.version !== msg.world.version) setWorld(msg.world);
      island.setSessions(msg.sessions);
      refreshOutside();
      for (const s of msg.sessions) attention.set(s.id, needsYou(s));
      const props = msg.world.properties.length;
      const buildings = msg.world.properties.reduce((a, p) => a + p.buildings.length, 0);
      status.textContent = `${props} properties · ${buildings} buildings · ${msg.sessions.filter((s) => s.status !== 'closed').length} busy villagers` +
        (msg.claudeVersion ? ` · ${msg.claudeVersion}` : '');
      startBtn.disabled = false;
      hud.renderSessions();
      updateTitle();
      break;
    }
    case 'world':
      setWorld(msg.world);
      break;
    case 'session': {
      const s = msg.session;
      island.upsertSession(s);
      const now = needsYou(s) && s.status !== 'closed';
      if (now && !attention.get(s.id)) {
        voice.chime();
        const b = s.buildingId.split('/').pop();
        const what = s.status === 'waiting' ? 'has a question' : s.status === 'error' ? 'ran into trouble' : 'finished a job';
        hud.toast(`❗ ${nameFor(s)} ${what} at ${b}`);
      }
      attention.set(s.id, now);
      hud.renderSessions();
      updateTitle();
      refreshOutside();
      break;
    }
    case 'worktrees':
      refreshOutside();
      break;
    case 'player':
      saves.remote(msg.key, msg.value);
      break;
    case 'sessionRemoved':
      island.removeSession(msg.id);
      attention.delete(msg.id);
      hud.renderSessions();
      updateTitle();
      break;
    case 'toast':
      hud.toast(msg.text, msg.level);
      break;
    case 'bye':
      goodbye(msg.stopped);
      break;
    default:
      break;
  }
}

// --- HUD wiring ------------------------------------------------------------------------

hud.onMap = () => map.toggle();
hud.onSound = () => voice.toggle();
hud.onOptions = () => {
  if (!dialog.isOpen) openSettings(panel, settings, island);
};
hud.onTravel = (s) => {
  const b = store.world?.properties.flatMap((p) => p.buildings).find((x) => x.id === s.buildingId);
  const a = island.director.actorForSession(s);
  if (b) island.travelToBuilding(b);
  else if (a) island.travelTo(a.pos);
  hud.toggleList(false);
};
map.onTravel = (p) => island.travelTo(p);
map.onPick = (t) => {
  if (t.kind === 'building') island.travelToBuilding(t.building);
  else if (t.kind === 'fair' && island.fair) island.travelTo(island.fair.entrance);
  else if (t.kind === 'circuit' && island.circuit) island.travelTo(island.circuit.entrance);
  else island.travelTo(new THREE.Vector3(t.x, 0, t.z));
};
map.onMailbox = (b) => mailboxes.open(b);
map.onArrange = (change) => net.send({ t: 'arrange', ...change });
hud.onLeave = async () => {
  if (await flows.confirmLeave()) {
    leaving = true;
    net.send({ t: 'exit' });
  }
};

let leaving = false;
function goodbye(stopped: number) {
  mailboxes.closeAll();
  if (!leaving) {
    hud.toast(`Someone closed the island — ${stopped} session(s) stopped.`, 'error');
    return;
  }
  const back = h('button', { class: 'btn primary' }, '🏝️ Back to the island');
  back.addEventListener('click', () => location.reload());
  document.body.append(h('div', { class: 'splash' },
    h('div', { class: 'logo' }, 'See you soon! 🌙'),
    h('div', { class: 'tagline' }, stopped ? `${stopped} session${stopped === 1 ? ' was' : 's were'} stopped. Everyone is back on their porch.` : 'The island is quiet. Sweet dreams!'),
    h('div', { class: 'status' }, 'You can close this tab now.'),
    back));
}

// Closing the tab: warn if work is running, and tell the server we left (it stops everything
// after a short grace period unless the page comes back, e.g. on a reload).
window.addEventListener('beforeunload', (e) => {
  if (!leaving && store.live().some((s) => s.status === 'working' || s.status === 'waiting' || s.status === 'starting')) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  if (!leaving) navigator.sendBeacon('/api/leave');
});

// --- input -----------------------------------------------------------------------------

function talkTo(actor: Actor) {
  if (flows.talking || dialog.isOpen || panel.isOpen) return;
  void flows.talk(actor);
}

type Focus =
  | { kind: 'actor'; actor: Actor }
  | { kind: 'mail'; building: import('../../shared/protocol.ts').Building }
  | { kind: 'activity'; activity: Activity }
  | { kind: 'kart' }
  | { kind: 'pumpkin'; wt: import('../../shared/protocol.ts').WorktreeInfo }
  | { kind: 'fair'; spot: FairSpot };
let focus: Focus | undefined;

function interact(f: Focus | undefined) {
  if (f?.kind === 'fair') {
    funfair.interact(f.spot);
    return;
  }
  // Talking, mail or minigames from the kart: climb out first.
  if (garage.driving) garage.exit();
  if (!f) return;
  if (f.kind === 'actor') talkTo(f.actor);
  else if (f.kind === 'mail') mailboxes.open(f.building);
  else if (f.kind === 'kart') garage.enter();
  else if (f.kind === 'pumpkin') void flows.pumpkin(f.wt);
  else activities.start(f.activity);
}

// The conversation scroll shortcut works everywhere, even while typing a reply.
window.addEventListener('keydown', (e) => {
  const dir = scrollKey(e);
  if (!dir || (e.target as HTMLElement)?.closest?.('.letter')) return;
  const target = panel.isOpen ? panel.bodyEl() : dialog.isOpen ? dialog : null;
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  if (target === dialog) dialog.scrollText(dir * 70);
  else (target as HTMLElement).scrollBy({ top: dir * 90 });
}, true);

/** T on the island: the mailbox of the property you're standing in. */
function mailboxHere() {
  const b = island.buildingAt(island.player.pos.x, island.player.pos.z);
  if (b) mailboxes.open(b);
  else hud.toast('📮 Walk into a property to open its mailbox (or press T on the map).');
}

window.addEventListener('keydown', (e) => {
  if (!started) {
    if (e.code === 'Enter' || e.code === 'Space') begin();
    return;
  }
  // Terminals get every key, Esc included (vim, less, …).
  if ((e.target as HTMLElement)?.closest?.('.letter')) return;
  if (isTyping(e)) {
    if (e.code === 'Escape') {
      const field = e.target as HTMLInputElement | HTMLTextAreaElement;
      // An empty field means nothing to lose: Esc closes the notebook straight away.
      if (panel.isOpen && !field.value?.trim()) panel.escape();
      else field.blur();
    }
    return;
  }
  if (panel.isOpen) {
    if (e.code === 'Escape') panel.escape();
    else if (e.code === 'KeyR' && panel.minimizable) panel.close('minimize');
    else if (e.code === 'KeyI' && panel.kind === 'pockets') panel.close();
    else if (e.code === 'KeyO' && panel.kind === 'options') panel.close();
    return;
  }
  if (map.isOpen) {
    if (map.handleKey(e)) e.preventDefault();
    return;
  }
  if (dialog.isOpen) {
    if (dialog.handleKey(e)) e.preventDefault();
    return;
  }
  if (activities.busy) {
    if (activities.handleKey(e)) e.preventDefault();
    return;
  }
  if (hud.listOpen) {
    const used = listKey(e);
    if (used) {
      e.preventDefault();
      return;
    }
  }
  if (funfair.handleKey(e)) {
    e.preventDefault();
    return;
  }
  // Mid-race only driving counts: no map travel, mailboxes, pockets or lists.
  if (funfair.racing && ['KeyM', 'KeyT', 'KeyI', 'KeyO', 'Tab', 'KeyV', 'KeyK', 'KeyE', 'Enter'].includes(e.code)) {
    e.preventDefault();
    return;
  }
  // Holding a key down must not repeat these (hop, get in and out, talk…).
  if (e.repeat && ['Space', 'KeyE', 'Enter', 'KeyK', 'KeyT', 'KeyM', 'KeyI', 'KeyO', 'Tab', 'KeyV'].includes(e.code)) {
    e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'KeyE':
    case 'Enter':
      if (focus || garage.driving) {
        e.preventDefault();
        interact(focus);
      }
      break;
    case 'KeyK':
      garage.toggle();
      break;
    case 'Space':
      e.preventDefault();
      island.player.jump();
      break;
    case 'KeyM':
      map.open();
      break;
    case 'KeyT':
      mailboxHere();
      break;
    case 'KeyI':
      void pockets.open(panel);
      break;
    case 'KeyO':
      openSettings(panel, settings, island);
      break;
    case 'Tab':
    case 'KeyV':
      e.preventDefault();
      hud.toggleList();
      break;
    case 'Escape':
      void hud.onLeave?.();
      break;
    case 'KeyN':
      // Debug helper: cycle the time of day.
      if (e.shiftKey) {
        island.hourOverride = ((island.hourOverride ?? new Date().getHours()) + 2) % 24;
        hud.refreshClock();
      }
      break;
    default:
      break;
  }
});

/** Keys while the villagers list is open: move, pick, close. */
function listKey(e: KeyboardEvent): boolean {
  switch (e.code) {
    case 'KeyW':
    case 'ArrowUp':
      hud.moveList(-1);
      return true;
    case 'KeyS':
    case 'ArrowDown':
      hud.moveList(1);
      return true;
    case 'Enter':
    case 'KeyE':
      hud.pickList();
      return true;
    case 'Tab':
    case 'KeyV':
    case 'Escape':
      hud.toggleList(false);
      return true;
    case 'KeyA':
    case 'KeyD':
    case 'ArrowLeft':
    case 'ArrowRight':
      return true;
    default:
      return false;
  }
}

hud.prompt.addEventListener('click', () => focus && interact(focus));

// Dropping a file anywhere but a chat box must not navigate away from the island.
const draggingFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));
window.addEventListener('dragover', (e) => draggingFiles(e) && e.preventDefault());
window.addEventListener('drop', (e) => draggingFiles(e) && e.preventDefault());

// A trackpad pinch reaches the page as Ctrl+wheel (gesture events in Safari). Left alone it zooms the
// browser's visual viewport, which no window resize undoes: the HUD and panels stay cropped and
// oversized. The camera already zooms on the wheel; the page itself never should.
window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault());

// Buttons shouldn't keep keyboard focus, or Space/E would press them again.
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest?.('button');
  if (b && !b.closest('.panel')) b.blur();
});

// Click on a villager to walk over and talk; click on the ground to walk there.
const canvas = island.engine.renderer.domElement;
let downAt: { x: number; y: number } | undefined;
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!started || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
  if (dialog.isOpen || panel.isOpen || map.isOpen || garage.driving) return;
  const cam = island.engine.camera;
  const v = new THREE.Vector3();
  let best: Actor | undefined;
  let bestD = 48;
  for (const a of island.director.actors.values()) {
    if (!a.char.root.visible) continue;
    v.set(a.pos.x, a.pos.y + (a.kind === 'gnome' ? 0.6 : 1.1), a.pos.z);
    curvedProject(v, cam, v);
    if (v.z > 1) continue;
    const d = Math.hypot((v.x * 0.5 + 0.5) * innerWidth - e.clientX, (-v.y * 0.5 + 0.5) * innerHeight - e.clientY);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  const player = island.player;
  if (best) {
    const a = best;
    const dir = player.pos.clone().sub(a.pos).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    const target = a.pos.clone().add(dir.normalize().multiplyScalar(1.5));
    if (player.pos.distanceTo(a.pos) < 2.4) talkTo(a);
    else {
      player.autoTarget = target;
      player.onAutoArrive = () => talkTo(a);
    }
    return;
  }
  const ground = pickGround(e.clientX, e.clientY);
  if (ground) {
    player.autoTarget = ground;
    player.onAutoArrive = undefined;
  }
});

/** Finds the ground point under the cursor, undoing the curved-world bend with a few Newton steps. */
function pickGround(cx: number, cy: number): THREE.Vector3 | undefined {
  const cam = island.engine.camera;
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, cam);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return undefined;
  const f = (q: THREE.Vector3) => {
    const s = curvedProject(q, cam, new THREE.Vector3());
    return new THREE.Vector2(s.x - ndc.x, s.y - ndc.y);
  };
  for (let i = 0; i < 8; i++) {
    const r = f(p);
    if (r.length() < 1e-4) break;
    const e = 0.05;
    const fx = f(p.clone().add(new THREE.Vector3(e, 0, 0))).sub(r).divideScalar(e);
    const fz = f(p.clone().add(new THREE.Vector3(0, 0, e))).sub(r).divideScalar(e);
    const det = fx.x * fz.y - fz.x * fx.y;
    if (Math.abs(det) < 1e-9) break;
    p.x -= (r.x * fz.y - fz.x * r.y) / det;
    p.z -= (fx.x * r.y - r.x * fx.y) / det;
  }
  return p.distanceTo(island.player.pos) < 80 ? p : undefined;
}

// --- per-frame UI ------------------------------------------------------------------------

island.engine.onTick((dt, t) => {
  activities.update(dt, t);
  const blocked = dialog.isOpen || panel.isOpen || map.isOpen || hud.listOpen || !started;
  island.player.enabled = !blocked;
  const p = island.player;
  const actor = blocked ? undefined : island.director.nearest(p.pos, p.facing);
  const mail = blocked ? undefined : island.nearestMailbox(p.pos, p.facing);
  const act = blocked || actor || mail || p.driving ? undefined : activities.find(p.pos, p.facing);
  const fairSpot = blocked ? undefined : funfair.spotAt(p.pos);
  const pumpkin = blocked || p.driving || actor || mail ? undefined : island.pumpkins.nearest(p.pos);
  garage.update(dt);
  funfair.update(dt);
  if (activities.busy) {
    focus = undefined;
    hud.setPrompt(undefined);
  } else if (fairSpot && !actor && !mail) {
    focus = { kind: 'fair', spot: fairSpot.kind };
    hud.setPrompt(fairSpot.label);
  } else if (pumpkin) {
    focus = { kind: 'pumpkin', wt: pumpkin.wt };
    hud.setPrompt(`🎃 Worktree · ${pumpkin.wt.branch ?? 'detached HEAD'}`);
  } else if (!blocked && !actor && !mail && garage.near(p.pos)) {
    focus = { kind: 'kart' };
    hud.setPrompt('🏎️ Get in the kart');
  } else if (mail && (!actor || mail.score < actor.pos.distanceTo(p.pos) - 0.4)) {
    focus = { kind: 'mail', building: mail.mailbox.building };
    hud.setPrompt(`📮 Mailbox · ${mail.mailbox.building.name.split('/').pop()} (terminal)`);
  } else if (actor) {
    focus = { kind: 'actor', actor };
    hud.setPrompt(`Talk to ${actor.name}`);
  } else if (act) {
    focus = { kind: 'activity', activity: act };
    hud.setPrompt(act.label);
  } else {
    focus = undefined;
    hud.setPrompt(p.driving && !blocked && !funfair.racing ? '🏎️ Get out' : undefined);
  }
  hud.updateTags(island.engine.camera, actor);
});

void fontsReady.then(() => island.start());

if (import.meta.env.DEV) (window as unknown as { codetown: unknown }).codetown = { ...app, activities };

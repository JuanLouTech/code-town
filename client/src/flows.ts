import type { Building, HistoryItem, PendingRequest, SessionSummary, ServerMsg, StartOptions, WorktreeInfo } from '../../shared/protocol.ts';
import { PERMISSION_CHOICES } from '../../shared/protocol.ts';
import type { Island } from './game/island.ts';
import type { Actor } from './game/villagers.ts';
import type { Net, Store } from './net.ts';
import type { Voice } from './ui/audio.ts';
import { INTERRUPTED, type Dialog, type Interrupted } from './ui/dialog.ts';
import {
  confirmBox, historyPicker, jobForm, nameForm, pendingCard, pickBuilding, resumeForm, timeAgo,
} from './ui/forms.ts';
import { SPECIES_EMOJI, STATUS_LABEL, colorFor, statusOf, type Hud } from './ui/hud.ts';
import type { IslandMap } from './ui/map.ts';
import { escapeHtml, mdElement } from './ui/markdown.ts';
import { fileDrop, filePaste } from './ui/drop.ts';
import { scrollKeyLabel } from './ui/keys.ts';
import { h, type CloseReason, type Panel } from './ui/panel.ts';
import { LOCAL_COMMANDS, SlashMenu, type CommandInfo } from './ui/slash.ts';
import type { Mailboxes } from './ui/terminal.ts';
import type { Pockets } from './ui/pockets.ts';
import { COLOR_NAMES, HATS, KART, SHIRTS } from './game/catalog.ts';
import { TranscriptView } from './ui/transcript.ts';

export interface App {
  island: Island;
  store: Store;
  net: Net;
  dialog: Dialog;
  panel: Panel;
  hud: Hud;
  voice: Voice;
  map: IslandMap;
  mailboxes: Mailboxes;
  pockets: Pockets;
  garage: Garage;
}

/** What the shop needs from the go-kart. */
export interface Garage {
  /** Parks the (just bought) kart next to the player. */
  deliver(): void;
  paint(color: string): void;
}

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const HELLOS = ['Oh, hi there!', 'Hey hey!', 'Well, hello!', 'Howdy, neighbour!', 'Oh! You startled me!', 'Hiya!'];
const BYES = ['See you around! 🌸', 'Have a lovely day!', 'Come back anytime!', 'Toodle-oo!', 'Bye bye! 👋'];
const THINKING = ['Hmm, let me think… 🤔', 'Ooh, good one. Thinking… 💭', 'Let me see… 🧐', 'On it! Give me a sec… 🌱'];

function place(b: Building) {
  return b.role === 'main' ? `the **${b.name}** town hall` : `**${b.name.split('/').pop()}**`;
}

function codeify(s: string) {
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Which "screen" of the live conversation a session state calls for. */
function viewKey(s: SessionSummary, asideSeen: number): string {
  if (s.status === 'waiting' && s.pending) return `p:${s.pending.id}`;
  if (s.aside?.answer && s.aside.ts > asideSeen) return `a:${s.aside.ts}`;
  if (s.status === 'working' || s.status === 'starting') return 'w';
  if (s.status === 'error') return `e:${s.turns}`;
  return `r:${s.turns}`;
}

function workingStatus(s: SessionSummary) {
  const label = s.activity?.label ?? (s.status === 'starting' ? 'Getting ready' : 'Thinking');
  const gnomes = s.agents.filter((a) => a.status === 'running').length;
  return `🌱 ${codeify(label)}` +
    (gnomes ? ` · 🧙 ${gnomes} gnome${gnomes > 1 ? 's' : ''}` : '') +
    (s.aside && !s.aside.answer ? (isBang(s.aside.question) ? ' · 💻 running your command' : ' · 💭 side question') : '');
}

/** `! cmd` runs a shell command (bash mode); its output comes back as a side note. */
const isBang = (text: string) => text.startsWith('!');

export class Flows {
  talking?: Actor;
  /** A conversation that isn't with a villager (a pumpkin) is on screen. */
  private chatting = false;
  private wantExpand = false;
  private changeHook?: () => void;

  constructor(private app: App) {
    app.store.on((msg) => {
      if (msg.t === 'session' || msg.t === 'sessionRemoved') this.changeHook?.();
    });
  }

  commandsFor(id: string): CommandInfo[] {
    const seen = new Set<string>();
    const out: CommandInfo[] = [];
    for (const c of [...LOCAL_COMMANDS, ...(this.app.store.commands.get(id) ?? [])]) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
    return out;
  }

  private waitSession(id: string, pred: (s: SessionSummary) => boolean, timeout: number) {
    return new Promise<void>((resolve) => {
      const check = () => {
        const s = this.app.store.sessions.get(id);
        if (!s || pred(s)) {
          off();
          clearTimeout(timer);
          resolve();
        }
      };
      const off = this.app.store.on((msg) => {
        if (msg.t === 'session' || msg.t === 'sessionRemoved') check();
      });
      const timer = setTimeout(() => {
        off();
        resolve();
      }, timeout);
      check();
    });
  }

  async talk(actor: Actor) {
    if (this.talking || this.chatting) return;
    const { island, dialog } = this.app;
    this.talking = actor;
    const player = island.player;
    player.enabled = false;
    player.clearKeys();
    player.autoTarget = undefined;
    actor.talking = true;
    actor.talkTarget = player.pos;
    player.facing = Math.atan2(actor.pos.x - player.pos.x, actor.pos.z - player.pos.z);
    dialog.open({ name: actor.name, color: colorFor(actor.look.species), voice: actor.voice });
    try {
      if (actor.id === 'npc:receptionist') await this.receptionist(actor);
      else if (actor.id === 'npc:architect') await this.architect();
      else if (actor.id === 'npc:shop') await this.shop();
      else if (actor.kind === 'gnome') await this.gnome(actor);
      else if (actor.kind === 'visitor') await this.visitor(actor);
      else {
        const s = island.director.sessionOf(actor);
        if (s) await this.live(actor, s.id);
        else await this.idle(actor);
      }
    } catch (err) {
      console.error(err);
    } finally {
      dialog.close();
      actor.talking = false;
      actor.talkTarget = undefined;
      // Hang around for a moment before walking off, in case there's a quick follow-up.
      actor.lingerUntil = actor.now + 3;
      this.talking = undefined;
    }
  }

  private mailbox(actor: Actor, sessionId?: string) {
    const s = sessionId ? this.app.store.sessions.get(sessionId) : undefined;
    const b = actor.building ?? this.app.store.world?.properties.flatMap((p) => p.buildings).find((x) => x.id === s?.buildingId);
    if (b) this.app.mailboxes.open(b, s?.cwd);
  }

  // --- residents -----------------------------------------------------------------

  private async idle(actor: Actor) {
    const { dialog } = this.app;
    const b = actor.building!;
    dialog.setTools([{ label: '📮 Mailbox', key: 'T', onClick: () => this.mailbox(actor) }]);
    const c = await dialog.ask(`${pick(HELLOS)} I'm **${actor.name}**, I look after ${place(b)}. Need something done?`, [
      { label: '🌱 I have a job for you', value: 'new' },
      { label: '📜 Let’s pick up an old job', value: 'resume' },
      { label: '📮 Open the mailbox (terminal)', value: 'mail' },
      { label: '👋 Just saying hi!', value: 'bye' },
    ], { cancel: 'bye' });
    if (c === 'new') await this.newJob(actor, b, false);
    else if (c === 'resume') await this.resume(actor, b);
    else if (c === 'mail') {
      this.mailbox(actor);
      await dialog.say('There you go! Whatever you write in the letter runs right here in my folder. ✉️');
    } else await dialog.say(pick(BYES));
  }

  private async newJob(actor: Actor, b: Building, hire: boolean) {
    const { dialog, panel, net, store } = this.app;
    const color = colorFor(actor.look.species);
    const job = await jobForm(panel, store.world!, b, {
      title: hire ? `🧑‍🌾 A farmhand for ${b.name}` : `🌱 A job for ${actor.name}`,
      who: hire ? 'the farmhand' : actor.name,
      color,
    });
    if (!job) {
      await dialog.say('No worries, maybe later!');
      return;
    }
    const res = await net.start({ buildingId: b.id, characterId: hire ? undefined : actor.id, hire, prompt: job.prompt, opts: job.opts });
    if (res.error || !res.id) {
      await dialog.say(`Oh no… ${escapeHtml(res.error ?? 'that didn’t work')}`);
      return;
    }
    if (hire) {
      const s = store.sessions.get(res.id);
      await dialog.say(`Wonderful! **${s?.mercenary?.name ?? 'A farmhand'}** is heading to ${place(b)} right now. 🧑‍🌾`);
      return;
    }
    // Stay in the conversation: quick questions get answered right here.
    await this.live(actor, res.id);
  }

  private async resume(actor: Actor, b: Building) {
    const { dialog, panel, net, store } = this.app;
    const color = colorFor(actor.look.species);
    void dialog.show('Let me check my notebook… 📒');
    const items = await net.history(b.id);
    if (!items.length) {
      await dialog.say('Hmm, my notebook is empty. We haven’t done any jobs here yet!');
      return;
    }
    for (;;) {
      const it = await historyPicker(panel, items, { title: `📒 ${actor.name}'s old jobs at ${b.name}`, color });
      if (!it) {
        await dialog.say('Alright, some other time!');
        return;
      }
      void dialog.show(`Ah yes, “${escapeHtml(it.title)}” from ${timeAgo(it.lastModified)}…`);
      const entries = await net.historyLoad(b.id, it.sessionId);
      const cont = await resumeForm(panel, store.world!, b, it, entries, { who: actor.name, color });
      if (!cont) continue;
      const res = await net.start({
        buildingId: b.id, characterId: actor.id, prompt: cont.prompt, opts: cont.opts, resume: it.sessionId, resumeCwd: it.cwd,
      });
      if (res.error || !res.id) await dialog.say(`Oh no… ${escapeHtml(res.error ?? 'that didn’t work')}`);
      else await this.live(actor, res.id);
      return;
    }
  }

  private async endSession(actor: Actor, s: SessionSummary) {
    this.app.net.send({ t: 'close', id: s.id });
    this.app.dialog.setStatus(null);
    await this.app.dialog.say(actor.kind === 'mercenary'
      ? 'It was a pleasure! Back to the Hiring Office I go. 🧑‍🌾'
      : 'Thanks! Time for a rest on my porch. 🪑');
  }

  /** Lets the player type a message inside the bubble. Handles island-only commands. */
  private async compose(actor: Actor, id: string, placeholder: string): Promise<string | null> {
    const { dialog, net } = this.app;
    const text = await dialog.input({ placeholder, commands: () => this.commandsFor(id) });
    if (!text) return null;
    if (/^\/mailbox\b/i.test(text)) {
      this.mailbox(actor, id);
      return null;
    }
    net.send({ t: 'send', id, text });
    if (!/^\/(btw|stop)\b/i.test(text) && !isBang(text)) {
      await this.waitSession(id, (s) => s.status === 'working' || s.status === 'starting' || s.status === 'waiting', 1500);
    }
    return text;
  }

  /**
   * A live conversation with a villager who has a session: the bubble follows
   * the session as it works, asks and answers, until the player walks away.
   */
  private async live(actor: Actor, id: string) {
    const { dialog, store, net } = this.app;
    const tools = () => dialog.setTools([
      { label: '📖 Conversation', key: 'R', onClick: () => { this.wantExpand = true; dialog.interrupt(); } },
      { label: '📮 Mailbox', key: 'T', onClick: () => this.mailbox(actor, id) },
    ]);
    tools();
    let asideSeen = store.sessions.get(id)?.aside?.ts ?? 0;
    let baseline: string | undefined; // the reply that was on screen when we last sent something
    let shownNarr: string | null | undefined;
    let shownTurn = -1;
    let prevKey = '';
    let instant = false;
    try {
      for (;;) {
        if (this.wantExpand) {
          this.wantExpand = false;
          dialog.setStatus(null);
          const how = await this.openConversation(actor, id, { attached: true, focus: true });
          if (how === 'close') return;
          prevKey = '';
          shownNarr = undefined;
          instant = true; // already read it in the notebook: no need to type it out again
          tools();
          continue;
        }
        const s = store.sessions.get(id);
        if (!s || s.status === 'closed') {
          dialog.setStatus(null);
          await dialog.say(s ? 'That job is all wrapped up! 🌾' : 'Looks like that job is gone.');
          return;
        }
        const key = viewKey(s, asideSeen);
        const fresh = key !== prevKey;
        prevKey = key;
        let onUpdate: (c: SessionSummary) => void = () => {};
        const changed = new Promise<Interrupted>((resolve) => {
          this.changeHook = () => {
            const c = store.sessions.get(id);
            if (!c || viewKey(c, asideSeen) !== key) resolve(INTERRUPTED);
            else onUpdate(c);
          };
        });
        const race = <T,>(p: Promise<T>) => Promise.race([p, changed]);

        if (key.startsWith('p:')) {
          if ((await this.pendingView(actor, s, s.pending!, race)) === 'exit') return;
          continue;
        }

        if (key.startsWith('a:')) {
          asideSeen = s.aside!.ts;
          dialog.setStatus(s.status === 'working' ? workingStatus(s) : null);
          const q = s.aside!.question;
          await dialog.show(isBang(q) ? `💻 \`${q}\`\n\n${s.aside!.answer}` : `💭 *About “${q}”…*\n\n${s.aside!.answer}`, { md: true });
          await race(dialog.choose([{ label: '👍 Thanks!', value: 'ok' }], { cancel: 'ok' }));
          shownNarr = undefined;
          continue;
        }

        if (key === 'w') {
          const render = (c: SessionSummary) => {
            const narr = c.lastText && c.lastText !== baseline ? c.lastText : null;
            if (narr !== shownNarr) {
              shownNarr = narr;
              void dialog.show(narr ?? (c.status === 'starting' ? 'Getting my tools ready… 🧰' : pick(THINKING)), { md: Boolean(narr), keepChoices: true });
            }
            dialog.setStatus(workingStatus(c));
          };
          if (fresh) shownNarr = undefined;
          render(s);
          onUpdate = render;
          const c = await race(dialog.choose([
            { label: '💬 Add something', value: 'msg' },
            { label: '💭 Quick side question (/btw)', value: 'btw' },
            { label: '✋ Stop what you’re doing', value: 'stop' },
            { label: '👋 Carry on!', value: 'bye' },
          ], { cancel: 'bye' }));
          if (c === INTERRUPTED) continue;
          if (c === 'bye') {
            dialog.setStatus(null);
            await dialog.say(pick(['Back to it then! 🌾', 'I’ll wave when I’m done! 👋', 'Off to the farm! 🧑‍🌾']));
            return;
          }
          if (c === 'stop') {
            net.send({ t: 'interrupt', id });
            await dialog.show('Okay, putting my tools down! ✋', { keepChoices: true });
            await this.waitSession(id, (x) => x.status !== 'working' && x.status !== 'starting', 5000);
            continue;
          }
          if (c === 'btw') {
            const q = await dialog.input({ placeholder: 'Ask a quick side question… (they keep working)', send: '💭 Ask' });
            if (q) net.send({ t: 'send', id, text: `/btw ${q}` });
            continue;
          }
          const sent = await this.compose(actor, id, `Tell ${actor.name} something…`);
          if (sent && !sent.startsWith('/btw') && !isBang(sent)) {
            baseline = store.sessions.get(id)?.lastText;
            shownNarr = undefined;
          }
          continue;
        }

        // Finished (or failed): show the reply, scrollable in the bubble.
        const isErr = key.startsWith('e:');
        const sideStatus = (c: SessionSummary) => (c.aside && !c.aside.answer ? (isBang(c.aside.question) ? '💻 Running your command' : '💭 Thinking about your side question') : null);
        dialog.setStatus(sideStatus(s));
        if (fresh || s.turns !== shownTurn) {
          const text = isErr ? `Oh no… something went wrong. 😣\n\n\`${(s.error ?? 'Unknown trouble').slice(0, 400)}\`` : s.lastText ?? 'All done!';
          await dialog.show(text, { md: true, type: !instant && s.turns !== shownTurn ? undefined : false });
          shownTurn = s.turns;
          instant = false;
        }
        if (s.unread) net.send({ t: 'read', id });
        onUpdate = (c) => dialog.setStatus(sideStatus(c));
        const c = await race(dialog.choose([
          ...(isErr ? [{ label: '🔁 Try again', value: 'retry' }] : []),
          { label: '💬 Reply', value: 'msg' },
          { label: '💭 Quick side question (/btw)', value: 'btw' },
          { label: '🌾 That’s all, thanks! (end session)', value: 'end' },
          { label: '👋 See you later', value: 'bye' },
        ], { cancel: 'bye' }));
        if (c === INTERRUPTED) continue;
        if (c === 'bye') {
          dialog.setStatus(null);
          await dialog.say(pick(['I’ll be around if you need me!', 'I’ll stroll around here. 🌼', pick(BYES)]));
          return;
        }
        if (c === 'end') {
          await this.endSession(actor, s);
          return;
        }
        if (c === 'retry') {
          baseline = s.lastText;
          net.send({ t: 'send', id, text: 'Please continue where you left off.' });
          await this.waitSession(id, (x) => x.status === 'working' || x.status === 'starting', 1500);
          continue;
        }
        if (c === 'btw') {
          const q = await dialog.input({ placeholder: 'Ask a quick side question…', send: '💭 Ask' });
          if (q) net.send({ t: 'send', id, text: `/btw ${q}` });
          continue;
        }
        const sent = await this.compose(actor, id, `Reply to ${actor.name}…`);
        if (sent && !sent.startsWith('/btw') && !isBang(sent)) {
          baseline = s.lastText;
          shownNarr = undefined;
        }
      }
    } finally {
      this.changeHook = undefined;
      dialog.setStatus(null);
      dialog.setTools([]);
    }
  }

  /** One pending permission / question / plan. Returns 'exit' when the player walks away. */
  private async pendingView(
    actor: Actor, s: SessionSummary, p: PendingRequest,
    race: <T>(x: Promise<T>) => Promise<T | Interrupted>,
  ): Promise<'exit' | 'continue'> {
    const { dialog, net } = this.app;
    const id = s.id;
    const respond = (decision: 'allow' | 'always' | 'deny', extra: { message?: string; answers?: Record<string, string> } = {}) =>
      net.send({ t: 'respond', id, requestId: p.id, decision, ...extra });
    const settled = () => this.waitSession(id, (x) => x.pending?.id !== p.id, 2000);
    const who = p.fromAgent ? `\n\n_(asking for my gnome: ${p.fromAgent})_` : '';
    dialog.setStatus(s.pendingCount > 1 ? `📬 ${s.pendingCount} things waiting for you` : null);

    if (p.kind === 'permission') {
      await dialog.show(`**${p.title}**${who}`, { md: true, detail: p.detail ? mdElement(p.detail) : undefined });
      const c = await race(dialog.choose([
        { label: '✅ Yes', value: 'allow' },
        ...(p.canAlwaysAllow ? [{ label: '✅ Yes, and don’t ask again', value: 'always' }] : []),
        { label: '🚫 No', value: 'deny' },
        { label: '💬 No, and here’s why…', value: 'why' },
        { label: '🤔 Let me think about it', value: 'later' },
      ], { cancel: 'later' }));
      if (c === INTERRUPTED) return 'continue';
      if (c === 'later') {
        await dialog.say('Okay! I’ll keep waving until you decide. 👋');
        return 'exit';
      }
      if (c === 'why') {
        const msg = await dialog.input({ placeholder: 'What should they do instead?', send: '🚫 Send' });
        if (msg === null) return 'continue';
        respond('deny', { message: msg });
      } else respond(c as 'allow' | 'always' | 'deny');
      await settled();
      return 'continue';
    }

    if (p.kind === 'question') {
      const answers: Record<string, string> = {};
      for (const q of p.questions ?? []) {
        if (q.multiSelect) {
          const how = await this.openConversation(actor, id, { attached: true, focus: true });
          return how === 'close' ? 'exit' : 'continue';
        }
        await dialog.show(`${q.question}${who}`, { md: true });
        const c = await race(dialog.choose([
          ...q.options.map((o) => ({ label: o.label, value: o.label, hint: o.description })),
          { label: '✏️ Something else…', value: '__other' },
          { label: '🤔 Let me think about it', value: '__later' },
        ], { cancel: '__later' }));
        if (c === INTERRUPTED) return 'continue';
        if (c === '__later') {
          await dialog.say('Take your time! I’ll be right here. 👋');
          return 'exit';
        }
        if (c === '__other') {
          const t = await dialog.input({ placeholder: 'Your answer…', send: '✅ Answer' });
          if (!t) return 'continue';
          answers[q.question] = t;
        } else answers[q.question] = c;
      }
      respond('allow', { answers });
      await settled();
      return 'continue';
    }

    // Plan approval: the plan itself scrolls inside the bubble.
    await dialog.show(`🗺️ **${p.title}**${who}\n\n${p.detail ?? ''}`, { md: true });
    const c = await race(dialog.choose([
      { label: '✅ Approve', value: 'allow' },
      { label: '✅ Approve + auto-accept edits', value: 'always' },
      { label: '✏️ Keep planning (tell them what to change)', value: 'deny' },
      { label: '🤔 Let me think about it', value: 'later' },
    ], { cancel: 'later' }));
    if (c === INTERRUPTED) return 'continue';
    if (c === 'later') {
      await dialog.say('Sure, take a look whenever you like! 🗺️');
      return 'exit';
    }
    if (c === 'deny') {
      const msg = await dialog.input({ placeholder: 'What should change in the plan?', send: '✏️ Send' });
      if (msg === null) return 'continue';
      respond('deny', { message: msg });
    } else respond(c as 'allow' | 'always');
    await settled();
    return 'continue';
  }

  /** The notebook: live transcript, pending requests and a composer. Resolves when it closes. */
  openConversation(actor: Actor, id: string, opts: { attached?: boolean; focus?: boolean } = {}): Promise<CloseReason> {
    const { panel, store, net } = this.app;
    const s0 = store.sessions.get(id);
    if (!s0) return Promise.resolve('minimize');
    const b = actor.building;
    const color = colorFor(actor.look.species);
    const meta = h('div', { class: 'meta' });
    const view = new TranscriptView(actor.name, () => panel.bodyEl());
    const typing = h('div', { class: 'typing' });
    const pendingSlot = h('div');
    const text = h('textarea', { class: 'big', rows: '2', placeholder: `Message ${actor.name}… (Enter to send, Shift+Enter for a new line, / for commands)` }) as HTMLTextAreaElement;
    const menu = new SlashMenu(text, () => this.commandsFor(id));
    const toast = (m: string) => this.app.hud.toast(m, 'error');
    filePaste(text, toast);
    const send = h('button', { class: 'btn primary' }, '✉️ Send');
    const stop = h('button', { class: 'btn' }, '✋ Interrupt');
    const end = h('button', { class: 'btn danger' }, '🌾 End session');
    const mail = h('button', { class: 'btn' }, '📮 Mailbox');
    const mode = h('select', { class: 'btn small', title: 'Permission mode' }) as HTMLSelectElement;
    for (const o of PERMISSION_CHOICES.filter((x) => x.value)) mode.append(h('option', { value: o.value }, `🔐 ${o.label}`));

    const doSend = () => {
      const v = text.value.trim();
      if (!v) return;
      text.value = '';
      if (/^\/mailbox\b/i.test(v)) {
        this.mailbox(actor, id);
        return;
      }
      net.send({ t: 'send', id, text: v });
    };
    send.addEventListener('click', doSend);
    text.addEventListener('keydown', (e) => {
      if (menu.handleKey(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    stop.addEventListener('click', () => net.send({ t: 'interrupt', id }));
    mail.addEventListener('click', () => this.mailbox(actor, id));
    end.addEventListener('click', () => {
      net.send({ t: 'close', id });
      panel.close('close');
      this.app.hud.toast(`🌾 ${actor.name} wrapped up the job.`);
    });
    mode.addEventListener('change', () => net.send({ t: 'setMode', id, mode: mode.value }));

    let lastPending: string | undefined;
    const refresh = () => {
      const s = store.sessions.get(id);
      if (!s) return;
      const st = statusOf(s);
      meta.innerHTML = '';
      const title = s.title.trim();
      const items = [
        STATUS_LABEL[st],
        s.model ? `🧠 ${s.model}` : '',
        s.effort ? `⚡ ${s.effort}` : '',
        s.worktree || /\.claude\/worktrees\//.test(s.cwd) ? `🌿 ${s.cwd.split('/').pop()}` : '',
        `💰 $${s.costUsd.toFixed(2)}`,
        // Which job this is, when a villager has several open in the same repo.
        title ? h('span', { class: 'meta-title', title }, `📝 ${title}`) : '',
        s.agents.filter((a) => a.status === 'running').length ? `🧙 ${s.agents.filter((a) => a.status === 'running').length}` : '',
      ];
      for (const x of items.filter(Boolean)) meta.append(typeof x === 'string' ? h('span', {}, x) : x);
      stop.style.display = s.status === 'working' || s.status === 'waiting' ? '' : 'none';
      if (s.permissionMode && mode.value !== s.permissionMode) mode.value = s.permissionMode;
      // "Is anything happening?" — a typing indicator under the transcript.
      const busy = s.status === 'working' || s.status === 'starting';
      const side = s.aside && !s.aside.answer;
      if (busy || side) {
        typing.innerHTML = `<b>${escapeHtml(actor.name)}</b> ${busy ? `is working · ${codeify(s.activity?.label ?? 'thinking')}` : isBang(s.aside!.question) ? 'is running your command' : 'is thinking about your side question'} <span class="dots"><i></i><i></i><i></i></span>`;
        typing.style.display = 'flex';
      } else typing.style.display = 'none';
      const key = s.pending?.id;
      if (key !== lastPending) {
        lastPending = key;
        pendingSlot.innerHTML = '';
        if (s.pending) {
          const p: PendingRequest = s.pending;
          pendingSlot.append(pendingCard(p, (decision, extra) => net.send({ t: 'respond', id, requestId: p.id, decision, ...extra })));
        }
      }
      if (s.unread && (s.status === 'done' || s.status === 'idle' || s.status === 'error')) net.send({ t: 'read', id });
    };

    const entries = store.entries.get(id);
    view.set(entries ?? []);
    if (!entries) net.send({ t: 'transcript', id });
    const unsub = store.on((msg: ServerMsg) => {
      if (msg.t === 'entries' && msg.id === id) {
        if (msg.reset) view.set(store.entries.get(id) ?? []);
        else view.append(msg.entries);
      } else if (msg.t === 'session' && msg.session.id === id) refresh();
      else if (msg.t === 'sessionRemoved' && msg.id === id) panel.close('close');
    });

    const bodyEl = h('div', {}, view.el, typing);
    const footEl = h('div', {}, pendingSlot,
      h('div', { class: 'composer' }, text, h('div', { class: 'row' }, send)),
      h('div', { class: 'dialog-compose-hint' }, `${scrollKeyLabel()} to scroll · drop or paste files to attach their path`),
      h('div', { class: 'row conv-actions' }, mode, mail, h('div', { class: 'spacer' }), stop, end));
    for (const zone of [bodyEl, footEl]) fileDrop(zone, () => text, toast);

    return new Promise<CloseReason>((resolve) => {
      const body = panel.open({
        title: `${SPECIES_EMOJI[actor.look.species]} ${actor.name}${b ? ` · ${b.name}` : ''}`,
        subtitle: meta,
        color,
        minimizable: opts.attached,
        body: bodyEl,
        foot: footEl,
        onClose: (reason) => {
          unsub();
          menu.destroy();
          resolve(reason);
        },
      });
      refresh();
      requestAnimationFrame(() => (body.scrollTop = body.scrollHeight));
      if (opts.focus) setTimeout(() => text.focus(), 60);
    });
  }

  // --- gnomes & staff --------------------------------------------------------------

  private async gnome(actor: Actor) {
    const { dialog, store, island } = this.app;
    const a = actor.agent;
    const s = actor.sessionId ? store.sessions.get(actor.sessionId) : undefined;
    const owner = s ? island.director.actorForSession(s)?.name ?? 'a villager' : 'a villager';
    if (!a) {
      await dialog.say('Hehe, just passing through!');
      return;
    }
    await dialog.say(`Hi hi! I'm a ${escapeHtml(a.subagentType ?? 'helper')} gnome, helping **${escapeHtml(owner)}** with: <i>${escapeHtml(a.description)}</i>`);
    const doing = a.lastTool ? codeify(a.lastTool) : 'getting started';
    await dialog.say(a.mode === 'write' ? `I'm getting my hands dirty: ${doing} 🔨` : `Only reading for now: ${doing} 📖`);
  }

  private async receptionist(actor: Actor) {
    const { dialog, panel, store } = this.app;
    const c = await dialog.ask('Welcome to the **Hiring Office**! 🌼 Need an extra pair of hands on one of the farms?', [
      { label: '🧑‍🌾 Hire a farmhand', value: 'hire' },
      { label: '❔ How does the island work?', value: 'how' },
      { label: '👋 Just browsing', value: 'bye' },
    ], { cancel: 'bye' });
    if (c === 'how') {
      await dialog.say('Every house on the island is a folder in your workspace, and every villager is a **Claude Code session** waiting for a job.');
      await dialog.say('Folders with several git repos become little towns: a town hall for the whole folder plus a house for each repo.');
      await dialog.say('Busy villagers work their farm. When they send **subagents**, little gnomes pop up — reading gnomes carry a clipboard, working gnomes dig!');
      await dialog.say('When someone finishes or has a question, they wave at you with a big <b>!</b> over their head. Go talk to them!');
      await dialog.say('Every house also has a **mailbox**: it opens a real terminal in that folder, for the things only you can type (hello, <code>sudo</code>!). 📮');
      await dialog.say('And if a house is already busy, I can send a farmhand to help. Timber next door builds new folders and repos. 🔨');
      await dialog.say('While everyone works, go fishing off the pier, chase butterflies, shake fruit trees or dig at the ✖ marks. Kip at the fruit stall buys whatever you find! 🎣');
      return;
    }
    if (c !== 'hire') {
      await dialog.say('Take your time! 🌸');
      return;
    }
    const where = await pickBuilding(panel, store, { title: '🧑‍🌾 Where should the farmhand work?', color: colorFor(actor.look.species) });
    if (!where?.building) {
      await dialog.say('Okay! Come back anytime.');
      return;
    }
    await this.newJob(actor, where.building, true);
  }

  private async architect() {
    const { dialog, panel, store, net, island } = this.app;
    const c = await dialog.ask('Howdy! I’m **Timber**, the island builder. 🔨 What are we building today?', [
      { label: '🏡 A new property', value: 'top', hint: 'a new folder in your workspace' },
      { label: '🏘️ A new building in a property', value: 'nested', hint: 'a nested git repo' },
      { label: '🗺️ Rearrange the island', value: 'arrange', hint: 'move properties around' },
      { label: '🔄 Re-survey the island', value: 'rescan', hint: 'pick up folders created elsewhere' },
      { label: '👋 Nothing today', value: 'bye' },
    ], { cancel: 'bye' });
    const color = '#f2b233';
    let res: Extract<ServerMsg, { t: 'built' }> | undefined;
    if (c === 'top') {
      const f = await nameForm(panel, { title: '🏡 New property', subtitle: `A new folder in ${store.world!.root}`, color, git: 'ask' });
      if (f) res = await net.build(null, f.name, f.git);
    } else if (c === 'nested') {
      const where = await pickBuilding(panel, store, { title: '🏘️ Which property gets a new building?', color, propertiesOnly: true });
      if (where) {
        const f = await nameForm(panel, { title: `🏘️ New building in ${where.property.name}`, subtitle: where.property.path, color, git: 'always' });
        if (f) res = await net.build(where.property.id, f.name, true);
      }
    } else if (c === 'arrange') {
      void dialog.show('Pick a property with the arrows, press **E** to lift it, move it, and **E** again to set it down. 📐');
      await this.app.map.arrange();
      await dialog.say('Looking good! Everyone’s settled into their new spots. 🏡');
      return;
    } else if (c === 'rescan') {
      net.send({ t: 'rescan' });
      await dialog.say('Survey done! If anything changed, the island already knows. 📐');
      return;
    } else {
      await dialog.say('Alright! My hammer will be waiting. 🔨');
      return;
    }
    if (!res) {
      await dialog.say('No problem, plans change!');
      return;
    }
    if (res.error) {
      await dialog.say(`Hmm, I can't build that: ${escapeHtml(res.error)}`);
      return;
    }
    const id = res.buildingId!;
    const go = await dialog.ask(`Done! **${escapeHtml(id)}** is ready, with a brand new villager moving in. 🏡`, [
      { label: '🚶 Take me there', value: 'go' },
      { label: '👍 Thanks, Timber!', value: 'bye' },
    ], { cancel: 'bye' });
    if (go === 'go') {
      for (let i = 0; i < 20; i++) {
        const b = store.world?.properties.flatMap((p) => p.buildings).find((x) => x.id === id);
        if (b && island.world?.version === store.world?.version) {
          island.travelToBuilding(b);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  /** Kip's stall: stays open after each purchase, until the player says bye (or Esc). */
  private async shop() {
    const { dialog, pockets, panel } = this.app;
    for (let first = true; ; first = false) {
      const n = pockets.data.items.length;
      const c = await dialog.ask(first
        ? 'Welcome to **Kip’s stall**! 🧺 I buy anything you find around the island: fish, bugs, fossils, shells, fruit…'
        : pick(['Anything else? 🧺', 'What else can I do for you?', 'Need anything else? 🦊']), [
        ...(n ? [{ label: `🪙 Sell everything (${pockets.value().toLocaleString()} coins)`, value: 'sell' }] : []),
        { label: '🎩 Hats & shirts', value: 'style' },
        pockets.hasKart
          ? { label: '🎨 Paint my kart (free)', value: 'paint' }
          : { label: `${KART.emoji} A go-kart!`, value: 'kart', hint: `${KART.price.toLocaleString()} coins` },
        { label: '📗 Show my field guide', value: 'guide' },
        { label: '👋 Bye!', value: 'bye' },
      ], { cancel: 'bye' });
      if (c === 'sell') {
        const v = pockets.sellAll();
        this.app.voice.fanfare();
        await dialog.say(`That comes to **${v.toLocaleString()} coins**! Pleasure doing business. 🪙`);
      } else if (c === 'guide') {
        await pockets.open(panel);
      } else if (c === 'style') {
        await this.styleShop();
      } else if (c === 'kart') {
        await this.kartShop();
      } else if (c === 'paint') {
        const col = await dialog.ask('What colour should it be?', SHIRTS.map((x, i) => ({ label: COLOR_NAMES[i] ?? x, value: x, swatch: x })), { cancel: '' });
        if (col) {
          this.app.garage.paint(col);
          await dialog.say('Fresh paint! It’ll go even faster now. 🏎️✨');
        }
      } else {
        await dialog.say(pick(['Come back when your pockets are full! 🎒', 'See you soon! 🦊', 'Happy hunting! 🎣']));
        return;
      }
    }
  }

  private async kartShop() {
    const { dialog, pockets } = this.app;
    const c = await dialog.ask(`A shiny **go-kart**! Drive it anywhere on the island, and race it at the fun fair. That’s **${KART.price.toLocaleString()}** coins.`, [
      { label: `🏎️ I’ll take it! (${KART.price.toLocaleString()} coins)`, value: 'buy' },
      { label: '🤔 Maybe later', value: 'no' },
    ], { cancel: 'no' });
    if (c !== 'buy') return;
    if (!pockets.buyKart()) {
      await dialog.say(`You need ${(KART.price - pockets.data.coins).toLocaleString()} more coins… Sell me some fish and bugs first! 🎣`);
      return;
    }
    this.app.garage.deliver();
    this.app.voice.fanfare();
    await dialog.say('Vroom vroom! It’s parked right next to you. Press **K** anywhere to hop in (or **E** next to it), and **E** again to climb out. 🏁');
  }

  private async styleShop() {
    const { dialog, pockets, island } = this.app;
    const h = await dialog.ask(`What catches your eye? You have **${pockets.data.coins.toLocaleString()}** coins.`, [
      ...HATS.map((x) => ({
        label: `${x.emoji} ${x.name}`,
        value: x.id as string,
        hint: pockets.data.owned.includes(x.id) ? (pockets.data.hat === x.id ? 'wearing it' : 'owned') : `${x.price.toLocaleString()} coins`,
      })),
      { label: '👕 A new shirt colour (free)', value: '__shirt' },
      ...(pockets.data.hat !== 'none' && pockets.data.hat !== 'straw' && pockets.data.hat !== 'hardhat'
        ? [{ label: '🎨 Recolour my hat (free)', value: '__hatcolor' }] : []),
      { label: '↩️ Something else', value: '__none' },
    ], { cancel: '__none' });
    if (h === '__none') return;
    if (h === '__shirt' || h === '__hatcolor') {
      const hat = h === '__hatcolor';
      const current = hat ? pockets.data.hatColor : pockets.data.shirt;
      const col = await dialog.ask(hat ? 'What colour for your hat?' : 'Pick a colour!',
        SHIRTS.map((x, i) => ({ label: COLOR_NAMES[i] ?? x, value: x, swatch: x, hint: x === current ? 'current' : undefined })), { cancel: '' });
      if (!col) return;
      if (hat) {
        pockets.setHatColor(col);
        island.player.setLook({ hatColor: col });
      } else {
        pockets.setShirt(col);
        island.player.setLook({ shirt: col });
      }
      await dialog.say(hat ? 'Very stylish! 🎨' : 'Ooh, that suits you! 👕');
      return;
    }
    const hat = HATS.find((x) => x.id === h)!;
    if (pockets.buyHat(hat.id)) {
      island.player.setLook({ hat: hat.id });
      await dialog.say(hat.id === 'cone' ? 'A gnome hat! Now the gnomes will think you’re one of them. 🧙' : 'Looking sharp! ✨');
    } else {
      await dialog.say(`That one is **${hat.price.toLocaleString()}** coins… you need ${(hat.price - pockets.data.coins).toLocaleString()} more. Go fishing! 🎣`);
    }
  }

  // --- worktrees (pumpkins) & visitors ------------------------------------------------

  private building(id: string) {
    return this.app.store.world?.properties.flatMap((p) => p.buildings).find((b) => b.id === id);
  }

  /** Starts a job in `b` (optionally in one of its worktrees): the resident if they're free, else a farmhand. */
  private async startJob(b: Building, p: { prompt: string; opts: StartOptions; cwd?: string; resume?: string; resumeCwd?: string }) {
    const { net, store, dialog } = this.app;
    const free = b.residents.find((r) => !store.live().some((s) => s.characterId === r.id));
    const res = await net.start({ buildingId: b.id, characterId: free?.id, hire: !free, ...p });
    if (res.error || !res.id) {
      await dialog.say(`Oh no… ${escapeHtml(res.error ?? 'that didn’t work')}`);
      return;
    }
    const who = free?.name ?? store.sessions.get(res.id)?.mercenary?.name ?? 'A farmhand';
    await dialog.say(`**${escapeHtml(who)}** is on it! Look for them at ${place(b)}. 🌱`);
  }

  private pumpkinText(wt: WorktreeInfo, b: Building, busy: boolean) {
    const base = wt.base ?? 'main';
    const facts = [
      wt.ahead ? `🧺 **${wt.ahead}** commit${wt.ahead > 1 ? 's' : ''} not on \`${base}\` yet` : `nothing that isn’t on \`${base}\``,
      wt.dirty ? `✏️ **${wt.dirty}** uncommitted file${wt.dirty > 1 ? 's' : ''}` : '',
      wt.behind ? `⏳ ${wt.behind} behind \`${base}\`` : '',
      wt.lastCommit ? `📝 “${wt.lastCommit.slice(0, 80)}”${wt.lastCommitAt ? ` (${timeAgo(wt.lastCommitAt)})` : ''}` : '',
      busy ? '✨ someone is working in it right now' : '',
    ].filter(Boolean);
    return `${wt.mine ? '🎃' : '🎃🌿'} The **${escapeHtml(wt.branch ?? 'detached HEAD')}** worktree of ${place(b)}` +
      `${wt.mine ? '' : ', grown wild (made outside the island)'}.\n\n${facts.map((f) => `- ${f}`).join('\n')}`;
  }

  /** Talking to a pumpkin: a git worktree of the repo whose farm it grows in. */
  async pumpkin(wt: WorktreeInfo) {
    const { dialog, panel, island, net, store, mailboxes } = this.app;
    if (this.talking || this.chatting || dialog.isOpen || panel.isOpen) return;
    const b = this.building(wt.buildingId);
    if (!b) return;
    this.chatting = true;
    const player = island.player;
    player.enabled = false;
    player.clearKeys();
    player.autoTarget = undefined;
    dialog.open({ name: wt.mine ? 'Pumpkin' : 'Wild pumpkin', color: '#f28c28', voice: 0.55 });
    const inside = (cwd: string) => cwd === wt.path || cwd.startsWith(wt.path + '/');
    const busy = () => store.live().some((s) => inside(s.cwd)) || store.visitors.some((v) => inside(v.cwd));
    try {
      for (;;) {
        const cur = store.worktrees.find((x) => x.path === wt.path) ?? wt;
        const c = await dialog.ask(this.pumpkinText(cur, b, busy()), [
          { label: '🔍 Inspect', value: 'inspect', hint: 'status and commits' },
          { label: '📮 Open a mailbox here', value: 'mail', hint: 'a terminal in the worktree' },
          { label: '🌱 A new job here', value: 'job' },
          { label: '📜 Pick up a job from here', value: 'resume' },
          { label: '🧺 Harvest (merge it)', value: 'harvest', hint: `into ${(cur.base ?? 'main').replace(/^origin\//, '')}, then remove it` },
          { label: '🪓 Compost (remove it)', value: 'compost' },
          { label: '👋 Leave it be', value: 'bye' },
        ], { cancel: 'bye', md: true });
        if (c === 'bye') return;
        if (c === 'inspect') {
          void dialog.show('Let me have a look… 🔍');
          const d = await net.inspectWorktree(wt.path);
          const block = (lines: string[]) => lines.length ? `\n\`\`\`\n${lines.join('\n')}\n\`\`\`` : ' *none*';
          await dialog.say(d.error ? `Hmm: ${escapeHtml(d.error)}` :
            `📁 \`${d.path}\`\n\n**Uncommitted changes**${block(d.status)}\n\n**Commits not on ${cur.base ?? 'the base branch'}**${block(d.log)}`, { md: true });
        } else if (c === 'mail') {
          mailboxes.open(b, wt.path);
          return;
        } else if (c === 'job') {
          const job = await jobForm(panel, store.world!, b, { title: `🎃 A job in ${cur.branch ?? 'this worktree'}`, who: 'the villager', color: '#f28c28' });
          if (job) {
            await this.startJob(b, { ...job, cwd: wt.path });
            return;
          }
        } else if (c === 'resume') {
          void dialog.show('Checking the notebook for this patch… 📒');
          const items = await net.history(b.id, wt.path);
          if (!items.length) {
            await dialog.say('No jobs have happened in this worktree yet.');
            continue;
          }
          const it = await historyPicker(panel, items, { title: `📜 Old jobs in ${cur.branch ?? 'this worktree'}`, color: '#f28c28' });
          if (!it) continue;
          const entries = await net.historyLoad(b.id, it.sessionId, wt.path);
          const cont = await resumeForm(panel, store.world!, b, it, entries, { who: 'the villager', color: '#f28c28' });
          if (cont) {
            await this.startJob(b, { ...cont, resume: it.sessionId, resumeCwd: it.cwd ?? wt.path });
            return;
          }
        } else if (c === 'harvest') {
          if (!cur.branch) {
            await dialog.say('It’s on a detached HEAD, so there’s no branch to merge. You could start a job here to make one!');
            continue;
          }
          const base = (cur.base ?? 'main').replace(/^origin\//, '');
          const ok = await dialog.ask(`A villager will merge **${escapeHtml(cur.branch)}** into **${escapeHtml(base)}**, then remove this worktree. They’ll ask before anything risky (permission prompts are on). Go ahead?`, [
            { label: '🧺 Yes, harvest it', value: 'yes' },
            { label: '🤔 Not yet', value: 'no' },
          ], { cancel: 'no' });
          if (ok !== 'yes') continue;
          await this.startJob(b, {
            prompt: [
              `Please merge the branch \`${cur.branch}\` (checked out in the git worktree at \`${wt.path}\`) into \`${base}\` in this repository, then clean up:`,
              '1. If the worktree has uncommitted changes, stop and ask me what to do with them first.',
              `2. Bring \`${base}\` up to date if it tracks a remote, then merge \`${cur.branch}\` into it. Resolve conflicts carefully and ask me when unsure.`,
              '3. Run the project’s checks or tests if it has any.',
              `4. Remove the worktree with \`git worktree remove ${wt.path}\` and delete the branch with \`git branch -d ${cur.branch}\`.`,
              'Don’t push anything unless I ask.',
            ].join('\n'),
            opts: { permissionMode: 'default' },
          });
          return;
        } else if (c === 'compost') {
          if (busy()) {
            await dialog.say('Someone is still working in this worktree! Wrap up that session first. ✋');
            continue;
          }
          const d = await net.inspectWorktree(wt.path);
          if (d.error) {
            await dialog.say(`Hmm: ${escapeHtml(d.error)}`);
            continue;
          }
          const lose = [
            d.status.length ? `**${d.status.length}** uncommitted change${d.status.length > 1 ? 's' : ''}` : '',
            d.log.length ? `**${d.log.length}** commit${d.log.length > 1 ? 's' : ''} that aren’t on ${cur.base ?? 'the base branch'}` : '',
          ].filter(Boolean);
          // `git worktree remove` also deletes ignored files (.env, local config, builds).
          const ignored = d.ignored.length
            ? `\n\n🗑️ Ignored files go too: ${d.ignored.slice(0, 6).map((f) => `\`${f}\``).join(', ')}${d.ignored.length > 6 ? ` and ${d.ignored.length - 6} more` : ''}.`
            : '';
          const sure = await confirmBox(panel, {
            title: '🪓 Compost this worktree?',
            text: `This removes \`${wt.path}\`${cur.branch ? ` and deletes the branch **${cur.branch}**` : ''}.` +
              (lose.length ? `\n\n⚠️ You’d lose ${lose.join(' and ')}.` : ignored ? '' : '\n\nNothing will be lost: it has no changes of its own.') + ignored,
            ok: lose.length ? '🪓 Remove it anyway' : '🪓 Remove it',
            cancel: 'Keep it',
            color: '#e8645c',
            danger: lose.length > 0 || ignored !== '',
          });
          if (!sure) continue;
          const err = await net.removeWorktree(wt.path, lose.length > 0);
          await dialog.say(err ? `Hmm, that didn’t work: ${escapeHtml(err)}` : 'Composted! The soil is ready for something new. 🌱');
          return;
        }
      }
    } catch (err) {
      console.error(err);
      this.app.hud.toast(`🎃 ${(err as Error).message}`, 'error');
    } finally {
      dialog.close();
      this.chatting = false;
    }
  }

  /** A Claude Code session running in a terminal, visiting its folder. */
  private async visitor(actor: Actor) {
    const { dialog, panel, net, store } = this.app;
    const v = actor.visitor;
    const b = actor.building;
    if (!v || !b) return;
    const where = v.cwd === b.path ? place(b) : `a worktree of ${place(b)} (\`${v.cwd.split('/').pop()}\`)`;
    const c = await dialog.ask(`Hi! I’m **${actor.name}**, just visiting. I’m a Claude Code session running in a terminal, in ${where}. I last did something ${timeAgo(v.at)}.` +
      (v.title ? `\n\nWorking on: *${escapeHtml(v.title)}*` : ''), [
      { label: '🏝️ Bring this conversation onto the island', value: 'bring' },
      { label: '📮 Open a mailbox here', value: 'mail' },
      { label: '👋 Carry on!', value: 'bye' },
    ], { cancel: 'bye', md: true });
    if (c === 'mail') {
      this.app.mailboxes.open(b, v.cwd);
      return;
    }
    if (c !== 'bring') {
      await dialog.say('Toodle-oo! 🎒');
      return;
    }
    const sure = await dialog.ask('⚠️ Close me in the terminal first! Otherwise two copies of me will write to the same conversation.', [
      { label: '✅ It’s closed, bring it over', value: 'yes' },
      { label: '🤔 Never mind', value: 'no' },
    ], { cancel: 'no' });
    if (sure !== 'yes') return;
    const inWorktree = v.cwd !== b.path;
    const entries = await net.historyLoad(b.id, v.sessionId, inWorktree ? v.cwd : undefined);
    const item: HistoryItem = { sessionId: v.sessionId, title: v.title ?? 'Conversation from the terminal', lastModified: v.at, cwd: v.cwd };
    const cont = await resumeForm(panel, store.world!, b, item, entries, { who: 'the villager', color: colorFor(actor.look.species) });
    if (!cont) return;
    await this.startJob(b, { ...cont, resume: v.sessionId, resumeCwd: v.cwd });
  }

  async confirmLeave(): Promise<boolean> {
    const live = this.app.store.live().filter((s) => s.status !== 'closed').length;
    return confirmBox(this.app.panel, {
      title: '🚪 Leave the island?',
      text: live
        ? `There ${live === 1 ? 'is **1 session**' : `are **${live} sessions**`} running on the island. Leaving will **stop all of them** and close any open mailbox terminals (you can resume the sessions later from their villagers).`
        : 'Everyone is resting. Nothing will be interrupted.',
      ok: live ? '🚪 Leave and stop everything' : '🚪 Leave',
      cancel: '🏝️ Stay',
      color: '#ff7a6b',
      danger: true,
    });
  }
}

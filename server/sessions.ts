import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  getSessionInfo, query,
  type CanUseTool, type Options, type PermissionResult, type PermissionUpdate, type Query,
  type SDKMessage, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentInfo, Building, ClientMsg, CommandInfo, HistoryItem, PendingQuestion, PendingRequest, SessionSummary,
  StartOptions, TranscriptEntry,
} from '../shared/protocol.ts';
import { hash, mercenaryLook, mercenaryName } from './names.ts';
import { loadTranscript, listHistory } from './history.ts';
import { PathResolver } from './resolver.ts';
import { describeInput, describeTool, isAgentTool, toolMode, toolPath } from './tools.ts';
import type { World } from './world.ts';

const MAX_ENTRIES = 2000;
const BANG_TIMEOUT_MS = 120_000;
const BANG_MAX_OUTPUT = 30_000;
const REMOVE_CLOSED_AFTER_MS = 60_000;

const BASE_APPEND = [
  'You are being driven from Code Town, a cozy island UI where the user talks to you through a villager character.',
  'Your final message of each turn is shown in a speech bubble that the user can expand, so open it with a short summary of the outcome.',
  'Everything else works exactly like a normal Claude Code session.',
].join(' ');

function townWorktreeNote(workspace: string) {
  return [
    'Worktrees: this workspace holds several independent git repositories and other sessions may be working in them at the same time.',
    `Before changing files in any of those repositories, create a dedicated git worktree for it (for example \`git -C <repo> worktree add ${workspace}/.worktrees/<repo>-<task> -b <branch>\`, or follow the workspace's own worktree convention if its CLAUDE.md defines one) and make every edit there.`,
    'Never edit the main checkouts directly.',
  ].join(' ');
}

function permissionTitle(tool: string, input: Record<string, unknown>): string {
  const file = typeof input.file_path === 'string' ? input.file_path.split('/').pop() : undefined;
  switch (tool) {
    case 'Bash': return 'May I run this command?';
    case 'Edit':
    case 'MultiEdit': return `May I edit ${file ?? 'this file'}?`;
    case 'Write': return `May I write ${file ?? 'this file'}?`;
    case 'NotebookEdit': return 'May I edit this notebook?';
    case 'WebFetch': return 'May I fetch this page?';
    case 'WebSearch': return 'May I search the web?';
    default: return tool.startsWith('mcp__') ? `May I use ${tool.split('__').slice(1).join(' › ')}?` : `May I use ${tool}?`;
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(item: T) {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end() {
    this.ended = true;
    for (const w of this.waiters) w({ value: undefined, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

interface Pending {
  req: PendingRequest;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  resolve: (r: PermissionResult) => void;
}

interface AgentState extends AgentInfo {
  wrote: boolean;
}

interface Launch {
  building: Building;
  opts: StartOptions;
  append: string;
  worktree?: string;
}

class Session {
  s: SessionSummary;
  entries: TranscriptEntry[] = [];
  launch: Launch;
  q?: Query;
  input?: AsyncQueue<SDKUserMessage>;
  alive = false;
  closing = false;
  interrupting = false;
  pending: Pending[] = [];
  tools = new Map<string, { name: string }>();
  agents = new Map<string, AgentState>();
  taskToAgent = new Map<string, string>();
  stderr = '';
  commands: CommandInfo[] = [];
  mainCost = 0;
  extraCost = 0; // /btw forks
  bangContext: string[] = []; // `!` command output, handed to Claude with the next message
  newEntries: TranscriptEntry[] = [];
  flushTimer?: NodeJS.Timeout;
  touchTimer?: NodeJS.Timeout;

  constructor(s: SessionSummary, launch: Launch) {
    this.s = s;
    this.launch = launch;
  }
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private resolver: PathResolver;

  constructor(private world: World, private claudeBin?: string) {
    super();
    this.resolver = new PathResolver(world);
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((x) => x.s);
  }

  liveCount(): number {
    return [...this.sessions.values()].filter((x) => x.alive).length;
  }

  get(id: string): SessionSummary | undefined {
    return this.sessions.get(id)?.s;
  }

  transcript(id: string): TranscriptEntry[] {
    return this.sessions.get(id)?.entries ?? [];
  }

  /** Past conversations in a building's folder (or `dir`, one of its worktrees). */
  async history(buildingId: string, dir?: string): Promise<HistoryItem[]> {
    const b = this.world.getBuilding(buildingId);
    if (!b) return [];
    const items = await listHistory(dir ?? b.path);
    const live = new Map<string, string>();
    for (const x of this.sessions.values()) {
      if (x.s.claudeSessionId && x.s.status !== 'closed') live.set(x.s.claudeSessionId, x.s.id);
    }
    return items.map((i) => ({ ...i, liveSessionId: live.get(i.sessionId) }));
  }

  async historyTranscript(buildingId: string, sessionId: string, dir?: string): Promise<TranscriptEntry[]> {
    const b = this.world.getBuilding(buildingId);
    if (!b) return [];
    return loadTranscript(sessionId, dir ?? b.path);
  }

  /**
   * Starts (or resumes) a session. It runs in the building's folder, or in `cwd` / `resumeCwd`
   * when that's inside it or one of `worktrees` (its git worktrees, wherever they live).
   */
  async start(msg: Extract<ClientMsg, { t: 'start' }>, worktrees: string[] = []): Promise<string> {
    const building = this.world.getBuilding(msg.buildingId);
    if (!building) throw new Error('That building no longer exists.');
    const prompt = msg.prompt.trim();
    if (!prompt) throw new Error('Tell them what to do first!');

    const id = randomUUID();
    let characterId: string;
    let mercenary: SessionSummary['mercenary'];
    if (msg.hire || !msg.characterId) {
      const taken = new Set(this.list().filter((s) => s.mercenary).map((s) => s.mercenary!.name));
      const seed = hash(id);
      mercenary = { name: mercenaryName(seed, taken), look: mercenaryLook(seed) };
      characterId = `merc:${id}`;
    } else {
      characterId = msg.characterId;
      if (!building.residents.some((r) => r.id === characterId)) throw new Error('That villager does not live here.');
      const busy = this.list().find((s) => s.characterId === characterId && s.status !== 'closed');
      if (busy) throw new Error('They are already busy with another job.');
    }

    if (msg.resume) {
      const live = this.list().find((s) => s.claudeSessionId === msg.resume && s.status !== 'closed');
      if (live) throw new Error('That conversation is already running on the island.');
    }

    const opts = msg.opts ?? {};
    let append = BASE_APPEND;
    let worktree: string | undefined;
    let cwd = building.path;
    const allowed = (raw: string) => {
      const dir = path.resolve(raw);
      return fs.existsSync(dir) && (dir === building.path || dir.startsWith(building.path + path.sep) || worktrees.includes(dir));
    };
    if (msg.resume && msg.resumeCwd && allowed(msg.resumeCwd)) cwd = path.resolve(msg.resumeCwd);
    if (msg.cwd) {
      if (!allowed(msg.cwd)) throw new Error('That folder doesn’t belong to this building.');
      cwd = path.resolve(msg.cwd);
    }
    if (opts.worktree && !msg.resume && !msg.cwd) {
      const isTown = building.role === 'main' && (this.world.getProperty(building.propertyId)?.buildings.length ?? 0) > 1;
      if (isTown) {
        append += '\n\n' + townWorktreeNote(building.path);
      } else if (building.isRepo) {
        const who = (mercenary?.name ?? building.residents.find((r) => r.id === characterId)?.name ?? 'villager')
          .toLowerCase().replace(/[^a-z0-9]+/g, '-');
        worktree = `codetown-${who}-${id.slice(0, 4)}`;
      }
    }

    const summary: SessionSummary = {
      id,
      buildingId: building.id,
      characterId,
      mercenary,
      title: prompt.split('\n')[0].slice(0, 70),
      status: 'starting',
      unread: false,
      cwd,
      worktree,
      model: opts.model || undefined,
      effort: opts.effort || undefined,
      permissionMode: opts.permissionMode || undefined,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      pendingCount: 0,
      agents: [],
      costUsd: 0,
      turns: 0,
      toolCount: 0,
      claudeSessionId: msg.resume,
    };
    const sess = new Session(summary, { building, opts, append, worktree });
    this.sessions.set(id, sess);

    if (msg.resume) {
      try {
        sess.entries = await loadTranscript(msg.resume, building.path, cwd);
        sess.entries.push(this.entry('system', '— Conversation resumed —'));
      } catch {
        // history is a nicety; carry on without it
      }
    }
    this.launch(sess, msg.resume);
    this.addEntry(sess, this.entry('user', prompt));
    sess.input!.push(this.userMessage(prompt));
    this.touch(sess);
    return id;
  }

  /** Options shared by the main query and /btw forks (identical prefix = prompt-cache hits). */
  private baseOptions(sess: Session, resume?: string): Options {
    const { opts, append, worktree } = sess.launch;
    return {
      // For a fresh worktree session this is the repo (Claude Code creates the worktree
      // inside it); once `init` reports the real cwd, revivals resume from there.
      cwd: sess.s.cwd,
      pathToClaudeCodeExecutable: this.claudeBin,
      model: sess.s.model || opts.model || undefined,
      effort: (opts.effort || undefined) as Options['effort'],
      permissionMode: (sess.s.permissionMode || undefined) as Options['permissionMode'],
      allowDangerouslySkipPermissions: sess.s.permissionMode === 'bypassPermissions' ? true : undefined,
      resume,
      extraArgs: worktree && !resume ? { worktree } : {},
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      stderr: (d) => {
        sess.stderr = (sess.stderr + d).slice(-4000);
      },
      env: { ...process.env, CODETOWN: '1' },
    };
  }

  private launch(sess: Session, resume?: string) {
    const input = new AsyncQueue<SDKUserMessage>();
    const options = { ...this.baseOptions(sess, resume), canUseTool: this.canUseTool(sess) };
    sess.input = input;
    sess.q = query({ prompt: input, options });
    sess.alive = true;
    sess.closing = false;
    this.consume(sess, sess.q);
  }

  /**
   * `/btw`: answers a side question from the conversation so far without
   * disturbing the running job, by forking the session (not persisted, tools blocked).
   */
  private async btw(sess: Session, question: string) {
    const sid = sess.s.claudeSessionId;
    this.addEntry(sess, this.entry('user', `/btw ${question}`));
    if (!sid) {
      this.addEntry(sess, this.entry('aside', 'I haven’t really started yet — ask me again in a moment!'));
      return;
    }
    sess.s.aside = { question, ts: Date.now() };
    this.touch(sess);
    const deny = async () => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        permissionDecisionReason: 'This is a /btw side question: answer from what you already know, without tools.',
      },
    });
    const options: Options = {
      ...this.baseOptions(sess, sid),
      forkSession: true,
      persistSession: false,
      maxTurns: 4,
      extraArgs: {},
      permissionPrompts: 'none',
      hooks: { PreToolUse: [{ hooks: [deny] }] },
    };
    const prompt = [
      '(/btw — a quick side question. Your main task keeps running in another process; do not continue it here and do not use tools.',
      'Answer briefly from what you already know.)',
      '',
      question,
    ].join('\n');
    let answer = '';
    try {
      for await (const m of query({ prompt, options })) {
        if (m.type === 'assistant' && !m.parent_tool_use_id) {
          const text = (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
          if (text) answer = text;
        } else if (m.type === 'result') {
          if ((m as any).result?.trim()) answer = (m as any).result.trim();
          sess.extraCost += (m as any).total_cost_usd ?? 0;
        }
      }
    } catch (err) {
      answer = `I couldn’t answer that on the side: ${(err as Error).message}`;
    }
    answer ||= 'Hmm, I got nothing on that one.';
    this.addEntry(sess, this.entry('aside', answer));
    sess.s.aside = { question, answer, ts: Date.now() };
    sess.s.costUsd = sess.mainCost + sess.extraCost;
    this.touch(sess);
  }

  commands(id: string): CommandInfo[] {
    return this.sessions.get(id)?.commands ?? [];
  }

  allCommands(): Record<string, CommandInfo[]> {
    const out: Record<string, CommandInfo[]> = {};
    for (const [id, x] of this.sessions) if (x.commands.length) out[id] = x.commands;
    return out;
  }

  private async consume(sess: Session, q: Query) {
    try {
      for await (const m of q) this.handle(sess, m);
    } catch (err) {
      if (!sess.closing) {
        const tail = sess.stderr.trim().split('\n').slice(-6).join('\n');
        sess.s.error = (err as Error).message;
        this.addEntry(sess, this.entry('error', `${(err as Error).message}${tail ? `\n\n\`\`\`\n${tail}\n\`\`\`` : ''}`));
      }
    } finally {
      if (sess.q === q) {
        sess.alive = false;
        this.flushPending(sess, 'The session ended.');
        for (const a of sess.agents.values()) if (a.status === 'running') a.status = 'failed';
        if (sess.closing) {
          sess.s.status = 'closed';
          setTimeout(() => this.remove(sess.s.id), REMOVE_CLOSED_AFTER_MS).unref();
        } else {
          // The process died on its own: keep the villager around so the player notices.
          sess.s.status = 'error';
          sess.s.unread = true;
          sess.s.error ??= 'The session stopped unexpectedly.';
        }
        sess.s.activity = undefined;
        this.syncAgents(sess);
        this.touch(sess);
      }
    }
  }

  private handle(sess: Session, m: SDKMessage) {
    const s = sess.s;
    switch (m.type) {
      case 'system':
        this.handleSystem(sess, m as SDKMessage & { type: 'system'; subtype: string });
        break;
      case 'assistant': {
        const parent = m.parent_tool_use_id;
        const content = (m.message?.content ?? []) as Array<Record<string, any>>;
        for (const b of content) {
          if (b.type === 'text' && !parent && String(b.text).trim()) {
            this.addEntry(sess, this.entry('assistant', b.text));
            s.lastText = b.text;
          } else if (b.type === 'thinking' && !parent) {
            s.activity = { tool: '', label: 'Thinking…', mode: 'think' };
          } else if (b.type === 'tool_use') {
            this.onToolUse(sess, b.id, b.name, b.input ?? {}, parent);
          }
        }
        if (m.error && !parent) this.addEntry(sess, this.entry('error', `API error: ${m.error}`));
        if (s.status === 'starting') s.status = 'working';
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id) break;
        const content = m.message?.content;
        if (!Array.isArray(content)) break;
        for (const b of content as Array<Record<string, any>>) {
          if (b.type !== 'tool_result') continue;
          const tool = sess.tools.get(b.tool_use_id);
          if (tool && isAgentTool(tool.name)) {
            const agent = sess.agents.get(b.tool_use_id);
            if (agent && !agent.background) this.endAgent(sess, agent.id, b.is_error ? 'failed' : 'done');
          }
          if (b.is_error) {
            const text = typeof b.content === 'string' ? b.content
              : Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? '').join('\n') : '';
            this.addEntry(sess, { ...this.entry('tool', `${tool?.name ?? 'Tool'} failed`), tool: tool?.name, detail: text.slice(0, 1500), isError: true });
          }
        }
        break;
      }
      case 'result': {
        const r = m as any;
        s.turns += 1;
        if (typeof r.total_cost_usd === 'number') sess.mainCost = r.total_cost_usd;
        s.costUsd = sess.mainCost + sess.extraCost;
        const secs = Math.round((r.duration_ms ?? 0) / 1000);
        if (sess.interrupting) {
          sess.interrupting = false;
          s.status = 'done';
          this.addEntry(sess, this.entry('system', '✋ Interrupted'));
        } else if (r.subtype === 'success' && !r.is_error) {
          s.status = 'done';
          if (r.result) s.lastText = r.result;
          this.addEntry(sess, this.entry('result', `Done in ${secs}s · $${s.costUsd.toFixed(2)} total`));
        } else {
          s.status = 'error';
          const why = (r.errors as string[] | undefined)?.join('\n') || r.result || r.subtype;
          s.error = why;
          this.addEntry(sess, this.entry('error', `The job hit a snag: ${why}`));
        }
        s.unread = true;
        s.activity = undefined;
        if (sess.pending.length) s.status = 'waiting';
        this.refreshTitle(sess);
        break;
      }
      default:
        break;
    }
    this.touch(sess);
  }

  private handleSystem(sess: Session, m: any) {
    const s = sess.s;
    switch (m.subtype) {
      case 'init':
        s.claudeSessionId = m.session_id;
        s.cwd = m.cwd;
        s.model = m.model;
        s.permissionMode = m.permissionMode;
        if (s.status === 'starting') s.status = 'working';
        sess.q?.supportedCommands().then((cs) => {
          sess.commands = cs.map((c) => ({ name: c.name, description: c.description, hint: c.argumentHint || undefined }));
          this.emit('commands', s.id, sess.commands);
        }).catch(() => {});
        break;
      case 'task_started':
        this.startAgent(sess, m.tool_use_id ?? m.task_id, m.task_id, m.description, m.subagent_type, m.is_backgrounded);
        break;
      case 'task_progress': {
        const a = sess.agents.get(m.tool_use_id ?? sess.taskToAgent.get(m.task_id) ?? '');
        if (a) {
          if (m.last_tool_name) a.lastTool = a.lastTool ?? m.last_tool_name;
          if (m.usage?.tool_uses) a.toolCount = Math.max(a.toolCount, m.usage.tool_uses);
          this.syncAgents(sess);
        }
        break;
      }
      case 'task_notification': {
        const aid = m.tool_use_id ?? sess.taskToAgent.get(m.task_id);
        if (aid) this.endAgent(sess, aid, m.status === 'completed' ? 'done' : 'failed');
        break;
      }
      case 'task_updated': {
        const st = m.patch?.status;
        const aid = sess.taskToAgent.get(m.task_id);
        if (aid && (st === 'completed' || st === 'failed' || st === 'killed')) {
          this.endAgent(sess, aid, st === 'completed' ? 'done' : 'failed');
        }
        break;
      }
      case 'session_state_changed':
        if (m.state === 'running' && s.status !== 'waiting') s.status = 'working';
        break;
      case 'compact_boundary':
        this.addEntry(sess, this.entry('system', '🧹 Conversation compacted'));
        break;
      default:
        break;
    }
  }

  private onToolUse(sess: Session, toolId: string, name: string, input: Record<string, unknown>, parent: string | null) {
    const s = sess.s;
    const label = describeTool(name, input, s.cwd);
    sess.tools.set(toolId, { name });
    s.toolCount += 1;
    if (parent) {
      const agent = sess.agents.get(parent);
      if (agent) {
        const where = toolPath(name, input, s.cwd);
        const b = where ? this.resolver.building(where) : undefined;
        if (b) agent.buildingId = b.id;
        if (toolMode(name, input) === 'write') agent.wrote = true;
        agent.mode = agent.wrote ? 'write' : 'read';
        agent.lastTool = label;
        agent.toolCount += 1;
        this.syncAgents(sess);
      }
      this.addEntry(sess, { ...this.entry('tool', label), tool: name, agentId: parent });
    } else {
      s.activity = { tool: name, label, mode: toolMode(name, input) };
      this.addEntry(sess, { ...this.entry('tool', label), tool: name });
    }
    if (isAgentTool(name)) {
      this.startAgent(sess, toolId, undefined, String(input.description ?? 'Helping out'),
        input.subagent_type as string | undefined, Boolean(input.run_in_background));
    }
  }

  private startAgent(sess: Session, id: string, taskId: string | undefined, description: string, type?: string, background?: boolean) {
    if (taskId) sess.taskToAgent.set(taskId, id);
    const existing = sess.agents.get(id);
    if (existing) {
      if (background) existing.background = true;
      if (type) existing.subagentType = type;
    } else {
      sess.agents.set(id, {
        id, description, subagentType: type, status: 'running', mode: 'read',
        buildingId: sess.s.buildingId, background, toolCount: 0, startedAt: Date.now(), wrote: false,
      });
    }
    this.syncAgents(sess);
  }

  private endAgent(sess: Session, id: string, status: 'done' | 'failed') {
    const a = sess.agents.get(id);
    if (!a || a.status !== 'running') return;
    a.status = status;
    a.endedAt = Date.now();
    this.syncAgents(sess);
    // Keep finished gnomes briefly so the client can play their goodbye.
    setTimeout(() => {
      sess.agents.delete(id);
      this.syncAgents(sess);
      this.touch(sess);
    }, 8000).unref();
  }

  private syncAgents(sess: Session) {
    sess.s.agents = [...sess.agents.values()].map(({ wrote: _w, ...a }) => a);
  }

  private canUseTool(sess: Session): CanUseTool {
    return (toolName, input, opts) =>
      new Promise<PermissionResult>((resolve) => {
        const id = randomUUID();
        const fromAgent = opts.agentID
          ? [...sess.agents.values()].find((a) => a.id === opts.agentID || sess.taskToAgent.get(opts.agentID!) === a.id)?.description ?? 'a gnome'
          : undefined;
        let req: PendingRequest;
        if (toolName === 'AskUserQuestion') {
          req = {
            id, kind: 'question', toolName, title: 'I have a question for you',
            questions: (input.questions as PendingQuestion[]) ?? [], canAlwaysAllow: false, fromAgent,
          };
        } else if (toolName === 'ExitPlanMode') {
          req = { id, kind: 'plan', toolName, title: 'My plan is ready for your review', detail: String(input.plan ?? ''), canAlwaysAllow: false, fromAgent };
        } else {
          req = {
            id, kind: 'permission', toolName,
            title: opts.title ?? permissionTitle(toolName, input),
            detail: describeInput(toolName, input) + (opts.decisionReason ? `\n\n_${opts.decisionReason}_` : ''),
            canAlwaysAllow: Boolean(opts.suggestions?.length),
            fromAgent,
          };
        }
        const p: Pending = { req, input, suggestions: opts.suggestions, resolve };
        sess.pending.push(p);
        opts.signal.addEventListener('abort', () => {
          const i = sess.pending.indexOf(p);
          if (i >= 0) {
            sess.pending.splice(i, 1);
            resolve({ behavior: 'deny', message: 'Cancelled.' });
            this.refreshPending(sess);
          }
        });
        this.addEntry(sess, this.entry('system', `❓ ${req.title}`));
        this.refreshPending(sess);
      });
  }

  private refreshPending(sess: Session) {
    const s = sess.s;
    s.pending = sess.pending[0]?.req;
    s.pendingCount = sess.pending.length;
    if (sess.pending.length) {
      s.status = 'waiting';
      s.unread = true;
    } else if (s.status === 'waiting') {
      s.status = sess.alive ? 'working' : 'error';
    }
    this.touch(sess);
  }

  private flushPending(sess: Session, message: string) {
    for (const p of sess.pending.splice(0)) p.resolve({ behavior: 'deny', message });
    sess.s.pending = undefined;
    sess.s.pendingCount = 0;
  }

  respond(msg: Extract<ClientMsg, { t: 'respond' }>) {
    const sess = this.must(msg.id);
    const i = sess.pending.findIndex((p) => p.req.id === msg.requestId);
    if (i < 0) return;
    const [p] = sess.pending.splice(i, 1);
    const { kind } = p.req;
    if (msg.decision === 'deny') {
      const why = msg.message?.trim();
      p.resolve({
        behavior: 'deny',
        message: why || (kind === 'plan' ? 'The user wants to keep planning.' : 'The user said no to this.'),
      });
      this.addEntry(sess, this.entry('user', why ? `🚫 ${why}` : '🚫 No'));
    } else if (kind === 'question') {
      p.resolve({ behavior: 'allow', updatedInput: { ...p.input, answers: msg.answers ?? {} } });
      const summary = Object.entries(msg.answers ?? {}).map(([q, a]) => `**${q}** → ${a}`).join('\n');
      this.addEntry(sess, this.entry('user', summary || '(answered)'));
    } else if (kind === 'plan') {
      p.resolve({ behavior: 'allow', updatedInput: p.input });
      const mode = msg.decision === 'always' ? 'acceptEdits' : 'default';
      sess.q?.setPermissionMode(mode).catch(() => {});
      sess.s.permissionMode = mode;
      this.addEntry(sess, this.entry('user', mode === 'acceptEdits' ? '✅ Plan approved (auto-accept edits)' : '✅ Plan approved'));
    } else {
      p.resolve({
        behavior: 'allow',
        updatedInput: p.input,
        updatedPermissions: msg.decision === 'always' ? p.suggestions : undefined,
      });
      this.addEntry(sess, this.entry('user', msg.decision === 'always' ? '✅ Yes, and don’t ask again' : '✅ Yes'));
    }
    this.refreshPending(sess);
  }

  send(id: string, text: string) {
    const sess = this.must(id);
    text = text.trim();
    if (!text) return;
    const btw = text.match(/^\/btw\b\s*([\s\S]*)$/i);
    if (btw) {
      if (btw[1].trim()) void this.btw(sess, btw[1].trim());
      return;
    }
    const bang = text.match(/^!\s*([\s\S]*)$/);
    if (bang) {
      if (bang[1].trim()) void this.bang(sess, bang[1].trim());
      return;
    }
    if (/^\/stop\s*$/i.test(text)) {
      void this.interrupt(id);
      return;
    }
    if (!sess.alive) {
      if (!sess.s.claudeSessionId) throw new Error('This session cannot be resumed.');
      this.launch(sess, sess.s.claudeSessionId);
    }
    sess.s.status = sess.pending.length ? 'waiting' : 'working';
    sess.s.unread = false;
    sess.s.error = undefined;
    this.addEntry(sess, this.entry('user', text));
    sess.input!.push(this.userMessage(text, sess.bangContext.splice(0)));
    this.touch(sess);
  }

  /**
   * `! cmd`: runs a shell command in the session's folder without a Claude turn, like
   * Claude Code's bash mode. The output shows up as a side note and is passed to Claude,
   * in the CLI's `<bash-input>`/`<bash-stdout>` form, along with the next message.
   */
  private async bang(sess: Session, cmd: string) {
    const question = `! ${cmd}`;
    this.addEntry(sess, this.entry('user', '```sh\n' + question + '\n```'));
    sess.s.aside = { question, ts: Date.now() };
    this.touch(sess);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith('CLAUDE_CODE') && k !== 'CLAUDECODE') env[k] = v;
    }
    const cwd = fs.existsSync(sess.s.cwd) ? sess.s.cwd : sess.launch.building.path;
    const { stdout, stderr, code, error } = await new Promise<{ stdout: string; stderr: string; code: number | null; error?: string }>((resolve) => {
      let stdout = '';
      let stderr = '';
      const cap = (acc: string, d: Buffer) => (acc.length < BANG_MAX_OUTPUT ? acc + d.toString() : acc);
      const child = spawn(process.env.SHELL || '/bin/zsh', ['-c', cmd], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: BANG_TIMEOUT_MS });
      child.stdout.on('data', (d: Buffer) => (stdout = cap(stdout, d)));
      child.stderr.on('data', (d: Buffer) => (stderr = cap(stderr, d)));
      child.on('error', (err) => resolve({ stdout, stderr, code: null, error: err.message }));
      child.on('close', (code, signal) => resolve({
        stdout, stderr, code,
        error: signal === 'SIGTERM' ? `Timed out after ${BANG_TIMEOUT_MS / 1000}s` : signal ? `Killed (${signal})` : undefined,
      }));
    });
    const trim = (t: string) => (t.length > BANG_MAX_OUTPUT ? t.slice(0, BANG_MAX_OUTPUT) + '\n… (output truncated)' : t).replace(/\s+$/, '');
    const out = trim(stdout);
    const err = trim([stderr, error].filter(Boolean).join('\n'));
    const fence = (t: string) => '````\n' + t + '\n````';
    const answer = [
      out || err ? '' : '_(no output)_',
      out && fence(out),
      err && fence(err),
      code ? `_Exit code ${code}_` : '',
    ].filter(Boolean).join('\n\n');
    this.addEntry(sess, this.entry('aside', answer));
    sess.s.aside = { question, answer, ts: Date.now() };
    sess.bangContext.push(`<bash-input>${cmd}</bash-input>\n<bash-stdout>${out}</bash-stdout><bash-stderr>${err}</bash-stderr>`);
    this.touch(sess);
  }

  async interrupt(id: string) {
    const sess = this.must(id);
    if (!sess.alive || (sess.s.status !== 'working' && sess.s.status !== 'waiting')) return;
    sess.interrupting = true;
    this.flushPending(sess, 'Interrupted by the user.');
    try {
      await sess.q?.interrupt();
    } catch {
      sess.interrupting = false;
    }
  }

  markRead(id: string) {
    const sess = this.sessions.get(id);
    if (!sess) return;
    sess.s.unread = false;
    if (sess.s.status === 'done') sess.s.status = 'idle';
    this.touch(sess);
  }

  async setMode(id: string, mode: string) {
    const sess = this.must(id);
    await sess.q?.setPermissionMode(mode as never);
    sess.s.permissionMode = mode;
    this.touch(sess);
  }

  close(id: string) {
    const sess = this.sessions.get(id);
    if (!sess) return;
    sess.closing = true;
    this.flushPending(sess, 'The session was closed.');
    if (sess.alive) {
      sess.input?.end();
      sess.q?.close();
    } else {
      sess.s.status = 'closed';
      this.touch(sess);
      setTimeout(() => this.remove(id), REMOVE_CLOSED_AFTER_MS).unref();
    }
  }

  stopAll(): number {
    let n = 0;
    for (const sess of this.sessions.values()) {
      if (sess.s.status === 'closed') continue;
      n++;
      this.close(sess.s.id);
    }
    return n;
  }

  private remove(id: string) {
    const sess = this.sessions.get(id);
    if (!sess || sess.s.status !== 'closed') return;
    this.sessions.delete(id);
    this.emit('removed', id);
  }

  private async refreshTitle(sess: Session) {
    const sid = sess.s.claudeSessionId;
    if (!sid) return;
    try {
      const info = await getSessionInfo(sid, { dir: sess.s.cwd });
      const title = info?.customTitle || info?.summary;
      if (title && title !== sess.s.title) {
        sess.s.title = title;
        this.touch(sess);
      }
    } catch {
      // keep the prompt-derived title
    }
  }

  private must(id: string): Session {
    const sess = this.sessions.get(id);
    if (!sess) throw new Error('That session is gone.');
    return sess;
  }

  private userMessage(text: string, before: string[] = []): SDKUserMessage {
    const content = before.length ? [...before, text].map((t) => ({ type: 'text', text: t })) : text;
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage;
  }

  private entry(kind: TranscriptEntry['kind'], text: string): TranscriptEntry {
    return { id: randomUUID(), ts: Date.now(), kind, text };
  }

  private addEntry(sess: Session, e: TranscriptEntry) {
    sess.entries.push(e);
    if (sess.entries.length > MAX_ENTRIES) sess.entries.splice(0, sess.entries.length - MAX_ENTRIES);
    sess.newEntries.push(e);
    sess.flushTimer ??= setTimeout(() => {
      sess.flushTimer = undefined;
      const batch = sess.newEntries.splice(0);
      if (batch.length) this.emit('entries', sess.s.id, batch);
    }, 80);
  }

  private touch(sess: Session) {
    sess.s.updatedAt = Date.now();
    sess.touchTimer ??= setTimeout(() => {
      sess.touchTimer = undefined;
      this.emit('session', sess.s);
    }, 60);
  }
}

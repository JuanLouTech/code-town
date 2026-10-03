import type {
  ClientMsg, CommandInfo, HistoryItem, ServerMsg, SessionSummary, StartOptions, TranscriptEntry, VisitorInfo, WorktreeDetail,
  WorktreeInfo, WorldState,
} from '../../shared/protocol.ts';

type Listener = (msg: ServerMsg) => void;

/** Client-side mirror of the island: world, sessions and transcripts. */
export class Store {
  world?: WorldState;
  sessions = new Map<string, SessionSummary>();
  entries = new Map<string, TranscriptEntry[]>();
  commands = new Map<string, CommandInfo[]>();
  claudeVersion?: string;
  worktrees: WorktreeInfo[] = [];
  visitors: VisitorInfo[] = [];
  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(msg: ServerMsg) {
    switch (msg.t) {
      case 'hello':
        this.world = msg.world;
        this.sessions = new Map(msg.sessions.map((s) => [s.id, s]));
        this.commands = new Map(Object.entries(msg.commands ?? {}));
        this.claudeVersion = msg.claudeVersion;
        this.worktrees = msg.worktrees ?? [];
        this.visitors = msg.visitors ?? [];
        break;
      case 'worktrees':
        this.worktrees = msg.worktrees;
        this.visitors = msg.visitors;
        break;
      case 'commands':
        this.commands.set(msg.id, msg.commands);
        break;
      case 'world':
        this.world = msg.world;
        break;
      case 'session':
        this.sessions.set(msg.session.id, msg.session);
        break;
      case 'started':
        if (msg.session && !this.sessions.has(msg.session.id)) this.sessions.set(msg.session.id, msg.session);
        break;
      case 'sessionRemoved':
        this.sessions.delete(msg.id);
        this.entries.delete(msg.id);
        this.commands.delete(msg.id);
        break;
      case 'entries': {
        const cur = msg.reset ? [] : this.entries.get(msg.id) ?? [];
        const seen = new Set(cur.map((e) => e.id));
        for (const e of msg.entries) if (!seen.has(e.id)) cur.push(e);
        this.entries.set(msg.id, cur);
        break;
      }
      default:
        break;
    }
    for (const fn of this.listeners) fn(msg);
  }

  live(): SessionSummary[] {
    return [...this.sessions.values()].filter((s) => s.status !== 'closed');
  }
}

export class Net {
  private ws?: WebSocket;
  private queue: string[] = [];
  private waiting = new Map<string, { resolve: (msg: ServerMsg) => void; reject: (err: Error) => void }>();
  private retry = 500;
  connected = false;
  onStatus?: (connected: boolean) => void;

  constructor(private store: Store) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 500;
      this.onStatus?.(true);
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      this.store.apply(msg);
      const key = this.keyOf(msg);
      if (key) {
        const cb = this.waiting.get(key);
        if (cb) {
          this.waiting.delete(key);
          cb.resolve(msg);
        }
      }
    };
    ws.onclose = () => {
      this.connected = false;
      // Nobody will answer what was asked on this connection.
      for (const w of this.waiting.values()) w.reject(new Error('Lost the connection to the island.'));
      this.waiting.clear();
      this.onStatus?.(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 1.6, 5000);
    };
  }

  private keyOf(msg: ServerMsg): string | undefined {
    switch (msg.t) {
      case 'started': return `start:${msg.reqId}`;
      case 'history': return `history:${msg.buildingId}:${msg.cwd ?? ''}`;
      case 'historyTranscript': return `historyLoad:${msg.sessionId}`;
      case 'built': return 'build';
      case 'worktree.detail': return `wt:${msg.detail.path}`;
      case 'worktree.removed': return `wtrm:${msg.path}`;
      default: return undefined;
    }
  }

  send(msg: ClientMsg) {
    const data = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }

  private request<T extends ServerMsg>(key: string, msg: ClientMsg, timeoutMs = 60_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiting.get(key)?.reject !== fail) return;
        this.waiting.delete(key);
        reject(new Error('The island took too long to answer.'));
      }, timeoutMs);
      const fail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
      this.waiting.get(key)?.reject(new Error('Asked again before the answer came.'));
      this.waiting.set(key, { resolve: (m) => (clearTimeout(timer), resolve(m as T)), reject: fail });
      this.send(msg);
    });
  }

  async start(p: { buildingId: string; characterId?: string; hire?: boolean; prompt: string; opts: StartOptions; resume?: string; resumeCwd?: string; cwd?: string }) {
    const reqId = Math.random().toString(36).slice(2);
    const res = await this.request<Extract<ServerMsg, { t: 'started' }>>(`start:${reqId}`, { t: 'start', reqId, ...p });
    return res;
  }

  /** Past conversations in a building (or in `cwd`, one of its worktrees). */
  async history(buildingId: string, cwd?: string): Promise<HistoryItem[]> {
    const res = await this.request<Extract<ServerMsg, { t: 'history' }>>(`history:${buildingId}:${cwd ?? ''}`, { t: 'history', buildingId, cwd });
    return res.items;
  }

  async historyLoad(buildingId: string, sessionId: string, cwd?: string): Promise<TranscriptEntry[]> {
    const res = await this.request<Extract<ServerMsg, { t: 'historyTranscript' }>>(`historyLoad:${sessionId}`, { t: 'historyLoad', buildingId, sessionId, cwd });
    return res.entries;
  }

  async inspectWorktree(path: string): Promise<WorktreeDetail> {
    const res = await this.request<Extract<ServerMsg, { t: 'worktree.detail' }>>(`wt:${path}`, { t: 'worktree.inspect', path });
    return res.detail;
  }

  async removeWorktree(path: string, force: boolean): Promise<string | undefined> {
    const res = await this.request<Extract<ServerMsg, { t: 'worktree.removed' }>>(`wtrm:${path}`, { t: 'worktree.remove', path, force });
    return res.error;
  }

  async build(parentId: string | null, name: string, git: boolean) {
    return this.request<Extract<ServerMsg, { t: 'built' }>>('build', { t: 'build', parentId, name, git });
  }
}

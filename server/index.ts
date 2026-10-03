import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { PlayerStore } from './player.ts';
import { SessionManager } from './sessions.ts';
import { Terminals } from './terminals.ts';
import { World } from './world.ts';
import { Worktrees } from './worktrees.ts';

const PORT = Number(process.env.CODETOWN_PORT ?? 3666);
const HOST = '127.0.0.1';
const CLIENT_PORT = Number(process.env.CODETOWN_CLIENT_PORT ?? 3667);
const PROJECT_DIR = path.resolve(import.meta.dirname, '..');
// The island is the workspace this repo lives in (its parent folder), unless told otherwise.
const ROOT = path.resolve(process.env.CODETOWN_ROOT ?? path.join(PROJECT_DIR, '..'));
const DATA_DIR = process.env.CODETOWN_DATA ?? path.join(PROJECT_DIR, '.data');
const DIST = path.join(PROJECT_DIR, 'dist');
const UPLOADS = path.resolve(DATA_DIR, 'uploads');
const MAX_UPLOAD = 100 * 1024 * 1024;
const LEAVE_GRACE_MS = 20_000;

function findClaude(): string | undefined {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const CLAUDE_BIN = findClaude();
let claudeVersion: string | undefined;
try {
  claudeVersion = CLAUDE_BIN ? execFileSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8' }).trim() : undefined;
} catch {
  claudeVersion = undefined;
}

const world = new World(ROOT, DATA_DIR);
const player = new PlayerStore(DATA_DIR);
const sessions = new SessionManager(world, CLAUDE_BIN);
const worktrees = new Worktrees(world, DATA_DIR);
world.watch();
worktrees.start();

// Browsers may only talk to us from the game's own pages (blocks cross-site WebSocket hijacking).
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`,
  `http://127.0.0.1:${CLIENT_PORT}`, `http://localhost:${CLIENT_PORT}`,
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

let leaveTimer: NodeJS.Timeout | undefined;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  if (url.pathname === '/api/leave' && req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      res.writeHead(403).end();
      return;
    }
    // The tab went away. Stop everything unless the player comes back (a reload) soon.
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (wss.clients.size === 0) {
        terminals.closeAll();
        const n = sessions.stopAll();
        if (n) console.log(`🏝️  Player left the island — stopped ${n} session(s).`);
      }
    }, LEAVE_GRACE_MS);
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    upload(req, res, url);
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessions: sessions.liveCount() }));
    return;
  }
  if (process.env.CODETOWN_DEV) {
    // In dev the live client is Vite's; never serve a stale build from here.
    res.writeHead(302, { location: `http://127.0.0.1:${CLIENT_PORT}${url.pathname}${url.search}` }).end();
    return;
  }
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Code Town server is running. Run \`npm run dev\` and open http://127.0.0.1:${CLIENT_PORT}, or \`npm start\` to build the client.`);
    return;
  }
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  const headers: Record<string, string> = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' };
  // Assets are content-hashed; the page itself must always be revalidated.
  headers['cache-control'] = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

/**
 * Files dropped (or pasted) into a chat box. Browsers never tell a page where a dropped file
 * lives, so it's stored here and the chat gets this copy's absolute path instead.
 */
function upload(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (!req.headers.origin || !ALLOWED_ORIGINS.has(req.headers.origin)) {
    res.writeHead(403).end();
    return;
  }
  const raw = (url.searchParams.get('name') ?? 'file').split(/[\\/]/).pop()!;
  const safe = raw.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  fs.mkdirSync(UPLOADS, { recursive: true });
  const file = path.join(UPLOADS, `${stamp}-${Math.random().toString(36).slice(2, 6)}-${safe}`);
  const out = fs.createWriteStream(file);
  let size = 0;
  let failed = false;
  const fail = (code: number, text: string) => {
    if (failed) return;
    failed = true;
    out.destroy();
    fs.rm(file, { force: true }, () => {});
    res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ error: text }));
  };
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_UPLOAD) {
      // Answer, then drain the rest instead of cutting the socket (so the browser sees the message).
      req.unpipe(out);
      fail(413, 'That file is too big (100 MB max).');
      req.resume();
    }
  });
  req.on('error', () => fail(400, 'Upload interrupted.'));
  out.on('error', () => fail(500, 'Could not save the file.'));
  req.pipe(out);
  out.on('finish', () => {
    if (failed) return;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ path: file }));
  });
}

/** Dropped files are only needed while a session reads them: clear out week-old ones at startup. */
function pruneUploads() {
  let names: string[];
  try {
    names = fs.readdirSync(UPLOADS);
  } catch {
    return;
  }
  for (const n of names) {
    const f = path.join(UPLOADS, n);
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > 7 * 24 * 60 * 60_000) fs.rmSync(f, { force: true });
    } catch {
      // gone already
    }
  }
}
pruneUploads();

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin }: { origin?: string }) => Boolean(origin && ALLOWED_ORIGINS.has(origin)),
});

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const terminals = new Terminals(world, send);
terminals.worktreesOf = (id) => worktreeDirs(id);

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

sessions.on('session', (session) => {
  broadcast({ t: 'session', session });
  if (session.claudeSessionId) worktrees.own(session.claudeSessionId);
  // A job that ends may have left a worktree behind (or committed to one).
  if (session.status === 'closed' || session.status === 'done') void worktrees.refresh();
});
worktrees.on('change', () => broadcast({ t: 'worktrees', worktrees: worktrees.worktrees, visitors: worktrees.visitors }));
sessions.on('entries', (id, entries) => broadcast({ t: 'entries', id, entries }));
sessions.on('removed', (id) => broadcast({ t: 'sessionRemoved', id }));
sessions.on('commands', (id, commands) => broadcast({ t: 'commands', id, commands }));
world.on('change', (state) => {
  broadcast({ t: 'world', world: state });
  void worktrees.refresh();
});

const worktreeDirs = (buildingId: string) => worktrees.worktrees.filter((w) => w.buildingId === buildingId).map((w) => w.path);

/** A running island session or an outside CLI session working inside `dir`. */
function busyIn(dir: string) {
  const inside = (cwd: string) => cwd === dir || cwd.startsWith(dir + '/');
  return sessions.list().some((s) => s.status !== 'closed' && inside(s.cwd)) || worktrees.visitors.some((v) => inside(v.cwd));
}

async function route(ws: WebSocket, msg: ClientMsg) {
  switch (msg.t) {
    case 'start':
      try {
        const id = await sessions.start(msg, worktreeDirs(msg.buildingId));
        send(ws, { t: 'started', reqId: msg.reqId, id, session: sessions.get(id) });
      } catch (err) {
        send(ws, { t: 'started', reqId: msg.reqId, error: (err as Error).message });
      }
      break;
    case 'send':
      sessions.send(msg.id, msg.text);
      break;
    case 'interrupt':
      await sessions.interrupt(msg.id);
      break;
    case 'close':
      sessions.close(msg.id);
      break;
    case 'read':
      sessions.markRead(msg.id);
      break;
    case 'respond':
      sessions.respond(msg);
      break;
    case 'setMode':
      await sessions.setMode(msg.id, msg.mode);
      break;
    case 'transcript':
      send(ws, { t: 'entries', id: msg.id, entries: sessions.transcript(msg.id), reset: true });
      break;
    case 'history':
      send(ws, {
        t: 'history', buildingId: msg.buildingId, cwd: msg.cwd,
        items: await sessions.history(msg.buildingId, msg.cwd && worktreeDirs(msg.buildingId).includes(msg.cwd) ? msg.cwd : undefined),
      });
      break;
    case 'historyLoad':
      send(ws, {
        t: 'historyTranscript', sessionId: msg.sessionId,
        entries: await sessions.historyTranscript(msg.buildingId, msg.sessionId,
          msg.cwd && worktreeDirs(msg.buildingId).includes(msg.cwd) ? msg.cwd : undefined),
      });
      break;
    case 'build':
      try {
        send(ws, { t: 'built', buildingId: world.createFolder(msg.parentId, msg.name, msg.git) });
      } catch (err) {
        send(ws, { t: 'built', error: (err as Error).message });
      }
      break;
    case 'term.open':
      terminals.open(ws, msg.termId, msg.buildingId, msg.cwd, msg.cols, msg.rows);
      break;
    case 'term.input':
      terminals.input(msg.termId, msg.data);
      break;
    case 'term.resize':
      terminals.resize(msg.termId, msg.cols, msg.rows);
      break;
    case 'term.close':
      terminals.close(msg.termId);
      break;
    case 'term.escape':
      terminals.escape(msg.termId);
      break;
    case 'exit': {
      terminals.closeAll();
      const stopped = sessions.stopAll();
      broadcast({ t: 'bye', stopped });
      break;
    }
    case 'rescan':
      if (world.rescan()) broadcast({ t: 'world', world: world.state });
      break;
    case 'worktree.inspect':
      send(ws, { t: 'worktree.detail', detail: await worktrees.detail(msg.path) });
      break;
    case 'worktree.remove':
      try {
        if (busyIn(msg.path)) throw new Error('Someone is still working in there. Wrap up that session first.');
        await worktrees.remove(msg.path, msg.force);
        send(ws, { t: 'worktree.removed', path: msg.path });
      } catch (err) {
        send(ws, { t: 'worktree.removed', path: msg.path, error: (err as Error).message });
      }
      break;
    case 'arrange':
      world.arrange(msg.blocks && typeof msg.blocks === 'object' ? msg.blocks : {}, msg.slots && typeof msg.slots === 'object' ? msg.slots : {});
      break;
    case 'save': {
      player.set(msg.key, msg.value);
      // Other open tabs follow along, so none of them overwrites this with an older copy.
      const data = JSON.stringify({ t: 'player', key: msg.key, value: msg.value } satisfies ServerMsg);
      for (const other of wss.clients) if (other !== ws && other.readyState === WebSocket.OPEN) other.send(data);
      break;
    }
  }
}

wss.on('connection', (ws) => {
  clearTimeout(leaveTimer);
  send(ws, { t: 'hello', world: world.state, sessions: sessions.list(), claudeVersion, commands: sessions.allCommands(), player: player.all(),
    worktrees: worktrees.worktrees, visitors: worktrees.visitors });
  ws.on('close', () => terminals.closeFor(ws));
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    route(ws, msg).catch((err) => send(ws, { t: 'toast', level: 'error', text: (err as Error).message }));
  });
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  const props = world.state.properties.length;
  const buildings = world.buildings().length;
  console.log(`🏝️  Code Town — ${props} properties, ${buildings} buildings from ${ROOT}`);
  console.log(`   Claude Code: ${claudeVersion ?? 'not found (using the SDK bundled binary)'}`);
  console.log(`   Server listening on ${url}${process.env.CODETOWN_DEV ? ` (dev: pages redirect to the Vite client on :${CLIENT_PORT})` : ''}`);
  if (process.argv.includes('--open') && fs.existsSync(DIST)) execFile('open', [url], () => {});
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  terminals.closeAll();
  const n = sessions.stopAll();
  if (n) console.log(`\n🌙 Stopping ${n} session(s) before leaving the island…`);
  world.stop();
  worktrees.stop();
  player.flush();
  const deadline = Date.now() + 4000;
  while (sessions.liveCount() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

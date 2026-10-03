import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Building, VisitorInfo, WorktreeDetail, WorktreeInfo } from '../shared/protocol.ts';
import { gitKind, type World } from './world.ts';

const SCAN_MS = 20_000;
/** A transcript written this recently probably belongs to a session that's still open. */
const ACTIVE_MS = 3 * 60_000;
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
/** How long the island remembers its own Claude session ids (so their transcripts aren't mistaken for visitors). */
const OWNED_TTL_MS = 24 * 60 * 60_000;

function git(cwd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    // No optional locks: a background `git status` must never make a villager's commit fail on index.lock.
    execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

/** Claude Code keeps each folder's transcripts in ~/.claude/projects/<path with every non-alphanumeric as ->. */
function projectDir(cwd: string) {
  return path.join(PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** The branch a repo's work is measured against: origin's default branch, else main or master. */
async function baseOf(repo: string): Promise<string | undefined> {
  const remote = (await quiet(git(repo, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']), '')).trim();
  if (remote) return remote;
  for (const b of ['main', 'master']) {
    if (await quiet(git(repo, ['rev-parse', '-q', '--verify', `refs/heads/${b}`]).then(() => true), false)) return b;
  }
  return undefined;
}

/**
 * Keeps an eye on git worktrees (pumpkins) and on Claude Code sessions running outside the
 * island (visitors). Slower than the folder scan, and sent separately so the island isn't rebuilt.
 */
export class Worktrees extends EventEmitter {
  worktrees: WorktreeInfo[] = [];
  visitors: VisitorInfo[] = [];
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private again = false;
  private signature = '';
  private owned = new Map<string, number>();
  private ownedFile: string;

  constructor(private world: World, dataDir: string) {
    super();
    this.ownedFile = path.join(dataDir, 'owned-sessions.json');
    try {
      const raw = JSON.parse(fs.readFileSync(this.ownedFile, 'utf8')) as Record<string, number>;
      for (const [id, at] of Object.entries(raw)) if (Date.now() - at < OWNED_TTL_MS) this.owned.set(id, at);
    } catch {
      // nothing remembered yet
    }
  }

  /** Records a Claude session id as the island's own (kept across restarts for a day). */
  own(sessionId: string) {
    const fresh = !this.owned.has(sessionId);
    this.owned.set(sessionId, Date.now());
    if (!fresh) return;
    for (const [id, at] of this.owned) if (Date.now() - at > OWNED_TTL_MS) this.owned.delete(id);
    try {
      fs.writeFileSync(this.ownedFile, JSON.stringify(Object.fromEntries(this.owned)));
    } catch {
      // best effort
    }
  }

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), SCAN_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Rescans now (coalesced if a scan is already running). */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.scan()
      .catch((err) => console.warn('worktree scan failed:', (err as Error).message))
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.running;
  }

  /** Is `dir` one of this building's worktrees? */
  isWorktreeOf(buildingId: string, dir: string) {
    return this.worktrees.some((w) => w.buildingId === buildingId && w.path === dir);
  }

  find(dir: string) {
    return this.worktrees.find((w) => w.path === dir);
  }

  private async scan() {
    // Only main checkouts grow pumpkins; a linked worktree that is itself an island folder is a house.
    const repos = this.world.buildings().filter((b) => b.isRepo && gitKind(b.path) === 'repo');
    const houses = new Set(this.world.buildings().map((b) => b.path));
    const lists = await Promise.all(repos.map((b) => this.repoWorktrees(b)));
    const worktrees = lists.flat().filter((w) => !houses.has(w.path));
    const visitors = await this.findVisitors(worktrees);
    const signature = JSON.stringify([worktrees, visitors.map((v) => [v.sessionId, v.buildingId, v.title])]);
    this.worktrees = worktrees;
    this.visitors = visitors;
    if (signature !== this.signature) {
      this.signature = signature;
      this.emit('change');
    }
  }

  private async repoWorktrees(b: Building): Promise<WorktreeInfo[]> {
    const out = await quiet(git(b.path, ['worktree', 'list', '--porcelain']), '');
    const entries = out.split('\n\n').map((block) => {
      const e: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const i = line.indexOf(' ');
        if (line) e[i < 0 ? line : line.slice(0, i)] = i < 0 ? 'true' : line.slice(i + 1);
      }
      return e;
    }).filter((e) => e.worktree);
    // The first entry is the main checkout itself.
    const extra = entries.slice(1).filter((e) => !e.bare && !e.prunable && fs.existsSync(e.worktree));
    if (!extra.length) return [];
    const base = await baseOf(b.path);
    return Promise.all(extra.map(async (e): Promise<WorktreeInfo> => {
      const wt = e.worktree;
      const [counts, status, last] = await Promise.all([
        base ? quiet(git(wt, ['rev-list', '--left-right', '--count', `${base}...HEAD`]), '0\t0') : Promise.resolve('0\t0'),
        quiet(git(wt, ['status', '--porcelain']), ''),
        quiet(git(wt, ['log', '-1', '--format=%s%x00%ct']), ''),
      ]);
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
      const [subject, ct] = last.trim().split('\0');
      return {
        path: wt,
        buildingId: b.id,
        branch: e.branch?.replace(/^refs\/heads\//, ''),
        base,
        ahead: ahead || 0,
        behind: behind || 0,
        dirty: status.split('\n').filter(Boolean).length,
        mine: /[\\/]\.claude[\\/]worktrees[\\/](?:crossing|codetown)-/.test(wt),
        lastCommit: subject || undefined,
        lastCommitAt: ct ? Number(ct) * 1000 : undefined,
      };
    }));
  }

  /** Recently written transcripts in a repo or worktree that no island session owns. */
  private async findVisitors(worktrees: WorktreeInfo[]): Promise<VisitorInfo[]> {
    const now = Date.now();
    const dirs = [
      ...this.world.buildings().map((b) => ({ cwd: b.path, buildingId: b.id })),
      ...worktrees.map((w) => ({ cwd: w.path, buildingId: w.buildingId })),
    ];
    const found: VisitorInfo[] = [];
    for (const d of dirs) {
      let files: string[];
      try {
        files = fs.readdirSync(projectDir(d.cwd)).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const sessionId = f.slice(0, -'.jsonl'.length);
        if (this.owned.has(sessionId)) continue;
        let at: number;
        try {
          at = fs.statSync(path.join(projectDir(d.cwd), f)).mtimeMs;
        } catch {
          continue;
        }
        if (now - at < ACTIVE_MS) found.push({ sessionId, buildingId: d.buildingId, cwd: d.cwd, at });
      }
    }
    // Titles, like the notebook shows them.
    await Promise.all(found.map(async (v) => {
      const s = await quiet(getSessionInfo(v.sessionId, { dir: v.cwd }), undefined);
      const title = s?.customTitle || s?.summary || s?.firstPrompt;
      if (title) v.title = title.split('\n')[0].slice(0, 80);
    }));
    return found;
  }

  /** The details behind the "Inspect" option. */
  async detail(dir: string): Promise<WorktreeDetail> {
    const w = this.find(dir);
    if (!w) return { path: dir, status: [], ignored: [], log: [], error: 'That worktree is gone.' };
    try {
      const [status, ignored, log] = await Promise.all([
        git(dir, ['status', '--short']),
        git(dir, ['status', '--porcelain', '--ignored', '--untracked-files=normal']).then((o) => o.split('\n').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3))),
        w.base ? git(dir, ['log', '--oneline', '-n', '30', `${w.base}..HEAD`]) : git(dir, ['log', '--oneline', '-n', '10']),
      ]);
      return { path: dir, status: status.split('\n').filter(Boolean), ignored, log: log.split('\n').filter(Boolean) };
    } catch (err) {
      return { path: dir, status: [], ignored: [], log: [], error: (err as Error).message };
    }
  }

  /** "Compost": removes the worktree and deletes its branch. */
  async remove(dir: string, force: boolean): Promise<void> {
    const w = this.find(dir);
    if (!w) throw new Error('That worktree is gone.');
    const repo = this.world.getBuilding(w.buildingId)?.path;
    if (!repo) throw new Error('Its repository is gone.');
    await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), dir], 30_000);
    if (w.branch) await quiet(git(repo, ['branch', force ? '-D' : '-d', w.branch]), '');
    await this.refresh();
  }
}

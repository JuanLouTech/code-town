import fs from 'node:fs';
import path from 'node:path';
import pty, { type IPty } from 'node-pty';
import type { WebSocket } from 'ws';
import type { ServerMsg } from '../shared/protocol.ts';
import type { World } from './world.ts';

interface Term {
  p: IPty;
  ws: WebSocket;
  shell: string;
}

/** Real shells (PTYs) behind each house's mailbox, for commands that need a human (sudo, prompts…). */
export class Terminals {
  private terms = new Map<string, Term>();

  constructor(private world: World, private send: (ws: WebSocket, msg: ServerMsg) => void) {}

  /** Extra folders a building's terminal may open in: its git worktrees, wherever they live. */
  worktreesOf: (buildingId: string) => string[] = () => [];

  open(ws: WebSocket, termId: string, buildingId: string, cwd: string | undefined, cols: number, rows: number) {
    this.close(termId);
    const b = this.world.getBuilding(buildingId);
    if (!b) {
      this.send(ws, { t: 'term.exit', termId, code: 1, error: 'That house no longer exists.' });
      return;
    }
    // Only folders on the island: the house itself, a folder inside it, or one of its worktrees.
    let dir = b.path;
    if (cwd) {
      const resolved = path.resolve(cwd);
      const inside = resolved === b.path || resolved.startsWith(b.path + path.sep) || this.worktreesOf(buildingId).includes(resolved);
      if (inside && fs.existsSync(resolved)) dir = resolved;
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      // Don't let the terminal think it's running inside a Claude Code session.
      if (v !== undefined && !k.startsWith('CLAUDE_CODE') && k !== 'CLAUDECODE') env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    const shell = process.env.SHELL || '/bin/zsh';
    let p: IPty;
    try {
      p = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols: Math.max(20, cols), rows: Math.max(5, rows), cwd: dir, env });
    } catch (err) {
      this.send(ws, { t: 'term.exit', termId, code: 1, error: (err as Error).message });
      return;
    }
    this.terms.set(termId, { p, ws, shell: path.basename(shell) });
    p.onData((data) => this.send(ws, { t: 'term.data', termId, data }));
    p.onExit(({ exitCode }) => {
      if (this.terms.get(termId)?.p === p) this.terms.delete(termId);
      this.send(ws, { t: 'term.exit', termId, code: exitCode });
    });
  }

  /**
   * Esc on a letter: close it if the shell is just sitting at its prompt;
   * if something is still running (sudo waiting for a password, a build…)
   * say so instead, and the client folds the letter away without killing it.
   */
  escape(termId: string) {
    const t = this.terms.get(termId);
    if (!t) return;
    let fg = '';
    try {
      fg = path.basename(t.p.process ?? '').replace(/^-/, '');
    } catch {
      fg = t.shell;
    }
    if (!fg || fg === t.shell || fg === 'login') {
      this.terms.delete(termId);
      try {
        t.p.kill();
      } catch {
        // already gone
      }
      this.send(t.ws, { t: 'term.exit', termId, code: 0, closed: true });
    } else {
      this.send(t.ws, { t: 'term.busy', termId, process: fg });
    }
  }

  input(termId: string, data: string) {
    this.terms.get(termId)?.p.write(data);
  }

  resize(termId: string, cols: number, rows: number) {
    try {
      this.terms.get(termId)?.p.resize(Math.max(20, cols), Math.max(5, rows));
    } catch {
      // the process may have just exited
    }
  }

  close(termId: string) {
    const t = this.terms.get(termId);
    if (!t) return;
    this.terms.delete(termId);
    try {
      t.p.kill();
    } catch {
      // already gone
    }
  }

  closeFor(ws: WebSocket) {
    for (const [id, t] of this.terms) if (t.ws === ws) this.close(id);
  }

  closeAll(): number {
    const n = this.terms.size;
    for (const id of [...this.terms.keys()]) this.close(id);
    return n;
  }
}

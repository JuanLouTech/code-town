import fs from 'node:fs';
import path from 'node:path';
import type { Building } from '../shared/protocol.ts';
import type { World } from './world.ts';

/**
 * Maps a filesystem path to the building (repo) that owns it. Worktrees are
 * followed back to their main repository, so a gnome working in
 * `.worktrees/my-repo-feature` shows up on the my-repo farm.
 */
export class PathResolver {
  private cache = new Map<string, string | null>();

  constructor(private world: World) {
    world.on('change', () => this.cache.clear());
  }

  building(abs: string): Building | undefined {
    const repo = this.repoRoot(abs);
    return (repo && this.world.buildingForPath(repo)) || this.world.buildingForPath(abs);
  }

  private repoRoot(abs: string): string | null {
    const root = this.world.root;
    const visited: string[] = [];
    let dir = abs;
    let result: string | null = null;
    while (dir.startsWith(root) && dir !== root) {
      const cached = this.cache.get(dir);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      visited.push(dir);
      const found = this.gitRootAt(dir);
      if (found) {
        result = found;
        break;
      }
      dir = path.dirname(dir);
    }
    for (const v of visited) this.cache.set(v, result);
    return result;
  }

  private gitRootAt(dir: string): string | null {
    const g = path.join(dir, '.git');
    let st: fs.Stats;
    try {
      st = fs.statSync(g);
    } catch {
      return null;
    }
    if (st.isDirectory()) return dir;
    try {
      const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/);
      if (m) {
        const gitdir = path.resolve(dir, m[1].trim());
        const idx = gitdir.indexOf(`${path.sep}.git${path.sep}worktrees${path.sep}`);
        if (idx >= 0) return gitdir.slice(0, idx);
      }
    } catch {
      // unreadable .git file: treat the folder itself as the repo
    }
    return dir;
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { findSpot, validLayout } from '../shared/pack.ts';
import { CIRCUIT_ID, FAIR_ID, RESERVED_SIZES, type Block, type Building, type Look, type Property, type Resident, type WorldState } from '../shared/protocol.ts';
import { hash, villagerLook, villagerName } from './names.ts';

const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'target', '__pycache__', '.venv', 'venv', 'coverage',
]);
const NESTED_DEPTH = 2;
const PLAZA: Block = { gx: -1, gz: -1, cols: 3, rows: 2 };
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface Scanned {
  id: string;
  name: string;
  path: string;
  isRepo: boolean;
  children: { id: string; name: string; path: string }[];
}

interface PersistedState {
  blocks: Record<string, Block>;
  slots: Record<string, Record<string, number>>;
  residents: Record<string, { name: string; look: Look }>;
}

type GitKind = 'repo' | 'worktree' | null;

export function gitKind(dir: string): GitKind {
  const g = path.join(dir, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(g);
  } catch {
    return null;
  }
  if (st.isDirectory()) return 'repo';
  try {
    const txt = fs.readFileSync(g, 'utf8');
    return /[\\/]worktrees[\\/]/.test(txt) ? 'worktree' : 'repo';
  } catch {
    return null;
  }
}

function findNestedRepos(dir: string, depth: number, out: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    const kind = gitKind(p);
    if (kind === 'repo') out.push(p);
    else if (kind === null && depth > 1) findNestedRepos(p, depth - 1, out);
  }
}

function townDims(buildings: number): { cols: number; rows: number } {
  const total = buildings + 1; // one vacant lot, ready for construction
  const cols = total <= 3 ? total : Math.ceil(Math.sqrt(total));
  return { cols, rows: Math.ceil(total / cols) };
}

function mainSlot(cols: number, rows: number): number {
  return (rows - 1) * cols + Math.floor((cols - 1) / 2);
}

export class World extends EventEmitter {
  readonly root: string;
  private stateFile: string;
  private persisted: PersistedState;
  private signature = '';
  state: WorldState;
  private buildingIndex = new Map<string, Building>();
  private timer?: NodeJS.Timeout;
  private scanned: Scanned[] = [];

  constructor(root: string, dataDir: string) {
    super();
    this.root = path.resolve(root);
    fs.mkdirSync(dataDir, { recursive: true });
    this.stateFile = path.join(dataDir, 'world.json');
    this.persisted = this.load();
    this.state = { root: this.root, version: 0, plaza: PLAZA, properties: [] };
    this.rescan();
  }

  private load(): PersistedState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { blocks: raw.blocks ?? {}, slots: raw.slots ?? {}, residents: raw.residents ?? {} };
    } catch {
      return { blocks: {}, slots: {}, residents: {} };
    }
  }

  private save() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.persisted, null, 2));
  }

  watch(intervalMs = 5000) {
    this.timer = setInterval(() => {
      if (this.rescan()) this.emit('change', this.state);
    }, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private rel(p: string): string {
    return path.relative(this.root, p).split(path.sep).join('/');
  }

  private scan(): Scanned[] {
    const out: Scanned[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(this.root, e.name);
      const nested: string[] = [];
      findNestedRepos(p, NESTED_DEPTH, nested);
      out.push({
        id: e.name,
        name: e.name,
        path: p,
        isRepo: gitKind(p) !== null,
        children: nested
          .sort((a, b) => a.localeCompare(b))
          .map((c) => ({ id: this.rel(c), name: this.rel(c).slice(e.name.length + 1), path: c })),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Re-reads the filesystem. Returns true if the island changed. */
  rescan(): boolean {
    const scanned = this.scan();
    const signature = JSON.stringify(scanned.map((s) => [s.id, s.isRepo, s.children.map((c) => c.id)]));
    if (signature === this.signature) return false;
    this.signature = signature;
    this.scanned = scanned;
    this.layout(scanned);
    return true;
  }

  /**
   * The builder's "rearrange" mode: moves properties (sizes can't change, nothing may overlap)
   * and houses inside towns (`slots`: each town's complete building → lot mapping).
   */
  arrange(moves: Record<string, { gx: number; gz: number }> = {}, slots: Record<string, Record<string, number>> = {}) {
    const p = this.persisted;
    const next: Record<string, Block> = {};
    for (const [id, b] of Object.entries(p.blocks)) {
      const m = moves[id];
      next[id] = m && Number.isInteger(m.gx) && Number.isInteger(m.gz) ? { ...b, gx: m.gx, gz: m.gz } : b;
    }
    if (!validLayout(Object.values(next), [PLAZA])) throw new Error('Those spots overlap. Try moving it somewhere else.');
    const nextSlots: PersistedState['slots'] = {};
    for (const [pid, map] of Object.entries(slots)) {
      const prop = this.getProperty(pid);
      if (!prop || prop.kind !== 'town') throw new Error(`${pid} isn't a town.`);
      const cap = prop.cols * prop.rows;
      const ids = prop.buildings.map((b) => b.id);
      const values = ids.map((id) => map[id]);
      if (Object.keys(map).length !== ids.length || values.some((v) => !Number.isInteger(v) || v < 0 || v >= cap) || new Set(values).size !== values.length) {
        throw new Error(`Those lots don't work for ${pid}.`);
      }
      nextSlots[pid] = { ...map };
    }
    p.blocks = next;
    Object.assign(p.slots, nextSlots);
    this.layout(this.scanned);
    this.emit('change', this.state);
  }

  private layout(scanned: Scanned[]) {
    const p = this.persisted;
    const live = new Set(scanned.map((s) => s.id));
    for (const id of Object.keys(p.blocks)) if (!live.has(id) && !RESERVED_SIZES[id]) delete p.blocks[id];
    for (const id of Object.keys(p.slots)) if (!live.has(id)) delete p.slots[id];

    // Work out the block size each property needs; drop placements that no longer fit.
    const dims = new Map<string, { cols: number; rows: number }>();
    for (const s of scanned) {
      const d = s.children.length === 0 ? { cols: 1, rows: 1 } : townDims(s.children.length + 1);
      dims.set(s.id, d);
      const old = p.blocks[s.id];
      const oldCap = old ? old.cols * old.rows : 0;
      const need = s.children.length === 0 ? 1 : s.children.length + 1;
      const kindChanged = old && (old.cols * old.rows === 1) !== (need === 1);
      if (old && (oldCap < need || kindChanged)) {
        delete p.blocks[s.id];
        delete p.slots[s.id];
      }
    }

    // Place new properties: big towns first, then singles alphabetically.
    const unplaced = scanned
      .filter((s) => !p.blocks[s.id])
      .sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    for (const s of unplaced) {
      const d = dims.get(s.id)!;
      p.blocks[s.id] = this.findSpot(d.cols, d.rows);
    }
    for (const [id, size] of Object.entries(RESERVED_SIZES)) {
      const b = p.blocks[id];
      if (b && (b.cols !== size.cols || b.rows !== size.rows)) delete p.blocks[id]; // resized: find it a new spot
      p.blocks[id] ??= this.findSpot(size.cols, size.rows);
    }

    // Build the world model.
    const takenNames = new Set<string>();
    for (const r of Object.values(p.residents)) takenNames.add(r.name);
    const properties: Property[] = [];
    this.buildingIndex.clear();

    for (const s of scanned) {
      const block = p.blocks[s.id];
      const kind = s.children.length === 0 ? 'single' : 'town';
      const buildings: Building[] = [];
      if (kind === 'single') {
        buildings.push(this.makeBuilding(s.id, s.name, s.path, s.isRepo, 'single', s.id, 0, takenNames));
      } else {
        const slots = (p.slots[s.id] ??= {});
        const cap = block.cols * block.rows;
        // The town hall starts in the middle of the front row, but can be moved like any house.
        if (!Number.isInteger(slots[s.id]) || slots[s.id] < 0 || slots[s.id] >= cap) slots[s.id] = mainSlot(block.cols, block.rows);
        const main = slots[s.id];
        const used = new Set<number>([main]);
        const childIds = new Set(s.children.map((c) => c.id));
        for (const [bid, slot] of Object.entries(slots)) {
          if (bid === s.id) continue;
          if (!childIds.has(bid) || slot >= cap || used.has(slot)) delete slots[bid];
          else used.add(slot);
        }
        for (const c of s.children) {
          if (slots[c.id] !== undefined) continue;
          let slot = 0;
          while (used.has(slot)) slot++;
          slots[c.id] = slot;
          used.add(slot);
        }
        buildings.push(this.makeBuilding(s.id, s.name, s.path, s.isRepo, 'main', s.id, main, takenNames));
        for (const c of s.children) {
          buildings.push(this.makeBuilding(c.id, c.name, c.path, true, 'child', s.id, slots[c.id], takenNames));
        }
      }
      properties.push({ id: s.id, name: s.name, path: s.path, isRepo: s.isRepo, kind, ...block, buildings });
    }

    this.save();
    this.state = { root: this.root, version: this.state.version + 1, plaza: PLAZA, fair: p.blocks[FAIR_ID], circuit: p.blocks[CIRCUIT_ID], properties };
  }

  private makeBuilding(
    id: string, name: string, abs: string, isRepo: boolean, role: Building['role'],
    propertyId: string, slot: number, takenNames: Set<string>,
  ): Building {
    const seats = role === 'main' ? 3 : 1;
    const residents: Resident[] = [];
    for (let seat = 0; seat < seats; seat++) {
      const rid = `${id}#${seat}`;
      let r = this.persisted.residents[rid];
      if (!r) {
        const seed = hash(rid);
        r = { name: villagerName(seed, takenNames), look: villagerLook(seed) };
        takenNames.add(r.name);
        this.persisted.residents[rid] = r;
      }
      residents.push({ id: rid, name: r.name, look: r.look, seat });
    }
    const b: Building = { id, name, path: abs, isRepo, role, propertyId, slot, style: hash(id), residents };
    this.buildingIndex.set(id, b);
    return b;
  }

  private findSpot(cols: number, rows: number): Block {
    return findSpot([PLAZA, ...Object.values(this.persisted.blocks)], cols, rows);
  }

  getBuilding(id: string): Building | undefined {
    return this.buildingIndex.get(id);
  }

  getProperty(id: string): Property | undefined {
    return this.state.properties.find((p) => p.id === id);
  }

  buildings(): Building[] {
    return [...this.buildingIndex.values()];
  }

  /** Finds the building that owns an absolute path (longest matching prefix). */
  buildingForPath(abs: string): Building | undefined {
    let best: Building | undefined;
    for (const b of this.buildingIndex.values()) {
      if (abs === b.path || abs.startsWith(b.path + path.sep)) {
        if (!best || b.path.length > best.path.length) best = b;
      }
    }
    return best;
  }

  createFolder(parentId: string | null, name: string, git: boolean): string {
    name = name.trim();
    if (!VALID_NAME.test(name)) {
      throw new Error('Names can use letters, numbers, dots, dashes and underscores (max 64).');
    }
    const parent = parentId ? this.getProperty(parentId) : undefined;
    if (parentId && !parent) throw new Error(`Unknown property: ${parentId}`);
    const base = parent ? parent.path : this.root;
    const target = path.resolve(base, name);
    if (path.dirname(target) !== base) throw new Error('Invalid folder name.');
    if (fs.existsSync(target)) throw new Error(`${name} already exists there.`);
    fs.mkdirSync(target);
    if (git || parent) execFileSync('git', ['init', '-q'], { cwd: target });
    this.rescan();
    this.emit('change', this.state);
    return this.rel(target);
  }
}

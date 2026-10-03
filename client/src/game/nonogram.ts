/**
 * Nonogram (picross) logic: clues, a line solver and a puzzle generator.
 * An empty line's clue is `[]` (the UI shows it as "0").
 */

/** rows × cols, true = filled. */
export type Grid = boolean[][];
type Cell = 0 | 1 | -1;

export function cluesOf(grid: Grid): { rows: number[][]; cols: number[][] } {
  const runs = (line: boolean[]) => {
    const out: number[] = [];
    let n = 0;
    for (const c of line) {
      if (c) n++;
      else if (n) {
        out.push(n);
        n = 0;
      }
    }
    if (n) out.push(n);
    return out;
  };
  const size = grid[0]?.length ?? 0;
  return {
    rows: grid.map(runs),
    cols: Array.from({ length: size }, (_, x) => runs(grid.map((r) => r[x]))),
  };
}

/**
 * Everything a single line's clue tells us given what's known: forward and
 * backward reachability over (cell, blocks placed), then each cell is fixed if
 * only one value appears across all valid placements. Null on contradiction.
 */
function solveLine(clue: number[], line: Cell[]): Cell[] | null {
  const n = line.length;
  const k = clue.length;
  const canEmpty = (i: number) => line[i] !== 1;
  const fits = (i: number, L: number) => {
    if (i + L > n) return false;
    for (let x = i; x < i + L; x++) if (line[x] === 0) return false;
    return true;
  };
  const F = Array.from({ length: n + 1 }, () => new Array<boolean>(k + 1).fill(false));
  const B = Array.from({ length: n + 2 }, () => new Array<boolean>(k + 1).fill(false));
  F[0][0] = true;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!F[i][j]) continue;
      if (canEmpty(i)) F[i + 1][j] = true;
      if (j < k && fits(i, clue[j])) {
        const e = i + clue[j];
        if (e === n) F[n][j + 1] = true;
        else if (canEmpty(e)) F[e + 1][j + 1] = true;
      }
    }
  }
  if (!F[n][k]) return null;
  B[n][k] = true;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= k; j++) {
      let ok = canEmpty(i) && B[i + 1][j];
      if (!ok && j < k && fits(i, clue[j])) {
        const e = i + clue[j];
        ok = e === n ? B[n][j + 1] : canEmpty(e) && B[e + 1][j + 1];
      }
      B[i][j] = ok;
    }
  }
  const mayFill = new Array<boolean>(n).fill(false);
  const mayEmpty = new Array<boolean>(n).fill(false);
  const fillDiff = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!F[i][j]) continue;
      if (canEmpty(i) && B[i + 1][j]) mayEmpty[i] = true;
      if (j < k && fits(i, clue[j])) {
        const e = i + clue[j];
        const ok = e === n ? B[n][j + 1] : canEmpty(e) && B[e + 1][j + 1];
        if (!ok) continue;
        fillDiff[i]++;
        fillDiff[e]--;
        if (e < n) mayEmpty[e] = true;
      }
    }
  }
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += fillDiff[i];
    mayFill[i] = run > 0;
  }
  const out = line.slice();
  for (let i = 0; i < n; i++) {
    if (!mayFill[i] && !mayEmpty[i]) return null;
    if (mayFill[i] && !mayEmpty[i]) out[i] = 1;
    else if (mayEmpty[i] && !mayFill[i]) out[i] = 0;
  }
  return out;
}

/** Line-by-line constraint propagation. 1 filled, 0 empty, -1 unknown; null on contradiction. */
export function solveByLines(rows: number[][], cols: number[][], size: number): (0 | 1 | -1)[][] | null {
  const g: Cell[][] = Array.from({ length: size }, () => new Array<Cell>(size).fill(-1));
  const rowDirty = new Array<boolean>(size).fill(true);
  const colDirty = new Array<boolean>(size).fill(true);
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < size; y++) {
      if (!rowDirty[y]) continue;
      rowDirty[y] = false;
      const r = solveLine(rows[y], g[y]);
      if (!r) return null;
      for (let x = 0; x < size; x++) {
        if (r[x] !== g[y][x]) {
          g[y][x] = r[x];
          colDirty[x] = true;
          changed = true;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      if (!colDirty[x]) continue;
      colDirty[x] = false;
      const c = solveLine(cols[x], g.map((row) => row[x]));
      if (!c) return null;
      for (let y = 0; y < size; y++) {
        if (c[y] !== g[y][x]) {
          g[y][x] = c[y];
          rowDirty[y] = true;
          changed = true;
        }
      }
    }
  }
  return g;
}

/** True when the clues alone pin down every cell by line logic (so the solution is unique). */
export function isUnique(grid: Grid): boolean {
  const { rows, cols } = cluesOf(grid);
  const g = solveByLines(rows, cols, grid.length);
  return Boolean(g && g.every((r) => r.every((c) => c !== -1)));
}

export interface Picture { id: string; name: string; rows: string[] }

export function pictureGrid(p: Picture): Grid {
  return p.rows.map((r) => [...r].map((c) => c === '#'));
}

/** Hand-made 15×15 pictures, each one line-solvable. */
export const PICTURES: Picture[] = [
  {
    id: 'heart', name: 'Heart', rows: [
      '...............',
      '..###.....###..',
      '.#####...#####.',
      '##..###.#######',
      '#.#############',
      '###############',
      '###############',
      '.#############.',
      '..###########..',
      '...#########...',
      '....#######....',
      '.....#####.....',
      '......###......',
      '.......#.......',
      '...............',
    ],
  },
  {
    id: 'cat', name: 'Cat', rows: [
      '.#...........#.',
      '.##.........##.',
      '.###.......###.',
      '.####.....####.',
      '.#############.',
      '###############',
      '###..#####..###',
      '###..#####..###',
      '###############',
      '#######.#######',
      '######...######',
      '.######.######.',
      '..#####.#####..',
      '...#########...',
      '.....#####.....',
    ],
  },
  {
    id: 'house', name: 'Cozy house', rows: [
      '.......#....##.',
      '......###...##.',
      '.....#####..##.',
      '....#######.##.',
      '...###########.',
      '..#############',
      '.##############',
      '###############',
      '..#..........#.',
      '..#.##....##.#.',
      '..#.##....##.#.',
      '..#....##....#.',
      '..#....##....#.',
      '..#....##....#.',
      '###############',
    ],
  },
  {
    id: 'tree', name: 'Fruit tree', rows: [
      '.....#####.....',
      '...#########...',
      '..###########..',
      '.####.#######..',
      '.#####.#####.#.',
      '###############',
      '####.########.#',
      '###############',
      '.#####.#######.',
      '..###########..',
      '....#######....',
      '.......##......',
      '.......##......',
      '......####.....',
      '....########...',
    ],
  },
  {
    id: 'fish', name: 'Sea bass', rows: [
      '...............',
      '.....###.......',
      '......#####....',
      '....########...',
      '..###########.#',
      '.####.#######.#',
      '#####.#######.#',
      '###############',
      '#############.#',
      '.############.#',
      '..###########.#',
      '....#######....',
      '.......###.....',
      '...............',
      '...............',
    ],
  },
  {
    id: 'mushroom', name: 'Mushroom', rows: [
      '.....#####.....',
      '...#########...',
      '..###..##.####.',
      '.###....#..###.',
      '.####..###.###.',
      '###############',
      '###..#####..###',
      '##....###....##',
      '###############',
      '....#######....',
      '....#.#.#.#....',
      '....#######....',
      '....#######....',
      '....#######....',
      '.....#####.....',
    ],
  },
  {
    id: 'crab', name: 'Crab', rows: [
      '.##.........##.',
      '#.##.......##.#',
      '#..#.......#..#',
      '.###.......###.',
      '..#..#...#..#..',
      '..#..#...#..#..',
      '...#########...',
      '..###########..',
      '.#############.',
      '###.#######.###',
      '.#############.',
      '..###########..',
      '.#.#.#...#.#.#.',
      '##.#.#...#.#.##',
      '...............',
    ],
  },
  {
    id: 'anchor', name: 'Anchor', rows: [
      '......###......',
      '.....##.##.....',
      '.....#...#.....',
      '.....##.##.....',
      '......###......',
      '.......#.......',
      '...#########...',
      '...#########...',
      '.......#.......',
      '.......#.......',
      '##.....#.....##',
      '###....#....###',
      '.####..#..####.',
      '..###########..',
      '....#######....',
    ],
  },
  {
    id: 'duck', name: 'Rubber duck', rows: [
      '.....####......',
      '....######.....',
      '...###.###.....',
      '...########....',
      '...##########..',
      '....######.....',
      '.....####......',
      '#...#######....',
      '##.##########..',
      '###############',
      '###############',
      '.#############.',
      '..###########..',
      '....#######....',
      '...............',
    ],
  },
  {
    id: 'sailboat', name: 'Sailboat', rows: [
      '.......#.......',
      '.......##......',
      '......####.....',
      '.....#.####....',
      '....##.#####...',
      '...###.######..',
      '..####.#######.',
      '.#####.########',
      '.......#.......',
      '###############',
      '.#############.',
      '..###########..',
      '...............',
      '.##.##.##.##.##',
      '#.##.##.##.##.#',
    ],
  },
  {
    id: 'mug', name: 'Coffee mug', rows: [
      '...#...#...#...',
      '..#...#...#....',
      '...#...#...#...',
      '...............',
      '.###########...',
      '.###########...',
      '.###########...',
      '.###########.##',
      '.###########..#',
      '.###########..#',
      '.###########.##',
      '.###########...',
      '..#########....',
      '...............',
      '#############..',
    ],
  },
  {
    id: 'terminal', name: 'Terminal', rows: [
      '###############',
      '#.#.#.........#',
      '###############',
      '#.............#',
      '#.#...........#',
      '#.###.........#',
      '#.#####.......#',
      '#.#######.....#',
      '#.#####.......#',
      '#.###.........#',
      '#.#.....#####.#',
      '#.............#',
      '###############',
      '......###......',
      '....#######....',
    ],
  },
];

/** Blobby random pictures, retried until the clues determine them. */
export function generatePuzzle(size = 15, rnd: () => number = Math.random): { grid: Grid; name: string } {
  const name = `Mystery #${1000 + Math.floor(rnd() * 9000)}`;
  for (let attempt = 0; attempt < 400; attempt++) {
    let g: Grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
    const p = 0.5 + rnd() * 0.12;
    const mirror = rnd() < 0.4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        g[y][x] = mirror && x >= size / 2 ? g[y][size - 1 - x] : rnd() < p;
      }
    }
    const passes = 1 + Math.floor(rnd() * 2);
    for (let s = 0; s < passes; s++) g = smooth(g);
    const filled = g.reduce((a, r) => a + r.filter(Boolean).length, 0);
    if (filled < size * size * 0.35 || filled > size * size * 0.75) continue;
    if (isUnique(g)) return { grid: g, name };
  }
  const pic = PICTURES[Math.floor(rnd() * PICTURES.length)];
  return { grid: pictureGrid(pic), name };
}

/** One cellular-automaton pass: a cell is filled when most of its 3×3 neighbourhood is. */
function smooth(g: Grid): Grid {
  return g.map((row, y) => row.map((_, x) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (g[y + dy]?.[x + dx]) n++;
      }
    }
    return n > 4 || (n === 4 && g[y][x]);
  }));
}

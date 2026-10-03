// Lot placement, shared by the server (the real layout) and the client (the arrange preview),
// so both always agree on where a property ends up.
//
// A layout is the result of packing blocks one by one, each at the best free spot left (nearest
// the plaza). So an order of blocks *is* a layout, always compact, and rearranging the island
// means reordering.

import type { Block } from './protocol.ts';

export const SEARCH_RADIUS = 14;

export function overlaps(a: Block, b: Block): boolean {
  return a.gx < b.gx + b.cols && b.gx < a.gx + a.cols && a.gz < b.gz + b.rows && b.gz < a.gz + a.rows;
}

/** Lower is better: close to the plaza, the island a little wider than deep. */
export function spotScore(b: Block): number {
  const cx = b.gx + b.cols / 2 - 0.5;
  const cz = b.gz + b.rows / 2 - 0.5 + 0.5; // plaza sits at z≈-0.5
  return cx * cx + cz * cz * 1.35 + (b.gz > 0 ? 0.01 : 0);
}

/** The best free spot for a block of this size. */
export function findSpot(taken: Block[], cols: number, rows: number): Block {
  let best: Block | null = null;
  let bestScore = Infinity;
  for (let gz = -SEARCH_RADIUS; gz <= SEARCH_RADIUS; gz++) {
    for (let gx = -SEARCH_RADIUS; gx <= SEARCH_RADIUS; gx++) {
      const cand = { gx, gz, cols, rows };
      if (taken.some((t) => overlaps(t, cand))) continue;
      const score = spotScore(cand);
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  return best ?? { gx: SEARCH_RADIUS + 1, gz: 0, cols, rows };
}

/** Packs blocks in order, each at the best spot left. The same order always gives the same layout. */
export function packBlocks(items: PackItem[], reserved: Block[]): Record<string, Block> {
  const out: Record<string, Block> = {};
  const taken = [...reserved];
  for (const it of items) {
    const b = findSpot(taken, it.cols, it.rows);
    out[it.id] = b;
    taken.push(b);
  }
  return out;
}

const sameSpot = (a: Block, b: Block) => a.gx === b.gx && a.gz === b.gz;

export interface PackItem { id: string; cols: number; rows: number }

/** Placeholder ids for empty lots kept in an order (a hole left by a deleted folder). */
export const HOLE = '~hole:';
export const isHole = (id: string) => id.startsWith(HOLE);

/**
 * The order that rebuilds an existing layout: replays the packing, and at each step takes a block
 * that sits exactly where packing would put a block of its size next. Where the layout has a
 * hole, a one-lot placeholder keeps it, so the rebuilt layout matches exactly. Placeholders
 * after the last real block are dropped.
 */
export function orderOf(blocks: Record<string, Block>, reserved: Block[]): PackItem[] {
  const remaining = Object.keys(blocks).sort((a, b) => spotScore(blocks[a]) - spotScore(blocks[b]) || a.localeCompare(b));
  const taken = [...reserved];
  const order: PackItem[] = [];
  let holes = 0;
  while (remaining.length) {
    const best = new Map<string, Block>();
    const spotFor = (b: Block) => {
      const k = `${b.cols}x${b.rows}`;
      if (!best.has(k)) best.set(k, findSpot(taken, b.cols, b.rows));
      return best.get(k)!;
    };
    const i = remaining.findIndex((id) => sameSpot(spotFor(blocks[id]), blocks[id]));
    if (i >= 0) {
      const id = remaining.splice(i, 1)[0];
      order.push({ id, cols: blocks[id].cols, rows: blocks[id].rows });
      taken.push(spotFor(blocks[id]));
      continue;
    }
    // Nobody sits where packing goes next: an empty lot. Keep it as a placeholder.
    const hole = findSpot([...taken, ...remaining.map((id) => blocks[id])], 1, 1);
    if (hole.gx > SEARCH_RADIUS || sameSpot(hole, spotFor(hole)) === false) {
      // (Can't happen for a real layout, but never loop forever: let the nearest block move.)
      const id = remaining.shift()!;
      order.push({ id, cols: blocks[id].cols, rows: blocks[id].rows });
      taken.push(spotFor(blocks[id]));
      continue;
    }
    order.push({ id: `${HOLE}${holes++}`, cols: 1, rows: 1 });
    taken.push(hole);
  }
  while (order.length && isHole(order[order.length - 1].id)) order.pop();
  return order;
}

/** True if no two blocks overlap each other or a reserved block. */
export function validLayout(blocks: Block[], reserved: Block[]): boolean {
  return blocks.every((b, i) => !reserved.some((r) => overlaps(r, b)) && !blocks.slice(i + 1).some((c) => overlaps(b, c)));
}

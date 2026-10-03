import * as THREE from 'three';
import type { WorktreeInfo, WorldState } from '../../../shared/protocol.ts';
import { ModelBuilder } from './builder.ts';
import { colorMat, vertexMat } from './engine.ts';
import { frameOf, frameToWorld, type Occupancy } from './layout.ts';

/** Where pumpkins grow in a lot: between the porch and the farm rows (lot-local x, z). */
const SPOTS: [number, number][] = [
  [-6.8, 1.75], [-5.7, 1.75], [-4.6, 1.75], [-3.5, 1.75],
  [-6.8, 0.75], [-5.7, 0.75], [-4.6, 0.75], [-3.5, 0.75],
];
/** The town hall's porch has a bench and a stump there, so its patch sits a bit further out. */
const HALL_SPOTS: [number, number][] = [
  [-7.0, 2.2], [-6.0, 2.2], [-5.0, 2.2], [-4.0, 2.2],
  [-7.0, 1.4], [-3.4, 1.4], [-3.4, 2.2], [-7.0, 3.0],
];

export interface Pumpkin {
  wt: WorktreeInfo;
  pos: THREE.Vector3;
  root: THREE.Group;
  sparkle?: THREE.Object3D;
}

/** How a worktree looks: big and orange with commits to merge, small and green when there's nothing in it. */
function build(wt: WorktreeInfo, seed: number): THREE.Group {
  const root = new THREE.Group();
  const mb = new ModelBuilder();
  const color = wt.ahead > 0 ? '#f28c28' : wt.dirty > 0 ? '#f2b233' : '#8cc152';
  const r = wt.ahead > 0 ? 0.48 + Math.min(wt.ahead, 20) * 0.012 : wt.dirty > 0 ? 0.38 : 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    mb.sphere(r * 0.62, color, [Math.cos(a) * r * 0.38, r * 0.72, Math.sin(a) * r * 0.38], [0.75, 1, 0.75], 1);
  }
  mb.cyl(0.05, 0.07, 0.26, '#6b8f3a', [0, r * 1.45, 0], [0.2, 0, 0.15], 6);
  mb.sphere(0.16, '#5fb548', [0.14, r * 1.35, 0.05], [1.4, 0.3, 0.9], 0);
  if (!wt.mine) {
    // Wild pumpkins (worktrees made outside the island) trail a curly vine.
    for (let i = 0; i < 7; i++) {
      const a = seed + i * 0.9;
      const d = r + 0.2 + i * 0.12;
      mb.cyl(0.03, 0.03, 0.3, '#4f9a37', [Math.cos(a) * d, 0.05, Math.sin(a) * d], [Math.PI / 2, a, 0], 5);
      if (i % 2) mb.sphere(0.12, '#6cc452', [Math.cos(a) * d, 0.1, Math.sin(a) * d], [1.3, 0.35, 1], 0);
    }
  }
  const m = new THREE.Mesh(mb.build(), vertexMat);
  m.castShadow = true;
  root.add(m);
  root.rotation.y = seed;
  return root;
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Every repo's worktrees, as pumpkins in its farm patch. */
export class PumpkinPatch {
  group = new THREE.Group();
  items: Pumpkin[] = [];
  private starGeo = new THREE.OctahedronGeometry(0.16, 0);

  /** Rebuilds the patch. `busy` holds the worktree paths someone is working in right now. */
  set(world: WorldState, occ: Occupancy, worktrees: WorktreeInfo[], busy: Set<string>) {
    for (const p of this.items) {
      p.root.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g && g !== this.starGeo) g.dispose();
      });
    }
    this.group.clear();
    this.items = [];
    const buildings = new Map(world.properties.flatMap((p) => p.buildings).map((b) => [b.id, b]));
    const perBuilding = new Map<string, WorktreeInfo[]>();
    for (const wt of worktrees) {
      if (!buildings.has(wt.buildingId)) continue;
      const arr = perBuilding.get(wt.buildingId) ?? [];
      arr.push(wt);
      perBuilding.set(wt.buildingId, arr);
    }
    for (const [id, list] of perBuilding) {
      const b = buildings.get(id)!;
      const f = frameOf(occ, world, b);
      const spots = b.role === 'main' ? HALL_SPOTS : SPOTS;
      list.sort((a, c) => a.path.localeCompare(c.path));
      list.slice(0, spots.length).forEach((wt, i) => {
        const seed = hashStr(wt.path);
        const pos = frameToWorld(f, spots[i][0], spots[i][1]);
        const root = build(wt, seed % 7);
        root.position.copy(pos);
        const item: Pumpkin = { wt, pos, root };
        if (busy.has(wt.path)) {
          const star = new THREE.Mesh(this.starGeo, colorMat('#ffe066', { emissive: 0.9 }));
          star.position.y = 1.35;
          root.add(star);
          item.sparkle = star;
        }
        this.group.add(root);
        this.items.push(item);
      });
    }
  }

  update(t: number) {
    for (const p of this.items) {
      if (!p.sparkle) continue;
      p.sparkle.rotation.y = t * 2.4;
      p.sparkle.position.y = 1.35 + Math.sin(t * 3 + p.pos.x) * 0.12;
    }
  }

  /** The pumpkin within reach of `pos`, if any. */
  nearest(pos: THREE.Vector3, reach = 1.5): Pumpkin | undefined {
    let best: Pumpkin | undefined;
    let bestD = reach;
    for (const p of this.items) {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
}

import * as THREE from 'three';
import { ModelBuilder } from './builder.ts';
import { shade } from './houses.ts';

type V3 = [number, number, number];
export type FenceStyle = 'picket' | 'rail' | 'stone' | 'hedge' | 'bamboo';

const WOOD = '#b98553';
const WOOD_DARK = '#8a5a35';
const FLOWERS = ['#ff7eb6', '#ffd94a', '#ffffff', '#ff6b6b', '#a78bfa', '#ff9f43', '#7ec4ff'];

/** A fence run from (x0,z0) to (x1,z1) in lot-local space. */
export function fenceRun(mb: ModelBuilder, style: FenceStyle, x0: number, z0: number, x1: number, z1: number, seed: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const rotY = alongX ? 0 : Math.PI / 2;
  const posts = Math.max(2, Math.round(len / 1.4) + 1);
  const at = (t: number): [number, number] => [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  switch (style) {
    case 'picket': {
      const n = Math.max(2, Math.round(len / 0.45));
      for (let i = 0; i <= n; i++) {
        const [x, z] = at(i / n);
        mb.box(0.14, 0.85, 0.08, '#fbf7ef', [x, 0.43, z], [0, rotY, 0]);
        mb.cone(0.1, 0.16, '#fbf7ef', [x, 0.93, z], [0, rotY + Math.PI / 4, 0], 4);
      }
      for (const y of [0.3, 0.65]) mb.box(len, 0.08, 0.06, '#f1ebdf', [cx, y, cz], [0, rotY, 0]);
      break;
    }
    case 'rail':
      for (let i = 0; i < posts; i++) {
        const [x, z] = at(i / (posts - 1));
        mb.cyl(0.09, 0.1, 1.0, WOOD_DARK, [x, 0.5, z], undefined, 6);
      }
      for (const y of [0.4, 0.78]) mb.add(new THREE.CylinderGeometry(0.06, 0.06, len, 6), WOOD, [cx, y, cz], [0, rotY, Math.PI / 2]);
      break;
    case 'stone': {
      const n = Math.max(2, Math.round(len / 0.5));
      for (let i = 0; i < n; i++) {
        const [x, z] = at((i + 0.5) / n);
        const c = ['#cfc6b8', '#bfb5a6', '#d9d1c4'][(i + seed) % 3];
        mb.sphere(0.34, c, [x, 0.22, z], [1.1, 0.75, 0.9], 0);
        if (i % 2 === 0) mb.sphere(0.26, shade(c, 1.05), [x + 0.1, 0.55, z], [1, 0.7, 0.9], 0);
      }
      break;
    }
    case 'bamboo': {
      const n = Math.max(2, Math.round(len / 0.22));
      for (let i = 0; i <= n; i++) {
        const [x, z] = at(i / n);
        const h = 0.9 + ((i * 7 + seed) % 3) * 0.12;
        mb.cyl(0.08, 0.08, h, i % 2 ? '#c9b26a' : '#b8a15a', [x, h / 2, z], undefined, 6);
      }
      mb.box(len, 0.05, 0.05, '#8a7a45', [cx, 0.55, cz], [0, rotY, 0]);
      break;
    }
    default: {
      // Hedge with flowers peeking out.
      mb.with({ sway: 0.25 }, () => {
        mb.box(alongX ? len : 0.75, 0.78, alongX ? 0.75 : len, '#5fb548', [cx, 0.39, cz]);
        const n = Math.max(1, Math.round(len / 1.2));
        for (let i = 0; i < n; i++) {
          const [x, z] = at((i + 0.5) / n);
          mb.sphere(0.45, i % 2 ? '#6cc452' : '#58ad43', [x, 0.72, z], [1.1, 0.6, 1.1], 1);
          if ((i + seed) % 3 === 0) mb.sphere(0.1, FLOWERS[(i + seed) % FLOWERS.length], [x + 0.15, 1.0, z + 0.1], 1, 0);
        }
      });
    }
  }
}

// --- yard decorations (lot-local, origin on the ground) --------------------------------

export type Decor = 'doghouse' | 'beehive' | 'laundry' | 'well' | 'gnome' | 'swing' | 'scarecrow' | 'wheelbarrow' | 'birdbath' | 'barrels' | 'hay' | 'dish' | 'telescope' | 'pumpkins';
export const DECOR: Decor[] = ['doghouse', 'beehive', 'laundry', 'well', 'gnome', 'swing', 'scarecrow', 'wheelbarrow', 'birdbath', 'barrels', 'hay', 'dish', 'telescope', 'pumpkins'];

/** Adds a small decoration centred at (x, z). Returns its collision half-size. */
export function decor(mb: ModelBuilder, kind: Decor, x: number, z: number, seed: number): number {
  const at = (dx: number, y: number, dz: number): V3 => [x + dx, y, z + dz];
  switch (kind) {
    case 'doghouse': {
      const c = ['#e0645c', '#5b8fd9', '#58b368'][seed % 3];
      mb.box(1.2, 0.9, 1.1, '#f3e3c3', at(0, 0.45, 0));
      mb.gable(1.2, 1.1, 0.6, c, '#f3e3c3', 0.9, 0.15, x, z);
      mb.box(0.5, 0.6, 0.06, '#4a3a2c', at(0, 0.35, 0.56));
      mb.cyl(0.16, 0.14, 0.08, '#9aa5ad', at(0.7, 0.04, 0.6), undefined, 10);
      return 0.7;
    }
    case 'beehive':
      mb.box(0.1, 0.5, 0.1, WOOD_DARK, at(0, 0.25, 0));
      for (let i = 0; i < 3; i++) mb.cyl(0.42 - i * 0.07, 0.45 - i * 0.07, 0.3, '#f2c94c', at(0, 0.62 + i * 0.28, 0), undefined, 14);
      mb.box(0.12, 0.08, 0.06, '#4a3a2c', at(0, 0.6, 0.42));
      return 0.5;
    case 'laundry': {
      for (const dx of [-1.2, 1.2]) mb.cyl(0.05, 0.06, 1.8, WOOD_DARK, at(dx, 0.9, 0), undefined, 6);
      mb.box(2.4, 0.02, 0.02, '#ffffff', at(0, 1.7, 0));
      const cloths = ['#ff8fab', '#7ec4ff', '#ffd166', '#95e1a4'];
      mb.with({ sway: 1.5 }, () => {
        for (let i = 0; i < 4; i++) mb.box(0.36, 0.5 - (i % 2) * 0.12, 0.03, cloths[(i + seed) % 4], at(-0.9 + i * 0.6, 1.45, 0));
      });
      return 1.3;
    }
    case 'well':
      mb.cyl(0.7, 0.75, 0.7, '#cfc6b8', at(0, 0.35, 0), undefined, 14);
      mb.cyl(0.55, 0.55, 0.05, '#4fa3c7', at(0, 0.62, 0), undefined, 14);
      for (const dx of [-0.6, 0.6]) mb.box(0.1, 1.4, 0.1, WOOD_DARK, at(dx, 1.0, 0));
      mb.gable(1.6, 1.1, 0.5, '#a0714f', WOOD, 1.65, 0.2, x, z);
      return 0.8;
    case 'gnome':
      // A garden gnome statue: the island's little joke about subagents.
      mb.cyl(0.18, 0.22, 0.3, '#5a7bbf', at(0, 0.15, 0), undefined, 10);
      mb.sphere(0.15, '#f7c9a5', at(0, 0.42, 0), 1, 1);
      mb.sphere(0.12, '#ffffff', at(0, 0.34, 0.08), [1, 0.9, 0.7], 1);
      mb.cone(0.17, 0.36, '#e04848', at(0, 0.66, 0), undefined, 10);
      return 0.3;
    case 'swing':
      mb.cyl(0.18, 0.24, 2.0, WOOD_DARK, at(-0.9, 1.0, 0), undefined, 7);
      mb.with({ sway: 1 }, () => {
        mb.sphere(1.1, '#5fb548', at(-0.9, 2.5, 0), [1.2, 0.9, 1.1], 1, 0.08);
        mb.sphere(0.8, '#6cc452', at(-0.3, 2.7, 0.3), 1, 1, 0.08);
      });
      mb.box(1.5, 0.12, 0.12, WOOD_DARK, at(-0.2, 2.0, 0));
      for (const dx of [0.1, 0.55]) mb.box(0.02, 1.2, 0.02, '#d9c8a0', at(dx, 1.4, 0));
      mb.box(0.6, 0.06, 0.3, '#e0645c', at(0.33, 0.8, 0));
      return 0.5;
    case 'scarecrow':
      mb.box(0.08, 1.6, 0.08, WOOD_DARK, at(0, 0.8, 0));
      mb.box(1.2, 0.08, 0.08, WOOD_DARK, at(0, 1.25, 0));
      mb.box(0.5, 0.55, 0.3, '#7aa6d8', at(0, 1.15, 0));
      mb.sphere(0.24, '#f2d27a', at(0, 1.62, 0), 1, 1);
      mb.cyl(0.36, 0.36, 0.04, '#c8a860', at(0, 1.8, 0), undefined, 12);
      mb.cyl(0.18, 0.22, 0.18, '#c8a860', at(0, 1.9, 0), undefined, 10);
      return 0.3;
    case 'wheelbarrow':
      mb.box(0.9, 0.3, 0.6, '#d9534f', at(0, 0.45, 0), [0, 0, 0.12]);
      mb.cyl(0.2, 0.2, 0.08, '#4a3a2c', at(0.5, 0.2, 0), [Math.PI / 2, 0, 0], 12);
      for (const dz of [-0.2, 0.2]) mb.box(0.8, 0.05, 0.05, WOOD_DARK, at(-0.6, 0.45, dz), [0, 0, 0.3]);
      for (let i = 0; i < 3; i++) mb.sphere(0.16, '#f28c28', at(-0.15 + i * 0.16, 0.66, (i % 2) * 0.12 - 0.06), [1.1, 0.85, 1.1], 1);
      return 0.6;
    case 'birdbath':
      mb.cyl(0.12, 0.2, 0.8, '#e6dfd2', at(0, 0.4, 0), undefined, 10);
      mb.cyl(0.5, 0.3, 0.16, '#e6dfd2', at(0, 0.86, 0), undefined, 14);
      mb.cyl(0.42, 0.42, 0.03, '#8fe3f0', at(0, 0.93, 0), undefined, 14);
      mb.sphere(0.1, '#7ec4ff', at(0.2, 1.02, 0), [1.2, 0.9, 0.9], 1);
      return 0.45;
    case 'barrels':
      for (const [dx, dz] of [[0, 0], [0.62, 0.1], [0.3, -0.5]] as const) {
        mb.cyl(0.3, 0.3, 0.75, '#a0714f', at(dx, 0.37, dz), undefined, 12);
        for (const y of [0.15, 0.6]) mb.cyl(0.31, 0.31, 0.05, '#6b6b6b', at(dx, y, dz), undefined, 12);
      }
      return 0.7;
    case 'hay':
      for (const [dx, dy, dz] of [[0, 0.35, 0], [0.9, 0.35, 0.1], [0.45, 1.0, 0.05]] as const) {
        mb.box(0.85, 0.65, 0.65, '#e8c86a', at(dx, dy, dz));
        mb.box(0.87, 0.04, 0.67, '#c9a74a', at(dx, dy + 0.15, dz));
      }
      return 0.9;
    case 'dish':
      mb.box(0.12, 1.0, 0.12, '#9aa5ad', at(0, 0.5, 0));
      mb.add(new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), '#f1f1f1', at(0, 1.2, 0), [-0.9, 0.4, 0]);
      mb.cyl(0.02, 0.02, 0.6, '#9aa5ad', at(0, 1.45, 0.2), [-0.9, 0, 0], 4);
      return 0.5;
    case 'telescope':
      for (const a of [0, 2.1, 4.2]) mb.box(0.05, 1.0, 0.05, WOOD_DARK, at(Math.cos(a) * 0.25, 0.48, Math.sin(a) * 0.25), [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]);
      mb.cyl(0.1, 0.14, 1.0, '#3d6fb6', at(0, 1.15, 0), [0.9, 0.4, 0], 10);
      return 0.4;
    case 'pumpkins':
      for (let i = 0; i < 4; i++) {
        mb.sphere(0.3 - (i % 2) * 0.08, '#f28c28', at((i % 2) * 0.6 - 0.3, 0.25, Math.floor(i / 2) * 0.55 - 0.25), [1.2, 0.8, 1.2], 1);
        mb.cyl(0.03, 0.03, 0.12, '#5a7a2c', at((i % 2) * 0.6 - 0.3, 0.5, Math.floor(i / 2) * 0.55 - 0.25), undefined, 4);
      }
      return 0.7;
  }
}

// --- landmarks for the wild parts of the island -------------------------------------

export type Landmark = 'pond' | 'windmill' | 'campsite' | 'flowerfield' | 'bigtree' | 'orchard' | 'picnic' | 'ruins';

export function landmark(mb: ModelBuilder, kind: Landmark, x: number, z: number, seed: number): { r: number; colliders: [number, number, number][] } {
  const at = (dx: number, y: number, dz: number): V3 => [x + dx, y, z + dz];
  const col: [number, number, number][] = [];
  switch (kind) {
    case 'pond': {
      // The water itself is a separate mesh; here: stones, reeds and lily pads.
      const R = 5.2;
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2 + Math.sin(i * 3.7) * 0.1;
        const rr = R + 0.3 + Math.sin(i * 5.1) * 0.25;
        if (i % 3 === 0) mb.sphere(0.35 + (i % 4) * 0.08, i % 2 ? '#bdb2a2' : '#cfc4b5', at(Math.cos(a) * rr, 0.05, Math.sin(a) * rr * 0.8), [1.2, 0.6, 1], 0);
        else if (i % 3 === 1) mb.with({ sway: 1.4 }, () => {
          for (let k = 0; k < 3; k++) mb.cyl(0.03, 0.04, 1.1 + k * 0.2, '#6a9a3c', at(Math.cos(a) * (rr - 0.4) + k * 0.12, 0.4, Math.sin(a) * (rr - 0.4) * 0.8), [0, 0, (k - 1) * 0.12], 4);
          mb.cyl(0.07, 0.07, 0.3, '#7a5230', at(Math.cos(a) * (rr - 0.4), 1.2, Math.sin(a) * (rr - 0.4) * 0.8), undefined, 6);
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = i * 1.9 + seed;
        const rr = 1.2 + (i % 3) * 1.1;
        mb.cyl(0.42, 0.42, 0.03, '#5fae4a', at(Math.cos(a) * rr, -0.18, Math.sin(a) * rr * 0.8), undefined, 10);
        if (i % 2 === 0) mb.sphere(0.12, '#ffb3d1', at(Math.cos(a) * rr + 0.1, -0.08, Math.sin(a) * rr * 0.8), [1, 0.6, 1], 1);
      }
      return { r: R + 0.8, colliders: [] };
    }
    case 'windmill': {
      mb.cyl(1.5, 2.0, 5.5, '#f3ead9', at(0, 2.75, 0), undefined, 10);
      mb.add(new THREE.ConeGeometry(1.9, 2.0, 10), '#b35a4a', at(0, 6.5, 0));
      mb.box(0.9, 1.5, 0.1, '#8b5a3c', at(0, 0.75, 1.9));
      mb.with({ glow: 1 }, () => mb.sphere(0.35, '#bfe6ff', at(0, 3.6, 1.62), [1, 1, 0.3], 1));
      col.push([x, z, 2.0]);
      return { r: 2.4, colliders: col }; // the sails are a separate spinning mesh
    }
    case 'campsite': {
      const tent = ['#f28c28', '#5b8fd9', '#58b368'][seed % 3];
      const tentGeo = new THREE.ConeGeometry(1.6, 2.0, 4);
      tentGeo.rotateY(Math.PI / 4);
      mb.add(tentGeo, tent, at(-1.6, 1.0, -0.6), [0, 0.2, 0], [1.1, 1, 1]);
      mb.box(0.7, 1.1, 0.05, shade(tent, 0.6), at(-1.3, 0.55, 0.45), [0, 0.2, 0]);
      // Campfire (flames are ambient particles).
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        mb.sphere(0.2, '#9a9087', at(1.1 + Math.cos(a) * 0.6, 0.1, 0.4 + Math.sin(a) * 0.6), [1, 0.6, 1], 0);
      }
      for (const a of [0.3, 1.9, 3.5]) mb.cyl(0.07, 0.07, 0.9, '#7a4b2e', at(1.1, 0.12, 0.4), [Math.PI / 2 - 0.1, a, 0], 6);
      mb.with({ glow: 1 }, () => mb.sphere(0.22, '#ffb347', at(1.1, 0.3, 0.4), [1, 1.3, 1], 1));
      for (const [dx, dz] of [[2.4, 1.2], [0.1, 1.9]] as const) mb.cyl(0.35, 0.4, 0.4, '#9a6b43', at(dx, 0.2, dz), undefined, 10);
      col.push([x - 1.6, z - 0.6, 1.4]);
      return { r: 3.2, colliders: col };
    }
    case 'flowerfield': {
      const palette = [FLOWERS[seed % FLOWERS.length], FLOWERS[(seed + 2) % FLOWERS.length], '#ffffff'];
      mb.with({ sway: 0.8 }, () => {
        for (let i = 0; i < 90; i++) {
          const a = i * 2.399;
          const rr = Math.sqrt(i / 90) * 4.6;
          const fx = Math.cos(a) * rr, fz = Math.sin(a) * rr * 0.8;
          mb.cyl(0.02, 0.02, 0.5, '#4fa83a', at(fx, 0.25, fz), undefined, 3);
          mb.sphere(0.13, palette[i % 3], at(fx, 0.52, fz), [1, 0.6, 1], 0);
        }
      });
      return { r: 4.8, colliders: [] };
    }
    case 'bigtree': {
      mb.cyl(0.55, 0.9, 4.2, '#7a4f30', at(0, 2.1, 0), undefined, 9);
      for (const a of [0.4, 2.3, 4.1]) mb.cyl(0.18, 0.32, 1.6, '#7a4f30', at(Math.cos(a) * 0.7, 0.3, Math.sin(a) * 0.7), [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], 6);
      const pink = seed % 2 === 0;
      mb.with({ sway: 0.6 }, () => {
        const leaf = pink ? ['#ffb7d5', '#ffc8df', '#f7a6c8'] : ['#4fa83a', '#5fb548', '#6cc452'];
        mb.sphere(2.6, leaf[0], at(0, 5.4, 0), [1.2, 0.85, 1.1], 1, 0.06);
        mb.sphere(1.8, leaf[1], at(1.8, 5.8, 0.4), 1, 1, 0.06);
        mb.sphere(1.9, leaf[2], at(-1.7, 5.6, -0.3), 1, 1, 0.06);
        mb.sphere(1.6, leaf[1], at(0.2, 6.8, -0.6), 1, 1, 0.06);
      });
      mb.box(1.8, 0.1, 0.5, WOOD, at(0, 0.5, 1.6));
      for (const dx of [-0.7, 0.7]) mb.box(0.1, 0.5, 0.4, WOOD_DARK, at(dx, 0.25, 1.6));
      col.push([x, z, 1.0]);
      return { r: 3.4, colliders: col };
    }
    case 'orchard': {
      const fruit = ['#e8423b', '#f28c28', '#ffd94a', '#b0d146'][seed % 4];
      for (let i = 0; i < 6; i++) {
        const tx = (i % 3) * 2.8 - 2.8, tz = Math.floor(i / 3) * 2.8 - 1.4;
        mb.cyl(0.14, 0.2, 1.3, '#8a5a35', at(tx, 0.65, tz), undefined, 7);
        mb.with({ sway: 1 }, () => {
          mb.sphere(0.95, '#5fb548', at(tx, 1.85, tz), [1, 0.9, 1], 1, 0.08);
          mb.sphere(0.6, '#6cc452', at(tx + 0.4, 2.2, tz + 0.2), 1, 1, 0.08);
          for (let k = 0; k < 5; k++) mb.sphere(0.13, fruit, at(tx + Math.cos(k * 1.3) * 0.8, 1.7 + Math.sin(k * 2.1) * 0.35, tz + Math.sin(k * 1.3) * 0.8), 1, 0);
        });
        col.push([x + tx, z + tz, 0.4]);
      }
      return { r: 4.6, colliders: col };
    }
    case 'picnic': {
      mb.box(3.0, 0.03, 2.2, '#e0645c', at(0, 0.02, 0));
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) mb.box(0.5, 0.035, 0.55, '#ffffff', at(-1.25 + i * 0.5, 0.02, -0.82 + j * 0.55));
      mb.box(0.7, 0.4, 0.45, '#c89b6d', at(0.5, 0.2, 0.2));
      mb.cyl(0.25, 0.25, 0.05, '#ffffff', at(-0.6, 0.06, -0.3), undefined, 12);
      mb.sphere(0.15, '#e8423b', at(-0.6, 0.14, -0.3), 1, 1);
      mb.cyl(0.05, 0.05, 2.2, '#dddddd', at(1.8, 1.1, -1.0), undefined, 6);
      mb.add(new THREE.ConeGeometry(1.6, 0.6, 10), '#ffd94a', at(1.8, 2.2, -1.0));
      return { r: 2.4, colliders: [] };
    }
    case 'ruins': {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const h = 1.2 + ((i * 3 + seed) % 4) * 0.6;
        mb.cyl(0.35, 0.4, h, '#e6dfd2', at(Math.cos(a) * 2.2, h / 2, Math.sin(a) * 2.2), undefined, 10);
        col.push([x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2, 0.45]);
      }
      mb.with({ sway: 0.5 }, () => {
        for (let i = 0; i < 12; i++) mb.sphere(0.25, '#6cbf4e', at(Math.cos(i) * 1.5, 0.1, Math.sin(i * 1.7) * 1.5), [1, 0.5, 1], 0);
      });
      return { r: 3, colliders: col };
    }
  }
}

/** A wooden pier heading out to sea, with a little boat. `dir` is the (x,z) direction out to sea. */
export function pier(mb: ModelBuilder, x: number, z: number, len: number) {
  for (let i = 0; i < Math.floor(len / 0.5); i++) {
    mb.box(2.4, 0.12, 0.44, i % 2 ? '#b98553' : '#c49262', [x, 0.25, z + i * 0.5]);
  }
  for (let i = 0; i <= Math.floor(len / 2.5); i++) {
    for (const dx of [-1.15, 1.15]) mb.cyl(0.12, 0.12, 1.6, '#7a4f30', [x + dx, -0.4, z + i * 2.5], undefined, 6);
  }
  mb.cyl(0.14, 0.14, 1.2, '#7a4f30', [x + 1.1, 0.8, z + len - 0.3], undefined, 6);
  mb.with({ glow: 1 }, () => mb.box(0.3, 0.3, 0.3, '#fff4c2', [x + 1.1, 1.5, z + len - 0.3]));
  // Boat.
  const bx = x - 2.6, bz = z + len - 2;
  mb.box(1.3, 0.45, 3.0, '#ffffff', [bx, -0.05, bz]);
  mb.box(1.1, 0.12, 2.8, '#5b8fd9', [bx, 0.14, bz]);
  mb.cone(0.65, 0.9, '#ffffff', [bx, -0.05, bz + 1.9], [Math.PI / 2, 0, 0], 4);
  mb.cyl(0.05, 0.05, 2.2, '#8a5a35', [bx, 1.2, bz - 0.2], undefined, 6);
  mb.with({ sway: 1.2 }, () => mb.add(new THREE.ConeGeometry(0.8, 1.8, 3), '#fff6e0', [bx + 0.05, 1.3, bz + 0.2], [0, Math.PI / 2, 0], [0.12, 1, 1]));
}

export function lighthouse(mb: ModelBuilder, x: number, z: number) {
  for (let i = 0; i < 6; i++) mb.cyl(1.3 - i * 0.12, 1.35 - i * 0.12, 1.2, i % 2 ? '#e0453e' : '#ffffff', [x, 0.6 + i * 1.2, z], undefined, 16);
  mb.cyl(1.0, 1.0, 0.2, '#4a5560', [x, 7.3, z], undefined, 16);
  mb.with({ glow: 1 }, () => mb.cyl(0.6, 0.6, 1.0, '#fff4c2', [x, 7.9, z], undefined, 12));
  mb.add(new THREE.ConeGeometry(0.9, 0.9, 16), '#e0453e', [x, 8.85, z]);
  mb.box(0.8, 1.3, 0.1, '#5b3a1e', [x, 0.65, z + 1.3]);
}

export function beachUmbrella(mb: ModelBuilder, x: number, z: number, seed: number) {
  const c = ['#ff7eb6', '#7ec4ff', '#ffd166', '#95e1a4'][seed % 4];
  mb.cyl(0.05, 0.05, 2.2, '#ffffff', [x, 1.1, z], [0.12, 0, 0.08], 6);
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.ConeGeometry(1.4, 0.55, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4);
    mb.add(seg, i % 2 ? c : '#ffffff', [x + 0.15, 2.2, z + 0.1]);
  }
  mb.box(0.9, 0.03, 1.8, i2c(seed), [x + 1.0, 0.03, z + 0.4], [0, 0.3, 0]);
}

function i2c(seed: number) {
  return ['#ff9f43', '#a78bfa', '#6ee7d8', '#ff6b6b'][seed % 4];
}

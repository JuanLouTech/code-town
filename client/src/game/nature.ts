import * as THREE from 'three';
import { ModelBuilder } from './builder.ts';
import { vertexMat } from './engine.ts';
import { PITCH, cellOf, nearReserved, type IslandShape, type Occupancy } from './layout.ts';
import { smallTree, type Collider } from './buildings.ts';

function rand(x: number, z: number, k: number) {
  const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const FLOWERS = ['#ff7eb6', '#ffd94a', '#ffffff', '#ff6b6b', '#a78bfa', '#ff9f43', '#7ec4ff'];

function pine(mb: ModelBuilder, x: number, z: number, s: number) {
  mb.cyl(0.14 * s, 0.2 * s, 1.2 * s, '#7a4f30', [x, 0.6 * s, z], undefined, 6);
  mb.with({ sway: 0.7 }, () => {
    mb.cone(1.25 * s, 1.7 * s, '#3f9a4f', [x, 1.7 * s, z], undefined, 8);
    mb.cone(1.0 * s, 1.5 * s, '#48a957', [x, 2.6 * s, z], undefined, 8);
    mb.cone(0.7 * s, 1.3 * s, '#57bb63', [x, 3.4 * s, z], undefined, 8);
  });
}

function cedar(mb: ModelBuilder, x: number, z: number, s: number) {
  mb.cyl(0.12 * s, 0.16 * s, 1.0 * s, '#6f4529', [x, 0.5 * s, z], undefined, 6);
  mb.with({ sway: 0.8 }, () => mb.add(new THREE.CapsuleGeometry(0.75 * s, 2.6 * s, 4, 8), '#3f8a5a', [x, 2.6 * s, z]));
}

function blossom(mb: ModelBuilder, x: number, z: number, s: number, autumn: boolean) {
  const leaf = autumn ? ['#f29e4c', '#e8743b', '#f2c14e'] : ['#ffb7d5', '#ffc8df', '#f7a6c8'];
  mb.cyl(0.15 * s, 0.22 * s, 1.5 * s, '#6f4529', [x, 0.75 * s, z], undefined, 7);
  mb.with({ sway: 1 }, () => {
    mb.sphere(1.0 * s, leaf[0], [x, 2.0 * s, z], [1.15, 0.85, 1.05], 1, 0.06);
    mb.sphere(0.72 * s, leaf[1], [x + 0.55 * s, 2.35 * s, z + 0.2 * s], 1, 1, 0.06);
    mb.sphere(0.7 * s, leaf[2], [x - 0.5 * s, 2.3 * s, z - 0.15 * s], 1, 1, 0.06);
  });
  for (let i = 0; i < 5; i++) mb.sphere(0.12, leaf[i % 3], [x + Math.cos(i * 1.7) * 1.1 * s, 0.03, z + Math.sin(i * 1.7) * 1.1 * s], [1, 0.25, 1], 0);
}

function mushrooms(mb: ModelBuilder, x: number, z: number, seed: number) {
  const cap = ['#e0453e', '#f2a516', '#b07cd1'][seed % 3];
  for (let i = 0; i < 3; i++) {
    const mx = x + (i - 1) * 0.28, mz = z + (i % 2) * 0.2;
    const h = 0.2 + (i % 2) * 0.12;
    mb.cyl(0.05, 0.06, h, '#fff6e3', [mx, h / 2, mz], undefined, 6);
    mb.add(new THREE.SphereGeometry(0.16 + (i % 2) * 0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap, [mx, h, mz]);
    mb.sphere(0.03, '#ffffff', [mx + 0.06, h + 0.1, mz + 0.03], 1, 0);
  }
}

function palm(mb: ModelBuilder, x: number, z: number, s: number, lean: number) {
  let px = x, py = 0, pz = z;
  const dir = lean;
  for (let i = 0; i < 6; i++) {
    const h = 0.75 * s;
    const tilt = 0.08 + i * 0.05;
    // Rz(tilt) leans the segment towards -x, Ry(dir) turns that lean around.
    const dx = -Math.sin(tilt) * h * Math.cos(dir);
    const dz = Math.sin(tilt) * h * Math.sin(dir);
    const dy = Math.cos(tilt) * h;
    mb.cyl(0.17 * s, 0.22 * s, h, i % 2 ? '#b08a5a' : '#c49c68', [px + dx / 2, py + dy / 2, pz + dz / 2], [0, dir, tilt], 7);
    px += dx;
    pz += dz;
    py += dy;
  }
  mb.sway = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    // Flattened cone pointing outwards (Ry(π - a) maps -x onto the frond direction) and drooping a little.
    mb.add(new THREE.ConeGeometry(0.35 * s, 2.2 * s, 4), i % 2 ? '#4caf50' : '#5cbf5a',
      [px + Math.cos(a) * 0.9 * s, py - 0.15 * s, pz + Math.sin(a) * 0.9 * s], [0, Math.PI - a, Math.PI / 2 + 0.35], [0.25, 1, 1]);
  }
  for (let i = 0; i < 3; i++) mb.sphere(0.16 * s, '#7a5230', [px + Math.cos(i * 2.1) * 0.25, py - 0.25 * s, pz + Math.sin(i * 2.1) * 0.25], 1, 0);
  mb.sway = 0;
}

function bush(mb: ModelBuilder, x: number, z: number, s: number, flower?: string) {
  mb.sway = 0.4;
  mb.sphere(0.6 * s, '#5aa845', [x, 0.45 * s, z], [1.2, 0.85, 1], 1, 0.1);
  mb.sphere(0.45 * s, '#66b851', [x + 0.5 * s, 0.4 * s, z + 0.1], 1, 1, 0.1);
  mb.sphere(0.42 * s, '#4f9c3d', [x - 0.45 * s, 0.35 * s, z - 0.05], 1, 1, 0.1);
  if (flower) for (let i = 0; i < 6; i++) mb.sphere(0.09, flower, [x + Math.cos(i) * 0.55 * s, 0.7 * s + Math.sin(i * 3) * 0.12, z + Math.sin(i) * 0.4 * s + 0.2], 1, 0);
  mb.sway = 0;
}

function flowers(mb: ModelBuilder, x: number, z: number, seed: number) {
  mb.sway = 0.9;
  const n = 3 + Math.floor(seed * 4);
  for (let i = 0; i < n; i++) {
    const fx = x + Math.cos(i * 2.4) * 0.5 * (i / n + 0.3);
    const fz = z + Math.sin(i * 2.4) * 0.5 * (i / n + 0.3);
    mb.cyl(0.018, 0.018, 0.32, '#4fa83a', [fx, 0.16, fz], undefined, 3);
    const c = FLOWERS[(Math.floor(seed * 100) + (i % 2)) % FLOWERS.length];
    for (let p = 0; p < 5; p++) mb.sphere(0.07, c, [fx + Math.cos(p * 1.26) * 0.08, 0.34, fz + Math.sin(p * 1.26) * 0.08], [1, 0.5, 1], 0);
    mb.sphere(0.05, '#ffd94a', [fx, 0.36, fz], 1, 0);
  }
  mb.sway = 0;
}

function tuft(mb: ModelBuilder, x: number, z: number) {
  mb.with({ sway: 1.4 }, () => {
    for (let i = 0; i < 4; i++) mb.cone(0.07, 0.38 + (i % 2) * 0.12, i % 2 ? '#6cbf4e' : '#7fd05c', [x + (i - 1.5) * 0.09, 0.19, z + (i % 2) * 0.06], [0, 0, (i - 1.5) * 0.3], 3);
  });
}

/** Scatters vegetation on the wild parts of the island (away from lots, roads and the plaza). */
export interface NatureInfo {
  group: THREE.Group;
  colliders: Collider[];
  flowers: THREE.Vector3[];
  fruitTrees: { pos: THREE.Vector3; fruit: string }[];
}

export function buildNature(occ: Occupancy, shape: IslandShape, clear: { x: number; z: number; r: number }[] = []): NatureInfo {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const flowerSpots: THREE.Vector3[] = [];
  const fruitTrees: NatureInfo['fruitTrees'] = [];
  const cleared = (x: number, z: number) => clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
  const { bounds, sdf } = shape;
  const chunk = 48;
  const builders = new Map<string, ModelBuilder>();
  const mbAt = (x: number, z: number) => {
    const key = `${Math.floor(x / chunk)},${Math.floor(z / chunk)}`;
    let mb = builders.get(key);
    if (!mb) builders.set(key, (mb = new ModelBuilder()));
    return mb;
  };
  // Distance-ish test against lots, the plaza and the fair: nothing on roads, only low plants close
  // to them (tall trees next to a road would hide the player from the camera).
  const near = (x: number, z: number, margin: number) => {
    if (nearReserved(occ, x, z, margin)) return true;
    const c = cellOf(x, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!occ.lots.has(`${c.gx + dx},${c.gz + dz}`)) continue;
        const cx = (c.gx + dx) * PITCH, cz = (c.gz + dz) * PITCH;
        if (Math.abs(x - cx) < PITCH / 2 + margin && Math.abs(z - cz) < PITCH / 2 + margin) return true;
      }
    }
    return false;
  };

  const step = 3.4;
  for (let gz = bounds.minZ; gz < bounds.maxZ; gz += step) {
    for (let gx = bounds.minX; gx < bounds.maxX; gx += step) {
      const x = gx + (rand(gx, gz, 1) - 0.5) * 2.4;
      const z = gz + (rand(gx, gz, 2) - 0.5) * 2.4;
      const s = sdf(x, z);
      if (s > -1.8 || cleared(x, z)) continue;
      const r = rand(gx, gz, 3);
      const size = 0.85 + rand(gx, gz, 4) * 0.45;
      if (s > -7) {
        if (r < 0.07 && s < -3) {
          palm(mbAt(x, z), x, z, size, rand(gx, gz, 5) * Math.PI * 2);
          colliders.push({ x, z, hw: 0.35, hd: 0.35 });
        } else if (r < 0.1) {
          mbAt(x, z).sphere(0.2, '#fff0e6', [x, 0.05, z], [1, 0.4, 1], 0);
        }
        continue;
      }
      if (near(x, z, 1.5)) continue;
      const mb = mbAt(x, z);
      const open = near(x, z, 8);
      if (open) {
        if (r < 0.3) {
          flowers(mb, x, z, rand(gx, gz, 6));
          flowerSpots.push(new THREE.Vector3(x, 0, z));
        } else if (r < 0.6) tuft(mb, x, z);
        else if (r < 0.63) mushrooms(mb, x, z, Math.floor(r * 100));
        continue;
      }
      const v = rand(gx, gz, 7);
      if (r < 0.26) {
        if (v < 0.16) {
          blossom(mb, x, z, size * 1.1, v < 0.07);
        } else {
          const fruit = r < 0.07 ? ['#e8423b', '#f28c28', '#ffd94a'][Math.floor(r * 60) % 3] : undefined;
          smallTree(mb, x, z, size * 1.15, fruit);
          if (fruit) fruitTrees.push({ pos: new THREE.Vector3(x, 0, z), fruit });
        }
        colliders.push({ x, z, hw: 0.4, hd: 0.4 });
      } else if (r < 0.4) {
        if (v < 0.35) cedar(mb, x, z, size);
        else pine(mb, x, z, size * 1.1);
        colliders.push({ x, z, hw: 0.4, hd: 0.4 });
      } else if (r < 0.5) {
        bush(mb, x, z, size, r < 0.44 ? FLOWERS[Math.floor(r * 100) % FLOWERS.length] : undefined);
        colliders.push({ x, z, hw: 0.6, hd: 0.5 });
      } else if (r < 0.66) {
        flowers(mb, x, z, rand(gx, gz, 6));
        flowerSpots.push(new THREE.Vector3(x, 0, z));
      } else if (r < 0.68) {
        mushrooms(mb, x, z, Math.floor(r * 1000));
      } else if (r < 0.7) {
        mb.add(new THREE.DodecahedronGeometry(0.55 * size, 0), '#b7b2aa', [x, 0.25, z], [r * 9, r * 7, 0], [1, 0.65, 0.9]);
        colliders.push({ x, z, hw: 0.5, hd: 0.45 });
      } else if (r < 0.9) {
        tuft(mb, x, z);
      }
    }
  }
  for (const mb of builders.values()) {
    if (mb.isEmpty()) continue;
    const m = new THREE.Mesh(mb.build(), vertexMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, colliders, flowers: flowerSpots, fruitTrees };
}

import * as THREE from 'three';
import type { Block } from '../../../shared/protocol.ts';
import { ModelBuilder } from './builder.ts';
import { smallTree, type Collider } from './buildings.ts';
import { curved, vertexMat } from './engine.ts';
import { blockBounds } from './layout.ts';
import { FONT, makeSign } from './props.ts';

export type V3 = [number, number, number];

export interface FairObjects {
  group: THREE.Group;
  colliders: Collider[];
  booths: { nonogram: THREE.Vector3 };  // where the player stands to interact (E)
  entrance: THREE.Vector3;              // just outside the entrance arch, on the road (fast-travel spot)
  update(dt: number, t: number): void;
}

// Shared with the kart circuit.
export const FLAGS = ['#ff7eb6', '#ffd94a', '#7ec4ff', '#95e1a4', '#ff9f43', '#c3a6ff'];
export const BULBS = ['#fff4c2', '#ffd94a', '#ff9fc8', '#fff4c2', '#9fe3ff'];
export const PINK = '#ff7eb6';
export const YELLOW = '#ffd94a';
export const TEAL = '#3fa7a0';
export const SKY = '#7ec4ff';
export const RED = '#e8645c';
export const WHITE = '#ffffff';
export const CREAM = '#fff6e6';
export const WOOD = '#b98553';
export const WOOD_DARK = '#8a5a35';
export const METAL = '#4a5560';
export const STONE = '#cfc6b8';
export const TYRE = '#2b2d31';
/** Perimeter fence line, inset from the block edge (the outer 2 units are road). */
export const EDGE = 2.3;

// Block-local anchors (x, z from the block's north-west corner; designed for a 2×2 block, 40×40).
const ENTRANCE = { x: 20, z: 37.7, half: 2.75 };
const FERRIS = { x: 20, z: 6.8, hub: 7.0, r: 5, gondolas: 8 };
const CAROUSEL = { x: 8.5, z: 16, r: 2.4 };
const PICROSS = { x: 30.5, z: 17.5 };
const DUCKS = { x: 31, z: 9.2, r: 1.6 };
const BUNTING_POSTS: [number, number][] = [[13, 24], [27, 24]];

// --- helpers ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** A thin cylinder between two points (wires, struts, spokes). */
export function rod(mb: ModelBuilder, a: V3, b: V3, r: number, color: THREE.ColorRepresentation, seg = 5) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(len)));
  mb.add(g, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

function sagPoint(a: V3, b: V3, t: number, sag: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
}

/** A sagging wire of glowing bulbs. */
export function lightString(mb: ModelBuilder, a: V3, b: V3, sag: number, spacing = 0.85) {
  const n = Math.max(3, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / spacing));
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const p = sagPoint(a, b, i / n, sag);
    rod(mb, prev, p, 0.02, '#3d3d45', 3);
    if (i < n) mb.with({ glow: 1 }, () => mb.sphere(0.09, BULBS[i % BULBS.length], [p[0], p[1] - 0.1, p[2]], 1, 0));
    prev = p;
  }
}

/** Pennant bunting between two points, like the plaza's. */
export function bunting(mb: ModelBuilder, a: V3, b: V3, sag: number, seed = 0) {
  const n = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.8));
  const rotY = -Math.atan2(b[2] - a[2], b[0] - a[0]);
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const p = sagPoint(a, b, i / n, sag);
    rod(mb, prev, p, 0.018, WHITE, 3);
    prev = p;
  }
  mb.with({ sway: 1.6 }, () => {
    for (let i = 1; i < n; i++) {
      const p = sagPoint(a, b, i / n, sag);
      const flag = new THREE.ConeGeometry(0.22, 0.45, 3);
      flag.rotateX(Math.PI);
      mb.add(flag, FLAGS[(i + seed) % FLAGS.length], [p[0], p[1] - 0.22, p[2]], [0, rotY, 0], [1, 1, 0.15]);
    }
  });
}

/** A flag on a pole; the cloth sways in the wind. */
export function flagPole(mb: ModelBuilder, x: number, y0: number, z: number, h: number, color: string, poleColor = WHITE) {
  mb.cyl(0.05, 0.06, h, poleColor, [x, y0 + h / 2, z], undefined, 6);
  mb.sphere(0.09, YELLOW, [x, y0 + h + 0.05, z], 1, 0);
  mb.with({ sway: 2.6 }, () => {
    mb.box(0.75, 0.45, 0.04, color, [x + 0.4, y0 + h - 0.3, z]);
  });
}

/** A striped post: stacked rings of two colours. */
export function stripedPost(mb: ModelBuilder, x: number, z: number, h: number, r: number, a: string, b: string, seg = 0.55) {
  const n = Math.max(2, Math.round(h / seg));
  const s = h / n;
  for (let i = 0; i < n; i++) mb.cyl(r, r, s, i % 2 ? b : a, [x, s * (i + 0.5), z], undefined, 10);
}

/** A half disc facing +z with its round side down (an awning scallop). */
function lowerHalfDiscZ(r: number, depth: number, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, depth, seg, 1, false, 0, Math.PI);
  g.rotateX(Math.PI / 2); // axis y -> z; the half is on +x
  g.rotateZ(-Math.PI / 2); // +x half -> -y
  return g;
}

export function tyreStack(mb: ModelBuilder, x: number, z: number, n: number, band: string) {
  for (let k = 0; k < n; k++) mb.cyl(0.45, 0.45, 0.3, TYRE, [x, 0.15 + k * 0.3, z], undefined, 8);
  mb.cyl(0.47, 0.47, 0.1, band, [x, n * 0.3 - 0.15, z], undefined, 8);
  mb.cyl(0.22, 0.22, 0.02, '#17181b', [x, n * 0.3 + 0.005, z], undefined, 6);
}

export function flowerPatch(mb: ModelBuilder, x: number, z: number, w: number, d: number, seed: number) {
  mb.box(w, 0.18, d, '#8a5b3b', [x, 0.09, z]);
  const colors = ['#ff7eb6', '#ffd94a', '#ffffff', '#ff6b6b', '#a78bfa', '#ff9f43'];
  mb.with({ sway: 0.8 }, () => {
    const nx = Math.max(1, Math.floor(w / 0.4)), nz = Math.max(1, Math.floor(d / 0.4));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const fx = x - w / 2 + 0.2 + i * 0.4 + ((j % 2) * 0.1), fz = z - d / 2 + 0.2 + j * 0.4;
        mb.cyl(0.02, 0.02, 0.22, '#4fa83a', [fx, 0.3, fz], undefined, 4);
        mb.sphere(0.1, colors[(seed + i * 3 + j) % colors.length], [fx, 0.43, fz], [1, 0.7, 1], 0);
      }
    }
  });
}

export function staticMesh(mb: ModelBuilder, castShadow = true) {
  const m = new THREE.Mesh(mb.build(), vertexMat);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

/** Flat triangles facing up (+y), wound so they are front-facing from above. */
export function flatGeometry(tris: number[]) {
  for (let i = 0; i < tris.length; i += 9) {
    const ux = tris[i + 3] - tris[i], uz = tris[i + 5] - tris[i + 2];
    const vx = tris[i + 6] - tris[i], vz = tris[i + 8] - tris[i + 2];
    if (uz * vx - ux * vz < 0) {
      for (let k = 0; k < 3; k++) {
        const t = tris[i + 3 + k];
        tris[i + 3 + k] = tris[i + 6 + k];
        tris[i + 6 + k] = t;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  const normals = new Float32Array(tris.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

/**
 * A straight, axis-aligned run of the festive perimeter fence (colourful posts,
 * white and pink rails). Returns its collider in the same (local) space.
 */
export function fenceRun(mb: ModelBuilder, x0: number, z0: number, x1: number, z1: number): Collider {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const posts = Math.max(2, Math.round(len / 1.8) + 1);
  for (let i = 0; i < posts; i++) {
    const t = i / (posts - 1);
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    mb.box(0.2, 1.0, 0.2, FLAGS[(i + Math.round(x0 + z0)) % FLAGS.length], [x, 0.5, z]);
    mb.sphere(0.14, WHITE, [x, 1.08, z], 1, 0);
  }
  mb.box(alongX ? len : 0.08, 0.1, alongX ? 0.08 : len, WHITE, [cx, 0.82, cz]);
  mb.box(alongX ? len : 0.08, 0.1, alongX ? 0.08 : len, '#ffc2dc', [cx, 0.45, cz]);
  return { x: cx, z: cz, hw: alongX ? len / 2 : 0.3, hd: alongX ? 0.3 : len / 2 };
}

/** A lamp post: a thin pole with a glowing globe (and optionally a little flag). */
export function lampPost(mb: ModelBuilder, x: number, z: number, h: number, flag?: string) {
  mb.cyl(0.08, 0.11, h, METAL, [x, h / 2, z], undefined, 6);
  mb.with({ glow: 1 }, () => mb.sphere(0.2, '#fff4c2', [x, h + 0.12, z], 1, 1));
  if (flag) mb.with({ sway: 2.4 }, () => mb.box(0.55, 0.34, 0.04, flag, [x + 0.3, h - 0.35, z]));
}

// --- picross board ---------------------------------------------------------------------

const HEART = [
  '...............',
  '...............',
  '...###...###...',
  '..#####.#####..',
  '.###o#########.',
  '.##oo#########.',
  '.#############.',
  '..###########..',
  '...#########...',
  '....#######....',
  '.....#####.....',
  '......###......',
  '.......#.......',
  '...............',
  '...............',
];

function picrossTexture() {
  const w = 512, h = 600;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  };
  rr(6, 6, w - 12, h - 12, 30);
  ctx.fillStyle = '#fff9e8';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = WOOD_DARK;
  ctx.stroke();
  ctx.fillStyle = '#d64f86';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText('Picross 15×15', w / 2, 62);
  const cell = 26, gx = (w - cell * 15) / 2, gy = 112;
  for (let r = 0; r < 15; r++) {
    for (let k = 0; k < 15; k++) {
      const ch = HEART[r][k];
      ctx.fillStyle = ch === '#' ? '#ff5c8a' : ch === 'o' ? '#ffe3ec' : '#fdf3e1';
      ctx.fillRect(gx + k * cell, gy + r * cell, cell, cell);
      if (ch === '.' && (r * 7 + k * 3) % 5 === 0) {
        // A few crossed-out cells, like a puzzle in progress.
        ctx.strokeStyle = '#c9b99a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(gx + k * cell + 8, gy + r * cell + 8);
        ctx.lineTo(gx + k * cell + cell - 8, gy + r * cell + cell - 8);
        ctx.moveTo(gx + k * cell + cell - 8, gy + r * cell + 8);
        ctx.lineTo(gx + k * cell + 8, gy + r * cell + cell - 8);
        ctx.stroke();
      }
    }
  }
  for (let i = 0; i <= 15; i++) {
    ctx.strokeStyle = i % 5 === 0 ? '#8a5a35' : '#d8c6a4';
    ctx.lineWidth = i % 5 === 0 ? 3.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(gx + i * cell, gy);
    ctx.lineTo(gx + i * cell, gy + cell * 15);
    ctx.moveTo(gx, gy + i * cell);
    ctx.lineTo(gx + cell * 15, gy + i * cell);
    ctx.stroke();
  }
  ctx.fillStyle = '#5b3a1e';
  ctx.globalAlpha = 0.7;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('fill the grid, find the picture!', w / 2, gy + cell * 15 + 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: h / w };
}

// --- the fair --------------------------------------------------------------------------

/**
 * The fun fair: a 2×2 block with an entrance arch in the middle of the south
 * edge, a Ferris wheel at the back (north), a carousel, a picross booth, a
 * duck pond, a popcorn cart and balloons. Built block-local; the group sits at
 * the block's north-west corner.
 */
export function buildFair(block: Block): FairObjects {
  const bb = blockBounds(block);
  const ox = bb.minX, oz = bb.minZ;
  const W = bb.maxX - bb.minX, D = bb.maxZ - bb.minZ;
  const group = new THREE.Group();
  group.position.set(ox, 0, oz);
  const colliders: Collider[] = [];
  const collide = (x: number, z: number, hw: number, hd: number) => colliders.push({ x: ox + x, z: oz + z, hw, hd });
  const mb = new ModelBuilder();

  // --- Ground: a sandy walkway from the gate to the Ferris wheel, a little square in the middle.
  mb.box(3.6, 0.02, ENTRANCE.z - 9.7, '#ecd9b0', [ENTRANCE.x, 0.011, (ENTRANCE.z + 9.7) / 2]);
  mb.box(22, 0.02, 3.2, '#ecd9b0', [ENTRANCE.x, 0.012, 21.5]);

  // --- Perimeter fence, with a gap for the entrance ------------------------------------
  const eMin = EDGE, eMaxX = W - EDGE, eMaxZ = D - EDGE;
  const gateL = ENTRANCE.x - ENTRANCE.half, gateR = ENTRANCE.x + ENTRANCE.half;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const c = fenceRun(mb, x0, z0, x1, z1);
    collide(c.x, c.z, c.hw, c.hd);
  };
  run(eMin, eMin, eMaxX, eMin);
  run(eMin, eMin, eMin, eMaxZ);
  run(eMaxX, eMin, eMaxX, eMaxZ);
  run(eMin, eMaxZ, gateL - 0.3, eMaxZ);
  run(gateR + 0.3, eMaxZ, eMaxX, eMaxZ);

  // Lamp posts around the fence, strung with bulbs (the arch posts close the loop).
  const ARCH_TOP = 4.4;
  const loop: { x: number; z: number; h: number; link: boolean }[] = [
    { x: gateR, z: eMaxZ, h: ARCH_TOP, link: true },
    { x: 29, z: eMaxZ, h: 3.4, link: true },
    { x: eMaxX, z: eMaxZ, h: 3.4, link: true },
    { x: eMaxX, z: 28, h: 3.4, link: true },
    { x: eMaxX, z: 19, h: 3.4, link: true },
    { x: eMaxX, z: 10, h: 3.4, link: true },
    { x: eMaxX, z: eMin, h: 3.4, link: true },
    { x: 30, z: eMin, h: 3.4, link: true },
    { x: 10, z: eMin, h: 3.4, link: true },
    { x: eMin, z: eMin, h: 3.4, link: true },
    { x: eMin, z: 10, h: 3.4, link: true },
    { x: eMin, z: 19, h: 3.4, link: true },
    { x: eMin, z: 28, h: 3.4, link: true },
    { x: eMin, z: eMaxZ, h: 3.4, link: true },
    { x: 11, z: eMaxZ, h: 3.4, link: true },
    { x: gateL, z: eMaxZ, h: ARCH_TOP, link: false },
  ];
  loop.forEach((p, i) => {
    if (p.h !== ARCH_TOP) {
      lampPost(mb, p.x, p.z, p.h, i % 2 === 0 ? FLAGS[i % FLAGS.length] : undefined);
      collide(p.x, p.z, 0.2, 0.2);
    }
    const q = loop[(i + 1) % loop.length];
    if (p.link) lightString(mb, [p.x, p.h - 0.05, p.z], [q.x, q.h - 0.05, q.z], 0.55);
  });

  // --- Entrance arch -------------------------------------------------------------------
  {
    const { x: ex, z: ez, half } = ENTRANCE;
    for (const side of [-1, 1]) {
      const px = ex + side * half;
      mb.box(0.8, 0.25, 0.8, STONE, [px, 0.125, ez]);
      stripedPost(mb, px, ez, ARCH_TOP, 0.22, RED, WHITE, 0.55);
      mb.with({ glow: 1 }, () => mb.sphere(0.3, YELLOW, [px, ARCH_TOP + 0.25, ez], 1, 1));
      flagPole(mb, px, ARCH_TOP + 0.5, ez, 1.1, side < 0 ? PINK : SKY);
      collide(px, ez, 0.35, 0.35);
    }
    mb.box(2 * half + 0.3, 0.34, 0.34, PINK, [ex, 4.1, ez]);
    // A low arc of bulbs over the banner.
    const arc: V3[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI;
      arc.push([ex - Math.cos(a) * half, 4.25 + Math.sin(a) * 1.35, ez]);
    }
    for (let i = 0; i < arc.length - 1; i++) rod(mb, arc[i], arc[i + 1], 0.09, YELLOW, 6);
    mb.with({ glow: 1 }, () => {
      for (let i = 1; i < arc.length - 1; i++) mb.sphere(0.12, BULBS[i % BULBS.length], [arc[i][0], arc[i][1], ez + 0.12], 1, 0);
      for (let i = 0; i < 9; i++) mb.sphere(0.08, BULBS[(i + 2) % BULBS.length], [ex - half + 0.5 + i * ((2 * half - 1) / 8), 3.88, ez + 0.2], 1, 0);
    });
    // Bunting from the arch into the fair, over the walkway.
    const [w1, w2] = BUNTING_POSTS;
    bunting(mb, [ex - half, ARCH_TOP - 0.2, ez], [w1[0], 3.5, w1[1]], 0.6, 0);
    bunting(mb, [ex + half, ARCH_TOP - 0.2, ez], [w2[0], 3.5, w2[1]], 0.6, 3);
    bunting(mb, [w1[0], 3.5, w1[1]], [w2[0], 3.5, w2[1]], 0.7, 1);
    for (const [x, z] of BUNTING_POSTS) {
      stripedPost(mb, x, z, 3.6, 0.1, TEAL, WHITE, 0.6);
      mb.sphere(0.15, YELLOW, [x, 3.7, z], 1, 0);
      collide(x, z, 0.2, 0.2);
    }
    // Flower beds just inside the gate.
    flowerPatch(mb, ex - half - 1.6, ez - 1.0, 1.8, 0.8, 1);
    flowerPatch(mb, ex + half + 1.6, ez - 1.0, 1.8, 0.8, 4);
  }

  // --- Ferris wheel (north) ------------------------------------------------------------
  const wheel = new ModelBuilder();
  const gondolas: THREE.Mesh[] = [];
  {
    const { x: fx, z: fz, hub, r } = FERRIS;
    mb.box(7.2, 0.3, 3.6, STONE, [fx, 0.15, fz]);
    mb.box(2.0, 0.45, 1.4, '#e3dccf', [fx, 0.22, fz + 2.2]);
    for (const dz of [-1.1, 1.1]) {
      for (const dx of [-2.9, 2.9]) rod(mb, [fx + dx, 0.3, fz + dz], [fx, hub, fz + dz * 0.75], 0.14, WHITE, 8);
      rod(mb, [fx - 1.9, 2.4, fz + dz * 0.9], [fx + 1.9, 2.4, fz + dz * 0.9], 0.09, TEAL, 6);
      rod(mb, [fx - 1.0, 4.5, fz + dz * 0.83], [fx + 1.0, 4.5, fz + dz * 0.83], 0.08, TEAL, 6);
    }
    mb.add(new THREE.CylinderGeometry(0.2, 0.2, 2.1, 10), METAL, [fx, hub, fz], [Math.PI / 2, 0, 0]);
    // A little ticket stand at the foot.
    mb.box(1.1, 1.2, 0.9, PINK, [fx + 2.6, 0.6, fz + 2.3]);
    mb.box(1.3, 0.12, 1.1, WHITE, [fx + 2.6, 1.26, fz + 2.3]);
    mb.cone(0.8, 0.6, YELLOW, [fx + 2.6, 1.62, fz + 2.3], [0, Math.PI / 4, 0], 4);
    collide(fx, fz, 3.6, 1.8);
    collide(fx, fz + 2.2, 1.0, 0.7);
    collide(fx + 2.6, fz + 2.3, 0.6, 0.5);

    // The wheel itself spins (built around its hub).
    const spokes = 16;
    for (const z of [-0.62, 0.62]) {
      wheel.add(new THREE.TorusGeometry(r, 0.1, 6, 40), PINK, [0, 0, z]);
      wheel.add(new THREE.TorusGeometry(r * 0.55, 0.06, 5, 28), YELLOW, [0, 0, z]);
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        rod(wheel, [0, 0, z * 0.6], [Math.cos(a) * r, Math.sin(a) * r, z], 0.045, i % 2 ? WHITE : YELLOW, 4);
      }
    }
    wheel.with({ glow: 1 }, () => {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        wheel.sphere(0.1, BULBS[i % BULBS.length], [Math.cos(a) * r, Math.sin(a) * r, 0.74], 1, 0);
      }
    });
    for (let i = 0; i < FERRIS.gondolas; i++) {
      const a = (i / FERRIS.gondolas) * Math.PI * 2;
      rod(wheel, [Math.cos(a) * r, Math.sin(a) * r, -0.62], [Math.cos(a) * r, Math.sin(a) * r, 0.62], 0.05, METAL, 5);
    }
    wheel.cyl(0.55, 0.55, 1.5, TEAL, [0, 0, 0], [Math.PI / 2, 0, 0], 12);
    wheel.cyl(0.35, 0.35, 0.1, YELLOW, [0, 0, 0.8], [Math.PI / 2, 0, 0], 12);

    // Gondolas hang from the rim and stay upright (positioned every frame).
    const colors = [PINK, SKY, YELLOW, '#95e1a4', '#ff9f43', '#c3a6ff', TEAL, RED];
    for (let i = 0; i < FERRIS.gondolas; i++) {
      const g = new ModelBuilder();
      g.box(0.06, 0.45, 0.06, METAL, [0, -0.22, 0]);
      g.cone(0.48, 0.3, colors[i % colors.length], [0, -0.55, 0], undefined, 8);
      for (const [dx, dz] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]] as const) g.box(0.05, 0.4, 0.05, WHITE, [dx, -0.88, dz]);
      g.cyl(0.43, 0.36, 0.5, colors[i % colors.length], [0, -1.3, 0], undefined, 10);
      g.cyl(0.44, 0.44, 0.06, WHITE, [0, -1.05, 0], undefined, 10);
      const m = new THREE.Mesh(g.build(), vertexMat);
      m.castShadow = true;
      group.add(m);
      gondolas.push(m);
    }
  }
  const wheelMesh = new THREE.Mesh(wheel.build(), vertexMat);
  wheelMesh.castShadow = true;
  wheelMesh.position.set(FERRIS.x, FERRIS.hub, FERRIS.z);
  group.add(wheelMesh);

  // --- Carousel ------------------------------------------------------------------------
  const carousel = new ModelBuilder();
  {
    const { x: cx, z: cz, r } = CAROUSEL;
    mb.cyl(r + 0.25, r + 0.35, 0.3, '#fff4de', [cx, 0.15, cz], undefined, 20);
    mb.cyl(r + 0.37, r + 0.37, 0.1, PINK, [cx, 0.08, cz], undefined, 20);
    collide(cx, cz, r + 0.2, r + 0.2);

    carousel.cyl(r, r, 0.14, TEAL, [0, 0.37, 0], undefined, 20);
    stripedPost(carousel, 0, 0, 3.3, 0.32, YELLOW, WHITE, 0.55);
    carousel.cyl(r + 0.2, r + 0.2, 0.1, CREAM, [0, 3.2, 0], undefined, 20);
    const wedges = 12;
    for (let i = 0; i < wedges; i++) {
      const cone = new THREE.ConeGeometry(r + 0.4, 1.2, 2, 1, true, (i / wedges) * Math.PI * 2, (Math.PI * 2) / wedges);
      carousel.add(cone, i % 2 ? WHITE : PINK, [0, 3.85, 0]);
      const a = ((i + 0.5) / wedges) * Math.PI * 2;
      carousel.sphere(0.2, i % 2 ? PINK : YELLOW, [Math.sin(a) * (r + 0.3), 3.2, Math.cos(a) * (r + 0.3)], [1, 0.8, 1], 0);
    }
    carousel.with({ glow: 1 }, () => {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        carousel.sphere(0.07, BULBS[i % BULBS.length], [Math.sin(a) * (r + 0.42), 3.36, Math.cos(a) * (r + 0.42)], 1, 0);
      }
      carousel.sphere(0.22, YELLOW, [0, 4.55, 0], 1, 1);
    });
    carousel.cyl(0.03, 0.03, 0.7, WHITE, [0, 4.9, 0], undefined, 4);
    carousel.box(0.5, 0.3, 0.03, PINK, [0.26, 5.1, 0]);
    const horses = ['#ffffff', '#ffd9e2', '#fff0b3', '#d3ebff', '#e9ddff', '#dcf4d4'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hx = Math.cos(a) * 1.7, hz = Math.sin(a) * 1.7;
      const tx = -Math.sin(a), tz = Math.cos(a);
      const y = 1.0 + (i % 2) * 0.35;
      carousel.cyl(0.04, 0.04, 2.8, '#f2c94c', [hx, 1.85, hz], undefined, 5);
      carousel.box(0.3, 0.34, 0.8, horses[i], [hx, y, hz], [0, -a, 0]);
      carousel.box(0.24, 0.42, 0.26, horses[i], [hx + tx * 0.45, y + 0.3, hz + tz * 0.45], [0, -a, 0]);
      carousel.box(0.08, 0.3, 0.3, FLAGS[i], [hx + tx * 0.38, y + 0.38, hz + tz * 0.38], [0, -a, 0]);
      carousel.box(0.32, 0.06, 0.34, FLAGS[(i + 2) % FLAGS.length], [hx, y + 0.2, hz], [0, -a, 0]);
      for (const s of [-1, 1]) {
        carousel.box(0.07, 0.45, 0.07, horses[i], [hx + tx * 0.28 * s, y - 0.35, hz + tz * 0.28 * s], [0, -a, 0]);
      }
    }
  }
  const carouselMesh = new THREE.Mesh(carousel.build(), vertexMat);
  carouselMesh.castShadow = true;
  carouselMesh.position.set(CAROUSEL.x, 0, CAROUSEL.z);
  group.add(carouselMesh);

  // --- Picross booth -------------------------------------------------------------------
  {
    const { x: px, z: pz } = PICROSS;
    mb.box(4.4, 0.2, 2.8, WOOD, [px, 0.1, pz]);
    mb.box(4.2, 2.4, 0.15, CREAM, [px, 1.4, pz - 1.25]);
    for (const dx of [-2.05, 2.05]) {
      mb.box(0.15, 2.4, 2.4, '#ffe0e6', [px + dx, 1.4, pz - 0.1]);
      stripedPost(mb, px + dx, pz + 1.2, 2.7, 0.1, PINK, WHITE, 0.45);
    }
    mb.box(3.6, 1.0, 0.7, PINK, [px, 0.7, pz + 0.95]);
    mb.box(3.9, 0.1, 0.9, WHITE, [px, 1.24, pz + 0.95]);
    for (let i = 0; i < 6; i++) mb.box(0.45, 0.05, 0.02, i % 2 ? YELLOW : WHITE, [px - 1.3 + i * 0.52, 0.75, pz + 1.31]);
    // Striped awning with a scalloped edge.
    for (let i = 0; i < 9; i++) {
      mb.box(0.5, 0.1, 3.0, i % 2 ? WHITE : TEAL, [px - 2.0 + i * 0.5, 2.85, pz + 0.05], [0.28, 0, 0]);
      mb.add(lowerHalfDiscZ(0.25, 0.06), i % 2 ? WHITE : TEAL, [px - 2.0 + i * 0.5, 2.44, pz + 1.5]);
    }
    // Things on the counter: puzzle sheets, pencils, a prize cup.
    mb.box(0.55, 0.02, 0.42, WHITE, [px - 1.0, 1.3, pz + 0.95], [0, 0.2, 0]);
    mb.box(0.55, 0.02, 0.42, '#fff9c4', [px - 0.35, 1.3, pz + 1.0], [0, -0.15, 0]);
    for (let i = 0; i < 3; i++) mb.cyl(0.03, 0.03, 0.4, FLAGS[i], [px + 0.35 + i * 0.1, 1.49, pz + 0.85], undefined, 5);
    mb.cyl(0.14, 0.14, 0.3, WOOD_DARK, [px + 0.45, 1.44, pz + 0.85], undefined, 8);
    mb.cyl(0.18, 0.1, 0.3, '#f2c94c', [px + 1.2, 1.55, pz + 0.9], undefined, 10);
    mb.cyl(0.08, 0.14, 0.12, '#f2c94c', [px + 1.2, 1.35, pz + 0.9], undefined, 10);
    // The big pixel board on two posts behind the stall.
    const { tex, aspect } = picrossTexture();
    const bw = 2.3, bh = bw * aspect, by = 3.4 + bh / 2;
    for (const dx of [-1.15, 1.15]) mb.box(0.16, by + bh / 2 - 0.3, 0.16, WOOD_DARK, [px + dx, (by + bh / 2 - 0.3) / 2, pz - 1.45]);
    mb.box(bw + 0.16, bh + 0.16, 0.1, WOOD, [px, by, pz - 1.36]);
    mb.with({ glow: 1 }, () => {
      for (let i = 0; i < 8; i++) mb.sphere(0.07, BULBS[i % BULBS.length], [px - bw / 2 + 0.1 + i * ((bw - 0.2) / 7), by + bh / 2 + 0.12, pz - 1.3], 1, 0);
    });
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), curved(new THREE.MeshLambertMaterial({ map: tex })));
    boardFace.position.set(px, by, pz - 1.28);
    group.add(boardFace);
    collide(px, pz - 0.05, 2.25, 1.45);
  }

  // --- Hook-a-duck pond ----------------------------------------------------------------
  {
    const { x, z, r } = DUCKS;
    mb.cyl(r, r + 0.1, 0.5, SKY, [x, 0.25, z], undefined, 16);
    mb.cyl(r + 0.12, r + 0.12, 0.08, WHITE, [x, 0.52, z], undefined, 16);
    mb.cyl(r - 0.15, r - 0.15, 0.04, '#6fd3e6', [x, 0.46, z], undefined, 16);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9, rr = 0.5 + (i % 3) * 0.3;
      const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
      mb.sphere(0.16, YELLOW, [x + dx, 0.56, z + dz], [1.2, 0.8, 1], 0);
      mb.sphere(0.1, YELLOW, [x + dx + 0.12, 0.7, z + dz], 1, 0);
      mb.box(0.08, 0.04, 0.06, '#ff9f43', [x + dx + 0.23, 0.69, z + dz]);
    }
    // Two fishing rods leaning on the rim.
    rod(mb, [x - r - 0.1, 0.55, z + 0.4], [x - r - 0.9, 2.0, z + 0.9], 0.03, WOOD_DARK, 4);
    rod(mb, [x + r + 0.1, 0.55, z + 0.4], [x + r + 0.9, 2.0, z + 0.9], 0.03, WOOD_DARK, 4);
    collide(x, z, r + 0.15, r + 0.15);
  }

  // --- Popcorn cart, balloons, benches, trees -------------------------------------------
  {
    const [x, z] = [8, 28];
    mb.box(1.5, 0.8, 0.9, RED, [x, 0.75, z]);
    mb.box(1.6, 0.08, 1.0, WHITE, [x, 1.18, z]);
    mb.box(1.3, 0.8, 0.75, '#e6f6ff', [x, 1.62, z]);
    mb.sphere(0.5, '#fff3c4', [x, 1.5, z], [1.1, 0.5, 0.6], 1, 0.05);
    for (let i = 0; i < 7; i++) mb.sphere(0.1, '#fffbe8', [x - 0.45 + i * 0.15, 1.72 + (i % 2) * 0.08, z + 0.1 * (i % 3 - 1)], 1, 0);
    mb.box(1.5, 0.12, 0.95, YELLOW, [x, 2.06, z]);
    for (let i = 0; i < 4; i++) mb.cone(0.24, 0.35, i % 2 ? WHITE : RED, [x - 0.54 + i * 0.36, 2.3, z], undefined, 6);
    for (const dx of [-0.55, 0.55]) mb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12), '#ffd94a', [x + dx, 0.3, z + 0.5], [Math.PI / 2, 0, 0]);
    mb.box(0.06, 0.06, 0.9, METAL, [x + 0.95, 0.9, z]);
    collide(x, z, 0.85, 0.65);
  }
  {
    const [x, z] = [31.5, 28.5];
    mb.cyl(0.25, 0.3, 0.3, STONE, [x, 0.15, z], undefined, 8);
    mb.cyl(0.04, 0.04, 1.2, WOOD_DARK, [x, 0.9, z], undefined, 5);
    mb.with({ sway: 3.5 }, () => {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, rr = 0.25 + (i % 3) * 0.2;
        const top: V3 = [x + Math.cos(a) * rr, 2.7 + (i % 4) * 0.25, z + Math.sin(a) * rr * 0.7];
        rod(mb, [x, 1.5, z], [top[0], top[1] - 0.3, top[2]], 0.012, WHITE, 3);
        mb.sphere(0.3, FLAGS[i % FLAGS.length], top, [1, 1.18, 1], 1);
      }
    });
    collide(x, z, 0.35, 0.35);
  }
  for (const [x, z] of [[26.5, 12.2], [6.5, 22.5]] as const) {
    mb.box(1.8, 0.1, 0.55, WOOD, [x, 0.5, z]);
    mb.box(1.8, 0.45, 0.08, WOOD, [x, 0.82, z - 0.26]);
    for (const d of [-0.75, 0.75]) mb.box(0.1, 0.5, 0.1, WOOD_DARK, [x + d, 0.25, z]);
    collide(x, z, 0.9, 0.3);
  }
  for (const [x, z, s, fruit] of [[4.8, 34.2, 1.1, '#e8423b'], [35.2, 34.2, 1.05, '#f28c28'], [5.2, 5.2, 1.0, undefined], [35, 5.2, 1.0, undefined]] as const) {
    smallTree(mb, x, z, s, fruit);
    collide(x, z, 0.4, 0.4);
  }

  group.add(staticMesh(mb));

  // Sign on the arch (facing the camera).
  const gateSign = makeSign('Fun Fair', { sub: 'rides · picross · games', posts: 0, width: 3.6, height: 1.0, bg: '#fff9e8' });
  gateSign.position.set(ENTRANCE.x, 4.72 - 1.35, ENTRANCE.z + 0.3);
  group.add(gateSign);

  const placeGondolas = () => {
    const rot = wheelMesh.rotation.z;
    gondolas.forEach((g, i) => {
      const a = (i / FERRIS.gondolas) * Math.PI * 2 + rot;
      g.position.set(FERRIS.x + Math.cos(a) * FERRIS.r, FERRIS.hub + Math.sin(a) * FERRIS.r, FERRIS.z);
    });
  };
  placeGondolas();

  const world = (x: number, z: number) => new THREE.Vector3(ox + x, 0, oz + z);
  return {
    group,
    colliders,
    booths: { nonogram: world(PICROSS.x, PICROSS.z + 2.25) },
    entrance: world(ENTRANCE.x, D - 1),
    update(_dt: number, t: number) {
      wheelMesh.rotation.z = t * 0.16;
      placeGondolas();
      carouselMesh.rotation.y = t * 0.55;
    },
  };
}

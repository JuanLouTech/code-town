import * as THREE from 'three';
import { discZ, upperHalfCylinderZ, type ModelBuilder } from './builder.ts';

type V3 = [number, number, number];

export type HouseKind = 'cottage' | 'cabin' | 'barn' | 'tower' | 'mushroom' | 'tall' | 'hall';

export interface HouseOpts {
  wall: string;
  roof: string;
  trim: string;
  door: string;
  accent: string; // shutters, window boxes
  seed: number;
}

export interface HouseResult {
  front: number;        // z of the front wall (porch starts here)
  hw: number;           // collision half-width
  hd: number;           // collision half-depth
  zc: number;           // collision centre z
  chimneys: V3[];       // where smoke comes out
  porchW: number;
  clock?: V3;           // centre of the tower clock face (the hands are added separately, so they can move)
}

export function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

const GLASS = '#bfe6ff';
const STONE = '#d6cdbf';
const WOOD = '#b98553';
const WOOD_DARK = '#8a5a35';

// --- details ----------------------------------------------------------------------------

function windowRect(mb: ModelBuilder, x: number, y: number, z: number, w: number, h: number, o: HouseOpts, shutters = true, box = true) {
  mb.box(w + 0.2, h + 0.2, 0.1, o.trim, [x, y, z]);
  mb.with({ glow: 1 }, () => mb.box(w, h, 0.12, GLASS, [x, y, z + 0.01]));
  mb.box(0.06, h, 0.15, o.trim, [x, y, z + 0.02]);
  mb.box(w, 0.06, 0.15, o.trim, [x, y, z + 0.02]);
  if (shutters) {
    for (const s of [-1, 1]) {
      mb.box(w * 0.42, h + 0.1, 0.07, o.accent, [x + s * (w / 2 + w * 0.26), y, z + 0.02]);
      mb.box(w * 0.3, 0.04, 0.09, shade(o.accent, 0.8), [x + s * (w / 2 + w * 0.26), y + h * 0.2, z + 0.05]);
      mb.box(w * 0.3, 0.04, 0.09, shade(o.accent, 0.8), [x + s * (w / 2 + w * 0.26), y - h * 0.2, z + 0.05]);
    }
  }
  if (box) {
    mb.box(w + 0.25, 0.22, 0.3, WOOD, [x, y - h / 2 - 0.2, z + 0.16]);
    const flowers = ['#ff7eb6', '#ffd94a', '#ff6b6b', '#ffffff', '#a78bfa'];
    for (let i = 0; i < 4; i++) {
      mb.with({ sway: 0.6 }, () =>
        mb.sphere(0.1, flowers[(o.seed + i) % flowers.length], [x - w / 2 + 0.1 + (i * w) / 3.4, y - h / 2 - 0.02, z + 0.2], 1, 0));
    }
  }
}

function roundWindow(mb: ModelBuilder, x: number, y: number, z: number, r: number, o: HouseOpts, rotY = 0) {
  mb.add(new THREE.TorusGeometry(r, 0.07, 6, 18), o.trim, [x, y, z], [0, rotY, 0]);
  mb.with({ glow: 1 }, () => mb.add(discZ(r, 0.08), GLASS, [x, y, z], [0, rotY, 0]));
  mb.box(r * 2, 0.05, 0.1, o.trim, [x, y, z + 0.02], [0, rotY, 0]);
}

function door(mb: ModelBuilder, x: number, front: number, w: number, h: number, o: HouseOpts, round = true) {
  const y0 = 0.4;
  mb.box(w + 0.28, h + 0.14, 0.1, o.trim, [x, y0 + h / 2, front + 0.03]);
  mb.box(w, h, 0.16, o.door, [x, y0 + h / 2, front + 0.05]);
  if (round) {
    mb.add(upperHalfCylinderZ(w / 2 + 0.14, 0.1), o.trim, [x, y0 + h, front + 0.03]);
    mb.add(upperHalfCylinderZ(w / 2, 0.16), o.door, [x, y0 + h, front + 0.05]);
  }
  // Planks and a knob.
  for (const dx of [-w / 4, w / 4]) mb.box(0.03, h * 0.95, 0.18, shade(o.door, 0.82), [x + dx, y0 + h / 2, front + 0.05]);
  mb.sphere(0.07, '#f2c94c', [x + w * 0.32, y0 + h * 0.48, front + 0.16], 1, 0);
  mb.with({ glow: 1 }, () => mb.sphere(0.12, '#fff4c2', [x - w / 2 - 0.35, y0 + h * 0.75, front + 0.18], 1, 0)); // porch lamp
}

function foundation(mb: ModelBuilder, W: number, D: number, zc: number, round = false) {
  if (round) mb.cyl(W / 2 + 0.3, W / 2 + 0.35, 0.4, STONE, [0, 0.2, zc], undefined, 22);
  else mb.box(W + 0.5, 0.4, D + 0.5, STONE, [0, 0.2, zc]);
  const front = zc + (round ? W / 2 : D / 2) + 0.22;
  const n = Math.floor((W + 0.4) / 0.55);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 - 0.1 + i * 0.55 + 0.25;
    if (round && Math.abs(x) > W / 2 - 0.2) continue;
    mb.sphere(0.2, i % 3 ? '#cfc4b5' : '#bdb2a2', [x, 0.22, front], [1.3, 0.8, 0.6], 0);
  }
}

function chimney(mb: ModelBuilder, x: number, z: number, y0: number, h: number, brick = '#c46a4f'): V3 {
  mb.box(0.72, h, 0.72, brick, [x, y0 + h / 2, z]);
  mb.box(0.86, 0.18, 0.86, shade(brick, 0.8), [x, y0 + h, z]);
  for (let i = 0; i < 3; i++) mb.box(0.74, 0.03, 0.74, shade(brick, 1.15), [x, y0 + 0.3 + i * 0.45, z]);
  return [x, y0 + h + 0.2, z];
}

/** Gable roof with shingle rows; ridge along x. */
function shingledGable(mb: ModelBuilder, W: number, D: number, h: number, roof: string, gable: string, y: number, zc: number, overhang = 0.4) {
  const half = D / 2 + overhang;
  const len = Math.hypot(half, h);
  const angle = Math.atan2(h, half);
  const t = 0.2;
  for (const side of [-1, 1]) {
    const cz = zc + side * half / 2;
    mb.box(W + overhang * 2, t, len, roof, [0, y + h / 2 + t / 2, cz], [side * angle, 0, 0]);
    // Shingle rows.
    const rows = Math.floor(len / 0.34);
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      const rz = zc + side * half * f;
      const ry = y + h * (1 - f) + t + 0.02;
      mb.box(W + overhang * 2 + 0.02, 0.07, 0.16, i % 2 ? shade(roof, 0.86) : shade(roof, 1.08), [0, ry, rz], [side * angle, 0, 0]);
    }
  }
  mb.box(W + overhang * 2 + 0.1, 0.18, 0.3, shade(roof, 0.75), [0, y + h + 0.16, zc]);
  const shape = new THREE.Shape();
  shape.moveTo(-D / 2, 0);
  shape.lineTo(D / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  for (const side of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    mb.add(g, gable, [side * (W / 2) - (side > 0 ? 0.12 : 0), y, zc], [0, Math.PI / 2, 0]);
  }
}

function porch(mb: ModelBuilder, front: number, w: number, color = WOOD) {
  mb.box(w, 0.25, 2.2, color, [0, 0.13, front + 1.1]);
  for (let i = 0; i < Math.floor(w / 0.5); i++) mb.box(0.03, 0.26, 2.2, WOOD_DARK, [-w / 2 + 0.5 + i * 0.5, 0.14, front + 1.1]);
  mb.box(1.4, 0.12, 0.5, WOOD_DARK, [0, 0.06, front + 2.45]);
}

// --- archetypes -----------------------------------------------------------------------------

export function buildHouse(mb: ModelBuilder, kind: HouseKind, o: HouseOpts): HouseResult {
  switch (kind) {
    case 'cabin': return cabin(mb, o);
    case 'barn': return barn(mb, o);
    case 'tower': return tower(mb, o);
    case 'mushroom': return mushroom(mb, o);
    case 'tall': return tall(mb, o);
    case 'hall': return hall(mb, o);
    default: return cottage(mb, o);
  }
}

function cottage(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const W = 5.6, D = 4.4, H = 3.0, zc = -3.4, front = zc + D / 2;
  foundation(mb, W, D, zc);
  mb.box(W, H, D, o.wall, [0, 0.4 + H / 2, zc]);
  if (o.seed & 1) {
    // Half-timbered.
    const beam = shade(o.door, 0.7);
    for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) mb.box(0.16, H, 0.1, beam, [x, 0.4 + H / 2, front + 0.02]);
    mb.box(W, 0.14, 0.1, beam, [0, 0.4 + H * 0.52, front + 0.02]);
    mb.box(W, 0.14, 0.1, beam, [0, 0.4 + H - 0.08, front + 0.02]);
  } else {
    for (let y = 0.8; y < H + 0.3; y += 0.36) mb.box(W + 0.02, 0.04, D + 0.02, shade(o.wall, 0.93), [0, y, zc]);
  }
  shingledGable(mb, W, D, 2.2, o.roof, o.wall, 0.4 + H + 0.05, zc);
  door(mb, 0, front, 1.15, 1.85, o);
  windowRect(mb, -1.8, 2.1, front + 0.02, 0.95, 0.95, o);
  windowRect(mb, 1.8, 2.1, front + 0.02, 0.95, 0.95, o);
  roundWindow(mb, 0, 0.4 + H + 0.85, front + 0.06, 0.32, o);
  mb.box(1.9, 0.12, 0.9, o.roof, [0, 0.4 + 2.35, front + 0.42], [0.35, 0, 0]);
  const chim = chimney(mb, W * 0.28, zc - D * 0.2, 0.4 + H, 2.2);
  porch(mb, front, 5.2);
  return { front, hw: W / 2 + 0.3, hd: D / 2 + 0.3, zc, chimneys: [chim], porchW: 5.2 };
}

function cabin(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const W = 5.8, D = 4.4, H = 2.8, zc = -3.4, front = zc + D / 2;
  const log = ['#a87650', '#9a6a45', '#b5845c'];
  foundation(mb, W, D, zc);
  mb.box(W - 0.2, H, D - 0.2, shade(log[0], 0.9), [0, 0.4 + H / 2, zc]);
  const r = 0.2;
  for (let i = 0; i < Math.floor(H / (r * 2)); i++) {
    const y = 0.4 + r + i * r * 2;
    const c = log[i % 3];
    mb.add(new THREE.CylinderGeometry(r, r, W + 0.4, 8), c, [0, y, front - 0.05], [0, 0, Math.PI / 2]);
    mb.add(new THREE.CylinderGeometry(r, r, W + 0.4, 8), c, [0, y, zc - D / 2 + 0.05], [0, 0, Math.PI / 2]);
    mb.add(new THREE.CylinderGeometry(r, r, D + 0.4, 8), c, [-W / 2 + 0.05, y + r, zc], [Math.PI / 2, 0, 0]);
    mb.add(new THREE.CylinderGeometry(r, r, D + 0.4, 8), c, [W / 2 - 0.05, y + r, zc], [Math.PI / 2, 0, 0]);
    for (const x of [-W / 2 - 0.2, W / 2 + 0.2]) mb.add(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.02, 8), '#e2c49a', [x, y, front - 0.05], [0, 0, Math.PI / 2]);
  }
  const roof = (o.seed >> 2) & 1 ? '#5f8f4e' : '#8a4b3c';
  shingledGable(mb, W, D, 2.0, roof, log[1], 0.4 + H + 0.05, zc, 0.55);
  door(mb, 0, front + 0.12, 1.1, 1.8, { ...o, door: '#7a4b2e' }, false);
  windowRect(mb, -1.85, 1.9, front + 0.2, 0.9, 0.8, { ...o, trim: '#f5ecd9' }, false);
  windowRect(mb, 1.85, 1.9, front + 0.2, 0.9, 0.8, { ...o, trim: '#f5ecd9' }, false);
  // Stone chimney on the side.
  for (let i = 0; i < 9; i++) mb.sphere(0.36, i % 2 ? '#b8ada0' : '#a59a8c', [W / 2 + 0.35, 0.3 + i * 0.6, zc - 0.4], [1.2, 0.8, 1.1], 0);
  porch(mb, front, 5.4, '#a87650');
  return { front, hw: W / 2 + 0.6, hd: D / 2 + 0.3, zc, chimneys: [[W / 2 + 0.35, 0.3 + 9 * 0.6, zc - 0.4]], porchW: 5.4 };
}

function barn(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const W = 5.6, D = 4.6, H = 2.6, zc = -3.5, front = zc + D / 2;
  const red = (o.seed >> 3) & 1 ? '#c8483c' : '#d9725a';
  foundation(mb, W, D, zc);
  mb.box(W, H, D, red, [0, 0.4 + H / 2, zc]);
  for (let x = -W / 2 + 0.3; x < W / 2; x += 0.45) mb.box(0.04, H, 0.04, shade(red, 0.85), [x, 0.4 + H / 2, front + 0.01]);
  for (const x of [-W / 2, W / 2]) mb.box(0.18, H, 0.18, '#ffffff', [x, 0.4 + H / 2, front]);
  // Gambrel roof.
  const o2 = 0.35;
  const prof = new THREE.Shape();
  prof.moveTo(-D / 2 - o2, 0);
  prof.lineTo(-D / 2 + 0.55, 1.35);
  prof.lineTo(0, 2.05);
  prof.lineTo(D / 2 - 0.55, 1.35);
  prof.lineTo(D / 2 + o2, 0);
  prof.lineTo(D / 2 + o2 - 0.2, 0);
  prof.lineTo(D / 2 - 0.7, 1.2);
  prof.lineTo(0, 1.85);
  prof.lineTo(-D / 2 + 0.7, 1.2);
  prof.lineTo(-D / 2 - o2 + 0.2, 0);
  prof.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(prof, { depth: W + 0.6, bevelEnabled: false });
  mb.add(roofGeo, (o.seed >> 5) & 1 ? '#4a5a6a' : '#6b5b4b', [-W / 2 - 0.3, 0.4 + H, zc], [0, Math.PI / 2, 0]);
  const gable = new THREE.Shape();
  gable.moveTo(-D / 2, 0);
  gable.lineTo(-D / 2 + 0.55, 1.3);
  gable.lineTo(0, 1.95);
  gable.lineTo(D / 2 - 0.55, 1.3);
  gable.lineTo(D / 2, 0);
  gable.closePath();
  for (const side of [-1, 1]) {
    mb.add(new THREE.ExtrudeGeometry(gable, { depth: 0.1, bevelEnabled: false }), red, [side * (W / 2) - (side > 0 ? 0.1 : 0), 0.4 + H, zc], [0, Math.PI / 2, 0]);
  }
  // Big X-braced door and hay loft.
  const dw = 1.9, dh = 2.0;
  mb.box(dw + 0.2, dh + 0.15, 0.1, '#ffffff', [0, 0.4 + dh / 2, front + 0.03]);
  mb.box(dw, dh, 0.14, shade(red, 0.8), [0, 0.4 + dh / 2, front + 0.05]);
  const diag = Math.hypot(dw, dh);
  const ang = Math.atan2(dh, dw);
  for (const s of [-1, 1]) mb.box(diag, 0.13, 0.16, '#ffffff', [0, 0.4 + dh / 2, front + 0.08], [0, 0, s * ang]);
  mb.box(0.1, dh, 0.16, '#ffffff', [0, 0.4 + dh / 2, front + 0.08]);
  mb.with({ glow: 1 }, () => mb.box(0.9, 0.7, 0.12, '#ffd98a', [0, 0.4 + H + 0.8, front + 0.03]));
  mb.box(1.1, 0.9, 0.08, '#ffffff', [0, 0.4 + H + 0.8, front + 0.01]);
  windowRect(mb, -2.0, 2.0, front + 0.02, 0.7, 0.7, { ...o, trim: '#ffffff' }, false);
  windowRect(mb, 2.0, 2.0, front + 0.02, 0.7, 0.7, { ...o, trim: '#ffffff' }, false);
  mb.with({ glow: 1 }, () => mb.sphere(0.12, '#fff4c2', [1.25, 2.3, front + 0.18], 1, 0));
  porch(mb, front, 5.2, '#b98553');
  return { front, hw: W / 2 + 0.3, hd: D / 2 + 0.3, zc, chimneys: [[W * 0.3, 0.4 + H + 2.0, zc]], porchW: 5.2 };
}

function tower(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const R = 2.35, H = 3.8, zc = -3.6, front = zc + R;
  foundation(mb, R * 2, R * 2, zc, true);
  mb.add(new THREE.CylinderGeometry(R, R, H, 24), o.wall, [0, 0.4 + H / 2, zc]);
  for (let y = 0.9; y < H; y += 0.5) mb.add(new THREE.TorusGeometry(R + 0.01, 0.03, 4, 28), shade(o.wall, 0.92), [0, y, zc], [Math.PI / 2, 0, 0]);
  mb.add(new THREE.TorusGeometry(R + 0.05, 0.09, 6, 28), o.trim, [0, 0.4 + H, zc], [Math.PI / 2, 0, 0]);
  mb.add(new THREE.ConeGeometry(R + 0.55, 3.2, 24), o.roof, [0, 0.4 + H + 1.6, zc]);
  for (let i = 0; i < 4; i++) mb.add(new THREE.TorusGeometry(R + 0.4 - i * 0.55, 0.06, 4, 24), shade(o.roof, 0.85), [0, 0.4 + H + 0.35 + i * 0.75, zc], [Math.PI / 2, 0, 0]);
  mb.cyl(0.04, 0.04, 1.2, '#dddddd', [0, 0.4 + H + 3.6, zc], undefined, 6);
  mb.with({ sway: 1 }, () => mb.add(new THREE.ConeGeometry(0.28, 0.9, 4), o.accent, [0.45, 0.4 + H + 3.95, zc], [0, 0, -Math.PI / 2], [1, 1, 0.2]));
  door(mb, 0, front - 0.05, 1.1, 1.85, o);
  for (const a of [-0.75, 0.75]) {
    const x = Math.sin(a) * (R + 0.02), z = zc + Math.cos(a) * (R + 0.02);
    roundWindow(mb, x, 2.2, z, 0.38, o, a);
  }
  roundWindow(mb, 0, 3.3, front + 0.02, 0.32, o);
  porch(mb, front - 0.1, 4.6);
  return { front: front - 0.1, hw: R + 0.3, hd: R + 0.3, zc, chimneys: [], porchW: 4.6 };
}

function mushroom(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const R = 2.1, H = 2.8, zc = -3.5, front = zc + R;
  const cap = ['#e0453e', '#4f86c6', '#f28c28', '#9b6fd1'][(o.seed >> 4) % 4];
  foundation(mb, R * 2, R * 2, zc, true);
  mb.add(new THREE.CylinderGeometry(R * 0.95, R, H, 22), '#fff6e3', [0, 0.4 + H / 2, zc]);
  mb.add(new THREE.SphereGeometry(R + 1.3, 26, 14, 0, Math.PI * 2, 0, Math.PI / 2), cap, [0, 0.4 + H - 0.1, zc], [0, 0, 0], [1, 0.72, 1]);
  mb.add(new THREE.CylinderGeometry(R + 1.3, R + 1.25, 0.18, 26), shade(cap, 0.8), [0, 0.4 + H - 0.1, zc]);
  // Spots on the cap.
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39;
    const el = 0.35 + (i % 4) * 0.28;
    const rr = (R + 1.3) * Math.cos(el);
    mb.sphere(0.34 - (i % 3) * 0.06, '#ffffff', [Math.cos(a) * rr, 0.4 + H - 0.1 + (R + 1.3) * 0.72 * Math.sin(el), zc + Math.sin(a) * rr], [1, 0.45, 1], 1);
  }
  door(mb, 0, front - 0.05, 1.05, 1.75, { ...o, door: '#8b5a3c' });
  for (const a of [-0.8, 0.8]) roundWindow(mb, Math.sin(a) * (R - 0.05), 1.9, zc + Math.cos(a) * (R - 0.05), 0.34, { ...o, trim: '#8b5a3c' }, a);
  mb.cyl(0.18, 0.2, 1.2, '#8f99a3', [R * 0.5, 0.4 + H + 1.3, zc - 0.6], undefined, 10);
  porch(mb, front - 0.1, 4.4);
  return { front: front - 0.1, hw: R + 0.4, hd: R + 0.4, zc, chimneys: [[R * 0.5, 0.4 + H + 1.95, zc - 0.6]], porchW: 4.4 };
}

function tall(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const W = 4.8, D = 4.2, H = 5.0, zc = -3.5, front = zc + D / 2;
  foundation(mb, W, D, zc);
  mb.box(W, H, D, o.wall, [0, 0.4 + H / 2, zc]);
  mb.box(W + 0.08, 0.14, D + 0.08, o.trim, [0, 0.4 + H / 2, zc]);
  for (let y = 0.8; y < H; y += 0.34) if (Math.abs(y - (0.4 + H / 2)) > 0.2) mb.box(W + 0.02, 0.035, D + 0.02, shade(o.wall, 0.94), [0, y, zc]);
  shingledGable(mb, W, D, 2.8, o.roof, o.wall, 0.4 + H + 0.05, zc);
  door(mb, 0, front, 1.1, 1.85, o);
  windowRect(mb, -1.5, 1.9, front + 0.02, 0.8, 0.9, o);
  windowRect(mb, 1.5, 1.9, front + 0.02, 0.8, 0.9, o);
  // Balcony upstairs.
  const by = 0.4 + H / 2 + 0.1;
  mb.box(3.2, 0.14, 1.0, WOOD, [0, by, front + 0.5]);
  for (let i = 0; i <= 8; i++) mb.box(0.06, 0.6, 0.06, '#ffffff', [-1.55 + i * 0.3875, by + 0.35, front + 0.95]);
  mb.box(3.2, 0.08, 0.08, '#ffffff', [0, by + 0.66, front + 0.95]);
  mb.box(1.0, 1.6, 0.12, o.door, [0, by + 0.85, front + 0.03]);
  mb.with({ glow: 1 }, () => mb.box(0.6, 0.8, 0.14, GLASS, [0, by + 1.1, front + 0.04]));
  roundWindow(mb, 0, 0.4 + H + 1.1, front + 0.06, 0.34, o);
  const chim = chimney(mb, -W * 0.25, zc - 0.5, 0.4 + H, 2.9, '#b35a4a');
  porch(mb, front, 4.6);
  return { front, hw: W / 2 + 0.3, hd: D / 2 + 0.3, zc, chimneys: [chim], porchW: 4.6 };
}

/** The town hall: columns, a clock tower and a flag. */
function hall(mb: ModelBuilder, o: HouseOpts): HouseResult {
  const W = 8.8, D = 5.2, H = 4.6, zc = -4.0, front = zc + D / 2;
  foundation(mb, W, D, zc);
  mb.box(W, H, D, o.wall, [0, 0.4 + H / 2, zc]);
  mb.box(W + 0.1, 0.16, D + 0.1, o.trim, [0, 0.4 + H / 2, zc]);
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) mb.box(0.3, H, 0.3, o.trim, [x, 0.4 + H / 2, front]);
  shingledGable(mb, W, D, 2.4, o.roof, o.wall, 0.4 + H + 0.05, zc);
  // Clock tower.
  const ty = 0.4 + H + 1.2;
  mb.box(2.4, 3.4, 2.4, o.wall, [0, ty + 1.7, zc + 0.2]);
  mb.box(2.6, 0.2, 2.6, o.trim, [0, ty + 3.45, zc + 0.2]);
  const pyr = new THREE.ConeGeometry(1, 1, 4);
  pyr.rotateY(Math.PI / 4);
  mb.add(pyr, o.roof, [0, ty + 4.6, zc + 0.2], [0, 0, 0], [2.1, 2.3, 2.1]);
  mb.add(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 24), '#ffffff', [0, ty + 2.1, zc + 1.42], [Math.PI / 2, 0, 0]);
  mb.add(new THREE.TorusGeometry(0.74, 0.07, 6, 24), '#e2b93b', [0, ty + 2.1, zc + 1.45]);
  mb.cyl(0.07, 0.07, 0.06, '#333333', [0, ty + 2.1, zc + 1.5], [Math.PI / 2, 0, 0], 10);
  mb.cyl(0.05, 0.05, 1.6, '#e8e8e8', [0, ty + 6.0, zc + 0.2], undefined, 6);
  mb.with({ sway: 1 }, () => mb.box(1.0, 0.6, 0.04, o.accent, [0.52, ty + 6.5, zc + 0.2]));
  // Portico.
  mb.box(4.4, 0.25, 2.6, '#f1ece2', [0, 0.52, front + 1.3]);
  for (const x of [-1.9, -0.65, 0.65, 1.9]) {
    mb.cyl(0.2, 0.22, 3.0, '#fbf7ef', [x, 0.65 + 1.5, front + 2.2], undefined, 12);
    mb.box(0.5, 0.15, 0.5, '#f1ece2', [x, 0.65 + 3.05, front + 2.2]);
  }
  const ped = new THREE.Shape();
  ped.moveTo(-2.4, 0);
  ped.lineTo(2.4, 0);
  ped.lineTo(0, 1.0);
  ped.closePath();
  mb.add(new THREE.ExtrudeGeometry(ped, { depth: 2.8, bevelEnabled: false }), '#fbf7ef', [0, 0.65 + 3.1, front - 0.2], [0, 0, 0]);
  mb.box(5.0, 0.12, 2.9, o.roof, [0, 0.65 + 3.12, front + 1.2]);
  door(mb, -0.5, front, 0.95, 2.1, o, false);
  door(mb, 0.5, front, 0.95, 2.1, o, false);
  for (const x of [-3.3, 3.3]) windowRect(mb, x, 1.8, front + 0.02, 1.0, 1.0, o);
  for (const x of [-3.3, -1.6, 1.6, 3.3]) windowRect(mb, x, 3.9, front + 0.02, 0.9, 0.9, o, false, false);
  // Steps.
  for (let i = 0; i < 3; i++) mb.box(3.2 - i * 0.2, 0.18, 0.5, '#e6dfd2', [0, 0.09 + i * 0.18, front + 2.9 - i * 0.35]);
  const chim = chimney(mb, W * 0.36, zc - 1.2, 0.4 + H, 2.3);
  return { front, hw: W / 2 + 0.3, hd: D / 2 + 0.3, zc, chimneys: [chim], porchW: 4.4, clock: [0, ty + 2.1, zc + 1.49] };
}

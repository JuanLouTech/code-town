import * as THREE from 'three';
import type { Building, Property, WorldState } from '../../../shared/protocol.ts';
import { ModelBuilder, upperHalfCylinderZ } from './builder.ts';
import { colorMat, curved, vertexMat } from './engine.ts';
import { DECOR, decor, fenceRun, type FenceStyle } from './decor.ts';
import { buildHouse, type HouseKind, type HouseOpts } from './houses.ts';
import { GATE_HALF, HALF, PITCH, frameToWorld, hashCell, lotSpots, plazaLayout, type LotFrame } from './layout.ts';
import { Farm, makeRockingChair, makeSign } from './props.ts';

export interface Collider { x: number; z: number; hw: number; hd: number }

const WALLS = ['#fff1d9', '#ffd9e2', '#d3ebff', '#dcf4d4', '#fff0b3', '#e9ddff', '#ffe0c2', '#fdf6ec', '#d8f3ee', '#ffe6f0'];
const ROOFS = ['#e0574f', '#4f86d9', '#4fae5a', '#a0663f', '#8f5fd0', '#f07f2c', '#2fa39b', '#d84f86', '#e8b128'];
const DOORS = ['#8b5a3c', '#5d7fa8', '#6d9c5a', '#b5523b', '#7b5ea7'];
const WOOD = '#b98553';
const WOOD_DARK = '#8a5a35';
const STONE = '#cfc6b8';
const GLASS = '#bfe6ff';
const FRAME = '#ffffff';

type V3 = [number, number, number];

function mesh(mb: ModelBuilder, shadows = true) {
  const m = new THREE.Mesh(mb.build(), vertexMat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

function window2(mb: ModelBuilder, x: number, y: number, z: number, w = 0.95, h = 0.95, rotY = 0) {
  mb.box(w + 0.18, h + 0.18, 0.1, FRAME, [x, y, z], [0, rotY, 0]);
  mb.box(w, h, 0.12, GLASS, [x, y, z + (rotY ? 0 : 0.01)], [0, rotY, 0]);
  mb.box(0.06, h, 0.14, FRAME, [x, y, z], [0, rotY, 0]);
  mb.box(w, 0.06, 0.14, FRAME, [x, y, z], [0, rotY, 0]);
}

function flowerBed(mb: ModelBuilder, x: number, z: number, w: number, seed: number) {
  mb.box(w, 0.25, 0.7, '#8a5b3b', [x, 0.12, z]);
  const colors = ['#ff7eb6', '#ffd94a', '#ffffff', '#ff6b6b', '#a78bfa', '#ff9f43'];
  for (let i = 0; i < Math.floor(w / 0.35); i++) {
    const fx = x - w / 2 + 0.25 + i * 0.35;
    mb.cyl(0.02, 0.02, 0.25, '#4fa83a', [fx, 0.35, z], undefined, 4);
    mb.sphere(0.11, colors[(seed + i) % colors.length], [fx, 0.5, z + ((i % 2) - 0.5) * 0.2], [1, 0.7, 1], 0);
  }
}

export function smallTree(mb: ModelBuilder, x: number, z: number, s = 1, fruit?: string) {
  mb.cyl(0.14 * s, 0.2 * s, 1.4 * s, '#8a5a35', [x, 0.7 * s, z], undefined, 7);
  mb.with({ sway: 1 }, () => {
    mb.sphere(0.95 * s, '#5fb548', [x, 1.9 * s, z], [1, 0.9, 1], 1, 0.08);
    mb.sphere(0.7 * s, '#6cc452', [x + 0.45 * s, 2.3 * s, z + 0.2 * s], 1, 1, 0.08);
    mb.sphere(0.65 * s, '#58ad43', [x - 0.45 * s, 2.2 * s, z - 0.1 * s], 1, 1, 0.08);
    if (fruit) {
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26;
        mb.sphere(0.13 * s, fruit, [x + Math.cos(a) * 0.8 * s, 1.9 * s + Math.sin(i * 2.1) * 0.35 * s, z + Math.sin(a) * 0.8 * s], 1, 0);
      }
    }
  });
}

export interface LotObjects {
  group: THREE.Group;
  colliders: Collider[];
  chairs: { pivot: THREE.Object3D; seat: number }[];
  farm?: Farm;
  mailbox?: { pos: THREE.Vector3; flag: THREE.Object3D };
  chimneys: THREE.Vector3[];
  house?: { mesh: THREE.Mesh; pos: THREE.Vector3; halfWidth: number };
  clock?: TowerClock;
}

/** The moving hands on a town hall's tower clock. */
export interface TowerClock { face: THREE.Object3D; hour: THREE.Object3D; minute: THREE.Object3D }

function clockHands(at: [number, number, number], mirrored: boolean): TowerClock {
  const face = new THREE.Group();
  face.position.set(...at);
  if (mirrored) face.scale.x = -1; // hands must still turn clockwise on mirrored lots
  const hand = (len: number, w: number, z: number) => {
    const g = new THREE.BoxGeometry(w, len, 0.03);
    g.translate(0, len / 2 - 0.07, 0); // pivot near one end
    const m = new THREE.Mesh(g, colorMat('#2b2522'));
    m.position.z = z;
    face.add(m);
    return m;
  };
  return { face, hour: hand(0.4, 0.09, 0.0), minute: hand(0.62, 0.055, 0.025) };
}

/** Points a clock's hands at the given time. */
export function setClock(c: TowerClock, h: number, m: number, s: number) {
  c.minute.rotation.z = -((m + s / 60) / 60) * Math.PI * 2;
  c.hour.rotation.z = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
}

const KINDS: HouseKind[] = ['cottage', 'cabin', 'barn', 'tower', 'mushroom', 'tall', 'cottage'];
const ACCENTS = ['#5b8fd9', '#58b368', '#e0645c', '#9b6fd1', '#f2a516', '#3fa7a0', '#d65c8a'];
const FENCES: FenceStyle[] = ['picket', 'rail', 'stone', 'hedge', 'bamboo', 'picket', 'rail'];

function seeded(seed: number, shift: number, n: number) {
  return ((seed >>> shift) ^ (seed >>> (shift + 11))) % n;
}

/**
 * One lot: a house (six styles, plus the clock-tower town hall), porch and
 * seats, a farm, fence, mailbox, sign and a few yard decorations. Built in
 * lot-local space and placed through the lot's frame (offset, tilt, mirror).
 */
export function buildLot(b: Building | undefined, property: Property, frame: LotFrame): LotObjects {
  const group = new THREE.Group();
  group.position.set(frame.cx + frame.ox, 0, frame.cz + frame.oz);
  group.rotation.y = frame.angle;
  if (frame.mirror) group.scale.x = -1;
  const colliders: Collider[] = [];
  const chairs: LotObjects['chairs'] = [];
  const chimneys: THREE.Vector3[] = [];
  const mb = new ModelBuilder();
  const cos = Math.abs(Math.cos(frame.angle)), sin = Math.abs(Math.sin(frame.angle));
  const collide = (x: number, z: number, hw: number, hd: number) => {
    const w = frameToWorld(frame, x, z);
    colliders.push({ x: w.x, z: w.z, hw: hw * cos + hd * sin, hd: hw * sin + hd * cos });
  };
  const unmirror = (o: THREE.Object3D) => {
    if (frame.mirror) o.scale.x *= -1;
    return o;
  };
  const town = property.kind === 'town';
  const pseed = b ? b.style : hashCell(frame.cx, frame.cz);
  const propSeed = property.buildings[0]?.style ?? pseed;
  const fence: FenceStyle = town ? (seeded(propSeed, 2, 2) ? 'hedge' : 'stone') : FENCES[seeded(propSeed, 4, FENCES.length)];

  // Fence with an opening at the front.
  const edge = HALF - 0.3;
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    fenceRun(mb, fence, x0, z0, x1, z1, pseed);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    collide((x0 + x1) / 2, (z0 + z1) / 2, alongX ? Math.abs(x1 - x0) / 2 : 0.35, alongX ? 0.35 : Math.abs(z1 - z0) / 2);
  };
  run(-edge, -edge, edge, -edge);
  run(-edge, -edge, -edge, edge);
  run(edge, -edge, edge, edge);
  run(-edge, edge, -GATE_HALF, edge);
  run(GATE_HALF, edge, edge, edge);
  for (const x of [-GATE_HALF, GATE_HALF]) {
    mb.cyl(0.14, 0.16, 1.3, WOOD_DARK, [x, 0.65, edge], undefined, 8);
    mb.sphere(0.18, '#f2c94c', [x, 1.35, edge], 1, 1);
  }

  if (!b) {
    for (const [x, z] of [[-3, -3], [3, -3], [3, 2], [-3, 2]] as const) mb.box(0.12, 0.7, 0.12, WOOD, [x, 0.35, z]);
    mb.box(6, 0.04, 0.04, '#e8c07a', [0, 0.6, -3]).box(6, 0.04, 0.04, '#e8c07a', [0, 0.6, 2]);
    mb.box(0.04, 0.04, 5, '#e8c07a', [-3, 0.6, -0.5]).box(0.04, 0.04, 5, '#e8c07a', [3, 0.6, -0.5]);
    decor(mb, 'wheelbarrow', -4.5, 4.5, pseed);
    group.add(mesh(mb));
    const sign = unmirror(makeSign('Vacant lot', { sub: 'ask the builder!', width: 2.6, height: 0.9 }));
    sign.position.set(3.6, 0, 6.6);
    group.add(sign);
    return { group, colliders, chairs, chimneys };
  }

  const main = b.role === 'main';
  const kind: HouseKind = main ? 'hall' : KINDS[seeded(b.style, 9, KINDS.length)];
  const opts: HouseOpts = {
    wall: WALLS[seeded(b.style, 0, WALLS.length)],
    roof: ROOFS[seeded(b.style, 3, ROOFS.length)],
    trim: '#ffffff',
    door: DOORS[seeded(b.style, 6, DOORS.length)],
    accent: ACCENTS[seeded(b.style, 13, ACCENTS.length)],
    seed: b.style,
  };
  // Houses sit a little off-centre and turned, each in its own way.
  const hx = main ? 0 : (seeded(b.style, 15, 5) - 2) * 0.22;
  const hrot = main ? 0 : (seeded(b.style, 17, 7) - 3) * 0.025;
  const hb = new ModelBuilder();
  const house = buildHouse(hb, kind, opts);
  const houseMesh = mesh(hb);
  houseMesh.position.x = hx;
  houseMesh.rotation.y = hrot;
  group.add(houseMesh);
  collide(hx, house.zc, house.hw, house.hd);
  for (const c of house.chimneys) {
    const cw = frameToWorld(frame, hx + c[0], c[2]);
    chimneys.push(new THREE.Vector3(cw.x, c[1], cw.z));
  }

  // Stepping stones from the gate to the porch.
  for (let z = house.front + 3.1; z < HALF - 0.4; z += 0.95) {
    mb.cyl(0.42, 0.46, 0.08, '#e3dccf', [Math.sin(z * 2 + pseed) * 0.2, 0.04, z], undefined, 9);
  }
  // Grass tufts and flowers along the inside of the fence.
  mb.with({ sway: 0.8 }, () => {
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      const side = i % 4;
      const x = side < 2 ? -edge + 0.6 + t * (2 * edge - 1.2) : (side === 2 ? -edge + 0.5 : edge - 0.5);
      const z = side === 0 ? -edge + 0.5 : side === 1 ? -edge + 0.9 : -edge + 1 + t * 5;
      if (i % 3 === 0) mb.sphere(0.1, ['#ff7eb6', '#ffd94a', '#ffffff', '#a78bfa'][(i + pseed) % 4], [x, 0.35, z], [1, 0.6, 1], 0);
      mb.cone(0.08, 0.35, '#6cbf4e', [x + 0.1, 0.17, z], [0, 0, 0.3], 3);
    }
  });

  // Mailbox: its flag goes up while this house's terminal is open.
  const mailX = 1.9, mailZ = HALF - 0.9;
  mb.box(0.1, 1.0, 0.1, WOOD_DARK, [mailX, 0.5, mailZ]);
  mb.box(0.42, 0.36, 0.58, opts.door, [mailX, 1.15, mailZ]);
  mb.add(upperHalfCylinderZ(0.21, 0.58, 12), opts.door, [mailX, 1.33, mailZ]);
  collide(mailX, mailZ, 0.3, 0.3);
  const flag = new THREE.Group();
  flag.position.set(mailX + 0.23, 1.08, mailZ - 0.15);
  const flagMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.14), colorMat('#e8423b'));
  flagMesh.position.set(0, 0.17, 0.05);
  flag.add(flagMesh);
  flag.rotation.x = -Math.PI / 2;
  group.add(flag);
  const mailbox = { pos: frameToWorld(frame, mailX, mailZ), flag };

  // Garden: a tree and a flower bed on each side of the house, then a couple of decorations.
  const fruit = ['#e8423b', '#f28c28', '#ffd94a', undefined][seeded(b.style, 20, 4)];
  smallTree(mb, -6.3, -6.2, 0.95, fruit);
  smallTree(mb, 6.3, -6.2, 0.9);
  collide(-6.3, -6.2, 0.35, 0.35);
  collide(6.3, -6.2, 0.35, 0.35);
  if (!main) flowerBed(mb, 4.4, -1.9, 1.5, b.style);
  const pool = [...DECOR];
  const slots: [number, number][] = main ? [[6.2, -3.2]] : [[5.6, -4.0], [-5.4, -3.6], [6.3, 1.8]];
  for (let i = 0; i < slots.length; i++) {
    if (seeded(b.style, 22 + i, 5) === 0) continue; // some yards stay tidy
    const k = pool.splice(seeded(b.style, 7 + i * 5, pool.length), 1)[0];
    const [dx, dz] = slots[i];
    const r = decor(mb, k, dx, dz, b.style + i);
    collide(dx, dz, r * 0.8, r * 0.8);
  }

  // Seats: rocking chair on the porch; the town hall also gets a bench and a stump.
  const spots = lotSpots(b.role);
  const chair = makeRockingChair();
  chair.position.set(spots.seats[0].x, 0.25, spots.seats[0].z - 0.05);
  chair.rotation.y = spots.seats[0].face;
  group.add(chair);
  chairs.push({ pivot: chair.children[0], seat: 0 });
  if (main) {
    const deck = spots.seats[0];
    mb.box(1.7, 0.25, 1.7, WOOD, [deck.x, 0.13, deck.z - 0.05]);
    const bench = spots.seats[1];
    mb.box(1.8, 0.1, 0.55, WOOD, [bench.x, 0.5, bench.z - 0.1], [0, bench.face, 0]);
    mb.box(1.8, 0.5, 0.08, WOOD, [bench.x, 0.85, bench.z - 0.4], [0, bench.face, 0]);
    for (const dx of [-0.75, 0.75]) mb.box(0.1, 0.5, 0.5, WOOD_DARK, [bench.x + dx, 0.25, bench.z - 0.1]);
    const stump = spots.seats[2];
    mb.cyl(0.42, 0.5, 0.5, '#9a6b43', [stump.x, 0.25, stump.z - 0.1], undefined, 10);
    mb.cyl(0.36, 0.36, 0.02, '#e7c99a', [stump.x, 0.51, stump.z - 0.1], undefined, 10);
  }

  group.add(mesh(mb));

  const farm = new Farm(b.style >>> 5);
  group.add(farm.group);

  const sign = unmirror(makeSign(b.name.split('/').pop()!, {
    sub: main ? (town ? 'town hall' : undefined) : b.isRepo ? 'git repo' : 'folder',
    width: main ? 3.6 : 3.0,
    height: 1.0,
  }));
  sign.position.set(spots.sign.x, 0, spots.sign.z);
  group.add(sign);
  collide(spots.sign.x, spots.sign.z, 0.25, 0.25);

  let clock: TowerClock | undefined;
  if (house.clock) {
    clock = clockHands(house.clock, frame.mirror);
    houseMesh.add(clock.face);
  }

  const house_ = { mesh: houseMesh, pos: frameToWorld(frame, hx, house.zc), halfWidth: house.hw };
  return { group, colliders, chairs, farm, mailbox, chimneys, house: house_, clock };
}

/** The big standing sign that marks a town (a folder holding several repos). */
export function buildTownSign(property: Property, mainCenter: THREE.Vector3) {
  const repos = property.buildings.filter((b) => b.role === 'child').length;
  const sign = makeSign(property.name, { sub: `${repos} repos`, width: 5.2, height: 1.4, posts: 2, bg: '#fff6dc' });
  sign.position.set(mainCenter.x - 5.2, 0, mainCenter.z + PITCH / 2 + 1.5);
  const colliders: Collider[] = [
    { x: mainCenter.x - 5.2 - 2.35, z: mainCenter.z + PITCH / 2 + 1.44, hw: 0.2, hd: 0.2 },
    { x: mainCenter.x - 5.2 + 2.35, z: mainCenter.z + PITCH / 2 + 1.44, hw: 0.2, hd: 0.2 },
  ];
  return { sign, colliders };
}

// --- Plaza ---------------------------------------------------------------------------

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#dcc39a';
  ctx.fillRect(0, 0, 256, 256);
  const tones = ['#f6e7c9', '#f1dfbd', '#f8ecd4', '#eed9b3'];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = tones[(x * 3 + y * 5) % tones.length];
      const r = 10;
      const px = x * 64 + 3, py = y * 64 + 3, w = 58;
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + w, py, px + w, py + w, r);
      ctx.arcTo(px + w, py + w, px, py + w, r);
      ctx.arcTo(px, py + w, px, py, r);
      ctx.arcTo(px, py, px + w, py, r);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export function buildPlaza(world: WorldState) {
  const L = plazaLayout(world);
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const collide = (x: number, z: number, hw: number, hd: number) => colliders.push({ x, z, hw, hd });

  // Tiled floor and a mosaic of rings around the fountain.
  {
    const b = L.bounds;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const tex = tileTexture();
    tex.repeat.set(w / 4.8, d / 4.8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), curved(new THREE.MeshLambertMaterial({ map: tex })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.minX + b.maxX) / 2, 0.015, (b.minZ + b.maxZ) / 2);
    floor.receiveShadow = true;
    group.add(floor);
    const mm = new ModelBuilder();
    const rings = 5, segs = 20;
    for (let r = 0; r < rings; r++) {
      for (let k = 0; k < segs; k++) {
        const g = new THREE.RingGeometry(3.7 + r * 1.15, 3.7 + (r + 1) * 1.15 - 0.1, 3, 1, (k / segs) * Math.PI * 2 + 0.02, (Math.PI * 2) / segs - 0.04);
        g.rotateX(-Math.PI / 2);
        mm.add(g, (r + k) % 2 ? '#7fd0c6' : r === rings - 1 ? '#f6b26b' : '#fff4de', [L.fountain.x, 0.03, L.fountain.z]);
      }
    }
    const mosaic = new THREE.Mesh(mm.build(), vertexMat);
    mosaic.receiveShadow = true;
    group.add(mosaic);
  }

  // Hiring office: a cosy striped marquee with a reception counter.
  {
    const o = L.hiring;
    const mb = new ModelBuilder();
    mb.box(9.4, 0.4, 5.8, STONE, [0, 0.2, 0]);
    mb.box(9, 3.4, 5.4, '#fff6e6', [0, 2.1, 0]);
    mb.add(new THREE.CylinderGeometry(2.9, 2.9, 9.6, 20, 1, false, 0, Math.PI), '#3fa7a0', [0, 3.8, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 8; i++) {
      mb.box(1.2, 0.12, 1.9, i % 2 ? '#ffffff' : '#e8645c', [-4.2 + i * 1.2, 3.1, 3.4], [0.38, 0, 0]);
    }
    mb.box(1.5, 2.3, 0.14, '#8b5a3c', [2.6, 1.55, 2.72]);
    mb.box(1.8, 2.5, 0.1, '#ffffff', [2.6, 1.6, 2.7]);
    mb.with({ glow: 1 }, () => window2(mb, -2.9, 2.1, 2.72, 1.3, 1.1));
    // Counter.
    mb.box(3.2, 1.1, 0.9, '#c89b6d', [-1.2, 0.55, 4.7]);
    mb.box(3.4, 0.12, 1.1, '#8a5a35', [-1.2, 1.16, 4.7]);
    mb.box(0.5, 0.12, 0.35, '#ffffff', [-2.2, 1.28, 4.6]);
    mb.cyl(0.08, 0.1, 0.25, '#e8645c', [-0.2, 1.32, 4.6], undefined, 8);
    // Job board.
    mb.box(0.12, 2.2, 0.12, WOOD_DARK, [-5.2, 1.1, 3.6]).box(0.12, 2.2, 0.12, WOOD_DARK, [-3.4, 1.1, 3.6]);
    mb.box(2.1, 1.3, 0.1, '#c89b6d', [-4.3, 1.75, 3.6]);
    for (let i = 0; i < 4; i++) mb.box(0.55, 0.45, 0.02, ['#fff9c4', '#ffe0e6', '#e0f0ff', '#e3f6e3'][i], [-4.75 + (i % 2) * 0.9, 1.95 - Math.floor(i / 2) * 0.55, 3.66]);
    // Crates.
    mb.box(0.9, 0.9, 0.9, '#c89b6d', [4.2, 0.45, 3.8]).box(0.7, 0.7, 0.7, '#b98553', [4.3, 1.25, 3.7], [0, 0.4, 0]);
    const m = mesh(mb);
    m.position.copy(o);
    group.add(m);
    const sign = makeSign('Hiring Office', { sub: 'extra hands for any farm', width: 4.6, height: 1.2, posts: 0, bg: '#fff9e8' });
    sign.position.set(o.x - 1.2, 3.6, o.z + 2.9);
    sign.scale.setScalar(0.9);
    group.add(sign);
    collide(o.x, o.z, 4.8, 3.0);
    collide(o.x - 1.2, o.z + 4.7, 1.7, 0.55);
    collide(o.x - 4.3, o.z + 3.6, 1.1, 0.3);
    collide(o.x + 4.25, o.z + 3.8, 0.55, 0.55);
  }

  // Construction office with scaffolding and a crane.
  {
    const o = L.construction;
    const mb = new ModelBuilder();
    mb.box(8.4, 0.4, 5.6, STONE, [0, 0.2, 0]);
    mb.box(8, 3.6, 5.2, '#ffe9b8', [0, 2.2, 0]);
    mb.gable(8, 5.2, 2.0, '#6d7f99', '#ffe9b8', 4.1);
    mb.box(1.4, 2.2, 0.14, '#6d7f99', [-2.2, 1.5, 2.62]);
    mb.with({ glow: 1 }, () => window2(mb, 1.8, 2.2, 2.62, 1.5, 1.1));
    // Scaffolding on the right.
    for (const x of [4.4, 6.2]) for (const z of [-2, 2]) mb.box(0.1, 5.5, 0.1, '#9aa5ad', [x, 2.75, z]);
    for (const y of [1.8, 3.6, 5.3]) {
      mb.box(2.0, 0.12, 4.2, '#c89b6d', [5.3, y, 0]);
    }
    // Crane.
    mb.box(0.5, 9, 0.5, '#f2b233', [-4.8, 4.5, -2.2]);
    mb.box(7, 0.4, 0.4, '#f2b233', [-2.5, 9, -2.2]);
    mb.box(0.04, 3, 0.04, '#555555', [0.6, 7.5, -2.2]);
    mb.box(0.8, 0.5, 0.8, '#9aa5ad', [0.6, 5.8, -2.2]);
    // Blueprint table, planks, cones.
    mb.box(2.2, 0.1, 1.2, '#8a5a35', [0, 1.0, 5.4]).box(2.0, 0.02, 1.0, '#3d6fb6', [0, 1.06, 5.4]);
    for (const [x, z] of [[-0.9, 4.95], [0.9, 4.95], [-0.9, 5.85], [0.9, 5.85]] as const) mb.box(0.1, 1.0, 0.1, WOOD_DARK, [x, 0.5, z]);
    for (let i = 0; i < 4; i++) mb.box(3.2, 0.14, 0.4, '#d9ae7b', [-3.6, 0.07 + i * 0.15, 4.4 + (i % 2) * 0.05]);
    for (const x of [2.6, 3.4, 4.2]) {
      mb.cone(0.28, 0.7, '#ff7b29', [x, 0.35, 4.6], undefined, 10);
      mb.cyl(0.2, 0.22, 0.08, '#ffffff', [x, 0.42, 4.6], undefined, 10);
    }
    const m = mesh(mb);
    m.position.copy(o);
    group.add(m);
    const sign = makeSign('Construction', { sub: 'new folders & repos', width: 4.2, height: 1.2, posts: 0, bg: '#fff3c4' });
    sign.position.set(o.x - 0.2, 2.15, o.z + 2.72); // on the wall, under the eaves
    sign.scale.setScalar(0.9);
    group.add(sign);
    collide(o.x + 1, o.z, 5.4, 2.9);
    collide(o.x - 4.8, o.z - 2.2, 0.4, 0.4);
    collide(o.x, o.z + 5.4, 1.2, 0.7);
    collide(o.x - 3.6, o.z + 4.4, 1.7, 0.4);
  }

  // Fountain.
  {
    const o = L.fountain;
    const mb = new ModelBuilder();
    mb.cyl(3.4, 3.6, 0.8, '#d8d2c6', [0, 0.4, 0], undefined, 24);
    mb.cyl(3.0, 3.0, 0.1, '#6fd3e6', [0, 0.72, 0], undefined, 24);
    mb.cyl(0.5, 0.7, 2.2, '#d8d2c6', [0, 1.4, 0], undefined, 12);
    mb.cyl(1.3, 0.9, 0.35, '#d8d2c6', [0, 2.5, 0], undefined, 16);
    mb.cyl(1.1, 1.1, 0.06, '#8fe3f0', [0, 2.66, 0], undefined, 16);
    mb.sphere(0.35, '#bff0ff', [0, 3.0, 0], [1, 1.4, 1], 1);
    const m = mesh(mb);
    m.position.copy(o);
    group.add(m);
    collide(o.x, o.z, 3.4, 3.4);
    // Benches around it.
    const bm = new ModelBuilder();
    for (const [x, z, r] of [[-6.5, 0, Math.PI / 2], [6.5, 0, -Math.PI / 2]] as const) {
      bm.box(0.55, 0.1, 2, WOOD, [x, 0.5, z]);
      bm.box(0.08, 0.5, 2, WOOD, [x + (x < 0 ? -0.28 : 0.28), 0.85, z]);
      for (const dz of [-0.8, 0.8]) bm.box(0.5, 0.5, 0.1, WOOD_DARK, [x, 0.25, z + dz]);
      collide(o.x + x, o.z + z, 0.4, 1.0);
      void r;
    }
    const b = mesh(bm);
    b.position.copy(o);
    group.add(b);
  }

  // Lamp posts, flower beds and trees around the square.
  {
    const mb = new ModelBuilder();
    const bb = L.bounds;
    const lamps: [number, number][] = [
      [bb.minX + 2, bb.maxZ - 2], [bb.maxX - 2, bb.maxZ - 2], [L.center.x - 6, L.center.z + 7], [L.center.x + 6, L.center.z + 7],
    ];
    for (const [x, z] of lamps) {
      mb.cyl(0.1, 0.14, 3.2, '#4a5560', [x, 1.6, z], undefined, 8);
      mb.with({ glow: 1 }, () => mb.box(0.5, 0.5, 0.5, '#fff4c2', [x, 3.4, z]));
      mb.cone(0.45, 0.4, '#4a5560', [x, 3.85, z], [0, Math.PI / 4, 0], 4);
      collide(x, z, 0.2, 0.2);
    }
    // Bunting between the lamps.
    const flagColors = ['#ff7eb6', '#ffd94a', '#7ec4ff', '#95e1a4', '#ff9f43', '#c3a6ff'];
    const strings: [number, number, number, number][] = [
      [lamps[2][0], lamps[2][1], lamps[3][0], lamps[3][1]],
      [lamps[0][0], lamps[0][1], lamps[2][0], lamps[2][1]],
      [lamps[3][0], lamps[3][1], lamps[1][0], lamps[1][1]],
    ];
    mb.with({ sway: 1.6 }, () => {
      for (const [x0, z0, x1, z1] of strings) {
        const n = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.9));
        const rotY = -Math.atan2(z1 - z0, x1 - x0);
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const sag = Math.sin(t * Math.PI) * 0.6;
          const flag = new THREE.ConeGeometry(0.22, 0.45, 3);
          flag.rotateX(Math.PI);
          mb.add(flag, flagColors[i % flagColors.length], [x0 + (x1 - x0) * t, 3.3 - sag, z0 + (z1 - z0) * t], [0, rotY, 0], [1, 1, 0.15]);
        }
      }
    });
    // Notice board and a little fruit stall.
    const nb = [L.center.x - 7.5, L.center.z - 1.5];
    mb.box(0.14, 1.9, 0.14, WOOD_DARK, [nb[0] - 1, 0.95, nb[1]]).box(0.14, 1.9, 0.14, WOOD_DARK, [nb[0] + 1, 0.95, nb[1]]);
    mb.box(2.3, 1.3, 0.12, '#c89b6d', [nb[0], 1.55, nb[1]]);
    for (let i = 0; i < 5; i++) mb.box(0.5, 0.42, 0.02, ['#fff9c4', '#ffe0e6', '#e0f0ff', '#e3f6e3', '#f1ebff'][i], [nb[0] - 0.8 + (i % 3) * 0.8, 1.75 - Math.floor(i / 3) * 0.55, nb[1] + 0.08]);
    mb.gable(2.4, 0.5, 0.3, '#a0714f', '#a0714f', 2.25, 0.15, nb[0], nb[1]);
    collide(nb[0], nb[1], 1.2, 0.3);
    const st = [L.center.x + 8, L.center.z + 3];
    mb.box(2.6, 0.9, 1.1, '#c89b6d', [st[0], 0.45, st[1]]);
    for (const dx of [-1.2, 1.2]) mb.box(0.1, 2.3, 0.1, WOOD_DARK, [st[0] + dx, 1.15, st[1] - 0.45]);
    for (let i = 0; i < 6; i++) mb.box(0.44, 0.12, 1.5, i % 2 ? '#ffffff' : '#58b368', [st[0] - 1.1 + i * 0.44, 2.35, st[1] + 0.05], [0.35, 0, 0]);
    for (let i = 0; i < 9; i++) mb.sphere(0.16, ['#e8423b', '#f28c28', '#ffd94a'][i % 3], [st[0] - 0.9 + (i % 5) * 0.45, 1.0, st[1] - 0.1 + Math.floor(i / 5) * 0.3], 1, 0);
    collide(st[0], st[1], 1.4, 0.7);
    flowerBed(mb, L.center.x - 9, L.center.z + 12, 3, 1);
    flowerBed(mb, L.center.x + 9, L.center.z + 12, 3, 4);
    for (const [x, z] of [[bb.minX + 3, bb.minZ + 3], [bb.maxX - 3, bb.minZ + 3], [L.center.x - 4, bb.minZ + 2.5], [L.center.x + 4, bb.minZ + 2.5]] as const) {
      smallTree(mb, x, z, 1.2, (x > 0 ? '#f28c28' : '#e8423b'));
      collide(x, z, 0.4, 0.4);
    }
    // Welcome board next to the spawn point (low, so it never hides the player).
    const a = L.arch;
    for (const dx of [-2.2, 2.2]) collide(a.x + dx, a.z, 0.3, 0.3);
    for (const dx of [-4.4, 4.4]) flowerBed(mb, a.x + dx * 1.35, a.z + 0.2, 1.6, dx > 0 ? 2 : 5);
    group.add(mesh(mb));
    const title = makeSign('Code Town', { sub: 'welcome to the island!', width: 4.6, height: 1.3, bg: '#fff9e8', posts: 2 });
    title.position.set(a.x, 0, a.z);
    group.add(title);
  }

  return { group, colliders, layout: L };
}

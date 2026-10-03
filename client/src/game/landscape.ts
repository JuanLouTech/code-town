import * as THREE from 'three';
import type { WorldState } from '../../../shared/protocol.ts';
import { ModelBuilder } from './builder.ts';
import type { Collider } from './buildings.ts';
import { beachUmbrella, landmark, lighthouse, pier, type Landmark } from './decor.ts';
import { curve, curved, vertexMat, world as shaderWorld } from './engine.ts';
import { PITCH, hashCell, nearReserved, plazaLayout, type IslandShape, type Occupancy } from './layout.ts';

export interface Pond { x: number; z: number; r: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export interface LandscapePlan {
  ponds: Pond[];
  spots: { kind: Landmark; x: number; z: number; seed: number }[];
  pier: { x: number; z: number; len: number };
  lighthouse?: { x: number; z: number };
  umbrellas: { x: number; z: number; seed: number }[];
  /** Areas nature shouldn't fill (landmarks). */
  clear: { x: number; z: number; r: number }[];
  /** Extra walkable ground over water (the pier). */
  walk: Rect[];
}

const ORDER: Landmark[] = ['pond', 'windmill', 'flowerfield', 'campsite', 'bigtree', 'orchard', 'pond', 'picnic', 'ruins', 'flowerfield', 'bigtree'];
const RADIUS: Record<Landmark, number> = {
  pond: 6.2, windmill: 3.5, flowerfield: 5, campsite: 3.6, bigtree: 3.8, orchard: 5, picnic: 2.8, ruins: 3.4,
};

function nearLots(occ: Occupancy, x: number, z: number, margin: number) {
  for (const [key] of occ.lots) {
    const [gx, gz] = key.split(',').map(Number);
    if (Math.abs(x - gx * PITCH) < PITCH / 2 + margin && Math.abs(z - gz * PITCH) < PITCH / 2 + margin) return true;
  }
  return nearReserved(occ, x, z, margin);
}

/** Decides where ponds, landmarks and beach props go. Deterministic for a given layout. */
export function planLandscape(world: WorldState, occ: Occupancy, shape: IslandShape): LandscapePlan {
  const { sdf } = shape;
  const b = occ.bounds;
  const candidates: { x: number; z: number; score: number }[] = [];
  // Holes inside the town grid first (they break up the rows of houses best)…
  for (let gz = Math.round(b.minZ / PITCH); gz <= Math.round(b.maxZ / PITCH); gz++) {
    for (let gx = Math.round(b.minX / PITCH); gx <= Math.round(b.maxX / PITCH); gx++) {
      const x = gx * PITCH, z = gz * PITCH;
      if (occ.lots.has(`${gx},${gz}`) || nearLots(occ, x, z, -PITCH / 2 + 2)) continue;
      if (sdf(x, z) > -10) continue;
      candidates.push({ x, z, score: 0 + (hashCell(gx, gz) % 100) / 1000 });
    }
  }
  // …then a ring around the settled area.
  const ring = 12;
  const perimeter: [number, number][] = [];
  for (let x = b.minX; x <= b.maxX; x += 13) perimeter.push([x, b.minZ - ring], [x, b.maxZ + ring]);
  for (let z = b.minZ; z <= b.maxZ; z += 13) perimeter.push([b.minX - ring, z], [b.maxX + ring, z]);
  for (const [x, z] of perimeter) {
    if (sdf(x, z) > -9 || nearLots(occ, x, z, 5)) continue;
    candidates.push({ x, z, score: 1 + (hashCell(Math.round(x), Math.round(z)) % 100) / 1000 });
  }
  candidates.sort((a, c) => a.score - c.score);

  const spots: LandscapePlan['spots'] = [];
  const ponds: Pond[] = [];
  const clear: LandscapePlan['clear'] = [];
  let k = 0;
  for (const c of candidates) {
    if (spots.length >= 9) break;
    const kind = ORDER[k % ORDER.length];
    const r = RADIUS[kind];
    if (spots.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < RADIUS[s.kind] + r + 6)) continue;
    if (nearLots(occ, c.x, c.z, r - PITCH / 2 + 3) && c.score >= 1) continue;
    const seed = hashCell(Math.round(c.x), Math.round(c.z));
    spots.push({ kind, x: c.x, z: c.z, seed });
    clear.push({ x: c.x, z: c.z, r: r + 1.5 });
    if (kind === 'pond') ponds.push({ x: c.x, z: c.z, r: 5.2 });
    k++;
  }

  // The pier goes out to sea straight south of the plaza.
  const L = plazaLayout(world);
  let pz = L.bounds.maxZ;
  while (sdf(L.center.x, pz) < 0.4 && pz < shape.bounds.maxZ) pz += 0.5;
  const pierPlan = { x: L.center.x + 6, z: pz - 4.5, len: 14 };
  clear.push({ x: pierPlan.x, z: pierPlan.z, r: 4 });

  // Lighthouse on the eastern shore.
  let lx = b.maxX;
  const lzc = (b.minZ + b.maxZ) / 2;
  while (sdf(lx, lzc) < -4 && lx < shape.bounds.maxX) lx += 0.5;
  const lh = sdf(lx, lzc) < 0 ? { x: lx, z: lzc } : undefined;
  if (lh) clear.push({ x: lh.x, z: lh.z, r: 3 });

  const umbrellas: LandscapePlan['umbrellas'] = [];
  for (const dx of [-20, -11, 16]) {
    const x = L.center.x + dx;
    let z = L.bounds.maxZ;
    while (sdf(x, z) < -3.2 && z < shape.bounds.maxZ) z += 0.5;
    if (sdf(x, z) < 0 && !nearLots(occ, x, z, 2)) {
      umbrellas.push({ x, z, seed: umbrellas.length });
      clear.push({ x, z, r: 2.5 });
    }
  }

  return {
    ponds, spots, pier: pierPlan, lighthouse: lh, umbrellas, clear,
    walk: [{ minX: pierPlan.x - 1.1, maxX: pierPlan.x + 1.1, minZ: pierPlan.z - 1, maxZ: pierPlan.z + pierPlan.len }],
  };
}

export interface Landscape {
  group: THREE.Group;
  colliders: Collider[];
  sails: THREE.Object3D[];
  fires: THREE.Vector3[];
  pondWater: THREE.ShaderMaterial | undefined;
}

export function buildLandscape(plan: LandscapePlan): Landscape {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const sails: THREE.Object3D[] = [];
  const fires: THREE.Vector3[] = [];
  const mb = new ModelBuilder();
  for (const s of plan.spots) {
    const res = landmark(mb, s.kind, s.x, s.z, s.seed);
    for (const [x, z, r] of res.colliders) colliders.push({ x, z, hw: r, hd: r });
    if (s.kind === 'windmill') {
      const sb = new ModelBuilder();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        sb.box(0.25, 3.6, 0.08, '#8a5a35', [Math.sin(a) * 1.8, Math.cos(a) * 1.8, 0], [0, 0, -a]);
        sb.box(0.9, 3.0, 0.04, '#fffaf0', [Math.sin(a) * 2.0 + Math.cos(a) * 0.5, Math.cos(a) * 2.0 - Math.sin(a) * 0.5, 0.03], [0, 0, -a]);
      }
      sb.cyl(0.3, 0.3, 0.4, '#8a5a35', [0, 0, 0], [Math.PI / 2, 0, 0], 10);
      const m = new THREE.Mesh(sb.build(), vertexMat);
      m.castShadow = true;
      m.position.set(s.x, 5.2, s.z + 2.05);
      group.add(m);
      sails.push(m);
    }
    if (s.kind === 'campsite') fires.push(new THREE.Vector3(s.x + 1.1, 0.3, s.z + 0.4));
  }
  pier(mb, plan.pier.x, plan.pier.z, plan.pier.len);
  if (plan.lighthouse) {
    lighthouse(mb, plan.lighthouse.x, plan.lighthouse.z);
    colliders.push({ x: plan.lighthouse.x, z: plan.lighthouse.z, hw: 1.4, hd: 1.4 });
  }
  for (const u of plan.umbrellas) beachUmbrella(mb, u.x, u.z, u.seed);
  if (!mb.isEmpty()) {
    const m = new THREE.Mesh(mb.build(), vertexMat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  for (const p of plan.ponds) colliders.push({ x: p.x, z: p.z, hw: p.r * 0.72, hd: p.r * 0.55 });

  // Pond water: a gently animated disc with a foamy rim.
  let pondWater: THREE.ShaderMaterial | undefined;
  if (plan.ponds.length) {
    pondWater = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uCurve: curve, uTime: shaderWorld.uTime, uNight: shaderWorld.uNight },
      vertexShader: /* glsl */ `
        uniform float uCurve;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          mv.y -= uCurve * mv.z * mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNight;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          if (d > 1.0) discard;
          vec3 col = mix(vec3(0.33, 0.78, 0.86), vec3(0.18, 0.55, 0.72), smoothstep(0.2, 0.9, 1.0 - d));
          float n = sin(vWorld.x * 1.3 + uTime * 1.2) * sin(vWorld.z * 1.1 - uTime);
          col += smoothstep(0.85, 1.0, n) * 0.25;
          float rim = smoothstep(0.82, 0.98, d) * (0.6 + 0.4 * sin(uTime * 2.0 + d * 20.0));
          col = mix(col, vec3(1.0), rim * 0.6);
          col *= mix(vec3(1.0), vec3(0.45, 0.55, 0.85), uNight);
          gl_FragColor = vec4(col, 0.85);
        }`,
    });
    for (const p of plan.ponds) {
      const g = new THREE.PlaneGeometry(p.r * 2, p.r * 1.6);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, pondWater);
      m.position.set(p.x, -0.22, p.z);
      m.renderOrder = 1;
      group.add(m);
    }
  }
  void curved;
  return { group, colliders, sails, fires, pondWater };
}

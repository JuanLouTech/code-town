import * as THREE from 'three';
import type { WorldState } from '../../../shared/protocol.ts';
import { curve, curved } from './engine.ts';
import { HALF, PITCH, blockBounds, cellOf, reservedCell, type IslandShape, type Occupancy } from './layout.ts';
import type { Pond } from './landscape.ts';

const C = {
  grass: new THREE.Color('#7fcf5a'),
  grassDark: new THREE.Color('#68bb49'),
  grassLight: new THREE.Color('#9bdc6c'),
  lawn: new THREE.Color('#90d968'),
  lawnStripe: new THREE.Color('#85cf5f'),
  dirt: new THREE.Color('#efd49c'),
  dirtDark: new THREE.Color('#e3c283'),
  brick: new THREE.Color('#efc3a0'),
  brickDark: new THREE.Color('#e2ad86'),
  grout: new THREE.Color('#d9b28f'),
  plaza: new THREE.Color('#f5e6c8'),
  plazaDark: new THREE.Color('#ecd6ae'),
  plazaGrout: new THREE.Color('#dcc39a'),
  mosaicA: new THREE.Color('#7fd0c6'),
  mosaicB: new THREE.Color('#fff4de'),
  sand: new THREE.Color('#f7e6b5'),
  wetSand: new THREE.Color('#e2cc93'),
  deep: new THREE.Color('#2f86a8'),
  pondBed: new THREE.Color('#5f9a78'),
};

const BEACH = 7; // beach width (world units inside the coastline)

export interface Ground {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
}

function noise2(x: number, z: number) {
  return (Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2) * Math.sin(z * 0.23 + x * 0.05) +
    Math.sin(x * 0.53 + z * 0.41) * 0.5 + Math.sin(x * 1.7 - z * 1.3) * 0.2) / 1.7;
}

export function pondDepth(ponds: Pond[], x: number, z: number) {
  let d = 0;
  for (const p of ponds) {
    const e = ((x - p.x) / p.r) ** 2 + ((z - p.z) / (p.r * 0.8)) ** 2;
    if (e < 1) d = Math.max(d, 1 - e);
  }
  return d;
}

export function buildGround(world: WorldState, occ: Occupancy, shape: IslandShape, ponds: Pond[] = []): Ground {
  const { bounds, sdf } = shape;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const step = 0.6;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / step), Math.ceil(d / step));
  geo.rotateX(-Math.PI / 2);
  geo.translate((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);

  const plaza = blockBounds(world.plaza);
  const grounds = [world.fair, world.circuit].filter((b) => b !== undefined).map((b) => blockBounds(b));
  const townCells = new Set<string>();
  for (const p of world.properties) {
    if (p.kind !== 'town') continue;
    for (let x = 0; x < p.cols; x++) for (let z = 0; z < p.rows; z++) townCells.add(`${p.gx + x},${p.gz + z}`);
  }

  const heightAt = (x: number, z: number) => {
    const s = sdf(x, z);
    let h: number;
    if (s < -2.5) h = 0;
    else if (s < 0) h = -0.35 * (s + 2.5) / 2.5;
    else h = -0.35 - Math.min(3.2, s * 0.22);
    const pd = pondDepth(ponds, x, z);
    if (pd > 0) h -= Math.min(1.1, pd * 2.2);
    return h;
  };

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const s = sdf(x, z);
    pos.setY(i, heightAt(x, z));
    const n = noise2(x, z);

    if (s > 0) {
      col.copy(C.wetSand).lerp(C.deep, Math.min(1, s / 16));
    } else {
      const c = cellOf(x, z);
      const key = `${c.gx},${c.gz}`;
      const lx = x - c.gx * PITCH;
      const lz = z - c.gz * PITCH;
      const inPlaza = x > plaza.minX + 2 && x < plaza.maxX - 2 && z > plaza.minZ + 2 && z < plaza.maxZ - 2;
      const lot = occ.lots.get(key);
      const inFair = grounds.some((g) => x > g.minX + 2 && x < g.maxX - 2 && z > g.minZ + 2 && z < g.maxZ - 2);
      if (inPlaza) {
        col.copy(C.plaza); // the tiles themselves are a textured overlay (see buildPlaza)
      } else if (inFair) {
        const stripe = Math.floor((z + 100) / 2.2) % 2 === 0;
        col.copy(stripe ? C.lawn : C.lawnStripe).lerp(C.grassLight, Math.max(0, n) * 0.3);
      } else if (lot && Math.abs(lx) < HALF && Math.abs(lz) < HALF) {
        const stripe = Math.floor((lz + 100) / 1.6) % 2 === 0;
        col.copy(stripe ? C.lawn : C.lawnStripe).lerp(C.grassLight, Math.max(0, n) * 0.25);
      } else if (lot || nearOccupied(occ, x, z)) {
        if (townCells.has(key) && lot) {
          // Warm terracotta streets inside towns.
          col.copy(C.brick).lerp(C.brickDark, 0.5 + n * 0.5);
        } else {
          col.copy(C.dirt).lerp(C.dirtDark, 0.5 + n * 0.5);
          // Grass creeping in from the edges of the dirt paths.
          const edge = Math.min(Math.abs(Math.abs(lx) - PITCH / 2), Math.abs(Math.abs(lz) - PITCH / 2));
          if (edge < 0.9 && n > 0.1) col.lerp(C.grass, 0.7);
        }
      } else {
        col.copy(C.grass).lerp(n > 0 ? C.grassLight : C.grassDark, Math.abs(n) * 0.8);
      }
      if (s > -BEACH) {
        const t = THREE.MathUtils.smoothstep(s, -BEACH, -BEACH + 2.2);
        col.lerp(s > -1.2 ? C.wetSand : C.sand, t);
      }
      const pd = pondDepth(ponds, x, z);
      if (pd > 0) col.lerp(C.pondBed, Math.min(1, pd * 3));
      else {
        // A sandy rim around ponds.
        const rim = pondDepth(ponds.map((p) => ({ ...p, r: p.r + 0.9 })), x, z);
        if (rim > 0) col.lerp(C.sand, 0.6);
      }
    }
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, curved(new THREE.MeshLambertMaterial({ vertexColors: true })));
  mesh.receiveShadow = true;
  return { mesh, heightAt };
}

/** Roads ring every occupied lot: a point is road if an adjacent cell is occupied. */
function nearOccupied(occ: Occupancy, x: number, z: number) {
  const c = cellOf(x, z);
  const lx = x - c.gx * PITCH;
  const lz = z - c.gz * PITCH;
  const dx = lx > HALF ? 1 : lx < -HALF ? -1 : 0;
  const dz = lz > HALF ? 1 : lz < -HALF ? -1 : 0;
  if (dx === 0 && dz === 0) return false;
  const has = (gx: number, gz: number) => occ.lots.has(`${gx},${gz}`) || reservedCell(occ, gx, gz);
  return (dx !== 0 && has(c.gx + dx, c.gz)) || (dz !== 0 && has(c.gx, c.gz + dz)) || (dx !== 0 && dz !== 0 && has(c.gx + dx, c.gz + dz));
}

export function buildWater(shape: IslandShape) {
  const { bounds, sdf } = shape;
  const size = 256;
  const data = new Uint8Array(size * size);
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = bounds.minX + (i / (size - 1)) * w;
      const z = bounds.minZ + (j / (size - 1)) * d;
      data[j * size + i] = Math.round(THREE.MathUtils.clamp((sdf(x, z) + 8) / 24, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const uniforms = {
    uCurve: curve,
    uTime: { value: 0 },
    uShore: { value: tex },
    uBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, w, d) },
    uShallow: { value: new THREE.Color('#5fd0dd') },
    uDeep: { value: new THREE.Color('#2b8fc0') },
    uTint: { value: new THREE.Color(1, 1, 1) },
    fogColor: { value: new THREE.Color('#cfeeff') },
    fogNear: { value: 70 },
    fogFar: { value: 170 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uCurve;
      uniform float uTime;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        world.y += sin(world.x * 0.35 + uTime * 1.2) * 0.05 + cos(world.z * 0.3 + uTime) * 0.05;
        vWorld = world.xyz;
        vec4 mv = viewMatrix * world;
        mv.y -= uCurve * mv.z * mv.z;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uShore;
      uniform vec4 uBounds;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uTint;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec2 uv = (vWorld.xz - uBounds.xy) / uBounds.zw;
        float sdf = texture2D(uShore, uv).r * 24.0 - 8.0;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) sdf = 40.0;
        float depth = clamp(sdf / 22.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, depth);
        float n = sin(vWorld.x * 0.9 + uTime * 1.3) * sin(vWorld.z * 0.8 - uTime * 1.05);
        col += smoothstep(0.86, 1.0, n) * 0.25;
        float band = 0.5 + 0.5 * sin(sdf * 2.6 - uTime * 2.2);
        float foam = smoothstep(2.6, 0.2, sdf) * smoothstep(0.35, 0.9, band) + smoothstep(0.9, 0.0, sdf);
        col = mix(col, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
        float alpha = mix(0.55, 0.92, depth) + foam * 0.3;
        col *= uTint;
        float f = smoothstep(fogNear, fogFar, vDepth);
        gl_FragColor = vec4(mix(col, fogColor, f), clamp(alpha, 0.0, 1.0));
      }`,
  });
  const geo = new THREE.PlaneGeometry(w + 400, d + 400, 160, 160);
  geo.rotateX(-Math.PI / 2);
  geo.translate((bounds.minX + bounds.maxX) / 2, -0.28, (bounds.minZ + bounds.maxZ) / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

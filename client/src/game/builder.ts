import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];

/**
 * A half cylinder lying along z with its round side up: a door arch
 * (short `depth`) or a mailbox roof (long `depth`). The rotations are baked
 * into the geometry because the Euler order used by `add` (X, then Y, then Z
 * applied last-first) can't express "tip over, then turn upright".
 */
export function upperHalfCylinderZ(r: number, depth: number, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, depth, seg, 1, false, 0, Math.PI);
  g.rotateX(Math.PI / 2); // axis y -> z; the half is now on +x
  g.rotateZ(Math.PI / 2); // +x half -> +y (round side up)
  return g;
}

/** A disc facing +z (a window pane), ready to be turned with rot = [0, rotY, 0]. */
export function discZ(r: number, depth: number, seg = 18) {
  const g = new THREE.CylinderGeometry(r, r, depth, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

/**
 * Accumulates coloured primitives and merges them into a single geometry, so a
 * whole house (or forest) costs one draw call.
 */
export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];
  /** Applied to parts added from now on: 0 = rigid, 1 = leaves in the wind. */
  sway = 0;
  /** Applied to parts added from now on: 1 = lights up at night (windows, lamps). */
  glow = 0;

  /** Runs `fn` with temporary sway/glow values. */
  with(opts: { sway?: number; glow?: number }, fn: () => void): this {
    const s = this.sway, g = this.glow;
    if (opts.sway !== undefined) this.sway = opts.sway;
    if (opts.glow !== undefined) this.glow = opts.glow;
    fn();
    this.sway = s;
    this.glow = g;
    return this;
  }

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1, jitter = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
    tmpQuat.setFromEuler(tmpEuler.set(rot[0], rot[1], rot[2]));
    tmpMatrix.compose(new THREE.Vector3(...pos), tmpQuat, new THREE.Vector3(s[0], s[1], s[2]));
    g.applyMatrix4(tmpMatrix);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    tmpColor.set(color);
    for (let i = 0; i < count; i++) {
      const j = jitter ? 1 + (Math.sin(i * 12.9898 + pos[0] * 78.233) * 0.5) * jitter : 1;
      colors[i * 3] = tmpColor.r * j;
      colors[i * 3 + 1] = tmpColor.g * j;
      colors[i * 3 + 2] = tmpColor.b * j;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(count).fill(this.sway), 1));
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(count).fill(this.glow), 1));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, pos: V3, rot?: V3) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot);
  }

  cyl(rTop: number, rBottom: number, h: number, color: THREE.ColorRepresentation, pos: V3, rot?: V3, seg = 12) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), color, pos, rot);
  }

  cone(r: number, h: number, color: THREE.ColorRepresentation, pos: V3, rot?: V3, seg = 12) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot);
  }

  sphere(r: number, color: THREE.ColorRepresentation, pos: V3, scale: V3 | number = 1, detail = 1, jitter = 0) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, [0, 0, 0], scale, jitter);
  }

  smoothSphere(r: number, color: THREE.ColorRepresentation, pos: V3, scale: V3 | number = 1) {
    return this.add(new THREE.SphereGeometry(r, 16, 12), color, pos, [0, 0, 0], scale);
  }

  /** A triangular gable roof spanning `w` (x) by `d` (z), ridge along x. */
  gable(w: number, d: number, h: number, color: THREE.ColorRepresentation, gableColor: THREE.ColorRepresentation, y: number, overhang = 0.35, ox = 0, oz = 0) {
    const half = d / 2 + overhang;
    const len = Math.hypot(half, h);
    const angle = Math.atan2(h, half);
    const t = 0.22;
    for (const side of [-1, 1]) {
      const cz = oz + side * half / 2;
      this.box(w + overhang * 2, t, len, color, [ox, y + h / 2 + t / 2, cz], [side * angle, 0, 0]);
    }
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    for (const side of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      this.add(g, gableColor, [ox + side * (w / 2) - (side > 0 ? 0.12 : 0), y, oz], [0, Math.PI / 2, 0]);
    }
    return this;
  }

  isEmpty() {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

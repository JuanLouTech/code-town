import * as THREE from 'three';
import { colorMat, curve, curved } from './engine.ts';

interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; size: number }

export interface ButterflyKind { id: string; name: string; wing: string; wing2: string; rarity: number; size: number }

export const BUTTERFLIES: ButterflyKind[] = [
  { id: 'cabbage', name: 'Off-by-One Cabbage White', wing: '#fbfbf5', wing2: '#e8e8dc', rarity: 1, size: 1 },
  { id: 'sulphur', name: 'Yellow Semicolon Sulphur', wing: '#ffe169', wing2: '#f2c94c', rarity: 1, size: 1 },
  { id: 'monarch', name: 'Monarch of the Main Branch', wing: '#f28c28', wing2: '#3b2f2a', rarity: 2, size: 1.2 },
  { id: 'blue', name: 'Blue Screen Morpho', wing: '#4f86d9', wing2: '#7ec4ff', rarity: 3, size: 1.3 },
  { id: 'pink', name: 'Pull Request Pinkwing', wing: '#ff8fab', wing2: '#ffc6d5', rarity: 2, size: 1.05 },
  { id: 'heisen', name: 'Heisenbug Swallowtail', wing: '#b07cd1', wing2: '#6ee7d8', rarity: 5, size: 1.4 },
];

export class Butterfly {
  group = new THREE.Group();
  private wings: THREE.Mesh[] = [];
  home = new THREE.Vector3();
  phase = Math.random() * 100;
  flee = 0;
  caught = false;
  constructor(public kind: ButterflyKind) {
    const wingGeo = new THREE.CircleGeometry(0.22, 8);
    wingGeo.translate(0.2, 0, 0);
    const matA = curved(new THREE.MeshLambertMaterial({ color: kind.wing, side: THREE.DoubleSide }));
    const matB = curved(new THREE.MeshLambertMaterial({ color: kind.wing2, side: THREE.DoubleSide }));
    for (const side of [-1, 1]) {
      const pivot = new THREE.Mesh(wingGeo, side > 0 ? matA : matB);
      pivot.rotation.x = -Math.PI / 2;
      pivot.scale.set(side, 1, 1);
      this.wings.push(pivot);
      this.group.add(pivot);
    }
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.18, 3, 6), colorMat('#3b2f2a'));
    body.rotation.x = Math.PI / 2;
    this.group.add(body);
    this.group.scale.setScalar(kind.size);
  }

  get pos() {
    return this.group.position;
  }

  update(dt: number, t: number, player: THREE.Vector3, running: boolean) {
    const p = this.pos;
    const dx = p.x - player.x, dz = p.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < (running ? 3.2 : 1.3) && this.flee <= 0) this.flee = 1.6;
    if (this.flee > 0) {
      this.flee -= dt;
      p.x += (dx / (d || 1)) * dt * 4;
      p.z += (dz / (d || 1)) * dt * 4;
      p.y = Math.min(4, p.y + dt * 2);
      if (this.flee <= 0) this.home.set(p.x, 0, p.z);
    } else {
      const s = t * 0.7 + this.phase;
      const target = new THREE.Vector3(
        this.home.x + Math.sin(s) * 1.6 + Math.sin(s * 2.3) * 0.5, 0.8 + Math.abs(Math.sin(s * 1.7)) * 1.1,
        this.home.z + Math.cos(s * 0.8) * 1.4,
      );
      p.lerp(target, 1 - Math.exp(-dt * 2));
    }
    const vx = Math.sin(t * 0.7 + this.phase), vz = Math.cos((t * 0.7 + this.phase) * 0.8);
    this.group.rotation.y = Math.atan2(vx, vz);
    const flap = Math.sin(t * 22 + this.phase) * 1.1;
    this.wings[0].rotation.y = flap;
    this.wings[1].rotation.y = -flap;
  }
}

/** Everything that moves without being a villager: smoke, butterflies, birds, fireflies, fire, windmills. */
export class Ambient {
  group = new THREE.Group();
  butterflies: Butterfly[] = [];
  private puffs: Puff[] = [];
  private chimneys = new Map<string, THREE.Vector3[]>();
  private busy = new Set<string>();
  private smokeTimer = 0;
  private flowers: THREE.Vector3[] = [];
  private sails: THREE.Object3D[] = [];
  private flames: THREE.Mesh[] = [];
  private birds?: { group: THREE.Group; wings: THREE.Mesh[]; vel: THREE.Vector3; life: number };
  private nextBirds = 8;
  private fireflies: THREE.Points;
  private fireMat: THREE.ShaderMaterial;
  private puffGeo = new THREE.IcosahedronGeometry(0.3, 1);
  private puffMat = colorMat('#f4f1ec');

  constructor() {
    this.fireMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uCurve: curve },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uCurve;
        attribute float seed;
        varying float vA;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.6 + seed) * 0.8;
          p.y += sin(uTime * 0.9 + seed * 1.7) * 0.35;
          p.z += cos(uTime * 0.5 + seed * 0.7) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.y -= uCurve * mv.z * mv.z;
          vA = 0.5 + 0.5 * sin(uTime * 2.5 + seed * 3.0);
          gl_PointSize = 13.0 * (20.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.18, 0.0, d);
          float halo = smoothstep(0.5, 0.0, d) * 0.55;
          float a = (core + halo) * vA * uNight;
          gl_FragColor = vec4(mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 1.0, 0.8), core), a);
        }`,
    });
    this.fireflies = new THREE.Points(new THREE.BufferGeometry(), this.fireMat);
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);
  }

  /**
   * Fireflies live in the world, not around the player: little swarms that
   * hover over ponds, flower patches and fruit trees, each drifting around its own spot.
   */
  private placeFireflies(spots: { pos: THREE.Vector3; count: number; radius: number }[]) {
    const pos: number[] = [];
    const seed: number[] = [];
    let k = 1;
    const rnd = () => {
      k = (Math.imul(k, 1664525) + 1013904223) >>> 0;
      return k / 4294967296;
    };
    for (const s of spots) {
      for (let i = 0; i < s.count; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * s.radius;
        pos.push(s.pos.x + Math.cos(a) * r, 0.5 + rnd() * 2.2, s.pos.z + Math.sin(a) * r);
        seed.push(rnd() * 100);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    this.fireflies.geometry.dispose();
    this.fireflies.geometry = g;
  }

  setWorld(opts: {
    chimneys: Map<string, THREE.Vector3[]>; flowers: THREE.Vector3[]; fires: THREE.Vector3[]; sails: THREE.Object3D[];
    ponds?: { x: number; z: number; r: number }[]; trees?: THREE.Vector3[];
  }) {
    const swarms: { pos: THREE.Vector3; count: number; radius: number }[] = [];
    for (const p of opts.ponds ?? []) swarms.push({ pos: new THREE.Vector3(p.x, 0, p.z), count: 22, radius: p.r + 2 });
    opts.flowers.forEach((f, i) => { if (i % 3 === 0) swarms.push({ pos: f, count: 3, radius: 2.5 }); });
    for (const t of opts.trees ?? []) swarms.push({ pos: t, count: 4, radius: 2.2 });
    for (const f of opts.fires) swarms.push({ pos: f, count: 6, radius: 3.5 });
    this.placeFireflies(swarms);
    this.chimneys = opts.chimneys;
    this.flowers = opts.flowers;
    this.sails = opts.sails;
    for (const f of this.flames) this.group.remove(f);
    this.flames = [];
    const flameGeo = new THREE.ConeGeometry(0.22, 0.7, 6);
    for (const p of opts.fires) {
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(flameGeo, curved(new THREE.MeshBasicMaterial({ color: ['#ff9f43', '#ffd94a', '#ff6b3d'][i] })));
        m.position.set(p.x + (i - 1) * 0.15, p.y + 0.3, p.z + ((i % 2) - 0.5) * 0.15);
        this.flames.push(m);
        this.group.add(m);
      }
    }
    for (const b of this.butterflies) this.group.remove(b.group);
    this.butterflies = [];
  }

  setBusy(ids: Set<string>) {
    this.busy = ids;
  }

  /** Picks a butterfly species, rarer ones less often. */
  private randomKind() {
    const total = BUTTERFLIES.reduce((a, k) => a + 1 / k.rarity, 0);
    let r = Math.random() * total;
    for (const k of BUTTERFLIES) {
      r -= 1 / k.rarity;
      if (r <= 0) return k;
    }
    return BUTTERFLIES[0];
  }

  removeButterfly(b: Butterfly) {
    this.group.remove(b.group);
    this.butterflies = this.butterflies.filter((x) => x !== b);
  }

  update(dt: number, t: number, player: THREE.Vector3, running: boolean, night: number) {
    // Chimney smoke from houses where someone is busy.
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.45;
      for (const id of this.busy) {
        for (const c of this.chimneys.get(id) ?? []) {
          if (c.distanceToSquared(player) > 70 * 70) continue;
          const mesh = new THREE.Mesh(this.puffGeo, this.puffMat);
          mesh.position.copy(c);
          this.group.add(mesh);
          this.puffs.push({ mesh, vel: new THREE.Vector3(0.35 + Math.random() * 0.2, 1.1, (Math.random() - 0.5) * 0.2), life: 3.2, max: 3.2, size: 0.5 + Math.random() * 0.3 });
        }
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.puffs.splice(i, 1);
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      const age = 1 - p.life / p.max;
      p.mesh.scale.setScalar(p.size * (0.6 + age * 2.2) * (p.life < 0.6 ? p.life / 0.6 : 1));
    }

    // Butterflies stay around flowers near the player (none at night).
    const want = night > 0.6 ? 0 : 14;
    while (this.butterflies.length > want) this.removeButterfly(this.butterflies[this.butterflies.length - 1]);
    const near = this.flowers.filter((f) => Math.abs(f.x - player.x) < 34 && Math.abs(f.z - player.z) < 28);
    while (this.butterflies.length < want && near.length) {
      const b = new Butterfly(this.randomKind());
      const home = near[Math.floor(Math.random() * near.length)];
      b.home.copy(home);
      b.pos.set(home.x, 1.2, home.z);
      this.butterflies.push(b);
      this.group.add(b.group);
    }
    for (const b of this.butterflies) {
      if (b.home.distanceToSquared(player) > 45 * 45 && near.length) {
        const home = near[Math.floor(Math.random() * near.length)];
        b.home.copy(home);
        b.pos.set(home.x, 1.2, home.z);
      }
      b.update(dt, t, player, running);
    }

    // Now and then a little flock of birds crosses the sky.
    this.nextBirds -= dt;
    if (!this.birds && this.nextBirds <= 0 && night < 0.5) {
      const group = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      const wingGeo = new THREE.BoxGeometry(0.7, 0.04, 0.22);
      wingGeo.translate(0.35, 0, 0);
      for (let i = 0; i < 4; i++) {
        const bird = new THREE.Group();
        bird.position.set(-i * 1.4, Math.sin(i) * 0.4, i * 1.1 * (i % 2 ? 1 : -1));
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), colorMat('#fbfbf5'));
        body.scale.set(1, 0.8, 1.6);
        bird.add(body);
        for (const s of [-1, 1]) {
          const w = new THREE.Mesh(wingGeo, colorMat('#f1ede4'));
          w.scale.x = s;
          bird.add(w);
          wings.push(w);
        }
        group.add(bird);
      }
      const dir = Math.random() < 0.5 ? 1 : -1;
      group.position.set(player.x - dir * 45, 11 + Math.random() * 4, player.z - 18 + Math.random() * 20);
      group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(group);
      this.birds = { group, wings, vel: new THREE.Vector3(dir * 7, 0, (Math.random() - 0.5) * 2), life: 14 };
    }
    if (this.birds) {
      const b = this.birds;
      b.life -= dt;
      b.group.position.addScaledVector(b.vel, dt);
      b.wings.forEach((w, i) => (w.rotation.z = Math.sin(t * 12 + i) * 0.6 * (w.scale.x)));
      if (b.life <= 0) {
        this.group.remove(b.group);
        this.birds = undefined;
        this.nextBirds = 18 + Math.random() * 25;
      }
    }

    // Fireflies follow the player around at night.
    this.fireMat.uniforms.uTime.value = t;
    this.fireMat.uniforms.uNight.value = Math.max(0, (night - 0.4) / 0.6);
    this.fireflies.visible = night > 0.4;

    for (const [i, f] of this.flames.entries()) {
      const k = 0.8 + Math.sin(t * 13 + i * 2.1) * 0.2 + Math.sin(t * 7.3 + i) * 0.1;
      f.scale.set(k, k * (1 + Math.sin(t * 9 + i) * 0.15), k);
    }
    for (const s of this.sails) s.rotation.z += dt * 0.6;
  }
}

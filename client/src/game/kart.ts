import * as THREE from 'three';
import { ModelBuilder } from './builder.ts';
import { colorMat, vertexMat } from './engine.ts';

/** Top speed on asphalt; boosts go past it for a moment. */
const MAX_SPEED = 24;
const BOOST_SPEED = 29;
/** Top speed on grass inside the circuit: cutting corners or running wide costs time. */
const OFFROAD_SPEED = 12;
const MAX_REVERSE = 6;
const ENGINE = 21;
const BRAKE = 34;
/** Drifts start above this speed and end below DRIFT_END. */
const DRIFT_START = 9;
const DRIFT_END = 6;
/** Drift charge (seconds, faster when steering into the drift) for a small and a big boost. */
const CHARGE_1 = 0.8;
const CHARGE_2 = 1.8;
const WHEEL_R = 0.26;
/** Longest single movement step, so fast karts can't tunnel through thin walls. */
const MAX_STEP = 0.35;

export interface KartInput { throttle: number; steer: number; drift: boolean }

/**
 * The player's go-kart: a little model plus arcade racing physics. The kart has a real velocity,
 * separate from where it points: tyres pull the sideways part of it back in line (less at high
 * speed and on grass), so it slides when pushed. Holding Space while turning at speed drifts
 * (no hop, straight into the slide):
 * the back steps out, steering picks a tighter or wider line, and letting go after a while gives
 * a boost (blue sparks = small, orange = big). Hitting walls or going on the grass costs speed.
 */
export class Kart {
  root = new THREE.Group();
  heading = Math.PI;
  /** World-space velocity (x, z). */
  vel = new THREE.Vector2();
  /** Grass where the kart is slow (set by the island: the circuit's infield). */
  offRoad?: (x: number, z: number) => boolean;
  /** -1 / 1 while drifting (the side it's turning to), 0 otherwise. */
  drifting = 0;
  private charge = 0;
  private boost = 0;
  private sparks: THREE.Mesh[] = [];
  private sparkMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
  private flame: THREE.Mesh;
  private body = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private frontPivots: THREE.Object3D[] = [];
  private hopY = 0;
  private hopV = 0;
  private color: string;

  constructor(color: string) {
    this.color = color;
    this.root.add(this.body);
    this.body.position.z = 0.35; // the origin is the seat, where the driver sits
    this.build();
    // Drift sparks behind the rear wheels, and a boost flame behind the spoiler.
    for (const x of [-0.7, 0.7]) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.sparkMat);
      m.position.set(x, 0.12, -0.75);
      m.visible = false;
      this.sparks.push(m);
      this.root.add(m);
    }
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 7), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 }));
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.set(0, 0.45, -0.95);
    this.flame.visible = false;
    this.root.add(this.flame);
  }

  /** Signed speed along the way the kart points. */
  get speed() {
    return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading);
  }

  set speed(v: number) {
    this.vel.set(Math.sin(this.heading) * v, Math.cos(this.heading) * v);
    if (Math.abs(v) < DRIFT_END) this.endDrift(false);
  }

  get boosting() {
    return this.boost > 0;
  }

  get pos() {
    return this.root.position;
  }

  /** How high the kart is off the ground (a hop). */
  get lift() {
    return this.hopY;
  }

  setColor(color: string) {
    if (color === this.color) return;
    this.color = color;
    this.build();
  }

  private build() {
    this.body.clear();
    this.wheels = [];
    this.frontPivots = [];
    const c = this.color;
    const mb = new ModelBuilder();
    // Chassis, nose and side pods.
    mb.box(1.25, 0.18, 2.1, '#3b3b44', [0, 0.28, 0]);
    mb.box(1.05, 0.32, 1.2, c, [0, 0.46, -0.15]);
    mb.box(0.8, 0.26, 0.7, c, [0, 0.42, 0.85], [-0.25, 0, 0]);
    mb.box(1.35, 0.2, 0.34, '#2b2b33', [0, 0.32, 1.12]);
    for (const s of [-1, 1]) mb.box(0.22, 0.26, 0.9, c, [s * 0.66, 0.4, -0.1]);
    // Seat, steering column and wheel, spoiler.
    mb.box(0.6, 0.12, 0.55, '#2b2b33', [0, 0.66, -0.35]);
    mb.box(0.6, 0.55, 0.12, '#2b2b33', [0, 0.9, -0.62], [-0.2, 0, 0]);
    mb.cyl(0.035, 0.035, 0.5, '#555555', [0, 0.72, 0.38], [-0.9, 0, 0], 6);
    mb.add(new THREE.TorusGeometry(0.17, 0.035, 6, 14), '#2b2b33', [0, 0.9, 0.24], [-0.9, 0, 0]);
    for (const s of [-0.4, 0.4]) mb.box(0.06, 0.4, 0.06, '#555555', [s, 0.72, -1.0]);
    mb.box(1.2, 0.08, 0.34, c, [0, 0.94, -1.02]);
    mb.box(0.36, 0.2, 0.02, '#ffffff', [0, 0.46, 1.3]);
    const chassis = new THREE.Mesh(mb.build(), vertexMat);
    chassis.castShadow = true;
    this.body.add(chassis);
    // Wheels: separate, so they can spin (and the front ones steer).
    const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.24, 14);
    tyre.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8);
    hub.rotateZ(Math.PI / 2);
    for (const [x, z, front] of [[-0.68, 0.72, true], [0.68, 0.72, true], [-0.7, -0.75, false], [0.7, -0.75, false]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const wheel = new THREE.Group();
      const t = new THREE.Mesh(tyre, colorMat('#232327'));
      t.castShadow = true;
      wheel.add(t, new THREE.Mesh(hub, colorMat('#d9d9e0')));
      pivot.add(wheel);
      this.body.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }
  }

  hop() {
    if (this.hopY > 0 || this.hopV > 0) return;
    this.hopV = 3.4;
  }

  /**
   * One physics step. `free(x, z)` says whether the kart's centre may be at (x, z).
   * Returns true if it bumped into something.
   */
  drive(dt: number, input: KartInput, free: (x: number, z: number) => boolean): boolean {
    const grounded = this.hopY === 0;
    const rough = grounded && (this.offRoad?.(this.pos.x, this.pos.z) ?? false);
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    // Split the velocity into along the kart and sideways (lx, lz is the kart's right-hand side).
    let fwd = this.vel.x * fx + this.vel.y * fz;
    let lat = this.vel.x * fz - this.vel.y * fx;

    // Engine (strong pull low down, fading towards top speed), brakes, reverse, coasting.
    const top = rough ? OFFROAD_SPEED : MAX_SPEED;
    if (input.throttle > 0) {
      fwd += (fwd < 0 ? BRAKE : ENGINE * Math.max(0, 1 - (Math.max(0, fwd) / top) ** 2)) * dt;
    } else if (input.throttle < 0) {
      fwd -= (fwd > 0.5 ? BRAKE : 10) * dt;
    } else {
      fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 4 * dt);
    }
    // Over the limit (after a boost, or rolling onto the grass): bleed it off, faster on grass.
    if (fwd > top && this.boost <= 0) fwd -= (fwd - top) * (rough ? 3.5 : 1.2) * dt;
    if (this.boost > 0) {
      this.boost -= dt;
      if (input.throttle >= 0) fwd = Math.max(fwd, Math.min(fwd + 40 * dt, rough ? OFFROAD_SPEED + 4 : BOOST_SPEED));
    }
    fwd = THREE.MathUtils.clamp(fwd, -MAX_REVERSE, BOOST_SPEED);

    // Drifting: starts the moment Space is held while steering at speed, ends the moment it's
    // released (with a boost if it charged long enough).
    if (!this.drifting && input.drift && grounded && input.steer !== 0 && fwd > DRIFT_START && !rough) this.drifting = Math.sign(input.steer);
    if (this.drifting && (!input.drift || fwd < DRIFT_END || rough)) this.endDrift(!rough && fwd >= DRIFT_END);

    // Steering: needs rolling speed, turns the other way in reverse, and gets lazier at top speed.
    let yaw: number;
    if (this.drifting) {
      // Steering into the drift tightens it (and charges faster), steering out widens it.
      const into = input.steer * this.drifting;
      yaw = this.drifting * (1.8 + 0.8 * into);
      this.charge += dt * (into > 0 ? 1.35 : 1);
    } else {
      const roll = THREE.MathUtils.clamp(Math.abs(fwd) / 6, 0, 1) * Math.sign(fwd);
      const under = 1 - 0.32 * THREE.MathUtils.clamp((Math.abs(fwd) - 12) / 12, 0, 1);
      yaw = input.steer * 2.5 * under * roll;
    }
    if (!grounded) yaw *= 0.5;

    // Tyre grip pulls the sideways slide back in line: loose in a drift, a little loose when
    // steering hard at speed (and on grass), sticky otherwise. Sliding scrubs speed.
    const fast = THREE.MathUtils.clamp((Math.abs(fwd) - 15) / 9, 0, 1) * Math.abs(input.steer);
    // (Grip vs. turn rate sets the slip angle: a drift holds the tail out at roughly 20–25°.)
    const grip = !grounded ? 1.5 : this.drifting ? 6.5 : rough ? 5 : 14 - 7 * fast;
    const kept = Math.exp(-grip * dt);
    fwd -= Math.sign(fwd) * Math.abs(lat) * (1 - kept) * (this.drifting ? 0.12 : 0.1);
    lat *= kept;
    this.vel.set(fx * fwd + fz * lat, fz * fwd - fx * lat);
    this.heading += yaw * dt;

    // Move in small steps; a wall stops that direction, bounces a little and costs speed.
    fx = Math.sin(this.heading);
    fz = Math.cos(this.heading);
    const ok = (x: number, z: number) => free(x, z) && free(x + fx * 0.8, z + fz * 0.8) && free(x - fx * 0.8, z - fz * 0.8);
    let bumped = false;
    const dist = this.vel.length() * dt;
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (this.vel.x * dt) / steps;
      if (ok(nx, this.pos.z)) this.pos.x = nx;
      else {
        bumped = true;
        this.vel.x *= -0.25;
      }
      const nz = this.pos.z + (this.vel.y * dt) / steps;
      if (ok(this.pos.x, nz)) this.pos.z = nz;
      else {
        bumped = true;
        this.vel.y *= -0.25;
      }
    }
    if (bumped) {
      this.vel.multiplyScalar(0.75);
      this.drifting = 0;
      this.charge = 0;
    }

    // Hop.
    if (this.hopY > 0 || this.hopV > 0) {
      this.hopV -= 16 * dt;
      this.hopY = Math.max(0, this.hopY + this.hopV * dt);
      if (this.hopY === 0) this.hopV = 0;
    }
    this.pose(input.steer, dt);
    return bumped;
  }

  private endDrift(reward: boolean) {
    if (reward && this.charge >= CHARGE_1) this.boost = this.charge >= CHARGE_2 ? 1.2 : 0.6;
    this.drifting = 0;
    this.charge = 0;
  }

  /** Wheels, steering and a little body roll, from the current motion. */
  private pose(steer: number, dt: number) {
    this.root.rotation.y = this.heading;
    this.body.position.y = this.hopY;
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / WHEEL_R;
    for (const p of this.frontPivots) p.rotation.y += (steer * 0.45 - p.rotation.y) * Math.min(1, dt * 10);
    const roll = -(this.drifting || steer) * THREE.MathUtils.clamp(this.speed / MAX_SPEED, -1, 1) * (this.drifting ? 0.14 : 0.08);
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 6);
    // Swing the tail out a touch while drifting, so it reads as a slide.
    const tail = this.drifting * 0.28;
    this.body.rotation.y += (tail - this.body.rotation.y) * Math.min(1, dt * 8);
    // Sparks: white while drifting, blue once a small boost is ready, orange for a big one.
    const lit = this.drifting !== 0;
    const col = this.charge >= CHARGE_2 ? '#ff9f43' : this.charge >= CHARGE_1 ? '#5ec8ff' : '#ffffff';
    this.sparkMat.color.set(col);
    for (const m of this.sparks) {
      m.visible = lit;
      if (lit) {
        m.scale.setScalar(0.6 + Math.random() * (this.charge >= CHARGE_1 ? 1.1 : 0.5));
        m.rotation.y += dt * 20;
      }
    }
    this.flame.visible = this.boost > 0;
    if (this.boost > 0) this.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1);
  }

  /** Parks the kart at a spot (no motion). */
  park(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel.set(0, 0);
    this.drifting = 0;
    this.charge = this.boost = 0;
    this.hopY = this.hopV = 0;
    this.pose(0, 0);
  }
}

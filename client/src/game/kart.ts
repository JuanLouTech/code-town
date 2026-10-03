import * as THREE from 'three';
import { ModelBuilder } from './builder.ts';
import { colorMat, vertexMat } from './engine.ts';

const MAX_SPEED = 17;
const MAX_REVERSE = 5;
const WHEEL_R = 0.26;

export interface KartInput { throttle: number; steer: number; drift: boolean }

/** The player's go-kart: a little model plus arcade driving physics. */
export class Kart {
  root = new THREE.Group();
  heading = Math.PI;
  speed = 0;
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
    // Throttle, brakes and reverse.
    if (input.throttle > 0) this.speed += (this.speed < 0 ? 26 : 13) * dt;
    else if (input.throttle < 0) this.speed -= (this.speed > 0.5 ? 24 : 9) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 5 * dt);
    this.speed -= this.speed * (input.drift ? 0.45 : 0.25) * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REVERSE, MAX_SPEED);
    // Steering only bites while rolling, and turns the other way in reverse.
    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 5, 0, 1) * Math.sign(this.speed);
    const rate = (input.drift ? 3.4 : 2.3) * (grounded ? 1 : 0.4);
    this.heading += input.steer * rate * grip * dt;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const ok = (x: number, z: number) => free(x, z) && free(x + fx * 0.8, z + fz * 0.8) && free(x - fx * 0.8, z - fz * 0.8);
    const nx = this.pos.x + fx * this.speed * dt;
    const nz = this.pos.z + fz * this.speed * dt;
    let bumped = false;
    if (ok(nx, this.pos.z)) this.pos.x = nx;
    else bumped = true;
    if (ok(this.pos.x, nz)) this.pos.z = nz;
    else bumped = true;
    if (bumped && Math.abs(this.speed) > 1) this.speed *= -0.3;

    // Hop.
    if (this.hopY > 0 || this.hopV > 0) {
      this.hopV -= 16 * dt;
      this.hopY = Math.max(0, this.hopY + this.hopV * dt);
      if (this.hopY === 0) this.hopV = 0;
    }
    this.pose(input.steer, dt);
    return bumped;
  }

  /** Wheels, steering and a little body roll, from the current motion. */
  private pose(steer: number, dt: number) {
    this.root.rotation.y = this.heading;
    this.body.position.y = this.hopY;
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / WHEEL_R;
    for (const p of this.frontPivots) p.rotation.y += (steer * 0.45 - p.rotation.y) * Math.min(1, dt * 10);
    const roll = -steer * THREE.MathUtils.clamp(this.speed / MAX_SPEED, -1, 1) * 0.08;
    this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 6);
  }

  /** Parks the kart at a spot (no motion). */
  park(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.hopY = this.hopV = 0;
    this.pose(0, 0);
  }
}

import * as THREE from 'three';
import { Character } from './character.ts';
import type { Collider } from './buildings.ts';
import type { Kart } from './kart.ts';

const RADIUS = 0.38;

class ColliderGrid {
  private cells = new Map<string, Collider[]>();
  private size = 8;

  constructor(colliders: Collider[]) {
    for (const c of colliders) {
      const x0 = Math.floor((c.x - c.hw) / this.size), x1 = Math.floor((c.x + c.hw) / this.size);
      const z0 = Math.floor((c.z - c.hd) / this.size), z1 = Math.floor((c.z + c.hd) / this.size);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = `${x},${z}`;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(c);
        }
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const arr = this.cells.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`);
    if (!arr) return false;
    for (const c of arr) {
      if (Math.abs(x - c.x) < c.hw + RADIUS && Math.abs(z - c.z) < c.hd + RADIUS) return true;
    }
    return false;
  }
}

export class Player {
  char: Character;
  enabled = true;
  facing = Math.PI;
  private keys = new Set<string>();
  private grid = new ColliderGrid([]);
  private land: (x: number, z: number) => boolean = () => true;
  autoTarget?: THREE.Vector3;
  onAutoArrive?: () => void;
  zoom = 1;
  private camPos = new THREE.Vector3();
  moving = false;
  running = false;
  /** A minigame pose; while set the player can't walk (moving cancels it). */
  busyAction?: import('./character.ts').Action;
  onBusyMove?: () => void;
  /** Vertical speed while jumping (the height is pos.y). */
  private vy = 0;
  /** The kart, when the player owns one; `driving` while sitting in it. */
  kart?: Kart;
  driving = false;
  onBump?: (speed: number) => void;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.char = new Character({ species: 'human', fur: '#f6d2b5', shirt: '#ff8c69', accent: '#6b4226', hat: 'none' }, 1.02);
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('wheel', (e) => {
      if ((e.target as HTMLElement)?.closest?.('.ui-scroll, .panel, .dialog, .sessions, .map, .letter, .slash-menu')) return;
      this.zoom = THREE.MathUtils.clamp(this.zoom + Math.sign(e.deltaY) * 0.08, 0.55, 1.9);
    }, { passive: true });
  }

  get pos() {
    return this.char.root.position;
  }

  /** Swaps outfit (hat / shirt) by rebuilding the character in place. */
  setLook(look: Partial<import('../../../shared/protocol.ts').Look>) {
    const old = this.char;
    const next = new Character({ ...old.look, ...look }, old.scale);
    next.root.position.copy(old.root.position);
    next.root.rotation.copy(old.root.rotation);
    old.root.parent?.add(next.root);
    old.root.parent?.remove(old.root);
    this.char = next;
  }

  /** Where the player would be standing one step ahead. */
  ahead(dist: number) {
    return new THREE.Vector3(this.pos.x + Math.sin(this.facing) * dist, 0, this.pos.z + Math.cos(this.facing) * dist);
  }

  setWorld(colliders: Collider[], land: (x: number, z: number) => boolean) {
    this.grid = new ColliderGrid(colliders);
    this.land = land;
  }

  place(p: THREE.Vector3, facing = Math.PI) {
    this.pos.copy(p).setY(0);
    this.vy = 0;
    this.facing = facing;
    this.char.root.rotation.y = facing;
    this.snapCamera();
  }

  clearKeys() {
    this.keys.clear();
  }

  get airborne() {
    return this.pos.y > 0 || this.vy > 0;
  }

  jump() {
    if (this.driving) {
      if (this.enabled) this.kart!.hop();
      return true;
    }
    if (!this.enabled || this.busyAction || this.airborne) return false;
    this.vy = 7.2;
    return true;
  }

  free(x: number, z: number) {
    return this.land(x, z) && !this.grid.blocked(x, z);
  }

  /** The nearest spot to `p` the player can stand on (spiralling outwards), or `p` itself if none is found. */
  findFree(p: THREE.Vector3): THREE.Vector3 {
    if (this.free(p.x, p.z)) return p.clone();
    for (let r = 0.5; r <= 12; r += 0.5) {
      const n = Math.max(8, Math.round(r * 8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        if (this.free(x, z)) return new THREE.Vector3(x, 0, z);
      }
    }
    return p.clone();
  }

  /** Gets into the kart (which must be parked right here). */
  enterKart() {
    const k = this.kart;
    if (!k) return;
    this.driving = true;
    this.autoTarget = undefined;
    this.busyAction = undefined;
    this.vy = 0;
    this.pos.set(k.pos.x, 0, k.pos.z);
    this.facing = k.heading;
  }

  /** Climbs out; the kart stays parked where it is and the player stands next to it. */
  exitKart() {
    const k = this.kart;
    if (!k || !this.driving) return;
    this.driving = false;
    k.speed = 0;
    const side = new THREE.Vector3(Math.cos(k.heading), 0, -Math.sin(k.heading)).multiplyScalar(1.4);
    this.place(this.findFree(k.pos.clone().add(side)), k.heading);
    this.char.seatY = 0;
  }

  private drive(dt: number, t: number) {
    const k = this.kart!;
    const key = (...codes: string[]) => this.enabled && codes.some((c) => this.keys.has(c));
    const throttle = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
    const steer = (key('KeyA', 'ArrowLeft') ? 1 : 0) - (key('KeyD', 'ArrowRight') ? 1 : 0);
    const before = k.speed;
    k.pos.set(this.pos.x, 0, this.pos.z);
    const stuck = this.grid.blocked(k.pos.x, k.pos.z);
    const bumped = k.drive(dt, { throttle, steer, drift: key('Space') }, (x, z) => (stuck ? this.land(x, z) : this.free(x, z)));
    if (bumped && Math.abs(before) > 6) this.onBump?.(Math.abs(before));
    this.pos.set(k.pos.x, 0, k.pos.z);
    this.facing = k.heading;
    this.char.root.rotation.y = k.heading;
    this.moving = Math.abs(k.speed) > 0.3;
    this.running = false;
    this.char.seatY = 0.26 + k.lift;
    this.char.setAction('sit');
    this.char.update(dt, t, this.camera);
    this.followCamera(dt);
  }

  update(dt: number, t: number) {
    if (this.driving && this.kart) {
      this.drive(dt, t);
      return;
    }
    let mx = 0, mz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    }
    if ((mx || mz) && this.busyAction) {
      const cb = this.onBusyMove;
      this.busyAction = undefined;
      this.onBusyMove = undefined;
      cb?.();
    }
    if (this.busyAction) {
      mx = mz = 0;
    }
    if (mx || mz) this.autoTarget = undefined;
    if (!mx && !mz && this.autoTarget && this.enabled) {
      const dx = this.autoTarget.x - this.pos.x, dz = this.autoTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        this.autoTarget = undefined;
        const cb = this.onAutoArrive;
        this.onAutoArrive = undefined;
        cb?.();
      } else {
        mx = dx / d;
        mz = dz / d;
      }
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Boolean(this.autoTarget && this.autoTarget.distanceTo(this.pos) > 10);
    this.running = run;
    this.moving = Boolean(mx || mz);
    if (this.moving) {
      const len = Math.hypot(mx, mz);
      mx /= len;
      mz /= len;
      const speed = run ? 9.5 : 5.4;
      const nx = this.pos.x + mx * speed * dt;
      const nz = this.pos.z + mz * speed * dt;
      const before = this.pos.clone();
      // Somehow inside a collider (a fast-travel landing, a rebuilt island): let the player walk out.
      const stuck = this.grid.blocked(this.pos.x, this.pos.z);
      const ok = (x: number, z: number) => (stuck ? this.land(x, z) : this.free(x, z));
      if (ok(nx, this.pos.z)) this.pos.x = nx;
      if (ok(this.pos.x, nz)) this.pos.z = nz;
      if (this.autoTarget && before.distanceToSquared(this.pos) < 1e-6) {
        // Bumped into something while auto-walking: give up.
        this.autoTarget = undefined;
        this.onAutoArrive = undefined;
      }
      this.facing = Math.atan2(mx, mz);
      this.char.setAction(run ? 'run' : 'walk');
    } else {
      this.char.setAction(this.busyAction ?? 'idle');
    }
    if (this.airborne) {
      this.vy -= 24 * dt;
      this.pos.y = Math.max(0, this.pos.y + this.vy * dt);
      if (this.pos.y === 0 && this.vy < 0) this.vy = 0;
      else this.char.setAction('jump');
    }
    const r = this.char.root.rotation;
    let d = this.facing - r.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r.y += d * (1 - Math.exp(-dt * 14));
    this.char.update(dt, t, this.camera);
    this.followCamera(dt);
  }

  private cameraTarget() {
    const z = this.zoom;
    return new THREE.Vector3(this.pos.x, 13.5 * z, this.pos.z + 15.5 * z);
  }

  snapCamera() {
    this.camPos.copy(this.cameraTarget());
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.pos.x, 1.0, this.pos.z - 2.5);
  }

  private followCamera(dt: number) {
    this.camPos.lerp(this.cameraTarget(), 1 - Math.exp(-dt * 5));
    this.camera.position.copy(this.camPos);
    const look = new THREE.Vector3(this.camPos.x, 1.0, this.camPos.z - 15.5 * this.zoom - 2.5);
    this.camera.lookAt(look);
  }
}

export function isTyping(e: Event) {
  const el = e.target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}

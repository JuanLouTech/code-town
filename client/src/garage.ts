import * as THREE from 'three';
import type { Garage as ShopGarage } from './flows.ts';
import type { Island } from './game/island.ts';
import { Kart } from './game/kart.ts';
import type { Hud } from './ui/hud.ts';
import type { Voice } from './ui/audio.ts';
import type { Pockets } from './ui/pockets.ts';

/** The player's go-kart: whether it's owned, where it's parked, getting in and out. */
export class Garage implements ShopGarage {
  kart: Kart;
  private saveTimer = 0;

  constructor(private island: Island, private pockets: Pockets, private hud: Hud, private voice: Voice) {
    this.kart = new Kart(pockets.data.kart?.color ?? '#e8423b');
    island.player.onBump = () => voice.bump();
  }

  get owned() {
    return this.pockets.hasKart;
  }

  get driving() {
    return this.island.player.driving;
  }

  /** Shows the kart where it was parked (after loading the save, or when the island is rebuilt). */
  restore() {
    const player = this.island.player;
    if (!this.owned) {
      if (this.driving) player.exitKart();
      this.kart.root.removeFromParent();
      player.kart = undefined;
      return;
    }
    player.kart = this.kart;
    if (!this.kart.root.parent) this.island.engine.scene.add(this.kart.root);
    this.kart.setColor(this.pockets.data.kart?.color ?? '#e8423b');
    if (this.driving) return;
    const spot = this.pockets.data.kart;
    const shape = this.island.shape;
    if (spot && (!shape || shape.sdf(spot.x, spot.z) < -1.4)) this.kart.park(spot.x, spot.z, spot.h);
    else this.parkBeside();
  }

  deliver() {
    this.restore();
    this.parkBeside();
    this.island.effects.poof(this.kart.pos.clone(), 16, '#ffffff', 1.2);
  }

  paint(color: string) {
    this.kart.setColor(color);
    this.pockets.parkKart(this.kart.pos.x, this.kart.pos.z, this.kart.heading, color);
  }

  /** Is the parked kart within reach? */
  near(pos: THREE.Vector3) {
    return this.owned && !this.driving && this.kart.root.parent !== null && pos.distanceTo(this.kart.pos) < 2.3;
  }

  enter() {
    this.island.player.enterKart();
    this.voice.vroom();
    this.hud.setHint(true);
  }

  exit() {
    if (!this.driving) return;
    this.island.player.exitKart();
    this.save();
    this.hud.setHint(false);
  }

  /** K: hop in wherever you are (the kart comes to you), or park it. */
  toggle() {
    if (!this.owned) {
      this.hud.toast('🏎️ You don’t have a kart yet. Kip sells one at the plaza stall!');
      return;
    }
    if (this.driving) {
      this.exit();
      return;
    }
    const p = this.island.player;
    if (p.pos.distanceTo(this.kart.pos) > 2.3) {
      this.island.effects.poof(this.kart.pos.clone(), 10, '#ffffff', 1);
      this.kart.park(p.pos.x, p.pos.z, p.facing);
      this.island.effects.poof(this.kart.pos.clone(), 14, '#ffffff', 1.2);
    }
    this.enter();
  }

  /** Every frame: keeps the saved parking spot fresh while driving. */
  update(dt: number) {
    if (!this.driving) return;
    this.saveTimer += dt;
    if (this.saveTimer > 4) {
      this.saveTimer = 0;
      this.save();
    }
  }

  private save() {
    this.pockets.parkKart(this.kart.pos.x, this.kart.pos.z, this.kart.heading);
  }

  private parkBeside() {
    const p = this.island.player;
    const side = new THREE.Vector3(Math.cos(p.facing), 0, -Math.sin(p.facing)).multiplyScalar(-2.2);
    const spot = p.findFree(p.pos.clone().add(side));
    this.kart.park(spot.x, spot.z, p.facing);
    this.save();
  }
}

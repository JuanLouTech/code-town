import * as THREE from 'three';
import { colorMat } from './engine.ts';

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
}

const puffGeo = new THREE.IcosahedronGeometry(0.28, 1);

/** Little cartoon smoke puffs for arrivals, departures and construction. */
export class Effects {
  group = new THREE.Group();
  private puffs: Puff[] = [];

  poof(at: THREE.Vector3, count = 10, color = '#ffffff', size = 1) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const mesh = new THREE.Mesh(puffGeo, colorMat(color));
      mesh.position.set(at.x + Math.cos(a) * 0.2, at.y + 0.4 + Math.random() * 0.4, at.z + Math.sin(a) * 0.2);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.5));
      this.group.add(mesh);
      const max = 0.6 + Math.random() * 0.4;
      this.puffs.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * 2.2, 1 + Math.random(), Math.sin(a) * 2.2).multiplyScalar(size), life: max, max });
    }
  }

  update(dt: number) {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.puffs.splice(i, 1);
        continue;
      }
      p.vel.multiplyScalar(1 - dt * 3);
      p.mesh.position.addScaledVector(p.vel, dt);
      const f = p.life / p.max;
      p.mesh.scale.multiplyScalar(f > 0.3 ? 1 + dt * 0.8 : 1 - dt * 6);
    }
  }
}

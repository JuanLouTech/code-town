import * as THREE from 'three';
import type { Look } from '../../../shared/protocol.ts';
import { ModelBuilder } from './builder.ts';
import { vertexMat } from './engine.ts';
import { EmoteBubble, toolMesh, type Emote } from './props.ts';

export type Action =
  | 'idle' | 'walk' | 'run' | 'sit' | 'hoe' | 'water' | 'read' | 'wave' | 'talk' | 'cheer' | 'hammer' | 'sad' | 'think'
  | 'fish' | 'net' | 'dig' | 'shake' | 'hold' | 'jump';

type V3 = [number, number, number];

const SKIN = '#f6d2b5';
const BLACK = '#2b2522';
const PINK = '#ff9fb2';
const WHITE = '#ffffff';

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function ball(mb: ModelBuilder, r: number, color: string, pos: V3, scale: V3 | number = 1) {
  mb.add(new THREE.SphereGeometry(r, 18, 14), color, pos, [0, 0, 0], scale);
}

function capsule(mb: ModelBuilder, r: number, len: number, color: string, pos: V3, rot: V3 = [0, 0, 0]) {
  mb.add(new THREE.CapsuleGeometry(r, len, 6, 12), color, pos, rot);
}

function eyes(mb: ModelBuilder, y = 0.12, spread = 0.16, z = 0.385, size = 0.065) {
  for (const s of [-1, 1]) {
    ball(mb, size, BLACK, [s * spread, y, z], [0.85, 1.25, 0.6]);
    ball(mb, size * 0.33, WHITE, [s * spread - 0.02, y + 0.035, z + 0.045]);
  }
}

function cheeks(mb: ModelBuilder, color = PINK, y = -0.03) {
  for (const s of [-1, 1]) ball(mb, 0.07, color, [s * 0.27, y, 0.33], [1.3, 0.7, 0.4]);
}

function buildHead(look: Look): ModelBuilder {
  const mb = new ModelBuilder();
  const fur = look.fur;
  const sp = look.species;
  const face = sp === 'human' || sp === 'gnome' ? (sp === 'gnome' ? '#f7c9a5' : SKIN) : sp === 'sheep' ? '#f3dfc9' : fur;
  ball(mb, 0.45, face, [0, 0.08, 0], [1.08, 0.95, 0.98]);

  const normalEyes = sp !== 'frog';
  if (normalEyes) eyes(mb, sp === 'gnome' ? 0.1 : 0.12, sp === 'gnome' ? 0.13 : 0.16, 0.385, sp === 'gnome' ? 0.05 : 0.065);
  if (sp !== 'penguin' && sp !== 'duck') cheeks(mb);

  switch (sp) {
    case 'cat':
      for (const s of [-1, 1]) {
        mb.add(new THREE.ConeGeometry(0.14, 0.28, 4), fur, [s * 0.24, 0.5, -0.02], [0, Math.PI / 4, -s * 0.28]);
        mb.add(new THREE.ConeGeometry(0.08, 0.16, 4), PINK, [s * 0.23, 0.47, 0.04], [0, Math.PI / 4, -s * 0.28]);
      }
      ball(mb, 0.04, PINK, [0, 0.02, 0.44]);
      break;
    case 'dog':
      for (const s of [-1, 1]) ball(mb, 0.17, shade(fur, 0.78), [s * 0.42, 0.06, -0.02], [0.5, 1.15, 0.8]);
      ball(mb, 0.16, look.accent, [0, -0.05, 0.37], [1.1, 0.78, 0.9]);
      ball(mb, 0.06, BLACK, [0, 0.02, 0.51]);
      break;
    case 'bear':
      for (const s of [-1, 1]) {
        ball(mb, 0.13, fur, [s * 0.3, 0.45, -0.02]);
        ball(mb, 0.07, shade(fur, 0.75), [s * 0.3, 0.45, 0.06]);
      }
      ball(mb, 0.15, shade(fur, 1.25), [0, -0.05, 0.37], [1.1, 0.8, 0.9]);
      ball(mb, 0.06, BLACK, [0, 0.01, 0.5]);
      break;
    case 'rabbit':
      for (const s of [-1, 1]) {
        capsule(mb, 0.08, 0.38, fur, [s * 0.14, 0.66, -0.04], [0, 0, -s * 0.15]);
        capsule(mb, 0.045, 0.28, PINK, [s * 0.14, 0.66, 0.02], [0, 0, -s * 0.15]);
      }
      ball(mb, 0.04, PINK, [0, 0.02, 0.44]);
      break;
    case 'frog':
      for (const s of [-1, 1]) {
        ball(mb, 0.15, fur, [s * 0.21, 0.42, 0.1]);
        ball(mb, 0.1, WHITE, [s * 0.21, 0.45, 0.19]);
        ball(mb, 0.06, BLACK, [s * 0.21, 0.46, 0.27], [1, 1.2, 0.6]);
      }
      mb.box(0.3, 0.025, 0.03, shade(fur, 0.55), [0, -0.08, 0.43]);
      break;
    case 'duck':
      ball(mb, 0.16, '#f5a623', [0, -0.02, 0.42], [1.3, 0.42, 1.0]);
      mb.add(new THREE.ConeGeometry(0.06, 0.2, 6), fur, [0, 0.57, 0], [0.3, 0, 0]);
      break;
    case 'mouse':
      for (const s of [-1, 1]) {
        ball(mb, 0.2, fur, [s * 0.34, 0.42, -0.05], [1, 1, 0.3]);
        ball(mb, 0.13, PINK, [s * 0.34, 0.42, -0.0], [1, 1, 0.3]);
      }
      ball(mb, 0.05, PINK, [0, 0.01, 0.45]);
      break;
    case 'fox':
      for (const s of [-1, 1]) {
        mb.add(new THREE.ConeGeometry(0.16, 0.36, 4), fur, [s * 0.25, 0.52, -0.02], [0, Math.PI / 4, -s * 0.25]);
        mb.add(new THREE.ConeGeometry(0.07, 0.12, 4), BLACK, [s * 0.3, 0.66, -0.02], [0, Math.PI / 4, -s * 0.25]);
      }
      mb.add(new THREE.ConeGeometry(0.14, 0.3, 10), WHITE, [0, -0.06, 0.46], [Math.PI / 2, 0, 0]);
      ball(mb, 0.05, BLACK, [0, -0.06, 0.61]);
      break;
    case 'pig':
      mb.add(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 14), shade(fur, 0.88), [0, -0.03, 0.44], [Math.PI / 2, 0, 0]);
      for (const s of [-1, 1]) ball(mb, 0.025, shade(fur, 0.5), [s * 0.045, -0.03, 0.5]);
      for (const s of [-1, 1]) mb.add(new THREE.ConeGeometry(0.1, 0.2, 4), fur, [s * 0.28, 0.44, 0.04], [0.5, 0, -s * 0.4]);
      break;
    case 'sheep':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ball(mb, 0.17, fur, [Math.cos(a) * 0.3, 0.38 + Math.sin(a * 2) * 0.04, Math.sin(a) * 0.25 - 0.08]);
      }
      ball(mb, 0.2, fur, [0, 0.5, -0.05]);
      for (const s of [-1, 1]) capsule(mb, 0.06, 0.16, '#e8cdb2', [s * 0.46, 0.08, 0], [0, 0, s * 1.2]);
      break;
    case 'koala':
      for (const s of [-1, 1]) {
        ball(mb, 0.22, fur, [s * 0.42, 0.32, -0.03], [1, 1, 0.5]);
        ball(mb, 0.14, '#f2f2f2', [s * 0.42, 0.32, 0.03], [1, 1, 0.4]);
      }
      ball(mb, 0.1, '#3b3b3b', [0, -0.01, 0.44], [0.85, 1.2, 0.6]);
      break;
    case 'penguin':
      ball(mb, 0.36, WHITE, [0, -0.02, 0.18], [1.1, 0.85, 0.6]);
      eyes(mb, 0.12, 0.15, 0.39);
      mb.add(new THREE.ConeGeometry(0.07, 0.18, 8), '#f5a623', [0, -0.02, 0.48], [Math.PI / 2, 0, 0]);
      cheeks(mb, '#ffb3c1');
      break;
    case 'human':
      ball(mb, 0.47, look.accent, [0, 0.2, -0.05], [1.1, 0.78, 1.05]);
      ball(mb, 0.22, look.accent, [0.12, 0.38, 0.28], [1.4, 0.5, 0.6]);
      ball(mb, 0.035, shade(SKIN, 0.85), [0, 0.0, 0.45]);
      break;
    case 'gnome':
      ball(mb, 0.1, '#ff9b8f', [0, -0.02, 0.45]);
      ball(mb, 0.3, '#fbfbfb', [0, -0.26, 0.24], [1.15, 1.0, 0.7]);
      ball(mb, 0.12, '#fbfbfb', [-0.14, -0.08, 0.38], [1.2, 0.5, 0.6]);
      ball(mb, 0.12, '#fbfbfb', [0.14, -0.08, 0.38], [1.2, 0.5, 0.6]);
      break;
  }

  switch (look.hat) {
    case 'straw':
      mb.add(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 20), '#f2d27a', [0, 0.42, 0], [-0.08, 0, 0]);
      mb.add(new THREE.CylinderGeometry(0.3, 0.34, 0.24, 16), '#f2d27a', [0, 0.54, -0.01], [-0.08, 0, 0]);
      mb.add(new THREE.CylinderGeometry(0.345, 0.345, 0.07, 16), '#d9534f', [0, 0.47, -0.01], [-0.08, 0, 0]);
      break;
    case 'cone':
      mb.add(new THREE.ConeGeometry(0.42, 0.85, 16), look.hatColor ?? '#e04848', [0, 0.72, -0.04], [-0.15, 0, 0]);
      mb.add(new THREE.TorusGeometry(0.4, 0.06, 6, 16), shade(look.hatColor ?? '#e04848', 0.85), [0, 0.33, -0.02], [Math.PI / 2 - 0.15, 0, 0]);
      break;
    case 'hardhat':
      mb.add(new THREE.SphereGeometry(0.48, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#f7c325', [0, 0.28, -0.02]);
      mb.add(new THREE.CylinderGeometry(0.56, 0.56, 0.05, 18), '#f7c325', [0, 0.3, 0.04]);
      break;
    case 'bow':
      for (const s of [-1, 1]) mb.add(new THREE.ConeGeometry(0.1, 0.2, 8), look.hatColor ?? '#ff6f91', [s * 0.13, 0.52, 0.02], [0, 0, s * Math.PI / 2]);
      ball(mb, 0.06, look.hatColor ?? '#ff6f91', [0, 0.52, 0.02]);
      break;
    case 'cap': {
      // Big enough to sit over the hair (which bulges out to ~0.52 at the sides and back).
      const c = look.hatColor ?? look.accent;
      mb.add(new THREE.SphereGeometry(0.53, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, [0, 0.21, -0.05], [0, 0, 0], [1.1, 0.95, 1.08]);
      mb.add(new THREE.CylinderGeometry(0.585, 0.585, 0.06, 20), shade(c, 0.85), [0, 0.22, -0.05], [0, 0, 0], [1, 1, 0.99]);
      mb.add(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 16, 1, false, -Math.PI / 2, Math.PI), c, [0, 0.24, 0.5], [0.12, 0, 0], [1.25, 1, 1]);
      mb.sphere(0.06, shade(c, 0.8), [0, 0.72, -0.05], 1, 1);
      break;
    }
    default:
      break;
  }
  return mb;
}

function buildTorso(look: Look): ModelBuilder {
  const mb = new ModelBuilder();
  ball(mb, 0.32, look.shirt, [0, 0.62, 0], [1, 1.05, 0.85]);
  mb.add(new THREE.CylinderGeometry(0.3, 0.33, 0.12, 16), shade(look.shirt, 0.85), [0, 0.42, 0]);
  if (look.species === 'penguin') ball(mb, 0.22, WHITE, [0, 0.6, 0.12], [1, 1.1, 0.6]);
  if (look.species === 'human') ball(mb, 0.26, '#6b83b5', [0, 0.44, 0], [1.2, 0.5, 1.05]);
  const back = -0.26;
  switch (look.species) {
    case 'cat':
      mb.add(new THREE.TorusGeometry(0.22, 0.05, 6, 12, Math.PI * 1.1), look.fur, [0, 0.62, back - 0.12], [0, Math.PI / 2, -0.4]);
      break;
    case 'dog':
    case 'bear':
      ball(mb, 0.09, look.fur, [0, 0.45, back], 1);
      break;
    case 'rabbit':
    case 'sheep':
      ball(mb, 0.12, WHITE, [0, 0.45, back]);
      break;
    case 'fox':
      ball(mb, 0.18, look.fur, [0, 0.46, back - 0.2], [0.8, 0.8, 1.6]);
      ball(mb, 0.1, WHITE, [0, 0.46, back - 0.46], [0.9, 0.9, 1.2]);
      break;
    case 'mouse':
      mb.add(new THREE.TorusGeometry(0.25, 0.025, 5, 12, Math.PI), PINK, [0, 0.5, back - 0.2], [0, Math.PI / 2, 0.4]);
      break;
    case 'pig':
      mb.add(new THREE.TorusGeometry(0.06, 0.02, 5, 10), shade(look.fur, 0.9), [0, 0.5, back - 0.02], [0, 0, 0]);
      break;
    default:
      break;
  }
  return mb;
}

function buildArm(look: Look, side: 1 | -1): ModelBuilder {
  const mb = new ModelBuilder();
  const skin = look.species === 'human' ? SKIN : look.species === 'gnome' ? '#f7c9a5' : look.fur;
  ball(mb, 0.1, look.shirt, [0, -0.03, 0]);
  capsule(mb, 0.075, 0.2, look.species === 'penguin' ? look.fur : skin, [0, -0.17, 0]);
  ball(mb, 0.085, look.species === 'duck' || look.species === 'penguin' ? look.fur : skin, [0, -0.33, 0]);
  void side;
  return mb;
}

function buildLeg(look: Look): ModelBuilder {
  const mb = new ModelBuilder();
  const leg = look.species === 'human' ? '#6b83b5' : look.species === 'gnome' ? '#5a7bbf' : look.fur;
  capsule(mb, 0.1, 0.14, leg, [0, -0.17, 0]);
  const foot = look.species === 'duck' || look.species === 'penguin' ? '#f5a623'
    : look.species === 'human' ? '#e0645c' : look.species === 'gnome' ? '#6b4a33' : shade(look.fur, 0.85);
  ball(mb, 0.1, foot, [0, -0.31, 0.04], [1, 0.6, 1.35]);
  return mb;
}

function meshOf(mb: ModelBuilder) {
  const m = new THREE.Mesh(mb.build(), vertexMat);
  m.castShadow = true;
  return m;
}

const tmpQuat = new THREE.Quaternion();

export class Character {
  root = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  handL = new THREE.Group();
  handR = new THREE.Group();
  emote: EmoteBubble;
  action: Action = 'idle';
  actionTime = 0;
  seatY = 0;
  rock = 0; // external lean (rocking chair)
  private phase = Math.random() * 10;
  private toolKind: string | null = null;
  private tool?: THREE.Object3D;
  private seed = Math.random() * 100;

  constructor(public look: Look, public scale = 1) {
    this.root.add(this.body);
    this.body.add(meshOf(buildTorso(look)));
    this.head.position.set(0, 1.12, 0);
    this.head.add(meshOf(buildHead(look)));
    this.body.add(this.head);
    for (const [arm, hand, side] of [[this.armL, this.handL, 1], [this.armR, this.handR, -1]] as const) {
      arm.position.set(side * 0.31, 0.8, 0);
      arm.add(meshOf(buildArm(look, side)));
      hand.position.set(0, -0.34, 0);
      arm.add(hand);
      this.body.add(arm);
    }
    for (const [leg, side] of [[this.legL, 1], [this.legR, -1]] as const) {
      leg.position.set(side * 0.13, 0.36, 0);
      leg.add(meshOf(buildLeg(look)));
      this.body.add(leg);
    }
    this.root.scale.setScalar(scale);
    this.emote = new EmoteBubble(this.root, 2.25);
  }

  setAction(a: Action) {
    if (a === this.action) return;
    this.action = a;
    this.actionTime = 0;
    const tool = a === 'hoe' ? 'hoe' : a === 'water' ? 'can' : a === 'read' ? 'clipboard' : a === 'hammer' || a === 'dig' ? 'shovel'
      : a === 'fish' ? 'rod' : a === 'net' ? 'net' : null;
    this.setTool(tool as never);
  }

  setTool(kind: 'hoe' | 'can' | 'clipboard' | 'shovel' | 'hammer' | 'rod' | 'net' | null) {
    if (kind === this.toolKind) return;
    this.toolKind = kind;
    if (this.tool) {
      this.tool.parent?.remove(this.tool);
      this.tool = undefined;
    }
    if (!kind) return;
    this.tool = toolMesh(kind);
    if (kind === 'clipboard') {
      this.tool.position.set(-0.05, -0.08, 0.12);
      this.tool.rotation.set(0.35, 0, 0);
      this.handL.add(this.tool);
    } else if (kind === 'can') {
      this.handR.add(this.tool);
    } else if (kind === 'rod' || kind === 'net') {
      // Rod: forward and up out of the fist (arm is raised ~70°). Net: straight along the arm.
      this.tool.rotation.set(kind === 'rod' ? 2.3 : Math.PI, 0, 0);
      this.handR.add(this.tool);
    } else {
      this.tool.rotation.set(0, 0, 0);
      this.handR.add(this.tool);
    }
  }

  /** World position of the fishing-rod tip (for the line), if holding one. */
  rodTip(out = new THREE.Vector3()) {
    if (this.toolKind !== 'rod' || !this.tool) return undefined;
    this.tool.updateWorldMatrix(true, false);
    return this.tool.localToWorld(out.set(0, 1.95, 0));
  }

  setEmote(kind: Emote | null, t: number) {
    this.emote.set(kind, t);
  }

  get position() {
    return this.root.position;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    this.actionTime += dt;
    const k = 1 - Math.exp(-dt * 12);
    const s = t + this.seed;
    let legL = 0, legR = 0, armLx = 0, armLz = 0.16, armRx = 0, armRz = -0.16;
    let bodyY = 0, lean = 0, headX = 0, headY = 0, headZ = 0;

    switch (this.action) {
      case 'idle':
        bodyY = Math.sin(s * 2.2) * 0.012;
        headZ = Math.sin(s * 0.7) * 0.06;
        headY = Math.sin(s * 0.33) * 0.15;
        break;
      case 'walk':
      case 'run': {
        const run = this.action === 'run';
        this.phase += dt * (run ? 13 : 9);
        const sw = Math.sin(this.phase);
        legL = sw * (run ? 0.9 : 0.65);
        legR = -legL;
        armLx = -sw * (run ? 0.9 : 0.55);
        armRx = sw * (run ? 0.9 : 0.55);
        bodyY = Math.abs(Math.cos(this.phase)) * (run ? 0.1 : 0.06);
        lean = run ? 0.16 : 0.06;
        break;
      }
      case 'sit':
        legL = legR = -1.45;
        armLx = armRx = -0.45;
        armLz = 0.25; armRz = -0.25;
        bodyY = this.seatY;
        lean = -0.12 + this.rock;
        headZ = Math.sin(s * 0.5) * 0.08;
        headX = -0.05 + Math.sin(s * 0.4) * 0.05;
        break;
      case 'hoe': {
        const cyc = (s * 1.3) % 1;
        const up = cyc < 0.55 ? THREE.MathUtils.smoothstep(cyc, 0, 0.55) : 1 - THREE.MathUtils.smoothstep(cyc, 0.55, 0.7);
        armLx = armRx = -0.5 - up * 2.1;
        armLz = 0.05; armRz = -0.05;
        lean = 0.25 - up * 0.3;
        bodyY = -0.04 + up * 0.03;
        headX = 0.25 - up * 0.2;
        legL = 0.25; legR = -0.2;
        break;
      }
      case 'hammer': {
        const cyc = (s * 2.2) % 1;
        const up = cyc < 0.6 ? cyc / 0.6 : 1 - (cyc - 0.6) / 0.4;
        armRx = -0.6 - up * 1.8;
        armLx = -0.6;
        lean = 0.35;
        bodyY = -0.12;
        legL = -0.6; legR = 0.3;
        headX = 0.3;
        break;
      }
      case 'water':
        armRx = -1.0 + Math.sin(s * 2) * 0.08;
        armRz = -0.3;
        armLx = -0.2;
        lean = 0.12;
        headX = 0.25;
        bodyY = Math.sin(s * 3) * 0.015;
        break;
      case 'read':
        armLx = -1.25;
        armLz = -0.25;
        armRx = -1.05 + Math.sin(s * 7) * 0.08;
        armRz = 0.3;
        headX = 0.32 + Math.sin(s * 0.8) * 0.05;
        headY = Math.sin(s * 0.9) * 0.18;
        bodyY = Math.sin(s * 1.8) * 0.01;
        break;
      case 'wave':
        armRz = -2.7 + Math.sin(s * 10) * 0.35;
        armRx = -0.2;
        armLz = 0.25;
        bodyY = Math.abs(Math.sin(s * 5)) * 0.08;
        headZ = Math.sin(s * 5) * 0.1;
        break;
      case 'talk':
        headX = Math.sin(s * 6) * 0.07;
        headZ = Math.sin(s * 2.5) * 0.08;
        armRx = -0.5 + Math.sin(s * 3) * 0.3;
        armLx = -0.3 + Math.cos(s * 2.6) * 0.2;
        bodyY = Math.abs(Math.sin(s * 4)) * 0.03;
        break;
      case 'cheer':
        armLz = 2.6 + Math.sin(s * 12) * 0.2;
        armRz = -2.6 - Math.sin(s * 12) * 0.2;
        bodyY = Math.abs(Math.sin(s * 7)) * 0.35;
        headX = -0.15;
        break;
      case 'sad':
        headX = 0.35;
        armLz = 0.05; armRz = -0.05;
        lean = 0.1;
        bodyY = Math.sin(s * 1.2) * 0.01;
        break;
      case 'fish':
        armRx = -1.25 + Math.sin(s * 1.5) * 0.05;
        armRz = 0.15;
        armLx = -1.0;
        armLz = -0.3;
        lean = -0.05;
        headX = 0.12;
        bodyY = Math.sin(s * 1.2) * 0.01;
        break;
      case 'net': {
        const k = Math.min(1, this.actionTime / 0.45);
        armRx = -2.6 + k * 2.2;
        armRz = 0.2;
        armLx = -1.2 + k * 0.8;
        lean = k * 0.3;
        break;
      }
      case 'dig': {
        const cyc = (s * 1.8) % 1;
        const up = cyc < 0.5 ? cyc / 0.5 : 1 - (cyc - 0.5) / 0.5;
        armRx = -0.4 - up * 1.4;
        armLx = -0.4 - up * 1.2;
        lean = 0.3 + up * 0.1;
        bodyY = -0.08;
        headX = 0.3;
        break;
      }
      case 'shake':
        armRx = armLx = -1.5;
        armRz = 0.25;
        armLz = -0.25;
        lean = 0.12 + Math.sin(s * 30) * 0.06;
        bodyY = Math.abs(Math.sin(s * 30)) * 0.03;
        break;
      case 'hold':
        armRz = -2.9;
        armLz = 2.9;
        armRx = armLx = -0.2;
        bodyY = Math.abs(Math.sin(s * 6)) * 0.12;
        headX = -0.2;
        break;
      case 'jump':
        legL = -0.7;
        legR = 0.35;
        armLz = 1.1;
        armRz = -1.1;
        armLx = armRx = -0.3;
        headX = -0.12;
        break;
      case 'think':
        armRx = -1.6;
        armRz = 0.5;
        armLx = -0.6;
        armLz = -0.3;
        headZ = 0.2 + Math.sin(s * 0.8) * 0.05;
        headX = -0.15;
        break;
    }

    const L = (cur: number, target: number) => cur + (target - cur) * k;
    this.legL.rotation.x = L(this.legL.rotation.x, legL);
    this.legR.rotation.x = L(this.legR.rotation.x, legR);
    this.armL.rotation.x = L(this.armL.rotation.x, armLx);
    this.armL.rotation.z = L(this.armL.rotation.z, armLz);
    this.armR.rotation.x = L(this.armR.rotation.x, armRx);
    this.armR.rotation.z = L(this.armR.rotation.z, armRz);
    this.body.position.y = L(this.body.position.y, bodyY);
    this.body.rotation.x = L(this.body.rotation.x, lean);
    this.head.rotation.x = L(this.head.rotation.x, headX);
    this.head.rotation.y = L(this.head.rotation.y, headY);
    this.head.rotation.z = L(this.head.rotation.z, headZ);

    this.root.getWorldQuaternion(tmpQuat);
    this.emote.update(t, camera, tmpQuat);
  }
}

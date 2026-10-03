import * as THREE from 'three';
import { colorMat, curved, vertexMat } from './engine.ts';
import { ModelBuilder } from './builder.ts';

export const FONT = '"Nunito", ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

const WOOD = '#b98553';
const WOOD_DARK = '#8a5a35';
const WOOD_LIGHT = '#e9cf9f';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws text onto a canvas texture, shrinking the font until it fits. */
export function textTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; sub?: string; border?: string } = {}) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  roundRect(ctx, 6, 6, w - 12, h - 12, 28);
  ctx.fillStyle = opts.bg ?? WOOD_LIGHT;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = opts.border ?? WOOD_DARK;
  ctx.stroke();
  ctx.fillStyle = opts.fg ?? '#5b3a1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = opts.sub ? h * 0.36 : h * 0.44;
  do {
    ctx.font = `800 ${size}px ${FONT}`;
    size -= 2;
  } while (ctx.measureText(text).width > w - 48 && size > 14);
  ctx.fillText(text, w / 2, opts.sub ? h * 0.4 : h / 2 + 2);
  if (opts.sub) {
    ctx.font = `700 ${h * 0.2}px ${FONT}`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(opts.sub, w / 2, h * 0.74);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A wooden signpost with a name board. Origin at the base of the post. */
export function makeSign(text: string, opts: { sub?: string; width?: number; height?: number; posts?: 0 | 1 | 2; bg?: string } = {}) {
  const width = opts.width ?? 3.2;
  const height = opts.height ?? 1.0;
  const g = new THREE.Group();
  const mb = new ModelBuilder();
  const boardY = 1.35;
  const posts = opts.posts ?? 1;
  if (posts === 2) {
    mb.box(0.16, boardY + height / 2, 0.16, WOOD_DARK, [-width / 2 + 0.25, (boardY + height / 2) / 2, -0.24]);
    mb.box(0.16, boardY + height / 2, 0.16, WOOD_DARK, [width / 2 - 0.25, (boardY + height / 2) / 2, -0.24]);
  } else if (posts === 1) {
    mb.box(0.18, boardY, 0.18, WOOD_DARK, [0, boardY / 2, -0.25]);
  }
  mb.box(width + 0.12, height + 0.12, 0.1, WOOD, [0, boardY, -0.1]);
  const post = new THREE.Mesh(mb.build(), vertexMat);
  post.castShadow = true;
  g.add(post);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    curved(new THREE.MeshLambertMaterial({ map: textTexture(text, { sub: opts.sub, bg: opts.bg, h: Math.round(512 * height / width) }), transparent: true })),
  );
  face.position.set(0, boardY, -0.04);
  g.add(face);
  return g;
}

/** Rocking chair as its own object so it can rock while someone sits in it. */
export function makeRockingChair(color = WOOD) {
  const mb = new ModelBuilder();
  for (const x of [-0.32, 0.32]) {
    // A shallow arc centred under the seat: rotate it to the bottom of the circle, then into the YZ plane.
    const runner = new THREE.TorusGeometry(0.9, 0.04, 6, 16, 1.1);
    mb.add(runner, WOOD_DARK, [x, 0.94, 0.02], [0, Math.PI / 2, Math.PI * 1.5 - 0.55]);
    mb.box(0.07, 0.5, 0.07, color, [x, 0.3, 0.25]);
    mb.box(0.07, 0.5, 0.07, color, [x, 0.3, -0.2]);
    mb.box(0.07, 0.95, 0.07, color, [x, 0.95, -0.28], [-0.2, 0, 0]);
    mb.box(0.07, 0.07, 0.55, color, [x, 0.78, 0.0]);
  }
  mb.box(0.7, 0.08, 0.6, color, [0, 0.55, 0.02]);
  mb.box(0.7, 0.55, 0.06, color, [0, 1.1, -0.3], [-0.2, 0, 0]);
  mb.box(0.6, 0.1, 0.5, '#e86f6f', [0, 0.62, 0.03]);
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(mb.build(), vertexMat);
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

// --- Emote bubbles ----------------------------------------------------------------

export type Emote = 'alert' | 'question' | 'error' | 'think' | 'read' | 'write' | 'zzz' | 'note' | 'heart';

const emoteTextures = new Map<Emote, THREE.Texture>();

function emoteTexture(kind: Emote) {
  let tex = emoteTextures.get(kind);
  if (tex) return tex;
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const big = kind === 'alert' || kind === 'question' || kind === 'error';
  ctx.fillStyle = big ? (kind === 'alert' ? '#fff7d6' : kind === 'error' ? '#ffe1e1' : '#fff0e0') : '#ffffff';
  ctx.strokeStyle = big ? (kind === 'alert' ? '#f2a516' : kind === 'error' ? '#e05252' : '#ef7d2d') : '#c9b99a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2 - 8, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s / 2 - 12, s / 2 + 34);
  ctx.lineTo(s / 2, s / 2 + 56);
  ctx.lineTo(s / 2 + 12, s / 2 + 34);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyph: Record<Emote, string> = {
    alert: '!', question: '!', error: '!', think: '💭', read: '📖', write: '🔨', zzz: '💤', note: '♪', heart: '💗',
  };
  if (big) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `900 76px ${FONT}`;
  } else {
    ctx.font = `56px ${FONT}`;
    ctx.fillStyle = '#6b5a45';
  }
  ctx.fillText(glyph[kind], s / 2, s / 2 - 4);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  emoteTextures.set(kind, tex);
  return tex;
}

const emoteMats = new Map<Emote, THREE.MeshBasicMaterial>();
const emoteGeo = new THREE.PlaneGeometry(1, 1);

export class EmoteBubble {
  mesh: THREE.Mesh;
  kind: Emote | null = null;
  private born = 0;

  constructor(parent: THREE.Object3D, private height: number) {
    this.mesh = new THREE.Mesh(emoteGeo);
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    parent.add(this.mesh);
  }

  set(kind: Emote | null, t: number) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.born = t;
    if (!kind) {
      this.mesh.visible = false;
      return;
    }
    let mat = emoteMats.get(kind);
    if (!mat) {
      mat = curved(new THREE.MeshBasicMaterial({ map: emoteTexture(kind), transparent: true, depthTest: false, fog: false }));
      emoteMats.set(kind, mat);
    }
    this.mesh.material = mat;
    this.mesh.visible = true;
  }

  update(t: number, camera: THREE.Camera, parentWorldQuat: THREE.Quaternion) {
    if (!this.kind) return;
    const big = this.kind === 'alert' || this.kind === 'question' || this.kind === 'error';
    const age = t - this.born;
    const pop = Math.min(1, age * 5);
    const bounce = big ? Math.abs(Math.sin(t * 5)) * 0.18 : Math.sin(t * 2) * 0.05;
    const s = (big ? 0.95 : 0.7) * (0.6 + 0.4 * pop);
    this.mesh.scale.setScalar(s);
    this.mesh.position.set(0, this.height + bounce, 0);
    // Billboard: cancel the parent's rotation, then face the camera.
    this.mesh.quaternion.copy(parentWorldQuat).invert().multiply(camera.quaternion);
  }
}

// --- Farm plot with growing crops --------------------------------------------------

export const CROP_ROWS = [3.0, 4.6, 6.2];
export const CROP_COLS = [-6.6, -5.2, -3.8, -2.4];

type CropKind = 'pumpkin' | 'carrot' | 'tomato' | 'flower' | 'cabbage';

function cropMesh(kind: CropKind, stage: number) {
  const mb = new ModelBuilder();
  for (const z of CROP_ROWS) {
    for (const x of CROP_COLS) {
      const jx = x + Math.sin(x * 3 + z) * 0.08;
      if (stage === 0) {
        mb.sphere(0.1, '#6fbf4a', [jx, 0.32, z], [1, 0.6, 1], 0);
        continue;
      }
      const leaf = stage >= 2 ? '#4fa83a' : '#72c24c';
      const lh = 0.2 + stage * 0.12;
      mb.cone(0.12 + stage * 0.05, lh, leaf, [jx - 0.1, 0.3 + lh / 2, z], [0, 0, 0.5], 5);
      mb.cone(0.12 + stage * 0.05, lh, leaf, [jx + 0.1, 0.3 + lh / 2, z], [0, 0, -0.5], 5);
      if (stage >= 3) {
        switch (kind) {
          case 'pumpkin': mb.sphere(0.3, '#f28c28', [jx, 0.48, z + 0.1], [1.2, 0.85, 1.1], 1); break;
          case 'carrot': mb.cone(0.1, 0.25, '#f07b2c', [jx, 0.34, z], [Math.PI, 0, 0], 6); break;
          case 'tomato': mb.sphere(0.13, '#e8423b', [jx + 0.12, 0.62, z], 1, 1).sphere(0.12, '#e8423b', [jx - 0.12, 0.55, z], 1, 1); break;
          case 'flower': mb.sphere(0.16, ['#ff7eb6', '#ffd94a', '#ffffff', '#a78bfa'][Math.abs(Math.round(x * 3)) % 4], [jx, 0.78, z], [1, 0.5, 1], 1); break;
          case 'cabbage': mb.sphere(0.28, '#9ad66b', [jx, 0.45, z], [1, 0.8, 1], 1); break;
        }
      }
    }
  }
  const mesh = new THREE.Mesh(mb.build(), vertexMat);
  mesh.castShadow = true;
  return mesh;
}

export class Farm {
  group = new THREE.Group();
  private stages: THREE.Mesh[] = [];
  stage = -1;

  constructor(seed: number) {
    const mb = new ModelBuilder();
    const x0 = CROP_COLS[0] - 0.8, x1 = CROP_COLS[CROP_COLS.length - 1] + 0.8;
    const z0 = CROP_ROWS[0] - 0.8, z1 = CROP_ROWS[CROP_ROWS.length - 1] + 0.8;
    mb.box(x1 - x0, 0.2, z1 - z0, '#8a5b3b', [(x0 + x1) / 2, 0.1, (z0 + z1) / 2]);
    for (const z of CROP_ROWS) mb.box(x1 - x0 - 0.3, 0.14, 0.55, '#6f4529', [(x0 + x1) / 2, 0.24, z]);
    // Little border of logs.
    mb.box(x1 - x0 + 0.3, 0.22, 0.18, WOOD_DARK, [(x0 + x1) / 2, 0.11, z0 - 0.05]);
    mb.box(x1 - x0 + 0.3, 0.22, 0.18, WOOD_DARK, [(x0 + x1) / 2, 0.11, z1 + 0.05]);
    mb.box(0.18, 0.22, z1 - z0, WOOD_DARK, [x0 - 0.05, 0.11, (z0 + z1) / 2]);
    mb.box(0.18, 0.22, z1 - z0, WOOD_DARK, [x1 + 0.05, 0.11, (z0 + z1) / 2]);
    const soil = new THREE.Mesh(mb.build(), vertexMat);
    soil.receiveShadow = true;
    this.group.add(soil);
    const kinds: CropKind[] = ['pumpkin', 'carrot', 'tomato', 'flower', 'cabbage'];
    const kind = kinds[seed % kinds.length];
    for (let s = 0; s < 4; s++) {
      const m = cropMesh(kind, s);
      m.visible = false;
      this.stages.push(m);
      this.group.add(m);
    }
    this.setStage(0);
  }

  setStage(stage: number) {
    stage = Math.max(0, Math.min(3, stage));
    if (stage === this.stage) return;
    this.stage = stage;
    this.stages.forEach((m, i) => (m.visible = i === stage));
  }
}

export function toolMesh(kind: 'hoe' | 'can' | 'clipboard' | 'shovel' | 'hammer' | 'rod' | 'net'): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, colorMat(color));
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    g.add(m);
  };
  switch (kind) {
    case 'hoe':
      add(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), WOOD, [0, -0.2, 0]);
      add(new THREE.BoxGeometry(0.28, 0.06, 0.16), '#9aa5ad', [0.06, -0.74, 0.06]);
      break;
    case 'shovel':
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), WOOD, [0, -0.15, 0]);
      add(new THREE.BoxGeometry(0.2, 0.26, 0.04), '#9aa5ad', [0, -0.66, 0]);
      break;
    case 'hammer':
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), WOOD, [0, -0.12, 0]);
      add(new THREE.BoxGeometry(0.22, 0.1, 0.1), '#7d8790', [0, -0.34, 0]);
      break;
    case 'can':
      add(new THREE.CylinderGeometry(0.14, 0.16, 0.26, 10), '#5fb3e8', [0, -0.12, 0.06]);
      add(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 6), '#5fb3e8', [0, -0.1, 0.26], [1.1, 0, 0]);
      break;
    case 'rod':
      add(new THREE.CylinderGeometry(0.02, 0.035, 2.0, 6), '#8a5a35', [0, 0.95, 0]);
      add(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10), '#9aa5ad', [0.06, 0.15, 0], [0, 0, Math.PI / 2]);
      add(new THREE.SphereGeometry(0.03, 6, 4), '#e8423b', [0, 1.95, 0]);
      break;
    case 'net':
      add(new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6), '#b98553', [0, 0.6, 0]);
      add(new THREE.TorusGeometry(0.28, 0.025, 6, 16), '#9aa5ad', [0, 1.5, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.ConeGeometry(0.27, 0.5, 12, 1, true), '#fffaf0', [0, 1.28, 0], [Math.PI, 0, 0]);
      break;
    case 'clipboard':
      add(new THREE.BoxGeometry(0.42, 0.5, 0.03), WOOD_DARK, [0, 0, 0]);
      add(new THREE.BoxGeometry(0.36, 0.42, 0.012), '#fffdf5', [0, -0.02, 0.02]);
      add(new THREE.BoxGeometry(0.16, 0.05, 0.04), '#c0c6cc', [0, 0.24, 0.02]);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.26, 0.018, 0.005), '#9fb4c7', [0, 0.1 - i * 0.08, 0.028]);
      break;
  }
  return g;
}

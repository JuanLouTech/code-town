import * as THREE from 'three';

/** Strength of the "rolling log" bend applied to everything drawn in view space. */
export const curve = { value: 0.0021 };

/** How far away things are still drawn (world units); the fog ends there. Set from the options. */
export const view = { distance: 180 };

const CURVE_GLSL = 'mvPosition.y -= uCurve * mvPosition.z * mvPosition.z;\n';

/** Bends a material's vertices downwards with distance from the camera, for a rolling-globe horizon. */
export function curved<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uCurve = curve;
    shader.vertexShader = 'uniform float uCurve;\n' + shader.vertexShader;
    if (shader.vertexShader.includes('#include <project_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n' + CURVE_GLSL + 'gl_Position = projectionMatrix * mvPosition;',
      );
    }
  };
  mat.customProgramCacheKey = () => 'curved';
  return mat;
}

/** Applies the same bend on the CPU (used to place HTML overlays over bent geometry). */
export function curvedProject(world: THREE.Vector3, camera: THREE.Camera, out = new THREE.Vector3()) {
  out.copy(world).applyMatrix4(camera.matrixWorldInverse);
  out.y -= curve.value * out.z * out.z;
  return out.applyMatrix4(camera.projectionMatrix);
}

const matCache = new Map<string, THREE.Material>();

/** Time and night-ness shared by the island's shaders. */
export const world = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uGlowColor: { value: new THREE.Color('#ffd27a') },
};

/**
 * Shared Lambert material for merged, vertex-coloured static geometry. Two
 * extra per-vertex attributes: `sway` (foliage bending in the wind) and
 * `glow` (windows and lamps that light up at night).
 */
function makeVertexMat(params: THREE.MeshLambertMaterialParameters = {}) {
  const mat = curved(new THREE.MeshLambertMaterial({ vertexColors: true, ...params }));
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.uTime = world.uTime;
    shader.uniforms.uNight = world.uNight;
    shader.uniforms.uGlowColor = world.uGlowColor;
    shader.vertexShader = 'uniform float uTime;\nattribute float sway;\nattribute float glow;\nvarying float vGlow;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = glow;
        if (sway > 0.0) {
          vec4 swayWorld = modelMatrix * vec4(transformed, 1.0);
          float lift = max(0.0, transformed.y - 0.6);
          float phase = uTime * 1.7 + swayWorld.x * 0.31 + swayWorld.z * 0.23;
          transformed.x += sin(phase) * sway * lift * 0.028;
          transformed.z += cos(phase * 0.8) * sway * lift * 0.018;
        }`);
    shader.fragmentShader = 'uniform float uNight;\nuniform vec3 uGlowColor;\nvarying float vGlow;\n' +
      shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, uGlowColor, vGlow * uNight);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uGlowColor * vGlow * uNight * 1.15;');
    prev?.call(mat, shader, renderer);
  };
  mat.customProgramCacheKey = () => 'curved-sway-glow';
  return mat;
}

/**
 * Shared Lambert material for merged, vertex-coloured static geometry. Two
 * extra per-vertex attributes: `sway` (foliage bending in the wind) and
 * `glow` (windows and lamps that light up at night).
 */
export const vertexMat = makeVertexMat();
/** The same look, see-through: for houses standing between the camera and the player. */
export const fadedMat = makeVertexMat({ transparent: true, opacity: 0.22, depthWrite: false });

/** Cached flat colour materials for characters and props. */
export function colorMat(color: THREE.ColorRepresentation, opts: { emissive?: number } = {}): THREE.MeshLambertMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opts.emissive ?? 0}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = curved(new THREE.MeshLambertMaterial({ color }));
    if (opts.emissive) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = opts.emissive;
    }
    matCache.set(key, m);
  }
  return m;
}

/**
 * Frustum culling that knows about the bend. three.js culls against where things really are, but
 * the shader draws them lower the farther away they are, so far houses and trees that bend into
 * view were skipped until you walked up to them, and then popped in. While the main camera culls,
 * each bounding sphere is tested where it's actually drawn, and anything past the view distance is
 * skipped. Shadow culling is left alone (shadow maps aren't bent).
 */
function bendAwareCulling(scene: THREE.Scene, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
  const drawn = new THREE.Frustum();
  const sphere = new THREE.Sphere();
  let active = false;
  const original = THREE.Frustum.prototype.intersectsObject;
  THREE.Frustum.prototype.intersectsObject = function (object) {
    if (!active) return original.call(this, object);
    const own = (object as unknown as { boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void });
    if (own.boundingSphere !== undefined) {
      if (own.boundingSphere === null) own.computeBoundingSphere?.();
      sphere.copy(own.boundingSphere!);
    } else {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      sphere.copy(geometry.boundingSphere!);
    }
    sphere.applyMatrix4(object.matrixWorld);
    sphere.center.applyMatrix4(camera.matrixWorldInverse);
    const depth = -sphere.center.z, r = sphere.radius;
    if (depth - r > view.distance) return false;
    // Bend the centre like the shader does; the bend varies across the sphere, so grow it to cover that.
    sphere.center.y -= curve.value * depth * depth;
    sphere.radius = r + curve.value * (2 * Math.abs(depth) * r + r * r);
    return drawn.intersectsSphere(sphere);
  };
  scene.onBeforeRender = () => {
    camera.updateMatrixWorld();
    drawn.setFromProjectionMatrix(camera.projectionMatrix);
    active = true;
  };
  scene.onAfterRender = () => {
    active = false;
  };
  const renderShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  renderer.shadowMap.render = (...args: Parameters<typeof renderShadows>) => {
    const was = active;
    active = false;
    try {
      renderShadows(...args);
    } finally {
      active = was;
    }
  };
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  timer = new THREE.Timer();
  /** How far ahead of the player (towards the horizon) the shadow box is centred. */
  private shadowAhead = 18;
  private tickers: ((dt: number, t: number) => void)[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 600);
    this.scene.fog = new THREE.Fog(0xcfeeff, view.distance * 0.42, view.distance);
    bendAwareCulling(this.scene, this.renderer, this.camera);

    this.hemi = new THREE.HemisphereLight(0xdff3ff, 0x8cc26b, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 1; s.far = 160;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
  }

  /** Shadow range around the player (world units) and shadow map resolution; `extent` 0 turns shadows off. */
  setShadows(extent: number, mapSize: number) {
    this.sun.castShadow = extent > 0;
    if (!extent) return;
    const s = this.sun.shadow;
    if (s.mapSize.x !== mapSize) {
      s.mapSize.set(mapSize, mapSize);
      s.map?.dispose();
      s.map = null;
    }
    s.camera.left = s.camera.bottom = -extent;
    s.camera.right = s.camera.top = extent;
    s.camera.far = extent * 2 + 70;
    s.camera.updateProjectionMatrix();
    // The camera looks north: spend most of the shadow box in front of the player, not behind.
    this.shadowAhead = extent * 0.4;
  }

  setPixelRatio(ratio: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    this.resize();
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onTick(fn: (dt: number, t: number) => void) {
    this.tickers.push(fn);
  }

  /** Keeps the shadow frustum centred on whatever the camera is following. */
  followLight(target: THREE.Vector3) {
    const z = target.z - this.shadowAhead;
    this.sun.target.position.set(target.x, target.y, z);
    this.sun.position.set(target.x - 30, target.y + 60, z + 25);
  }

  start() {
    const loop = (now?: number) => {
      this.timer.update(now);
      const dt = Math.min(this.timer.getDelta(), 0.1);
      const t = this.timer.getElapsed();
      for (const fn of this.tickers) fn(dt, t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }
}

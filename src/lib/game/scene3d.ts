// True-scale 3D render of the generated terrain from a standing viewpoint. Browser only.

import * as THREE from 'three';
import {
  N, W, CELL, OW, OUT_CELL, OUT_ORIGIN, OUT_PAD, OUT_STEP, VFOV, ASPECT, MAP_SIZE,
} from './constants';
import { clamp, smoothstep } from './math';
import { mulberry32, type Rng } from './noise';
import type { Terrain } from './terrain';
import type { Viewpoint } from './viewpoint';

const hex = (v: number) => new THREE.Color(v);
const PAL = {
  forest: hex(0x263b1f), forest2: hex(0x32482a),
  meadow: hex(0x6a7442), meadow2: hex(0x80804e), dry: hex(0x968862),
  rock: hex(0x8a8076), rockDark: hex(0x625a52), scree: hex(0x9c9284),
  ice: hex(0xdfeaf1), iceBlue: hex(0xb9d3e2),
  shore: hex(0x7d7258), sand: hex(0xcdbb8e),
  marsh: hex(0x59593a), marsh2: hex(0x6d6845),
  dam: hex(0x95918a),
  water: hex(0x1f4458), foam: hex(0xe9f0f2),
};

interface GroundSample {
  h: number; slope: number; veg: number; wetShore: number; noise: number;
  glacier: number; marsh: number; dam: boolean; coastal: boolean;
}

function groundColor(out: THREE.Color, s: GroundSample, minH: number, maxH: number) {
  const e = (s.h - minH) / (maxH - minH);
  out.copy(PAL.meadow).lerp(PAL.meadow2, smoothstep(-0.4, 0.6, s.noise));
  out.lerp(PAL.dry, smoothstep(0.45, 0.8, e) * 0.6);
  const rockT = smoothstep(0.55, 0.95, s.slope + s.noise * 0.12);
  if (rockT > 0) out.lerp(s.slope > 1.1 ? PAL.rockDark : PAL.rock, rockT);
  const screeT = smoothstep(0.7, 0.95, e) * (1 - rockT) * 0.5;
  if (screeT > 0) out.lerp(PAL.scree, screeT);
  if (s.glacier > 0.2) out.lerp(s.slope > 0.6 ? PAL.iceBlue : PAL.ice, smoothstep(0.2, 0.55, s.glacier));
  if (s.veg > 0.35) out.lerp(s.noise > 0 ? PAL.forest : PAL.forest2, smoothstep(0.35, 0.6, s.veg));
  if (s.marsh > 0.2) out.lerp(s.noise > 0 ? PAL.marsh : PAL.marsh2, smoothstep(0.2, 0.6, s.marsh));
  if (s.wetShore > -1.2) out.lerp(PAL.shore, smoothstep(-1.2, 0, s.wetShore) * 0.7);
  if (s.coastal && s.h < 3 && s.slope < 0.2) out.lerp(PAL.sand, smoothstep(3, 1, s.h) * smoothstep(0.2, 0.1, s.slope));
  if (s.dam) out.copy(PAL.dam);
  return out;
}

function makeSky(radius: number, horizon: THREE.Color, zenith: THREE.Color, ground: THREE.Color, sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: horizon }, zenith: { value: zenith }, ground: { value: ground },
      sunDir: { value: sunDir }, sunCol: { value: new THREE.Color(0xfff2d8) },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.5));
        col = mix(col, ground, smoothstep(0.0, -0.12, y) * 0.5);
        float s = max(dot(d, sunDir), 0.0);
        col += sunCol * (pow(s, 5.0) * 0.16 + pow(s, 60.0) * 0.3 + smoothstep(0.99955, 0.9998, s) * 6.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** Smooth value noise on a torus, so it tiles. */
function tileNoise(rng: Rng, S: number, layers: [number, number][]) {
  const grids = layers.map(([n, w]) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return { n, w, g };
  });
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const { n, w, g } of grids) {
        const fx = (x / S) * n, fy = (y / S) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => g[(j % n) * n + (i % n)];
        v += w * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
      }
      out[y * S + x] = v;
    }
  }
  return out;
}

/** Grayscale grain so near ground does not read as flat paint. */
function detailTexture(rng: Rng) {
  const S = 256;
  const v = tileNoise(rng, S, [[8, 0.45], [32, 0.35], [128, 0.2]]);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const c = 255 * (0.88 + 0.34 * (v[i] - 0.5));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Ripple normal map for every water surface. */
function waterNormals(rng: Rng) {
  const S = 256;
  const h = tileNoise(rng, S, [[16, 0.5], [32, 0.3], [64, 0.2]]);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      const nx = -dx * 6, ny = -dy * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const o = (y * S + x) * 4;
      data[o] = ((nx / l) * 0.5 + 0.5) * 255;
      data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function addWorldUV(geo: THREE.BufferGeometry, metresPerTile: number) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / metresPerTile;
    uv[i * 2 + 1] = p.getZ(i) / metresPerTile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Chaikin smoothing over interleaved records of `k` floats; first two are x, z. */
function chaikinK(src: Float32Array, k: number, iterations: number) {
  let cur = src;
  for (let it = 0; it < iterations; it++) {
    const n = cur.length / k;
    if (n < 3) return cur;
    const out: number[] = [];
    for (let j = 0; j < k; j++) out.push(cur[j]);
    for (let i = 0; i < n - 1; i++) {
      const a = i * k, b = (i + 1) * k;
      if (i > 0) for (let j = 0; j < k; j++) out.push(0.75 * cur[a + j] + 0.25 * cur[b + j]);
      if (i < n - 2) for (let j = 0; j < k; j++) out.push(0.25 * cur[a + j] + 0.75 * cur[b + j]);
    }
    for (let j = 0; j < k; j++) out.push(cur[(n - 1) * k + j]);
    cur = Float32Array.from(out);
  }
  return cur;
}

export interface BuildOptions {
  lookAround: boolean;
  hazeMul: number;
}

export class FieldView {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene | null = null;
  private textures: THREE.Texture[] = [];
  private vp: Viewpoint | null = null;
  yaw = 0;
  pitch = 0;
  private interactive = false;
  private dragging: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private pending = false;
  private unbind: () => void;
  onView: ((yaw: number, pitch: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(VFOV, ASPECT, 0.5, 70000);
    this.unbind = this.bindLook();
  }

  build(t: Terrain, vp: Viewpoint, opts: BuildOptions) {
    this.disposeScene();
    const scene = new THREE.Scene();
    const rng = mulberry32((t.seed * 7 + 3) >>> 0);
    this.vp = vp;
    this.interactive = opts.lookAround;
    this.canvas.style.cursor = opts.lookAround ? 'grab' : 'default';
    this.canvas.style.touchAction = opts.lookAround ? 'none' : 'auto';

    const sunDir = new THREE.Vector3(
      Math.sin(vp.sunAz) * Math.cos(vp.sunEl), Math.sin(vp.sunEl), -Math.cos(vp.sunAz) * Math.cos(vp.sunEl),
    ).normalize();
    const horizon = hex(0xc8d5dd), zenith = hex(0x3f73ad), groundTint = hex(0x8b9488);
    scene.fog = new THREE.FogExp2(horizon.clone(), vp.haze * opts.hazeMul);

    const envScene = new THREE.Scene();
    envScene.add(makeSky(50, horizon, zenith, groundTint, sunDir));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(envScene, 0.04).texture;
    pmrem.dispose();
    this.textures.push(env);
    scene.environment = env;

    const sky = makeSky(45000, horizon, zenith, groundTint, sunDir);
    sky.position.set(vp.x, 0, vp.z);
    scene.add(sky);

    const sun = new THREE.DirectionalLight(0xfff0d9, 2.6);
    const focus = new THREE.Vector3(vp.x, vp.eye, vp.z);
    sun.position.copy(focus).addScaledVector(sunDir, 20000);
    sun.target.position.copy(focus);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -6500; sc.right = 6500; sc.top = 6500; sc.bottom = -6500; sc.near = 1000; sc.far = 45000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 3;
    scene.add(sun, sun.target);

    const detail = detailTexture(rng);
    const ripples = waterNormals(rng);
    this.textures.push(detail, ripples);
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0, envMapIntensity: 0.75 });
    const skirtMat = groundMat.clone();
    skirtMat.side = THREE.DoubleSide;
    const waterMat = new THREE.MeshStandardMaterial({
      color: PAL.water, roughness: 0.07, metalness: 0, envMapIntensity: 1.25,
      normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35),
    });

    scene.add(this.innerMesh(t, groundMat));
    scene.add(this.outerMesh(t, groundMat));
    scene.add(this.skirts(t, skirtMat));
    const lakes = this.lakeMesh(t, waterMat);
    if (lakes) scene.add(lakes);
    const rivers = this.riverMesh(t, ripples);
    if (rivers) scene.add(rivers);
    if (t.coastal) scene.add(this.seaPlane(waterMat));
    scene.add(this.trees(t, vp, rng));
    const reeds = this.reeds(t, vp, rng);
    if (reeds) scene.add(reeds);

    this.scene = scene;
    this.yaw = vp.bearing;
    this.pitch = vp.pitch;
    this.camera.position.set(vp.x, vp.eye, vp.z);
    this.aim();
    this.renderer.shadowMap.needsUpdate = true;
    this.render();
  }

  /** Back to the starting (scored) view. */
  resetView() {
    if (!this.vp) return;
    this.yaw = this.vp.bearing;
    this.pitch = this.vp.pitch;
    this.aim();
    this.requestRender();
  }

  private aim() {
    const cp = Math.cos(this.pitch);
    const p = this.camera.position;
    this.camera.lookAt(p.x + Math.sin(this.yaw) * cp * 100, p.y + Math.sin(this.pitch) * 100, p.z - Math.cos(this.yaw) * cp * 100);
    this.onView?.(this.yaw, this.pitch);
  }

  private bindLook() {
    const cv = this.canvas;
    const down = (e: PointerEvent) => {
      if (!this.interactive || e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = 'grabbing';
      this.dragging = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
    };
    const move = (e: PointerEvent) => {
      const d = this.dragging;
      if (!d) return;
      const k = (VFOV * Math.PI) / 180 / Math.max(1, cv.clientHeight);
      this.yaw = d.yaw - (e.clientX - d.x) * k;
      this.pitch = clamp(d.pitch + (e.clientY - d.y) * k, -0.6, 0.5);
      this.aim();
      this.requestRender();
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = null;
      cv.style.cursor = this.interactive ? 'grab' : 'default';
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
    };
  }

  private innerMesh(t: Terrain, mat: THREE.Material) {
    const pos = new Float32Array(W * W * 3), col = new Float32Array(W * W * 3);
    const c = new THREE.Color();
    for (let z = 0, i = 0; z < W; z++) {
      for (let x = 0; x < W; x++, i++) {
        const h = t.h[i];
        pos[i * 3] = x * CELL; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z * CELL;
        const nz = Math.sin(x * 0.37 + z * 0.11) * 0.5 + Math.sin(x * 0.07 - z * 0.23) * 0.5;
        groundColor(c, {
          h, slope: t.slope[i], veg: t.veg[i], wetShore: t.water[i], noise: nz, glacier: t.glacier[i],
          marsh: t.marsh[i], dam: t.damMask[i] === 1, coastal: t.coastal,
        }, t.minH, t.maxH);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const a = z * W + x, b = a + 1, cc = a + W, d = cc + 1;
        if (t.flip[z * N + x]) {
          idx[k++] = a; idx[k++] = cc; idx[k++] = d;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
        } else {
          idx[k++] = a; idx[k++] = cc; idx[k++] = b;
          idx[k++] = b; idx[k++] = cc; idx[k++] = d;
        }
      }
    }
    return this.meshFrom(pos, col, idx, mat);
  }

  private outerMesh(t: Terrain, mat: THREE.Material) {
    const pos = new Float32Array(OW * OW * 3), col = new Float32Array(OW * OW * 3);
    const c = new THREE.Color();
    const oh = t.oh;
    for (let j = 0, i = 0; j < OW; j++) {
      for (let x = 0; x < OW; x++, i++) {
        const wx = OUT_ORIGIN + x * OUT_CELL, wz = OUT_ORIGIN + j * OUT_CELL;
        const h = oh[i];
        pos[i * 3] = wx; pos[i * 3 + 1] = h; pos[i * 3 + 2] = wz;
        const x0 = Math.max(0, x - 1), x1 = Math.min(OW - 1, x + 1), j0 = Math.max(0, j - 1), j1 = Math.min(OW - 1, j + 1);
        const gx = (oh[j * OW + x1] - oh[j * OW + x0]) / ((x1 - x0) * OUT_CELL);
        const gz = (oh[j1 * OW + x] - oh[j0 * OW + x]) / ((j1 - j0) * OUT_CELL);
        const slope = Math.hypot(gx, gz) * 1.25;
        const nz = Math.sin(x * 2.9 + j * 0.9) * 0.5 + Math.sin(x * 0.6 - j * 1.8) * 0.5;
        const glacier = t.glacierAt ? t.glacierAt(wx, wz, h, gx, gz) : 0;
        groundColor(c, {
          h, slope, veg: glacier > 0.25 ? 0 : t.vegAt(wx, wz, h, slope), wetShore: -5, noise: nz, glacier,
          marsh: 0, dam: false, coastal: t.coastal,
        }, t.minH, t.maxH);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const lo = OUT_PAD, hi = OUT_PAD + N / OUT_STEP;
    const tris: number[] = [];
    for (let j = 0; j < OW - 1; j++) {
      for (let x = 0; x < OW - 1; x++) {
        if (x >= lo && x < hi && j >= lo && j < hi) continue;
        const a = j * OW + x, b = a + 1, cc = a + OW, d = cc + 1;
        tris.push(a, cc, b, b, cc, d);
      }
    }
    return this.meshFrom(pos, col, new Uint32Array(tris), mat);
  }

  /** Vertical curtains along the seam between fine and coarse grids, and at the world rim. */
  private skirts(t: Terrain, mat: THREE.Material) {
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const pushQuad = (x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, drop: number) => {
      const b0 = h0 - drop, b1 = h1 - drop;
      pos.push(x0, h0, z0, x1, h1, z1, x0, b0, z0, x1, h1, z1, x1, b1, z1, x0, b0, z0);
      for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
    };
    groundColor(c, {
      h: (t.minH + t.maxH) / 2, slope: 0.5, veg: 0, wetShore: -5, noise: 0, glacier: 0, marsh: 0, dam: false, coastal: false,
    }, t.minH, t.maxH);
    for (let k = 0; k < N; k++) {
      const s0 = k * CELL, s1 = (k + 1) * CELL;
      pushQuad(s0, 0, t.h[k], s1, 0, t.h[k + 1], 80);
      pushQuad(s0, MAP_SIZE, t.h[N * W + k], s1, MAP_SIZE, t.h[N * W + k + 1], 80);
      pushQuad(0, s0, t.h[k * W], 0, s1, t.h[(k + 1) * W], 80);
      pushQuad(MAP_SIZE, s0, t.h[k * W + N], MAP_SIZE, s1, t.h[(k + 1) * W + N], 80);
    }
    const lo = OUT_PAD, hi = OUT_PAD + N / OUT_STEP;
    const oh = (i: number, j: number) => t.oh[j * OW + i];
    const P = (i: number) => OUT_ORIGIN + i * OUT_CELL;
    for (let k = lo; k < hi; k++) {
      pushQuad(P(k), P(lo), oh(k, lo), P(k + 1), P(lo), oh(k + 1, lo), 80);
      pushQuad(P(k), P(hi), oh(k, hi), P(k + 1), P(hi), oh(k + 1, hi), 80);
      pushQuad(P(lo), P(k), oh(lo, k), P(lo), P(k + 1), oh(lo, k + 1), 80);
      pushQuad(P(hi), P(k), oh(hi, k), P(hi), P(k + 1), oh(hi, k + 1), 80);
    }
    const last = OW - 1;
    for (let k = 0; k < last; k++) {
      pushQuad(P(k), P(0), oh(k, 0), P(k + 1), P(0), oh(k + 1, 0), 400);
      pushQuad(P(k), P(last), oh(k, last), P(k + 1), P(last), oh(k + 1, last), 400);
      pushQuad(P(0), P(k), oh(0, k), P(0), P(k + 1), oh(0, k + 1), 400);
      pushQuad(P(last), P(k), oh(last, k), P(last), P(k + 1), oh(last, k + 1), 400);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    addWorldUV(g, 60);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  private lakeMesh(t: Terrain, mat: THREE.Material) {
    const L = t.level;
    const pos = new Float32Array(W * W * 3);
    for (let z = 0, i = 0; z < W; z++) {
      for (let x = 0; x < W; x++, i++) {
        pos[i * 3] = x * CELL; pos[i * 3 + 1] = Number.isNaN(L[i]) ? 0 : L[i]; pos[i * 3 + 2] = z * CELL;
      }
    }
    const tris: number[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const a = z * W + x, b = a + 1, cc = a + W, d = cc + 1;
        if (Number.isNaN(L[a]) || Number.isNaN(L[b]) || Number.isNaN(L[cc]) || Number.isNaN(L[d])) continue;
        if (Math.max(t.water[a], t.water[b], t.water[cc], t.water[d]) <= 0) continue;
        tris.push(a, cc, b, b, cc, d);
      }
    }
    if (!tris.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(tris);
    g.computeVertexNormals();
    addWorldUV(g, 40);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  private seaPlane(mat: THREE.Material) {
    const size = 120000;
    const g = new THREE.PlaneGeometry(size, size, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    addWorldUV(g, 40);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  /**
   * Water ribbons along every channel. Edges shrink until they are buried in the
   * banks, so the visible water is exactly where the carved channel dips below it.
   */
  private riverMesh(t: Terrain, ripples: THREE.Texture) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    for (const r of t.rivers) {
      const m = r.pts.length >> 1;
      const rec: number[] = [];
      for (let i = 0; i < m; i++) {
        const gx = r.pts[2 * i], gz = r.pts[2 * i + 1];
        const cell = gz * W + gx;
        if (t.sea && t.sea[cell]) break;
        rec.push(gx * CELL, gz * CELL, r.surf[i], r.width[i]);
      }
      if (rec.length < 12) continue;
      const pts = chaikinK(Float32Array.from(rec), 4, 2);
      const n = pts.length / 4;
      let base = -1;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 4], z = pts[i * 4 + 1], s = pts[i * 4 + 2], w = pts[i * 4 + 3];
        const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
        let tx = pts[inx * 4] - pts[ip * 4], tz = pts[inx * 4 + 1] - pts[ip * 4 + 1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        const grade = (pts[ip * 4 + 2] - pts[inx * 4 + 2]) / tl;
        const maxHalf = Math.max(w / 2 + 3, 8);
        const side = (sgn: number) => {
          let hw = maxHalf;
          while (hw > 1.5 && t.groundAt(x + nx * hw * sgn, z + nz * hw * sgn) < s + 0.15) hw *= 0.8;
          return hw;
        };
        const hl = side(1), hr = side(-1);
        const y = s + 0.03;
        pos.push(x + nx * hl, y, z + nz * hl, x - nx * hr, y, z - nz * hr);
        c.copy(PAL.water).lerp(PAL.foam, smoothstep(0.14, 0.32, grade) * smoothstep(3, 7, w));
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        const v = pos.length / 3 - 2;
        if (base >= 0) idx.push(base, v, base + 1, base + 1, v, v + 1);
        base = v;
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Ribbon winding varies with direction; force normals up.
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    addWorldUV(g, 30);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.1, metalness: 0, envMapIntensity: 1.2, side: THREE.DoubleSide,
      normalMap: ripples, normalScale: new THREE.Vector2(0.45, 0.45),
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private trees(t: Terrain, vp: Viewpoint, rng: Rng) {
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * W + x;
        const v = (t.veg[i] + t.veg[i + 1] + t.veg[i + W] + t.veg[i + W + 1]) / 4;
        if (v < 0.45) continue;
        const per = v > 0.75 ? 2 : 1;
        for (let k = 0; k < per; k++) {
          if (rng() > 0.85 * smoothstep(0.45, 0.8, v)) continue;
          const px = (x + rng()) * CELL, pz = (z + rng()) * CELL;
          if (Math.hypot(px - vp.x, pz - vp.z) < 90) continue;
          if (t.waterAt(px, pz) > -1 || t.sampleGrid(t.wet, px, pz) > 0.25) continue;
          const hgt = (9 + rng() * 15) * (0.6 + 0.4 * v);
          const rad = hgt * (0.2 + rng() * 0.09);
          p.set(px, t.groundAt(px, pz) - 0.8, pz);
          s.set(rad, hgt, rad);
          q.setFromAxisAngle(up, rng() * 6.28);
          m4.compose(p, q, s);
          mats.push(m4.clone());
          cols.push(new THREE.Color().setHSL(0.24 + rng() * 0.07, 0.32 + rng() * 0.16, 0.12 + rng() * 0.07));
        }
      }
    }
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 });
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    inst.count = mats.length;
    mats.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[i]); });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    return inst;
  }

  /** Reed tufts on marsh near the viewer. */
  private reeds(t: Terrain, vp: Viewpoint, rng: Rng) {
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const R = 1800 / CELL;
    const cx = Math.round(vp.x / CELL), cz = Math.round(vp.z / CELL);
    for (let z = Math.max(0, cz - R); z < Math.min(N, cz + R); z++) {
      for (let x = Math.max(0, cx - R); x < Math.min(N, cx + R); x++) {
        const v = t.marsh[z * W + x];
        if (v < 0.45) continue;
        const count = Math.round(8 * v);
        for (let k = 0; k < count; k++) {
          const px = (x + rng()) * CELL, pz = (z + rng()) * CELL;
          if (t.waterAt(px, pz) > 0) continue;
          const hgt = 0.8 + rng() * 1.1;
          p.set(px, t.groundAt(px, pz) - 0.1, pz);
          s.set(0.35 + rng() * 0.3, hgt, 0.35 + rng() * 0.3);
          q.setFromAxisAngle(new THREE.Vector3(rng() - 0.5, 4, rng() - 0.5).normalize(), rng() * 0.4);
          m4.compose(p, q, s);
          mats.push(m4.clone());
          cols.push(new THREE.Color().setHSL(0.13 + rng() * 0.06, 0.35, 0.32 + rng() * 0.1));
        }
      }
    }
    if (!mats.length) return null;
    const geo = new THREE.ConeGeometry(1, 1, 4, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => { inst.setMatrixAt(i, m); inst.setColorAt(i, cols[i]); });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    return inst;
  }

  private meshFrom(pos: Float32Array, col: Float32Array, idx: Uint32Array, mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    addWorldUV(g, 60);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    if (!this.scene) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (w && h && (size.x !== w || size.y !== h)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    this.disposeScene();
    this.renderer.setClearColor(0x0b110f, 1);
    this.renderer.clear();
  }

  private disposeScene() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
    for (const tex of this.textures) tex.dispose();
    this.textures = [];
    this.renderer.renderLists.dispose();
    this.scene = null;
  }

  destroy() {
    this.unbind();
    this.disposeScene();
    this.renderer.dispose();
  }
}

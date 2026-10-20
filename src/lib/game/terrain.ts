// Terrain synthesis. Pure data and no DOM, so the server can run it to score guesses.

import { mulberry32, type Rng } from './noise';
import {
  MAP_SIZE, N, CELL, W, OW, OUT_CELL, OUT_ORIGIN, NO_WATER,
} from './constants';
import { clamp, smoothstep, mix32 } from './math';
import { makeElevation, type Character, type ElevParams } from './elevation';
import {
  priorityFlood, extractChains, profileChains, carveChannels, placeDam, findLakes, findFalls,
  DX8, DZ8, type Lake, type Dam, type Fall,
} from './hydrology';
import {
  computeSlope, blur3, makeVegetation, makeGlacier, glacierGrid, marshGrid, type VegFn, type GlacierFn,
} from './cover';
import { makeNamer } from './names';

export type { Character } from './elevation';
export type { Lake, Dam, Fall } from './hydrology';

export interface River {
  /** Grid coordinates, x,z pairs, upstream to downstream. */
  pts: Float32Array;
  surf: Float32Array;
  width: Float32Array;
  acc: Float32Array;
  endsInWater: boolean;
}

export interface Peak { x: number; z: number; h: number }

export interface Terrain {
  seed: number;
  name: string;
  character: Character;
  params: ElevParams;
  /** Sea level is 0 m on coastal maps. */
  coastal: boolean;
  h: Float32Array;
  minH: number;
  maxH: number;
  /** Per cell: 1 when the cell's triangles split along (0,0)-(1,1). */
  flip: Uint8Array;
  /** Lake surface height per vertex, NaN where there is no lake nearby. */
  level: Float32Array;
  /** Lake depth per vertex (negative near shore), NO_WATER elsewhere. */
  water: Float32Array;
  lakeId: Int16Array;
  sea: Uint8Array | null;
  slope: Float32Array;
  veg: Float32Array;
  glacier: Float32Array;
  marsh: Float32Array;
  wet: Float32Array;
  damMask: Uint8Array;
  rivers: River[];
  lakes: Lake[];
  dam: (Dam & { name: string }) | null;
  falls: Fall[];
  peaks: Peak[];
  mainRiver: { index: number; name: string } | null;
  seaLabel: { x: number; z: number; r: number; name: string } | null;
  /** Coarse heights of the 12.8 km ring around the map. */
  oh: Float32Array;
  vegAt: VegFn;
  glacierAt: GlacierFn | null;
  inside(x: number, z: number): boolean;
  groundAt(x: number, z: number): number;
  lakeLevelAt(x: number, z: number): number;
  waterAt(x: number, z: number): number;
  isSeaAt(x: number, z: number): boolean;
  surfaceAt(x: number, z: number): number;
  sampleGrid(arr: Float32Array, x: number, z: number): number;
}

/** Height on a grid triangulated like the 3D mesh, honouring per-cell diagonal flips. */
function triHeight(arr: Float32Array, stride: number, gx: number, gz: number, flip: Uint8Array | null) {
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const i = iz * stride + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + stride], d = arr[i + stride + 1];
  if (flip && flip[iz * (stride - 1) + ix]) {
    if (fz >= fx) return a + (d - c) * fx + (c - a) * fz;
    return a + (b - a) * fx + (d - b) * fz;
  }
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

function bilinear(arr: Float32Array, stride: number, gx: number, gz: number) {
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const i = iz * stride + ix;
  return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fz) + (arr[i + stride] * (1 - fx) + arr[i + stride + 1] * fx) * fz;
}

const gridClamp = (v: number) => clamp(v / CELL, 0, N - 1e-6);

/** Bowl-shaped hollows in gentle valleys that fill into lakes (or cirque tarns on glacial maps). */
function carveBasins(h: Float32Array, rng: Rng, character: Character, coastal: boolean) {
  const count =
    character === 'lakeland' ? 3 + Math.floor(rng() * 4)
      : character === 'glacial' ? 2 + Math.floor(rng() * 3)
        : character === 'mountain' ? Math.floor(rng() * 3)
          : Math.floor(rng() * 2);
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }
  const range = maxH - minH;
  const hAt = (x: number, z: number) => bilinear(h, W, gridClamp(x), gridClamp(z));
  const sites: { x: number; z: number; R: number; depth: number; a1: number; a2: number }[] = [];
  const tarn = character === 'glacial';
  for (let k = 0; k < 500 && sites.length < count; k++) {
    const R = tarn ? 170 + rng() * 200 : 260 + rng() * 420;
    const margin = R * 1.45 + 250;
    const x = margin + rng() * (MAP_SIZE - 2 * margin);
    const z = margin + rng() * (MAP_SIZE - 2 * margin);
    const c = hAt(x, z);
    if (coastal && c < 12) continue;
    if (tarn && (c - minH) / range < 0.4) continue;
    let ring = 0;
    for (let q = 0; q < 8; q++) ring += hAt(x + Math.cos(q * 0.785) * R * 1.3, z + Math.sin(q * 0.785) * R * 1.3);
    if (ring / 8 - c < 12) continue;
    const g = Math.hypot(hAt(x + 60, z) - hAt(x - 60, z), hAt(x, z + 60) - hAt(x, z - 60)) / 120;
    if (g > 0.09) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.R + R + 450)) continue;
    sites.push({ x, z, R, depth: tarn ? 9 + rng() * 14 : 12 + rng() * 26, a1: rng() * 6.28, a2: rng() * 6.28 });
  }
  for (const s of sites) {
    const gr = Math.ceil((s.R * 1.45) / CELL);
    const cx = Math.round(s.x / CELL), cz = Math.round(s.z / CELL);
    for (let dz = -gr; dz <= gr; dz++) {
      for (let dx = -gr; dx <= gr; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= W || z >= W) continue;
        const px = x * CELL - s.x, pz = z * CELL - s.z;
        const th = Math.atan2(pz, px);
        const rr = s.R * (1 + 0.24 * Math.sin(2 * th + s.a1) + 0.12 * Math.sin(5 * th + s.a2));
        const t = Math.hypot(px, pz) / rr;
        if (t >= 1) continue;
        const k = 1 - t * t;
        h[z * W + x] -= s.depth * k * k;
      }
    }
  }
}

function seaMask(h: Float32Array) {
  const m = new Uint8Array(h.length);
  for (let i = 0; i < h.length; i++) if (h[i] < 0) m[i] = 1;
  return m;
}

function findPeaks(h: Float32Array, sea: Uint8Array | null): Peak[] {
  const R = 14, peaks: Peak[] = [];
  for (let z = 8; z < W - 8; z++) {
    for (let x = 8; x < W - 8; x++) {
      const c = z * W + x;
      if (sea && sea[c]) continue;
      const v = h[c];
      let isMax = true;
      for (let dz = -R; dz <= R && isMax; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= W) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (dx === 0 && dz === 0)) continue;
          if (h[zz * W + xx] >= v) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ x, z, h: v });
    }
  }
  peaks.sort((a, b) => b.h - a.h);
  return peaks.slice(0, 7);
}

/** Chamfer distance (in cells) from the nearest cell where mask is 0. */
function distanceInside(mask: Uint8Array) {
  const n = W * W;
  const dist = new Float32Array(n);
  for (let c = 0; c < n; c++) dist[c] = mask[c] ? 1e9 : 0;
  const relax = (c: number, nb: number, w: number) => { if (dist[nb] + w < dist[c]) dist[c] = dist[nb] + w; };
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const c = z * W + x;
    if (!dist[c]) continue;
    if (x > 0) relax(c, c - 1, 1);
    if (z > 0) { relax(c, c - W, 1); if (x > 0) relax(c, c - W - 1, 1.414); if (x < W - 1) relax(c, c - W + 1, 1.414); }
  }
  for (let z = W - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
    const c = z * W + x;
    if (!dist[c]) continue;
    if (x < W - 1) relax(c, c + 1, 1);
    if (z < W - 1) { relax(c, c + W, 1); if (x < W - 1) relax(c, c + W + 1, 1.414); if (x > 0) relax(c, c + W - 1, 1.414); }
  }
  return dist;
}

export function generateTerrain(seed: number): Terrain {
  seed >>>= 0;
  const rng = mulberry32(seed);
  const roll = rng();
  const character: Character =
    roll < 0.22 ? 'coastal' : roll < 0.45 ? 'lakeland' : roll < 0.66 ? 'glacial' : 'mountain';
  const coastal = character === 'coastal';
  const { f: elev, P } = makeElevation(rng, character);
  const n = W * W;
  const h = new Float32Array(n);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) h[z * W + x] = elev(x * CELL, z * CELL);
  if (coastal) {
    const sorted = Float32Array.from(h).sort();
    P.offset = sorted[Math.floor((0.16 + rng() * 0.16) * n)];
    for (let i = 0; i < n; i++) h[i] -= P.offset;
  }

  carveBasins(h, rng, character, coastal);
  let sea = coastal ? seaMask(h) : null;

  // Rivers come from the first drainage pass and are carved in; lakes come from a
  // second pass so they sit in the final, carved landscape.
  const flood1 = priorityFlood(h, sea);
  const chains = extractChains(flood1, h, sea);
  profileChains(chains, h, flood1.F, coastal);
  const flip = new Uint8Array(N * N);
  const wet = new Float32Array(n);
  carveChannels(h, chains, flip, wet);

  const damChance = { lakeland: 0.6, mountain: 0.45, glacial: 0.25, coastal: 0.3 }[character];
  let dam: Dam | null = null;
  let beforeDam: Float32Array | null = null;
  if (rng() < damChance) {
    beforeDam = h.slice();
    dam = placeDam(h, chains, rng);
  }
  if (coastal) sea = seaMask(h);
  const lakeOpts = character === 'lakeland'
    ? { maxLakes: 8, capMin: 22, capMax: 45 }
    : { maxLakes: 3 + Math.floor(rng() * 4), capMin: 14, capMax: 28 };
  let flood2 = priorityFlood(h, sea);
  let lk = findLakes(h, flood2.F, rng, { ...lakeOpts, reservoir: dam ? { cell: dam.upstream, level: dam.waterLevel } : null });
  if (dam && !lk.lakes.some((l) => l.kind === 'reservoir')) {
    h.set(beforeDam!);
    dam = null;
    flood2 = priorityFlood(h, sea);
    lk = findLakes(h, flood2.F, rng, { ...lakeOpts, reservoir: null });
  }
  const { level, water, lakes, lakeId } = lk;

  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < n; i++) {
    if (sea && sea[i]) continue;
    if (h[i] < minH) minH = h[i];
    if (h[i] > maxH) maxH = h[i];
  }
  if (coastal) minH = Math.max(0, minH);

  const slope = computeSlope(h);
  const glacierAt = makeGlacier(rng, minH, maxH, character);
  const glacier = glacierGrid(glacierAt, h, water);
  const marsh = marshGrid(rng, h, slope, flood2.acc, water, sea, glacier, minH, maxH, character);
  const vegAt = makeVegetation(rng, minH, maxH, character);
  const damMask = new Uint8Array(n);
  if (dam) {
    for (const c of dam.cells) {
      damMask[c] = 1;
      const cx = c % W, cz = (c / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], nz = cz + DZ8[d];
        if (nx >= 0 && nz >= 0 && nx < W && nz < W) damMask[nz * W + nx] = 1;
      }
    }
  }
  const vegRaw = new Float32Array(n);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const c = z * W + x;
      if (water[c] > -1 || (sea && sea[c]) || marsh[c] > 0.4 || glacier[c] > 0.25 || wet[c] > 0.5 || damMask[c]) continue;
      vegRaw[c] = vegAt(x * CELL, z * CELL, h[c], slope[c]);
    }
  }
  const veg = blur3(vegRaw);
  for (let c = 0; c < n; c++) if (water[c] > 0 || (sea && sea[c]) || damMask[c]) veg[c] = 0;

  const falls = findFalls(chains, water, sea);
  const rivers: River[] = chains.map((ch) => {
    const pts = new Float32Array(ch.cells.length * 2);
    ch.cells.forEach((c, i) => { pts[2 * i] = c % W; pts[2 * i + 1] = (c / W) | 0; });
    return {
      pts, surf: Float32Array.from(ch.surf), width: Float32Array.from(ch.width), acc: Float32Array.from(ch.acc),
      endsInWater: ch.endsInWater,
    };
  });
  const peaks = findPeaks(h, sea);

  // Outer ring: the same elevation function on a coarse grid, sinking gently at the far rim.
  const oh = new Float32Array(OW * OW);
  for (let j = 0; j < OW; j++) {
    for (let i = 0; i < OW; i++) {
      const x = OUT_ORIGIN + i * OUT_CELL, z = OUT_ORIGIN + j * OUT_CELL;
      const dEdge = Math.max(0, -x, x - MAP_SIZE, -z, z - MAP_SIZE);
      const t = smoothstep(7000, 12800, dEdge) * 0.6;
      const raw = elev(x, z);
      const target = coastal ? (raw < 0 ? -60 : 8) : minH - 150;
      oh[j * OW + i] = raw * (1 - t) + target * t;
    }
  }

  // Names and label anchors.
  const namer = makeNamer(mulberry32(mix32(seed, 0xa11ce)));
  const name = namer.quad(character);
  const byArea = [...lakes].sort((a, b) => b.area - a.area);
  let named = 0;
  for (const l of byArea) {
    if (l.kind === 'reservoir') l.name = namer.reservoir();
    else if (named < 3 && l.labelR * CELL >= 60) { l.name = namer.lake(); named++; }
  }
  const reservoir = lakes.find((l) => l.kind === 'reservoir');
  const damOut = dam ? { ...dam, name: namer.dam(reservoir?.name ?? 'Dam') } : null;
  let mainRiver: Terrain['mainRiver'] = null;
  let best = -1;
  for (let i = 0; i < rivers.length; i++) {
    const r = rivers[i];
    const a = r.acc[r.acc.length - 1];
    if (r.width[r.width.length - 1] >= 8 && r.pts.length >= 40 && a > best) { best = a; mainRiver = { index: i, name: '' }; }
  }
  if (mainRiver) mainRiver.name = namer.river(best > 9000);
  let seaLabel: Terrain['seaLabel'] = null;
  if (sea) {
    // Furthest from both the coast and the sheet edge, so the name sits in open water.
    const dist = distanceInside(sea);
    let bi = -1, bd = 0;
    for (let c = 0; c < n; c++) {
      const x = c % W, z = (c / W) | 0;
      const d = Math.min(dist[c], x - 8, z - 8, N - 8 - x, N - 24 - z);
      if (d > bd) { bd = d; bi = c; }
    }
    if (bi >= 0 && bd >= 6) seaLabel = { x: bi % W, z: (bi / W) | 0, r: bd, name: namer.sea() };
  }
  if (falls.length) falls[0].name = namer.falls();

  const t: Terrain = {
    seed, name, character, params: P, coastal, h, minH, maxH, flip, level, water, lakeId, sea,
    slope, veg, glacier, marsh, wet, damMask, rivers, lakes, dam: damOut, falls, peaks, mainRiver, seaLabel,
    oh, vegAt, glacierAt,
    inside: (x, z) => x >= 0 && z >= 0 && x <= MAP_SIZE && z <= MAP_SIZE,
    groundAt(x, z) {
      if (t.inside(x, z)) return triHeight(h, W, Math.min(x / CELL, N - 1e-6), Math.min(z / CELL, N - 1e-6), flip);
      const gx = clamp((x - OUT_ORIGIN) / OUT_CELL, 0, OW - 1.0001);
      const gz = clamp((z - OUT_ORIGIN) / OUT_CELL, 0, OW - 1.0001);
      return triHeight(oh, OW, gx, gz, null);
    },
    lakeLevelAt(x, z) {
      if (!t.inside(x, z)) return NaN;
      return level[Math.round(z / CELL) * W + Math.round(x / CELL)];
    },
    waterAt(x, z) {
      if (!t.inside(x, z)) return NO_WATER;
      return bilinear(water, W, gridClamp(x), gridClamp(z));
    },
    isSeaAt(x, z) {
      return coastal && t.groundAt(x, z) < 0;
    },
    surfaceAt(x, z) {
      const g = t.groundAt(x, z);
      let s = g;
      if (coastal && s < 0) s = 0;
      if (t.inside(x, z)) {
        const L = level[Math.round(z / CELL) * W + Math.round(x / CELL)];
        if (L > s) s = L;
      }
      return s;
    },
    sampleGrid(arr, x, z) {
      return bilinear(arr, W, gridClamp(x), gridClamp(z));
    },
  };
  return t;
}

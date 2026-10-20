// Land cover on the vertex grid: slope, forest, glaciers, marsh.

import { W, CELL } from './constants';
import { fbm, makeSimplex, type Rng } from './noise';
import { smoothstep } from './math';
import type { Character } from './elevation';

export function computeSlope(h: Float32Array) {
  const s = new Float32Array(W * W);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1);
      const z0 = Math.max(0, z - 1), z1 = Math.min(W - 1, z + 1);
      const gx = (h[z * W + x1] - h[z * W + x0]) / ((x1 - x0) * CELL);
      const gz = (h[z1 * W + x] - h[z0 * W + x]) / ((z1 - z0) * CELL);
      s[z * W + x] = Math.hypot(gx, gz);
    }
  }
  return s;
}

/** 3x3 box blur. */
export function blur3(src: Float32Array) {
  const out = new Float32Array(W * W);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      let s = 0, k = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= W) continue;
          s += src[zz * W + xx];
          k++;
        }
      }
      out[z * W + x] = s / k;
    }
  }
  return out;
}

export type VegFn = (x: number, z: number, h: number, slope: number) => number;

export function makeVegetation(rng: Rng, minH: number, maxH: number, character: Character): VegFn {
  const nT = makeSimplex(rng), nP = makeSimplex(rng);
  const range = maxH - minH;
  const tl0 = minH + range * (character === 'glacial' ? 0.3 + rng() * 0.15 : 0.38 + rng() * 0.22);
  const cover = -0.35 + rng() * 0.25;
  return (x, z, h, slope) => {
    if (character === 'coastal' && h < 4) return 0;
    const tl = tl0 + 110 * nT(x / 2600, z / 2600);
    const v1 = smoothstep(tl + 45, tl - 45, h);
    const v2 = smoothstep(cover, cover + 0.3, fbm(nP, x / 1300, z / 1300, 3));
    const v3 = smoothstep(1.0, 0.7, slope);
    return v1 * v2 * v3;
  };
}

/** Glacier likelihood from height, north-facing aspect and slope; usable outside the grid too. */
export type GlacierFn = (x: number, z: number, h: number, gx: number, gz: number) => number;

export function makeGlacier(rng: Rng, minH: number, maxH: number, character: Character): GlacierFn | null {
  const range = maxH - minH;
  const on = character === 'glacial' || (character === 'mountain' && range > 720);
  const nG = makeSimplex(rng);
  if (!on) return null;
  const g0 = character === 'glacial' ? 0.5 : 0.72;
  return (x, z, h, gx, gz) => {
    const e = (h - minH) / range;
    const gl = Math.hypot(gx, gz);
    // gz > 0: ground rises to the south, so the slope faces north.
    const north = gl > 0.02 ? gz / gl : 0;
    const score = e + 0.08 * north + 0.06 * nG(x / 700, z / 700);
    return smoothstep(g0, g0 + 0.07, score) * smoothstep(1.25, 0.7, gl);
  };
}

export function glacierGrid(fn: GlacierFn | null, h: Float32Array, water: Float32Array) {
  const g = new Float32Array(W * W);
  if (!fn) return g;
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const c = z * W + x;
      if (water[c] > 0) continue;
      const x0 = Math.max(0, x - 1), x1 = Math.min(W - 1, x + 1);
      const z0 = Math.max(0, z - 1), z1 = Math.min(W - 1, z + 1);
      const gx = (h[z * W + x1] - h[z * W + x0]) / ((x1 - x0) * CELL);
      const gz = (h[z1 * W + x] - h[z0 * W + x]) / ((z1 - z0) * CELL);
      g[c] = fn(x * CELL, z * CELL, h[c], gx, gz);
    }
  }
  return blur3(g);
}

/**
 * Marsh patches on flat, wet floodplains: lake inlets, wide valley floors and,
 * on coastal maps, river mouths. Each patch spreads only over ground a few metres
 * above its seed point, so it hugs the flat and stops at the valley sides.
 */
export function marshGrid(
  rng: Rng, h: Float32Array, slope: Float32Array, acc: Float32Array, water: Float32Array,
  sea: Uint8Array | null, glacier: Float32Array, minH: number, maxH: number, character: Character,
) {
  const nM = makeSimplex(rng);
  const m = new Float32Array(W * W);
  const count = {
    lakeland: 2 + Math.floor(rng() * 3),
    mountain: 1 + Math.floor(rng() * 2),
    glacial: Math.floor(rng() * 2),
    coastal: 1 + Math.floor(rng() * 2),
  }[character];
  const range = maxH - minH;
  const cands: { c: number; score: number }[] = [];
  for (let k = 0; k < 1500; k++) {
    const x = 16 + Math.floor(rng() * (W - 32)), z = 16 + Math.floor(rng() * (W - 32));
    const c = z * W + x;
    if (water[c] > 0 || (sea && sea[c]) || glacier[c] > 0.2) continue;
    if (slope[c] > 0.08 || acc[c] < 150 || (h[c] - minH) / range > 0.6) continue;
    const nearLake = water[c] > -3 ? 3 : 0;
    const mouth = sea && h[c] < 6 ? 3 : 0;
    cands.push({ c, score: Math.log(acc[c]) + nearLake + mouth - slope[c] * 40 + rng() });
  }
  cands.sort((a, b) => b.score - a.score);
  const sites: number[] = [];
  for (const { c } of cands) {
    if (sites.length >= count) break;
    const x = c % W, z = (c / W) | 0;
    if (sites.some((s) => Math.hypot((s % W) - x, ((s / W) | 0) - z) * CELL < 900)) continue;
    sites.push(c);
  }
  for (const s of sites) {
    const sx = s % W, sz = (s / W) | 0, base = h[s];
    const R = (220 + rng() * 260) / CELL;
    const ph = rng() * 6.28;
    const gr = Math.ceil(R * 1.6);
    for (let dz = -gr; dz <= gr; dz++) {
      for (let dx = -gr; dx <= gr; dx++) {
        const x = sx + dx, z = sz + dz;
        if (x < 0 || z < 0 || x >= W || z >= W) continue;
        const c = z * W + x;
        if (water[c] > 0 || (sea && sea[c]) || glacier[c] > 0.3) continue;
        const th = Math.atan2(dz, dx);
        const t = Math.hypot(dx, dz) / (R * (1 + 0.3 * Math.sin(3 * th + ph) + 0.25 * nM(x / 6, z / 6)));
        const v = smoothstep(1, 0.55, t) * smoothstep(0.16, 0.07, slope[c]) * smoothstep(base + 10, base + 4, h[c]);
        if (v > m[c]) m[c] = v;
      }
    }
  }
  return blur3(m);
}

// Drainage, lakes, rivers, dams and waterfalls on the vertex grid.

import { Heap } from './heap';
import { W, N, CELL, MAP_SIZE, NO_WATER } from './constants';
import type { Rng } from './noise';

export const DX8 = [1, -1, 0, 0, 1, 1, -1, -1];
export const DZ8 = [0, 0, 1, -1, 1, -1, 1, -1];

/** Minimum upstream area (in cells, 400 m² each) for a stream to appear. */
export const STREAM_TH = 700;
/** Upstream area at which a stream is wide enough to draw with banks. */
export const RIVER_TH = 3000;

export interface Flood {
  /** Depression-filled height: the level water would stand at. */
  F: Float32Array;
  /** Vertex each vertex drains into, or -1 at an outlet. */
  parent: Int32Array;
  /** Upstream area in cells, including the vertex itself. */
  acc: Float32Array;
}

/** Priority-flood depression filling with outlets on the map edge and along the sea. */
export function priorityFlood(h: Float32Array, sea: Uint8Array | null): Flood {
  const n = W * W;
  const F = new Float32Array(h);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  const heap = new Heap(n);
  if (sea) {
    for (let c = 0; c < n; c++) {
      if (!sea[c]) continue;
      closed[c] = 1;
      const cx = c % W, cz = (c / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], nz = cz + DZ8[d];
        if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        if (!sea[nz * W + nx]) { heap.push(F[c], c); break; }
      }
    }
  }
  for (let i = 0; i < W; i++) {
    for (const c of [i, (W - 1) * W + i, i * W, i * W + W - 1]) {
      if (!closed[c]) { closed[c] = 1; heap.push(F[c], c); }
    }
  }
  let oc = 0;
  while (heap.n) {
    const c = heap.pop();
    order[oc++] = c;
    const cx = c % W, cz = (c / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], nz = cz + DZ8[d];
      if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
      const nb = nz * W + nx;
      if (closed[nb]) continue;
      closed[nb] = 1;
      F[nb] = Math.max(h[nb], F[c] + (d < 4 ? 1e-3 : 1.4e-3));
      parent[nb] = c;
      heap.push(F[nb], nb);
    }
  }
  const acc = new Float32Array(n).fill(1);
  for (let k = oc - 1; k >= 0; k--) {
    const c = order[k], p = parent[c];
    if (p >= 0) acc[p] += acc[c];
  }
  return { F, parent, acc };
}

export interface Chain {
  /** Vertex indices from upstream to downstream. */
  cells: number[];
  acc: number[];
  /** Water surface height at each vertex (m). */
  surf: number[];
  /** Channel width at each vertex (m). */
  width: number[];
  /** True when the last vertex lies in a lake or the sea rather than on the channel. */
  endsInWater: boolean;
}

export const widthFor = (acc: number) =>
  Math.min(32, 2 + 2.8 * Math.log2(Math.max(1, acc / STREAM_TH)) + 4 * Math.max(0, Math.log2(acc / 6000)));

/** Splits the drainage network into chains that each end at a junction, lake, sea or map edge. */
export function extractChains(fl: Flood, h: Float32Array, sea: Uint8Array | null): Chain[] {
  const { parent, acc, F } = fl;
  const n = W * W;
  const isStream = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (acc[c] >= STREAM_TH && !(sea && sea[c]) && F[c] - h[c] < 2.5) isStream[c] = 1;
  }
  const hasUp = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    const p = parent[c];
    if (isStream[c] && p >= 0 && isStream[p]) hasUp[p] = 1;
  }
  const visited = new Uint8Array(n);
  const chains: Chain[] = [];
  for (let c0 = 0; c0 < n; c0++) {
    if (!isStream[c0] || hasUp[c0]) continue;
    const cells: number[] = [];
    let endsInWater = false;
    let c = c0;
    while (c >= 0) {
      cells.push(c);
      if (visited[c]) break;
      visited[c] = 1;
      const p = parent[c];
      if (p < 0) break;
      if (!isStream[p]) { cells.push(p); endsInWater = true; break; }
      c = p;
    }
    if (cells.length >= 4) chains.push({ cells, acc: cells.map((v) => acc[v]), surf: [], width: [], endsInWater });
  }
  return chains;
}

/** Assigns a water surface that never runs uphill, and a width from upstream area. */
export function profileChains(chains: Chain[], h: Float32Array, F: Float32Array, coastal: boolean) {
  const surfAt = new Float32Array(W * W).fill(NaN);
  for (const ch of chains) {
    let prev = Infinity;
    ch.surf = [];
    ch.width = [];
    for (let i = 0; i < ch.cells.length; i++) {
      const c = ch.cells[i];
      const w = widthFor(ch.acc[i]);
      const bank = 0.3 + 0.02 * w;
      let s: number;
      if (!Number.isNaN(surfAt[c])) s = surfAt[c];
      else {
        s = Math.min(prev - 0.001, Math.max(h[c], F[c]) - bank);
        if (coastal) s = Math.max(s, 0.03);
        surfAt[c] = s;
      }
      ch.surf.push(s);
      ch.width.push(w);
      prev = s;
    }
  }
}

/**
 * Cuts channels with gentle banks into the heightfield. Diagonal steps flip the
 * cell's triangle diagonal so the channel always follows a mesh edge in 3D.
 */
export function carveChannels(h: Float32Array, chains: Chain[], flip: Uint8Array, wet: Float32Array) {
  for (const ch of chains) {
    const last = ch.cells.length - 1;
    for (let i = 0; i <= last; i++) {
      if (i === last && ch.endsInWater) break;
      const c = ch.cells[i];
      const cx = c % W, cz = (c / W) | 0;
      const s = ch.surf[i], w = ch.width[i];
      const r = w / 2, d = 0.7 + 0.07 * w;
      const reach = r + CELL;
      const R = Math.ceil(reach / CELL);
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= W || z >= W) continue;
          const dist = Math.hypot(dx, dz) * CELL;
          if (dist > reach) continue;
          const v = z * W + x;
          const target = dist <= r ? s - d : s + (dist - r) * 0.35;
          if (target < h[v]) h[v] = target;
          if (dist <= r + 6) wet[v] = 1;
        }
      }
      if (i < last) {
        const c2 = ch.cells[i + 1];
        const x2 = c2 % W, z2 = (c2 / W) | 0;
        const sx = x2 - cx, sz = z2 - cz;
        if (sx === sz && sx !== 0) flip[Math.min(cz, z2) * N + Math.min(cx, x2)] = 1;
      }
    }
  }
}

function bilinear(arr: Float32Array, gx: number, gz: number) {
  gx = Math.min(Math.max(gx, 0), N - 1e-6);
  gz = Math.min(Math.max(gz, 0), N - 1e-6);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const i = iz * W + ix;
  return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fz) + (arr[i + W] * (1 - fx) + arr[i + W + 1] * fx) * fz;
}

/** 4-connected raster line between two grid points, so water cannot leak diagonally. */
function rasterLine4(x0: number, z0: number, x1: number, z1: number) {
  let x = Math.round(x0), z = Math.round(z0);
  const xe = Math.round(x1), ze = Math.round(z1);
  const out: number[] = [];
  const push = (px: number, pz: number) => {
    if (px >= 0 && pz >= 0 && px < W && pz < W) out.push(pz * W + px);
  };
  push(x, z);
  const dx = Math.abs(xe - x), dz = Math.abs(ze - z);
  const sx = x < xe ? 1 : -1, sz = z < ze ? 1 : -1;
  let err = dx - dz;
  let guard = 0;
  while ((x !== xe || z !== ze) && guard++ < 4 * W) {
    const e2 = 2 * err;
    let movedX = false;
    if (e2 > -dz) { err -= dz; x += sx; movedX = true; }
    if (e2 < dx) {
      if (movedX) push(x, z);
      err += dx;
      z += sz;
    }
    push(x, z);
  }
  return out;
}

export interface Dam {
  /** Vertices along the crest. */
  cells: number[];
  crest: number;
  waterLevel: number;
  ax: number; az: number; bx: number; bz: number;
  /** A vertex just upstream, inside the future reservoir. */
  upstream: number;
}

/** Builds an embankment dam across a narrow, flat-backed river valley. */
export function placeDam(h: Float32Array, chains: Chain[], rng: Rng): Dam | null {
  const hAt = (x: number, z: number) => bilinear(h, x / CELL, z / CELL);
  const cands: {
    x: number; z: number; nx: number; nz: number; l: number; r: number;
    crest: number; score: number; upstream: number;
  }[] = [];
  for (const ch of chains) {
    const L = ch.cells.length;
    for (let i = 12; i < L - 6; i += 2) {
      if (ch.acc[i] < 3500) continue;
      const c = ch.cells[i];
      const x = (c % W) * CELL, z = ((c / W) | 0) * CELL;
      if (x < 900 || z < 900 || x > MAP_SIZE - 900 || z > MAP_SIZE - 900) continue;
      const a = ch.cells[i - 3], b = ch.cells[i + 3];
      let tx = (b % W) - (a % W), tz = ((b / W) | 0) - ((a / W) | 0);
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const s = ch.surf[i];
      const H = 24 + rng() * 22;
      const crest = s + H;
      const reach = (sign: number) => {
        for (let d = 10; d <= 380; d += 10) if (hAt(x + nx * d * sign, z + nz * d * sign) >= crest) return d;
        return -1;
      };
      const l = reach(1), r = reach(-1);
      if (l < 0 || r < 0) continue;
      const grad = Math.max(0.004, (ch.surf[i - 12] - s) / (12 * CELL * 1.15));
      const score = (H / (l + r)) * (0.3 + 0.05 / grad) + rng() * 0.05;
      cands.push({ x, z, nx, nz, l, r, crest, score, upstream: ch.cells[i - 4] });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const p = cands[Math.floor(rng() * Math.min(3, cands.length))];
  const ax = p.x + p.nx * (p.l + 20), az = p.z + p.nz * (p.l + 20);
  const bx = p.x - p.nx * (p.r + 20), bz = p.z - p.nz * (p.r + 20);
  const cells = rasterLine4(ax / CELL, az / CELL, bx / CELL, bz / CELL);
  const top = p.crest + 1.5;
  for (const c of cells) h[c] = Math.max(h[c], top);
  for (const c of cells) {
    const cx = c % W, cz = (c / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], nz = cz + DZ8[d];
      if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
      const nb = nz * W + nx;
      h[nb] = Math.max(h[nb], top - 6);
    }
  }
  return { cells, crest: top, waterLevel: p.crest - 1, ax, az, bx, bz, upstream: p.upstream };
}

export interface Lake {
  id: number;
  kind: 'lake' | 'reservoir';
  level: number;
  /** Area in cells. */
  area: number;
  /** Grid position furthest from the shore, and that distance in cells. */
  labelX: number;
  labelZ: number;
  labelR: number;
  name: string;
}

export interface LakeOptions {
  maxLakes: number;
  capMin: number;
  capMax: number;
  reservoir: { cell: number; level: number } | null;
}

/** Turns filled depressions into lakes with a level, a depth field and label anchors. */
export function findLakes(h: Float32Array, F: Float32Array, rng: Rng, opts: LakeOptions) {
  const n = W * W;
  const comp = new Int32Array(n).fill(-1);
  const level = new Float32Array(n).fill(NaN);
  const lakeId = new Int16Array(n).fill(-1);
  const stack: number[] = [];
  const found: { cells: number[]; spill: number; minH: number; isRes: boolean }[] = [];
  const resCell = opts.reservoir?.cell ?? -1;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || F[s] - h[s] <= 0.3) continue;
    const cells: number[] = [];
    comp[s] = s;
    stack.push(s);
    let minH = Infinity, spill = Infinity, isRes = false;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      if (c === resCell) isRes = true;
      if (h[c] < minH) minH = h[c];
      if (F[c] < spill) spill = F[c];
      const cx = c % W, cz = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX8[d], nz = cz + DZ8[d];
        if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        const nb = nz * W + nx;
        if (comp[nb] < 0 && F[nb] - h[nb] > 0.3) { comp[nb] = s; stack.push(nb); }
      }
    }
    const depth = spill - minH;
    if (isRes ? cells.length >= 30 : cells.length >= 40 && depth >= 3) found.push({ cells, spill, minH, isRes });
  }
  found.sort((a, b) => Number(b.isRes) - Number(a.isRes) || b.cells.length - a.cells.length);
  const kept = found.slice(0, opts.maxLakes + (found[0]?.isRes ? 1 : 0));
  const lakes: Lake[] = [];
  kept.forEach((lk, id) => {
    let lv: number;
    if (lk.isRes && opts.reservoir) lv = Math.min(lk.spill, opts.reservoir.level);
    else {
      lv = Math.min(lk.spill, lk.minH + opts.capMin + rng() * (opts.capMax - opts.capMin));
      if (lk.cells.length > n * 0.07) lv = lk.minH + (lv - lk.minH) * 0.5;
    }
    for (const c of lk.cells) { level[c] = lv; lakeId[c] = id; }
    lakes.push({ id, kind: lk.isRes ? 'reservoir' : 'lake', level: lv, area: 0, labelX: 0, labelZ: 0, labelR: 0, name: '' });
  });

  // Grow the level field two vertices past the shore so shorelines interpolate
  // correctly and the 3D water surface covers every shoreline cell.
  for (let pass = 0; pass < 2; pass++) {
    const prev = level.slice();
    const prevId = lakeId.slice();
    for (let c = 0; c < n; c++) {
      if (!Number.isNaN(prev[c])) continue;
      const cx = c % W, cz = (c / W) | 0;
      let best = NaN, bestId = -1;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], nz = cz + DZ8[d];
        if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        const v = prev[nz * W + nx];
        if (!Number.isNaN(v) && !(v <= best)) { best = v; bestId = prevId[nz * W + nx]; }
      }
      level[c] = best;
      lakeId[c] = bestId;
    }
  }
  const water = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    water[c] = Number.isNaN(level[c]) ? NO_WATER : Math.max(NO_WATER + 0.5, level[c] - h[c]);
  }

  // Label anchors: the point of each lake furthest from its shore (chamfer distance).
  const dist = new Float32Array(n);
  for (let c = 0; c < n; c++) dist[c] = water[c] > 0 ? 1e9 : 0;
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
  for (let c = 0; c < n; c++) {
    if (water[c] <= 0) continue;
    const id = lakeId[c];
    if (id < 0) continue;
    const lk = lakes[id];
    lk.area++;
    if (dist[c] > lk.labelR) { lk.labelR = dist[c]; lk.labelX = c % W; lk.labelZ = (c / W) | 0; }
  }
  return { level, water, lakes: lakes.filter((l) => l.area > 0), lakeId };
}

export interface Fall {
  x: number;
  z: number;
  /** Flow bearing in radians. */
  angle: number;
  drop: number;
  name: string;
}

/** Steep, well-fed drops along the channels. */
export function findFalls(chains: Chain[], water: Float32Array, sea: Uint8Array | null): Fall[] {
  const cands: Fall[] = [];
  for (const ch of chains) {
    for (let i = 0; i + 2 < ch.cells.length; i++) {
      if (ch.acc[i] < 1500) continue;
      const c0 = ch.cells[i], c2 = ch.cells[i + 2];
      if (water[c0] > 0 || water[c2] > 0 || (sea && (sea[c0] || sea[c2]))) continue;
      const drop = ch.surf[i] - ch.surf[i + 2];
      const dx = ((c2 % W) - (c0 % W)) * CELL, dz = (((c2 / W) | 0) - ((c0 / W) | 0)) * CELL;
      const run = Math.hypot(dx, dz);
      if (drop >= 13 && drop / run >= 0.3) {
        const mid = ch.cells[i + 1];
        cands.push({ x: (mid % W) * CELL, z: ((mid / W) | 0) * CELL, angle: Math.atan2(dx, -dz), drop, name: '' });
      }
    }
  }
  cands.sort((a, b) => b.drop - a.drop);
  const out: Fall[] = [];
  for (const f of cands) {
    if (out.length >= 2) break;
    if (out.some((o) => Math.hypot(o.x - f.x, o.z - f.z) < 450)) continue;
    out.push(f);
  }
  return out;
}

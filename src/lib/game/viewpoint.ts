// Choosing where the player stands. Candidates are derived from (seed, index) alone,
// so the server can pick one and hand the client a small token instead of coordinates.

import { mulberry32 } from './noise';
import { MAP_SIZE, HFOV, EYE_HEIGHT, NO_WATER } from './constants';
import { clamp, mix32 } from './math';
import type { Terrain } from './terrain';

export interface Viewpoint {
  token: number;
  x: number;
  z: number;
  bearing: number;
  eye: number;
  pitch: number;
  sunAz: number;
  sunEl: number;
  /** FogExp2 density. */
  haze: number;
}

const CANDIDATES = 700;
const BEARINGS = 5;
const CURVATURE = 1 / (2 * 6371000);

function candidate(seed: number, k: number) {
  const r = mulberry32(mix32(seed ^ 0x5bd1e995, k));
  const x = 400 + r() * (MAP_SIZE - 800);
  const z = 400 + r() * (MAP_SIZE - 800);
  const bearings: number[] = [];
  for (let b = 0; b < BEARINGS; b++) bearings.push(r() * Math.PI * 2);
  return { x, z, bearings };
}

/** Distance from (x, z) to the map edge along bearing a. */
function run(x: number, z: number, a: number) {
  const dx = Math.sin(a), dz = -Math.cos(a);
  const tx = dx > 1e-9 ? (MAP_SIZE - x) / dx : dx < -1e-9 ? -x / dx : Infinity;
  const tz = dz > 1e-9 ? (MAP_SIZE - z) / dz : dz < -1e-9 ? -z / dz : Infinity;
  return Math.min(tx, tz);
}

function standable(t: Terrain, x: number, z: number) {
  if (t.sampleGrid(t.water, x, z) > NO_WATER + 0.01) return false;
  if (t.coastal && t.groundAt(x, z) < 1.5) return false;
  if (t.sampleGrid(t.slope, x, z) > 0.7) return false;
  if (t.sampleGrid(t.wet, x, z) > 0.2) return false;
  if (t.sampleGrid(t.marsh, x, z) > 0.4) return false;
  return true;
}

function evaluate(t: Terrain, x: number, z: number, bearing: number) {
  const ground = t.groundAt(x, z);
  const eye = ground + EYE_HEIGHT;
  let ring = 0;
  for (let q = 0; q < 8; q++) ring += t.groundAt(x + Math.sin(q * 0.785) * 450, z + Math.cos(q * 0.785) * 450);
  const prominence = ground - ring / 8;
  const R = 11;
  const angs: number[] = [];
  let lakeSeen = 0, seaSeen = 0, visArea = 0, far = 0, wall = 0;
  for (let r = 0; r < R; r++) {
    const a = bearing + (r / (R - 1) - 0.5) * HFOV * 0.92;
    const dx = Math.sin(a), dz = -Math.cos(a);
    let maxAng = -1e9, hd = 0, horizonSea = false;
    for (let d = 12; d < 15000; d *= 1.045) {
      const px = x + dx * d, pz = z + dz * d;
      const s = t.surfaceAt(px, pz) - d * d * CURVATURE;
      const ang = (s - eye) / d;
      if (ang > maxAng) {
        maxAng = ang;
        hd = d;
        const sea = t.isSeaAt(px, pz);
        horizonSea = sea;
        if (t.inside(px, pz)) {
          if (sea) seaSeen++;
          else if (t.waterAt(px, pz) > 0) lakeSeen++;
          if (!sea) visArea += Math.min(d, 6000);
        }
      }
    }
    angs.push(Math.atan(maxAng));
    // An open-sea horizon is far away but carries nothing to match on the map.
    if (hd > 1500 && !horizonSea) far++;
    if (hd < 400) wall++;
  }
  const mean = angs.reduce((s, v) => s + v, 0) / R;
  const std = Math.sqrt(angs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / R);
  const forest = t.sampleGrid(t.veg, x, z);
  const score = Math.log(1 + visArea / 15000) + (far / R) * 0.8 - (wall / R) * 1.5 + Math.min(std, 0.12) * 10
    + Math.min(lakeSeen, 8) * 0.06 + Math.min(seaSeen, 10) * 0.012 + clamp(prominence / 60, -0.6, 1) * 0.5 - forest * 0.6;
  return { score, mean };
}

function finalize(t: Terrain, token: number, mean?: number): Viewpoint {
  const k = Math.floor(token / BEARINGS), b = token % BEARINGS;
  const c = candidate(t.seed, k);
  const bearing = c.bearings[b];
  const m = mean ?? evaluate(t, c.x, c.z, bearing).mean;
  const r = mulberry32(mix32(t.seed ^ 0x27d4eb2f, token));
  return {
    token,
    x: c.x,
    z: c.z,
    bearing,
    eye: t.groundAt(c.x, c.z) + EYE_HEIGHT,
    pitch: clamp(m - 0.1, -0.22, 0.06),
    sunAz: bearing + (r() < 0.5 ? 1 : -1) * (0.9 + r() * 1.3),
    sunEl: 0.3 + r() * 0.4,
    haze: 1 / (8000 + r() * 5000),
  };
}

export function chooseViewpoint(t: Terrain): Viewpoint {
  const rng = mulberry32(t.seed ^ 0x9e3779b9);
  const cands: { token: number; score: number; mean: number }[] = [];
  let fallback = -1;
  for (let k = 0; k < CANDIDATES && cands.length < 110; k++) {
    const c = candidate(t.seed, k);
    if (!standable(t, c.x, c.z)) continue;
    if (fallback < 0) fallback = k * BEARINGS;
    let b = -1;
    for (let i = 0; i < BEARINGS; i++) {
      const a = c.bearings[i];
      if (run(c.x, c.z, a) > 2200 && run(c.x, c.z, a - HFOV / 2) > 1100 && run(c.x, c.z, a + HFOV / 2) > 1100) { b = i; break; }
    }
    if (b < 0) continue;
    const ev = evaluate(t, c.x, c.z, c.bearings[b]);
    cands.push({ token: k * BEARINGS + b, score: ev.score + rng() * 0.3, mean: ev.mean });
  }
  if (!cands.length) return finalize(t, Math.max(0, fallback));
  cands.sort((a, b) => b.score - a.score);
  const pick = cands[Math.floor(rng() * Math.min(5, cands.length))];
  return finalize(t, pick.token, pick.mean);
}

export function viewpointFromToken(t: Terrain, token: number): Viewpoint {
  return finalize(t, token);
}

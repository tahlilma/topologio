import { makeSimplex, fbm, ridged, type Rng } from './noise';
import { MAP_SIZE } from './constants';
import { smoothstep } from './math';

/** Broad landscape type; decides which water and ice features a map gets. */
export type Character = 'mountain' | 'lakeland' | 'coastal' | 'glacial';

export interface ElevParams {
  base: number;
  relief: number;
  scale: number;
  warp: number;
  ridgeW: number;
  tiltA: number;
  tilt: number;
  valley: number;
  ox: number;
  oz: number;
  coastA: number;
  coastAmp: number;
  /** Subtracted from every height; coastal maps use it to put sea level at 0 m. */
  offset: number;
}

export function makeElevation(rng: Rng, character: Character) {
  const nW1 = makeSimplex(rng), nW2 = makeSimplex(rng), nF = makeSimplex(rng);
  const nR = makeSimplex(rng), nB = makeSimplex(rng), nD = makeSimplex(rng);
  const P: ElevParams = {
    base: 2150 + rng() * 500,
    relief: 420 + rng() * 330,
    scale: 3800 + rng() * 2200,
    warp: 250 + rng() * 450,
    ridgeW: 0.35 + rng() * 0.45,
    tiltA: rng() * Math.PI * 2,
    tilt: 0.4 + rng() * 0.8,
    valley: 1.2 + rng() * 0.5,
    ox: (rng() - 0.5) * 2e4,
    oz: (rng() - 0.5) * 2e4,
    coastA: rng() * Math.PI * 2,
    coastAmp: 0,
    offset: 0,
  };
  if (character === 'glacial') {
    P.relief *= 1.3;
    P.ridgeW = Math.min(0.9, P.ridgeW + 0.2);
    P.base += 350;
  } else if (character === 'lakeland') {
    P.relief *= 0.8;
    P.valley += 0.35;
  } else if (character === 'coastal') {
    P.coastAmp = 0.7 + rng() * 0.5;
    P.base = 0;
  }
  const cx = Math.cos(P.tiltA), cz = Math.sin(P.tiltA);
  const kx = Math.cos(P.coastA), kz = Math.sin(P.coastA);

  const f = (x: number, z: number) => {
    const X = x + P.ox, Z = z + P.oz;
    const wx = X + P.warp * fbm(nW1, X / 2200, Z / 2200, 3);
    const wz = Z + P.warp * fbm(nW2, X / 2200, Z / 2200, 3);
    const u = wx / P.scale, v = wz / P.scale;
    const fb = fbm(nF, u, v, 5) * 0.5 + 0.5;
    const rg = ridged(nR, u * 0.75, v * 0.75, 5);
    const trend = ((x - MAP_SIZE / 2) * cx + (z - MAP_SIZE / 2) * cz) / MAP_SIZE;
    const m = smoothstep(-0.75, 0.75, nB(X / 16000, Z / 16000) * 0.7 + trend * P.tilt);
    let e = 0.22 * fb + (0.35 + 0.65 * m) * (P.ridgeW * rg * 1.5 + (1 - P.ridgeW) * fb);
    e = Math.pow(Math.max(e, 0), P.valley);
    let h = P.base + P.relief * 1.5 * e + 4 * nD(X / 420, Z / 420) + 1.2 * nD(X / 170 + 50, Z / 170);
    if (P.coastAmp) {
      // Land rises away from the sea; tanh keeps the far outer ring from running away.
      const proj = ((x - MAP_SIZE / 2) * kx + (z - MAP_SIZE / 2) * kz) / MAP_SIZE;
      h += (P.relief * 1.5 * P.coastAmp * Math.tanh(proj * 1.8)) / 1.2;
    }
    return h - P.offset;
  };
  return { f, P };
}

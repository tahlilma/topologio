import { clamp } from './math';
import type { DifficultyConfig } from './difficulty';

export const HINT_IDS = ['area', 'elevation', 'compass'] as const;
export type HintId = (typeof HINT_IDS)[number];

export const HINTS: Record<HintId, { label: string; cost: string; part: 'pos' | 'dir'; factor: number }> = {
  area: { label: 'Search area', cost: '−25% position', part: 'pos', factor: 0.75 },
  elevation: { label: 'Your elevation', cost: '−15% position', part: 'pos', factor: 0.85 },
  compass: { label: 'Compass', cost: '−50% facing', part: 'dir', factor: 0.5 },
};

export const isHint = (v: unknown): v is HintId => typeof v === 'string' && (HINT_IDS as readonly string[]).includes(v);

/** Radius of the search-area circle, in metres. */
export const AREA_RADIUS = 1000;

export interface RoundScore {
  pos: number;
  dir: number;
  time: number;
  total: number;
}

export function scoreRound(
  cfg: DifficultyConfig,
  r: { dist: number; angErrDeg: number; timeS: number; hints: HintId[]; noGuess?: boolean },
): RoundScore {
  if (r.noGuess) return { pos: 0, dir: 0, time: 0, total: 0 };
  let posF = 1, dirF = 1;
  for (const h of r.hints) {
    if (h === 'area' && cfg.freeSearchArea) continue;
    if (HINTS[h].part === 'pos') posF *= HINTS[h].factor;
    else dirF *= HINTS[h].factor;
  }
  const posRaw = 2500 * Math.exp(-Math.max(0, r.dist - cfg.pos.tol) / cfg.pos.scale);
  const dirT = clamp(1 - Math.max(0, r.angErrDeg - cfg.dir.tol) / (cfg.dir.zero - cfg.dir.tol), 0, 1);
  const dirRaw = 1500 * Math.pow(dirT, 1.25);
  const pos = Math.round(posRaw * posF);
  const dir = Math.round(dirRaw * dirF);
  const timeT = clamp(1 - Math.max(0, r.timeS - 5) / (cfg.timeWindow - 5), 0, 1);
  const time = Math.round(1000 * timeT * ((pos + dir) / 4000));
  return { pos, dir, time, total: pos + dir + time };
}

export function rankFor(total: number, max: number) {
  const f = total / max;
  if (f >= 0.86) return 'Summit Surveyor';
  if (f >= 0.68) return 'Ridge Runner';
  if (f >= 0.48) return 'Trail Reader';
  if (f >= 0.28) return 'Day Hiker';
  return 'Lost in the Fog';
}

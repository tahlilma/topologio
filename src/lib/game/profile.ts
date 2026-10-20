import type { Terrain } from './terrain';

export interface ProfileSample {
  /** Distance from the start, metres. */
  d: number;
  ground: number;
  surface: number;
  water: boolean;
}

/** Ground and water-surface elevations along a straight line on the map. */
export function sampleProfile(t: Terrain, ax: number, az: number, bx: number, bz: number, n = 180): ProfileSample[] {
  const len = Math.hypot(bx - ax, bz - az);
  const out: ProfileSample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    const ground = t.groundAt(x, z);
    const surface = t.surfaceAt(x, z);
    out.push({ d: len * f, ground, surface, water: surface > ground + 0.05 });
  }
  return out;
}

import { MAP_SIZE } from './constants';
import { clamp, mix32 } from './math';
import { mulberry32 } from './noise';
import { AREA_RADIUS } from './scoring';

/**
 * The search circle for a map: always contains the true spot, offset from it by a
 * deterministic amount so the centre gives nothing away. Clamping the centre into the
 * map never moves it further from the answer, which lies inside the map.
 */
export function searchArea(seed: number, x: number, z: number) {
  const r = mulberry32(mix32(seed >>> 0, 0xa7ea));
  const ang = r() * Math.PI * 2;
  const d = Math.sqrt(r()) * 0.6 * AREA_RADIUS;
  return {
    x: clamp(x + Math.cos(ang) * d, 0, MAP_SIZE),
    z: clamp(z + Math.sin(ang) * d, 0, MAP_SIZE),
    r: AREA_RADIUS,
  };
}

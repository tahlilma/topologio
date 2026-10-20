export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed smallest difference a - b between two angles, in radians. */
export function angDiff(a: number, b: number) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export const normBearing = (b: number) => ((b % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** FNV-1a string hash. */
export function hash32(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer mix of two 32-bit values (murmur-style finalizer). */
export function mix32(a: number, b: number) {
  let h = (a ^ Math.imul((b + 0x9e3779b9) | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seed of round n (1-based) in a game with the given base seed. */
export const roundSeed = (base: number, n: number) => mix32(base >>> 0, n * 7919 + 13);

// World and grid constants shared by the generator, renderers and server scoring.
// Coordinates: x = metres east, z = metres south (map down), origin at the map's NW corner.
// Bearings are clockwise from north, in radians.

/** Bump when generation output changes, so cached viewpoints are recomputed. */
export const GEN_VERSION = 2;

export const MAP_SIZE = 6400; // metres per side of the quadrangle
export const N = 320; // grid cells per side
export const CELL = MAP_SIZE / N; // 20 m
export const W = N + 1; // vertices per side
export const OUT_STEP = 8; // the outer ring uses 8x coarser cells
export const OUT_CELL = CELL * OUT_STEP;
export const OUT_PAD = 80; // outer cells beyond each map edge (12.8 km)
export const OW = OUT_PAD * 2 + N / OUT_STEP + 1;
export const OUT_ORIGIN = -OUT_PAD * OUT_CELL;

export const EYE_HEIGHT = 1.8;
export const VFOV = 45; // degrees, vertical
export const ASPECT = 16 / 9;
export const HFOV = 2 * Math.atan(Math.tan((VFOV * Math.PI) / 360) * ASPECT);

export const M_TO_FT = 3.28084;
export const NO_WATER = -5;

export const ROUNDS = 5;
export const MAX_ROUND_SCORE = 5000;
export const MAX_GAME_SCORE = ROUNDS * MAX_ROUND_SCORE;

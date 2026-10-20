// Generates a batch of maps and prints feature statistics and timings.
// Usage: npm run check:terrain [-- count]
import { generateTerrain } from '../src/lib/game/terrain';
import { chooseViewpoint, viewpointFromToken } from '../src/lib/game/viewpoint';
import { W, M_TO_FT } from '../src/lib/game/constants';

const count = Number(process.argv[2]) || 16;
const tally: Record<string, number> = {};
let totalMs = 0, worstMs = 0;
for (let i = 0; i < count; i++) {
  const seed = (i * 2654435761) >>> 0;
  const t0 = performance.now();
  const t = generateTerrain(seed);
  const t1 = performance.now();
  const vp = chooseViewpoint(t);
  const t2 = performance.now();
  const again = viewpointFromToken(generateTerrain(seed), vp.token);
  if (again.x !== vp.x || again.z !== vp.z || again.bearing !== vp.bearing) throw new Error(`token mismatch for seed ${seed}`);
  let lake = 0, sea = 0, veg = 0, gl = 0, marsh = 0;
  for (let c = 0; c < W * W; c++) {
    if (t.water[c] > 0) lake++;
    if (t.sea && t.sea[c]) sea++;
    if (t.veg[c] > 0.5) veg++;
    if (t.glacier[c] > 0.5) gl++;
    if (t.marsh[c] > 0.5) marsh++;
  }
  const pct = (v: number) => ((v / (W * W)) * 100).toFixed(1) + '%';
  const rivers = t.rivers.filter((r) => r.width[r.width.length - 1] >= 8).length;
  tally[t.character] = (tally[t.character] ?? 0) + 1;
  if (t.dam) tally.dams = (tally.dams ?? 0) + 1;
  if (t.falls.length) tally.falls = (tally.falls ?? 0) + 1;
  const ms = t1 - t0;
  totalMs += ms;
  worstMs = Math.max(worstMs, ms);
  console.log(
    `${String(seed).padStart(10)} ${t.character.padEnd(8)} ${t.name.padEnd(22)}`,
    `relief ${Math.round((t.maxH - t.minH) * M_TO_FT)}ft`,
    `lakes ${t.lakes.length} (${pct(lake)})${t.dam ? ' +dam' : ''}`,
    `sea ${pct(sea)} rivers ${rivers}/${t.rivers.length} falls ${t.falls.length}`,
    `glacier ${pct(gl)} marsh ${pct(marsh)} forest ${pct(veg)}`,
    `gen ${ms.toFixed(0)}ms vp ${(t2 - t1).toFixed(0)}ms`,
  );
}
console.log(tally, `avg ${(totalMs / count).toFixed(0)}ms worst ${worstMs.toFixed(0)}ms`);

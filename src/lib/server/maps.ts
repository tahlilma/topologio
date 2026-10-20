import { and, eq } from 'drizzle-orm';
import { getDb } from './db';
import { maps } from './schema';
import { generateTerrain } from '@/lib/game/terrain';
import { chooseViewpoint } from '@/lib/game/viewpoint';
import { GEN_VERSION, M_TO_FT } from '@/lib/game/constants';

export interface MapInfo {
  seed: number;
  token: number;
  x: number;
  z: number;
  bearing: number;
  groundFt: number;
  name: string;
  character: string;
}

const memo = new Map<number, Promise<MapInfo>>();
const MEMO_LIMIT = 400;

async function load(seed: number): Promise<MapInfo> {
  const db = await getDb();
  const row = await db.select().from(maps).where(and(eq(maps.seed, seed), eq(maps.gen, GEN_VERSION))).get();
  if (row) {
    return { seed, token: row.token, x: row.x, z: row.z, bearing: row.bearing, groundFt: row.groundFt, name: row.name, character: row.character };
  }
  const t = generateTerrain(seed);
  const vp = chooseViewpoint(t);
  const info: MapInfo = {
    seed, token: vp.token, x: vp.x, z: vp.z, bearing: vp.bearing,
    groundFt: t.groundAt(vp.x, vp.z) * M_TO_FT, name: t.name, character: t.character,
  };
  await db.insert(maps).values({ ...info, gen: GEN_VERSION, createdAt: Date.now() }).onConflictDoNothing();
  return info;
}

/** The answer for a map seed: where the viewer stands and which way they face. */
export function getMapInfo(seed: number): Promise<MapInfo> {
  seed >>>= 0;
  let p = memo.get(seed);
  if (!p) {
    p = load(seed);
    p.catch(() => memo.delete(seed));
    memo.set(seed, p);
    if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  }
  return p;
}

import { z } from 'zod';
import { handle, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/auth';
import { createGame } from '@/lib/server/games';
import { clientIp, limit } from '@/lib/server/ratelimit';

const Body = z.object({
  mode: z.enum(['classic', 'daily', 'challenge']),
  difficulty: z.string().optional(),
  challengeOf: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const p = await requirePlayer();
    // Each new game makes the server generate up to five maps.
    limit(`game-create:${p.id}`, 40, 3_600_000);
    limit(`game-create-ip:${await clientIp()}`, 120, 3_600_000);
    const body = Body.parse(await readJson(req));
    return { id: await createGame(p, body) };
  });
}

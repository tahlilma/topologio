import { z } from 'zod';
import { handle, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/auth';
import { createGame } from '@/lib/server/games';

const Body = z.object({
  mode: z.enum(['classic', 'daily', 'challenge']),
  difficulty: z.string().optional(),
  challengeOf: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const p = await requirePlayer();
    const body = Body.parse(await readJson(req));
    return { id: await createGame(p, body) };
  });
}

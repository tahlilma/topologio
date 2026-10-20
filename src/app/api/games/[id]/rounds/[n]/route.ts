import { z } from 'zod';
import { handle, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/auth';
import { startRound, submitGuess, useHint } from '@/lib/server/games';
import { MAP_SIZE } from '@/lib/game/constants';

const Guess = z.object({
  x: z.number().finite().min(0).max(MAP_SIZE),
  z: z.number().finite().min(0).max(MAP_SIZE),
  bearing: z.number().finite().min(0).max(Math.PI * 2 + 1e-6),
});

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('hint'), hint: z.string() }),
  z.object({ action: z.literal('guess'), guess: Guess.nullable() }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  return handle(async () => {
    const { id, n } = await ctx.params;
    const round = Number(n);
    const p = await requirePlayer();
    const body = Body.parse(await readJson(req));
    if (body.action === 'start') return startRound(p, id, round);
    if (body.action === 'hint') return { hints: await useHint(p, id, round, body.hint) };
    return submitGuess(p, id, round, body.guess);
  });
}

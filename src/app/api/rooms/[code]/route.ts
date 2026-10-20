import { after } from 'next/server';
import { z } from 'zod';
import { handle, readJson } from '@/lib/server/http';
import { currentPlayer, requirePlayer } from '@/lib/server/auth';
import { joinRoom, leaveRoom, pollRoom, setRoomDifficulty, skipReveal, startRace, warmRace } from '@/lib/server/rooms';
import { clientIp, limit } from '@/lib/server/ratelimit';

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    limit(`room-poll:${await clientIp()}`, 400, 60_000);
    const { code } = await ctx.params;
    return pollRoom(await currentPlayer(), code);
  });
}

const Body = z.object({
  action: z.enum(['join', 'leave', 'start', 'difficulty', 'skip']),
  difficulty: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = await ctx.params;
    const p = await requirePlayer();
    limit(`room-action:${p.id}`, 60, 60_000);
    const body = Body.parse(await readJson(req));
    switch (body.action) {
      case 'join':
        await joinRoom(p, code);
        break;
      case 'leave':
        await leaveRoom(p, code);
        return { ok: true };
      case 'difficulty':
        await setRoomDifficulty(p, code, body.difficulty);
        break;
      case 'skip':
        await skipReveal(p, code);
        break;
      case 'start': {
        const seed = await startRace(p, code);
        after(() => warmRace(seed));
        break;
      }
    }
    return pollRoom(p, code);
  });
}

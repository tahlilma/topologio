import { handle } from '@/lib/server/http';
import { currentPlayer, requirePlayer } from '@/lib/server/auth';
import { abandonGame, getGameView } from '@/lib/server/games';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    return getGameView(id, await currentPlayer());
  });
}

/** Abandons an unfinished classic game. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await abandonGame(await requirePlayer(), id);
    return { ok: true };
  });
}

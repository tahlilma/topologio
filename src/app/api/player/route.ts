import { handle, readJson } from '@/lib/server/http';
import { createPlayer, currentPlayer, renamePlayer, requirePlayer, signOut } from '@/lib/server/auth';
import { clientIp, limit } from '@/lib/server/ratelimit';

export async function GET() {
  return handle(async () => {
    const p = await currentPlayer();
    return { player: p ? { id: p.id, name: p.name } : null };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    limit(`player-create:${await clientIp()}`, 10, 3_600_000);
    const body = (await readJson(req)) as { name?: unknown };
    const { player, key } = await createPlayer(body?.name);
    return { player: { id: player.id, name: player.name }, key };
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const p = await requirePlayer();
    limit(`player-rename:${p.id}`, 10, 3_600_000);
    const body = (await readJson(req)) as { name?: unknown };
    const name = await renamePlayer(p, body?.name);
    return { player: { id: p.id, name } };
  });
}

export async function DELETE() {
  return handle(async () => {
    await signOut();
    return { ok: true };
  });
}

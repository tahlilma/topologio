import { handle, readJson } from '@/lib/server/http';
import { restorePlayer } from '@/lib/server/auth';
import { clientIp, limit } from '@/lib/server/ratelimit';

export async function POST(req: Request) {
  return handle(async () => {
    limit(`player-restore:${await clientIp()}`, 20, 15 * 60_000);
    const body = (await readJson(req)) as { key?: unknown };
    const p = await restorePlayer(body?.key);
    return { player: { id: p.id, name: p.name } };
  });
}

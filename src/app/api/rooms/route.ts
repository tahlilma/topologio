import { handle, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/auth';
import { createRoom } from '@/lib/server/rooms';
import { limit } from '@/lib/server/ratelimit';

export async function POST(req: Request) {
  return handle(async () => {
    const p = await requirePlayer();
    limit(`room-create:${p.id}`, 20, 3_600_000);
    const body = (await readJson(req)) as { difficulty?: unknown };
    return { code: await createRoom(p, body?.difficulty ?? 'normal') };
  });
}

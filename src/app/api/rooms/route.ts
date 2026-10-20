import { handle, readJson } from '@/lib/server/http';
import { requirePlayer } from '@/lib/server/auth';
import { createRoom } from '@/lib/server/rooms';

export async function POST(req: Request) {
  return handle(async () => {
    const p = await requirePlayer();
    const body = (await readJson(req)) as { difficulty?: unknown };
    return { code: await createRoom(p, body?.difficulty ?? 'normal') };
  });
}

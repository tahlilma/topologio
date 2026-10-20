import { handle, readJson } from '@/lib/server/http';
import { restorePlayer } from '@/lib/server/auth';

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as { key?: unknown };
    const p = await restorePlayer(body?.key);
    return { player: { id: p.id, name: p.name } };
  });
}

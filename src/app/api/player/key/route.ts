import { handle } from '@/lib/server/http';
import { requirePlayer, rotateKey } from '@/lib/server/auth';
import { limit } from '@/lib/server/ratelimit';

/** Issues a fresh player key; the old one stops working everywhere. */
export async function POST() {
  return handle(async () => {
    const p = await requirePlayer();
    limit(`player-key:${p.id}`, 5, 3_600_000);
    return { key: await rotateKey(p) };
  });
}

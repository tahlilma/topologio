import { handle } from '@/lib/server/http';
import { requirePlayer, rotateKey } from '@/lib/server/auth';

/** Issues a fresh player key; the old one stops working everywhere. */
export async function POST() {
  return handle(async () => {
    const p = await requirePlayer();
    return { key: await rotateKey(p) };
  });
}

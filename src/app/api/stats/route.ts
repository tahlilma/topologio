import { handle, HttpError } from '@/lib/server/http';
import { currentPlayer } from '@/lib/server/auth';
import { findPlayerByName, getPlayerStats } from '@/lib/server/stats';

export async function GET(req: Request) {
  return handle(async () => {
    const name = new URL(req.url).searchParams.get('name');
    const me = await currentPlayer();
    const who = name ? await findPlayerByName(name) : me && { id: me.id, name: me.name, createdAt: me.createdAt };
    if (!who) throw new HttpError(404, name ? 'No player has that name.' : 'Choose a name to start collecting stats.');
    return getPlayerStats(who);
  });
}

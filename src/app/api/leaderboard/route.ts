import { handle, HttpError } from '@/lib/server/http';
import { currentPlayer } from '@/lib/server/auth';
import { getLeaderboard, type Board } from '@/lib/server/leaderboard';
import { isDifficulty } from '@/lib/game/difficulty';

export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const board = (q.get('board') ?? 'all') as Board;
    if (!['daily', 'week', 'all'].includes(board)) throw new HttpError(400, 'Unknown leaderboard.');
    const d = q.get('difficulty') ?? 'normal';
    if (!isDifficulty(d)) throw new HttpError(400, 'Unknown difficulty.');
    const date = q.get('date') ?? undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Dates are written like 2026-10-11.');
    return getLeaderboard(board, d, await currentPlayer(), { date });
  });
}

import { getClient } from './db';
import { todayUtc } from './daily';
import type { Player } from './schema';
import type { Difficulty } from '@/lib/game/difficulty';

export type Board = 'daily' | 'week' | 'all';

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  games: number;
  isMe: boolean;
}

export interface Leaderboard {
  board: Board;
  difficulty: Difficulty;
  date: string;
  players: number;
  rows: BoardRow[];
  me: BoardRow | null;
}

const num = (v: unknown) => Number(v ?? 0);

export async function getLeaderboard(
  board: Board, difficulty: Difficulty, viewer: Player | null, opts: { date?: string; limit?: number } = {},
): Promise<Leaderboard> {
  const client = await getClient();
  const limit = opts.limit ?? 50;
  const date = opts.date ?? todayUtc();
  if (board === 'daily') {
    const rs = await client.execute({
      sql: `SELECT p.name, g.player_id, g.total, g.total_time FROM games g JOIN players p ON p.id = g.player_id
            WHERE g.mode = 'daily' AND g.daily_date = ? AND g.status = 'finished'
            ORDER BY g.total DESC, g.total_time ASC LIMIT ?`,
      args: [date, limit],
    });
    const count = await client.execute({
      sql: `SELECT COUNT(*) AS c FROM games WHERE mode = 'daily' AND daily_date = ? AND status = 'finished'`,
      args: [date],
    });
    const rows: BoardRow[] = rs.rows.map((r, i) => ({
      rank: i + 1, name: String(r.name), score: num(r.total), games: 1, isMe: viewer?.id === r.player_id,
    }));
    let me = rows.find((r) => r.isMe) ?? null;
    if (!me && viewer) {
      const mine = await client.execute({
        sql: `SELECT total, total_time FROM games WHERE player_id = ? AND mode = 'daily' AND daily_date = ? AND status = 'finished'`,
        args: [viewer.id, date],
      });
      if (mine.rows[0]) {
        const t = num(mine.rows[0].total), tt = num(mine.rows[0].total_time);
        const ahead = await client.execute({
          sql: `SELECT COUNT(*) AS c FROM games WHERE mode = 'daily' AND daily_date = ? AND status = 'finished'
                AND (total > ? OR (total = ? AND total_time < ?))`,
          args: [date, t, t, tt],
        });
        me = { rank: num(ahead.rows[0].c) + 1, name: viewer.name, score: t, games: 1, isMe: true };
      }
    }
    return { board, difficulty: 'normal', date, players: num(count.rows[0].c), rows, me };
  }

  const since = board === 'week' ? Date.now() - 7 * 86400_000 : 0;
  const rs = await client.execute({
    sql: `SELECT p.name, g.player_id, MAX(g.total) AS best, COUNT(*) AS n FROM games g JOIN players p ON p.id = g.player_id
          WHERE g.status = 'finished' AND g.difficulty = ? AND g.finished_at >= ?
          GROUP BY g.player_id ORDER BY best DESC, MIN(g.finished_at) ASC LIMIT ?`,
    args: [difficulty, since, limit],
  });
  const count = await client.execute({
    sql: `SELECT COUNT(DISTINCT player_id) AS c FROM games WHERE status = 'finished' AND difficulty = ? AND finished_at >= ?`,
    args: [difficulty, since],
  });
  const rows: BoardRow[] = rs.rows.map((r, i) => ({
    rank: i + 1, name: String(r.name), score: num(r.best), games: num(r.n), isMe: viewer?.id === r.player_id,
  }));
  let me = rows.find((r) => r.isMe) ?? null;
  if (!me && viewer) {
    const mine = await client.execute({
      sql: `SELECT MAX(total) AS best, COUNT(*) AS n FROM games WHERE player_id = ? AND status = 'finished' AND difficulty = ? AND finished_at >= ?`,
      args: [viewer.id, difficulty, since],
    });
    if (num(mine.rows[0]?.n) > 0) {
      const best = num(mine.rows[0].best);
      const ahead = await client.execute({
        sql: `SELECT COUNT(*) AS c FROM (SELECT MAX(total) AS b FROM games WHERE status = 'finished' AND difficulty = ? AND finished_at >= ?
              GROUP BY player_id) WHERE b > ?`,
        args: [difficulty, since, best],
      });
      me = { rank: num(ahead.rows[0].c) + 1, name: viewer.name, score: best, games: num(mine.rows[0].n), isMe: true };
    }
  }
  return { board, difficulty, date, players: num(count.rows[0].c), rows, me };
}

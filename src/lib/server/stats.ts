import { getClient } from './db';
import { shiftDate, todayUtc } from './daily';
import { DIFFICULTIES, type Difficulty } from '@/lib/game/difficulty';

export interface DifficultyStats {
  difficulty: Difficulty;
  games: number;
  avg: number;
  best: number;
  /** Average of every other player's average on this difficulty. */
  othersAvg: number | null;
  /** Share of other players whose average is below yours, 0..1. */
  percentile: number | null;
  players: number;
}

export interface HistoryPoint {
  id: string;
  total: number;
  difficulty: Difficulty;
  mode: string;
  finishedAt: number;
}

export interface PlayerStats {
  player: { id: string; name: string; createdAt: number };
  games: number;
  rounds: number;
  byDifficulty: DifficultyStats[];
  accuracy: {
    medianDist: number | null;
    medianAngErr: number | null;
    medianTime: number | null;
    within100: number | null;
    sharpFacing: number | null;
    hintsPerRound: number | null;
  };
  history: HistoryPoint[];
  streak: { current: number; best: number; playedToday: boolean };
}

const num = (v: unknown) => Number(v ?? 0);

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function findPlayerByName(name: string) {
  const client = await getClient();
  const rs = await client.execute({ sql: 'SELECT id, name, created_at FROM players WHERE name_key = ?', args: [name.toLowerCase()] });
  const r = rs.rows[0];
  return r ? { id: String(r.id), name: String(r.name), createdAt: num(r.created_at) } : null;
}

export async function getPlayerStats(player: { id: string; name: string; createdAt: number }): Promise<PlayerStats> {
  const client = await getClient();
  const hist = await client.execute({
    sql: `SELECT id, total, difficulty, mode, finished_at FROM games WHERE player_id = ? AND status = 'finished' ORDER BY finished_at ASC`,
    args: [player.id],
  });
  const history: HistoryPoint[] = hist.rows.map((r) => ({
    id: String(r.id), total: num(r.total), difficulty: String(r.difficulty) as Difficulty, mode: String(r.mode), finishedAt: num(r.finished_at),
  }));

  const byDifficulty: DifficultyStats[] = [];
  for (const d of DIFFICULTIES) {
    const mine = history.filter((h) => h.difficulty === d);
    if (!mine.length) continue;
    const avg = mine.reduce((s, h) => s + h.total, 0) / mine.length;
    const best = Math.max(...mine.map((h) => h.total));
    const g = await client.execute({
      sql: `SELECT COUNT(*) AS players, SUM(a) AS total, SUM(CASE WHEN a < ? THEN 1 ELSE 0 END) AS below
            FROM (SELECT AVG(total) AS a FROM games WHERE status = 'finished' AND difficulty = ? AND player_id != ? GROUP BY player_id)`,
      args: [avg, d, player.id],
    });
    const others = num(g.rows[0].players);
    byDifficulty.push({
      difficulty: d, games: mine.length, avg, best,
      othersAvg: others ? num(g.rows[0].total) / others : null,
      percentile: others ? num(g.rows[0].below) / others : null,
      players: others + 1,
    });
  }

  const rr = await client.execute({
    sql: `SELECT r.dist, r.ang_err, r.time_s, r.hints, r.guess_x FROM rounds r JOIN games g ON g.id = r.game_id
          WHERE g.player_id = ? AND r.submitted_at IS NOT NULL ORDER BY r.submitted_at DESC LIMIT 600`,
    args: [player.id],
  });
  const guessed = rr.rows.filter((r) => r.guess_x != null);
  const dists = guessed.map((r) => num(r.dist));
  const angs = guessed.map((r) => num(r.ang_err));
  const times = guessed.map((r) => num(r.time_s));
  const hints = rr.rows.reduce((s, r) => s + String(r.hints ?? '').split(',').filter(Boolean).length, 0);

  const days = await client.execute({
    sql: `SELECT daily_date FROM games WHERE player_id = ? AND mode = 'daily' AND status = 'finished' ORDER BY daily_date ASC`,
    args: [player.id],
  });
  const dates = new Set(days.rows.map((r) => String(r.daily_date)));
  const today = todayUtc();
  let best = 0, run = 0, prev = '';
  for (const d of [...dates].sort()) {
    run = prev && shiftDate(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  let cursor = dates.has(today) ? today : shiftDate(today, -1);
  while (dates.has(cursor)) { current++; cursor = shiftDate(cursor, -1); }

  return {
    player,
    games: history.length,
    rounds: rr.rows.length,
    byDifficulty,
    accuracy: {
      medianDist: median(dists),
      medianAngErr: median(angs),
      medianTime: median(times),
      within100: guessed.length ? dists.filter((d) => d <= 100).length / guessed.length : null,
      sharpFacing: guessed.length ? angs.filter((a) => a <= 10).length / guessed.length : null,
      hintsPerRound: rr.rows.length ? hints / rr.rows.length : null,
    },
    history,
    streak: { current, best, playedToday: dates.has(today) },
  };
}

export async function dailySummary(date = todayUtc()) {
  const client = await getClient();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c, AVG(total) AS a, MAX(total) AS m FROM games WHERE mode = 'daily' AND daily_date = ? AND status = 'finished'`,
    args: [date],
  });
  const r = rs.rows[0];
  return { date, players: num(r.c), avg: r.a == null ? null : num(r.a), best: r.m == null ? null : num(r.m) };
}

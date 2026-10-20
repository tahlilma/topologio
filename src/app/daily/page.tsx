import Link from 'next/link';
import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { dailyGameOf } from '@/lib/server/games';
import { getLeaderboard } from '@/lib/server/leaderboard';
import { dailySummary, getPlayerStats } from '@/lib/server/stats';
import { todayUtc } from '@/lib/server/daily';
import { fmtInt } from '@/lib/client/format';
import { StartGameButton } from '@/components/StartGameButton';
import { BoardTable } from '@/components/BoardTable';
import { ResetClock } from '@/components/ResetClock';

export const metadata: Metadata = { title: 'Daily challenge' };

export default async function DailyPage() {
  const viewer = await currentPlayer();
  const date = todayUtc();
  const [mine, summary, board, stats] = await Promise.all([
    viewer ? dailyGameOf(viewer.id, date) : null,
    dailySummary(date),
    getLeaderboard('daily', 'normal', viewer, { limit: 25 }),
    viewer ? getPlayerStats({ id: viewer.id, name: viewer.name, createdAt: viewer.createdAt }) : null,
  ]);
  const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Daily challenge · {pretty}</p>
        <h1>Today’s five maps</h1>
        <p className="lede">
          Everyone gets the same five Normal maps. One attempt per day. New maps in <ResetClock />.
        </p>
      </header>

      <div className="daily-grid">
        <section className="panel daily-status">
          {mine?.status === 'finished' ? (
            <>
              <p className="eyebrow">Your result</p>
              <p className="big-num">{fmtInt(mine.total)}</p>
              <p className="muted">
                {board.me ? `#${board.me.rank} of ${fmtInt(board.players)} players today.` : `${fmtInt(board.players)} players today.`}
              </p>
              <div className="button-row">
                <Link className="btn" href={`/game/${mine.id}`}>Review your maps</Link>
              </div>
            </>
          ) : mine ? (
            <>
              <p className="eyebrow">In progress</p>
              <p className="muted">You started today’s maps. The clock keeps running on the round you were on.</p>
              <div className="button-row"><Link className="btn" href={`/game/${mine.id}`}>Continue</Link></div>
            </>
          ) : (
            <>
              <p className="eyebrow">Not played yet</p>
              <p className="muted">{summary.players ? `${fmtInt(summary.players)} ${summary.players === 1 ? 'player has' : 'players have'} finished today, averaging ${fmtInt(summary.avg ?? 0)}.` : 'Be the first to finish today.'}</p>
              <div className="button-row"><StartGameButton mode="daily" label="Play today’s maps" /></div>
            </>
          )}
          {stats && (
            <div className="tiles">
              <div className="tile"><small>Current streak</small><b>{stats.streak.current} {stats.streak.current === 1 ? 'day' : 'days'}</b></div>
              <div className="tile"><small>Best streak</small><b>{stats.streak.best} {stats.streak.best === 1 ? 'day' : 'days'}</b></div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="section-title">Today’s leaderboard</h2>
            <Link className="linkish" href="/leaderboard?board=daily">Full board</Link>
          </div>
          <BoardTable board={board} empty="No finished surveys yet today." />
        </section>
      </div>
    </main>
  );
}

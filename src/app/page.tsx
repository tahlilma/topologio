import Link from 'next/link';
import { currentPlayer } from '@/lib/server/auth';
import { activeGame, dailyGameOf } from '@/lib/server/games';
import { getLeaderboard } from '@/lib/server/leaderboard';
import { dailySummary, getPlayerStats } from '@/lib/server/stats';
import { todayUtc } from '@/lib/server/daily';
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';
import { fmtInt, MODE_LABEL } from '@/lib/client/format';
import { HomeInteractive } from '@/components/home/HomeInteractive';
import type { DifficultyRecords } from '@/components/home/PlayLauncher';
import { RaceQuick } from '@/components/home/RaceQuick';
import { BoardPreview } from '@/components/home/BoardPreview';
import { StartGameButton } from '@/components/StartGameButton';
import { ResetClock } from '@/components/ResetClock';

export default async function Home() {
  const viewer = await currentPlayer();
  const date = todayUtc();
  const [active, daily, summary, dailyBoard, allBoard, stats, tops] = await Promise.all([
    viewer ? activeGame(viewer) : null,
    viewer ? dailyGameOf(viewer.id, date) : null,
    dailySummary(date),
    getLeaderboard('daily', 'normal', viewer, { limit: 5 }),
    getLeaderboard('all', 'normal', viewer, { limit: 5 }),
    viewer ? getPlayerStats({ id: viewer.id, name: viewer.name, createdAt: viewer.createdAt }) : null,
    Promise.all(DIFFICULTIES.map((d) => getLeaderboard('all', d, null, { limit: 1 }))),
  ]);

  const records = Object.fromEntries(
    DIFFICULTIES.map((d, i) => {
      const mine = stats?.byDifficulty.find((x) => x.difficulty === d);
      const top = tops[i].rows[0];
      return [d, { best: mine?.best ?? null, top: top ? { name: top.name, score: top.score } : null }];
    }),
  ) as DifficultyRecords;
  const resume = active && active.mode !== 'daily'
    ? { id: active.id, label: `${MODE_LABEL[active.mode]} ${DIFFICULTY[active.difficulty as Difficulty].label}` }
    : null;
  const top = stats?.byDifficulty.slice().sort((a, b) => b.games - a.games)[0];

  return (
    <main className="page home">
      <HomeInteractive resume={resume} records={records} surveysToday={summary.players}>
        <div className="home-cards">
          <section className="panel daily-card">
            <p className="eyebrow">Daily challenge · {date}</p>
            <h2>Everyone’s five maps</h2>
            <p className="muted">
              One attempt on today’s Normal maps. {summary.players ? `${fmtInt(summary.players)} finished so far.` : 'Nobody has finished yet.'} New maps in <ResetClock />.
            </p>
            {daily?.status === 'finished' && (
              <p className="big-num">{fmtInt(daily.total)} <small>{dailyBoard.me ? `#${dailyBoard.me.rank} today` : ''}</small></p>
            )}
            <div className="button-row">
              {daily?.status === 'finished' ? (
                <Link className="btn ghost" href="/daily">See today’s board</Link>
              ) : daily ? (
                <Link className="btn" href={`/game/${daily.id}`}>Continue today’s maps</Link>
              ) : (
                <StartGameButton mode="daily" label="Play the daily" />
              )}
            </div>
            {stats && stats.streak.current > 0 && (
              <p className="muted small">Streak: {stats.streak.current} {stats.streak.current === 1 ? 'day' : 'days'}</p>
            )}
          </section>
          <RaceQuick />
          <section className="panel">
            <div className="panel-head">
              <h2 className="section-title">Your record</h2>
              {viewer && <Link className="linkish" href="/stats">All stats</Link>}
            </div>
            {top ? (
              <div className="tiles">
                <div className="tile"><small>Average · {DIFFICULTY[top.difficulty].label}</small><b>{fmtInt(top.avg)}</b></div>
                <div className="tile">
                  <small>vs average player</small>
                  {top.othersAvg != null ? (
                    <b className={top.avg >= top.othersAvg ? 'up' : 'down'}>
                      <span aria-hidden="true">{top.avg >= top.othersAvg ? '▲' : '▼'}</span>{' '}
                      {top.avg >= top.othersAvg ? '+' : '−'}{fmtInt(Math.abs(top.avg - top.othersAvg))}
                    </b>
                  ) : <b>—</b>}
                </div>
                <div className="tile"><small>Games</small><b>{fmtInt(stats!.games)}</b></div>
              </div>
            ) : (
              <p className="muted">
                {viewer ? 'Finish a game to see your averages and how you compare.' : 'Pick a name when you start a game, and your averages and ranking appear here.'}
              </p>
            )}
          </section>
        </div>
        <BoardPreview daily={dailyBoard} allTime={allBoard} />
      </HomeInteractive>
    </main>
  );
}

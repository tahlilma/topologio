import Link from 'next/link';
import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { getLeaderboard, type Board } from '@/lib/server/leaderboard';
import { DIFFICULTIES, DIFFICULTY, isDifficulty } from '@/lib/game/difficulty';
import { fmtInt } from '@/lib/client/format';
import { BoardTable } from '@/components/BoardTable';

export const metadata: Metadata = { title: 'Leaderboard' };

const BOARDS: { id: Board; label: string }[] = [
  { id: 'daily', label: 'Today’s daily' },
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const board: Board = BOARDS.some((b) => b.id === q.board) ? (q.board as Board) : 'all';
  const difficulty = isDifficulty(q.d) ? q.d : 'normal';
  const viewer = await currentPlayer();
  const data = await getLeaderboard(board, difficulty, viewer, { limit: 100 });
  const href = (b: Board, d: string) => `/leaderboard?board=${b}${b === 'daily' ? '' : `&d=${d}`}`;
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Global leaderboard</p>
        <h1>{board === 'daily' ? 'Today’s daily challenge' : `${DIFFICULTY[difficulty].label} · ${board === 'week' ? 'last 7 days' : 'all time'}`}</h1>
        <p className="lede">
          {board === 'daily'
            ? 'Everyone plays the same five maps. Ties go to the faster survey.'
            : 'Each player’s best five-round game on this difficulty.'}{' '}
          {fmtInt(data.players)} {data.players === 1 ? 'player' : 'players'} ranked.
        </p>
      </header>
      <div className="filters">
        <div className="segmented" role="tablist" aria-label="Board">
          {BOARDS.map((b) => (
            <Link key={b.id} role="tab" aria-selected={b.id === board} className={b.id === board ? 'on' : ''} href={href(b.id, difficulty)}>
              {b.label}
            </Link>
          ))}
        </div>
        {board !== 'daily' && (
          <div className="segmented" role="tablist" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <Link key={d} role="tab" aria-selected={d === difficulty} className={d === difficulty ? 'on' : ''} href={href(board, d)}>
                {DIFFICULTY[d].label}
              </Link>
            ))}
          </div>
        )}
      </div>
      <section className="panel">
        <BoardTable board={data} showGames={board !== 'daily'} empty="Nobody has finished a game here yet. Be the first." />
      </section>
    </main>
  );
}

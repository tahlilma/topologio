import Link from 'next/link';
import type { Leaderboard } from '@/lib/server/leaderboard';
import { fmtInt } from '@/lib/client/format';

export function BoardTable({ board, empty, showGames = false }: { board: Leaderboard; empty: string; showGames?: boolean }) {
  if (!board.rows.length) return <p className="muted empty">{empty}</p>;
  const meInRows = board.rows.some((r) => r.isMe);
  return (
    <div className="table-wrap">
      <table className="data-table board">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col" className="left">Player</th>
            {showGames && <th scope="col">Games</th>}
            <th scope="col">{board.board === 'daily' ? 'Score' : 'Best'}</th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => (
            <tr key={`${r.rank}-${r.name}`} className={r.isMe ? 'me' : undefined}>
              <td className={r.rank <= 3 ? `medal m${r.rank}` : undefined}>{r.rank}</td>
              <td className="left name"><Link href={`/u/${encodeURIComponent(r.name)}`}>{r.name}</Link>{r.isMe && <span className="you">you</span>}</td>
              {showGames && <td>{fmtInt(r.games)}</td>}
              <td className="pts">{fmtInt(r.score)}</td>
            </tr>
          ))}
        </tbody>
        {board.me && !meInRows && (
          <tfoot>
            <tr className="me">
              <td>{board.me.rank}</td>
              <td className="left name">{board.me.name}<span className="you">you</span></td>
              {showGames && <td>{fmtInt(board.me.games)}</td>}
              <td className="pts">{fmtInt(board.me.score)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

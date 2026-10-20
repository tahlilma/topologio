import Link from 'next/link';
import type { GameView } from '@/lib/server/games';
import { DIFFICULTY } from '@/lib/game/difficulty';
import { MAX_GAME_SCORE } from '@/lib/game/constants';
import { HINTS, rankFor } from '@/lib/game/scoring';
import { fmtDist, fmtInt, MODE_LABEL } from '@/lib/client/format';
import { CopyField } from '@/components/CopyField';
import { StartGameButton } from '@/components/StartGameButton';
import { RoundReview } from './RoundReview';

interface Props {
  view: GameView;
  original: GameView | null;
  challengers: { id: string; name: string; total: number; status: string }[];
}

export function GameResults({ view, original, challengers }: Props) {
  const cfg = DIFFICULTY[view.difficulty];
  const done = view.status === 'finished';
  const reviewable = view.rounds
    .filter((r) => r.result)
    .map((r) => ({ n: r.n, seed: r.seed, name: r.name, result: r.result! }));
  const hidden = done && !reviewable.length;

  let verdict: string | null = null;
  if (original && done && original.status === 'finished') {
    const diff = view.total - original.total;
    verdict = diff > 0
      ? `${view.player.name} beat ${original.player.name} by ${fmtInt(diff)} points.`
      : diff < 0
        ? `${original.player.name} held on by ${fmtInt(-diff)} points.`
        : 'A dead heat.';
  }

  return (
    <main className="page results">
      <header className="results-head">
        <p className="eyebrow">
          {MODE_LABEL[view.mode]} · {cfg.label}{view.dailyDate ? ` · ${view.dailyDate}` : ''}
        </p>
        <h1>{view.isOwner ? (done ? 'Survey complete' : 'Survey in progress') : `${view.player.name}’s survey`}</h1>
        <div className="big-score">
          <b>{fmtInt(view.total)}</b>
          <span>/ {fmtInt(MAX_GAME_SCORE)}</span>
        </div>
        {done && <p className="rank">{rankFor(view.total, MAX_GAME_SCORE)}</p>}
        {!done && !view.isOwner && <p className="muted">This survey is still being played.</p>}
      </header>

      {verdict && <p className="verdict">{verdict}</p>}

      <section className="panel">
        <h2 className="section-title">Rounds</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col" className="left">Quadrangle</th>
                <th scope="col">Off by</th>
                <th scope="col">Facing</th>
                <th scope="col">Time</th>
                <th scope="col" className="left">Hints</th>
                <th scope="col">Points</th>
                {original && <th scope="col">{original.player.name}</th>}
              </tr>
            </thead>
            <tbody>
              {view.rounds.map((r, i) => {
                const res = r.result;
                const theirs = original?.rounds[i]?.score;
                return (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td className="left name">{r.name ?? (r.submitted ? 'Hidden' : '—')}</td>
                    <td>{res ? (res.guess ? fmtDist(res.dist ?? 0) : 'No guess') : '—'}</td>
                    <td>{res?.guess ? `${Math.round(res.angErr ?? 0)}°` : '—'}</td>
                    <td>{res ? `${Math.round(res.timeS)} s` : '—'}</td>
                    <td className="left">{res?.hints.length ? res.hints.map((h) => HINTS[h].label).join(', ') : res ? 'None' : '—'}</td>
                    <td className="pts">{r.score != null ? fmtInt(r.score) : '—'}</td>
                    {original && <td className="pts">{theirs != null ? fmtInt(theirs) : '—'}</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="left">Total</td>
                <td className="pts">{fmtInt(view.total)}</td>
                {original && <td className="pts">{fmtInt(original.total)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
        {hidden && (
          <p className="muted">Positions stay hidden until you play these maps yourself, so nobody can peek at the answers.</p>
        )}
      </section>

      {reviewable.length > 0 && <RoundReview rounds={reviewable} />}

      <div className="results-grid">
        {view.isOwner && done && (
          <section className="panel">
            <h2 className="section-title">Challenge a friend</h2>
            <p className="muted">Send this link. Your friend plays the same five maps and sees your score next to theirs.</p>
            <CopyField path={`/c/${view.id}`} label="Challenge link" />
            {challengers.length > 0 && (
              <ul className="challengers">
                {challengers.map((c) => (
                  <li key={c.id}>
                    <Link href={`/game/${c.id}`}>{c.name}</Link>
                    <span>{c.status === 'finished' ? fmtInt(c.total) : 'playing'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="panel">
          <h2 className="section-title">Keep surveying</h2>
          <div className="button-row">
            <StartGameButton mode="classic" difficulty={view.difficulty} label={`New ${cfg.label} game`} />
            <Link className="btn ghost" href="/leaderboard">Leaderboard</Link>
            <Link className="btn ghost" href="/stats">Your stats</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { challengeGameOf, getGameView } from '@/lib/server/games';
import { DIFFICULTY } from '@/lib/game/difficulty';
import { MAX_GAME_SCORE } from '@/lib/game/constants';
import { fmtInt } from '@/lib/client/format';
import { CopyField } from '@/components/CopyField';
import { StartGameButton } from '@/components/StartGameButton';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = await getGameView(id, null).catch(() => null);
  return { title: g ? `${g.player.name} challenges you` : 'Challenge' };
}

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await currentPlayer();
  const orig = await getGameView(id, viewer).catch(() => null);
  if (!orig || orig.status !== 'finished') {
    return (
      <main className="page narrow">
        <p className="eyebrow">Challenge</p>
        <h1>This challenge isn’t ready</h1>
        <p className="muted">The link may be wrong, or the game it points to has not been finished yet.</p>
        <Link className="btn" href="/">Play a game instead</Link>
      </main>
    );
  }
  const cfg = DIFFICULTY[orig.difficulty];
  const own = viewer?.id === orig.player.id;
  const mine = viewer && !own ? await challengeGameOf(viewer.id, orig.id) : null;
  return (
    <main className="page narrow challenge">
      <p className="eyebrow">Challenge · {cfg.label}</p>
      <h1>
        {orig.player.name} scored <span className="hl">{fmtInt(orig.total)}</span>
      </h1>
      <p className="lede">
        Same five maps, same {cfg.label} rules, out of {fmtInt(MAX_GAME_SCORE)}. Finish the survey and your scores go side by side.
      </p>
      <div className="challenge-score" aria-label="Their round scores">
        {orig.rounds.map((r) => (
          <span key={r.n}><small>R{r.n}</small><b>{r.score != null ? fmtInt(r.score) : '—'}</b></span>
        ))}
      </div>
      {own ? (
        <section className="panel">
          <h2 className="section-title">This is your game</h2>
          <p className="muted">Send this link to a friend to challenge them.</p>
          <CopyField path={`/c/${orig.id}`} label="Challenge link" />
          <Link className="linkish" href={`/game/${orig.id}`}>See your results</Link>
        </section>
      ) : mine ? (
        <div className="button-row">
          <Link className="btn" href={`/game/${mine.id}`}>{mine.status === 'finished' ? 'See the comparison' : 'Continue your attempt'}</Link>
        </div>
      ) : (
        <div className="button-row">
          <StartGameButton mode="challenge" challengeOf={orig.id} label="Accept the challenge" />
          <Link className="btn ghost" href="/">Not now</Link>
        </div>
      )}
    </main>
  );
}

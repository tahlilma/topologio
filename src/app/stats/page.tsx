import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { getPlayerStats } from '@/lib/server/stats';
import { StatsBody } from '@/components/stats/StatsBody';
import { AccountPanel } from '@/components/stats/AccountPanel';
import { SignInPrompt } from '@/components/SignInPrompt';
import { fmtInt } from '@/lib/client/format';

export const metadata: Metadata = { title: 'Your stats' };

export default async function StatsPage() {
  const me = await currentPlayer();
  if (!me) {
    return (
      <main className="page narrow">
        <p className="eyebrow">Stats</p>
        <h1>Your survey record</h1>
        <p className="lede">Pick a name to start collecting averages, accuracy and your ranking against other players.</p>
        <SignInPrompt />
      </main>
    );
  }
  const stats = await getPlayerStats({ id: me.id, name: me.name, createdAt: me.createdAt });
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Stats · since {new Date(me.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        <h1>{me.name}</h1>
        <p className="lede">{fmtInt(stats.games)} finished {stats.games === 1 ? 'game' : 'games'} · {fmtInt(stats.rounds)} rounds played</p>
      </header>
      <StatsBody stats={stats} own />
      <AccountPanel />
    </main>
  );
}

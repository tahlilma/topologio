import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { findPlayerByName, getPlayerStats } from '@/lib/server/stats';
import { StatsBody } from '@/components/stats/StatsBody';
import { fmtInt } from '@/lib/client/format';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function PlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const who = await findPlayerByName(decodeURIComponent(name));
  if (!who) notFound();
  const me = await currentPlayer();
  const stats = await getPlayerStats(who);
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Player · since {new Date(who.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
        <h1>{who.name}</h1>
        <p className="lede">{fmtInt(stats.games)} finished {stats.games === 1 ? 'game' : 'games'} · {fmtInt(stats.rounds)} rounds played</p>
      </header>
      <StatsBody stats={stats} own={me?.id === who.id} />
    </main>
  );
}

import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentPlayer } from '@/lib/server/auth';
import { challengersOf, getGameView } from '@/lib/server/games';
import { SoloGame } from '@/components/game/SoloGame';
import { GameResults } from '@/components/results/GameResults';

export const metadata: Metadata = { title: 'Survey' };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await currentPlayer();
  const view = await getGameView(id, viewer).catch(() => null);
  if (!view) notFound();
  if (view.status === 'active' && view.isOwner) {
    if (view.mode === 'room' && view.roomCode) redirect(`/race/${view.roomCode}`);
    return <SoloGame key={view.id} initial={view} />;
  }
  const original = view.challengeOf ? await getGameView(view.challengeOf, viewer).catch(() => null) : null;
  const challengers = view.isOwner ? await challengersOf(view.id) : [];
  return <GameResults view={view} original={original} challengers={challengers} />;
}

import type { Metadata } from 'next';
import { RaceEntry } from '@/components/race/RaceEntry';

export const metadata: Metadata = { title: 'Race' };

export default function RacePage() {
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Race rooms</p>
        <h1>Same maps, same clock</h1>
        <p className="lede">
          Up to twelve players read the same five maps at once. When everyone locks in, the true spot appears with every
          guess on the map, then the next round starts.
        </p>
      </header>
      <RaceEntry />
    </main>
  );
}

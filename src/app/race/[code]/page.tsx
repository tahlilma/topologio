import type { Metadata } from 'next';
import { RaceRoom } from '@/components/race/RaceRoom';
import { normalizeCode } from '@/lib/server/rooms';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return { title: `Race ${normalizeCode(code)}` };
}

export default async function RaceRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const c = normalizeCode(code);
  return <RaceRoom key={c} code={c} />;
}

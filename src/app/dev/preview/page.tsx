import { notFound } from 'next/navigation';
import { DevPreview } from '@/components/dev/DevPreview';

export const metadata = { title: 'Map preview' };

/** Development-only: render any seed's map and view. Returns 404 in production. */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const q = await searchParams;
  return <DevPreview seed={Number(q.seed) || 1} difficulty={q.d ?? 'normal'} />;
}

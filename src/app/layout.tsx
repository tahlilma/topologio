import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { currentPlayer } from '@/lib/server/auth';
import { PlayerProvider } from '@/components/PlayerProvider';
import { SiteHeader } from '@/components/SiteHeader';

const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});
const body = Barlow({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Topologio', template: '%s · Topologio' },
  description: 'Read a generated topographic map and find where a true-scale 3D view was taken. Daily challenges, races and global leaderboards.',
};

export const viewport: Viewport = {
  themeColor: '#121a17',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const p = await currentPlayer();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <PlayerProvider initial={p ? { id: p.id, name: p.name } : null}>
          <SiteHeader />
          {children}
        </PlayerProvider>
      </body>
    </html>
  );
}

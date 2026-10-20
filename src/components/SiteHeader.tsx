'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePlayer } from './PlayerProvider';

const NAV = [
  { href: '/', label: 'Play' },
  { href: '/daily', label: 'Daily' },
  { href: '/race', label: 'Race' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/stats', label: 'Stats' },
];

export function SiteHeader() {
  const path = usePathname();
  const { player, openDialog } = usePlayer();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="Topologio home">
          Topo<i>logio</i>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        {player ? (
          <Link href="/stats" className="player-chip" title="Your stats">
            <span className="dot" aria-hidden="true" />
            {player.name}
          </Link>
        ) : (
          <button className="player-chip ghost" type="button" onClick={() => openDialog('name')}>
            Choose a name
          </button>
        )}
      </div>
    </header>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Leaderboard } from '@/lib/server/leaderboard';
import { BoardTable } from '@/components/BoardTable';

/** Today's daily and the all-time Normal board, switchable in place. */
export function BoardPreview({ daily, allTime }: { daily: Leaderboard; allTime: Leaderboard }) {
  const [tab, setTab] = useState<'daily' | 'all'>(daily.rows.length || !allTime.rows.length ? 'daily' : 'all');
  const board = tab === 'daily' ? daily : allTime;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="section-title">Top surveyors</h2>
        <Link className="linkish" href={`/leaderboard?board=${tab === 'daily' ? 'daily' : 'all&d=normal'}`}>Full leaderboard</Link>
      </div>
      <div className="segmented small" role="tablist" aria-label="Leaderboard">
        <button type="button" role="tab" aria-selected={tab === 'daily'} className={tab === 'daily' ? 'on' : ''} onClick={() => setTab('daily')}>
          Today’s daily
        </button>
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All time · Normal
        </button>
      </div>
      <BoardTable
        board={board}
        empty={tab === 'daily' ? 'No one has finished today’s maps yet.' : 'No finished Normal games yet.'}
      />
    </section>
  );
}

'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { LaunchProvider } from './launch';
import { PlayLauncher, type DifficultyRecords } from './PlayLauncher';
import { ResetClock } from '@/components/ResetClock';
import { fmtInt } from '@/lib/client/format';

const PracticeRound = dynamic(() => import('./PracticeRound'), {
  ssr: false,
  loading: () => <PracticeSkeleton />,
});

function PracticeSkeleton() {
  return (
    <section className="practice" aria-busy="true">
      <div className="practice-head">
        <div>
          <p className="eyebrow">Practice map · nothing is saved</p>
          <h2>Warm up on a practice map</h2>
        </div>
      </div>
      <div className="stage">
        <section className="view-area"><div className="viewport skeleton" /></section>
        <section className="info-area"><p className="muted">Loading the practice map…</p></section>
        <section className="map-area"><div className="sheet"><div className="map-frame skeleton-paper" /></div></section>
      </div>
    </section>
  );
}

interface Props {
  resume: { id: string; label: string } | null;
  records: DifficultyRecords;
  surveysToday: number;
  children: ReactNode;
}

/** The interactive top of the home page: intro, Play launcher and practice round. */
export function HomeInteractive({ resume, records, surveysToday, children }: Props) {
  return (
    <LaunchProvider>
      <section className="home-top">
        <div className="home-intro">
          <p className="eyebrow">A map-reading game</p>
          <h1>Find where you stand from the shape of the land.</h1>
          <p className="lede">
            Each round drops you somewhere on a freshly generated quadrangle with one true-scale view. Mark your spot on the
            topo map, point your facing, and score on how close you land.
          </p>
          <p className="pulse-line">
            <span className="live-dot" aria-hidden="true" />
            {surveysToday
              ? `${fmtInt(surveysToday)} daily ${surveysToday === 1 ? 'survey' : 'surveys'} finished today`
              : 'Today’s daily maps are waiting'}
            <span className="sep" aria-hidden="true">·</span>
            new maps in <ResetClock />
          </p>
        </div>
        <PlayLauncher resume={resume} records={records} />
      </section>
      <PracticeRound />
      {children}
    </LaunchProvider>
  );
}

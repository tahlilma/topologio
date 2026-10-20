'use client';

import type { ReactNode } from 'react';
import type { RoundResult } from '@/lib/server/games';
import { HINTS } from '@/lib/game/scoring';
import { bearingText, fmtDist, fmtInt } from '@/lib/client/format';

interface Props {
  result: RoundResult;
  title?: string;
  children?: ReactNode;
}

export function ResultCard({ result, title, children }: Props) {
  const s = result.score;
  const hintNote = result.hints.length ? ` · hints: ${result.hints.map((h) => HINTS[h].label.toLowerCase()).join(', ')}` : '';
  return (
    <section className="result" aria-live="polite">
      <div className="result-head">
        <h2>
          {title && <small>{title}</small>}
          <span>{fmtInt(s.total)}</span> pts
        </h2>
        <div className="legend">
          <span><i className="g" />Your guess</span>
          <span><i className="a" />Actual spot</span>
        </div>
      </div>
      {result.guess ? (
        <dl className="breakdown">
          <dt>Position</dt><dd>{fmtDist(result.dist ?? 0)} off</dd><dd className="pts">{fmtInt(s.pos)}</dd>
          <dt>Facing</dt><dd>{Math.round(result.angErr ?? 0)}° off · true {bearingText(result.answer.bearing)}</dd><dd className="pts">{fmtInt(s.dir)}</dd>
          <dt>Time</dt><dd>{result.timeS.toFixed(1)} s{hintNote}</dd><dd className="pts">+{fmtInt(s.time)}</dd>
        </dl>
      ) : (
        <p className="muted">{result.timedOut ? 'Time ran out before a guess was locked in.' : 'No guess was made this round.'} The orange triangle shows where the view was taken.</p>
      )}
      {children}
    </section>
  );
}

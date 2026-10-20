'use client';

import { ROUNDS, MAX_ROUND_SCORE } from '@/lib/game/constants';
import { fmtInt } from '@/lib/client/format';

interface Props {
  title: string;
  subtitle: string;
  round: number;
  scores: (number | null)[];
  clock: string;
  clockLabel: string;
  clockLow?: boolean;
  total: number;
}

export function Hud({ title, subtitle, round, scores, clock, clockLabel, clockLow, total }: Props) {
  return (
    <div className="hud">
      <div className="hud-title">
        <span className="quad">{title}</span>
        <span className="muted small">{subtitle}</span>
      </div>
      <div className="meters">
        <div className="meter">
          <small>Round {Math.min(round, ROUNDS)} of {ROUNDS}</small>
          <div className="pips">
            {Array.from({ length: ROUNDS }, (_, i) => {
              const s = scores[i];
              return (
                <span
                  key={i}
                  className={`pip${s != null ? ' done' : i + 1 === round ? ' current' : ''}`}
                  style={s != null ? ({ '--fill': (s / MAX_ROUND_SCORE).toFixed(3) } as React.CSSProperties) : undefined}
                  title={s != null ? `Round ${i + 1}: ${fmtInt(s)}` : `Round ${i + 1}`}
                />
              );
            })}
          </div>
        </div>
        <div className="meter">
          <small>{clockLabel}</small>
          <b className={clockLow ? 'low' : undefined}>{clock}</b>
        </div>
        <div className="meter">
          <small>Score</small>
          <b>{fmtInt(total)}</b>
        </div>
      </div>
    </div>
  );
}

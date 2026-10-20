'use client';

import { HINTS, HINT_IDS, type HintId } from '@/lib/game/scoring';
import { DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';
import type { HintPayloads } from '@/lib/server/games';
import { fmtInt } from '@/lib/client/format';

interface Props {
  difficulty: Difficulty;
  hints: HintPayloads;
  busy: boolean;
  disabled: boolean;
  onUse(h: HintId): void;
}

/** Point-costing hints. The search area is free on Easy. */
export function HintBar({ difficulty, hints, busy, disabled, onUse }: Props) {
  const cfg = DIFFICULTY[difficulty];
  return (
    <div className="hints" role="group" aria-label="Hints">
      {HINT_IDS.map((id) => {
        const used = Boolean(hints[id]);
        const free = id === 'area' && cfg.freeSearchArea;
        let value: string | null = null;
        if (id === 'elevation' && hints.elevation) value = `You stand at ${fmtInt(hints.elevation.ft)} ft`;
        if (id === 'area' && hints.area) value = 'Circle shown on the map';
        if (id === 'compass' && hints.compass) value = 'Heading shown on the view';
        return (
          <button
            key={id}
            type="button"
            className={`hint${used ? ' used' : ''}`}
            disabled={used || busy || disabled}
            onClick={() => onUse(id)}
          >
            <b>{HINTS[id].label}</b>
            <small>{value ?? (free ? 'Free on Easy' : HINTS[id].cost)}</small>
          </button>
        );
      })}
    </div>
  );
}

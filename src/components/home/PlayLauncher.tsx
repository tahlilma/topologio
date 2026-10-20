'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { DIFFICULTIES, DIFFICULTY, type Difficulty, type DifficultyConfig } from '@/lib/game/difficulty';
import { fmtInt } from '@/lib/client/format';
import { useLaunch } from './launch';
import { PlayButton } from './PlayButton';
import { DifficultyIcon } from './DifficultyIcon';

export type DifficultyRecords = Record<Difficulty, { best: number | null; top: { name: string; score: number } | null }>;

/** Rule lines derived from the config, so the launcher can never disagree with the game. */
function rules(cfg: DifficultyConfig) {
  return [
    { k: 'View', v: cfg.lookAround ? 'Look around 360°' : cfg.hazeMul > 1.2 ? 'One still view, heavy haze' : 'One still view' },
    {
      k: 'Map',
      v: !cfg.woodland ? 'No woodland tint or contour labels' : cfg.elevationReadout ? 'Elevation readout under the cursor' : 'No elevation readout',
    },
    { k: 'Clock', v: cfg.timeLimit ? `${cfg.timeLimit} seconds per round` : cfg.timeWindow > 150 ? 'No limit, gentle time bonus' : 'No limit, time bonus for speed' },
    {
      k: 'Scoring',
      v: cfg.freeSearchArea ? `Free search circle; full points within ${cfg.pos.tol} m` : `Full points within ${cfg.pos.tol} m and ${cfg.dir.tol}°`,
    },
  ];
}

const clockTag = (cfg: DifficultyConfig) => (cfg.timeLimit ? `${cfg.timeLimit} s clock` : cfg.lookAround ? '360° view' : 'time bonus');

export function PlayLauncher({ resume, records }: { resume: { id: string; label: string } | null; records: DifficultyRecords }) {
  const { difficulty, setDifficulty, launch, launching, error } = useLaunch();
  const group = useRef<HTMLDivElement>(null);
  const cfg = DIFFICULTY[difficulty];

  const onArrow = (e: React.KeyboardEvent) => {
    const i = DIFFICULTIES.indexOf(difficulty);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % DIFFICULTIES.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + DIFFICULTIES.length - 1) % DIFFICULTIES.length;
    if (next < 0) return;
    e.preventDefault();
    setDifficulty(DIFFICULTIES[next]);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <section className="launcher" aria-labelledby="launch-title">
      <div className="launcher-head">
        <p className="eyebrow">Start a survey</p>
        <h2 id="launch-title">Five maps. Pick your rules.</h2>
      </div>
      <div className="diff-tiles" role="radiogroup" aria-label="Difficulty" ref={group} onKeyDown={onArrow}>
        {DIFFICULTIES.map((d, i) => {
          const c = DIFFICULTY[d];
          const on = d === difficulty;
          const rec = records[d];
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={`diff-tile ${d}${on ? ' on' : ''}`}
              onClick={() => setDifficulty(d)}
            >
              <span className="diff-key" aria-hidden="true">{i + 1}</span>
              <DifficultyIcon d={d} />
              <span className="diff-name">{c.label}</span>
              <span className="diff-tag">{clockTag(c)}</span>
              <span className="diff-rec">
                {rec.best != null ? `Your best ${fmtInt(rec.best)}` : rec.top ? `Top ${fmtInt(rec.top.score)}` : 'No scores yet'}
              </span>
            </button>
          );
        })}
      </div>
      <dl className="rules" key={difficulty}>
        {rules(cfg).map((r) => (
          <div key={r.k}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
      <PlayButton
        label={`Play ${cfg.label}`}
        sub="5 rounds · about 5 minutes · up to 25,000 points"
        busy={launching}
        onLaunch={(from) => void launch(from)}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="launcher-foot">
        {resume ? <Link className="linkish" href={`/game/${resume.id}`}>Resume your {resume.label} game</Link> : <span />}
        <span className="muted small">Keys 1–4 pick a difficulty</span>
      </div>
    </section>
  );
}

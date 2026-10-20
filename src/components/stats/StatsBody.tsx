'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PlayerStats } from '@/lib/server/stats';
import { DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';
import { fmtDist, fmtInt } from '@/lib/client/format';
import { ScoreHistoryChart } from './ScoreHistoryChart';
import { StartGameButton } from '@/components/StartGameButton';

export function StatsBody({ stats, own }: { stats: PlayerStats; own: boolean }) {
  const options = stats.byDifficulty;
  const [sel, setSel] = useState<Difficulty | null>(() => {
    if (!options.length) return null;
    return [...options].sort((a, b) => b.games - a.games)[0].difficulty;
  });
  const cur = options.find((o) => o.difficulty === sel) ?? null;
  const points = useMemo(() => stats.history.filter((h) => h.difficulty === sel), [stats.history, sel]);

  if (!options.length) {
    return (
      <section className="panel">
        <h2 className="section-title">No finished games yet</h2>
        <p className="muted">{own ? 'Finish a five-round survey and your averages, accuracy and ranking show up here.' : 'This player has not finished a game yet.'}</p>
        {own && <div className="button-row"><StartGameButton mode="classic" difficulty="normal" label="Play a Normal game" /></div>}
      </section>
    );
  }

  const delta = cur && cur.othersAvg != null ? cur.avg - cur.othersAvg : null;
  const pct = delta != null && cur!.othersAvg ? (delta / cur!.othersAvg) * 100 : null;
  const a = stats.accuracy;

  return (
    <>
      <div className="filters">
        <div className="segmented" role="tablist" aria-label="Difficulty">
          {options.map((o) => (
            <button key={o.difficulty} type="button" role="tab" aria-selected={o.difficulty === sel}
              className={o.difficulty === sel ? 'on' : ''} onClick={() => setSel(o.difficulty)}>
              {DIFFICULTY[o.difficulty].label} <span className="count">{o.games}</span>
            </button>
          ))}
        </div>
      </div>

      {cur && (
        <section className="panel">
          <div className="tiles four">
            <div className="tile">
              <small>Average game</small>
              <b>{fmtInt(cur.avg)}</b>
              <span className="muted">over {cur.games} {cur.games === 1 ? 'game' : 'games'}</span>
            </div>
            <div className="tile">
              <small>Best game</small>
              <b>{fmtInt(cur.best)}</b>
            </div>
            <div className="tile">
              <small>vs the average player</small>
              {delta != null ? (
                <>
                  <b className={delta >= 0 ? 'up' : 'down'}>
                    <span aria-hidden="true">{delta >= 0 ? '▲' : '▼'}</span> {delta >= 0 ? '+' : '−'}{fmtInt(Math.abs(delta))}
                  </b>
                  <span className="muted">{pct != null ? `${Math.abs(pct).toFixed(0)}% ${delta >= 0 ? 'above' : 'below'}` : ''} their {fmtInt(cur.othersAvg!)}</span>
                </>
              ) : (
                <><b>—</b><span className="muted">No other players yet</span></>
              )}
            </div>
            <div className="tile">
              <small>Ranking</small>
              {cur.percentile != null ? (
                <>
                  <b>Top {Math.max(1, Math.round((1 - cur.percentile) * 100))}%</b>
                  <span className="muted">better than {Math.round(cur.percentile * 100)}% of {fmtInt(cur.players - 1)} others</span>
                </>
              ) : (
                <><b>—</b><span className="muted">Only player so far</span></>
              )}
            </div>
          </div>
          <h2 className="section-title">Score over time · {DIFFICULTY[cur.difficulty].label}</h2>
          <ScoreHistoryChart points={points} othersAvg={cur.othersAvg} />
        </section>
      )}

      <div className="results-grid">
        <section className="panel">
          <h2 className="section-title">Accuracy <span className="muted small">all difficulties, last 600 rounds</span></h2>
          <div className="tiles">
            <div className="tile"><small>Typical miss</small><b>{a.medianDist != null ? fmtDist(a.medianDist) : '—'}</b><span className="muted">median distance</span></div>
            <div className="tile"><small>Typical facing error</small><b>{a.medianAngErr != null ? `${Math.round(a.medianAngErr)}°` : '—'}</b><span className="muted">median</span></div>
            <div className="tile"><small>Within 100 m</small><b>{a.within100 != null ? `${Math.round(a.within100 * 100)}%` : '—'}</b><span className="muted">of guesses</span></div>
            <div className="tile"><small>Facing within 10°</small><b>{a.sharpFacing != null ? `${Math.round(a.sharpFacing * 100)}%` : '—'}</b><span className="muted">of guesses</span></div>
            <div className="tile"><small>Typical time</small><b>{a.medianTime != null ? `${Math.round(a.medianTime)} s` : '—'}</b><span className="muted">per round</span></div>
            <div className="tile"><small>Hints</small><b>{a.hintsPerRound != null ? a.hintsPerRound.toFixed(2) : '—'}</b><span className="muted">per round</span></div>
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">Daily streak</h2>
          <div className="tiles">
            <div className="tile"><small>Current</small><b>{stats.streak.current} {stats.streak.current === 1 ? 'day' : 'days'}</b><span className="muted">{stats.streak.playedToday ? 'Played today' : 'Not played today'}</span></div>
            <div className="tile"><small>Best</small><b>{stats.streak.best} {stats.streak.best === 1 ? 'day' : 'days'}</b></div>
          </div>
          {own && !stats.streak.playedToday && <Link className="btn" href="/daily">Play today’s daily</Link>}
        </section>
      </div>
    </>
  );
}

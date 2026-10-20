'use client';

import { useEffect, useRef, useState } from 'react';
import { MapView, buildMapLayers } from '@/lib/game/topomap';
import { generateTerrain } from '@/lib/game/terrain';
import type { RoundResult } from '@/lib/server/games';
import { fmtDist, fmtInt } from '@/lib/client/format';
import { mapFont, nextFrame } from '@/lib/client/dom';

interface ReviewRound { n: number; seed: number; name: string | null; result: RoundResult }

/** Re-draws any finished round's map with the guess and the true spot. */
export function RoundReview({ rounds }: { rounds: ReviewRound[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<MapView | null>(null);
  const [sel, setSel] = useState(rounds[0]?.n ?? 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canvas.current) return;
    const mv = new MapView(canvas.current, {});
    mv.setMode('view');
    view.current = mv;
    const ro = new ResizeObserver(() => mv.resize());
    ro.observe(canvas.current);
    return () => { ro.disconnect(); mv.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const r = rounds.find((x) => x.n === sel);
    if (!r) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      await nextFrame();
      if (cancelled) return;
      const t = generateTerrain(r.seed);
      const layers = buildMapLayers(t, { woodland: true, contourLabels: true, font: mapFont() });
      if (cancelled || !view.current) return;
      const mv = view.current;
      mv.setLayers(layers);
      mv.setMode('view');
      mv.setAnswer(r.result.answer);
      mv.setGuess(r.result.guess ? { ...r.result.guess } : null);
      mv.fit([r.result.answer, ...(r.result.guess ? [r.result.guess] : [])]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sel, rounds]);

  const cur = rounds.find((x) => x.n === sel);
  return (
    <section className="review">
      <div className="review-head">
        <h2>Review a round</h2>
        <div className="segmented" role="tablist" aria-label="Round">
          {rounds.map((r) => (
            <button key={r.n} type="button" role="tab" aria-selected={r.n === sel} className={r.n === sel ? 'on' : ''} onClick={() => setSel(r.n)}>
              {r.n}
            </button>
          ))}
        </div>
      </div>
      <div className="review-body">
        <div className="sheet">
          <div className="map-frame">
            <canvas ref={canvas} aria-label="Map of the selected round with your guess and the true spot" />
            {loading && <div className="map-loading">Drawing map…</div>}
          </div>
        </div>
        {cur && (
          <dl className="review-facts">
            <dt>Quadrangle</dt><dd>{cur.name ?? '—'}</dd>
            <dt>Off by</dt><dd>{cur.result.guess ? fmtDist(cur.result.dist ?? 0) : 'No guess'}</dd>
            <dt>Facing error</dt><dd>{cur.result.guess ? `${Math.round(cur.result.angErr ?? 0)}°` : '—'}</dd>
            <dt>Points</dt><dd>{fmtInt(cur.result.score.total)}</dd>
          </dl>
        )}
      </div>
    </section>
  );
}

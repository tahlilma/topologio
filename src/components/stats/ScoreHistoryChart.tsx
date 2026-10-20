'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HistoryPoint } from '@/lib/server/stats';
import { fmtDate, fmtInt, MODE_LABEL } from '@/lib/client/format';

const H = 240;
const M = { l: 56, r: 16, t: 16, b: 30 };
const WINDOW = 5;

function niceMax(v: number) {
  const step = v > 15000 ? 5000 : v > 6000 ? 2000 : 1000;
  return Math.max(step, Math.ceil(v / step) * step);
}

/**
 * One dot per finished game, a 5-game rolling average in the accent, and the
 * average of every other player as a reference line.
 */
export function ScoreHistoryChart({ points, othersAvg }: { points: HistoryPoint[]; othersAvg: number | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hi, setHi] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const n = points.length;
    const rolling = points.map((_, i) => {
      const from = Math.max(0, i - WINDOW + 1);
      const slice = points.slice(from, i + 1);
      return slice.reduce((s, p) => s + p.total, 0) / slice.length;
    });
    const top = niceMax(Math.max(...points.map((p) => p.total), othersAvg ?? 0, 1000) * 1.08);
    const pw = w - M.l - M.r, ph = H - M.t - M.b;
    const X = (i: number) => (n <= 1 ? M.l + pw / 2 : M.l + (i / (n - 1)) * pw);
    const Y = (v: number) => M.t + (1 - v / top) * ph;
    const line = rolling.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const ticks: number[] = [];
    const step = top / 4;
    for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
    return { n, rolling, X, Y, line, ticks };
  }, [points, othersAvg, w]);

  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el || !g.n) return;
    const x = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < g.n; i++) if (Math.abs(g.X(i) - x) < Math.abs(g.X(best) - x)) best = i;
    setHi(best);
  };
  const p = hi != null ? points[hi] : null;
  const lastI = g.n - 1;
  const xLabelEvery = Math.max(1, Math.ceil(g.n / 6));

  return (
    <figure className="chart">
      <div className="chart-legend">
        <span><i className="key-dot game" />Each game</span>
        <span><i className="key-line you" />{WINDOW}-game average</span>
        {othersAvg != null && <span><i className="key-line others" />Average player</span>}
      </div>
      <div
        ref={wrap}
        className="chart-plot"
        tabIndex={0}
        aria-label="Score history. Use left and right arrow keys to read each game."
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHi(null)}
        onBlur={() => setHi(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHi((v) => Math.min(lastI, (v ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHi((v) => Math.max(0, (v ?? g.n) - 1));
        }}
      >
        <svg width={w} height={H} role="presentation">
          {g.ticks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={w - M.r} y1={g.Y(v)} y2={g.Y(v)} className={v === 0 ? 'baseline' : 'grid'} />
              <text x={M.l - 8} y={g.Y(v) + 4} textAnchor="end" className="axis">{fmtInt(v)}</text>
            </g>
          ))}
          {points.map((pt, i) => (i % xLabelEvery === 0 || i === lastI) && (
            <text key={pt.id} x={g.X(i)} y={H - 10} textAnchor="middle" className="axis">{i + 1}</text>
          ))}
          <text x={w - M.r} y={H - 10} textAnchor="end" className="axis faint">game</text>
          {othersAvg != null && (
            <g>
              <line x1={M.l} x2={w - M.r} y1={g.Y(othersAvg)} y2={g.Y(othersAvg)} className="ref-line" />
              <text x={M.l + 6} y={g.Y(othersAvg) - 6} className="ref-label">Average player {fmtInt(othersAvg)}</text>
            </g>
          )}
          {hi != null && <line x1={g.X(hi)} x2={g.X(hi)} y1={M.t} y2={H - M.b} className="crosshair" />}
          {points.map((pt, i) => (
            <circle key={pt.id} cx={g.X(i)} cy={g.Y(pt.total)} r={i === hi ? 5.5 : 4} className="game-dot" />
          ))}
          {g.n > 1 && <path d={g.line} className="avg-line" />}
          {g.n > 0 && (
            <g>
              <circle cx={g.X(lastI)} cy={g.Y(g.rolling[lastI])} r={4.5} className="avg-end" />
              {g.n > 1 && (
                <text x={g.X(lastI) - 8} y={g.Y(g.rolling[lastI]) - 10} textAnchor="end" className="end-label">
                  {fmtInt(g.rolling[lastI])}
                </text>
              )}
            </g>
          )}
        </svg>
        {p && hi != null && (
          <div className="chart-tip dark" style={{ left: Math.min(w - 190, Math.max(0, g.X(hi) + 12)), top: 8 }}>
            <b>{fmtInt(p.total)}</b>
            <span>Game {hi + 1} · {fmtDate(p.finishedAt)} · {MODE_LABEL[p.mode] ?? p.mode}</span>
            <span className="tip-row"><i className="key-line you" />{WINDOW}-game average {fmtInt(g.rolling[hi])}</span>
            {othersAvg != null && <span className="tip-row"><i className="key-line others" />Average player {fmtInt(othersAvg)}</span>}
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Game</th><th scope="col" className="left">Date</th><th scope="col" className="left">Mode</th><th scope="col">Score</th><th scope="col">{WINDOW}-game avg</th></tr></thead>
            <tbody>
              {points.map((pt, i) => (
                <tr key={pt.id}>
                  <td>{i + 1}</td>
                  <td className="left">{fmtDate(pt.finishedAt)}</td>
                  <td className="left">{MODE_LABEL[pt.mode] ?? pt.mode}</td>
                  <td className="pts">{fmtInt(pt.total)}</td>
                  <td className="pts">{fmtInt(g.rolling[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

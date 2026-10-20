'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { M_TO_FT } from '@/lib/game/constants';
import { fmtDist, fmtInt } from '@/lib/client/format';
import type { Profile } from './usePlayfield';

const H = 170;
const M = { l: 52, r: 12, t: 12, b: 26 };

function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/** Elevation along the line A→B: ground as a line with a light wash, water as a blue band. */
export function ProfileChart({ profile, onClose }: { profile: Profile; onClose(): void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  const [hi, setHi] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const s = profile.samples;
  const geo = useMemo(() => {
    const ft = s.map((p) => ({ d: p.d, g: p.ground * M_TO_FT, w: p.surface * M_TO_FT, water: p.water }));
    let lo = Math.min(...ft.map((p) => p.g)), hiV = Math.max(...ft.map((p) => Math.max(p.g, p.w)));
    const pad = Math.max(40, (hiV - lo) * 0.12);
    lo -= pad;
    hiV += pad;
    const step = niceStep(hiV - lo, 3);
    lo = Math.floor(lo / step) * step;
    hiV = Math.ceil(hiV / step) * step;
    const len = s[s.length - 1].d;
    const pw = w - M.l - M.r, ph = H - M.t - M.b;
    const X = (d: number) => M.l + (d / len) * pw;
    const Y = (v: number) => M.t + (1 - (v - lo) / (hiV - lo)) * ph;
    const line = ft.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.g).toFixed(1)}`).join('');
    const area = `${line}L${X(len).toFixed(1)},${Y(lo)}L${X(0)},${Y(lo)}Z`;
    const water: string[] = [];
    let i = 0;
    while (i < ft.length) {
      if (!ft[i].water) { i++; continue; }
      let j = i;
      while (j + 1 < ft.length && ft[j + 1].water) j++;
      const a = Math.max(0, i - 1), b = Math.min(ft.length - 1, j + 1);
      const top = ft.slice(a, b + 1).map((p, k) => `${k ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(Math.max(p.w, p.g)).toFixed(1)}`).join('');
      const bottom = ft.slice(a, b + 1).reverse().map((p) => `L${X(p.d).toFixed(1)},${Y(p.g).toFixed(1)}`).join('');
      water.push(`${top}${bottom}Z`);
      i = j + 1;
    }
    const yTicks: number[] = [];
    for (let v = lo; v <= hiV + 1e-6; v += step) yTicks.push(v);
    const xStep = niceStep(len, 4);
    const xTicks: number[] = [];
    for (let d = 0; d <= len + 1e-6; d += xStep) xTicks.push(d);
    return { ft, X, Y, line, area, water, yTicks, xTicks, len, lo };
  }, [s, w]);

  const { ft, X, Y } = geo;
  const highest = ft.reduce((a, p) => (p.g > a.g ? p : a), ft[0]);
  const lowest = ft.reduce((a, p) => (p.g < a.g ? p : a), ft[0]);
  const hasWater = ft.some((p) => p.water);
  const pick = (clientX: number) => {
    const el = wrap.current;
    if (!el) return;
    const x = clientX - el.getBoundingClientRect().left;
    const d = ((x - M.l) / (w - M.l - M.r)) * geo.len;
    let best = 0;
    for (let k = 1; k < ft.length; k++) if (Math.abs(ft[k].d - d) < Math.abs(ft[best].d - d)) best = k;
    setHi(best);
  };
  const p = hi != null ? ft[hi] : null;

  return (
    <figure className="profile">
      <figcaption>
        <div>
          <b>Elevation profile A → B</b>
          <span className="muted">
            {fmtDist(geo.len)} · A {fmtInt(ft[0].g)} ft · B {fmtInt(ft[ft.length - 1].g)} ft · high {fmtInt(highest.g)} ft · low {fmtInt(lowest.g)} ft
          </span>
        </div>
        <div className="profile-legend">
          <span><i className="key-line ground" />Ground</span>
          {hasWater && <span><i className="key-rect water" />Water</span>}
          <button type="button" className="linkish" onClick={onClose}>Close</button>
        </div>
      </figcaption>
      <div
        ref={wrap}
        className="profile-plot"
        tabIndex={0}
        aria-label="Elevation profile chart. Use left and right arrow keys to read values."
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHi(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHi((v) => Math.min(ft.length - 1, (v ?? -1) + 3));
          if (e.key === 'ArrowLeft') setHi((v) => Math.max(0, (v ?? ft.length) - 3));
        }}
        onBlur={() => setHi(null)}
      >
        <svg width={w} height={H} role="presentation">
          {geo.yTicks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={w - M.r} y1={Y(v)} y2={Y(v)} className="grid" />
              <text x={M.l - 6} y={Y(v) + 4} textAnchor="end" className="axis">{fmtInt(v)}</text>
            </g>
          ))}
          {geo.xTicks.map((d) => (
            <text key={d} x={X(d)} y={H - 8} textAnchor={d === 0 ? 'start' : 'middle'} className="axis">
              {d === 0 ? 'A' : fmtDist(d)}
            </text>
          ))}
          <text x={w - M.r} y={H - 8} textAnchor="end" className="axis strong">B</text>
          <path d={geo.area} className="ground-wash" />
          {geo.water.map((d, i) => <path key={i} d={d} className="water-band" />)}
          <path d={geo.line} className="ground-line" />
          {p && (
            <g>
              <line x1={X(p.d)} x2={X(p.d)} y1={M.t} y2={H - M.b} className="crosshair" />
              <circle cx={X(p.d)} cy={Y(Math.max(p.g, p.water ? p.w : p.g))} r={4.5} className="hover-dot" />
            </g>
          )}
        </svg>
        {p && (
          <div className="chart-tip" style={{ left: Math.min(w - 150, Math.max(0, X(p.d) + 10)), top: 8 }}>
            <b>{fmtInt(p.water ? p.w : p.g)} ft</b>
            <span>{p.water ? 'Water surface' : 'Ground'} · {fmtDist(p.d)} from A</span>
          </div>
        )}
      </div>
    </figure>
  );
}

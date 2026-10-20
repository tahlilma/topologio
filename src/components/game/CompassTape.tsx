'use client';

import { useLayoutEffect, useRef, useState } from 'react';

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SPAN = 120;

/**
 * Heading strip across the top of the view. With the compass hint it shows true
 * headings; in look-around mode without it, only where the scored start view lies.
 */
export function CompassTape({ yaw, absolute, start }: { yaw: number; absolute: boolean; start: number | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const yawDeg = (((yaw * 180) / Math.PI) % 360 + 360) % 360;
  const x = (deg: number) => {
    let d = deg - yawDeg;
    d = ((d + 540) % 360) - 180;
    return w / 2 + (d / SPAN) * w;
  };
  const ticks: { x: number; major: boolean; label: string | null }[] = [];
  if (absolute) {
    for (let deg = 0; deg < 360; deg += 15) {
      const px = x(deg);
      if (px < 0 || px > w) continue;
      ticks.push({ x: px, major: deg % 45 === 0, label: deg % 45 === 0 ? CARD[deg / 45] : null });
    }
  }
  let startX: number | null = null;
  if (start != null) {
    const sx = x((((start * 180) / Math.PI) % 360 + 360) % 360);
    startX = Math.min(w - 8, Math.max(8, sx));
  }
  return (
    <svg ref={ref} className="compass-tape" height={34} role="img"
      aria-label={absolute ? `Heading ${Math.round(yawDeg)} degrees` : 'Direction of the starting view'}>
      <rect x={0} y={0} width={w} height={34} rx={4} className="tape-bg" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.x} x2={t.x} y1={t.major ? 4 : 8} y2={t.major ? 14 : 12} className="tape-tick" />
          {t.label && <text x={t.x} y={27} textAnchor="middle" className="tape-label">{t.label}</text>}
        </g>
      ))}
      {absolute && (
        <text x={w / 2} y={27} textAnchor="middle" className="tape-readout">
          {String(Math.round(yawDeg) % 360).padStart(3, '0')}°
        </text>
      )}
      <line x1={w / 2} x2={w / 2} y1={0} y2={absolute ? 16 : 34} className="tape-center" />
      {startX != null && (
        <g transform={`translate(${startX} 0)`}>
          <path d="M -6 2 L 6 2 L 0 10 Z" className="tape-start" />
          {!absolute && <text x={0} y={27} textAnchor="middle" className="tape-label">start view</text>}
        </g>
      )}
    </svg>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** Irregular closed contour around (cx, cy). */
function ring(cx: number, cy: number, r: number, seed: number) {
  const pts: string[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.08 * Math.sin(3 * a + seed) + 0.05 * Math.sin(5 * a + seed * 1.7) + 0.03 * Math.sin(9 * a - seed);
    pts.push(`${(cx + Math.cos(a) * r * k).toFixed(1)},${(cy + Math.sin(a) * r * k).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

/**
 * Full-screen hand-off between pressing Play and the game page: contour lines
 * ripple out from where the button was pressed. It stays until the route changes.
 */
export function LaunchOverlay({ x, y, label }: { x: number; y: number; label: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rings = useMemo(() => {
    const out: { d: string; i: number }[] = [];
    for (let i = 0; i < 14; i++) out.push({ d: ring(x, y, 40 + i * 70, i * 1.3 + 0.4), i });
    return out;
  }, [x, y]);
  if (!mounted) return null;
  return createPortal(
    <div className="launch-overlay" role="status" aria-live="assertive">
      <svg className="launch-rings" width="100%" height="100%" aria-hidden="true">
        {rings.map((r) => (
          <path key={r.i} d={r.d} pathLength={1} style={{ animationDelay: `${r.i * 45}ms` }} className={r.i % 5 === 4 ? 'index' : undefined} />
        ))}
      </svg>
      <div className="launch-copy">
        <small>Starting a {label} survey</small>
        <b>Surveying terrain</b>
        <span className="launch-bar" aria-hidden="true" />
      </div>
    </div>,
    document.body,
  );
}

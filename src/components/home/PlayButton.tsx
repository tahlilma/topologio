'use client';

import { useRef, useState } from 'react';

interface Props {
  label: string;
  sub: string;
  busy: boolean;
  onLaunch(from: { x: number; y: number }): void;
}

/**
 * The big Play control. Its compass needle swings toward the pointer, contour rings
 * ripple out from under it, and a press bursts from the exact spot that was clicked.
 */
export function PlayButton({ label, sub, busy, onLaunch }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [burst, setBurst] = useState<{ x: number; y: number; id: number } | null>(null);

  const track = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    const dx = (x - r.width / 2) / (r.width / 2), dy = (y - r.height / 2) / (r.height / 2);
    el.style.setProperty('--tx', `${(dx * 4).toFixed(2)}px`);
    el.style.setProperty('--ty', `${(dy * 3).toFixed(2)}px`);
    // Needle pivot sits in the compass at the right end of the button.
    const nx = r.width - 44, ny = r.height / 2;
    const deg = (Math.atan2(x - nx, -(y - ny)) * 180) / Math.PI;
    el.style.setProperty('--needle', `${deg.toFixed(1)}deg`);
  };

  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--tx', '0px');
    el.style.setProperty('--ty', '0px');
    el.style.setProperty('--needle', '0deg');
  };

  const press = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    // Keyboard activation reports 0,0; burst from the centre instead.
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const cx = keyboard ? r.left + r.width / 2 : e.clientX;
    const cy = keyboard ? r.top + r.height / 2 : e.clientY;
    setBurst({ x: cx - r.left, y: cy - r.top, id: Date.now() });
    onLaunch({ x: cx, y: cy });
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`play-btn${busy ? ' busy' : ''}`}
      onPointerMove={(e) => track(e.clientX, e.clientY)}
      onPointerLeave={reset}
      onClick={press}
      disabled={busy}
      aria-describedby="play-sub"
    >
      <span className="play-btn-glow" aria-hidden="true" />
      <span className="play-btn-rings" aria-hidden="true"><i /><i /><i /></span>
      {burst && <span key={burst.id} className="play-btn-burst" style={{ left: burst.x, top: burst.y }} aria-hidden="true" />}
      <span className="play-btn-text">
        <b>{busy ? 'Surveying…' : label}</b>
        <small id="play-sub">{sub}</small>
      </span>
      <span className="play-btn-compass" aria-hidden="true">
        <svg viewBox="0 0 56 56" className="dial">
          <circle cx="28" cy="28" r="25" />
          <path d="M28 5v5M28 46v5M5 28h5M46 28h5" />
        </svg>
        <svg viewBox="0 0 56 56" className="needle">
          <path d="M28 9l5.5 19h-11z" className="north" />
          <path d="M28 47l-5.5-19h11z" className="south" />
          <circle cx="28" cy="28" r="2.6" />
        </svg>
      </span>
      {busy && <span className="play-btn-progress" aria-hidden="true" />}
    </button>
  );
}

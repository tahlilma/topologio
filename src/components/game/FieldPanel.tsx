'use client';

import { useEffect, useState, type RefObject } from 'react';
import { CompassTape } from './CompassTape';

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Loading caption, or null when the view is ready. */
  loading: string | null;
  /** Big centred number before a race round starts. */
  countdown: number | null;
  lookAround: boolean;
  /** True bearing when the compass hint is in use. */
  compass: number | null;
  /** Bearing of the scored (starting) view. */
  start: number | null;
  yaw: number | null;
  onResetView?(): void;
  webglError: boolean;
}

export function FieldPanel({ canvasRef, loading, countdown, lookAround, compass, start, yaw, onResetView, webglError }: Props) {
  const [big, setBig] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') setBig(false);
      if (e.key === 'f' || e.key === 'F') setBig((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const turned = lookAround && yaw != null && start != null && Math.abs(Math.atan2(Math.sin(yaw - start), Math.cos(yaw - start))) > 0.02;

  return (
    <div className={`viewport${big ? ' expanded' : ''}`}>
      <canvas ref={canvasRef} aria-label="3D view from the spot you must find" />
      {!loading && yaw != null && (compass != null || lookAround) && (
        <CompassTape yaw={yaw} absolute={compass != null} start={start} />
      )}
      <span className="vp-tag">
        {lookAround ? 'Drag to look around · scored facing is the start view' : 'Field view · eye 1.8 m · 73° lens'}
      </span>
      <div className="vp-actions">
        {turned && onResetView && (
          <button className="vp-btn" type="button" onClick={onResetView}>Start view</button>
        )}
        <button className="vp-btn" type="button" aria-pressed={big} onClick={() => setBig((v) => !v)}>
          {big ? 'Close' : 'Enlarge'}
        </button>
      </div>
      {webglError && (
        <div className="loading">
          <div>
            <span>3D view unavailable</span>
            <p className="muted small">Your browser could not start WebGL. Try another browser or enable hardware acceleration.</p>
          </div>
        </div>
      )}
      {loading && !webglError && (
        <div className="loading">
          <div>
            <svg viewBox="0 0 68 68" aria-hidden="true">
              <circle cx="34" cy="34" r="30" /><circle cx="34" cy="36" r="20" /><circle cx="35" cy="38" r="10" />
            </svg>
            <span>{loading}</span>
          </div>
        </div>
      )}
      {countdown != null && countdown > 0 && (
        <div className="countdown" aria-live="assertive">
          <small>Round starts in</small>
          <b>{Math.ceil(countdown / 1000)}</b>
        </div>
      )}
    </div>
  );
}

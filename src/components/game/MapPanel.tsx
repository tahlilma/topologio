'use client';

import type { RefObject } from 'react';
import type { MapView } from '@/lib/game/topomap';
import { ProfileChart } from './ProfileChart';
import type { Profile } from './usePlayfield';

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  map: RefObject<MapView | null>;
  tool: 'guess' | 'profile';
  onTool(t: 'guess' | 'profile'): void;
  interval: number | null;
  /** Elevation under the cursor, when the difficulty allows it. */
  readout: string | null;
  profile: Profile | null;
  onCloseProfile(): void;
  hint: string;
}

export function MapPanel({ canvasRef, map, tool, onTool, interval, readout, profile, onCloseProfile, hint }: Props) {
  return (
    <div className="sheet">
      <div className="map-frame">
        <canvas ref={canvasRef} id="map" aria-label="Topographic map. Click to place your position, drag to set your facing." />
        <div className="map-tools">
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => map.current?.zoomBy(1.5)}>+</button>
          <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => map.current?.zoomBy(1 / 1.5)}>−</button>
          <button type="button" aria-label="Show whole map" title="Whole map" onClick={() => map.current?.resetView()}>⤢</button>
          <button
            type="button"
            className={tool === 'profile' ? 'on' : ''}
            aria-pressed={tool === 'profile'}
            aria-label="Elevation profile tool"
            title="Elevation profile (P): drag a line across the map"
            onClick={() => onTool(tool === 'profile' ? 'guess' : 'profile')}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 15 L6 9 L9 12 L13 5 L18 13" /></svg>
          </button>
        </div>
        {tool === 'profile' && (
          <div className="tool-note" role="status">Drag a line on the map to see its elevation profile. Press the tool again to go back to guessing.</div>
        )}
      </div>
      <div className="collar">
        <span>{interval ? `Contour interval ${interval} feet` : 'Contour interval —'}</span>
        <span className="readout" aria-live="off">{readout ?? '1 km grid · 6.4 km square'}</span>
        <span className="hint-mouse">{hint}</span>
      </div>
      {profile && <ProfileChart profile={profile} onClose={onCloseProfile} />}
    </div>
  );
}

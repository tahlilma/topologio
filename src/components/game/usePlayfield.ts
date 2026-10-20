'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FieldView } from '@/lib/game/scene3d';
import { MapView, buildMapLayers, type Guess, type MapMode, type Pt } from '@/lib/game/topomap';
import { generateTerrain, type Terrain } from '@/lib/game/terrain';
import { viewpointFromToken, type Viewpoint } from '@/lib/game/viewpoint';
import { sampleProfile, type ProfileSample } from '@/lib/game/profile';
import { DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';
import { M_TO_FT } from '@/lib/game/constants';
import { fmtInt } from '@/lib/client/format';

import { mapFont, nextFrame } from '@/lib/client/dom';

export { mapFont, nextFrame };

export interface Profile { a: Pt; b: Pt; samples: ProfileSample[] }

export function describePoint(t: Terrain, p: Pt) {
  if (t.isSeaAt(p.x, p.z)) return 'Sea';
  const g = t.groundAt(p.x, p.z), s = t.surfaceAt(p.x, p.z);
  if (s > g + 0.3) return `Water surface ${fmtInt(s * M_TO_FT)} ft`;
  return `${fmtInt(g * M_TO_FT)} ft`;
}

export interface PlayfieldOptions {
  /** 'modifier' keeps page scrolling over the map; Ctrl/⌘ + wheel zooms. */
  wheel?: 'always' | 'modifier';
}

/** Owns the 3D view and the map sheet for one play screen. */
export function usePlayfield(difficulty: Difficulty, opts: PlayfieldOptions = {}) {
  const fieldCanvas = useRef<HTMLCanvasElement | null>(null);
  const mapCanvas = useRef<HTMLCanvasElement | null>(null);
  const field = useRef<FieldView | null>(null);
  const map = useRef<MapView | null>(null);
  const terrain = useRef<Terrain | null>(null);
  const vp = useRef<Viewpoint | null>(null);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [yaw, setYaw] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tool, setTool] = useState<'guess' | 'profile'>('guess');
  const [baseMode, setBaseMode] = useState<MapMode>('view');
  const [ready, setReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [contourInterval, setContourInterval] = useState<number | null>(null);
  const [wheelHint, setWheelHint] = useState(false);
  const wheelMode = opts.wheel ?? 'always';

  useEffect(() => {
    const fc = fieldCanvas.current, mc = mapCanvas.current;
    if (!fc || !mc) return;
    let fv: FieldView | null = null;
    try {
      fv = new FieldView(fc);
      fv.onView = (y) => setYaw(y);
    } catch {
      setWebglError(true);
    }
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const mv = new MapView(mc, {
      onGuess: (g) => setGuess(g),
      onHover: (p) => setHover(p),
      onProfile: (a, b) => {
        const t = terrain.current;
        if (t) setProfile({ a, b, samples: sampleProfile(t, a.x, a.z, b.x, b.z) });
      },
      onWheelPassed: () => {
        setWheelHint(true);
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => setWheelHint(false), 1400);
      },
    }, { wheel: wheelMode });
    field.current = fv;
    map.current = mv;
    setReady(true);
    const ro = new ResizeObserver(() => {
      mv.resize();
      fv?.resize();
    });
    ro.observe(mc);
    ro.observe(fc);
    return () => {
      clearTimeout(hintTimer);
      ro.disconnect();
      mv.destroy();
      fv?.destroy();
      field.current = null;
      map.current = null;
      setReady(false);
    };
  }, [wheelMode]);

  useEffect(() => {
    map.current?.setMode(tool === 'profile' ? 'profile' : baseMode);
  }, [tool, baseMode, ready]);

  /** Generates a round's terrain and lays its map on the sheet. The 3D view stays blank. */
  const loadMap = useCallback(async (seed: number) => {
    await nextFrame();
    const t = generateTerrain(seed);
    const cfg = DIFFICULTY[difficulty];
    const layers = buildMapLayers(t, { woodland: cfg.woodland, contourLabels: cfg.contourLabels, font: mapFont() });
    terrain.current = t;
    vp.current = null;
    setContourInterval(layers.interval);
    map.current?.setLayers(layers);
    field.current?.clear();
    setGuess(null);
    setProfile(null);
    setTool('guess');
    setYaw(null);
    return t;
  }, [difficulty]);

  /** Places the camera from a server viewpoint token and renders the view. */
  const showView = useCallback((token: number) => {
    const t = terrain.current;
    if (!t) return null;
    const v = viewpointFromToken(t, token);
    vp.current = v;
    const cfg = DIFFICULTY[difficulty];
    field.current?.build(t, v, { lookAround: cfg.lookAround, hazeMul: cfg.hazeMul });
    return v;
  }, [difficulty]);

  /**
   * Re-draws the current map and view under the current difficulty's rules
   * (map lettering, woodland tint, haze, look-around) without regenerating terrain.
   * The guess and answer survive; the map view resets to the whole sheet.
   */
  const restyle = useCallback(() => {
    const t = terrain.current;
    if (!t) return;
    const cfg = DIFFICULTY[difficulty];
    const layers = buildMapLayers(t, { woodland: cfg.woodland, contourLabels: cfg.contourLabels, font: mapFont() });
    setContourInterval(layers.interval);
    const m = map.current;
    if (m) {
      const g = m.guess, a = m.answer, area = m.area;
      m.setLayers(layers);
      if (g) m.setGuess({ ...g });
      if (a) m.setAnswer({ ...a });
      if (area) m.setArea({ ...area });
    }
    setProfile(null);
    const v = vp.current;
    if (v) field.current?.build(t, v, { lookAround: cfg.lookAround, hazeMul: cfg.hazeMul });
  }, [difficulty]);

  return {
    fieldCanvas, mapCanvas, field, map, terrain, vp,
    guess, setGuess, hover, yaw, profile, setProfile, tool, setTool, setBaseMode,
    ready, webglError, contourInterval, wheelHint, loadMap, showView, restyle,
  };
}

export type Playfield = ReturnType<typeof usePlayfield>;

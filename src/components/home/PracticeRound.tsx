'use client';

import { useEffect, useRef, useState } from 'react';
import { chooseViewpoint, type Viewpoint } from '@/lib/game/viewpoint';
import { DIFFICULTY } from '@/lib/game/difficulty';
import { scoreRound, type RoundScore } from '@/lib/game/scoring';
import { searchArea } from '@/lib/game/hints';
import { angDiff } from '@/lib/game/math';
import { bearingText, fmtDist, fmtInt } from '@/lib/client/format';
import { describePoint, usePlayfield } from '@/components/game/usePlayfield';
import { FieldPanel } from '@/components/game/FieldPanel';
import { MapPanel } from '@/components/game/MapPanel';
import { useLaunch } from './launch';
import { CountUp } from './CountUp';

/** A forested lake valley whose lakes are easy to match on the map; later maps are random. */
const FIRST_SEED = 2802362286;
const randomSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

interface PracticeResult extends RoundScore {
  dist: number;
  angErr: number;
  timeS: number;
  bearing: number;
}

function reaction(dist: number) {
  if (dist <= 150) return 'Spot on. You read that land like a local.';
  if (dist <= 500) return 'Close. A ridge or two off.';
  if (dist <= 1500) return 'Right valley system, wrong slope.';
  return 'Off the mark. Line up the skyline with the contours and try another.';
}

type Idle = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };

/**
 * A full round played in the browser, no account needed. It follows the difficulty
 * picked in the launcher, so changing it restyles this map and view on the spot.
 */
export default function PracticeRound() {
  const { difficulty, launch, launching } = useLaunch();
  const cfg = DIFFICULTY[difficulty];
  const pf = usePlayfield(difficulty, { wheel: 'modifier' });
  const pfRef = useRef(pf);
  pfRef.current = pf;
  const diffRef = useRef(difficulty);
  diffRef.current = difficulty;
  const [seed, setSeed] = useState(FIRST_SEED);
  const [phase, setPhase] = useState<'loading' | 'guess' | 'reveal'>('loading');
  const [name, setName] = useState<string | null>(null);
  const [res, setRes] = useState<PracticeResult | null>(null);
  const [played, setPlayed] = useState(0);
  const [armed, setArmed] = useState(true);
  const [coarse, setCoarse] = useState(false);
  const [mod, setMod] = useState('Ctrl');
  const vpRef = useRef<Viewpoint | null>(null);
  const startAt = useRef(0);
  const styled = useRef(difficulty);

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) {
      setCoarse(true);
      setArmed(false);
    }
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod('⌘');
  }, []);

  // Generate the practice map once the page is idle, so the launcher stays responsive.
  useEffect(() => {
    if (!pf.ready) return;
    let cancelled = false;
    const run = async () => {
      const p = pfRef.current;
      const loadedWith = diffRef.current;
      setPhase('loading');
      setRes(null);
      const t = await p.loadMap(seed);
      if (cancelled) return;
      const vp = chooseViewpoint(t);
      vpRef.current = vp;
      setName(t.name);
      p.showView(vp.token);
      if (diffRef.current !== loadedWith) pfRef.current.restyle();
      styled.current = diffRef.current;
      p.map.current?.setArea(DIFFICULTY[diffRef.current].freeSearchArea ? searchArea(seed, vp.x, vp.z) : null);
      startAt.current = performance.now();
      setPhase('guess');
    };
    const w = window as unknown as Idle;
    let handle = 0;
    if (w.requestIdleCallback) handle = w.requestIdleCallback(() => void run(), { timeout: 1200 });
    else handle = window.setTimeout(() => void run(), 150);
    return () => {
      cancelled = true;
      if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [pf.ready, seed]);

  // A new difficulty restyles the current map and view rather than starting over.
  useEffect(() => {
    if (phase === 'loading' || styled.current === difficulty) return;
    styled.current = difficulty;
    pfRef.current.restyle();
    const vp = vpRef.current;
    if (vp && phase === 'guess') {
      pfRef.current.map.current?.setArea(DIFFICULTY[difficulty].freeSearchArea ? searchArea(seed, vp.x, vp.z) : null);
    }
  }, [difficulty, phase, seed]);

  const { setBaseMode } = pf;
  useEffect(() => {
    setBaseMode(phase === 'guess' && armed ? 'guess' : 'view');
  }, [phase, armed, setBaseMode]);

  const lockIn = () => {
    const g = pf.guess, vp = vpRef.current;
    if (phase !== 'guess' || !g || g.bearing == null || !vp) return;
    const dist = Math.hypot(g.x - vp.x, g.z - vp.z);
    const angErr = (Math.abs(angDiff(g.bearing, vp.bearing)) * 180) / Math.PI;
    const timeS = (performance.now() - startAt.current) / 1000;
    const s = scoreRound(cfg, { dist, angErrDeg: angErr, timeS, hints: [] });
    setRes({ ...s, dist, angErr, timeS, bearing: vp.bearing });
    pf.setTool('guess');
    const m = pf.map.current;
    if (m) {
      m.setAnswer({ x: vp.x, z: vp.z, bearing: vp.bearing });
      m.fit([vp, g]);
    }
    setPlayed((n) => n + 1);
    setPhase('reveal');
  };

  const another = () => setSeed(randomSeed());

  const g = pf.guess;
  const ready = phase === 'guess' && g && g.bearing != null;
  const t = pf.terrain.current;
  const readout = cfg.elevationReadout && pf.hover && t ? describePoint(t, pf.hover) : null;

  return (
    <section className="practice" aria-labelledby="practice-title">
      <div className="practice-head">
        <div>
          <p className="eyebrow">Practice map · {cfg.label} rules · nothing is saved</p>
          <h2 id="practice-title">Warm up on a practice map</h2>
        </div>
        <p className="muted practice-quad">{name ? `${name} Quadrangle` : 'Surveying…'}</p>
      </div>
      <div className="stage">
        <section className="view-area" aria-label="Practice view">
          <FieldPanel
            canvasRef={pf.fieldCanvas}
            loading={phase === 'loading' ? 'Surveying a practice map' : null}
            countdown={null}
            lookAround={cfg.lookAround}
            compass={null}
            start={pf.vp.current?.bearing ?? null}
            yaw={pf.yaw}
            onResetView={() => pf.field.current?.resetView()}
            webglError={pf.webglError}
          />
        </section>

        <section className="info-area">
          {phase === 'reveal' && res ? (
            <section className="result practice-result" aria-live="polite">
              <div className="result-head">
                <h2><small>Practice</small><span><CountUp value={res.total} /></span> pts</h2>
                <div className="legend">
                  <span><i className="g" />Your guess</span>
                  <span><i className="a" />Actual spot</span>
                </div>
              </div>
              <p className="reaction">{reaction(res.dist)}</p>
              <dl className="breakdown">
                <dt>Position</dt><dd>{fmtDist(res.dist)} off</dd><dd className="pts">{fmtInt(res.pos)}</dd>
                <dt>Facing</dt><dd>{Math.round(res.angErr)}° off · true {bearingText(res.bearing)}</dd><dd className="pts">{fmtInt(res.dir)}</dd>
                <dt>Time</dt><dd>{res.timeS.toFixed(1)} s</dd><dd className="pts">+{fmtInt(res.time)}</dd>
              </dl>
              <div className="button-row">
                <button className="btn" type="button" disabled={launching}
                  onClick={(e) => void launch(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined)}>
                  Play five {cfg.label} rounds
                </button>
                <button className="btn ghost" type="button" onClick={another}>Try another map</button>
              </div>
            </section>
          ) : (
            <>
              <div className="actions">
                <p className="status">
                  {phase === 'loading'
                    ? 'Generating terrain, rivers and forest…'
                    : !armed
                      ? 'Tap the map to start placing your guess.'
                      : ready
                        ? <>Facing <b>{bearingText(g!.bearing!)}</b>. Drag the arrow tip to adjust, or lock it in.</>
                        : g ? 'Now drag from your point toward the direction the view faces.' : 'Click the map where this view was taken.'}
                </p>
                <div className="button-row">
                  <button className="btn ghost small" type="button" onClick={another} disabled={phase === 'loading'}>New map</button>
                  <button className="btn" type="button" disabled={!ready} onClick={lockIn}>Lock in</button>
                </div>
              </div>
              {played === 0 && (
                <ol className="how">
                  <li><b>Read the view.</b> Skylines, water and the tree line are all on the map.</li>
                  <li><b>Click the map</b> where you think the view was taken.</li>
                  <li><b>Drag</b> toward the direction it faces, then lock it in.</li>
                </ol>
              )}
            </>
          )}
        </section>

        <section className="map-area" aria-label="Practice map">
          <div className={`practice-map${armed ? '' : ' unarmed'}`}>
            <MapPanel
              canvasRef={pf.mapCanvas}
              map={pf.map}
              tool={pf.tool}
              onTool={pf.setTool}
              interval={pf.contourInterval}
              readout={readout}
              profile={pf.profile}
              onCloseProfile={() => { pf.setProfile(null); pf.map.current?.setProfile(null); }}
              hint={coarse ? 'Pinch to zoom' : `${mod} + scroll to zoom · right-drag to pan`}
            />
            {pf.wheelHint && <div className="wheel-hint" role="status">Hold {mod} and scroll to zoom the map</div>}
            {!armed && phase !== 'loading' && (
              <button className="arm-map" type="button" onClick={() => setArmed(true)}>Tap to play this map</button>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

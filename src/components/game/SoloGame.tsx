'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import type { GameView, HintPayloads, RoundResult, StartPayload, SubmitResult } from '@/lib/server/games';
import { DIFFICULTY } from '@/lib/game/difficulty';
import { ROUNDS } from '@/lib/game/constants';
import { clamp } from '@/lib/game/math';
import type { HintId } from '@/lib/game/scoring';
import { bearingText, fmtClock, fmtCountdown, MODE_LABEL } from '@/lib/client/format';
import { describePoint, usePlayfield } from './usePlayfield';
import { FieldPanel } from './FieldPanel';
import { MapPanel } from './MapPanel';
import { HintBar } from './HintBar';
import { ResultCard } from './ResultCard';
import { Hud } from './Hud';

type Phase = 'loading' | 'guess' | 'submitting' | 'reveal' | 'error';

export function SoloGame({ initial }: { initial: GameView }) {
  const router = useRouter();
  const cfg = DIFFICULTY[initial.difficulty];
  const pf = usePlayfield(initial.difficulty);
  const { ready, loadMap, showView, map, setBaseMode, setTool } = pf;
  const [round, setRound] = useState(initial.current ?? 1);
  const [scores, setScores] = useState<(number | null)[]>(initial.rounds.map((r) => r.score));
  const [total, setTotal] = useState(initial.total);
  const [phase, setPhase] = useState<Phase>('loading');
  const [name, setName] = useState<string | null>(null);
  const [start, setStart] = useState<StartPayload | null>(null);
  const [offset, setOffset] = useState(0);
  const [hints, setHints] = useState<HintPayloads>({});
  const [result, setResult] = useState<RoundResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setPhase('loading');
      setResult(null);
      setHints({});
      setStart(null);
      setError(null);
      setBaseMode('view');
      try {
        const startReq = api<StartPayload>(`/api/games/${initial.id}/rounds/${round}`, { method: 'POST', body: { action: 'start' } });
        startReq.catch(() => undefined);
        const t = await loadMap(initial.rounds[round - 1].seed);
        if (cancelled) return;
        setName(t.name);
        const s = await startReq;
        if (cancelled) return;
        setOffset(s.serverNow - Date.now());
        setStart(s);
        setHints(s.hints);
        map.current?.setArea(s.hints.area ?? null);
        showView(s.token);
        setBaseMode('guess');
        setPhase('guess');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [ready, round, attempt, initial.id, initial.rounds, loadMap, showView, map, setBaseMode]);

  useEffect(() => {
    if (phase !== 'guess') return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [phase]);

  const serverNow = now + offset;
  const elapsed = start ? serverNow - start.startedAt : 0;
  const remaining = start?.deadline != null ? start.deadline - serverNow : null;

  const submit = useCallback(async (auto: boolean) => {
    if (submitting.current) return;
    const g = pf.guess;
    const complete = g && g.bearing != null;
    if (!auto && !complete) return;
    submitting.current = true;
    setPhase('submitting');
    try {
      const body = complete ? { x: g.x, z: g.z, bearing: g.bearing } : null;
      const r = await api<SubmitResult>(`/api/games/${initial.id}/rounds/${round}`, { method: 'POST', body: { action: 'guess', guess: body } });
      setResult(r.result);
      setTotal(r.total);
      setFinished(r.finished);
      setScores((s) => s.map((v, i) => (i === round - 1 ? r.result.score.total : v)));
      setTool('guess');
      setBaseMode('view');
      const m = map.current;
      if (m) {
        m.setAnswer(r.result.answer);
        if (r.result.guess) m.setGuess({ ...r.result.guess });
        m.fit([r.result.answer, ...(r.result.guess ? [r.result.guess] : [])]);
      }
      setPhase('reveal');
    } catch (err) {
      setError((err as Error).message);
      setPhase('guess');
    } finally {
      submitting.current = false;
    }
  }, [pf.guess, initial.id, round, map, setTool, setBaseMode]);

  useEffect(() => {
    if (phase === 'guess' && remaining != null && remaining <= 0) void submit(true);
  }, [phase, remaining, submit]);

  const next = useCallback(() => {
    if (finished || round >= ROUNDS) router.refresh();
    else setRound((r) => r + 1);
  }, [finished, round, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.key === 'Enter') {
        if (phase === 'guess') void submit(false);
        else if (phase === 'reveal') next();
      } else if (e.key === 'p' || e.key === 'P') {
        if (phase === 'guess') setTool(pf.tool === 'profile' ? 'guess' : 'profile');
      } else if (e.key === '+' || e.key === '=') map.current?.zoomBy(1.5);
      else if (e.key === '-') map.current?.zoomBy(1 / 1.5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, submit, next, pf.tool, setTool, map]);

  const takeHint = async (h: HintId) => {
    setHintBusy(true);
    try {
      const r = await api<{ hints: HintPayloads }>(`/api/games/${initial.id}/rounds/${round}`, { method: 'POST', body: { action: 'hint', hint: h } });
      setHints(r.hints);
      map.current?.setArea(r.hints.area ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setHintBusy(false);
    }
  };

  const g = pf.guess;
  let status = 'Click the map where you think you are standing.';
  if (g && g.bearing == null) status = 'Now drag from your point toward the direction you face.';
  const ready2 = phase === 'guess' && g && g.bearing != null;
  const timeT = clamp(1 - Math.max(0, elapsed / 1000 - 5) / (cfg.timeWindow - 5), 0, 1);
  const t = pf.terrain.current;
  const readout = cfg.elevationReadout && pf.hover && t ? describePoint(t, pf.hover) : null;
  let clock: string, clockLabel: string;
  if (phase === 'reveal' && result) { clock = fmtClock(result.timeS * 1000); clockLabel = 'Time used'; }
  else if (remaining != null) { clock = fmtCountdown(remaining); clockLabel = 'Time left'; }
  else { clock = fmtClock(elapsed); clockLabel = 'Clock'; }

  return (
    <main className="play">
      <Hud
        title={name ? `${name} Quadrangle` : 'Surveying…'}
        subtitle={`${MODE_LABEL[initial.mode]} · ${cfg.label}${initial.dailyDate ? ` · ${initial.dailyDate}` : ''}`}
        round={round}
        scores={scores}
        clock={phase === 'loading' ? '—' : clock}
        clockLabel={clockLabel}
        clockLow={remaining != null && remaining < 10000 && phase === 'guess'}
        total={total}
      />
      <div className="stage">
        <section className="view-area" aria-label="Field view">
          <FieldPanel
            canvasRef={pf.fieldCanvas}
            loading={phase === 'loading' ? (round === 1 ? 'Surveying terrain' : `Surveying quadrangle ${round}`) : phase === 'error' ? 'Could not load this round' : null}
            countdown={null}
            lookAround={cfg.lookAround}
            compass={hints.compass?.bearing ?? null}
            start={pf.vp.current?.bearing ?? null}
            yaw={pf.yaw}
            onResetView={() => pf.field.current?.resetView()}
            webglError={pf.webglError}
          />
        </section>

        <section className="info-area">
          {phase === 'reveal' && result ? (
            <ResultCard result={result} title={`Round ${round}`}>
              <div className="result-actions">
                <button className="btn" type="button" onClick={next} autoFocus>
                  {finished || round >= ROUNDS ? 'See your survey' : 'Next quadrangle'}
                </button>
              </div>
            </ResultCard>
          ) : (
            <>
              <div className="actions">
                <div className="time-bar" style={{ '--t': timeT.toFixed(3) } as React.CSSProperties} aria-hidden="true" />
                <p className="status">
                  {ready2 ? <>Facing <b>{bearingText(g!.bearing!)}</b>. Drag the arrow tip to adjust, or lock it in.</> : status}
                </p>
                <button className="btn" type="button" disabled={!ready2} onClick={() => void submit(false)}>
                  {phase === 'submitting' ? 'Scoring…' : 'Lock in'}
                </button>
              </div>
              <HintBar difficulty={initial.difficulty} hints={hints} busy={hintBusy} disabled={phase !== 'guess'} onUse={takeHint} />
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}{' '}
              {phase === 'error' && <button className="linkish" type="button" onClick={() => setAttempt((a) => a + 1)}>Try again</button>}
            </p>
          )}
          <p className="brief">
            {cfg.lookAround
              ? <>Drag the view to look around; your <b>start view</b> is the facing that scores. </>
              : <>Match the ridges, lakes, rivers and tree line in the view to the map. </>}
            <b>Click where you stand</b>, then <b>drag toward the direction you face</b>.
            {cfg.timeLimit ? ` You have ${cfg.timeLimit} seconds per round.` : ' Faster answers earn a time bonus.'}
          </p>
        </section>

        <section className="map-area" aria-label="Topographic map">
          <MapPanel
            canvasRef={pf.mapCanvas}
            map={pf.map}
            tool={pf.tool}
            onTool={pf.setTool}
            interval={pf.contourInterval}
            readout={readout}
            profile={pf.profile}
            onCloseProfile={() => { pf.setProfile(null); pf.map.current?.setProfile(null); }}
            hint="Scroll to zoom · right-drag to pan"
          />
        </section>
      </div>
    </main>
  );
}

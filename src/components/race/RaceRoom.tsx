'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import type { RoomView } from '@/lib/server/rooms';
import type { HintPayloads, RoundResult, StartPayload, SubmitResult } from '@/lib/server/games';
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';
import { ROUNDS, MAX_GAME_SCORE } from '@/lib/game/constants';
import type { HintId } from '@/lib/game/scoring';
import { bearingText, fmtCountdown, fmtDist, fmtInt } from '@/lib/client/format';
import { usePlayer } from '@/components/PlayerProvider';
import { CopyField } from '@/components/CopyField';
import { describePoint, usePlayfield } from '@/components/game/usePlayfield';
import { FieldPanel } from '@/components/game/FieldPanel';
import { MapPanel } from '@/components/game/MapPanel';
import { HintBar } from '@/components/game/HintBar';
import { ResultCard } from '@/components/game/ResultCard';
import { Hud } from '@/components/game/Hud';

/** Marker colours for other racers, in join order. Names ride next to each marker. */
const RACER_COLORS = ['#2a78d6', '#1baf7a', '#4a3aa7', '#eda100', '#008300', '#e34948', '#e87ba4', '#52514e'];

type Stage = 'idle' | 'loading' | 'waiting' | 'guess' | 'submitting' | 'submitted' | 'reveal';

export function RaceRoom({ code }: { code: string }) {
  const router = useRouter();
  const { player, ensurePlayer } = usePlayer();
  const [view, setView] = useState<RoomView | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const viewRef = useRef<RoomView | null>(null);
  const joined = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const v = await api<RoomView>(`/api/rooms/${code}`);
      viewRef.current = v;
      setView(v);
      setOffset(v.serverNow - Date.now());
      setError(null);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 404) setMissing(true);
      else setError(e.message);
    }
  }, [code]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (stop) return;
      const v = viewRef.current;
      let delay = 1500;
      if (v?.status === 'playing' && v.phaseEndsAt) {
        const t = Date.now() + (v.serverNow - Date.now());
        const nextEdge = Math.min(...[v.phaseStartsAt, v.phaseEndsAt].filter((x): x is number => x != null && x > t), Infinity);
        if (nextEdge - t < 3500) delay = 600;
      }
      if (document.hidden) delay = 4000;
      timer = setTimeout(loop, delay);
    };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    try {
      const v = await api<RoomView>(`/api/rooms/${code}`, { method: 'POST', body });
      if (v && 'code' in v) {
        viewRef.current = v;
        setView(v);
        setOffset(v.serverNow - Date.now());
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [code]);

  // Arriving through a link with a name already set: join straight away.
  useEffect(() => {
    if (!view || view.me || !player || joined.current) return;
    joined.current = true;
    void post({ action: 'join' });
  }, [view, player, post]);

  if (missing) {
    return (
      <main className="page narrow">
        <p className="eyebrow">Race</p>
        <h1>No room called {code}</h1>
        <p className="muted">Check the code with your host, or start a room of your own.</p>
        <Link className="btn" href="/race">Race rooms</Link>
      </main>
    );
  }
  if (!view) return <main className="page narrow"><p className="muted">Finding room {code}…</p></main>;

  const serverNow = now + offset;
  const member = Boolean(view.me);
  const racing = view.status === 'playing' && Boolean(view.me?.gameId);

  if (!member) {
    return (
      <main className="page narrow">
        <p className="eyebrow">Race room</p>
        <h1 className="room-code-title">{view.code}</h1>
        <p className="lede">{view.members.length} {view.members.length === 1 ? 'racer' : 'racers'} here · {DIFFICULTY[view.difficulty].label}</p>
        <div className="button-row">
          <button className="btn" type="button" onClick={async () => { if (await ensurePlayer()) { joined.current = true; await post({ action: 'join' }); } }}>
            {player ? 'Join this room' : 'Choose a name to join'}
          </button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
    );
  }

  if (racing) return <RaceGame view={view} serverNow={serverNow} post={post} error={error} />;

  const ranked = [...view.members].sort((a, b) => b.total - a.total);
  return (
    <main className="page race-lobby">
      <header className="page-head">
        <p className="eyebrow">Race room · {DIFFICULTY[view.difficulty].label}</p>
        <h1 className="room-code-title">{view.code}</h1>
        <p className="lede">
          {view.status === 'playing'
            ? 'A race is running. You will be in the next one.'
            : view.status === 'finished'
              ? 'Race over. The host can start a rematch on fresh maps.'
              : 'Share the code or link. Everyone plays the same five maps at the same time.'}
        </p>
      </header>
      <div className="results-grid">
        <section className="panel">
          <h2 className="section-title">Invite</h2>
          <CopyField path={`/race/${view.code}`} label="Room link" />
          {view.isHost ? (
            <>
              <h3 className="sub-title">Difficulty</h3>
              <div className="segmented" role="radiogroup" aria-label="Difficulty">
                {DIFFICULTIES.map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={d === view.difficulty}
                    className={d === view.difficulty ? 'on' : ''} disabled={view.status === 'playing'}
                    onClick={() => post({ action: 'difficulty', difficulty: d })}>
                    {DIFFICULTY[d].label}
                  </button>
                ))}
              </div>
              <p className="muted small">{DIFFICULTY[view.difficulty].blurb} Rounds last {DIFFICULTY[view.difficulty].roomSeconds} seconds.</p>
              <div className="button-row">
                <button className="btn" type="button" disabled={view.status === 'playing'} onClick={() => post({ action: 'start' })}>
                  {view.status === 'finished' ? 'Start a rematch' : 'Start the race'}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Waiting for {view.members.find((m) => m.isHost)?.name ?? 'the host'} to start.</p>
          )}
          <button className="linkish" type="button" onClick={async () => { await post({ action: 'leave' }); router.push('/race'); }}>Leave room</button>
        </section>
        <section className="panel">
          <h2 className="section-title">{view.status === 'lobby' ? 'Racers' : 'Standings'}</h2>
          <Standings members={ranked} showScores={view.gameNo > 0} />
        </section>
      </div>
      {view.status === 'finished' && <FinalBanner view={view} />}
      {error && <p className="form-error" role="alert">{error}</p>}
    </main>
  );
}

function FinalBanner({ view }: { view: RoomView }) {
  const ranked = [...view.members].filter((m) => m.playing).sort((a, b) => b.total - a.total);
  const win = ranked[0];
  if (!win) return null;
  return (
    <p className="verdict">
      {win.name} wins with {fmtInt(win.total)} of {fmtInt(MAX_GAME_SCORE)}{ranked[1] ? `, ${fmtInt(win.total - ranked[1].total)} ahead of ${ranked[1].name}` : ''}.
    </p>
  );
}

function Standings({ members, showScores, current }: { members: RoomView['members']; showScores: boolean; current?: number }) {
  return (
    <div className="table-wrap">
      <table className="data-table standings">
        <thead>
          <tr>
            <th scope="col" className="left">Racer</th>
            {showScores && Array.from({ length: ROUNDS }, (_, i) => <th key={i} scope="col">R{i + 1}</th>)}
            {showScores && <th scope="col">Total</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.name} className={m.isMe ? 'me' : undefined}>
              <td className="left name">
                <span className={`presence ${m.connected ? 'on' : 'off'}`} aria-label={m.connected ? 'online' : 'offline'} />
                {m.name}
                {m.isHost && <span className="you">host</span>}
                {current != null && m.playing && (
                  <span className={`tick${m.submitted ? ' done' : ''}`}>{m.submitted ? 'locked in' : 'thinking'}</span>
                )}
              </td>
              {showScores && m.scores.map((s, i) => <td key={i} className="pts">{s != null ? fmtInt(s) : '—'}</td>)}
              {showScores && <td className="pts strong">{fmtInt(m.total)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RaceGame({ view, serverNow, post, error }: {
  view: RoomView; serverNow: number; post(body: Record<string, unknown>): Promise<void>; error: string | null;
}) {
  const difficulty = view.difficulty as Difficulty;
  const cfg = DIFFICULTY[difficulty];
  const pf = usePlayfield(difficulty);
  const { ready, loadMap, showView, map, setBaseMode, setTool } = pf;
  const [stage, setStage] = useState<Stage>('idle');
  const [name, setName] = useState<string | null>(null);
  const [hints, setHints] = useState<HintPayloads>({});
  const [hintBusy, setHintBusy] = useState(false);
  const [mine, setMine] = useState<Record<number, RoundResult>>({});
  const [localErr, setLocalErr] = useState<string | null>(null);
  const loaded = useRef(0);
  const started = useRef(0);
  const submitting = useRef(false);
  const gameId = view.me!.gameId!;
  const seeds = view.me!.seeds;
  const round = view.round;
  const me = view.members.find((m) => m.isMe);

  // Load each round's map as soon as the round is announced (during the countdown).
  useEffect(() => {
    if (!ready || !round || loaded.current === round) return;
    loaded.current = round;
    started.current = 0;
    setStage('loading');
    setHints({});
    setBaseMode('view');
    map.current?.setAnswer(null);
    map.current?.setOthers([]);
    (async () => {
      const t = await loadMap(seeds[round - 1]);
      setName(t.name);
      setStage('waiting');
    })();
  }, [ready, round, seeds, loadMap, setBaseMode, map]);

  // Start the round once its clock begins.
  useEffect(() => {
    if (stage !== 'waiting' || view.phase !== 'play' || loaded.current !== round || started.current === round) return;
    if (view.phaseStartsAt == null || serverNow < view.phaseStartsAt - 300) return;
    started.current = round;
    (async () => {
      try {
        const s = await api<StartPayload>(`/api/games/${gameId}/rounds/${round}`, { method: 'POST', body: { action: 'start' } });
        setHints(s.hints);
        map.current?.setArea(s.hints.area ?? null);
        showView(s.token);
        if (me?.submitted) setStage('submitted');
        else {
          setBaseMode('guess');
          setStage('guess');
        }
      } catch (err) {
        started.current = 0;
        setLocalErr((err as Error).message);
      }
    })();
  }, [stage, view.phase, view.phaseStartsAt, serverNow, round, gameId, showView, map, setBaseMode, me?.submitted]);

  const submit = useCallback(async (auto: boolean) => {
    if (submitting.current) return;
    const g = pf.guess;
    const complete = g && g.bearing != null;
    if (!auto && !complete) return;
    submitting.current = true;
    setStage('submitting');
    try {
      const body = complete ? { x: g.x, z: g.z, bearing: g.bearing } : null;
      const r = await api<SubmitResult>(`/api/games/${gameId}/rounds/${round}`, { method: 'POST', body: { action: 'guess', guess: body } });
      setMine((m) => ({ ...m, [round]: r.result }));
      setTool('guess');
      setBaseMode('view');
      setStage('submitted');
      void post({ action: 'join' });
    } catch (err) {
      setLocalErr((err as Error).message);
      setStage('guess');
    } finally {
      submitting.current = false;
    }
  }, [pf.guess, gameId, round, setTool, setBaseMode, post]);

  // Lock in whatever is on the map when the round clock runs out.
  useEffect(() => {
    if (stage === 'guess' && view.phase === 'play' && view.phaseEndsAt != null && serverNow >= view.phaseEndsAt - 250) void submit(true);
  }, [stage, view.phase, view.phaseEndsAt, serverNow, submit]);

  // Reveal: the answer plus everyone's guesses.
  const revealRound = view.reveal?.round ?? 0;
  useEffect(() => {
    if (!view.reveal || view.phase !== 'reveal' || revealRound !== round) return;
    const m = map.current;
    if (!m) return;
    setTool('guess');
    setBaseMode('view');
    m.setAnswer(view.reveal.answer);
    const others = view.reveal.guesses.filter((g) => !g.isMe && g.guess);
    const order = view.members.filter((x) => !x.isMe).map((x) => x.name);
    m.setOthers(others.map((g) => ({
      ...g.guess!, color: RACER_COLORS[Math.max(0, order.indexOf(g.name)) % RACER_COLORS.length], label: g.name,
    })));
    const myGuess = view.reveal.guesses.find((g) => g.isMe)?.guess ?? null;
    if (myGuess) m.setGuess({ ...myGuess });
    m.fit([view.reveal.answer, ...view.reveal.guesses.filter((g) => g.guess).map((g) => g.guess!)]);
    setStage('reveal');
  }, [revealRound, view.phase, round, view.reveal, view.members, map, setTool, setBaseMode]);

  const takeHint = async (h: HintId) => {
    setHintBusy(true);
    try {
      const r = await api<{ hints: HintPayloads }>(`/api/games/${gameId}/rounds/${round}`, { method: 'POST', body: { action: 'hint', hint: h } });
      setHints(r.hints);
      map.current?.setArea(r.hints.area ?? null);
    } catch (err) {
      setLocalErr((err as Error).message);
    } finally {
      setHintBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      if (e.key === 'Enter' && stage === 'guess') void submit(false);
      else if ((e.key === 'p' || e.key === 'P') && stage === 'guess') setTool(pf.tool === 'profile' ? 'guess' : 'profile');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, submit, pf.tool, setTool]);

  const countdown = view.phase === 'play' && view.phaseStartsAt != null && serverNow < view.phaseStartsAt ? view.phaseStartsAt - serverNow : null;
  const left = view.phase === 'play' && view.phaseEndsAt != null ? view.phaseEndsAt - serverNow : null;
  const revealLeft = view.phase === 'reveal' && view.phaseEndsAt != null ? view.phaseEndsAt - serverNow : null;
  const t = pf.terrain.current;
  const readout = cfg.elevationReadout && pf.hover && t ? describePoint(t, pf.hover) : null;
  const g = pf.guess;
  const ranked = [...view.members].filter((m) => m.playing).sort((a, b) => b.total - a.total);
  const myReveal = view.reveal?.round === round ? view.reveal.guesses.find((x) => x.isMe) : undefined;
  const myResult = mine[round];

  return (
    <main className="play">
      <Hud
        title={name ? `${name} Quadrangle` : 'Surveying…'}
        subtitle={`Race ${view.code} · ${cfg.label}`}
        round={round}
        scores={me?.scores ?? []}
        clock={revealLeft != null ? fmtCountdown(revealLeft) : left != null ? fmtCountdown(Math.min(left, cfg.roomSeconds * 1000)) : '—'}
        clockLabel={revealLeft != null ? (round >= ROUNDS ? 'Results in' : 'Next round in') : 'Time left'}
        clockLow={left != null && left < 10000 && stage === 'guess'}
        total={me?.total ?? 0}
      />
      <div className="stage">
        <section className="view-area" aria-label="Field view">
          <FieldPanel
            canvasRef={pf.fieldCanvas}
            loading={stage === 'loading' || stage === 'idle' ? 'Surveying terrain' : null}
            countdown={countdown}
            lookAround={cfg.lookAround}
            compass={hints.compass?.bearing ?? null}
            start={pf.vp.current?.bearing ?? null}
            yaw={pf.yaw}
            onResetView={() => pf.field.current?.resetView()}
            webglError={pf.webglError}
          />
        </section>
        <section className="info-area">
          {stage === 'reveal' && view.reveal ? (
            <section className="result" aria-live="polite">
              {myResult ? (
                <ResultCard result={myResult} title={`Round ${round}`} />
              ) : (
                <p className="muted">{myReveal?.guess ? `You scored ${fmtInt(myReveal.score)}.` : 'No guess from you this round.'}</p>
              )}
              <h3 className="sub-title">Round {round}</h3>
              <ol className="round-rank">
                {[...view.reveal.guesses].sort((a, b) => b.score - a.score).map((r) => (
                  <li key={r.name} className={r.isMe ? 'me' : undefined}>
                    <span>{r.name}</span>
                    <span className="muted">{r.guess ? fmtDist(r.dist ?? 0) : 'no guess'}</span>
                    <b>{fmtInt(r.score)}</b>
                  </li>
                ))}
              </ol>
              {view.isHost && (
                <button className="btn small ghost" type="button" onClick={() => post({ action: 'skip' })}>
                  {round >= ROUNDS ? 'Show final results' : 'Start next round now'}
                </button>
              )}
            </section>
          ) : stage === 'submitted' || stage === 'submitting' ? (
            <section className="panel waiting">
              <p className="eyebrow">{stage === 'submitting' ? 'Scoring…' : 'Locked in'}</p>
              <p>Waiting for the others. The answer appears when everyone has locked in or the clock runs out.</p>
            </section>
          ) : (
            <>
              <div className="actions">
                <p className="status">
                  {countdown != null
                    ? 'Get ready. The map is yours to study now.'
                    : g && g.bearing != null
                      ? <>Facing <b>{bearingText(g.bearing)}</b>. Drag the arrow tip to adjust, or lock it in.</>
                      : g ? 'Now drag from your point toward the direction you face.' : 'Click the map where you think you are standing.'}
                </p>
                <button className="btn" type="button" disabled={stage !== 'guess' || !g || g.bearing == null} onClick={() => void submit(false)}>Lock in</button>
              </div>
              <HintBar difficulty={difficulty} hints={hints} busy={hintBusy} disabled={stage !== 'guess'} onUse={takeHint} />
            </>
          )}
          {(error || localErr) && <p className="form-error" role="alert">{localErr ?? error}</p>}
          <section className="panel">
            <h2 className="section-title">Standings</h2>
            <Standings members={ranked} showScores current={round} />
          </section>
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

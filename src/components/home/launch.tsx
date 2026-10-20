'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { DIFFICULTIES, DIFFICULTY, isDifficulty, type Difficulty } from '@/lib/game/difficulty';
import { usePlayer } from '@/components/PlayerProvider';
import { LaunchOverlay } from './LaunchOverlay';

interface LaunchCtx {
  difficulty: Difficulty;
  setDifficulty(d: Difficulty): void;
  /** Starts a classic game on the chosen difficulty; `from` is where the launch animation begins. */
  launch(from?: { x: number; y: number }): Promise<void>;
  launching: boolean;
  error: string | null;
}

const Ctx = createContext<LaunchCtx | null>(null);

export function useLaunch() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLaunch must be used inside LaunchProvider');
  return c;
}

const STORE_KEY = 'topologio:difficulty';

/** Shared difficulty choice and the Play action for everything on the home page. */
export function LaunchProvider({ children }: { children: ReactNode }) {
  const { ensurePlayer } = usePlayer();
  const router = useRouter();
  const [difficulty, setDifficultyState] = useState<Difficulty>('normal');
  const [launching, setLaunching] = useState<{ x: number; y: number; difficulty: Difficulty } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (isDifficulty(saved)) setDifficultyState(saved);
    } catch {
      // storage unavailable; keep the default
    }
  }, []);

  const setDifficulty = useCallback((d: Difficulty) => {
    setDifficultyState(d);
    try { localStorage.setItem(STORE_KEY, d); } catch { /* ignore */ }
  }, []);

  const launch = useCallback(async (from?: { x: number; y: number }) => {
    setError(null);
    const p = await ensurePlayer();
    if (!p) return;
    const origin = from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setLaunching({ ...origin, difficulty });
    try {
      const r = await api<{ id: string }>('/api/games', { method: 'POST', body: { mode: 'classic', difficulty } });
      router.push(`/game/${r.id}`);
    } catch (err) {
      setLaunching(null);
      setError((err as Error).message);
    }
  }, [ensurePlayer, difficulty, router]);

  // 1–4 pick a difficulty from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) setDifficulty(DIFFICULTIES[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDifficulty]);

  return (
    <Ctx.Provider value={{ difficulty, setDifficulty, launch, launching: Boolean(launching), error }}>
      {children}
      {launching && <LaunchOverlay x={launching.x} y={launching.y} label={DIFFICULTY[launching.difficulty].label} />}
    </Ctx.Provider>
  );
}

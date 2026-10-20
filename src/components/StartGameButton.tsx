'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { usePlayer } from './PlayerProvider';
import type { Difficulty } from '@/lib/game/difficulty';

interface Props {
  mode: 'classic' | 'daily' | 'challenge';
  difficulty?: Difficulty;
  challengeOf?: string;
  label: string;
  className?: string;
}

/** Makes sure the player has a name, creates the game, then opens it. */
export function StartGameButton({ mode, difficulty, challengeOf, label, className = 'btn' }: Props) {
  const { ensurePlayer } = usePlayer();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    const p = await ensurePlayer();
    if (!p) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/api/games', { method: 'POST', body: { mode, difficulty, challengeOf } });
      router.push(`/game/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <span className="start-wrap">
      <button className={className} type="button" onClick={go} disabled={busy}>
        {busy ? 'Opening the map…' : label}
      </button>
      {error && <span className="form-error" role="alert">{error}</span>}
    </span>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { usePlayer } from '@/components/PlayerProvider';
import { DIFFICULTIES, DIFFICULTY, type Difficulty } from '@/lib/game/difficulty';

export function RaceEntry() {
  const { ensurePlayer } = usePlayer();
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!(await ensurePlayer())) return;
    setBusy(true);
    try {
      const r = await api<{ code: string }>('/api/rooms', { method: 'POST', body: { difficulty } });
      router.push(`/race/${r.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length !== 5) { setError('Room codes are five letters.'); return; }
    router.push(`/race/${c}`);
  };

  return (
    <div className="results-grid">
      <section className="panel">
        <h2 className="section-title">Host a race</h2>
        <div className="segmented" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={d === difficulty} className={d === difficulty ? 'on' : ''} onClick={() => setDifficulty(d)}>
              {DIFFICULTY[d].label}
            </button>
          ))}
        </div>
        <p className="muted small">{DIFFICULTY[difficulty].blurb} Each round lasts {DIFFICULTY[difficulty].roomSeconds} seconds.</p>
        <button className="btn" type="button" onClick={create} disabled={busy}>{busy ? 'Opening room…' : 'Create a room'}</button>
      </section>
      <section className="panel">
        <h2 className="section-title">Join a race</h2>
        <form className="inline-form" onSubmit={join}>
          <label className="field">
            <span>Room code</span>
            <input id="room-code" className="code-input" value={code} maxLength={5} autoComplete="off" spellCheck={false}
              placeholder="ABCDE" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          <button className="btn" type="submit" disabled={code.length < 5}>Join</button>
        </form>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

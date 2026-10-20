'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { DIFFICULTY } from '@/lib/game/difficulty';
import { usePlayer } from '@/components/PlayerProvider';
import { useLaunch } from './launch';

/** Open a room on the launcher's difficulty, or jump into a friend's room by code. */
export function RaceQuick() {
  const { difficulty } = useLaunch();
  const { ensurePlayer } = usePlayer();
  const router = useRouter();
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
    <section className="panel race-quick">
      <p className="eyebrow">Race</p>
      <h2>Play friends live</h2>
      <p className="muted">Same five maps, one clock, every guess on the reveal. Up to twelve players.</p>
      <button className="btn" type="button" onClick={create} disabled={busy}>
        {busy ? 'Opening room…' : `Open a ${DIFFICULTY[difficulty].label} room`}
      </button>
      <form className="join-row" onSubmit={join}>
        <label className="sr-only" htmlFor="home-room-code">Room code</label>
        <input
          id="home-room-code"
          className="code-input small"
          value={code}
          maxLength={5}
          autoComplete="off"
          spellCheck={false}
          placeholder="CODE"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn ghost small" type="submit" disabled={code.length < 5}>Join</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

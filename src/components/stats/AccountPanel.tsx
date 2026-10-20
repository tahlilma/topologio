'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { usePlayer } from '@/components/PlayerProvider';

export function AccountPanel() {
  const { player, setPlayer, showKey } = usePlayer();
  const router = useRouter();
  const [name, setName] = useState(player?.name ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState(false);
  if (!player) return null;

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ player: { id: string; name: string } }>('/api/player', { method: 'PATCH', body: { name } });
      setPlayer(r.player);
      setMsg('Name updated.');
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };
  const newKey = async () => {
    setConfirmKey(false);
    try {
      const r = await api<{ key: string }>('/api/player/key', { method: 'POST' });
      showKey(r.key);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };
  const signOut = async () => {
    await api('/api/player', { method: 'DELETE' });
    setPlayer(null);
    router.push('/');
    router.refresh();
  };

  return (
    <section className="panel account">
      <h2 className="section-title">Your field register</h2>
      <form className="inline-form" onSubmit={rename}>
        <label className="field">
          <span>Name on leaderboards</span>
          <input id="rename" value={name} maxLength={18} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn small" type="submit" disabled={name.trim() === player.name || name.trim().length < 3}>Save name</button>
      </form>
      {msg && <p className="ok" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="account-row">
        <div>
          <b>Player key</b>
          <p className="muted small">Signs you in on another device. Making a new key logs out every other device.</p>
        </div>
        {confirmKey ? (
          <span className="button-row">
            <button className="btn small" type="button" onClick={newKey}>Make a new key</button>
            <button className="btn small ghost" type="button" onClick={() => setConfirmKey(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn small ghost" type="button" onClick={() => setConfirmKey(true)}>New player key</button>
        )}
      </div>
      <div className="account-row">
        <div>
          <b>Sign out</b>
          <p className="muted small">You can sign back in with your player key.</p>
        </div>
        <button className="btn small ghost" type="button" onClick={signOut}>Sign out</button>
      </div>
    </section>
  );
}

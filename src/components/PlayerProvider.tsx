'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';

export interface PlayerInfo { id: string; name: string }

interface Ctx {
  player: PlayerInfo | null;
  /** Resolves with the player, asking for a name first if needed; null if the dialog is dismissed. */
  ensurePlayer(): Promise<PlayerInfo | null>;
  setPlayer(p: PlayerInfo | null): void;
  openDialog(mode?: 'name' | 'key'): void;
  showKey(key: string): void;
}

const PlayerContext = createContext<Ctx | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}

export function PlayerProvider({ initial, children }: { initial: PlayerInfo | null; children: ReactNode }) {
  const [player, setPlayer] = useState<PlayerInfo | null>(initial);
  const [dialog, setDialog] = useState<null | 'name' | 'key'>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const waiters = useRef<((p: PlayerInfo | null) => void)[]>([]);
  const router = useRouter();

  const settle = useCallback((p: PlayerInfo | null) => {
    const w = waiters.current;
    waiters.current = [];
    w.forEach((fn) => fn(p));
  }, []);

  const ensurePlayer = useCallback(() => {
    if (player) return Promise.resolve(player);
    setDialog('name');
    return new Promise<PlayerInfo | null>((resolve) => waiters.current.push(resolve));
  }, [player]);

  const done = (p: PlayerInfo, key?: string) => {
    setPlayer(p);
    setDialog(null);
    router.refresh();
    if (key) setNewKey(key);
    else settle(p);
  };

  const close = () => {
    setDialog(null);
    settle(null);
  };

  return (
    <PlayerContext.Provider value={{ player, ensurePlayer, setPlayer, openDialog: (m = 'name') => setDialog(m), showKey: setNewKey }}>
      {children}
      {dialog && <NameDialog mode={dialog} onMode={setDialog} onDone={done} onClose={close} />}
      {newKey && (
        <KeyDialog
          keyText={newKey}
          onClose={() => {
            setNewKey(null);
            settle(player);
          }}
        />
      )}
    </PlayerContext.Provider>
  );
}

function NameDialog({
  mode, onMode, onDone, onClose,
}: {
  mode: 'name' | 'key';
  onMode(m: 'name' | 'key'): void;
  onDone(p: PlayerInfo, key?: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'name') {
        const r = await api<{ player: PlayerInfo; key: string }>('/api/player', { method: 'POST', body: { name: value } });
        onDone(r.player, r.key);
      } else {
        const r = await api<{ player: PlayerInfo }>('/api/player/restore', { method: 'POST', body: { key: value } });
        onDone(r.player);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="name-title" onSubmit={submit}>
        <p className="eyebrow">Field register</p>
        <h2 id="name-title">{mode === 'name' ? 'Sign the register' : 'Sign in with your player key'}</h2>
        <p className="muted">
          {mode === 'name'
            ? 'Pick the name that appears on leaderboards. No email or password needed.'
            : 'Paste the key you saved when you first picked a name.'}
        </p>
        <label className="field">
          <span>{mode === 'name' ? 'Name' : 'Player key'}</span>
          <input
            id={mode === 'name' ? 'player-name' : 'player-key'}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={mode === 'name' ? 18 : 29}
            placeholder={mode === 'name' ? 'e.g. ContourCat' : 'XXXX-XXXX-XXXX-XXXX-XXXX'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn" type="submit" disabled={busy || value.trim().length < 3}>
            {mode === 'name' ? 'Start playing' : 'Sign in'}
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
        <button className="linkish" type="button" onClick={() => { setValue(''); setError(null); onMode(mode === 'name' ? 'key' : 'name'); }}>
          {mode === 'name' ? 'Played before? Sign in with your player key' : 'New here? Pick a name instead'}
        </button>
      </form>
    </div>
  );
}

function KeyDialog({ keyText, onClose }: { keyText: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(keyText).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="modal" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="key-title">
        <p className="eyebrow">Keep this safe</p>
        <h2 id="key-title">Your player key</h2>
        <p className="muted">
          This key signs you in on another device or browser. It is shown only now; you can issue a new one from your stats page.
        </p>
        <code className="player-key">{keyText}</code>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>I saved it</button>
          <button className="btn ghost" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy key'}</button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { usePlayer } from './PlayerProvider';

export function SignInPrompt() {
  const { ensurePlayer, openDialog } = usePlayer();
  const router = useRouter();
  return (
    <div className="button-row">
      <button className="btn" type="button" onClick={async () => { if (await ensurePlayer()) router.refresh(); }}>Choose a name</button>
      <button className="btn ghost" type="button" onClick={() => openDialog('key')}>Sign in with a player key</button>
    </div>
  );
}

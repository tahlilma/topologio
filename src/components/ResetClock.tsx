'use client';

import { useEffect, useState } from 'react';

function untilMidnightUtc() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ms = next - now.getTime();
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Time until the daily challenge rolls over at 00:00 UTC. */
export function ResetClock() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(untilMidnightUtc());
    const id = setInterval(() => setText(untilMidnightUtc()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <span className="mono">{text ?? '—'}</span>;
}

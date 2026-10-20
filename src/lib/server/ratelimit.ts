import { headers } from 'next/headers';
import { HttpError } from './http';

// Fixed-window counters held in memory. On serverless hosts each instance keeps its
// own counts, so this caps bursts per instance rather than enforcing a global quota.
const windows = new Map<string, { start: number; count: number }>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, w] of windows) if (now - w.start > 3_600_000) windows.delete(k);
}

/** Throws 429 once `key` has been used `limit` times within `windowMs`. */
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return;
  }
  if (++w.count > max) {
    const wait = Math.ceil((w.start + windowMs - now) / 1000);
    throw new HttpError(429, `Too many requests. Try again in ${wait} s.`);
  }
}

/** Best-effort client address; the host's proxy sets x-forwarded-for. */
export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
}

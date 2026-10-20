import { hash32 } from '@/lib/game/math';

/** UTC calendar date, YYYY-MM-DD. The daily challenge rolls over at 00:00 UTC. */
export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export const dailySeed = (date: string) => hash32(`topologio-daily:${date}`);

export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const DAILY_DIFFICULTY = 'normal' as const;

import { M_TO_FT } from '@/lib/game/constants';

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

export const fmtFt = (m: number) => `${fmtInt(m * M_TO_FT)} ft`;

export const bearingText = (b: number) => `${String(Math.round(((b * 180) / Math.PI + 360) % 360) % 360).padStart(3, '0')}°`;

export function fmtClock(ms: number) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const MODE_LABEL: Record<string, string> = {
  classic: 'Classic',
  daily: 'Daily',
  challenge: 'Challenge',
  room: 'Race',
};

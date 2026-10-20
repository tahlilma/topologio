import type { Difficulty } from '@/lib/game/difficulty';

/** Line icons for the difficulty tiles; parts with class names animate on hover. */
export function DifficultyIcon({ d }: { d: Difficulty }) {
  return (
    <svg className="diff-icon" viewBox="0 0 32 32" aria-hidden="true">
      {d === 'easy' && (
        <>
          <g className="ic-orbit">
            <path d="M16 3.5a12.5 12.5 0 1 1-11 6.6" />
            <path d="M4.2 4.5v5.8h5.8" />
          </g>
          <path d="M8.6 16c2-3.1 4.5-4.6 7.4-4.6s5.4 1.5 7.4 4.6c-2 3.1-4.5 4.6-7.4 4.6s-5.4-1.5-7.4-4.6z" />
          <circle cx="16" cy="16" r="2.1" />
        </>
      )}
      {d === 'normal' && (
        <>
          <rect x="3.5" y="7" width="25" height="18" rx="1.5" />
          <path className="ic-ridge" d="M5.5 22l7-8.2 5 5.2 3.2-3.4 5.8 6.4" />
          <circle cx="22" cy="12" r="2" />
        </>
      )}
      {(d === 'hard' || d === 'expert') && (
        <>
          <circle cx="16" cy="18" r="10" />
          <path d="M13 3.5h6M16 3.5v4.5" />
          <path d="M24.5 9.5l1.8-1.8" />
          {d === 'expert' && <path className="ic-fill" d="M16 18V8a10 10 0 0 1 8.66 5z" />}
          <path className="ic-hand" d="M16 18l5-5" />
        </>
      )}
    </svg>
  );
}

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface DifficultyConfig {
  id: Difficulty;
  label: string;
  blurb: string;
  /** Drag to look around the full horizon. The scored facing is still the starting view. */
  lookAround: boolean;
  /** Search-area circle shown for free. */
  freeSearchArea: boolean;
  /** Hard round limit in seconds; null = no limit. */
  timeLimit: number | null;
  /** Seconds over which the time bonus decays to zero. */
  timeWindow: number;
  elevationReadout: boolean;
  woodland: boolean;
  contourLabels: boolean;
  hazeMul: number;
  /** Full position points within `tol` metres, then exponential decay with `scale`. */
  pos: { tol: number; scale: number };
  /** Full facing points within `tol` degrees, zero at `zero` degrees. */
  dir: { tol: number; zero: number };
  /** Round length in race rooms. */
  roomSeconds: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'Look around 360°, a search circle on the map, forgiving scoring, no clock.',
    lookAround: true,
    freeSearchArea: true,
    timeLimit: null,
    timeWindow: 180,
    elevationReadout: true,
    woodland: true,
    contourLabels: true,
    hazeMul: 0.85,
    pos: { tol: 100, scale: 1000 },
    dir: { tol: 15, zero: 120 },
    roomSeconds: 150,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    blurb: 'One still view, the full map and elevation readout. Faster answers earn a bonus.',
    lookAround: false,
    freeSearchArea: false,
    timeLimit: null,
    timeWindow: 120,
    elevationReadout: true,
    woodland: true,
    contourLabels: true,
    hazeMul: 1,
    pos: { tol: 60, scale: 650 },
    dir: { tol: 8, zero: 90 },
    roomSeconds: 120,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'A 90-second clock, no elevation readout and stricter scoring.',
    lookAround: false,
    freeSearchArea: false,
    timeLimit: 90,
    timeWindow: 90,
    elevationReadout: false,
    woodland: true,
    contourLabels: true,
    hazeMul: 1.15,
    pos: { tol: 40, scale: 480 },
    dir: { tol: 6, zero: 75 },
    roomSeconds: 90,
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    blurb: '45 seconds, no woodland tint or contour labels, strictest scoring.',
    lookAround: false,
    freeSearchArea: false,
    timeLimit: 45,
    timeWindow: 45,
    elevationReadout: false,
    woodland: false,
    contourLabels: false,
    hazeMul: 1.3,
    pos: { tol: 30, scale: 380 },
    dir: { tol: 5, zero: 60 },
    roomSeconds: 45,
  },
};

export const isDifficulty = (v: unknown): v is Difficulty => typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);

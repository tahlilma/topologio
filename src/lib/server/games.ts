import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from './db';
import { games, players, rounds, rooms, type Game, type Player, type Round } from './schema';
import { getMapInfo, type MapInfo } from './maps';
import { HttpError } from './http';
import { dailySeed, todayUtc, DAILY_DIFFICULTY } from './daily';
import { DIFFICULTY, isDifficulty, type Difficulty } from '@/lib/game/difficulty';
import { isHint, scoreRound, type HintId, type RoundScore } from '@/lib/game/scoring';
import { searchArea } from '@/lib/game/hints';
import { ROUNDS } from '@/lib/game/constants';
import { angDiff, roundSeed } from '@/lib/game/math';

export type Mode = 'classic' | 'daily' | 'challenge' | 'room';

export interface HintPayloads {
  area?: { x: number; z: number; r: number };
  elevation?: { ft: number };
  compass?: { bearing: number };
}

export interface RoundResult {
  guess: { x: number; z: number; bearing: number } | null;
  answer: { x: number; z: number; bearing: number };
  dist: number | null;
  angErr: number | null;
  timeS: number;
  timedOut: boolean;
  hints: HintId[];
  score: RoundScore;
}

export interface RoundView {
  n: number;
  seed: number;
  name: string | null;
  started: boolean;
  startedAt: number | null;
  submitted: boolean;
  score: number | null;
  /** Full result with positions; null when the viewer may not see answers yet. */
  result: RoundResult | null;
}

export interface GameView {
  id: string;
  mode: Mode;
  difficulty: Difficulty;
  status: string;
  total: number;
  totalTime: number;
  createdAt: number;
  finishedAt: number | null;
  dailyDate: string | null;
  challengeOf: string | null;
  roomCode: string | null;
  player: { id: string; name: string };
  isOwner: boolean;
  rounds: RoundView[];
  /** Next round to play (1-based), or null when the game is over. */
  current: number | null;
}

export interface StartPayload {
  n: number;
  token: number;
  startedAt: number;
  serverNow: number;
  /** Round deadline in server time, or null without a clock. */
  deadline: number | null;
  hints: HintPayloads;
}

const parseHints = (s: string): HintId[] => s.split(',').filter(isHint);

function hintPayloads(info: MapInfo, used: HintId[], difficulty: Difficulty): HintPayloads {
  const out: HintPayloads = {};
  if (used.includes('area') || DIFFICULTY[difficulty].freeSearchArea) out.area = searchArea(info.seed, info.x, info.z);
  if (used.includes('elevation')) out.elevation = { ft: Math.round(info.groundFt / 10) * 10 };
  if (used.includes('compass')) out.compass = { bearing: info.bearing };
  return out;
}

export async function insertGame(
  playerId: string, mode: Mode, difficulty: Difficulty, baseSeed: number,
  extra: Partial<Pick<Game, 'dailyDate' | 'challengeOf' | 'roomCode' | 'roomGameNo'>> = {},
) {
  const db = await getDb();
  const id = randomUUID();
  const now = Date.now();
  await db.insert(games).values({
    id, playerId, mode, difficulty, baseSeed: baseSeed >>> 0, status: 'active', total: 0, totalTime: 0, createdAt: now,
    dailyDate: extra.dailyDate ?? null, challengeOf: extra.challengeOf ?? null,
    roomCode: extra.roomCode ?? null, roomGameNo: extra.roomGameNo ?? null,
  });
  await db.insert(rounds).values(
    Array.from({ length: ROUNDS }, (_, i) => ({ gameId: id, n: i + 1, seed: roundSeed(baseSeed, i + 1), hints: '' })),
  );
  return id;
}

export const randomSeed = () => randomInt(0, 2 ** 32);

export async function createGame(player: Player, input: { mode: Mode; difficulty?: string; challengeOf?: string }) {
  const db = await getDb();
  if (input.mode === 'daily') {
    const date = todayUtc();
    const existing = await db.select().from(games).where(and(eq(games.playerId, player.id), eq(games.dailyDate, date))).get();
    if (existing) return existing.id;
    try {
      return await insertGame(player.id, 'daily', DAILY_DIFFICULTY, dailySeed(date), { dailyDate: date });
    } catch {
      const again = await db.select().from(games).where(and(eq(games.playerId, player.id), eq(games.dailyDate, date))).get();
      if (again) return again.id;
      throw new HttpError(500, 'Could not start the daily challenge. Try again.');
    }
  }
  if (input.mode === 'challenge') {
    if (!input.challengeOf) throw new HttpError(400, 'Missing the game to challenge.');
    const orig = await db.select().from(games).where(eq(games.id, input.challengeOf)).get();
    if (!orig || orig.status !== 'finished') throw new HttpError(404, 'That challenge does not exist or is not finished yet.');
    if (orig.playerId === player.id) throw new HttpError(400, 'This is your own game. Send the link to a friend instead.');
    const existing = await db.select().from(games)
      .where(and(eq(games.playerId, player.id), eq(games.challengeOf, orig.id))).get();
    if (existing) return existing.id;
    return insertGame(player.id, 'challenge', orig.difficulty as Difficulty, orig.baseSeed, { challengeOf: orig.id });
  }
  if (input.mode === 'classic') {
    if (!isDifficulty(input.difficulty)) throw new HttpError(400, 'Pick a difficulty.');
    return insertGame(player.id, 'classic', input.difficulty, randomSeed());
  }
  throw new HttpError(400, 'Unknown game mode.');
}

async function loadGame(id: string) {
  const db = await getDb();
  const game = await db.select().from(games).where(eq(games.id, id)).get();
  if (!game) throw new HttpError(404, 'That game does not exist.');
  const rows = await db.select().from(rounds).where(eq(rounds.gameId, id)).orderBy(asc(rounds.n)).all();
  return { game, rows };
}

async function loadOwnedRound(player: Player, gameId: string, n: number) {
  const { game, rows } = await loadGame(gameId);
  if (game.playerId !== player.id) throw new HttpError(403, 'This is not your game.');
  if (!Number.isInteger(n) || n < 1 || n > ROUNDS) throw new HttpError(404, 'That round does not exist.');
  return { game, rows, r: rows[n - 1] };
}

/** Whether `viewer` may see the true spots of another player's game. */
async function mayReveal(game: Game, viewer: Player | null) {
  if (viewer && viewer.id === game.playerId) return true;
  if (game.dailyDate && game.dailyDate < todayUtc()) return true;
  if (!viewer) return false;
  const db = await getDb();
  const mine = await db.select({ id: games.id }).from(games)
    .where(and(eq(games.playerId, viewer.id), eq(games.baseSeed, game.baseSeed), eq(games.status, 'finished'))).get();
  return Boolean(mine);
}

function resultFrom(r: Round, info: MapInfo): RoundResult {
  const guess = r.guessX != null && r.guessZ != null && r.guessBearing != null
    ? { x: r.guessX, z: r.guessZ, bearing: r.guessBearing } : null;
  const answer = r.answerX != null && r.answerZ != null && r.answerBearing != null
    ? { x: r.answerX, z: r.answerZ, bearing: r.answerBearing }
    : { x: info.x, z: info.z, bearing: info.bearing };
  return {
    guess,
    answer,
    dist: r.dist,
    angErr: r.angErr,
    timeS: r.timeS ?? 0,
    timedOut: r.timedOut === 1,
    hints: parseHints(r.hints),
    score: { pos: r.scorePos ?? 0, dir: r.scoreDir ?? 0, time: r.scoreTime ?? 0, total: r.score ?? 0 },
  };
}

export async function getGameView(id: string, viewer: Player | null): Promise<GameView> {
  const { game, rows } = await loadGame(id);
  const db = await getDb();
  const owner = await db.select({ id: players.id, name: players.name }).from(players).where(eq(players.id, game.playerId)).get();
  const reveal = await mayReveal(game, viewer);
  const isOwner = Boolean(viewer && viewer.id === game.playerId);
  const roundViews: RoundView[] = [];
  for (const r of rows) {
    const submitted = r.submittedAt != null;
    let result: RoundResult | null = null;
    let name: string | null = null;
    if (submitted && reveal) {
      const info = await getMapInfo(r.seed);
      result = resultFrom(r, info);
      name = info.name;
    }
    roundViews.push({
      n: r.n, seed: r.seed, name, started: r.startedAt != null, startedAt: r.startedAt, submitted,
      score: submitted ? r.score ?? 0 : null, result,
    });
  }
  const next = rows.find((r) => r.submittedAt == null);
  return {
    id: game.id,
    mode: game.mode as Mode,
    difficulty: game.difficulty as Difficulty,
    status: game.status,
    total: game.total,
    totalTime: game.totalTime,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    dailyDate: game.dailyDate,
    challengeOf: game.challengeOf,
    roomCode: game.roomCode,
    player: { id: owner?.id ?? game.playerId, name: owner?.name ?? 'Unknown' },
    isOwner,
    rounds: roundViews,
    current: game.status === 'active' && next ? next.n : null,
  };
}

/** Room games start each round on the room's schedule rather than on request. */
async function roomRoundWindow(game: Game, n: number) {
  const db = await getDb();
  const room = await db.select().from(rooms).where(eq(rooms.code, game.roomCode!)).get();
  if (!room || room.gameNo !== game.roomGameNo) throw new HttpError(409, 'This race is over.');
  if (room.round !== n || room.phase !== 'play' || room.phaseStartsAt == null || room.phaseEndsAt == null) {
    throw new HttpError(409, 'That round is not running.');
  }
  return { start: room.phaseStartsAt, end: room.phaseEndsAt };
}

export async function startRound(player: Player, gameId: string, n: number): Promise<StartPayload> {
  const { game, rows, r } = await loadOwnedRound(player, gameId, n);
  if (game.status !== 'active') throw new HttpError(409, 'This game is already over.');
  if (n > 1 && rows[n - 2].submittedAt == null) throw new HttpError(409, 'Finish the previous round first.');
  const info = await getMapInfo(r.seed);
  const cfg = DIFFICULTY[game.difficulty as Difficulty];
  let startedAt = r.startedAt;
  let deadline: number | null = null;
  if (game.mode === 'room') {
    const win = await roomRoundWindow(game, n);
    if (Date.now() < win.start - 1500) throw new HttpError(409, 'The round has not started yet.');
    startedAt = win.start;
    deadline = win.end;
    if (r.startedAt == null) {
      const db = await getDb();
      await db.update(rounds).set({ startedAt }).where(and(eq(rounds.gameId, gameId), eq(rounds.n, n), isNull(rounds.startedAt)));
    }
  } else {
    if (startedAt == null) {
      const db = await getDb();
      const now = Date.now();
      await db.update(rounds).set({ startedAt: now }).where(and(eq(rounds.gameId, gameId), eq(rounds.n, n), isNull(rounds.startedAt)));
      const fresh = await db.select({ startedAt: rounds.startedAt }).from(rounds)
        .where(and(eq(rounds.gameId, gameId), eq(rounds.n, n))).get();
      startedAt = fresh?.startedAt ?? now;
    }
    if (cfg.timeLimit) deadline = startedAt + cfg.timeLimit * 1000;
  }
  return {
    n,
    token: info.token,
    startedAt,
    serverNow: Date.now(),
    deadline,
    hints: hintPayloads(info, parseHints(r.hints), game.difficulty as Difficulty),
  };
}

export async function useHint(player: Player, gameId: string, n: number, hint: unknown): Promise<HintPayloads> {
  if (!isHint(hint)) throw new HttpError(400, 'Unknown hint.');
  const { game, r } = await loadOwnedRound(player, gameId, n);
  if (game.status !== 'active' || r.startedAt == null || r.submittedAt != null) throw new HttpError(409, 'Hints are only available during a round.');
  const used = parseHints(r.hints);
  if (!used.includes(hint)) {
    used.push(hint);
    const db = await getDb();
    await db.update(rounds).set({ hints: used.join(',') })
      .where(and(eq(rounds.gameId, gameId), eq(rounds.n, n), isNull(rounds.submittedAt)));
  }
  const info = await getMapInfo(r.seed);
  return hintPayloads(info, used, game.difficulty as Difficulty);
}

export interface SubmitResult {
  result: RoundResult;
  total: number;
  finished: boolean;
}

/** Scores a guess. A null guess (or a late one) scores zero. */
export async function submitGuess(
  player: Player, gameId: string, n: number, guess: { x: number; z: number; bearing: number } | null,
): Promise<SubmitResult> {
  const { game, rows, r } = await loadOwnedRound(player, gameId, n);
  if (r.startedAt == null) throw new HttpError(409, 'That round has not started.');
  const info = await getMapInfo(r.seed);
  if (r.submittedAt != null || game.status !== 'active') {
    const fresh = await loadGame(gameId);
    return { result: resultFrom(fresh.rows[n - 1], info), total: fresh.game.total, finished: fresh.game.status === 'finished' };
  }
  const cfg = DIFFICULTY[game.difficulty as Difficulty];
  const now = Date.now();
  let timeS = (now - r.startedAt) / 1000;
  let late = false;
  if (game.mode === 'room') {
    const db = await getDb();
    const room = await db.select().from(rooms).where(eq(rooms.code, game.roomCode!)).get();
    const end = room && room.round === n && room.phase === 'play' ? room.phaseEndsAt ?? 0 : 0;
    late = now > end + 3000;
  } else if (cfg.timeLimit) {
    late = timeS > cfg.timeLimit + 3;
  }
  if (cfg.timeLimit) timeS = Math.min(timeS, cfg.timeLimit);
  const ok = guess && !late;
  const dist = ok ? Math.hypot(guess.x - info.x, guess.z - info.z) : null;
  const angErr = ok ? Math.abs(angDiff(guess.bearing, info.bearing)) * (180 / Math.PI) : null;
  const hints = parseHints(r.hints);
  const score = scoreRound(cfg, { dist: dist ?? 0, angErrDeg: angErr ?? 0, timeS, hints, noGuess: !ok });
  const db = await getDb();
  const res = await db.update(rounds).set({
    submittedAt: now,
    guessX: ok ? guess.x : null,
    guessZ: ok ? guess.z : null,
    guessBearing: ok ? guess.bearing : null,
    dist, angErr, timeS, timedOut: late ? 1 : 0,
    answerX: info.x, answerZ: info.z, answerBearing: info.bearing,
    scorePos: score.pos, scoreDir: score.dir, scoreTime: score.time, score: score.total,
  }).where(and(eq(rounds.gameId, gameId), eq(rounds.n, n), isNull(rounds.submittedAt)));
  if (res.rowsAffected === 0) {
    const fresh = await loadGame(gameId);
    return { result: resultFrom(fresh.rows[n - 1], info), total: fresh.game.total, finished: fresh.game.status === 'finished' };
  }
  const finished = rows.every((row) => row.n === n || row.submittedAt != null);
  await db.update(games).set({
    total: sql`${games.total} + ${score.total}`,
    totalTime: sql`${games.totalTime} + ${timeS}`,
    ...(finished ? { status: 'finished', finishedAt: now } : {}),
  }).where(eq(games.id, gameId));
  const after = await db.select({ total: games.total }).from(games).where(eq(games.id, gameId)).get();
  const fresh = await db.select().from(rounds).where(and(eq(rounds.gameId, gameId), eq(rounds.n, n))).get();
  return { result: resultFrom(fresh!, info), total: after?.total ?? 0, finished };
}

/** Zero-scores a room round the player never submitted. */
export async function forfeitRound(gameId: string, n: number, seed: number, startedAt: number, now: number) {
  const db = await getDb();
  const info = await getMapInfo(seed);
  const res = await db.update(rounds).set({
    startedAt, submittedAt: now, timeS: (now - startedAt) / 1000, timedOut: 1,
    answerX: info.x, answerZ: info.z, answerBearing: info.bearing,
    scorePos: 0, scoreDir: 0, scoreTime: 0, score: 0,
  }).where(and(eq(rounds.gameId, gameId), eq(rounds.n, n), isNull(rounds.submittedAt)));
  if (res.rowsAffected && n === ROUNDS) {
    await db.update(games).set({ status: 'finished', finishedAt: now }).where(and(eq(games.id, gameId), eq(games.status, 'active')));
  }
}

/** Most recent unfinished solo game, for the "resume" prompt. */
export async function activeGame(player: Player) {
  const db = await getDb();
  return db.select().from(games)
    .where(and(eq(games.playerId, player.id), eq(games.status, 'active'), sql`${games.mode} != 'room'`))
    .orderBy(sql`${games.createdAt} DESC`).get();
}

export async function abandonGame(player: Player, gameId: string) {
  const db = await getDb();
  await db.update(games).set({ status: 'abandoned' })
    .where(and(eq(games.id, gameId), eq(games.playerId, player.id), eq(games.status, 'active'), sql`${games.mode} = 'classic'`));
}

/** Finished games that took on this one as a challenge. */
export async function challengersOf(gameId: string) {
  const db = await getDb();
  return db.select({ id: games.id, name: players.name, total: games.total, status: games.status })
    .from(games).innerJoin(players, eq(players.id, games.playerId))
    .where(eq(games.challengeOf, gameId)).orderBy(sql`${games.total} DESC`).all();
}

/** The viewer's own game against a challenge, if they have started one. */
export async function challengeGameOf(playerId: string, originalId: string) {
  const db = await getDb();
  return db.select().from(games).where(and(eq(games.playerId, playerId), eq(games.challengeOf, originalId))).get();
}

/** The viewer's daily game for a date, if any. */
export async function dailyGameOf(playerId: string, date: string) {
  const db = await getDb();
  return db.select().from(games).where(and(eq(games.playerId, playerId), eq(games.dailyDate, date))).get();
}

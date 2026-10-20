// Race rooms: everyone plays the same five maps at the same time.
// The room advances lazily: whichever poll arrives after a deadline moves it on,
// with conditional updates so concurrent polls cannot advance it twice.

import { randomInt } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { games, players, roomMembers, rooms, rounds, type Player, type Room } from './schema';
import { HttpError } from './http';
import { insertGame, forfeitRound, randomSeed } from './games';
import { getMapInfo } from './maps';
import { DIFFICULTY, isDifficulty, type Difficulty } from '@/lib/game/difficulty';
import { ROUNDS } from '@/lib/game/constants';
import { roundSeed } from '@/lib/game/math';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Time between a round being announced and its clock starting, for loading. */
export const COUNTDOWN_MS = 5000;
export const REVEAL_MS = 12000;
/** A member counts as connected if they polled this recently. */
const ACTIVE_MS = 15000;
const MAX_MEMBERS = 12;

export interface RoomMemberView {
  name: string;
  isHost: boolean;
  isMe: boolean;
  connected: boolean;
  playing: boolean;
  total: number;
  scores: (number | null)[];
  submitted: boolean;
}

export interface RevealGuess {
  name: string;
  isMe: boolean;
  guess: { x: number; z: number; bearing: number } | null;
  dist: number | null;
  score: number;
}

export interface RoomView {
  code: string;
  difficulty: Difficulty;
  status: 'lobby' | 'playing' | 'finished';
  gameNo: number;
  round: number;
  phase: 'play' | 'reveal' | null;
  phaseStartsAt: number | null;
  phaseEndsAt: number | null;
  serverNow: number;
  isHost: boolean;
  members: RoomMemberView[];
  me: { gameId: string | null; seeds: number[] } | null;
  reveal: { round: number; answer: { x: number; z: number; bearing: number }; guesses: RevealGuess[] } | null;
}

function newCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return s;
}

export const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);

async function loadRoom(code: string) {
  const db = await getDb();
  const room = await db.select().from(rooms).where(eq(rooms.code, normalizeCode(code))).get();
  if (!room) throw new HttpError(404, 'No room has that code. Check it with your host.');
  return room;
}

export async function createRoom(player: Player, difficulty: unknown) {
  if (!isDifficulty(difficulty)) throw new HttpError(400, 'Pick a difficulty.');
  const db = await getDb();
  const now = Date.now();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    try {
      await db.insert(rooms).values({
        code, hostId: player.id, difficulty, status: 'lobby', gameNo: 0, baseSeed: randomSeed(), round: 0,
        phase: null, phaseStartsAt: null, phaseEndsAt: null, createdAt: now, updatedAt: now,
      });
      await db.insert(roomMembers).values({ roomCode: code, playerId: player.id, joinedAt: now, lastSeenAt: now, gameId: null });
      return code;
    } catch {
      // code collision; try another
    }
  }
  throw new HttpError(500, 'Could not create a room. Try again.');
}

export async function joinRoom(player: Player, code: string) {
  const room = await loadRoom(code);
  const db = await getDb();
  const now = Date.now();
  const existing = await db.select().from(roomMembers)
    .where(and(eq(roomMembers.roomCode, room.code), eq(roomMembers.playerId, player.id))).get();
  if (existing) {
    await db.update(roomMembers).set({ lastSeenAt: now })
      .where(and(eq(roomMembers.roomCode, room.code), eq(roomMembers.playerId, player.id)));
    return room.code;
  }
  const count = (await db.select().from(roomMembers).where(eq(roomMembers.roomCode, room.code)).all()).length;
  if (count >= MAX_MEMBERS) throw new HttpError(409, 'This room is full.');
  await db.insert(roomMembers).values({ roomCode: room.code, playerId: player.id, joinedAt: now, lastSeenAt: now, gameId: null });
  return room.code;
}

export async function leaveRoom(player: Player, code: string) {
  const room = await loadRoom(code);
  const db = await getDb();
  await db.delete(roomMembers).where(and(eq(roomMembers.roomCode, room.code), eq(roomMembers.playerId, player.id)));
}

export async function setRoomDifficulty(player: Player, code: string, difficulty: unknown) {
  const room = await loadRoom(code);
  if (room.hostId !== player.id) throw new HttpError(403, 'Only the host can change the difficulty.');
  if (room.status === 'playing') throw new HttpError(409, 'Wait until this race is over.');
  if (!isDifficulty(difficulty)) throw new HttpError(400, 'Pick a difficulty.');
  const db = await getDb();
  await db.update(rooms).set({ difficulty, updatedAt: Date.now() }).where(eq(rooms.code, room.code));
}

/** Host starts a race (or a rematch) for everyone currently connected. */
export async function startRace(player: Player, code: string) {
  const room = await loadRoom(code);
  if (room.hostId !== player.id) throw new HttpError(403, 'Only the host can start the race.');
  if (room.status === 'playing') throw new HttpError(409, 'The race is already running.');
  const db = await getDb();
  const now = Date.now();
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomCode, room.code)).all();
  const racers = members.filter((m) => m.playerId === player.id || now - m.lastSeenAt < ACTIVE_MS);
  const baseSeed = randomSeed();
  const gameNo = room.gameNo + 1;
  const difficulty = room.difficulty as Difficulty;
  // Generate the first map before the clock starts so nobody waits on the server.
  await getMapInfo(roundSeed(baseSeed, 1));
  const res = await db.update(rooms).set({
    status: 'playing', gameNo, baseSeed, round: 1, phase: 'play',
    phaseStartsAt: Date.now() + COUNTDOWN_MS,
    phaseEndsAt: Date.now() + COUNTDOWN_MS + DIFFICULTY[difficulty].roomSeconds * 1000,
    updatedAt: Date.now(),
  }).where(and(eq(rooms.code, room.code), eq(rooms.gameNo, room.gameNo)));
  if (!res.rowsAffected) throw new HttpError(409, 'The race is already starting.');
  await db.update(roomMembers).set({ gameId: null }).where(eq(roomMembers.roomCode, room.code));
  for (const m of racers) {
    const gameId = await insertGame(m.playerId, 'room', difficulty, baseSeed, { roomCode: room.code, roomGameNo: gameNo });
    await db.update(roomMembers).set({ gameId })
      .where(and(eq(roomMembers.roomCode, room.code), eq(roomMembers.playerId, m.playerId)));
  }
  return baseSeed;
}

/** Generates the remaining maps of a race so later rounds start instantly. */
export async function warmRace(baseSeed: number) {
  for (let n = 2; n <= ROUNDS; n++) await getMapInfo(roundSeed(baseSeed, n)).catch(() => undefined);
}

async function advance(room: Room, now: number): Promise<Room> {
  if (room.status !== 'playing' || room.phaseEndsAt == null || room.phaseStartsAt == null) return room;
  const db = await getDb();
  const members = await db.select().from(roomMembers).where(eq(roomMembers.roomCode, room.code)).all();
  const racers = members.filter((m) => m.gameId);
  if (room.phase === 'play') {
    const ids = racers.map((m) => m.gameId!);
    const done = ids.length
      ? await db.select({ gameId: rounds.gameId, submittedAt: rounds.submittedAt }).from(rounds)
        .where(and(inArray(rounds.gameId, ids), eq(rounds.n, room.round))).all()
      : [];
    const submitted = new Set(done.filter((d) => d.submittedAt != null).map((d) => d.gameId));
    const allIn = racers.every((m) => submitted.has(m.gameId!) || now - m.lastSeenAt > ACTIVE_MS);
    if (now >= room.phaseEndsAt + 2500 || (allIn && now >= room.phaseStartsAt)) {
      const res = await db.update(rooms).set({ phase: 'reveal', phaseStartsAt: now, phaseEndsAt: now + REVEAL_MS, updatedAt: now })
        .where(and(eq(rooms.code, room.code), eq(rooms.round, room.round), eq(rooms.phase, 'play'), eq(rooms.gameNo, room.gameNo)));
      if (res.rowsAffected) {
        const seed = roundSeed(room.baseSeed, room.round);
        for (const m of racers) if (!submitted.has(m.gameId!)) await forfeitRound(m.gameId!, room.round, seed, room.phaseStartsAt, now);
      }
      return (await db.select().from(rooms).where(eq(rooms.code, room.code)).get())!;
    }
  } else if (room.phase === 'reveal' && now >= room.phaseEndsAt) {
    const last = room.round >= ROUNDS;
    const roomSeconds = DIFFICULTY[room.difficulty as Difficulty].roomSeconds;
    await db.update(rooms).set(
      last
        ? { status: 'finished', phase: null, phaseStartsAt: null, phaseEndsAt: null, updatedAt: now }
        : {
          round: room.round + 1, phase: 'play', phaseStartsAt: now + COUNTDOWN_MS,
          phaseEndsAt: now + COUNTDOWN_MS + roomSeconds * 1000, updatedAt: now,
        },
    ).where(and(eq(rooms.code, room.code), eq(rooms.round, room.round), eq(rooms.phase, 'reveal'), eq(rooms.gameNo, room.gameNo)));
    return (await db.select().from(rooms).where(eq(rooms.code, room.code)).get())!;
  }
  return room;
}

/** Host can cut a reveal short. */
export async function skipReveal(player: Player, code: string) {
  const room = await loadRoom(code);
  if (room.hostId !== player.id) throw new HttpError(403, 'Only the host can skip ahead.');
  if (room.phase !== 'reveal') return;
  const db = await getDb();
  await db.update(rooms).set({ phaseEndsAt: Date.now() })
    .where(and(eq(rooms.code, room.code), eq(rooms.phase, 'reveal'), eq(rooms.round, room.round)));
}

export async function pollRoom(player: Player | null, code: string): Promise<RoomView> {
  let room = await loadRoom(code);
  const db = await getDb();
  const now = Date.now();
  if (player) {
    await db.update(roomMembers).set({ lastSeenAt: now })
      .where(and(eq(roomMembers.roomCode, room.code), eq(roomMembers.playerId, player.id)));
  }
  room = await advance(room, now);

  const members = await db.select({
    playerId: roomMembers.playerId, joinedAt: roomMembers.joinedAt, lastSeenAt: roomMembers.lastSeenAt,
    gameId: roomMembers.gameId, name: players.name,
  }).from(roomMembers).innerJoin(players, eq(players.id, roomMembers.playerId))
    .where(eq(roomMembers.roomCode, room.code)).orderBy(asc(roomMembers.joinedAt)).all();

  // Hand the room to someone else if the host has gone quiet.
  const hostHere = members.find((m) => m.playerId === room.hostId && now - m.lastSeenAt < ACTIVE_MS * 2);
  if (!hostHere) {
    const heir = members.find((m) => now - m.lastSeenAt < ACTIVE_MS);
    if (heir && heir.playerId !== room.hostId) {
      await db.update(rooms).set({ hostId: heir.playerId }).where(and(eq(rooms.code, room.code), eq(rooms.hostId, room.hostId)));
      room = { ...room, hostId: heir.playerId };
    }
  }

  const ids = members.map((m) => m.gameId).filter((g): g is string => Boolean(g));
  const gameRows = ids.length ? await db.select().from(games).where(inArray(games.id, ids)).all() : [];
  const roundRows = ids.length ? await db.select().from(rounds).where(inArray(rounds.gameId, ids)).all() : [];
  const showRound = room.status === 'finished' ? ROUNDS : room.phase === 'reveal' ? room.round : room.round - 1;

  const view: RoomMemberView[] = members.map((m) => {
    const game = gameRows.find((g) => g.id === m.gameId);
    const mine = roundRows.filter((r) => r.gameId === m.gameId).sort((a, b) => a.n - b.n);
    const scores = Array.from({ length: ROUNDS }, (_, i) => {
      const r = mine[i];
      return r && r.submittedAt != null && r.n <= showRound ? r.score ?? 0 : null;
    });
    const current = mine.find((r) => r.n === room.round);
    return {
      name: m.name,
      isHost: m.playerId === room.hostId,
      isMe: player?.id === m.playerId,
      connected: now - m.lastSeenAt < ACTIVE_MS,
      playing: Boolean(game),
      total: scores.reduce<number>((s, v) => s + (v ?? 0), 0),
      scores,
      submitted: Boolean(current && current.submittedAt != null),
    };
  });

  let reveal: RoomView['reveal'] = null;
  if (showRound >= 1 && (room.phase === 'reveal' || room.status === 'finished') && room.gameNo > 0) {
    const info = await getMapInfo(roundSeed(room.baseSeed, showRound));
    reveal = {
      round: showRound,
      answer: { x: info.x, z: info.z, bearing: info.bearing },
      guesses: members.filter((m) => m.gameId).map((m) => {
        const r = roundRows.find((x) => x.gameId === m.gameId && x.n === showRound);
        return {
          name: m.name,
          isMe: player?.id === m.playerId,
          guess: r && r.guessX != null && r.guessZ != null && r.guessBearing != null ? { x: r.guessX, z: r.guessZ, bearing: r.guessBearing } : null,
          dist: r?.dist ?? null,
          score: r?.score ?? 0,
        };
      }),
    };
  }

  const meRow = player ? members.find((m) => m.playerId === player.id) : undefined;
  return {
    code: room.code,
    difficulty: room.difficulty as Difficulty,
    status: room.status as RoomView['status'],
    gameNo: room.gameNo,
    round: room.round,
    phase: room.phase as RoomView['phase'],
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
    isHost: player?.id === room.hostId,
    members: view,
    me: meRow
      ? { gameId: meRow.gameId, seeds: meRow.gameId ? Array.from({ length: ROUNDS }, (_, i) => roundSeed(room.baseSeed, i + 1)) : [] }
      : null,
    reveal,
  };
}

import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().unique(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
});

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  /** classic | daily | challenge | room */
  mode: text('mode').notNull(),
  difficulty: text('difficulty').notNull(),
  baseSeed: integer('base_seed').notNull(),
  dailyDate: text('daily_date'),
  challengeOf: text('challenge_of'),
  roomCode: text('room_code'),
  roomGameNo: integer('room_game_no'),
  /** active | finished | abandoned */
  status: text('status').notNull(),
  total: integer('total').notNull().default(0),
  totalTime: real('total_time').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  finishedAt: integer('finished_at'),
});

export const rounds = sqliteTable(
  'rounds',
  {
    gameId: text('game_id').notNull(),
    n: integer('n').notNull(),
    seed: integer('seed').notNull(),
    startedAt: integer('started_at'),
    submittedAt: integer('submitted_at'),
    /** Comma-separated hint ids used this round. */
    hints: text('hints').notNull().default(''),
    guessX: real('guess_x'),
    guessZ: real('guess_z'),
    guessBearing: real('guess_bearing'),
    dist: real('dist'),
    angErr: real('ang_err'),
    timeS: real('time_s'),
    timedOut: integer('timed_out').notNull().default(0),
    /** The true spot, stored at scoring time so results never drift if generation changes. */
    answerX: real('answer_x'),
    answerZ: real('answer_z'),
    answerBearing: real('answer_bearing'),
    scorePos: integer('score_pos'),
    scoreDir: integer('score_dir'),
    scoreTime: integer('score_time'),
    score: integer('score'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.n] })],
);

/** Server-side cache of each seed's answer, so generation runs once per map. */
export const maps = sqliteTable(
  'maps',
  {
    seed: integer('seed').notNull(),
    gen: integer('gen').notNull(),
    token: integer('token').notNull(),
    x: real('x').notNull(),
    z: real('z').notNull(),
    bearing: real('bearing').notNull(),
    groundFt: real('ground_ft').notNull(),
    name: text('name').notNull(),
    character: text('character').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.seed, t.gen] })],
);

export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  hostId: text('host_id').notNull(),
  difficulty: text('difficulty').notNull(),
  /** lobby | playing | finished */
  status: text('status').notNull(),
  gameNo: integer('game_no').notNull().default(0),
  baseSeed: integer('base_seed').notNull(),
  round: integer('round').notNull().default(0),
  /** play | reveal while playing */
  phase: text('phase'),
  phaseStartsAt: integer('phase_starts_at'),
  phaseEndsAt: integer('phase_ends_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const roomMembers = sqliteTable(
  'room_members',
  {
    roomCode: text('room_code').notNull(),
    playerId: text('player_id').notNull(),
    joinedAt: integer('joined_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    gameId: text('game_id'),
  },
  (t) => [primaryKey({ columns: [t.roomCode, t.playerId] })],
);

export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Room = typeof rooms.$inferSelect;

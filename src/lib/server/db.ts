import { mkdirSync } from 'node:fs';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Tables are created on first use, so a fresh checkout runs without a migration step.
// Keep this in step with schema.ts.
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  base_seed INTEGER NOT NULL,
  daily_date TEXT,
  challenge_of TEXT,
  room_code TEXT,
  room_game_no INTEGER,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  total_time REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS games_player ON games (player_id, status, finished_at);
CREATE INDEX IF NOT EXISTS games_board ON games (difficulty, status, total);
CREATE INDEX IF NOT EXISTS games_daily ON games (daily_date, status, total);
CREATE INDEX IF NOT EXISTS games_challenge ON games (challenge_of);
CREATE INDEX IF NOT EXISTS games_room ON games (room_code, room_game_no);
CREATE UNIQUE INDEX IF NOT EXISTS games_daily_once ON games (player_id, daily_date) WHERE daily_date IS NOT NULL;
CREATE TABLE IF NOT EXISTS rounds (
  game_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  started_at INTEGER,
  submitted_at INTEGER,
  hints TEXT NOT NULL DEFAULT '',
  guess_x REAL,
  guess_z REAL,
  guess_bearing REAL,
  dist REAL,
  ang_err REAL,
  time_s REAL,
  timed_out INTEGER NOT NULL DEFAULT 0,
  answer_x REAL,
  answer_z REAL,
  answer_bearing REAL,
  score_pos INTEGER,
  score_dir INTEGER,
  score_time INTEGER,
  score INTEGER,
  PRIMARY KEY (game_id, n)
);
CREATE TABLE IF NOT EXISTS maps (
  seed INTEGER NOT NULL,
  gen INTEGER NOT NULL,
  token INTEGER NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  bearing REAL NOT NULL,
  ground_ft REAL NOT NULL,
  name TEXT NOT NULL,
  character TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (seed, gen)
);
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  status TEXT NOT NULL,
  game_no INTEGER NOT NULL DEFAULT 0,
  base_seed INTEGER NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  phase_starts_at INTEGER,
  phase_ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  game_id TEXT,
  PRIMARY KEY (room_code, player_id)
);
`;

type Db = LibSQLDatabase<typeof schema>;
interface Holder { client: Client; db: Db; ready: Promise<void> }

const g = globalThis as unknown as { __topologioDb?: Holder };

function open(): Holder {
  const remote = process.env.TURSO_DATABASE_URL;
  let url = remote || '';
  if (!remote) {
    mkdirSync('data', { recursive: true });
    url = 'file:data/topologio.db';
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client, { schema });
  const ready = (async () => {
    if (!remote) await client.execute('PRAGMA journal_mode = WAL');
    await client.executeMultiple(BOOTSTRAP);
  })();
  return { client, db, ready };
}

export async function getDb(): Promise<Db> {
  if (!g.__topologioDb) g.__topologioDb = open();
  try {
    await g.__topologioDb.ready;
  } catch (err) {
    g.__topologioDb = undefined;
    throw err;
  }
  return g.__topologioDb.db;
}

export async function getClient(): Promise<Client> {
  await getDb();
  return g.__topologioDb!.client;
}

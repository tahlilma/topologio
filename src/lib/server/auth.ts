import { cookies } from 'next/headers';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { players, type Player } from './schema';
import { HttpError } from './http';

export const KEY_COOKIE = 'topologio_key';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 100-bit player key, shown once so the player can sign in on another device. */
export function newKey() {
  const bytes = randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += ALPHABET[bytes[i] & 31];
  return s.match(/.{4}/g)!.join('-');
}

export const normalizeKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashKey = (k: string) => createHash('sha256').update(normalizeKey(k)).digest('hex');

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') throw new HttpError(400, 'Choose a name.');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 18) throw new HttpError(400, 'Names are 3 to 18 characters long.');
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) throw new HttpError(400, 'Use letters, numbers, spaces, dots, dashes or underscores.');
  return name;
}

export async function currentPlayer(): Promise<Player | null> {
  const jar = await cookies();
  const key = jar.get(KEY_COOKIE)?.value;
  if (!key) return null;
  const db = await getDb();
  const p = await db.select().from(players).where(eq(players.tokenHash, hashKey(key))).get();
  if (!p) return null;
  const now = Date.now();
  if (now - p.lastSeenAt > 5 * 60_000) await db.update(players).set({ lastSeenAt: now }).where(eq(players.id, p.id));
  return p;
}

export async function requirePlayer() {
  const p = await currentPlayer();
  if (!p) throw new HttpError(401, 'Choose a name to play.');
  return p;
}

export async function setKeyCookie(key: string) {
  const jar = await cookies();
  jar.set(KEY_COOKIE, normalizeKey(key), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
  });
}

export async function createPlayer(rawName: unknown) {
  const name = cleanName(rawName);
  const db = await getDb();
  const taken = await db.select({ id: players.id }).from(players).where(eq(players.nameKey, name.toLowerCase())).get();
  if (taken) throw new HttpError(409, 'That name is taken. Try another.');
  const key = newKey();
  const now = Date.now();
  const p: Player = { id: randomUUID(), name, nameKey: name.toLowerCase(), tokenHash: hashKey(key), createdAt: now, lastSeenAt: now };
  try {
    await db.insert(players).values(p);
  } catch {
    throw new HttpError(409, 'That name is taken. Try another.');
  }
  await setKeyCookie(key);
  return { player: p, key };
}

export async function renamePlayer(p: Player, rawName: unknown) {
  const name = cleanName(rawName);
  const db = await getDb();
  const taken = await db.select({ id: players.id }).from(players).where(eq(players.nameKey, name.toLowerCase())).get();
  if (taken && taken.id !== p.id) throw new HttpError(409, 'That name is taken. Try another.');
  await db.update(players).set({ name, nameKey: name.toLowerCase() }).where(eq(players.id, p.id));
  return name;
}

export async function restorePlayer(rawKey: unknown) {
  if (typeof rawKey !== 'string' || normalizeKey(rawKey).length !== 20) throw new HttpError(400, 'Player keys are 20 letters and numbers.');
  const db = await getDb();
  const p = await db.select().from(players).where(eq(players.tokenHash, hashKey(rawKey))).get();
  if (!p) throw new HttpError(404, 'No player has that key. Check it and try again.');
  await setKeyCookie(rawKey);
  return p;
}

/** Issues a new key; the old one stops working on every device. */
export async function rotateKey(p: Player) {
  const key = newKey();
  const db = await getDb();
  await db.update(players).set({ tokenHash: hashKey(key) }).where(eq(players.id, p.id));
  await setKeyCookie(key);
  return key;
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(KEY_COOKIE);
}

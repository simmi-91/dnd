import { createHash, randomBytes } from 'node:crypto';
import { SESSION_COOKIE } from '@dnd/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sesjonen forlenges ved bruk, men databasen skrives høyst én gang i døgnet. */
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionSettings {
  ttlDays: number;
  secure: boolean;
}

function cookieOptions(settings: SessionSettings): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', secure: settings.secure };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  settings: SessionSettings,
): void {
  // Sesjonen er nettopp laget eller forlenget, så den varer i hele TTL-en.
  reply.setCookie(SESSION_COOKIE, token, {
    ...cookieOptions(settings),
    expires: expiresAt,
    maxAge: settings.ttlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, settings: SessionSettings): void {
  reply.clearCookie(SESSION_COOKIE, cookieOptions(settings));
}

/** Lager en sesjon og setter informasjonskapselen. */
export async function startSession(
  db: Db,
  reply: FastifyReply,
  userId: number,
  userAgent: string | undefined,
  settings: SessionSettings,
  now: Date = new Date(),
): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + settings.ttlDays * DAY_MS);
  await db
    .insertInto('dd_auth_sessions')
    .values({
      token_hash: hashToken(token),
      user_id: userId,
      user_agent: userAgent ? userAgent.slice(0, 512) : null,
      created_at: now,
      expires_at: expiresAt,
      last_used_at: now,
    })
    .execute();
  setSessionCookie(reply, token, expiresAt, settings);
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom('dd_auth_sessions').where('token_hash', '=', hashToken(token)).execute();
}

export type SessionLookup =
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'ok'; user: DbUser; sessionId: number; renewedExpiresAt: Date | null };

/**
 * Slår opp sesjonen for et token. Utløpte sesjoner slettes. Er sesjonen ikke brukt
 * det siste døgnet, forlenges den (`renewedExpiresAt` er da satt, og informasjonskapselen
 * bør settes på nytt).
 */
export async function lookupSession(
  db: Db,
  token: string,
  settings: SessionSettings,
  now: Date = new Date(),
): Promise<SessionLookup> {
  const tokenHash = hashToken(token);
  const row = await db
    .selectFrom('dd_auth_sessions as s')
    .innerJoin('dd_users as u', 'u.id', 's.user_id')
    .select([
      's.id as session_id',
      's.expires_at',
      's.last_used_at',
      'u.id',
      'u.google_sub',
      'u.email',
      'u.name',
      'u.avatar_url',
      'u.blocked',
      'u.created_at',
      'u.updated_at',
      'u.last_login_at',
    ])
    .where('s.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) return { status: 'none' };
  if (row.expires_at.getTime() <= now.getTime()) {
    await db.deleteFrom('dd_auth_sessions').where('id', '=', row.session_id).execute();
    return { status: 'expired' };
  }

  let renewedExpiresAt: Date | null = null;
  if (now.getTime() - row.last_used_at.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    renewedExpiresAt = new Date(now.getTime() + settings.ttlDays * DAY_MS);
    await db
      .updateTable('dd_auth_sessions')
      .set({ last_used_at: now, expires_at: renewedExpiresAt })
      .where('id', '=', row.session_id)
      .execute();
  }

  const user: DbUser = {
    id: row.id,
    google_sub: row.google_sub,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
    blocked: row.blocked,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  };
  return { status: 'ok', user, sessionId: row.session_id, renewedExpiresAt };
}

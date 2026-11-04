import { SESSION_COOKIE } from '@dnd/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';
import { sendError } from '../http/errors.ts';
import { clearSessionCookie, lookupSession, setSessionCookie, type SessionSettings } from './session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Satt av `requireAuth` på beskyttede ruter. */
    user: DbUser | null;
  }
}

/**
 * preHandler for ruter som krever innlogging. Sjekker sesjonen og `blocked` på hvert
 * kall, så en sperring virker med en gang.
 */
export function createRequireAuth(db: Db, settings: SessionSettings) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      await sendError(reply, 'unauthorized');
      return;
    }
    const lookup = await lookupSession(db, token, settings);
    if (lookup.status !== 'ok') {
      clearSessionCookie(reply, settings);
      await sendError(reply, 'unauthorized');
      return;
    }
    if (lookup.user.blocked) {
      await sendError(reply, 'blocked');
      return;
    }
    if (lookup.renewedExpiresAt) setSessionCookie(reply, token, lookup.renewedExpiresAt, settings);
    request.user = lookup.user;
  };
}

import { googleLoginRequestSchema, SESSION_COOKIE, type AuthConfig, type MeResponse } from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { classifyGoogleError, type GoogleIdentity, type GoogleVerifier } from '../auth/google.ts';
import { clearSessionCookie, deleteSession, startSession, type SessionSettings } from '../auth/session.ts';
import { AccountConflictError, toApiUser, upsertDevUser, upsertGoogleUser } from '../auth/users.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { sendError } from '../http/errors.ts';

export interface AuthRouteOptions {
  config: Config;
  db: Db;
  settings: SessionSettings;
  verifyGoogleToken: GoogleVerifier | null;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const { config, db, settings, verifyGoogleToken } = opts;

  app.get('/api/auth/config', async (): Promise<AuthConfig> => {
    return { googleClientId: config.googleClientId, devLogin: config.devLoginEmail !== null };
  });

  app.post('/api/auth/google', async (request, reply) => {
    if (!verifyGoogleToken) return sendError(reply, 'google_not_configured');

    const body = googleLoginRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');

    let identity: GoogleIdentity;
    try {
      identity = await verifyGoogleToken(body.data.credential);
    } catch (error) {
      // Bare en fast kategori. Feilmeldingen kan inneholde deler av tokenet.
      request.log.info({ reason: classifyGoogleError(error) }, 'ugyldig Google-token');
      return sendError(reply, 'invalid_token');
    }
    if (!identity.emailVerified) return sendError(reply, 'email_not_verified');

    const now = new Date();
    let user;
    try {
      user = await upsertGoogleUser(db, identity, now);
    } catch (error) {
      if (error instanceof AccountConflictError) return sendError(reply, 'account_conflict');
      throw error;
    }
    if (user.blocked) return sendError(reply, 'blocked');

    await startSession(db, reply, user.id, request.headers['user-agent'], settings, now);
    const response: MeResponse = { user: toApiUser(user) };
    return response;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, token);
    clearSessionCookie(reply, settings);
    return reply.code(204).send();
  });

  // Bare for lokal utvikling. Registreres ikke i produksjon.
  const devLoginEmail = config.devLoginEmail;
  if (devLoginEmail && !config.isProduction) {
    app.get('/api/auth/dev-login', async (request, reply) => {
      const user = await upsertDevUser(db, devLoginEmail, new Date());
      if (user.blocked) return sendError(reply, 'blocked');
      await startSession(db, reply, user.id, request.headers['user-agent'], settings);
      return reply.redirect('/', 302);
    });
  }
}

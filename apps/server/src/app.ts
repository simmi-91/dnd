import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@dnd/shared';
import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createGoogleVerifier, type GoogleVerifier } from './auth/google.ts';
import { createRequireAuth } from './auth/plugin.ts';
import type { SessionSettings } from './auth/session.ts';
import type { Config } from './config.ts';
import { createDb, type Db } from './db/index.ts';
import { createDdbClient, type FetchLike } from './ddb/client.ts';
import { campaignRoutes } from './routes/campaign.ts';
import { combatRoutes } from './routes/combat.ts';
import { gameRoutes } from './routes/games.ts';
import { ERRORS, sendError, type ErrorCode } from './http/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { registerWeb, trySpaFallback } from './web.ts';

export interface AppDeps {
  /** Egen database (tester). Ellers lages en pool fra `config.db`, som stenges med appen. */
  db?: Db;
  /** Verifisering av Google ID-token (byttes ut i tester). Standard bruker google-auth-library. */
  verifyGoogleToken?: GoogleVerifier;
  logger?: FastifyServerOptions['logger'];
  /** `fetch` mot D&D Beyond (byttes ut i tester, som aldri går mot den ekte tjenesten). */
  ddbFetch?: FetchLike;
  /** Klokke for bufferen og grensen per bruker (tester). */
  now?: () => number;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Er dette et API-kall? Stien dekodes, doble skråstreker slås sammen, og store og små
 * bokstaver regnes som like, så `/%61pi/...`, `/API/...` og `//api/...` også er API.
 */
export function isApiPath(url: string): boolean {
  let pathname = url.split('?')[0] ?? '';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Ugyldig prosentkoding: bruk stien som den er.
  }
  pathname = pathname.replace(/[\\/]+/g, '/').toLowerCase();
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Logger uten informasjonskapsler, tokens eller Authorization. */
export function defaultLogger(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.isProduction ? 'info' : 'debug',
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        'req.body.credential',
        'req.body.ddbUrlOrId',
        'req.body.json',
      ],
      censor: '[skjult]',
    },
  };
}

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? defaultLogger(config),
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024,
  });

  const ownsDb = !deps.db;
  const db = deps.db ?? createDb(config.db);
  if (ownsDb) app.addHook('onClose', async () => db.destroy());

  const verifyGoogleToken =
    deps.verifyGoogleToken ?? (config.googleClientId ? createGoogleVerifier(config.googleClientId) : null);
  const settings: SessionSettings = { ttlDays: config.sessionTtlDays, secure: config.isProduction };
  const ddb = createDdbClient({
    fetch: deps.ddbFetch,
    now: deps.now,
    cacheSeconds: config.ddbCacheSeconds,
    fetchesPerHour: config.ddbFetchesPerHour,
  });

  await app.register(fastifyCookie);
  app.decorateRequest('user', null);

  // CSRF-vern: ALLE skrivende kall må ha X-Requested-With: dnd, uansett sti. Ingen unntak.
  const headerName = REQUESTED_WITH_HEADER.toLowerCase();
  app.addHook('onRequest', async (request, reply) => {
    if (!WRITE_METHODS.has(request.method.toUpperCase())) return;
    if (request.headers[headerName] !== REQUESTED_WITH_VALUE) return sendError(reply, 'csrf');
  });

  // API-stier som ikke er skrevet nøyaktig som /api/... (for eksempel /API/..., /%61pi/...
  // eller //api/...) gir JSON 404. De når aldri rutene, den statiske nettsiden eller index.html.
  app.addHook('onRequest', async (request, reply) => {
    const raw = request.url.split('?')[0] ?? '';
    if (isApiPath(raw) && raw !== '/api' && !raw.startsWith('/api/')) return sendError(reply, 'not_found');
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'uventet feil');
      return sendError(reply, 'server_error');
    }
    const code: ErrorCode =
      status === 413
        ? 'payload_too_large'
        : status === 415
          ? 'unsupported_media_type'
          : status === 404
            ? 'not_found'
            : status === 400 || error.validation
              ? 'invalid_request'
              : 'request_error';
    return reply.code(status).send({ error: code, message: ERRORS[code].message });
  });

  app.setNotFoundHandler((request, reply) => {
    if (!isApiPath(request.url)) {
      const fallback = trySpaFallback(request, reply, config.webDir);
      if (fallback) return fallback;
    }
    return sendError(reply, 'not_found');
  });

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, { config, db, settings, verifyGoogleToken });

  // Alt her krever innlogging.
  await app.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', createRequireAuth(db, settings));
    await protectedScope.register(meRoutes);
    await protectedScope.register(gameRoutes, { db, ddb });
    await protectedScope.register(combatRoutes, { db });
    await protectedScope.register(campaignRoutes, { db });
  });

  if (config.webDir) await registerWeb(app, config.webDir);

  return app;
}

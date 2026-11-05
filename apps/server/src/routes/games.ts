import {
  createGameRequestSchema,
  ddbPreviewRequestSchema,
  pasteCharacterRequestSchema,
  putGameStateRequestSchema,
  refreshCharacterRequestSchema,
  updateGameRequestSchema,
  type DdbPreviewResponse,
  type GameDetailResponse,
  type GameStateEnvelope,
  type GamesResponse,
  type RefreshCharacterResponse,
  type StateConflict,
} from '@dnd/shared';
import type { Sheet } from '@dnd/rules';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DdbError, sheetFromRaw, type DdbClient } from '../ddb/client.ts';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';
import {
  applySheet,
  createGame,
  deleteGame,
  gameDdbId,
  gameDetail,
  getState,
  listGames,
  putState,
  updateGame,
} from '../games/repo.ts';
import { ERRORS, PASTE_FORMAT_MESSAGE, sendError } from '../http/errors.ts';

export interface GameRoutesOptions {
  db: Db;
  ddb: DdbClient;
}

/** Innliming kan være stor (rå D&D Beyond-JSON). Paste og opprett får 2 MB, resten 1 MB. */
export const PASTE_BODY_LIMIT = 2 * 1024 * 1024;

const idParams = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .max(2 ** 31),
});

function userOf(request: FastifyRequest): DbUser {
  if (!request.user) throw new Error('requireAuth mangler på ruta');
  return request.user;
}

function gameIdOf(request: FastifyRequest): number | null {
  const parsed = idParams.safeParse(request.params);
  return parsed.success ? parsed.data.id : null;
}

/** Sender feil fra D&D Beyond-modulen med norsk melding. Andre feil kastes videre. */
function sendDdbError(request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply {
  if (!(error instanceof DdbError)) throw error;
  // Fast kategori (og HTTP-status ved ddb_unavailable) i loggen, aldri ID-en eller rådata.
  if (error.code === 'ddb_unavailable') {
    request.log.warn(
      { ddbError: error.code, ddbStatus: error.upstreamStatus ?? 'nettfeil' },
      'henting fra D&D Beyond feilet',
    );
  } else {
    request.log.info({ ddbError: error.code }, 'henting fra D&D Beyond feilet');
  }
  if (error.code === 'ddb_rate_limited') {
    const seconds = error.retryAfterSeconds ?? 3600;
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    reply.header('retry-after', String(seconds));
    return sendError(
      reply,
      'ddb_rate_limited',
      `${ERRORS.ddb_rate_limited.message} Prøv igjen om ${minutes} ${minutes === 1 ? 'minutt' : 'minutter'}.`,
    );
  }
  return sendError(reply, error.code);
}

type Pasted =
  | { ok: true; ddbId: number | null; sheet: Sheet }
  | { ok: false; send: (reply: FastifyReply) => FastifyReply };

/** Tolker innlimt rådata (tekst eller objekt) og regner ut arket. Feil får egne norske meldinger. */
function parsePasted(json: unknown): Pasted {
  let raw = json;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, send: (reply) => sendError(reply, 'paste_invalid_json') };
    }
  }
  try {
    return { ok: true, ...sheetFromRaw(raw) };
  } catch (error) {
    if (error instanceof DdbError) {
      return { ok: false, send: (reply) => sendError(reply, 'ddb_format', PASTE_FORMAT_MESSAGE) };
    }
    throw error;
  }
}

export async function gameRoutes(app: FastifyInstance, opts: GameRoutesOptions): Promise<void> {
  const { db, ddb } = opts;

  async function detailOr404(reply: FastifyReply, userId: number, gameId: number) {
    const detail = await gameDetail(db, userId, gameId);
    if (!detail) return sendError(reply, 'not_found');
    return detail satisfies GameDetailResponse;
  }

  app.post('/api/ddb/preview', async (request, reply) => {
    const user = userOf(request);
    const body = ddbPreviewRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    try {
      const { sheet } = await ddb.fetchCharacter(user.id, body.data.ddbUrlOrId);
      const response: DdbPreviewResponse = {
        character: {
          name: sheet.name,
          summary: sheet.summary,
          level: sheet.level,
          hpMax: sheet.hpMax,
          ac: sheet.ac,
        },
        sheet,
      };
      return response;
    } catch (error) {
      return sendDdbError(request, reply, error);
    }
  });

  app.get('/api/games', async (request) => {
    const response: GamesResponse = { games: await listGames(db, userOf(request).id) };
    return response;
  });

  app.post('/api/games', { bodyLimit: PASTE_BODY_LIMIT }, async (request, reply) => {
    const user = userOf(request);
    const body = createGameRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    let fetched: { ddbId: number; sheet: Sheet };
    if ('json' in body.data) {
      const pasted = parsePasted(body.data.json);
      if (!pasted.ok) return pasted.send(reply);
      // Uten ID i rådataene kan karakteren ikke lagres (unik på D&D Beyond-ID).
      if (pasted.ddbId == null) return sendError(reply, 'ddb_format', PASTE_FORMAT_MESSAGE);
      fetched = { ddbId: pasted.ddbId, sheet: pasted.sheet };
    } else {
      try {
        fetched = await ddb.fetchCharacter(user.id, body.data.ddbUrlOrId);
      } catch (error) {
        return sendDdbError(request, reply, error);
      }
    }
    const gameId = await createGame(db, user.id, {
      name: body.data.name,
      cover: body.data.cover,
      ddbId: fetched.ddbId,
      sheet: fetched.sheet,
    });
    const detail = await detailOr404(reply, user.id, gameId);
    return reply.code(201).send(detail);
  });

  app.get('/api/games/:id', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    return detailOr404(reply, userOf(request).id, gameId);
  });

  app.patch('/api/games/:id', async (request, reply) => {
    const user = userOf(request);
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = updateGameRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const { ddbUrlOrId, ...fields } = body.data;
    const owned = await gameDdbId(db, user.id, gameId);
    if (!owned) return sendError(reply, 'not_found');
    if (ddbUrlOrId !== undefined) {
      try {
        const fetched = await ddb.fetchCharacter(user.id, ddbUrlOrId);
        await applySheet(db, user.id, gameId, { ...fetched, alsoHpAndResources: false });
      } catch (error) {
        return sendDdbError(request, reply, error);
      }
    }
    const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length > 0) await updateGame(db, user.id, gameId, patch);
    return detailOr404(reply, user.id, gameId);
  });

  app.delete('/api/games/:id', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const deleted = await deleteGame(db, userOf(request).id, gameId);
    if (!deleted) return sendError(reply, 'not_found');
    return reply.code(204).send();
  });

  async function refreshResponse(
    reply: FastifyReply,
    userId: number,
    gameId: number,
    result: Awaited<ReturnType<typeof applySheet>>,
  ) {
    if (!result) return sendError(reply, 'not_found');
    const detail = await gameDetail(db, userId, gameId);
    if (!detail) return sendError(reply, 'not_found');
    const response: RefreshCharacterResponse = { ...detail, newFeatures: result.newFeatures };
    return response;
  }

  app.post('/api/games/:id/character/refresh', async (request, reply) => {
    const user = userOf(request);
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = refreshCharacterRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendError(reply, 'invalid_request');
    const owned = await gameDdbId(db, user.id, gameId);
    if (!owned) return sendError(reply, 'not_found');
    if (owned.ddbId == null) {
      return sendError(reply, 'invalid_request', 'Spillet har ingen karakter. Velg en karakter først.');
    }
    let fetched;
    try {
      fetched = await ddb.fetchCharacter(user.id, String(owned.ddbId));
    } catch (error) {
      return sendDdbError(request, reply, error);
    }
    const result = await applySheet(db, user.id, gameId, {
      ...fetched,
      alsoHpAndResources: body.data.alsoHpAndResources,
    });
    return refreshResponse(reply, user.id, gameId, result);
  });

  app.post('/api/games/:id/character/paste', { bodyLimit: PASTE_BODY_LIMIT }, async (request, reply) => {
    const user = userOf(request);
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = pasteCharacterRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const owned = await gameDdbId(db, user.id, gameId);
    if (!owned) return sendError(reply, 'not_found');
    const parsed = parsePasted(body.data.json);
    if (!parsed.ok) return parsed.send(reply);
    // Uten ID i rådataene antas det at det er karakteren som alt er koblet til spillet.
    const ddbId = parsed.ddbId ?? owned.ddbId;
    if (ddbId == null) return sendError(reply, 'ddb_format', PASTE_FORMAT_MESSAGE);
    const result = await applySheet(db, user.id, gameId, {
      ddbId,
      sheet: parsed.sheet,
      alsoHpAndResources: body.data.alsoHpAndResources,
    });
    return refreshResponse(reply, user.id, gameId, result);
  });

  app.get('/api/games/:id/state', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const row = await getState(db, userOf(request).id, gameId);
    if (!row) return sendError(reply, 'not_found');
    const response: GameStateEnvelope = { state: row.state, version: row.version };
    return response;
  });

  app.put('/api/games/:id/state', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = putGameStateRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await putState(db, userOf(request).id, gameId, body.data.state, body.data.version);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'conflict') {
      const conflict: StateConflict = {
        error: 'version_conflict',
        message: ERRORS.version_conflict.message,
        state: result.state,
        version: result.version,
      };
      return reply.code(409).send(conflict);
    }
    const response: GameStateEnvelope = { state: body.data.state, version: result.version };
    return response;
  });
}

import {
  BODY_MAX,
  appendTodayRequestSchema,
  createEntryRequestSchema,
  createSessionRequestSchema,
  entriesQuerySchema,
  searchQuerySchema,
  suggestQuerySchema,
  updateEntryRequestSchemas,
  updateSessionRequestSchema,
  type BodyTooLongError,
  type EntryConflict,
  type EntryDetailResponse,
  type EntriesResponse,
  type SearchResponse,
  type SessionConflict,
  type SessionResponse,
  type SessionsResponse,
  type SuggestResponse,
} from '@dnd/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createEntry, deleteEntry, getEntry, listEntries, updateEntry } from '../campaign/entries.ts';
import { searchGame, suggestEntries } from '../campaign/search.ts';
import {
  appendToday,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from '../campaign/sessions.ts';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';
import { sendError } from '../http/errors.ts';

export interface CampaignRoutesOptions {
  db: Db;
}

export const VERSION_CONFLICT_MESSAGE =
  'Teksten er endret på en annen enhet. Den nyeste versjonen er hentet.';
export const NAME_TAKEN_MESSAGE = 'Det finnes allerede en oppføring med dette navnet.';
export const NUMBER_TAKEN_MESSAGE = 'Det finnes allerede en økt med dette nummeret.';
export const BODY_TOO_LONG_MESSAGE = 'Økta blir for lang. Notatet er ikke lagret.';
export const BAD_FIELDS_MESSAGE = 'Feltene peker på en oppføring som ikke finnes i dette spillet.';

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

function idOf(request: FastifyRequest): number | null {
  const parsed = idParams.safeParse(request.params);
  return parsed.success ? parsed.data.id : null;
}

function bodyTooLong(reply: FastifyReply) {
  const error: BodyTooLongError = {
    error: 'body_too_long',
    message: BODY_TOO_LONG_MESSAGE,
    max: BODY_MAX,
  };
  return reply.code(422).send(error);
}

function entryConflict(reply: FastifyReply, error: EntryConflict['error'], entry: EntryConflict['entry']) {
  const body: EntryConflict = {
    error,
    message: error === 'name_taken' ? NAME_TAKEN_MESSAGE : VERSION_CONFLICT_MESSAGE,
    entry,
  };
  return reply.code(409).send(body);
}

function sessionConflict(
  reply: FastifyReply,
  error: SessionConflict['error'],
  session: SessionConflict['session'],
) {
  const body: SessionConflict = {
    error,
    message: error === 'number_taken' ? NUMBER_TAKEN_MESSAGE : VERSION_CONFLICT_MESSAGE,
    session,
  };
  return reply.code(409).send(body);
}

/** Dagbok, oppslagsverk, søk og autofullføring (5.1). */
export async function campaignRoutes(app: FastifyInstance, opts: CampaignRoutesOptions): Promise<void> {
  const { db } = opts;

  // ---------- Dagbok ----------

  app.get('/api/games/:id/sessions', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const sessions = await listSessions(db, userOf(request).id, gameId);
    if (!sessions) return sendError(reply, 'not_found');
    return { sessions } satisfies SessionsResponse;
  });

  app.post('/api/games/:id/sessions', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = createSessionRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await createSession(db, userOf(request).id, gameId, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'body_too_long') return bodyTooLong(reply);
    if (result.kind === 'number_taken') return sessionConflict(reply, 'number_taken', result.session);
    if (result.kind !== 'ok') return sendError(reply, 'server_error');
    return reply.code(201).send(result.value);
  });

  app.post('/api/games/:id/sessions/today/append', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = appendTodayRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await appendToday(db, userOf(request).id, gameId, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'body_too_long') return bodyTooLong(reply);
    if (result.kind !== 'ok') return sendError(reply, 'server_error');
    return result.value;
  });

  app.get('/api/sessions/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    const session = await getSession(db, userOf(request).id, id);
    if (!session) return sendError(reply, 'not_found');
    return { session } satisfies SessionResponse;
  });

  app.put('/api/sessions/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    const body = updateSessionRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await updateSession(db, userOf(request).id, id, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'body_too_long') return bodyTooLong(reply);
    if (result.kind === 'version_conflict') return sessionConflict(reply, 'version_conflict', result.session);
    if (result.kind === 'number_taken') return sessionConflict(reply, 'number_taken', result.session);
    if (result.kind !== 'ok') return sendError(reply, 'server_error');
    return result.value;
  });

  app.delete('/api/sessions/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    if (!(await deleteSession(db, userOf(request).id, id))) return sendError(reply, 'not_found');
    return reply.code(204).send();
  });

  // ---------- Oppslagsverk ----------

  app.get('/api/games/:id/entries', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const query = entriesQuerySchema.safeParse(request.query);
    if (!query.success) return sendError(reply, 'invalid_request');
    const result = await listEntries(db, userOf(request).id, gameId, query.data);
    if (!result) return sendError(reply, 'not_found');
    return result satisfies EntriesResponse;
  });

  app.get('/api/games/:id/entries/suggest', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const query = suggestQuerySchema.safeParse(request.query);
    if (!query.success) return sendError(reply, 'invalid_request');
    const suggestions = await suggestEntries(db, userOf(request).id, gameId, query.data.kind, query.data.q);
    if (!suggestions) return sendError(reply, 'not_found');
    return { suggestions } satisfies SuggestResponse;
  });

  app.post('/api/games/:id/entries', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = createEntryRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await createEntry(db, userOf(request).id, gameId, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'conflict') return entryConflict(reply, result.error, result.entry);
    if (result.kind === 'bad_fields') return sendError(reply, 'invalid_request', BAD_FIELDS_MESSAGE);
    if (result.kind === 'body_too_long') return bodyTooLong(reply);
    if (result.kind !== 'ok') return sendError(reply, 'server_error');
    return reply.code(201).send(result.value);
  });

  app.get('/api/entries/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    const detail = await getEntry(db, userOf(request).id, id);
    if (!detail) return sendError(reply, 'not_found');
    return detail satisfies EntryDetailResponse;
  });

  app.put('/api/entries/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    const result = await updateEntry(db, userOf(request).id, id, (row) => {
      const parsed = updateEntryRequestSchemas[row.kind].safeParse(request.body);
      return parsed.success ? parsed.data : undefined;
    });
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'invalid') return sendError(reply, 'invalid_request');
    if (result.kind === 'body_too_long') return bodyTooLong(reply);
    if (result.kind === 'conflict') return entryConflict(reply, result.error, result.entry);
    if (result.kind === 'bad_fields') return sendError(reply, 'invalid_request', BAD_FIELDS_MESSAGE);
    return result.value;
  });

  app.delete('/api/entries/:id', async (request, reply) => {
    const id = idOf(request);
    if (id == null) return sendError(reply, 'not_found');
    if (!(await deleteEntry(db, userOf(request).id, id))) return sendError(reply, 'not_found');
    return reply.code(204).send();
  });

  // ---------- Søk ----------

  app.get('/api/games/:id/search', async (request, reply) => {
    const gameId = idOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const query = searchQuerySchema.safeParse(request.query);
    let q: string;
    if (query.success) {
      q = query.data.q;
    } else {
      // Manglende eller tom `q` gir tomt svar; for lang `q` er en ugyldig forespørsel.
      const raw = (request.query as { q?: unknown } | null)?.q;
      if (raw !== undefined && typeof raw !== 'string') return sendError(reply, 'invalid_request');
      if (typeof raw === 'string' && raw.trim() !== '') return sendError(reply, 'invalid_request');
      q = '';
    }
    const result = await searchGame(db, userOf(request).id, gameId, q);
    if (!result) return sendError(reply, 'not_found');
    return result satisfies SearchResponse;
  });
}

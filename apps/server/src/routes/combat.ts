import {
  endCombatRequestSchema,
  putCombatRequestSchema,
  startCombatRequestSchema,
  type CombatConflict,
  type CombatEnvelope,
  type CombatResponse,
  type EndCombatResponse,
} from '@dnd/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { endCombat, getActiveCombat, putCombat, startCombat } from '../combats/repo.ts';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';
import { ERRORS, sendError } from '../http/errors.ts';

export interface CombatRoutesOptions {
  db: Db;
}

/** Melding ved 409 når kampen er avsluttet eller byttet ut på en annen enhet. */
export const COMBAT_GONE_MESSAGE = 'Kampen er avsluttet på en annen enhet.';
export const COMBAT_CONFLICT_MESSAGE = 'Kampen er endret på en annen enhet. Den nyeste versjonen er hentet.';

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

/** Aktiv kamp (5.1 og 5.3): hent, start, lagre med versjon og avslutt. */
export async function combatRoutes(app: FastifyInstance, opts: CombatRoutesOptions): Promise<void> {
  const { db } = opts;

  app.get('/api/games/:id/combat', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const combat = await getActiveCombat(db, userOf(request).id, gameId);
    if (combat === undefined) return sendError(reply, 'not_found');
    const response: CombatResponse = { combat };
    return response;
  });

  app.post('/api/games/:id/combat', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = startCombatRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await startCombat(db, userOf(request).id, gameId, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'no_character') {
      return sendError(reply, 'invalid_request', 'Spillet har ingen karakter. Velg en karakter først.');
    }
    if (result.kind === 'exists') {
      const conflict: CombatConflict = {
        error: 'combat_exists',
        message: ERRORS.combat_exists.message,
        combat: result.combat,
      };
      return reply.code(409).send(conflict);
    }
    return reply.code(201).send(result.combat satisfies CombatEnvelope);
  });

  app.put('/api/games/:id/combat', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = putCombatRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await putCombat(db, userOf(request).id, gameId, body.data);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    if (result.kind === 'conflict') {
      const same = result.combat?.id === body.data.id;
      const conflict: CombatConflict = {
        error: 'version_conflict',
        message: same ? COMBAT_CONFLICT_MESSAGE : COMBAT_GONE_MESSAGE,
        combat: result.combat,
      };
      return reply.code(409).send(conflict);
    }
    return result.combat satisfies CombatEnvelope;
  });

  app.post('/api/games/:id/combat/end', async (request, reply) => {
    const gameId = gameIdOf(request);
    if (gameId == null) return sendError(reply, 'not_found');
    const body = endCombatRequestSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, 'invalid_request');
    const result = await endCombat(db, userOf(request).id, gameId, body.data.id);
    if (result.kind === 'not_found') return sendError(reply, 'not_found');
    const response: EndCombatResponse = { combat: result.combat, state: result.state };
    return response;
  });
}

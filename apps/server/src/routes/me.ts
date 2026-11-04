import type { MeResponse } from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { toApiUser } from '../auth/users.ts';
import { sendError } from '../http/errors.ts';

/** Ruter som krever innlogging. Registreres i et scope med `requireAuth`. */
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', async (request, reply) => {
    if (!request.user) return sendError(reply, 'unauthorized');
    const response: MeResponse = { user: toApiUser(request.user) };
    return response;
  });
}

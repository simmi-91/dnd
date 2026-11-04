import type { HealthResponse } from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Db } from '../db/index.ts';

export async function healthRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  app.get('/api/health', async (request, reply) => {
    let db = false;
    try {
      await sql`SELECT 1`.execute(opts.db);
      db = true;
    } catch (error) {
      request.log.warn(
        { reason: error instanceof Error ? error.message : 'ukjent' },
        'helsesjekk: databasen svarer ikke',
      );
    }
    const body: HealthResponse = { ok: db, db };
    return reply.code(db ? 200 : 503).send(body);
  });
}

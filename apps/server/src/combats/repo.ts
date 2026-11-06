// Databasearbeid for kamp (`dd_combats`, fase 3b). Alle oppslag går via spillet, som filtrerer på eieren.
// Maks én aktiv kamp per spill: start og slutt låser spillraden, så to enheter ikke kan starte samtidig.
import { combatFromGame, conditionsToGame, endCombat as endCombatState, type CombatState } from '@dnd/rules';
import type { CombatEnvelope, GameStateEnvelope } from '@dnd/shared';
import type { Transaction } from 'kysely';
import type { Db } from '../db/index.ts';
import type { Database, DbCombat } from '../db/types.ts';
import { findGame } from '../games/repo.ts';

type Tx = Transaction<Database>;
type Conn = Db | Tx;

export function toApiCombat(c: DbCombat): CombatEnvelope {
  return {
    id: c.id,
    status: c.status,
    round: c.round,
    state: c.state,
    version: c.version,
    startedAt: c.started_at.toISOString(),
    endedAt: c.ended_at ? c.ended_at.toISOString() : null,
  };
}

async function readActive(db: Conn, gameId: number, lock = false): Promise<DbCombat | undefined> {
  let q = db
    .selectFrom('dd_combats')
    .selectAll()
    .where('game_id', '=', gameId)
    .where('status', '=', 'active')
    .orderBy('id', 'desc');
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

async function readCombat(db: Conn, gameId: number, combatId: number): Promise<DbCombat | undefined> {
  return db
    .selectFrom('dd_combats')
    .selectAll()
    .where('id', '=', combatId)
    .where('game_id', '=', gameId)
    .executeTakeFirst();
}

/** Låser spillraden til eieren. Undefined hvis brukeren ikke eier spillet. */
async function lockGame(trx: Tx, userId: number, gameId: number) {
  return trx
    .selectFrom('dd_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

/** Kampen som pågår (null hvis ingen), eller undefined hvis brukeren ikke eier spillet. */
export async function getActiveCombat(
  db: Db,
  userId: number,
  gameId: number,
): Promise<CombatEnvelope | null | undefined> {
  const game = await findGame(db, userId, gameId);
  if (!game) return undefined;
  const row = await readActive(db, gameId);
  return row ? toApiCombat(row) : null;
}

export type StartCombatResult =
  | { kind: 'ok'; combat: CombatEnvelope }
  | { kind: 'exists'; combat: CombatEnvelope }
  | { kind: 'no_character' }
  | { kind: 'not_found' };

/** Starter en ny kamp med oppsett fra arket og spilltilstanden (`combatFromGame`). */
export async function startCombat(
  db: Db,
  userId: number,
  gameId: number,
  opts: { excludeCompanions?: string[] },
): Promise<StartCombatResult> {
  return db.transaction().execute(async (trx) => {
    const game = await lockGame(trx, userId, gameId);
    if (!game) return { kind: 'not_found' };
    const existing = await readActive(trx, gameId);
    if (existing) return { kind: 'exists', combat: toApiCombat(existing) };
    if (game.character_id == null) return { kind: 'no_character' };
    const character = await trx
      .selectFrom('dd_characters')
      .select('derived')
      .where('id', '=', game.character_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    const gameState = await trx
      .selectFrom('dd_game_state')
      .select('state')
      .where('game_id', '=', gameId)
      .executeTakeFirst();
    if (!character || !gameState) return { kind: 'no_character' };
    const state = combatFromGame(character.derived, gameState.state, {
      excludeCompanions: opts.excludeCompanions,
    });
    const res = await trx
      .insertInto('dd_combats')
      .values({
        game_id: gameId,
        status: 'active',
        round: state.round,
        state: JSON.stringify(state),
        version: 1,
      })
      .executeTakeFirstOrThrow();
    const row = await readCombat(trx, gameId, Number(res.insertId));
    if (!row) throw new Error('kampen forsvant rett etter at den ble lagret');
    return { kind: 'ok', combat: toApiCombat(row) };
  });
}

export type PutCombatResult =
  | { kind: 'ok'; combat: CombatEnvelope }
  | { kind: 'conflict'; combat: CombatEnvelope | null }
  | { kind: 'not_found' };

/**
 * Skriver kampen bare hvis den fortsatt pågår og versjonen er den klienten bygde på (5.3). Ellers
 * 409 med kampen som pågår nå (null hvis den er avsluttet).
 */
export async function putCombat(
  db: Db,
  userId: number,
  gameId: number,
  input: { id: number; state: CombatState; version: number },
): Promise<PutCombatResult> {
  const game = await findGame(db, userId, gameId);
  if (!game) return { kind: 'not_found' };
  // Raden er låst fra UPDATE til commit, så svaret er det som ble skrevet, ikke en senere skriving.
  return db.transaction().execute(async (trx): Promise<PutCombatResult> => {
    const res = await trx
      .updateTable('dd_combats')
      .set((eb) => ({
        state: JSON.stringify(input.state),
        round: input.state.round,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', input.id)
      .where('game_id', '=', gameId)
      .where('status', '=', 'active')
      .where('version', '=', input.version)
      .executeTakeFirst();
    if (res.numUpdatedRows > 0n) {
      const row = await readCombat(trx, gameId, input.id);
      if (row) return { kind: 'ok', combat: toApiCombat(row) };
    }
    const active = await readActive(trx, gameId);
    return { kind: 'conflict', combat: active ? toApiCombat(active) : null };
  });
}

export type EndCombatResult =
  { kind: 'ok'; combat: CombatEnvelope; state: GameStateEnvelope } | { kind: 'not_found' };

/**
 * Avslutter kampen med tilstanden som er lagret, og skriver conditions og exhaustion på karakteren
 * tilbake til spilltilstanden (`conditionsToGame`). Er kampen alt avsluttet (f.eks. fra en annen
 * enhet), svarer den med det som er lagret, uten å skrive noe.
 */
export async function endCombat(
  db: Db,
  userId: number,
  gameId: number,
  combatId: number,
): Promise<EndCombatResult> {
  return db.transaction().execute(async (trx) => {
    const game = await lockGame(trx, userId, gameId);
    if (!game) return { kind: 'not_found' };
    const combat = await trx
      .selectFrom('dd_combats')
      .selectAll()
      .where('id', '=', combatId)
      .where('game_id', '=', gameId)
      .forUpdate()
      .executeTakeFirst();
    if (!combat) return { kind: 'not_found' };
    const gs = await trx
      .selectFrom('dd_game_state')
      .select(['state', 'version'])
      .where('game_id', '=', gameId)
      .forUpdate()
      .executeTakeFirst();
    if (!gs) return { kind: 'not_found' };
    if (combat.status === 'ended') {
      return { kind: 'ok', combat: toApiCombat(combat), state: { state: gs.state, version: gs.version } };
    }

    const ended = endCombatState(combat.state);
    await trx
      .updateTable('dd_combats')
      .set((eb) => ({
        status: 'ended',
        ended_at: new Date(),
        state: JSON.stringify(ended),
        round: ended.round,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', combatId)
      .execute();
    const gameState = conditionsToGame(gs.state, combat.state);
    await trx
      .updateTable('dd_game_state')
      .set({ state: JSON.stringify(gameState), version: gs.version + 1 })
      .where('game_id', '=', gameId)
      .execute();
    const row = await readCombat(trx, gameId, combatId);
    if (!row) throw new Error('kampen forsvant mens den ble avsluttet');
    return {
      kind: 'ok',
      combat: toApiCombat(row),
      state: { state: gameState, version: gs.version + 1 },
    };
  });
}

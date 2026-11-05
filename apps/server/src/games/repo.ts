// Databasearbeid for spill, karakterer og spilltilstand. Alle oppslag filtrerer på eieren.
import {
  DERIVE_VERSION,
  initialGameState,
  mergeOnRefresh,
  newFeatures,
  type Feature,
  type GameState,
  type Sheet,
} from '@dnd/rules';
import type { Game, GameCharacter, GameCover, GameDetailResponse, GameStatus } from '@dnd/shared';
import type { Transaction } from 'kysely';
import type { Db } from '../db/index.ts';
import type { Database, DbCharacter, DbGame } from '../db/types.ts';

type Tx = Transaction<Database>;
type Conn = Db | Tx;

function iso(d: Date): string {
  return d.toISOString();
}

export function toApiCharacter(c: DbCharacter): GameCharacter {
  const s = c.derived;
  return {
    id: c.id,
    name: c.name,
    summary: c.summary,
    level: s.level,
    hpMax: s.hpMax,
    ac: s.ac,
    importedAt: iso(c.imported_at),
    deriveVersion: c.derive_version,
    outdated: c.derive_version < DERIVE_VERSION,
  };
}

export function toApiGame(g: DbGame, c: DbCharacter | null | undefined): Game {
  return {
    id: g.id,
    name: g.name,
    status: g.status,
    cover: g.cover,
    character: c ? toApiCharacter(c) : null,
    createdAt: iso(g.created_at),
    updatedAt: iso(g.updated_at),
  };
}

export async function findGame(db: Conn, userId: number, gameId: number): Promise<DbGame | undefined> {
  return db
    .selectFrom('dd_games')
    .selectAll()
    .where('id', '=', gameId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

async function findCharacter(db: Conn, userId: number, id: number | null): Promise<DbCharacter | undefined> {
  if (id == null) return undefined;
  return db
    .selectFrom('dd_characters')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

async function readState(db: Conn, gameId: number, lock = false) {
  let q = db.selectFrom('dd_game_state').select(['state', 'version']).where('game_id', '=', gameId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

export async function listGames(db: Db, userId: number): Promise<Game[]> {
  const games = await db
    .selectFrom('dd_games')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('status', 'asc')
    .orderBy('updated_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const ids = [...new Set(games.map((g) => g.character_id).filter((id): id is number => id != null))];
  const chars = ids.length
    ? await db
        .selectFrom('dd_characters')
        .selectAll()
        .where('user_id', '=', userId)
        .where('id', 'in', ids)
        .execute()
    : [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  return games.map((g) => toApiGame(g, g.character_id == null ? null : byId.get(g.character_id)));
}

/** Spillet med ark og tilstand, eller undefined hvis brukeren ikke eier det. */
export async function gameDetail(
  db: Conn,
  userId: number,
  gameId: number,
): Promise<GameDetailResponse | undefined> {
  const game = await findGame(db, userId, gameId);
  if (!game) return undefined;
  const character = await findCharacter(db, userId, game.character_id);
  const state = await readState(db, gameId);
  if (!state) return undefined;
  return {
    game: toApiGame(game, character),
    sheet: character?.derived ?? null,
    state: { state: state.state, version: state.version },
  };
}

/** Lagrer eller oppdaterer karakterraden (unik på bruker og D&D Beyond-ID). Gir ID-en. */
async function upsertCharacter(trx: Tx, userId: number, ddbId: number, sheet: Sheet): Promise<number> {
  const values = {
    name: sheet.name.slice(0, 255) || 'Uten navn',
    summary: sheet.summary.slice(0, 255),
    derived: JSON.stringify(sheet),
    derive_version: DERIVE_VERSION,
    imported_at: new Date(),
  };
  await trx
    .insertInto('dd_characters')
    .values({ user_id: userId, ddb_id: ddbId, ...values })
    .onDuplicateKeyUpdate(values)
    .execute();
  const row = await trx
    .selectFrom('dd_characters')
    .select('id')
    .where('user_id', '=', userId)
    .where('ddb_id', '=', ddbId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Sletter karakterraden når ingen spill lenger bruker den. */
async function deleteCharacterIfUnused(trx: Tx, userId: number, characterId: number | null): Promise<void> {
  if (characterId == null) return;
  const used = await trx
    .selectFrom('dd_games')
    .select('id')
    .where('character_id', '=', characterId)
    .executeTakeFirst();
  if (used) return;
  await trx.deleteFrom('dd_characters').where('id', '=', characterId).where('user_id', '=', userId).execute();
}

export async function createGame(
  db: Db,
  userId: number,
  input: { name: string; cover?: GameCover; ddbId: number; sheet: Sheet },
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const characterId = await upsertCharacter(trx, userId, input.ddbId, input.sheet);
    const res = await trx
      .insertInto('dd_games')
      .values({ user_id: userId, name: input.name, cover: input.cover, character_id: characterId })
      .executeTakeFirstOrThrow();
    const gameId = Number(res.insertId);
    await trx
      .insertInto('dd_game_state')
      .values({ game_id: gameId, state: JSON.stringify(initialGameState(input.sheet)), version: 1 })
      .execute();
    return gameId;
  });
}

export async function updateGame(
  db: Db,
  userId: number,
  gameId: number,
  patch: { name?: string; status?: GameStatus; cover?: GameCover },
): Promise<boolean> {
  const res = await db
    .updateTable('dd_games')
    .set(patch)
    .where('id', '=', gameId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  // mysql2 bruker FOUND_ROWS, så treff teller selv om verdiene er like.
  return res.numUpdatedRows > 0n;
}

export async function deleteGame(db: Db, userId: number, gameId: number): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const game = await findGame(trx, userId, gameId);
    if (!game) return false;
    await trx.deleteFrom('dd_game_state').where('game_id', '=', gameId).execute();
    await trx.deleteFrom('dd_games').where('id', '=', gameId).where('user_id', '=', userId).execute();
    await deleteCharacterIfUnused(trx, userId, game.character_id);
    return true;
  });
}

/**
 * Kobler et nytt ark til spillet (refresh, lim inn eller bytt karakter). Er det samme karakter
 * som før, flettes tilstanden med `mergeOnRefresh`, og nye evner regnes ut. Er det en annen
 * karakter, starter tilstanden på nytt, og den gamle karakterraden slettes hvis ingen bruker den.
 */
export async function applySheet(
  db: Db,
  userId: number,
  gameId: number,
  input: { ddbId: number; sheet: Sheet; alsoHpAndResources: boolean },
): Promise<{ newFeatures: Feature[] } | undefined> {
  return db.transaction().execute(async (trx) => {
    const game = await trx
      .selectFrom('dd_games')
      .selectAll()
      .where('id', '=', gameId)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!game) return undefined;
    const old = await findCharacter(trx, userId, game.character_id);
    const prev = await readState(trx, gameId, true);
    const characterId = await upsertCharacter(trx, userId, input.ddbId, input.sheet);
    const same = old != null && old.id === characterId;
    const state: GameState =
      same && prev
        ? mergeOnRefresh(prev.state, input.sheet, { alsoHpAndResources: input.alsoHpAndResources })
        : initialGameState(input.sheet);
    if (prev) {
      await trx
        .updateTable('dd_game_state')
        .set((eb) => ({ state: JSON.stringify(state), version: eb('version', '+', 1) }))
        .where('game_id', '=', gameId)
        .execute();
    } else {
      await trx
        .insertInto('dd_game_state')
        .values({ game_id: gameId, state: JSON.stringify(state), version: 1 })
        .execute();
    }
    // Rør `updated_at` på spillet, så det havner øverst i «Mine spill».
    await trx
      .updateTable('dd_games')
      .set({ character_id: characterId, updated_at: new Date() })
      .where('id', '=', gameId)
      .execute();
    if (!same) await deleteCharacterIfUnused(trx, userId, old?.id ?? null);
    return { newFeatures: same ? newFeatures(old.derived, input.sheet) : [] };
  });
}

/** D&D Beyond-ID-en til karakteren i spillet. */
export async function gameDdbId(db: Db, userId: number, gameId: number) {
  const game = await findGame(db, userId, gameId);
  if (!game) return undefined;
  const c = await findCharacter(db, userId, game.character_id);
  return { game, ddbId: c?.ddb_id ?? null };
}

export async function getState(db: Db, userId: number, gameId: number) {
  const game = await findGame(db, userId, gameId);
  if (!game) return undefined;
  return readState(db, gameId);
}

export type PutStateResult =
  | { kind: 'ok'; version: number }
  | { kind: 'conflict'; state: GameState; version: number }
  | { kind: 'not_found' };

/** Skriver tilstanden bare hvis versjonen er den klienten bygde på (5.3). */
export async function putState(
  db: Db,
  userId: number,
  gameId: number,
  state: GameState,
  version: number,
): Promise<PutStateResult> {
  const game = await findGame(db, userId, gameId);
  if (!game) return { kind: 'not_found' };
  const res = await db
    .updateTable('dd_game_state')
    .set((eb) => ({ state: JSON.stringify(state), version: eb('version', '+', 1) }))
    .where('game_id', '=', gameId)
    .where('version', '=', version)
    .executeTakeFirst();
  if (res.numUpdatedRows > 0n) return { kind: 'ok', version: version + 1 };
  const current = await readState(db, gameId);
  if (!current) return { kind: 'not_found' };
  return { kind: 'conflict', state: current.state, version: current.version };
}

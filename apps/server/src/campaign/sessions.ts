// Dagboka (`dd_sessions`, fase 4b). Alle oppslag går via spillet, som filtrerer på eieren.
import {
  BODY_MAX,
  stripMentions,
  type CreateSessionInput,
  type Session,
  type SessionListItem,
  type SessionSaveResponse,
  type UpdateSessionRequest,
} from '@dnd/shared';
import { sql } from 'kysely';
import type { Db } from '../db/index.ts';
import type { DbSession } from '../db/types.ts';
import { findGame } from '../games/repo.ts';
import { dateOnly, toApiEntryListItem, toApiSession } from './convert.ts';
import {
  BodyTooLong,
  catchBodyTooLong,
  deleteMentionsFrom,
  lockGame,
  processText,
  rebuildMentions,
  type Tx,
} from './text.ts';

const EXCERPT_LENGTH = 200;

/** Starten av teksten uten koblingsformat og med linjeskift som mellomrom. */
export function excerptOf(body: string): string {
  const plain = stripMentions(body).replace(/\s+/g, ' ').trim();
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH).trimEnd()}…` : plain;
}

export type SessionResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not_found' }
  | { kind: 'version_conflict'; session: Session }
  | { kind: 'number_taken'; session: Session }
  | { kind: 'body_too_long' };

async function readSession(trx: Tx | Db, gameId: number, id: number): Promise<DbSession | undefined> {
  return trx
    .selectFrom('dd_sessions')
    .selectAll()
    .where('id', '=', id)
    .where('game_id', '=', gameId)
    .executeTakeFirst();
}

/** Spillet økta hører til, hvis brukeren eier det. */
async function ownedSession(db: Db | Tx, userId: number, id: number) {
  return db
    .selectFrom('dd_sessions as s')
    .innerJoin('dd_games as g', 'g.id', 's.game_id')
    .select('s.game_id')
    .where('s.id', '=', id)
    .where('g.user_id', '=', userId)
    .executeTakeFirst();
}

export async function getSession(db: Db, userId: number, id: number): Promise<Session | undefined> {
  const owned = await ownedSession(db, userId, id);
  if (!owned) return undefined;
  const row = await readSession(db, owned.game_id, id);
  return row ? toApiSession(row) : undefined;
}

export async function listSessions(
  db: Db,
  userId: number,
  gameId: number,
): Promise<SessionListItem[] | undefined> {
  if (!(await findGame(db, userId, gameId))) return undefined;
  const rows = await db
    .selectFrom('dd_sessions')
    .select([
      'id',
      'number',
      'played_on',
      'title',
      'updated_at',
      sql<string>`substr(body, 1, ${EXCERPT_LENGTH * 4})`.as('head'),
    ])
    .where('game_id', '=', gameId)
    .orderBy('played_on', 'desc')
    .orderBy('number', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    playedOn: dateOnly(r.played_on),
    title: r.title,
    excerpt: excerptOf(r.head),
    updatedAt: r.updated_at.toISOString(),
  }));
}

async function nextNumber(trx: Tx, gameId: number): Promise<number> {
  const row = await trx
    .selectFrom('dd_sessions')
    .select((eb) => eb.fn.max('number').as('max'))
    .where('game_id', '=', gameId)
    .executeTakeFirst();
  return Number(row?.max ?? 0) + 1;
}

async function numberOwner(trx: Tx, gameId: number, number: number, exceptId?: number) {
  let q = trx
    .selectFrom('dd_sessions')
    .selectAll()
    .where('game_id', '=', gameId)
    .where('number', '=', number);
  if (exceptId !== undefined) q = q.where('id', '!=', exceptId);
  return q.executeTakeFirst();
}

async function createSessionTx(
  db: Db,
  userId: number,
  gameId: number,
  input: CreateSessionInput,
): Promise<SessionResult<SessionSaveResponse>> {
  return db.transaction().execute(async (trx): Promise<SessionResult<SessionSaveResponse>> => {
    if (!(await lockGame(trx, userId, gameId))) return { kind: 'not_found' };
    let number = input.number;
    if (number === undefined) {
      number = await nextNumber(trx, gameId);
    } else {
      const taken = await numberOwner(trx, gameId, number);
      if (taken) return { kind: 'number_taken', session: toApiSession(taken) };
    }
    const processed = await processText(trx, gameId, input.body);
    const res = await trx
      .insertInto('dd_sessions')
      .values({
        game_id: gameId,
        number,
        played_on: input.playedOn,
        title: input.title,
        body: processed.text,
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    await rebuildMentions(trx, 'session', id, processed.entryIds);
    const row = await readSession(trx, gameId, id);
    if (!row) throw new Error('økta forsvant rett etter at den ble lagret');
    return {
      kind: 'ok',
      value: { session: toApiSession(row), createdEntries: processed.created.map(toApiEntryListItem) },
    };
  });
}

async function updateSessionTx(
  db: Db,
  userId: number,
  id: number,
  input: UpdateSessionRequest,
): Promise<SessionResult<SessionSaveResponse>> {
  const owned = await ownedSession(db, userId, id);
  if (!owned) return { kind: 'not_found' };
  const gameId = owned.game_id;
  return db.transaction().execute(async (trx): Promise<SessionResult<SessionSaveResponse>> => {
    if (!(await lockGame(trx, userId, gameId))) return { kind: 'not_found' };
    const current = await readSession(trx, gameId, id);
    if (!current) return { kind: 'not_found' };
    if (current.version !== input.version) {
      return { kind: 'version_conflict', session: toApiSession(current) };
    }
    const number = input.number ?? current.number;
    if (number !== current.number) {
      const taken = await numberOwner(trx, gameId, number, id);
      if (taken) return { kind: 'number_taken', session: toApiSession(taken) };
    }
    const processed = await processText(trx, gameId, input.body);
    const res = await trx
      .updateTable('dd_sessions')
      .set((eb) => ({
        number,
        played_on: input.playedOn,
        title: input.title,
        body: processed.text,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', id)
      .where('game_id', '=', gameId)
      .where('version', '=', input.version)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new Error('økta ble endret under en låst transaksjon');
    await rebuildMentions(trx, 'session', id, processed.entryIds);
    const row = await readSession(trx, gameId, id);
    if (!row) throw new Error('økta forsvant rett etter at den ble lagret');
    return {
      kind: 'ok',
      value: { session: toApiSession(row), createdEntries: processed.created.map(toApiEntryListItem) },
    };
  });
}

export async function deleteSession(db: Db, userId: number, id: number): Promise<boolean> {
  const owned = await ownedSession(db, userId, id);
  if (!owned) return false;
  return db.transaction().execute(async (trx) => {
    if (!(await lockGame(trx, userId, owned.game_id))) return false;
    const res = await trx
      .deleteFrom('dd_sessions')
      .where('id', '=', id)
      .where('game_id', '=', owned.game_id)
      .executeTakeFirst();
    if (res.numDeletedRows === 0n) return false;
    await deleteMentionsFrom(trx, 'session', id);
    return true;
  });
}

/** Hurtignotatet: legger teksten nederst i den siste økta med datoen, eller lager en ny. */
export async function appendToday(
  db: Db,
  userId: number,
  gameId: number,
  input: { text: string; playedOn: string },
): Promise<SessionResult<SessionSaveResponse>> {
  try {
    return await db.transaction().execute(async (trx): Promise<SessionResult<SessionSaveResponse>> => {
      if (!(await lockGame(trx, userId, gameId))) return { kind: 'not_found' };
      const existing = await trx
        .selectFrom('dd_sessions')
        .selectAll()
        .where('game_id', '=', gameId)
        .where(sql<boolean>`played_on = ${input.playedOn}`)
        .orderBy('number', 'desc')
        .limit(1)
        .executeTakeFirst();
      const processed = await processText(trx, gameId, input.text);
      let id: number;
      if (existing) {
        id = existing.id;
        const body =
          existing.body === '' ? processed.text : `${existing.body.replace(/\n+$/, '')}\n${processed.text}`;
        if (body.length > BODY_MAX) throw new BodyTooLong();
        await trx
          .updateTable('dd_sessions')
          .set((eb) => ({ body, version: eb('version', '+', 1) }))
          .where('id', '=', id)
          .execute();
        // Koblingene fra før står i `dd_mentions`; legg til de nye uten å tolke hele teksten på nytt.
        const have = await trx
          .selectFrom('dd_mentions')
          .select('entry_id')
          .where('source_type', '=', 'session')
          .where('source_id', '=', id)
          .execute();
        const all = new Set([...have.map((h) => h.entry_id), ...processed.entryIds]);
        await rebuildMentions(trx, 'session', id, [...all]);
      } else {
        if (processed.text.length > BODY_MAX) throw new BodyTooLong();
        const res = await trx
          .insertInto('dd_sessions')
          .values({
            game_id: gameId,
            number: await nextNumber(trx, gameId),
            played_on: input.playedOn,
            title: '',
            body: processed.text,
          })
          .executeTakeFirstOrThrow();
        id = Number(res.insertId);
        await rebuildMentions(trx, 'session', id, processed.entryIds);
      }
      const row = await readSession(trx, gameId, id);
      if (!row) throw new Error('økta forsvant rett etter at den ble lagret');
      return {
        kind: 'ok',
        value: { session: toApiSession(row), createdEntries: processed.created.map(toApiEntryListItem) },
      };
    });
  } catch (err) {
    if (err instanceof BodyTooLong) return { kind: 'body_too_long' };
    throw err;
  }
}

export const createSession = (db: Db, userId: number, gameId: number, input: CreateSessionInput) =>
  catchBodyTooLong(() => createSessionTx(db, userId, gameId, input));

export const updateSession = (db: Db, userId: number, id: number, input: UpdateSessionRequest) =>
  catchBodyTooLong(() => updateSessionTx(db, userId, id, input));

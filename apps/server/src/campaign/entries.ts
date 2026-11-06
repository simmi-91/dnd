// Oppslagsverket (`dd_entries`, fase 4b). Alle oppslag går via spillet, som filtrerer på eieren.
import {
  ENTRY_KINDS,
  type CreateEntryInput,
  type Entry,
  type EntryConflict,
  type EntryDetailResponse,
  type EntryKind,
  type EntrySaveResponse,
  type EntriesResponse,
  type MentionSource,
  type UpdateEntryInput,
} from '@dnd/shared';
import type { Db } from '../db/index.ts';
import type { DbEntry } from '../db/types.ts';
import { findGame } from '../games/repo.ts';
import { dateOnly, toApiEntry, toApiEntryListItem } from './convert.ts';
import {
  catchBodyTooLong,
  deleteMentionsFrom,
  lockGame,
  processText,
  rebuildMentions,
  type Tx,
} from './text.ts';

export type EntryResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not_found' }
  | { kind: 'conflict'; error: EntryConflict['error']; entry: Entry }
  /** `fields` peker på en oppføring som ikke finnes i spillet (eller på oppføringen selv). */
  | { kind: 'bad_fields' }
  /** Body passer ikke skjemaet for typen. */
  | { kind: 'invalid' }
  /** Teksten ble for lang etter at (new) ble byttet med ID. */
  | { kind: 'body_too_long' };

async function readEntry(trx: Tx | Db, gameId: number, id: number): Promise<DbEntry | undefined> {
  return trx
    .selectFrom('dd_entries')
    .selectAll()
    .where('id', '=', id)
    .where('game_id', '=', gameId)
    .executeTakeFirst();
}

async function ownedEntryGame(db: Db | Tx, userId: number, id: number) {
  return db
    .selectFrom('dd_entries as e')
    .innerJoin('dd_games as g', 'g.id', 'e.game_id')
    .select('e.game_id')
    .where('e.id', '=', id)
    .where('g.user_id', '=', userId)
    .executeTakeFirst();
}

interface FieldIds {
  giverEntryId?: number;
  placeEntryIds?: number[];
  placeEntryId?: number;
  parentEntryId?: number;
}

/**
 * Sjekker ID-ene i `fields`. ID-er som ikke finnes (slettet), fjernes stille. ID-er fra et annet
 * spill, av feil type (giver er en person, steder er steder) eller oppføringen selv gir undefined.
 */
async function cleanFields<F extends object>(
  trx: Tx,
  gameId: number,
  fields: F,
  selfId?: number,
): Promise<F | undefined> {
  const f = fields as FieldIds;
  const wantedKind = new Map<number, EntryKind>();
  const want = (id: number | undefined, kind: EntryKind) => {
    if (id !== undefined) wantedKind.set(id, kind);
  };
  want(f.giverEntryId, 'person');
  want(f.placeEntryId, 'place');
  want(f.parentEntryId, 'place');
  for (const id of f.placeEntryIds ?? []) want(id, 'place');
  if (wantedKind.size === 0) return fields;
  if (selfId !== undefined && wantedKind.has(selfId)) return undefined;
  const rows = await trx
    .selectFrom('dd_entries')
    .select(['id', 'game_id', 'kind'])
    .where('id', 'in', [...wantedKind.keys()])
    .execute();
  const found = new Map(rows.map((r) => [r.id, r]));
  for (const [id, kind] of wantedKind) {
    const row = found.get(id);
    if (row && (row.game_id !== gameId || row.kind !== kind)) return undefined;
  }
  const exists = (id: number) => found.has(id);
  const cleaned: FieldIds = { ...f };
  for (const key of ['giverEntryId', 'placeEntryId', 'parentEntryId'] as const) {
    const id = cleaned[key];
    if (id !== undefined && !exists(id)) delete cleaned[key];
  }
  if (cleaned.placeEntryIds) cleaned.placeEntryIds = cleaned.placeEntryIds.filter(exists);
  return cleaned as F;
}

async function nameOwner(trx: Tx, gameId: number, kind: EntryKind, name: string, exceptId?: number) {
  let q = trx
    .selectFrom('dd_entries')
    .selectAll()
    .where('game_id', '=', gameId)
    .where('kind', '=', kind)
    .where('name', '=', name);
  if (exceptId !== undefined) q = q.where('id', '!=', exceptId);
  return q.executeTakeFirst();
}

export async function listEntries(
  db: Db,
  userId: number,
  gameId: number,
  query: { kind?: EntryKind; show: 'active' | 'archived' | 'all' },
): Promise<EntriesResponse | undefined> {
  if (!(await findGame(db, userId, gameId))) return undefined;
  let q = db
    .selectFrom('dd_entries')
    .select(['id', 'kind', 'name', 'summary', 'archived', 'status', 'fields', 'updated_at'])
    .where('game_id', '=', gameId);
  if (query.kind) q = q.where('kind', '=', query.kind);
  if (query.show === 'active') q = q.where('archived', '=', 0);
  if (query.show === 'archived') q = q.where('archived', '=', 1);
  const rows = await q.orderBy('name', 'asc').orderBy('id', 'asc').execute();
  const counted = await db
    .selectFrom('dd_entries')
    .select(['kind', (eb) => eb.fn.countAll().as('n')])
    .where('game_id', '=', gameId)
    .where('archived', '=', 0)
    .groupBy('kind')
    .execute();
  const counts = Object.fromEntries(ENTRY_KINDS.map((k) => [k, 0])) as EntriesResponse['counts'];
  for (const c of counted) counts[c.kind] = Number(c.n);
  return { entries: rows.map(toApiEntryListItem), counts };
}

export async function getEntry(db: Db, userId: number, id: number): Promise<EntryDetailResponse | undefined> {
  const owned = await ownedEntryGame(db, userId, id);
  if (!owned) return undefined;
  const row = await readEntry(db, owned.game_id, id);
  if (!row) return undefined;
  const sessions = await db
    .selectFrom('dd_mentions as m')
    .innerJoin('dd_sessions as s', 's.id', 'm.source_id')
    .select(['s.id', 's.number', 's.played_on', 's.title'])
    .where('m.source_type', '=', 'session')
    .where('m.entry_id', '=', id)
    .where('s.game_id', '=', owned.game_id)
    .orderBy('s.played_on', 'desc')
    .orderBy('s.number', 'desc')
    .execute();
  const entries = await db
    .selectFrom('dd_mentions as m')
    .innerJoin('dd_entries as e', 'e.id', 'm.source_id')
    .select(['e.id', 'e.kind', 'e.name'])
    .where('m.source_type', '=', 'entry')
    .where('m.entry_id', '=', id)
    .where('e.game_id', '=', owned.game_id)
    .orderBy('e.name', 'asc')
    .execute();
  const mentionedIn: MentionSource[] = [
    ...sessions.map((s): MentionSource => ({
      sourceType: 'session',
      sourceId: s.id,
      number: s.number,
      playedOn: dateOnly(s.played_on),
      title: s.title,
    })),
    ...entries.map((e): MentionSource => ({
      sourceType: 'entry',
      sourceId: e.id,
      kind: e.kind,
      name: e.name,
    })),
  ];
  return { entry: toApiEntry(row), mentionedIn };
}

async function createEntryTx(
  db: Db,
  userId: number,
  gameId: number,
  input: CreateEntryInput,
): Promise<EntryResult<EntrySaveResponse>> {
  return db.transaction().execute(async (trx): Promise<EntryResult<EntrySaveResponse>> => {
    if (!(await lockGame(trx, userId, gameId))) return { kind: 'not_found' };
    const taken = await nameOwner(trx, gameId, input.kind, input.name);
    if (taken) return { kind: 'conflict', error: 'name_taken', entry: toApiEntry(taken) };
    const fields = await cleanFields(trx, gameId, input.fields);
    if (!fields) return { kind: 'bad_fields' };
    // Raden først med tom tekst, så `(new)` med eget navn kobles til oppføringen selv.
    const res = await trx
      .insertInto('dd_entries')
      .values({
        game_id: gameId,
        kind: input.kind,
        name: input.name,
        summary: input.summary,
        body: '',
        status: input.status,
        fields: JSON.stringify(fields),
        archived: input.archived ? 1 : 0,
      })
      .executeTakeFirstOrThrow();
    const id = Number(res.insertId);
    const processed = await processText(trx, gameId, input.body, id);
    if (processed.text !== '') {
      await trx.updateTable('dd_entries').set({ body: processed.text }).where('id', '=', id).execute();
    }
    await rebuildMentions(trx, 'entry', id, processed.entryIds);
    const row = await readEntry(trx, gameId, id);
    if (!row) throw new Error('oppføringen forsvant rett etter at den ble lagret');
    return {
      kind: 'ok',
      value: {
        entry: toApiEntry(row),
        createdEntries: processed.created.filter((c) => c.id !== id).map(toApiEntryListItem),
      },
    };
  });
}

/** `validate` får raden (typen avgjør skjemaet) og gir dataene, eller undefined hvis de er ugyldige. */
async function updateEntryTx(
  db: Db,
  userId: number,
  id: number,
  validate: (row: DbEntry) => UpdateEntryInput | undefined,
): Promise<EntryResult<EntrySaveResponse>> {
  const owned = await ownedEntryGame(db, userId, id);
  if (!owned) return { kind: 'not_found' };
  const gameId = owned.game_id;
  return db.transaction().execute(async (trx): Promise<EntryResult<EntrySaveResponse>> => {
    if (!(await lockGame(trx, userId, gameId))) return { kind: 'not_found' };
    const current = await readEntry(trx, gameId, id);
    if (!current) return { kind: 'not_found' };
    const input = validate(current);
    if (!input) return { kind: 'invalid' };
    if (current.version !== input.version) {
      return { kind: 'conflict', error: 'version_conflict', entry: toApiEntry(current) };
    }
    if (input.name !== current.name) {
      const taken = await nameOwner(trx, gameId, current.kind, input.name, id);
      if (taken) return { kind: 'conflict', error: 'name_taken', entry: toApiEntry(taken) };
    }
    const fields = await cleanFields(trx, gameId, input.fields, id);
    if (!fields) return { kind: 'bad_fields' };
    const archived = input.archived === undefined ? current.archived : input.archived ? 1 : 0;
    // Navnet først, så `(new)` med det nye navnet kobles til oppføringen selv.
    const res = await trx
      .updateTable('dd_entries')
      .set((eb) => ({
        name: input.name,
        summary: input.summary,
        status: input.status,
        fields: JSON.stringify(fields),
        archived,
        version: eb('version', '+', 1),
      }))
      .where('id', '=', id)
      .where('game_id', '=', gameId)
      .where('version', '=', input.version)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new Error('oppføringen ble endret under en låst transaksjon');
    const processed = await processText(trx, gameId, input.body, id);
    await trx.updateTable('dd_entries').set({ body: processed.text }).where('id', '=', id).execute();
    await rebuildMentions(trx, 'entry', id, processed.entryIds);
    const row = await readEntry(trx, gameId, id);
    if (!row) throw new Error('oppføringen forsvant rett etter at den ble lagret');
    return {
      kind: 'ok',
      value: { entry: toApiEntry(row), createdEntries: processed.created.map(toApiEntryListItem) },
    };
  });
}

export async function deleteEntry(db: Db, userId: number, id: number): Promise<boolean> {
  const owned = await ownedEntryGame(db, userId, id);
  if (!owned) return false;
  return db.transaction().execute(async (trx) => {
    if (!(await lockGame(trx, userId, owned.game_id))) return false;
    const res = await trx
      .deleteFrom('dd_entries')
      .where('id', '=', id)
      .where('game_id', '=', owned.game_id)
      .executeTakeFirst();
    if (res.numDeletedRows === 0n) return false;
    // Koblingene til oppføringen forsvinner med FK; her ryddes de der den selv er kilde.
    await deleteMentionsFrom(trx, 'entry', id);
    return true;
  });
}

export const createEntry = (db: Db, userId: number, gameId: number, input: CreateEntryInput) =>
  catchBodyTooLong(() => createEntryTx(db, userId, gameId, input));

export const updateEntry = (
  db: Db,
  userId: number,
  id: number,
  validate: (row: DbEntry) => UpdateEntryInput | undefined,
) => catchBodyTooLong(() => updateEntryTx(db, userId, id, validate));

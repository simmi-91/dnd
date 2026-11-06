// Lagring av fritekst med koblinger (fase 4b). Alt her kjører i transaksjonen til kalleren, som
// har låst spillraden (`lockGame`), så to skrivinger i samme spill kan ikke opprette samme navn.
import {
  formatMention,
  mapMentions,
  mentionKey,
  mentionedEntryIds,
  newMentions,
  BODY_MAX,
  type MentionKind,
  parseMentionList,
  type EntryKind,
} from '@dnd/shared';
import type { Transaction } from 'kysely';
import type { Database, DbEntry } from '../db/types.ts';

export type Tx = Transaction<Database>;

/** Låser spillraden til eieren. Undefined hvis brukeren ikke eier spillet. */
export async function lockGame(trx: Tx, userId: number, gameId: number) {
  return trx
    .selectFrom('dd_games')
    .select('id')
    .where('id', '=', gameId)
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
}

export interface ProcessedText {
  /** Teksten slik den lagres: `(new)` er byttet med ID, ukjente og `other`-koblinger er tekst. */
  text: string;
  /** Oppføringer som ble opprettet fra `(new)`. */
  created: DbEntry[];
  /** Unike oppføringer teksten kobler til. */
  entryIds: number[];
}

async function findByName(trx: Tx, gameId: number, kind: EntryKind, name: string) {
  return trx
    .selectFrom('dd_entries')
    .selectAll()
    .where('game_id', '=', gameId)
    .where('kind', '=', kind)
    .where('name', '=', name)
    .executeTakeFirst();
}

const CHUNK = 500;

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('nb');
}

async function rowsByNames(trx: Tx, gameId: number, kind: EntryKind, names: string[]) {
  const rows: DbEntry[] = [];
  for (let i = 0; i < names.length; i += CHUNK) {
    rows.push(
      ...(await trx
        .selectFrom('dd_entries')
        .selectAll()
        .where('game_id', '=', gameId)
        .where('kind', '=', kind)
        .where('name', 'in', names.slice(i, i + CHUNK))
        .execute()),
    );
  }
  return rows;
}

/**
 * Finner eller oppretter oppføringene for `(new)`-koblingene med få spørringer: ett oppslag per
 * type, én samlet INSERT IGNORE for de som mangler (den unike nøkkelen avgjør, med databasens
 * kollasjon) og ett oppslag til for å lese dem. Navn som bare er like etter kollasjonen (`å` = `a`)
 * og ikke etter store/små bokstaver, tas med et enkelt oppslag hver (sjelden).
 */
async function resolveNew(
  trx: Tx,
  gameId: number,
  wanted: { kind: MentionKind; label: string }[],
): Promise<{ resolved: Map<string, DbEntry>; created: DbEntry[] }> {
  const resolved = new Map<string, DbEntry>();
  const existingIds = new Set<number>();
  const createdRows = new Map<number, DbEntry>();
  const kinds = [...new Set(wanted.map((w) => w.kind))];

  const claim = (rows: DbEntry[], labels: typeof wanted) => {
    const byKey = new Map(rows.map((r) => [`${r.kind}\u0000${nameKey(r.name)}`, r]));
    for (const w of labels) {
      const row = byKey.get(mentionKey(w.kind, w.label));
      if (row) resolved.set(mentionKey(w.kind, w.label), row);
    }
  };
  const pending = () => wanted.filter((w) => !resolved.has(mentionKey(w.kind, w.label)));

  for (const kind of kinds) {
    const labels = wanted.filter((w) => w.kind === kind);
    const rows = await rowsByNames(
      trx,
      gameId,
      kind,
      labels.map((l) => l.label),
    );
    for (const r of rows) existingIds.add(r.id);
    claim(rows, labels);
  }

  const missing = pending();
  for (let i = 0; i < missing.length; i += CHUNK) {
    await trx
      .insertInto('dd_entries')
      .ignore()
      .values(
        missing.slice(i, i + CHUNK).map((m) => ({
          game_id: gameId,
          kind: m.kind,
          name: m.label,
          summary: '',
          body: '',
          status: m.kind === 'quest' ? ('active' as const) : null,
          fields: '{}',
        })),
      )
      .execute();
  }
  for (const kind of kinds) {
    const labels = missing.filter((w) => w.kind === kind);
    if (labels.length === 0) continue;
    const rows = await rowsByNames(
      trx,
      gameId,
      kind,
      labels.map((l) => l.label),
    );
    for (const r of rows) if (!existingIds.has(r.id)) createdRows.set(r.id, r);
    claim(rows, labels);
  }

  for (const w of pending()) {
    const row = await findByName(trx, gameId, w.kind, w.label);
    if (!row) throw new Error(`fant ikke oppføringen «${w.label}» etter oppretting`);
    resolved.set(mentionKey(w.kind, w.label), row);
    if (!existingIds.has(row.id)) createdRows.set(row.id, row);
  }

  // Opprettet-listen i rekkefølgen navnene først står i teksten.
  const order = new Map<number, number>();
  wanted.forEach((w, i) => {
    const row = resolved.get(mentionKey(w.kind, w.label));
    if (row && !order.has(row.id)) order.set(row.id, i);
  });
  const created = [...createdRows.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { resolved, created };
}

export class BodyTooLong extends Error {}

/** Kjører `fn` og gjør `BodyTooLong` om til et resultat. Kalleren kaster fra transaksjonen, så alt rulles tilbake. */
export async function catchBodyTooLong<T>(fn: () => Promise<T>): Promise<T | { kind: 'body_too_long' }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BodyTooLong) return { kind: 'body_too_long' };
    throw err;
  }
}

/**
 * Tolker teksten, kobler eller oppretter `(new)`, retter prefikser og gjør ukjente ID-er til
 * vanlig tekst. `selfId` er oppføringen som eier teksten (en oppføring kobler ikke til seg selv).
 * Kaster `BodyTooLong` hvis resultatet er lengre enn `BODY_MAX` (bruk `catchBodyTooLong`).
 */
export async function processText(
  trx: Tx,
  gameId: number,
  input: string,
  selfId?: number,
): Promise<ProcessedText> {
  const kinds = new Map<number, EntryKind>();
  const wanted = newMentions(input);
  const { resolved: rows, created } = await resolveNew(trx, gameId, wanted);
  const resolved = new Map<string, number>();
  for (const [key, row] of rows) {
    resolved.set(key, row.id);
    kinds.set(row.id, row.kind);
  }

  const idRefs = mentionedEntryIds(input).filter((id) => !kinds.has(id));
  for (let i = 0; i < idRefs.length; i += 5000) {
    const found = await trx
      .selectFrom('dd_entries')
      .select(['id', 'kind'])
      .where('game_id', '=', gameId)
      .where('id', 'in', idRefs.slice(i, i + 5000))
      .execute();
    for (const r of found) kinds.set(r.id, r.kind);
  }

  const text = mapMentions(input, (m) => {
    const id = 'id' in m.ref ? m.ref.id : resolved.get(mentionKey(m.kind, m.label));
    const kind = id === undefined ? undefined : kinds.get(id);
    if (id === undefined || kind === undefined || kind === 'other') return m.label;
    if (kind === m.kind && 'id' in m.ref) return input.slice(m.start, m.end);
    return formatMention(kind, m.label, { id });
  });

  if (text.length > BODY_MAX) throw new BodyTooLong();
  const entryIds = [
    ...new Set(
      parseMentionList(text).flatMap((m) => ('id' in m.ref && m.ref.id !== selfId ? [m.ref.id] : [])),
    ),
  ];
  return { text, created, entryIds };
}

/** Sletter og bygger `dd_mentions` på nytt for kilden. */
export async function rebuildMentions(
  trx: Tx,
  sourceType: 'session' | 'entry',
  sourceId: number,
  entryIds: number[],
): Promise<void> {
  await trx
    .deleteFrom('dd_mentions')
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute();
  for (let i = 0; i < entryIds.length; i += 500) {
    await trx
      .insertInto('dd_mentions')
      .values(
        entryIds
          .slice(i, i + 500)
          .map((entry_id) => ({ source_type: sourceType, source_id: sourceId, entry_id })),
      )
      .execute();
  }
}

export async function deleteMentionsFrom(
  trx: Tx,
  sourceType: 'session' | 'entry',
  sourceId: number,
): Promise<void> {
  await trx
    .deleteFrom('dd_mentions')
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute();
}

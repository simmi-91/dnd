// Søk og autofullføring (fase 4b). Brukerens tekst går aldri inn i SQL som tekst: den deles i ord,
// operatorer (`+-<>()~*"@` og alt annet som ikke er bokstav, tall eller `_`) forsvinner, og ordene
// sendes som parametere.
import {
  SEARCH_LIMIT,
  SUGGEST_LIMIT,
  stripMentions,
  type EntryKind,
  type EntrySearchHit,
  type SearchResponse,
  type SessionSearchHit,
  type Suggestion,
} from '@dnd/shared';
import { sql, type Expression, type SqlBool } from 'kysely';
import type { Db } from '../db/index.ts';
import { findGame } from '../games/repo.ts';
import { dateOnly } from './convert.ts';

/** InnoDB indekserer ikke ord under `innodb_ft_min_token_size` (3). */
const MIN_FULLTEXT_LENGTH = 3;
const MAX_WORDS = 10;
const EXCERPT_RADIUS = 90;

/** Ordene i søket, uten operatorer. */
export function searchWords(q: string): string[] {
  const words = q.split(/[^\p{L}\p{N}_]+/u).filter((w) => w !== '');
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** Escaper `\`, `%` og `_` for LIKE. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Et kort utdrag rundt første treff, uten koblingsformat. Faller tilbake til starten. */
export function excerptAround(text: string, words: string[]): string {
  const plain = stripMentions(text).replace(/\s+/g, ' ').trim();
  const lower = plain.toLocaleLowerCase('nb');
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w.toLocaleLowerCase('nb'));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - EXCERPT_RADIUS);
  const end = Math.min(plain.length, start + EXCERPT_RADIUS * 2);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`;
}

type Scored<T> = { score: number; hit: T };

function matchCondition(
  columns: string[],
  words: string[],
): { where: Expression<SqlBool>; score: Expression<number> } {
  const long = words.filter((w) => w.length >= MIN_FULLTEXT_LENGTH);
  const short = words.filter((w) => w.length < MIN_FULLTEXT_LENGTH);
  const cols = sql.join(columns.map((c) => sql.ref(c)));
  const parts: Expression<SqlBool>[] = [];
  let score: Expression<number> = sql<number>`0`;
  if (long.length > 0) {
    const against = long.map((w) => `${w}*`).join(' ');
    const match = sql<number>`match(${cols}) against (${against} in boolean mode)`;
    parts.push(sql<SqlBool>`${match} > 0`);
    score = match;
  }
  for (const w of short) {
    const pattern = `%${escapeLike(w)}%`;
    for (const c of columns) parts.push(sql<SqlBool>`${sql.ref(c)} like ${pattern}`);
  }
  return { where: sql<SqlBool>`(${sql.join(parts, sql` or `)})`, score };
}

export async function searchGame(
  db: Db,
  userId: number,
  gameId: number,
  q: string,
): Promise<SearchResponse | undefined> {
  if (!(await findGame(db, userId, gameId))) return undefined;
  const words = searchWords(q);
  if (words.length === 0) return { sessions: [], entries: [] };

  const sc = matchCondition(['title', 'body'], words);
  const sessionRows = await db
    .selectFrom('dd_sessions')
    .select(['id', 'number', 'played_on', 'title', 'body', sql<number>`${sc.score}`.as('score')])
    .where('game_id', '=', gameId)
    .where(sc.where)
    .orderBy('score', 'desc')
    .orderBy('played_on', 'desc')
    .limit(SEARCH_LIMIT)
    .execute();

  const ec = matchCondition(['name', 'summary', 'body'], words);
  const entryRows = await db
    .selectFrom('dd_entries')
    .select(['id', 'kind', 'name', 'summary', 'body', 'archived', sql<number>`${ec.score}`.as('score')])
    .where('game_id', '=', gameId)
    .where(ec.where)
    .orderBy('score', 'desc')
    .orderBy('updated_at', 'desc')
    .limit(SEARCH_LIMIT)
    .execute();

  const sessions: Scored<SessionSearchHit>[] = sessionRows.map((r) => ({
    score: Number(r.score),
    hit: {
      id: r.id,
      number: r.number,
      playedOn: dateOnly(r.played_on),
      title: r.title,
      excerpt: excerptAround(r.body, words),
    },
  }));
  const entries: Scored<EntrySearchHit>[] = entryRows.map((r) => {
    const source = words.some((w) => r.body.toLocaleLowerCase('nb').includes(w.toLocaleLowerCase('nb')))
      ? r.body
      : r.summary || r.body;
    return {
      score: Number(r.score),
      hit: {
        id: r.id,
        kind: r.kind,
        name: r.name,
        archived: r.archived === 1,
        excerpt: excerptAround(source, words),
      },
    };
  });

  // Høyst SEARCH_LIMIT treff til sammen: behold de med høyest treffverdi (stabilt, økter først ved likt).
  const ranked = [
    ...sessions.map((s, i) => ({ ...s, type: 'session' as const, i })),
    ...entries.map((e, i) => ({ ...e, type: 'entry' as const, i })),
  ]
    .sort((a, b) => b.score - a.score || (a.type === b.type ? a.i - b.i : a.type === 'session' ? -1 : 1))
    .slice(0, SEARCH_LIMIT);
  const keepSessions = new Set(ranked.filter((r) => r.type === 'session').map((r) => r.i));
  const keepEntries = new Set(ranked.filter((r) => r.type === 'entry').map((r) => r.i));
  return {
    sessions: sessions.filter((_, i) => keepSessions.has(i)).map((s) => s.hit),
    entries: entries.filter((_, i) => keepEntries.has(i)).map((e) => e.hit),
  };
}

export async function suggestEntries(
  db: Db,
  userId: number,
  gameId: number,
  kind: EntryKind,
  q: string,
): Promise<Suggestion[] | undefined> {
  if (!(await findGame(db, userId, gameId))) return undefined;
  let query = db
    .selectFrom('dd_entries')
    .select(['id', 'kind', 'name'])
    .where('game_id', '=', gameId)
    .where('kind', '=', kind)
    .where('archived', '=', 0);
  const text = q.trim();
  if (text !== '') {
    const escaped = escapeLike(text);
    query = query.where('name', 'like', `%${escaped}%`).orderBy(sql`name like ${`${escaped}%`}`, 'desc');
  }
  const rows = await query.orderBy('updated_at', 'desc').orderBy('id', 'desc').limit(SUGGEST_LIMIT).execute();
  return rows;
}

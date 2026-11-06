import type { Entry, EntryListItem, Session } from '@dnd/shared';
import type { DbEntry, DbSession } from '../db/types.ts';

export function dateOnly(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export function toApiSession(s: DbSession): Session {
  return {
    id: s.id,
    gameId: s.game_id,
    number: s.number,
    playedOn: dateOnly(s.played_on),
    title: s.title,
    body: s.body,
    version: s.version,
    createdAt: s.created_at.toISOString(),
    updatedAt: s.updated_at.toISOString(),
  };
}

type ListRow = Pick<
  DbEntry,
  'id' | 'kind' | 'name' | 'summary' | 'archived' | 'status' | 'fields' | 'updated_at'
>;

/** Feltene `fields` og `status` følger typen, som i skjemaene (`kind` avgjør hvilken variant). */
export function toApiEntryListItem(e: ListRow): EntryListItem {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    summary: e.summary,
    archived: e.archived === 1,
    status: e.status,
    fields: e.fields,
    updatedAt: e.updated_at.toISOString(),
  } as EntryListItem;
}

export function toApiEntry(e: DbEntry): Entry {
  return {
    ...toApiEntryListItem(e),
    gameId: e.game_id,
    body: e.body,
    version: e.version,
    createdAt: e.created_at.toISOString(),
  } as Entry;
}

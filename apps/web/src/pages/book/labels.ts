import type { EntryKind, EntryListItem, PersonAttitude, PlaceType, QuestStatus } from '@dnd/shared';
import type { BookTab } from '../../api/campaign';

export const KIND_LABEL: Record<EntryKind, string> = {
  quest: 'Quest',
  person: 'Person',
  place: 'Sted',
  other: 'Annet',
};

export const TAB_LABEL: Record<BookTab, string> = {
  quester: 'Quester',
  personer: 'Personer',
  steder: 'Steder',
  andre: 'Andre',
  okter: 'Økter',
};

export const TAB_KIND: Record<Exclude<BookTab, 'okter'>, EntryKind> = {
  quester: 'quest',
  personer: 'person',
  steder: 'place',
  andre: 'other',
};

export const STATUS_LABEL: Record<QuestStatus, string> = {
  active: 'Aktiv',
  open: 'Åpen',
  done: 'Ferdig',
  failed: 'Feilet',
};

export const ATTITUDE_LABEL: Record<PersonAttitude, string> = {
  friend: 'Vennlig',
  neutral: 'Nøytral',
  hostile: 'Fiendtlig',
};

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  by: 'By',
  dungeon: 'Dungeon',
  region: 'Region',
  annet: 'Annet',
};

export function parseTab(raw: string | null): BookTab {
  return raw === 'personer' || raw === 'steder' || raw === 'andre' || raw === 'okter' ? raw : 'quester';
}

export function parseKind(raw: string | null): EntryKind | null {
  return raw === 'quest' || raw === 'person' || raw === 'place' || raw === 'other' ? raw : null;
}

/** «4. november 2026» fra `YYYY-MM-DD`. */
export function formatPlayedOn(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Oppføringer slått opp på ID. Mangler ID-en (slettet), vises feltet som tomt. */
export type EntryLookup = ReadonlyMap<number, EntryListItem>;

/** Feltene på en rad i lista, som «fra Brann Holt · Eldmark». */
export function fieldsLine(item: EntryListItem, lookup: EntryLookup): string {
  const name = (id: number | undefined) => (id == null ? undefined : lookup.get(id)?.name);
  const parts: (string | undefined)[] = [];
  switch (item.kind) {
    case 'quest':
      parts.push(
        name(item.fields.giverEntryId) && `fra ${name(item.fields.giverEntryId)}`,
        ...(item.fields.placeEntryIds ?? []).map(name),
      );
      break;
    case 'person':
      parts.push(
        item.fields.role,
        item.fields.attitude && ATTITUDE_LABEL[item.fields.attitude],
        name(item.fields.placeEntryId),
      );
      break;
    case 'place':
      parts.push(item.fields.type && PLACE_TYPE_LABEL[item.fields.type], name(item.fields.parentEntryId));
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(' · ');
}

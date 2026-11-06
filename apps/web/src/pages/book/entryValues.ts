import type {
  CreateEntryRequest,
  Entry,
  EntryKind,
  PersonAttitude,
  PersonFields,
  PlaceFields,
  PlaceType,
  QuestFields,
  QuestStatus,
  UpdateEntryRequest,
} from '@dnd/shared';
import type { Picked } from './EntryPicker';
import type { EntryLookup } from './labels';

/** Verdiene i skjemaet for en oppføring. Feltene som ikke hører til typen, brukes ikke. */
export interface Values {
  kind: EntryKind;
  name: string;
  status: QuestStatus;
  summary: string;
  body: string;
  // Quest
  giver: Picked | null;
  places: Picked[];
  reward: string;
  // Person
  role: string;
  attitude: PersonAttitude | '';
  home: Picked | null;
  // Sted
  placeType: PlaceType | '';
  parent: Picked | null;
}

export function emptyValues(kind: EntryKind): Values {
  return {
    kind,
    name: '',
    status: 'active',
    summary: '',
    body: '',
    giver: null,
    places: [],
    reward: '',
    role: '',
    attitude: '',
    home: null,
    placeType: '',
    parent: null,
  };
}

function pick(id: number | undefined, lookup: EntryLookup): Picked | null {
  const item = id == null ? undefined : lookup.get(id);
  return item ? { id: item.id, name: item.name } : null;
}

/** Skjemaverdiene til en eksisterende oppføring. ID-er som ikke finnes lenger, blir tomme. */
export function valuesFrom(entry: Entry, lookup: EntryLookup): Values {
  const v: Values = {
    ...emptyValues(entry.kind),
    name: entry.name,
    summary: entry.summary,
    body: entry.body,
  };
  switch (entry.kind) {
    case 'quest':
      v.status = entry.status;
      v.giver = pick(entry.fields.giverEntryId, lookup);
      v.places = (entry.fields.placeEntryIds ?? []).flatMap((id) => pick(id, lookup) ?? []);
      v.reward = entry.fields.reward ?? '';
      break;
    case 'person':
      v.role = entry.fields.role ?? '';
      v.attitude = entry.fields.attitude ?? '';
      v.home = pick(entry.fields.placeEntryId, lookup);
      break;
    case 'place':
      v.placeType = entry.fields.type ?? '';
      v.parent = pick(entry.fields.parentEntryId, lookup);
      break;
    default:
      break;
  }
  return v;
}

function questFields(v: Values): QuestFields {
  const f: QuestFields = {};
  if (v.giver) f.giverEntryId = v.giver.id;
  if (v.places.length > 0) f.placeEntryIds = v.places.map((p) => p.id);
  if (v.reward.trim()) f.reward = v.reward.trim();
  return f;
}

function personFields(v: Values): PersonFields {
  const f: PersonFields = {};
  if (v.role.trim()) f.role = v.role.trim();
  if (v.attitude) f.attitude = v.attitude;
  if (v.home) f.placeEntryId = v.home.id;
  return f;
}

function placeFields(v: Values): PlaceFields {
  const f: PlaceFields = {};
  if (v.placeType) f.type = v.placeType;
  if (v.parent) f.parentEntryId = v.parent.id;
  return f;
}

export function toCreate(v: Values): CreateEntryRequest {
  const common = { name: v.name.trim(), summary: v.summary, body: v.body };
  switch (v.kind) {
    case 'quest':
      return { ...common, kind: 'quest', status: v.status, fields: questFields(v) };
    case 'person':
      return { ...common, kind: 'person', fields: personFields(v) };
    case 'place':
      return { ...common, kind: 'place', fields: placeFields(v) };
    default:
      return { ...common, kind: 'other', fields: {} };
  }
}

/** PUT-kroppen: hele oppføringen med versjonen den bygger på. `kind` kan ikke endres. */
export function toUpdate(v: Values, base: Entry): UpdateEntryRequest {
  const common = {
    name: v.name.trim(),
    summary: v.summary,
    body: v.body,
    archived: base.archived,
    version: base.version,
  };
  switch (base.kind) {
    case 'quest':
      return { ...common, status: v.status, fields: questFields(v) };
    case 'person':
      return { ...common, fields: personFields(v) };
    case 'place':
      return { ...common, fields: placeFields(v) };
    default:
      return { ...common, fields: {} };
  }
}

/** PUT-kroppen for en uendret oppføring, f.eks. ved arkivering. */
export function buildUpdate(entry: Entry, over: { archived?: boolean } = {}): UpdateEntryRequest {
  const common = {
    name: entry.name,
    summary: entry.summary,
    body: entry.body,
    archived: over.archived ?? entry.archived,
    version: entry.version,
  };
  switch (entry.kind) {
    case 'quest':
      return { ...common, status: entry.status, fields: entry.fields };
    case 'person':
      return { ...common, fields: entry.fields };
    case 'place':
      return { ...common, fields: entry.fields };
    default:
      return { ...common, fields: {} };
  }
}

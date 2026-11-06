import { z } from 'zod';
import { MAX_ENTRY_ID, MENTION_LABEL_MAX } from './mentions.ts';

// Kontrakten for kampanjeboka (fase 4): dagbok (`dd_sessions`), oppslagsverk (`dd_entries`), søk og
// autofullføring. Fritekst (`body`) bruker koblingsformatet i `mentions.ts`. Hver skriving tar
// `version`, og 409 svarer med raden slik den er på serveren (5.3).
//
// Slik lagrer serveren `body` på en økt eller oppføring (i én transaksjon):
// 1. `(new)`: koblinger slås sammen på `mentionKey` (type og tekst, trimmet, uten hensyn til store
//    og små bokstaver). Finnes det en oppføring i spillet med samme type og navn etter databasens
//    kollasjon (`utf8mb4_unicode_ci`, så også `å` = `a`), kobles den til den, uten `name_taken`.
//    Ellers opprettes den, og kommer med i `createdEntries`. `(new)` byttes med `(e:ID)`.
// 2. `(e:ID)`: ID-er som ikke er en oppføring i samme spill, blir vanlig tekst (bare teksten i
//    koblingen). Prefikset rettes til den faktiske typen: `@[x](e:7)` der 7 er et sted, lagres som
//    `#[x](e:7)`. En kobling til en oppføring av typen `other` blir vanlig tekst, siden `other`
//    ikke har noe tegn. Bruk `mapMentions`.
// 3. `dd_mentions` for kilden bygges på nytt fra teksten slik den ble lagret.
// Blir teksten lengre enn `BODY_MAX` etter dette (`(new)` er kortere enn `(e:ID)`), svarer serveren
// 422 `body_too_long` (`bodyTooLongErrorSchema`) og endrer ingenting, heller ikke oppføringer.
// Svaret har teksten slik den ble lagret. En kobling som ikke endres, skrives ut tegn for tegn likt.
// `fields`: ID-er som ikke finnes lenger, fjernes stille ved lagring. ID-er fra et annet spill eller
// av feil type (`giverEntryId` er en person, steder er steder) gir 400.

/** Høyst så mange tegn i `body` på en økt eller oppføring, og i et hurtignotat. */
export const BODY_MAX = 100_000;
export const SESSION_TITLE_MAX = 200;
/** Lik `MENTION_LABEL_MAX`, så hvert navn kan stå i en kobling. */
export const ENTRY_NAME_MAX = MENTION_LABEL_MAX;
export const ENTRY_SUMMARY_MAX = 500;
export const SEARCH_QUERY_MAX = 200;
/** Høyst så mange treff i søket, økter og oppføringer til sammen. */
export const SEARCH_LIMIT = 50;
export const SUGGEST_LIMIT = 10;

const rowId = z.number().int().positive();
const entryId = z.number().int().positive().max(MAX_ENTRY_ID);
const version = z.number().int().min(1);
/** ISO-tid. */
const timestamp = z.string();
const bodySchema = z.string().max(BODY_MAX);

/** Datoen økta ble spilt, `YYYY-MM-DD`. */
export const playedOnSchema = z.iso.date();

// ---------- Oppføringer ----------

export const ENTRY_KINDS = ['quest', 'person', 'place', 'other'] as const;
export const entryKindSchema = z.enum(ENTRY_KINDS);
export type EntryKind = z.infer<typeof entryKindSchema>;

export const QUEST_STATUSES = ['active', 'open', 'done', 'failed'] as const;
export const questStatusSchema = z.enum(QUEST_STATUSES);
export type QuestStatus = z.infer<typeof questStatusSchema>;

export const PERSON_ATTITUDES = ['friend', 'neutral', 'hostile'] as const;
export const personAttitudeSchema = z.enum(PERSON_ATTITUDES);
export type PersonAttitude = z.infer<typeof personAttitudeSchema>;

export const PLACE_TYPES = ['by', 'dungeon', 'region', 'annet'] as const;
export const placeTypeSchema = z.enum(PLACE_TYPES);
export type PlaceType = z.infer<typeof placeTypeSchema>;

export const entryNameSchema = z.string().trim().min(1).max(ENTRY_NAME_MAX);
export const entrySummarySchema = z.string().max(ENTRY_SUMMARY_MAX);

/** ID-ene i `fields` er ikke koblinger i `dd_mentions`. Serveren sjekker at de hører til spillet. */
export const questFieldsSchema = z.strictObject({
  giverEntryId: entryId.optional(),
  placeEntryIds: z.array(entryId).max(50).optional(),
  reward: z.string().max(500).optional(),
});
export type QuestFields = z.infer<typeof questFieldsSchema>;

export const personFieldsSchema = z.strictObject({
  role: z.string().max(200).optional(),
  attitude: personAttitudeSchema.optional(),
  placeEntryId: entryId.optional(),
});
export type PersonFields = z.infer<typeof personFieldsSchema>;

export const placeFieldsSchema = z.strictObject({
  type: placeTypeSchema.optional(),
  parentEntryId: entryId.optional(),
});
export type PlaceFields = z.infer<typeof placeFieldsSchema>;

export const otherFieldsSchema = z.strictObject({});
export type OtherFields = z.infer<typeof otherFieldsSchema>;

export type EntryFields = QuestFields | PersonFields | PlaceFields | OtherFields;

/** Feltene som er like for alle typer i en skriving. `summary` og `body` er `''` hvis de mangler. */
const entryWriteShape = {
  name: entryNameSchema,
  summary: entrySummarySchema.default(''),
  body: bodySchema.default(''),
  archived: z.boolean().optional(),
};

const questWrite = {
  ...entryWriteShape,
  kind: z.literal('quest'),
  status: questStatusSchema.default('active'),
  fields: questFieldsSchema.default({}),
};
const personWrite = {
  ...entryWriteShape,
  kind: z.literal('person'),
  status: z.null().default(null),
  fields: personFieldsSchema.default({}),
};
const placeWrite = {
  ...entryWriteShape,
  kind: z.literal('place'),
  status: z.null().default(null),
  fields: placeFieldsSchema.default({}),
};
const otherWrite = {
  ...entryWriteShape,
  kind: z.literal('other'),
  status: z.null().default(null),
  fields: otherFieldsSchema.default({}),
};

/** POST /api/games/:id/entries (body). `(new)`-koblinger i `body` opprettes ved lagring. */
export const createEntryRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject(questWrite),
  z.strictObject(personWrite),
  z.strictObject(placeWrite),
  z.strictObject(otherWrite),
]);
export type CreateEntryRequest = z.input<typeof createEntryRequestSchema>;
export type CreateEntryInput = z.output<typeof createEntryRequestSchema>;

function withoutKind<T extends { kind: unknown }>(shape: T): Omit<T, 'kind'> {
  const rest: Partial<T> = { ...shape };
  delete rest.kind;
  return rest as Omit<T, 'kind'>;
}

/**
 * PUT /api/entries/:id (body). Hele oppføringen, med versjonen klienten bygde på. `kind` kan ikke
 * endres og er ikke med: serveren leser raden og sjekker body med skjemaet for typen dens
 * (`updateEntryRequestSchemas[row.kind]`). Et ukjent felt, også `kind`, gir 400.
 */
export const updateEntryRequestSchemas = {
  quest: z.strictObject({ ...withoutKind(questWrite), version }),
  person: z.strictObject({ ...withoutKind(personWrite), version }),
  place: z.strictObject({ ...withoutKind(placeWrite), version }),
  other: z.strictObject({ ...withoutKind(otherWrite), version }),
} as const;
export type UpdateEntryRequest = {
  [K in EntryKind]: z.input<(typeof updateEntryRequestSchemas)[K]>;
}[EntryKind];
export type UpdateEntryInput = {
  [K in EntryKind]: z.output<(typeof updateEntryRequestSchemas)[K]>;
}[EntryKind];

const entryCommon = {
  id: rowId,
  gameId: rowId,
  name: z.string(),
  summary: z.string(),
  body: z.string(),
  archived: z.boolean(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
};

/** En oppføring i oppslagsverket. */
export const entrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...entryCommon,
    kind: z.literal('quest'),
    status: questStatusSchema,
    fields: questFieldsSchema,
  }),
  z.object({ ...entryCommon, kind: z.literal('person'), status: z.null(), fields: personFieldsSchema }),
  z.object({ ...entryCommon, kind: z.literal('place'), status: z.null(), fields: placeFieldsSchema }),
  z.object({ ...entryCommon, kind: z.literal('other'), status: z.null(), fields: otherFieldsSchema }),
]);
export type Entry = z.infer<typeof entrySchema>;

const listCommon = {
  id: rowId,
  name: z.string(),
  summary: z.string(),
  archived: z.boolean(),
  updatedAt: timestamp,
};

/** En oppføring i listen, uten `body`. */
export const entryListItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...listCommon, kind: z.literal('quest'), status: questStatusSchema, fields: questFieldsSchema }),
  z.object({ ...listCommon, kind: z.literal('person'), status: z.null(), fields: personFieldsSchema }),
  z.object({ ...listCommon, kind: z.literal('place'), status: z.null(), fields: placeFieldsSchema }),
  z.object({ ...listCommon, kind: z.literal('other'), status: z.null(), fields: otherFieldsSchema }),
]);
export type EntryListItem = z.infer<typeof entryListItemSchema>;

/** GET /api/games/:id/entries (query). `show` er `active` (standard), `archived` eller `all`. */
export const entriesQuerySchema = z.object({
  kind: entryKindSchema.optional(),
  show: z.enum(['active', 'archived', 'all']).default('active'),
});
export type EntriesQuery = z.input<typeof entriesQuerySchema>;

/** Svar fra GET /api/games/:id/entries. `counts` er antall som ikke er arkivert, per type. */
export const entriesResponseSchema = z.object({
  entries: z.array(entryListItemSchema),
  counts: z.object({
    quest: z.number().int(),
    person: z.number().int(),
    place: z.number().int(),
    other: z.number().int(),
  }),
});
export type EntriesResponse = z.infer<typeof entriesResponseSchema>;

/** Der en oppføring er nevnt: en økt eller en annen oppføring. */
export const mentionSourceSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('session'),
    sourceId: rowId,
    number: z.number().int().positive(),
    playedOn: playedOnSchema,
    title: z.string(),
  }),
  z.object({
    sourceType: z.literal('entry'),
    sourceId: rowId,
    kind: entryKindSchema,
    name: z.string(),
  }),
]);
export type MentionSource = z.infer<typeof mentionSourceSchema>;

/** Svar fra GET /api/entries/:id. `mentionedIn` er økter (nyeste først) og så oppføringer. */
export const entryDetailResponseSchema = z.object({
  entry: entrySchema,
  mentionedIn: z.array(mentionSourceSchema),
});
export type EntryDetailResponse = z.infer<typeof entryDetailResponseSchema>;

/**
 * Svar fra POST /api/games/:id/entries og PUT /api/entries/:id. `entry.body` er serverens tekst,
 * der `(new)` er byttet med ID. `createdEntries` er oppføringene som ble opprettet fra `(new)`.
 */
export const entrySaveResponseSchema = z.object({
  entry: entrySchema,
  createdEntries: z.array(entryListItemSchema),
});
export type EntrySaveResponse = z.infer<typeof entrySaveResponseSchema>;

/**
 * 409 fra oppføringene. `version_conflict`: PUT bygde på en gammel versjon, og `entry` er
 * gjeldende rad. `name_taken`: POST eller PUT ga et navn som finnes fra før for typen (uten
 * hensyn til store og små bokstaver eller aksenter), og `entry` er den som har det. `(new)` i
 * fritekst gir aldri `name_taken`, men kobles til den som finnes.
 */
export const entryConflictSchema = z.object({
  error: z.enum(['version_conflict', 'name_taken']),
  message: z.string(),
  entry: entrySchema,
});
export type EntryConflict = z.infer<typeof entryConflictSchema>;

// ---------- Dagbok ----------

export const sessionTitleSchema = z.string().max(SESSION_TITLE_MAX);

/** En økt i dagboka. */
export const sessionSchema = z.object({
  id: rowId,
  gameId: rowId,
  number: z.number().int().positive(),
  playedOn: playedOnSchema,
  title: z.string(),
  body: z.string(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Session = z.infer<typeof sessionSchema>;

/** En økt i listen, uten `body`. `excerpt` er starten på teksten uten koblingsformat. */
export const sessionListItemSchema = z.object({
  id: rowId,
  number: z.number().int().positive(),
  playedOn: playedOnSchema,
  title: z.string(),
  excerpt: z.string(),
  updatedAt: timestamp,
});
export type SessionListItem = z.infer<typeof sessionListItemSchema>;

/** Svar fra GET /api/games/:id/sessions. Nyeste først. */
export const sessionsResponseSchema = z.object({ sessions: z.array(sessionListItemSchema) });
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;

/** POST /api/games/:id/sessions (body). Uten `number` får økta neste nummer. */
export const createSessionRequestSchema = z.strictObject({
  playedOn: playedOnSchema,
  number: z.number().int().positive().max(100_000).optional(),
  title: sessionTitleSchema.default(''),
  body: bodySchema.default(''),
});
export type CreateSessionRequest = z.input<typeof createSessionRequestSchema>;
export type CreateSessionInput = z.output<typeof createSessionRequestSchema>;

/** PUT /api/sessions/:id (body). Hele økta, med versjonen klienten bygde på. */
export const updateSessionRequestSchema = z.strictObject({
  playedOn: playedOnSchema,
  number: z.number().int().positive().max(100_000).optional(),
  title: sessionTitleSchema,
  body: bodySchema,
  version,
});
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;

/**
 * POST /api/games/:id/sessions/today/append (body). Hurtignotatet: `text` legges til nederst i
 * økta med datoen `playedOn` (klientens dato), og lagres som vanlig (se toppen av fila).
 *
 * Serveren låser spillraden (`SELECT … FOR UPDATE` på `dd_games`) og finner eller oppretter økta i
 * samme transaksjon. `played_on` har ingen unik nøkkel, og flere økter samme dato er lov: notatet
 * går til den med høyest nummer for datoen. Finnes ingen, opprettes en med neste nummer. Notatet
 * bruker ikke `version`, men øker den, så en åpen skriveflate får 409 ved neste lagring.
 * Blir `body` lengre enn `BODY_MAX`, svarer serveren 422 `body_too_long` og endrer ingenting.
 */
export const appendTodayRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(BODY_MAX),
  playedOn: playedOnSchema,
});
export type AppendTodayRequest = z.infer<typeof appendTodayRequestSchema>;

/**
 * 422 fra hurtignotatet og fra POST/PUT på økter og oppføringer: teksten ville blitt lengre enn
 * `BODY_MAX` tegn etter at `(new)` er byttet med `(e:ID)`. Serveren endrer ingenting.
 */
export const bodyTooLongErrorSchema = z.object({
  error: z.literal('body_too_long'),
  message: z.string(),
  max: z.literal(BODY_MAX),
});
export type BodyTooLongError = z.infer<typeof bodyTooLongErrorSchema>;

/** Svar fra GET /api/sessions/:id. */
export const sessionResponseSchema = z.object({ session: sessionSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * Svar fra POST …/sessions, PUT /api/sessions/:id og POST …/today/append. `session.body` er
 * teksten slik den ble lagret. `createdEntries` er oppføringene som ble opprettet fra `(new)`.
 */
export const sessionSaveResponseSchema = z.object({
  session: sessionSchema,
  createdEntries: z.array(entryListItemSchema),
});
export type SessionSaveResponse = z.infer<typeof sessionSaveResponseSchema>;

/**
 * 409 fra øktene. `version_conflict`: PUT bygde på en gammel versjon, og `session` er gjeldende
 * rad. `number_taken`: spillet har en økt med det nummeret, og `session` er den.
 */
export const sessionConflictSchema = z.object({
  error: z.enum(['version_conflict', 'number_taken']),
  message: z.string(),
  session: sessionSchema,
});
export type SessionConflict = z.infer<typeof sessionConflictSchema>;

// ---------- Søk og autofullføring ----------

/** GET /api/games/:id/search (query). */
export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(SEARCH_QUERY_MAX) });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Et kort utdrag rundt treffet, uten koblingsformat. */
const excerpt = z.string().max(400);

export const sessionSearchHitSchema = z.object({
  id: rowId,
  number: z.number().int().positive(),
  playedOn: playedOnSchema,
  title: z.string(),
  excerpt,
});
export type SessionSearchHit = z.infer<typeof sessionSearchHitSchema>;

export const entrySearchHitSchema = z.object({
  id: rowId,
  kind: entryKindSchema,
  name: z.string(),
  archived: z.boolean(),
  excerpt,
});
export type EntrySearchHit = z.infer<typeof entrySearchHitSchema>;

/** Svar fra GET /api/games/:id/search. Høyst `SEARCH_LIMIT` treff til sammen. */
export const searchResponseSchema = z
  .object({
    sessions: z.array(sessionSearchHitSchema),
    entries: z.array(entrySearchHitSchema),
  })
  .refine((r) => r.sessions.length + r.entries.length <= SEARCH_LIMIT, {
    message: `Høyst ${SEARCH_LIMIT} treff`,
  });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** GET /api/games/:id/entries/suggest (query). Tom `q` gir de sist endrede. Arkiverte er ikke med. */
export const suggestQuerySchema = z.object({
  kind: entryKindSchema,
  q: z.string().trim().max(ENTRY_NAME_MAX).default(''),
});
export type SuggestQuery = z.input<typeof suggestQuerySchema>;

export const suggestionSchema = z.object({ id: rowId, kind: entryKindSchema, name: z.string() });
export type Suggestion = z.infer<typeof suggestionSchema>;

/** Svar fra GET /api/games/:id/entries/suggest. */
export const suggestResponseSchema = z.object({
  suggestions: z.array(suggestionSchema).max(SUGGEST_LIMIT),
});
export type SuggestResponse = z.infer<typeof suggestResponseSchema>;

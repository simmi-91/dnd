import { describe, expect, it } from 'vitest';
import {
  appendTodayRequestSchema,
  BODY_MAX,
  createEntryRequestSchema,
  createSessionRequestSchema,
  entryConflictSchema,
  entryDetailResponseSchema,
  entrySchema,
  playedOnSchema,
  searchQuerySchema,
  searchResponseSchema,
  SEARCH_LIMIT,
  sessionConflictSchema,
  suggestQuerySchema,
  suggestResponseSchema,
  updateEntryRequestSchemas,
  entryListItemSchema,
  sessionResponseSchema,
  bodyTooLongErrorSchema,
  updateSessionRequestSchema,
} from './index.ts';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success, JSON.stringify(v).slice(0, 200)).toBe(true);
const bad = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success, JSON.stringify(v).slice(0, 200)).toBe(false);

const session = {
  id: 1,
  gameId: 2,
  number: 3,
  playedOn: '2026-11-06',
  title: 'Karavanen',
  body: 'Møtte @[Brann](e:4).',
  version: 1,
  createdAt: '2026-11-06T18:00:00.000Z',
  updatedAt: '2026-11-06T18:00:00.000Z',
};

const quest = {
  id: 9,
  gameId: 2,
  kind: 'quest',
  name: 'Finne karavanen',
  summary: '',
  body: '',
  status: 'active',
  fields: { giverEntryId: 4, placeEntryIds: [7], reward: '50 gp' },
  archived: false,
  version: 1,
  createdAt: '2026-11-06T18:00:00.000Z',
  updatedAt: '2026-11-06T18:00:00.000Z',
};

describe('playedOnSchema', () => {
  it('godtar YYYY-MM-DD og avviser alt annet', () => {
    ok(playedOnSchema, '2026-11-06');
    ok(playedOnSchema, '2024-02-29');
    for (const v of [
      '2026-11-6',
      '06.11.2026',
      '2026-13-01',
      '2026-02-30',
      '2026-11-06T00:00:00Z',
      '',
      20261106,
    ]) {
      bad(playedOnSchema, v);
    }
  });
});

describe('createEntryRequestSchema', () => {
  it('fyller inn standardverdier per type', () => {
    expect(createEntryRequestSchema.parse({ kind: 'quest', name: '  Finne karavanen ' })).toEqual({
      kind: 'quest',
      name: 'Finne karavanen',
      summary: '',
      body: '',
      status: 'active',
      fields: {},
    });
    expect(createEntryRequestSchema.parse({ kind: 'person', name: 'Brann' })).toMatchObject({
      status: null,
      fields: {},
    });
  });

  it('godtar felter for hver type', () => {
    ok(createEntryRequestSchema, { kind: 'quest', name: 'Q', status: 'done', fields: quest.fields });
    ok(createEntryRequestSchema, {
      kind: 'person',
      name: 'Brann',
      summary: 'Karavanefører',
      fields: { role: 'kjøpmann', attitude: 'friend', placeEntryId: 7 },
    });
    ok(createEntryRequestSchema, {
      kind: 'place',
      name: 'Eldmark',
      fields: { type: 'by', parentEntryId: 3 },
    });
    ok(createEntryRequestSchema, { kind: 'other', name: 'Sverdet', archived: true });
  });

  it.each([
    ['ukjent type', { kind: 'monster', name: 'x' }],
    ['tomt navn', { kind: 'person', name: '   ' }],
    ['for langt navn', { kind: 'person', name: 'x'.repeat(201) }],
    ['for langt sammendrag', { kind: 'person', name: 'x', summary: 'x'.repeat(501) }],
    ['for lang body', { kind: 'person', name: 'x', body: 'x'.repeat(BODY_MAX + 1) }],
    ['status på person', { kind: 'person', name: 'x', status: 'active' }],
    ['ukjent quest-status', { kind: 'quest', name: 'x', status: 'paused' }],
    ['quest-felt på person', { kind: 'person', name: 'x', fields: { reward: '1 gp' } }],
    ['ukjent holdning', { kind: 'person', name: 'x', fields: { attitude: 'angry' } }],
    ['ukjent stedstype', { kind: 'place', name: 'x', fields: { type: 'planet' } }],
    ['felt på other', { kind: 'other', name: 'x', fields: { role: 'x' } }],
    ['ID 0 i felt', { kind: 'place', name: 'x', fields: { parentEntryId: 0 } }],
    ['ID som tekst', { kind: 'quest', name: 'x', fields: { giverEntryId: '4' } }],
    ['ukjent felt på roten', { kind: 'person', name: 'x', gameId: 2 }],
    ['version ved opprettelse', { kind: 'person', name: 'x', version: 1 }],
  ])('avviser %s', (_name, v) => {
    bad(createEntryRequestSchema, v);
  });

  it('godtar body på nøyaktig grensen', () => {
    ok(createEntryRequestSchema, { kind: 'other', name: 'x', body: 'x'.repeat(BODY_MAX) });
  });
});

describe('updateEntryRequestSchemas', () => {
  it('krever version og tar ikke kind', () => {
    const place = updateEntryRequestSchemas.place;
    ok(place, { name: 'Eldmark', version: 2, fields: { type: 'by' } });
    bad(place, { name: 'Eldmark' });
    bad(place, { name: 'Eldmark', version: 0 });
    bad(place, { kind: 'place', name: 'Eldmark', version: 2 });
    bad(place, { kind: 'quest', name: 'Eldmark', version: 2 });
  });

  it('sjekker status og felter etter typen til raden', () => {
    ok(updateEntryRequestSchemas.quest, { name: 'Q', status: 'failed', version: 1 });
    bad(updateEntryRequestSchemas.person, { name: 'Q', status: 'failed', version: 1 });
    bad(updateEntryRequestSchemas.place, { name: 'Q', fields: { attitude: 'friend' }, version: 1 });
    expect(updateEntryRequestSchemas.person.parse({ name: ' B ', version: 3 })).toEqual({
      name: 'B',
      summary: '',
      body: '',
      status: null,
      fields: {},
      version: 3,
    });
  });
});

describe('entryListItemSchema', () => {
  const item = { id: 1, name: 'B', summary: '', archived: false, updatedAt: 'x' };
  it('deler status og felter på kind', () => {
    ok(entryListItemSchema, { ...item, kind: 'person', status: null, fields: { attitude: 'hostile' } });
    ok(entryListItemSchema, { ...item, kind: 'quest', status: 'open', fields: { reward: '1 gp' } });
    bad(entryListItemSchema, { ...item, kind: 'person', status: null, fields: { reward: '1 gp' } });
    bad(entryListItemSchema, { ...item, kind: 'quest', status: null, fields: {} });
    bad(entryListItemSchema, { ...item, kind: 'place', status: 'open', fields: {} });
  });
});

describe('sessionResponseSchema og body_too_long', () => {
  it('GET av en økt har bare session', () => {
    expect(sessionResponseSchema.parse({ session, createdEntries: [] })).toEqual({ session });
    bad(sessionResponseSchema, {});
  });

  it('422 har feilkode og grense', () => {
    ok(bodyTooLongErrorSchema, { error: 'body_too_long', message: 'For lang', max: BODY_MAX });
    bad(bodyTooLongErrorSchema, { error: 'too_long', message: 'For lang', max: BODY_MAX });
  });
});

describe('entrySchema og svar', () => {
  it('godtar en quest og avviser status på andre typer', () => {
    ok(entrySchema, quest);
    bad(entrySchema, { ...quest, kind: 'person', fields: {} });
    ok(entrySchema, { ...quest, kind: 'person', status: null, fields: {} });
  });

  it('godtar detalj med «Nevnt i»', () => {
    ok(entryDetailResponseSchema, {
      entry: quest,
      mentionedIn: [
        { sourceType: 'session', sourceId: 1, number: 3, playedOn: '2026-11-06', title: '' },
        { sourceType: 'entry', sourceId: 4, kind: 'person', name: 'Brann' },
      ],
    });
    bad(entryDetailResponseSchema, {
      entry: quest,
      mentionedIn: [{ sourceType: 'session', sourceId: 1, name: 'x' }],
    });
  });

  it('409 har gjeldende rad', () => {
    ok(entryConflictSchema, { error: 'version_conflict', message: 'Endret', entry: quest });
    ok(entryConflictSchema, { error: 'name_taken', message: 'Finnes', entry: quest });
    bad(entryConflictSchema, { error: 'version_conflict', message: 'Endret' });
    ok(sessionConflictSchema, { error: 'version_conflict', message: 'Endret', session });
    bad(sessionConflictSchema, { error: 'version_conflict', message: 'Endret', session: null });
  });
});

describe('økter', () => {
  it('oppretter med standardverdier', () => {
    expect(createSessionRequestSchema.parse({ playedOn: '2026-11-06' })).toEqual({
      playedOn: '2026-11-06',
      title: '',
      body: '',
    });
  });

  it.each([
    ['uten dato', { title: 'x' }],
    ['ugyldig dato', { playedOn: '2026-11-31' }],
    ['for lang tittel', { playedOn: '2026-11-06', title: 'x'.repeat(201) }],
    ['for lang body', { playedOn: '2026-11-06', body: 'x'.repeat(BODY_MAX + 1) }],
    ['nummer 0', { playedOn: '2026-11-06', number: 0 }],
    ['ukjent felt', { playedOn: '2026-11-06', gameId: 1 }],
  ])('avviser opprettelse %s', (_name, v) => {
    bad(createSessionRequestSchema, v);
  });

  it('PUT krever alle felt og version', () => {
    ok(updateSessionRequestSchema, { playedOn: '2026-11-06', title: '', body: 'x', version: 1 });
    bad(updateSessionRequestSchema, { playedOn: '2026-11-06', title: '', body: 'x' });
    bad(updateSessionRequestSchema, { playedOn: '2026-11-06', body: 'x', version: 1 });
  });

  it('hurtignotat krever tekst og dato', () => {
    expect(appendTodayRequestSchema.parse({ text: '  Ugla ble skadet  ', playedOn: '2026-11-06' })).toEqual({
      text: 'Ugla ble skadet',
      playedOn: '2026-11-06',
    });
    bad(appendTodayRequestSchema, { text: '   ', playedOn: '2026-11-06' });
    bad(appendTodayRequestSchema, { text: 'x' });
    bad(appendTodayRequestSchema, { text: 'x'.repeat(BODY_MAX + 1), playedOn: '2026-11-06' });
  });
});

describe('søk og autofullføring', () => {
  it('søk krever ikke-tom q', () => {
    expect(searchQuerySchema.parse({ q: ' karavan ' })).toEqual({ q: 'karavan' });
    bad(searchQuerySchema, { q: '  ' });
    bad(searchQuerySchema, {});
    bad(searchQuerySchema, { q: 'x'.repeat(201) });
  });

  it('søkesvaret har økter og oppføringer, høyst 50 til sammen', () => {
    const s = { id: 1, number: 1, playedOn: '2026-11-06', title: '', excerpt: '… karavanen …' };
    const e = { id: 9, kind: 'quest', name: 'Finne karavanen', archived: false, excerpt: '' };
    ok(searchResponseSchema, { sessions: [s], entries: [e] });
    ok(searchResponseSchema, { sessions: [], entries: [] });
    bad(searchResponseSchema, { sessions: [s] });
    bad(searchResponseSchema, {
      sessions: Array.from({ length: SEARCH_LIMIT }, () => s),
      entries: [e],
    });
  });

  it('suggest tar kind og valgfri q, og gir høyst 10', () => {
    expect(suggestQuerySchema.parse({ kind: 'person' })).toEqual({ kind: 'person', q: '' });
    expect(suggestQuerySchema.parse({ kind: 'place', q: ' Eld ' })).toEqual({ kind: 'place', q: 'Eld' });
    bad(suggestQuerySchema, { q: 'x' });
    bad(suggestQuerySchema, { kind: 'monster', q: 'x' });
    const item = { id: 1, kind: 'person', name: 'Brann' };
    ok(suggestResponseSchema, { suggestions: Array.from({ length: 10 }, () => item) });
    bad(suggestResponseSchema, { suggestions: Array.from({ length: 11 }, () => item) });
  });
});

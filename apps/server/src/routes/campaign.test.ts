import {
  BODY_MAX,
  entryConflictSchema,
  entryDetailResponseSchema,
  entriesResponseSchema,
  entrySaveResponseSchema,
  searchResponseSchema,
  sessionConflictSchema,
  sessionResponseSchema,
  sessionSaveResponseSchema,
  sessionsResponseSchema,
  suggestResponseSchema,
  gameDetailResponseSchema,
} from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import type { Db } from '../db/index.ts';
import {
  ELOWEN_ID,
  WRITE_HEADERS,
  clearData,
  fakeDdb,
  fakeGoogle,
  freshTestDb,
  sessionCookieFrom,
  testConfig,
} from '../test/helpers.ts';

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await freshTestDb(testConfig());
});

beforeEach(async () => {
  await clearData(db);
  app = await buildApp(testConfig(), {
    db,
    logger: false,
    verifyGoogleToken: fakeGoogle(),
    ddbFetch: fakeDdb().fetch,
  });
});

afterEach(async () => {
  await app?.close();
});

afterAll(async () => {
  await db?.destroy();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function login(sub = 'a'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/google',
    headers: WRITE_HEADERS,
    payload: { credential: `ok:${sub}:${sub}@example.no` },
  });
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new Error('innlogging feilet');
  return `dd_session=${cookie.value}`;
}

function call(cookie: string | null, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { ...(method === 'GET' ? {} : WRITE_HEADERS), ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function newGame(cookie: string): Promise<number> {
  const res = await call(cookie, 'POST', '/api/games', {
    name: 'Icewind Dale',
    ddbUrlOrId: String(ELOWEN_ID),
  });
  expect(res.statusCode, res.body).toBe(201);
  return gameDetailResponseSchema.parse(res.json()).game.id;
}

async function addSession(cookie: string, gameId: number, body: Record<string, unknown>) {
  const res = await call(cookie, 'POST', `/api/games/${gameId}/sessions`, {
    playedOn: '2026-11-01',
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return sessionSaveResponseSchema.parse(res.json());
}

async function addEntry(cookie: string, gameId: number, body: Record<string, unknown>) {
  const res = await call(cookie, 'POST', `/api/games/${gameId}/entries`, body);
  expect(res.statusCode, res.body).toBe(201);
  return entrySaveResponseSchema.parse(res.json());
}

async function detail(cookie: string, id: number) {
  const res = await call(cookie, 'GET', `/api/entries/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return entryDetailResponseSchema.parse(res.json());
}

async function mentionRows(sourceType: 'session' | 'entry', sourceId: number) {
  return db
    .selectFrom('dd_mentions')
    .select('entry_id')
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .orderBy('entry_id')
    .execute();
}

describe('innlogging og CSRF', () => {
  it.each<[Method, string]>([
    ['GET', '/api/games/1/sessions'],
    ['POST', '/api/games/1/sessions'],
    ['POST', '/api/games/1/sessions/today/append'],
    ['GET', '/api/sessions/1'],
    ['PUT', '/api/sessions/1'],
    ['DELETE', '/api/sessions/1'],
    ['GET', '/api/games/1/entries'],
    ['POST', '/api/games/1/entries'],
    ['GET', '/api/games/1/entries/suggest?kind=person'],
    ['GET', '/api/entries/1'],
    ['PUT', '/api/entries/1'],
    ['DELETE', '/api/entries/1'],
    ['GET', '/api/games/1/search?q=abc'],
  ])('%s %s krever innlogging', async (method, url) => {
    const res = await call(null, method, url, method === 'GET' || method === 'DELETE' ? undefined : {});
    expect(res.statusCode).toBe(401);
  });

  it('skrivende kall uten X-Requested-With gir 403', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    for (const [method, url] of [
      ['POST', `/api/games/${gameId}/sessions`],
      ['POST', `/api/games/${gameId}/sessions/today/append`],
      ['POST', `/api/games/${gameId}/entries`],
    ] as const) {
      const res = await app.inject({ method, url, headers: { cookie }, payload: {} });
      expect(res.statusCode, url).toBe(403);
    }
    const del = await app.inject({ method: 'DELETE', url: '/api/sessions/1', headers: { cookie } });
    expect(del.statusCode).toBe(403);
  });
});

describe('økter', () => {
  it('oppretter med neste nummer, leser, lister (nyeste først) og sletter', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const a = await addSession(cookie, gameId, {
      playedOn: '2026-10-01',
      title: 'Første',
      body: 'Vi møttes.',
    });
    const b = await addSession(cookie, gameId, { playedOn: '2026-11-01', body: '@[Brann](new) kom.' });
    expect(a.session).toMatchObject({
      number: 1,
      version: 1,
      gameId,
      playedOn: '2026-10-01',
      title: 'Første',
    });
    expect(b.session.number).toBe(2);
    expect(b.createdEntries).toHaveLength(1);

    const list = sessionsResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/sessions`)).json(),
    );
    expect(list.sessions.map((s) => s.number)).toEqual([2, 1]);
    expect(list.sessions[0]?.excerpt).toBe('Brann kom.');

    const one = sessionResponseSchema.parse(
      (await call(cookie, 'GET', `/api/sessions/${a.session.id}`)).json(),
    );
    expect(one.session.body).toBe('Vi møttes.');

    expect((await call(cookie, 'DELETE', `/api/sessions/${a.session.id}`)).statusCode).toBe(204);
    expect((await call(cookie, 'GET', `/api/sessions/${a.session.id}`)).statusCode).toBe(404);
    expect((await call(cookie, 'DELETE', `/api/sessions/${a.session.id}`)).statusCode).toBe(404);
  });

  it('PUT øker versjonen og gir 409 med gjeldende rad ved gammel versjon', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { session } = await addSession(cookie, gameId, { body: 'a' });
    const put = (version: number, body: string) =>
      call(cookie, 'PUT', `/api/sessions/${session.id}`, {
        playedOn: '2026-11-02',
        title: 't',
        body,
        version,
      });
    const ok = sessionSaveResponseSchema.parse((await put(1, 'b')).json());
    expect(ok.session).toMatchObject({
      version: 2,
      body: 'b',
      playedOn: '2026-11-02',
      title: 't',
      number: 1,
    });

    const stale = await put(1, 'c');
    expect(stale.statusCode).toBe(409);
    const conflict = sessionConflictSchema.parse(stale.json());
    expect(conflict.error).toBe('version_conflict');
    expect(conflict.session).toMatchObject({ version: 2, body: 'b' });
  });

  it('number_taken ved opprettelse og endring, og ugyldig input gir 400', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const one = await addSession(cookie, gameId, { number: 5, body: 'x' });
    const two = await addSession(cookie, gameId, { body: 'y' });
    expect(two.session.number).toBe(6);

    const dup = await call(cookie, 'POST', `/api/games/${gameId}/sessions`, {
      playedOn: '2026-11-01',
      number: 5,
    });
    expect(dup.statusCode).toBe(409);
    expect(sessionConflictSchema.parse(dup.json())).toMatchObject({
      error: 'number_taken',
      session: { id: one.session.id },
    });

    const put = await call(cookie, 'PUT', `/api/sessions/${two.session.id}`, {
      playedOn: '2026-11-01',
      number: 5,
      title: '',
      body: 'y',
      version: 1,
    });
    expect(put.statusCode).toBe(409);
    expect(sessionConflictSchema.parse(put.json()).error).toBe('number_taken');

    expect(
      (await call(cookie, 'POST', `/api/games/${gameId}/sessions`, { playedOn: 'i dag' })).statusCode,
    ).toBe(400);
    expect(
      (await call(cookie, 'POST', `/api/games/${gameId}/sessions`, { playedOn: '2026-11-01', x: 1 }))
        .statusCode,
    ).toBe(400);
  });

  it('en 409 oppretter ingen oppføringer', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    await addSession(cookie, gameId, { number: 1 });
    const res = await call(cookie, 'POST', `/api/games/${gameId}/sessions`, {
      playedOn: '2026-11-01',
      number: 1,
      body: '@[Skygge](new)',
    });
    expect(res.statusCode).toBe(409);
    expect(await db.selectFrom('dd_entries').select('id').execute()).toHaveLength(0);
  });
});

describe('koblinger i tekst', () => {
  it('(new) oppretter, gjenbruker (også med ulik skrivemåte) og bytter med ID', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const first = await addSession(cookie, gameId, {
      body: '@[Brann Holt](new) og #[Eldmark](new) og ![finne karavanen](new) og @[Brann Holt](new).',
    });
    expect(first.createdEntries.map((e) => [e.kind, e.name, e.status])).toEqual([
      ['person', 'Brann Holt', null],
      ['place', 'Eldmark', null],
      ['quest', 'finne karavanen', 'active'],
    ]);
    const [brann, eld, quest] = first.createdEntries;
    expect(first.session.body).toBe(
      `@[Brann Holt](e:${brann?.id}) og #[Eldmark](e:${eld?.id}) og ![finne karavanen](e:${quest?.id}) og @[Brann Holt](e:${brann?.id}).`,
    );
    expect(first.session.body).not.toContain('(new)');
    expect((await mentionRows('session', first.session.id)).map((r) => r.entry_id)).toEqual(
      [brann?.id, eld?.id, quest?.id].sort((x, y) => (x ?? 0) - (y ?? 0)),
    );

    const second = await addSession(cookie, gameId, { body: '@[ BRANN holt ](new) igjen, @[Brånn](new) ny' });
    expect(second.createdEntries.map((e) => e.name)).toEqual(['Brånn']);
    expect(second.session.body).toContain(`](e:${brann?.id})`);

    // samme navn, men annen type, er en ny oppføring
    const third = await addSession(cookie, gameId, { body: '#[Brann Holt](new)' });
    expect(third.createdEntries).toHaveLength(1);
    expect(third.createdEntries[0]?.kind).toBe('place');
  });

  it('(new) kobler til eksisterende navn etter databasens kollasjon (å = a)', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { entry } = await addEntry(cookie, gameId, { kind: 'place', name: 'Håvik' });
    const s = await addSession(cookie, gameId, { body: '#[Havik](new)' });
    expect(s.createdEntries).toEqual([]);
    expect(s.session.body).toBe(`#[Havik](e:${entry.id})`);
  });

  it('ugyldige, fremmede og other-ID-er blir vanlig tekst, og prefikset rettes', async () => {
    const cookie = await login();
    const other = await login('b');
    const gameId = await newGame(cookie);
    const otherGame = await newGame(other);
    const place = (await addEntry(cookie, gameId, { kind: 'place', name: 'Eldmark' })).entry;
    const misc = (await addEntry(cookie, gameId, { kind: 'other', name: 'Tåken' })).entry;
    const foreign = (await addEntry(other, otherGame, { kind: 'person', name: 'Fremmed' })).entry;

    const s = await addSession(cookie, gameId, {
      body: `@[Eldmark](e:${place.id}) @[Tåken](e:${misc.id}) @[Fremmed](e:${foreign.id}) ![Spøkelse](e:999999) #[ok](e:${place.id})`,
    });
    expect(s.session.body).toBe(`#[Eldmark](e:${place.id}) Tåken Fremmed Spøkelse #[ok](e:${place.id})`);
    expect((await mentionRows('session', s.session.id)).map((r) => r.entry_id)).toEqual([place.id]);
    expect(await mentionRows('session', s.session.id)).toHaveLength(1);
    expect((await detail(other, foreign.id)).mentionedIn).toEqual([]);
  });

  it('en kobling til ukjent ID uten escaping blir bare teksten', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const s = await addSession(cookie, gameId, { body: 'Hei @[Ukjent](e:424242) og ![Quest](e:7)!' });
    expect(s.session.body).toBe('Hei Ukjent og Quest!');
    expect(await db.selectFrom('dd_mentions').select('entry_id').execute()).toHaveLength(0);
  });

  it('dd_mentions bygges på nytt ved PUT og ryddes ved sletting av økt og oppføring', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const s = await addSession(cookie, gameId, { body: '@[A](new) #[B](new)' });
    const [a, b] = s.createdEntries;
    expect(await mentionRows('session', s.session.id)).toHaveLength(2);

    const upd = await call(cookie, 'PUT', `/api/sessions/${s.session.id}`, {
      playedOn: '2026-11-01',
      title: '',
      body: `bare @[A](e:${a?.id})`,
      version: 1,
    });
    expect(upd.statusCode, upd.body).toBe(200);
    expect((await mentionRows('session', s.session.id)).map((r) => r.entry_id)).toEqual([a?.id]);
    expect((await detail(cookie, b?.id ?? 0)).mentionedIn).toEqual([]);
    const da = await detail(cookie, a?.id ?? 0);
    expect(da.mentionedIn).toMatchObject([{ sourceType: 'session', sourceId: s.session.id, number: 1 }]);

    await call(cookie, 'DELETE', `/api/sessions/${s.session.id}`);
    expect(await db.selectFrom('dd_mentions').select('entry_id').execute()).toHaveLength(0);

    const e = await addEntry(cookie, gameId, { kind: 'quest', name: 'Q', body: `se @[A](e:${a?.id})` });
    expect(await mentionRows('entry', e.entry.id)).toHaveLength(1);
    await call(cookie, 'DELETE', `/api/entries/${e.entry.id}`);
    expect(await db.selectFrom('dd_mentions').select('entry_id').execute()).toHaveLength(0);
  });
});

describe('oppføringer', () => {
  it('CRUD med felter per type, liste med antall og filtre', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const place = (await addEntry(cookie, gameId, { kind: 'place', name: 'Eldmark', fields: { type: 'by' } }))
      .entry;
    const person = (
      await addEntry(cookie, gameId, {
        kind: 'person',
        name: 'Brann',
        summary: 'Smed',
        fields: { role: 'smed', attitude: 'friend', placeEntryId: place.id },
      })
    ).entry;
    const quest = (
      await addEntry(cookie, gameId, {
        kind: 'quest',
        name: 'Karavanen',
        status: 'open',
        fields: { giverEntryId: person.id, placeEntryIds: [place.id], reward: '50 gp' },
      })
    ).entry;
    expect(quest).toMatchObject({ status: 'open', version: 1, archived: false, body: '' });
    expect(person.status).toBeNull();

    const upd = await call(cookie, 'PUT', `/api/entries/${quest.id}`, {
      name: 'Karavanen',
      summary: 'fortsatt',
      body: '',
      status: 'done',
      fields: { reward: '60 gp' },
      archived: true,
      version: 1,
    });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(entrySaveResponseSchema.parse(upd.json()).entry).toMatchObject({
      status: 'done',
      archived: true,
      version: 2,
      fields: { reward: '60 gp' },
    });

    const active = entriesResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/entries`)).json(),
    );
    expect(active.entries.map((e) => e.name)).toEqual(['Brann', 'Eldmark']);
    expect(active.counts).toEqual({ quest: 0, person: 1, place: 1, other: 0 });
    const archived = entriesResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/entries?show=archived`)).json(),
    );
    expect(archived.entries.map((e) => e.name)).toEqual(['Karavanen']);
    const places = entriesResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/entries?kind=place&show=all`)).json(),
    );
    expect(places.entries.map((e) => e.name)).toEqual(['Eldmark']);
    expect((await call(cookie, 'GET', `/api/games/${gameId}/entries?kind=hest`)).statusCode).toBe(400);

    expect((await call(cookie, 'DELETE', `/api/entries/${quest.id}`)).statusCode).toBe(204);
    expect((await call(cookie, 'GET', `/api/entries/${quest.id}`)).statusCode).toBe(404);
  });

  it('PUT: 409 ved versjon, kind kan ikke endres, ukjent felt gir 400', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { entry } = await addEntry(cookie, gameId, { kind: 'person', name: 'Brann' });
    const body = { name: 'Brann', summary: '', body: '', fields: {}, version: 1 };
    expect((await call(cookie, 'PUT', `/api/entries/${entry.id}`, body)).statusCode).toBe(200);
    const stale = await call(cookie, 'PUT', `/api/entries/${entry.id}`, { ...body, summary: 'x' });
    expect(stale.statusCode).toBe(409);
    expect(entryConflictSchema.parse(stale.json())).toMatchObject({
      error: 'version_conflict',
      entry: { id: entry.id, version: 2 },
    });
    expect(
      (await call(cookie, 'PUT', `/api/entries/${entry.id}`, { ...body, version: 2, kind: 'place' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(cookie, 'PUT', `/api/entries/${entry.id}`, { ...body, version: 2, status: 'done' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(cookie, 'PUT', `/api/entries/${entry.id}`, {
          ...body,
          version: 2,
          fields: { giverEntryId: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('name_taken (uten hensyn til store/små bokstaver og aksenter) ved POST og PUT, og aldri 500 ved samtidige POST', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { entry } = await addEntry(cookie, gameId, { kind: 'person', name: 'Brann' });
    const other = (await addEntry(cookie, gameId, { kind: 'person', name: 'Siri' })).entry;
    const dup = await call(cookie, 'POST', `/api/games/${gameId}/entries`, { kind: 'person', name: 'BRÅNN' });
    expect(dup.statusCode).toBe(409);
    expect(entryConflictSchema.parse(dup.json())).toMatchObject({
      error: 'name_taken',
      entry: { id: entry.id },
    });
    // samme navn med annen type er greit
    await addEntry(cookie, gameId, { kind: 'place', name: 'Brann' });

    const rename = await call(cookie, 'PUT', `/api/entries/${other.id}`, {
      name: 'brann',
      summary: '',
      body: '',
      fields: {},
      version: 1,
    });
    expect(rename.statusCode).toBe(409);
    expect(entryConflictSchema.parse(rename.json()).error).toBe('name_taken');

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        call(cookie, 'POST', `/api/games/${gameId}/entries`, { kind: 'place', name: 'Ny' }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    const viaText = await Promise.all(
      Array.from({ length: 6 }, () => addSession(cookie, gameId, { body: '#[Felles](new)' })),
    );
    expect(new Set(viaText.flatMap((r) => r.createdEntries.map((e) => e.id))).size).toBe(1);
    expect(new Set(viaText.map((r) => r.session.body.match(/e:(\d+)/)?.[1])).size).toBe(1);
  });

  it('fields med ID fra et annet spill gir 400', async () => {
    const cookie = await login();
    const other = await login('b');
    const gameId = await newGame(cookie);
    const otherGame = await newGame(other);
    const foreign = (await addEntry(other, otherGame, { kind: 'place', name: 'Borte' })).entry;
    for (const fields of [{ placeEntryId: foreign.id }]) {
      const res = await call(cookie, 'POST', `/api/games/${gameId}/entries`, {
        kind: 'person',
        name: 'X',
        fields,
      });
      expect(res.statusCode).toBe(400);
    }
    const q = await call(cookie, 'POST', `/api/games/${gameId}/entries`, {
      kind: 'quest',
      name: 'Q',
      fields: { placeEntryIds: [foreign.id] },
    });
    expect(q.statusCode).toBe(400);
    expect(
      await db.selectFrom('dd_entries').select('id').where('game_id', '=', gameId).execute(),
    ).toHaveLength(0);
  });

  it('body på en oppføring: (new) opprettes, selvomtale telles ikke, og «nevnt i» viser økter og oppføringer', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { entry, createdEntries } = await addEntry(cookie, gameId, {
      kind: 'person',
      name: 'Brann',
      body: 'Kjenner @[Brann](new) og #[Eldmark](new)',
    });
    expect(createdEntries.map((e) => e.name)).toEqual(['Eldmark']);
    expect(entry.body).toMatch(/^Kjenner @\[Brann]\(e:\d+\) og #\[Eldmark]\(e:\d+\)$/);
    const eld = createdEntries[0];
    expect((await mentionRows('entry', entry.id)).map((r) => r.entry_id)).toEqual([eld?.id]);

    const s1 = await addSession(cookie, gameId, { playedOn: '2026-10-01', body: `#[Eldmark](e:${eld?.id})` });
    const s2 = await addSession(cookie, gameId, { playedOn: '2026-11-01', body: `#[Eldmark](e:${eld?.id})` });
    const d = await detail(cookie, eld?.id ?? 0);
    expect(
      d.mentionedIn.map((m) => (m.sourceType === 'session' ? `s${m.sourceId}` : `e${m.sourceId}`)),
    ).toEqual([`s${s2.session.id}`, `s${s1.session.id}`, `e${entry.id}`]);
    expect(d.mentionedIn[0]).toMatchObject({ sourceType: 'session', number: 2, playedOn: '2026-11-01' });
    expect(d.mentionedIn[2]).toMatchObject({ sourceType: 'entry', kind: 'person', name: 'Brann' });
    expect((await detail(cookie, entry.id)).mentionedIn).toEqual([]);
  });
});

describe('rettinger etter validering', () => {
  /** Nok oppføringer til at ID-ene har minst to sifre, så (new) blir lengre som (e:ID). */
  async function padIds(cookie: string, gameId: number) {
    for (let i = 0; i < 10; i += 1) await addEntry(cookie, gameId, { kind: 'other', name: `Fyll ${i}` });
  }
  const bigBody = '![Q](new)'.repeat(11_111);

  it('PUT med nytt navn og (new) med det navnet kobles til seg selv, uten 500', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const { entry } = await addEntry(cookie, gameId, { kind: 'person', name: 'Bob' });
    const res = await call(cookie, 'PUT', `/api/entries/${entry.id}`, {
      name: 'Robert',
      summary: '',
      body: 'Kalt @[Robert](new)',
      fields: {},
      version: 1,
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved = entrySaveResponseSchema.parse(res.json());
    expect(saved.createdEntries).toEqual([]);
    expect(saved.entry).toMatchObject({ name: 'Robert', body: `Kalt @[Robert](e:${entry.id})`, version: 2 });
    expect(await mentionRows('entry', entry.id)).toEqual([]);
    expect(await db.selectFrom('dd_entries').select('id').execute()).toHaveLength(1);
  });

  it('for lang tekst etter omskriving gir 422 body_too_long uten endringer', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    await padIds(cookie, gameId);
    const before = (await db.selectFrom('dd_entries').select('id').execute()).length;
    const calls = [
      call(cookie, 'POST', `/api/games/${gameId}/sessions`, { playedOn: '2026-11-01', body: bigBody }),
      call(cookie, 'POST', `/api/games/${gameId}/entries`, { kind: 'person', name: 'Stor', body: bigBody }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.statusCode, res.body.slice(0, 200)).toBe(422);
      expect(res.json()).toMatchObject({ error: 'body_too_long', max: BODY_MAX });
    }
    const s = await addSession(cookie, gameId, { body: 'kort' });
    const e = (await addEntry(cookie, gameId, { kind: 'person', name: 'Liten' })).entry;
    const putS = await call(cookie, 'PUT', `/api/sessions/${s.session.id}`, {
      playedOn: '2026-11-01',
      title: '',
      body: bigBody,
      version: 1,
    });
    const putE = await call(cookie, 'PUT', `/api/entries/${e.id}`, {
      name: 'Liten',
      summary: '',
      body: bigBody,
      fields: {},
      version: 1,
    });
    expect(putS.statusCode).toBe(422);
    expect(putE.statusCode).toBe(422);
    expect(await db.selectFrom('dd_entries').select('id').execute()).toHaveLength(before + 1);
    expect(await db.selectFrom('dd_sessions').select('id').execute()).toHaveLength(1);
    const still = sessionResponseSchema.parse(
      (await call(cookie, 'GET', `/api/sessions/${s.session.id}`)).json(),
    );
    expect(still.session).toMatchObject({ version: 1, body: 'kort' });
    expect((await detail(cookie, e.id)).entry).toMatchObject({ version: 1, body: '' });
  });

  it('en kobling som ikke endres, skrives ut likt (også med escapet tekst)', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const a = await addSession(cookie, gameId, { body: String.raw`@[a\]b\\c](new) og @[a\]b\\c](new)` });
    const id = a.createdEntries[0]?.id;
    expect(a.createdEntries[0]?.name).toBe(String.raw`a]b\c`);
    expect(a.session.body).toBe(String.raw`@[a\]b\\c](e:${id}) og @[a\]b\\c](e:${id})`);
    const put = await call(cookie, 'PUT', `/api/sessions/${a.session.id}`, {
      playedOn: '2026-11-01',
      title: '',
      body: a.session.body,
      version: 1,
    });
    expect(sessionSaveResponseSchema.parse(put.json()).session.body).toBe(a.session.body);
    // prefikset rettes, og escapingen står igjen riktig
    const fix = await addSession(cookie, gameId, { body: String.raw`#[a\]b\\c](e:${id})` });
    expect(fix.session.body).toBe(String.raw`@[a\]b\\c](e:${id})`);
  });

  it('slettede ID-er i fields fjernes stille ved lagring', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const gone = (await addEntry(cookie, gameId, { kind: 'place', name: 'Borte' })).entry;
    const kept = (await addEntry(cookie, gameId, { kind: 'place', name: 'Igjen' })).entry;
    const giver = (await addEntry(cookie, gameId, { kind: 'person', name: 'Gir' })).entry;
    const person = (
      await addEntry(cookie, gameId, { kind: 'person', name: 'Brann', fields: { placeEntryId: gone.id } })
    ).entry;
    const quest = (
      await addEntry(cookie, gameId, {
        kind: 'quest',
        name: 'Q',
        fields: { giverEntryId: giver.id, placeEntryIds: [gone.id, kept.id] },
      })
    ).entry;
    await call(cookie, 'DELETE', `/api/entries/${gone.id}`);
    await call(cookie, 'DELETE', `/api/entries/${giver.id}`);
    const putP = await call(cookie, 'PUT', `/api/entries/${person.id}`, {
      name: 'Brann',
      summary: '',
      body: '',
      fields: { placeEntryId: gone.id },
      version: 1,
    });
    expect(putP.statusCode, putP.body).toBe(200);
    expect(entrySaveResponseSchema.parse(putP.json()).entry.fields).toEqual({});
    const putQ = await call(cookie, 'PUT', `/api/entries/${quest.id}`, {
      name: 'Q',
      summary: '',
      body: '',
      status: 'active',
      fields: { giverEntryId: giver.id, placeEntryIds: [gone.id, kept.id] },
      version: 1,
    });
    expect(putQ.statusCode, putQ.body).toBe(200);
    expect(entrySaveResponseSchema.parse(putQ.json()).entry.fields).toEqual({ placeEntryIds: [kept.id] });
  });

  it('ID-er i fields må ha riktig type', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const place = (await addEntry(cookie, gameId, { kind: 'place', name: 'Sted' })).entry;
    const person = (await addEntry(cookie, gameId, { kind: 'person', name: 'Person' })).entry;
    const post = (body: Record<string, unknown>) =>
      call(cookie, 'POST', `/api/games/${gameId}/entries`, body);
    expect((await post({ kind: 'quest', name: 'A', fields: { giverEntryId: place.id } })).statusCode).toBe(
      400,
    );
    expect(
      (await post({ kind: 'quest', name: 'B', fields: { placeEntryIds: [person.id] } })).statusCode,
    ).toBe(400);
    expect((await post({ kind: 'person', name: 'C', fields: { placeEntryId: person.id } })).statusCode).toBe(
      400,
    );
    expect((await post({ kind: 'place', name: 'D', fields: { parentEntryId: person.id } })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post({
          kind: 'quest',
          name: 'E',
          fields: { giverEntryId: person.id, placeEntryIds: [place.id] },
        })
      ).statusCode,
    ).toBe(201);
    expect((await post({ kind: 'place', name: 'F', fields: { parentEntryId: place.id } })).statusCode).toBe(
      201,
    );
  });

  it('5 000 nye koblinger lagres raskt', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const body = Array.from({ length: 5000 }, (_, i) => `@[P${i}](new)`).join(' ');
    const t0 = Date.now();
    const res = await call(cookie, 'POST', `/api/games/${gameId}/sessions`, { playedOn: '2026-11-01', body });
    const ms = Date.now() - t0;
    expect(res.statusCode, res.body.slice(0, 200)).toBe(201);
    const saved = sessionSaveResponseSchema.parse(res.json());
    expect(saved.createdEntries).toHaveLength(5000);
    expect(saved.createdEntries[0]?.name).toBe('P0');
    expect(saved.createdEntries[4999]?.name).toBe('P4999');
    expect(await mentionRows('session', saved.session.id)).toHaveLength(5000);
    expect(ms).toBeLessThan(2000);
    // gjenbruk av de samme 5 000
    const again = await call(cookie, 'POST', `/api/games/${gameId}/sessions`, {
      playedOn: '2026-11-02',
      body,
    });
    expect(sessionSaveResponseSchema.parse(again.json()).createdEntries).toEqual([]);
  });
});

describe('søk', () => {
  async function seed(cookie: string) {
    const gameId = await newGame(cookie);
    await addSession(cookie, gameId, {
      title: 'Ved porten',
      body: 'Vi lette etter ![karavanen](new) og møtte @[Brann Holt](new). 100% sikker på a_b.',
    });
    await addSession(cookie, gameId, { title: 'Annet', body: 'Ingenting om det der.' });
    return gameId;
  }

  it('finner økter og oppføringer med prefiks, uten koblingsformat i utdraget', async () => {
    const cookie = await login();
    const gameId = await seed(cookie);
    const res = searchResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/search?q=karavan`)).json(),
    );
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]?.title).toBe('Ved porten');
    expect(res.sessions[0]?.excerpt).toContain('karavanen');
    expect(res.sessions[0]?.excerpt).not.toMatch(/\]\(|!\[/);
    expect(res.entries.map((e) => e.name)).toEqual(['karavanen']);
    expect(res.entries[0]).toMatchObject({ kind: 'quest', archived: false });
  });

  it('korte ord bruker LIKE, og % _ \\ matcher bare seg selv', async () => {
    const cookie = await login();
    const gameId = await seed(cookie);
    const search = async (q: string) =>
      searchResponseSchema.parse(
        (await call(cookie, 'GET', `/api/games/${gameId}/search?q=${encodeURIComponent(q)}`)).json(),
      );
    expect((await search('Br')).entries.map((e) => e.name)).toEqual(['Brann Holt']);
    expect((await search('a_b')).sessions).toHaveLength(1);
    expect((await search('%')).sessions).toEqual([]);
    // `_` er et jokertegn i LIKE; escapet matcher det bare det ene som har en understrek
    expect((await search('_')).sessions).toHaveLength(1);
    expect((await search('\\')).sessions).toEqual([]);
    expect((await search('100%')).sessions).toHaveLength(1);
  });

  it('tomt, bare operatorer og spesialtegn gir tomt svar eller treff, aldri SQL-feil', async () => {
    const cookie = await login();
    const gameId = await seed(cookie);
    const empty = { sessions: [], entries: [] };
    for (const q of ['', '   ', '+-<>()~*"@', '"', '*', '@@', '++++', '()', '-']) {
      const res = await call(cookie, 'GET', `/api/games/${gameId}/search?q=${encodeURIComponent(q)}`);
      expect(res.statusCode, q).toBe(200);
      expect(res.json(), q).toEqual(empty);
    }
    expect((await call(cookie, 'GET', `/api/games/${gameId}/search`)).json()).toEqual(empty);
    for (const q of [
      '+karavan -foo',
      '"karavan"',
      '(karavan)*',
      '>karavan <x ~y @brann',
      "o'brien",
      'karavan\n',
    ]) {
      const res = await call(cookie, 'GET', `/api/games/${gameId}/search?q=${encodeURIComponent(q)}`);
      expect(res.statusCode, q).toBe(200);
      searchResponseSchema.parse(res.json());
    }
    const plus = searchResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/search?q=${encodeURIComponent('+karavan*')}`)).json(),
    );
    expect(plus.sessions).toHaveLength(1);
    expect((await call(cookie, 'GET', `/api/games/${gameId}/search?q=${'a'.repeat(201)}`)).statusCode).toBe(
      400,
    );
  });

  it('gir høyst 50 treff til sammen og søker bare i eget spill', async () => {
    const cookie = await login();
    const other = await login('b');
    const gameId = await newGame(cookie);
    const otherGame = await newGame(other);
    for (let i = 0; i < 30; i += 1) {
      await addSession(cookie, gameId, { body: 'dragefjell' });
      await addEntry(cookie, gameId, { kind: 'other', name: `Dragefjell ${i}` });
    }
    await addSession(other, otherGame, { body: 'dragefjell' });
    const res = searchResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${gameId}/search?q=drage`)).json(),
    );
    expect(res.sessions.length + res.entries.length).toBe(50);
    const mine = searchResponseSchema.parse(
      (await call(other, 'GET', `/api/games/${otherGame}/search?q=drage`)).json(),
    );
    expect(mine.sessions).toHaveLength(1);
    expect(mine.entries).toHaveLength(0);
  });
});

describe('suggest', () => {
  it('gir de sist endrede uten q, filtrerer på navn og type, og hopper over arkiverte', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    await addEntry(cookie, gameId, { kind: 'person', name: 'Brann Holt' });
    await addEntry(cookie, gameId, { kind: 'person', name: 'Siri Brannvik' });
    await addEntry(cookie, gameId, { kind: 'person', name: 'Gammel', archived: true });
    await addEntry(cookie, gameId, { kind: 'place', name: 'Brannfjell' });
    const get = async (qs: string) =>
      suggestResponseSchema.parse(
        (await call(cookie, 'GET', `/api/games/${gameId}/entries/suggest?${qs}`)).json(),
      );
    expect((await get('kind=person')).suggestions.map((s) => s.name).sort()).toEqual([
      'Brann Holt',
      'Siri Brannvik',
    ]);
    expect((await get('kind=person&q=brann')).suggestions.map((s) => s.name)).toEqual([
      'Brann Holt',
      'Siri Brannvik',
    ]);
    expect((await get('kind=person&q=%25')).suggestions).toEqual([]);
    expect((await get('kind=place&q=brann')).suggestions).toMatchObject([
      { kind: 'place', name: 'Brannfjell' },
    ]);
    expect((await call(cookie, 'GET', `/api/games/${gameId}/entries/suggest`)).statusCode).toBe(400);

    for (let i = 0; i < 12; i += 1) await addEntry(cookie, gameId, { kind: 'quest', name: `Q${i}` });
    expect((await get('kind=quest')).suggestions).toHaveLength(10);
  });
});

describe('hurtignotat (append)', () => {
  const append = (cookie: string, gameId: number, text: string, playedOn = '2026-11-06') =>
    call(cookie, 'POST', `/api/games/${gameId}/sessions/today/append`, { text, playedOn });

  it('lager en ny økt med neste nummer, og legger til i eksisterende med økt versjon', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    await addSession(cookie, gameId, { playedOn: '2026-10-01', body: 'gammel' });
    const first = sessionSaveResponseSchema.parse(
      (await append(cookie, gameId, 'Møtte @[Siri](new)')).json(),
    );
    expect(first.session).toMatchObject({ number: 2, playedOn: '2026-11-06', version: 1, title: '' });
    expect(first.createdEntries.map((e) => e.name)).toEqual(['Siri']);

    const second = sessionSaveResponseSchema.parse((await append(cookie, gameId, '  Mer tekst  ')).json());
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.version).toBe(2);
    expect(second.session.body).toBe(`${first.session.body}\nMer tekst`);
    expect((await mentionRows('session', first.session.id)).map((r) => r.entry_id)).toEqual([
      first.createdEntries[0]?.id,
    ]);

    // flere økter samme dato: den med høyest nummer får notatet
    const dup = await addSession(cookie, gameId, { playedOn: '2026-11-06', number: 9, body: '' });
    const third = sessionSaveResponseSchema.parse((await append(cookie, gameId, 'til nr 9')).json());
    expect(third.session.id).toBe(dup.session.id);
    expect(third.session.body).toBe('til nr 9');
  });

  it('body_too_long gir 422 og endrer ingenting, heller ikke oppføringer', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    const s = await addSession(cookie, gameId, { body: 'x'.repeat(BODY_MAX - 5), playedOn: '2026-11-06' });
    const res = await append(cookie, gameId, '@[Skygge](new) og mer');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'body_too_long', max: BODY_MAX });
    expect(await db.selectFrom('dd_entries').select('id').execute()).toHaveLength(0);
    const after = sessionResponseSchema.parse(
      (await call(cookie, 'GET', `/api/sessions/${s.session.id}`)).json(),
    );
    expect(after.session).toMatchObject({ version: 1, body: 'x'.repeat(BODY_MAX - 5) });

    const ok = await append(cookie, gameId, 'abcde');
    expect(ok.statusCode).toBe(422); // en linjeskift til gjør den for lang
    expect((await append(cookie, gameId, 'abc')).statusCode).toBe(200);
  });

  it('ugyldig input gir 400', async () => {
    const cookie = await login();
    const gameId = await newGame(cookie);
    expect((await append(cookie, gameId, '   ')).statusCode).toBe(400);
    expect((await append(cookie, gameId, 'x', 'i dag')).statusCode).toBe(400);
  });
});

describe('andres data', () => {
  it('bruker 2 får 404 på alt fra bruker 1', async () => {
    const one = await login('a');
    const two = await login('b');
    const gameId = await newGame(one);
    const s = await addSession(one, gameId, { body: '@[Brann](new)' });
    const e = s.createdEntries[0];
    const sBody = { playedOn: '2026-11-01', title: '', body: 'hacked', version: 1 };
    const eBody = { name: 'Brann', summary: '', body: 'hacked', fields: {}, version: 1 };
    const requests: [Method, string, unknown?][] = [
      ['GET', `/api/games/${gameId}/sessions`],
      ['POST', `/api/games/${gameId}/sessions`, { playedOn: '2026-11-01', body: '@[Y](new)' }],
      ['POST', `/api/games/${gameId}/sessions/today/append`, { text: 'x', playedOn: '2026-11-01' }],
      ['GET', `/api/sessions/${s.session.id}`],
      ['PUT', `/api/sessions/${s.session.id}`, sBody],
      ['DELETE', `/api/sessions/${s.session.id}`],
      ['GET', `/api/games/${gameId}/entries`],
      ['POST', `/api/games/${gameId}/entries`, { kind: 'person', name: 'Y' }],
      ['GET', `/api/games/${gameId}/entries/suggest?kind=person`],
      ['GET', `/api/entries/${e?.id}`],
      ['PUT', `/api/entries/${e?.id}`, eBody],
      ['DELETE', `/api/entries/${e?.id}`],
      ['GET', `/api/games/${gameId}/search?q=Brann`],
    ];
    for (const [method, url, payload] of requests) {
      const res = await call(two, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // ingenting ble endret
    const rows = await db.selectFrom('dd_entries').select(['name', 'body']).execute();
    expect(rows).toHaveLength(1);
    const still = sessionResponseSchema.parse(
      (await call(one, 'GET', `/api/sessions/${s.session.id}`)).json(),
    );
    expect(still.session.version).toBe(1);
    expect((await call(one, 'GET', `/api/entries/${e?.id}`)).statusCode).toBe(200);
  });

  it('ugyldig ID i stien gir 404', async () => {
    const cookie = await login();
    expect((await call(cookie, 'GET', '/api/sessions/abc')).statusCode).toBe(404);
    expect((await call(cookie, 'GET', '/api/entries/0')).statusCode).toBe(404);
  });
});

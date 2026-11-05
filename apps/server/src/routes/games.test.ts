import { DERIVE_VERSION, DDB_FORMAT_MESSAGE, applyDamage, type GameState, type Sheet } from '@dnd/rules';
import {
  ddbPreviewResponseSchema,
  gameDetailResponseSchema,
  gameStateEnvelopeSchema,
  gamesResponseSchema,
  refreshCharacterResponseSchema,
  stateConflictSchema,
} from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { PASTE_FORMAT_MESSAGE } from '../http/errors.ts';
import type { Db } from '../db/index.ts';
import {
  ELOWEN_ID,
  LEGO_ID,
  WRITE_HEADERS,
  clearData,
  ddbFixture,
  fakeDdb,
  fakeGoogle,
  freshTestDb,
  sessionCookieFrom,
  testConfig,
  type FakeDdb,
} from '../test/helpers.ts';

let db: Db;
let app: FastifyInstance;
let ddb: FakeDdb;
let clock: number;
let logs: string[];

beforeAll(async () => {
  db = await freshTestDb(testConfig());
});

beforeEach(async () => {
  await clearData(db);
  ddb = fakeDdb();
  clock = 1_000_000;
  logs = [];
  app = await buildApp(testConfig(), {
    db,
    logger: {
      level: 'info',
      stream: new Writable({
        write(chunk: Buffer, _enc, done) {
          logs.push(chunk.toString());
          done();
        },
      }),
    },
    verifyGoogleToken: fakeGoogle(),
    ddbFetch: ddb.fetch,
    now: () => clock,
  });
});

afterEach(async () => {
  await app?.close();
});

afterAll(async () => {
  await db?.destroy();
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

async function create(cookie: string, ddbUrlOrId = String(ELOWEN_ID), name = 'Icewind Dale') {
  const res = await call(cookie, 'POST', '/api/games', { name, ddbUrlOrId });
  expect(res.statusCode, res.body).toBe(201);
  return gameDetailResponseSchema.parse(res.json());
}

describe('innlogging', () => {
  it.each<[Method, string]>([
    ['POST', '/api/ddb/preview'],
    ['GET', '/api/games'],
    ['POST', '/api/games'],
    ['GET', '/api/games/1'],
    ['PATCH', '/api/games/1'],
    ['DELETE', '/api/games/1'],
    ['POST', '/api/games/1/character/refresh'],
    ['POST', '/api/games/1/character/paste'],
    ['GET', '/api/games/1/state'],
    ['PUT', '/api/games/1/state'],
  ])('%s %s krever innlogging', async (method, url) => {
    const res = await call(null, method, url, method === 'GET' ? undefined : {});
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/ddb/preview', () => {
  it('gir sammendrag og hele arket', async () => {
    const cookie = await login();
    const res = await call(cookie, 'POST', '/api/ddb/preview', {
      ddbUrlOrId: `https://www.dndbeyond.com/characters/${ELOWEN_ID}/abc`,
    });
    expect(res.statusCode).toBe(200);
    const body = ddbPreviewResponseSchema.parse(res.json());
    expect(body.character).toMatchObject({ hpMax: 40, ac: 14, level: 4 });
    expect(body.character.summary).toContain('Ranger 4');
    expect(body.sheet.initiative).toBe(6);
  });

  it.each<[string, number | undefined, number, string, string]>([
    [
      '403',
      403,
      422,
      'ddb_private',
      'Karakteren er privat. Sett Character Privacy til Public på D&D Beyond.',
    ],
    ['404', undefined, 422, 'ddb_not_found', 'Fant ikke karakteren på D&D Beyond. Sjekk lenken eller ID-en.'],
    [
      '500',
      500,
      502,
      'ddb_unavailable',
      'D&D Beyond svarer ikke akkurat nå. Prøv igjen om litt, eller bruk lim inn.',
    ],
  ])('gir norsk feil for %s fra D&D Beyond', async (_n, upstream, status, error, message) => {
    if (upstream !== undefined) ddb.responses.set(77, upstream);
    const cookie = await login();
    const res = await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: '77' });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error, message });
  });

  it('gir norsk feil for ukjent format og ugyldig lenke', async () => {
    ddb.responses.set(78, { data: { stats: [] } });
    const cookie = await login();
    const bad = await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: '78' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toEqual({ error: 'ddb_format', message: DDB_FORMAT_MESSAGE });
    const ref = await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: 'https://example.com/1' });
    expect(ref.statusCode).toBe(400);
    expect(ref.json().error).toBe('ddb_invalid_ref');
    expect((await call(cookie, 'POST', '/api/ddb/preview', {})).statusCode).toBe(400);
  });

  it('bufrer, og gir 429 med norsk melding etter 10 hentinger i timen', async () => {
    const cookie = await login();
    // Treff i bufferen teller ikke.
    for (let i = 0; i < 5; i++) {
      expect(
        (await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: String(ELOWEN_ID) })).statusCode,
      ).toBe(200);
    }
    expect(ddb.calls).toHaveLength(1);
    for (let id = 1; id <= 9; id++) ddb.responses.set(id, ddbFixture('lego-ranger-5'));
    for (let id = 1; id <= 9; id++) {
      expect((await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: String(id) })).statusCode).toBe(
        200,
      );
    }
    expect(ddb.calls).toHaveLength(10);
    const res = await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: String(LEGO_ID) });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('3600');
    expect(res.json()).toEqual({
      error: 'ddb_rate_limited',
      message: 'Du har hentet fra D&D Beyond for mange ganger den siste timen. Prøv igjen om 60 minutter.',
    });
    expect(ddb.calls).toHaveLength(10);
    // Bufferen virker fortsatt, og en annen bruker har sin egen grense.
    expect((await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: '1' })).statusCode).toBe(200);
    const other = await login('b');
    expect((await call(other, 'POST', '/api/ddb/preview', { ddbUrlOrId: String(LEGO_ID) })).statusCode).toBe(
      200,
    );
    // Etter en time er grensen tilbake.
    clock += 60 * 60 * 1000 + 1;
    expect((await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: '1' })).statusCode).toBe(200);
  });
});

describe('spill', () => {
  it('oppretter med karakter og starttilstand, og lister', async () => {
    const cookie = await login();
    const created = await create(cookie);
    expect(created.game).toMatchObject({ name: 'Icewind Dale', status: 'active', cover: 'pergament' });
    expect(created.game.character).toMatchObject({
      hpMax: 40,
      ac: 14,
      level: 4,
      deriveVersion: DERIVE_VERSION,
      outdated: false,
    });
    expect(created.sheet?.hpMax).toBe(40);
    expect(created.state.version).toBe(1);
    expect(created.state.state.hpRemoved).toBe(9);

    const row = await db.selectFrom('dd_characters').selectAll().executeTakeFirstOrThrow();
    expect(row.ddb_id).toBe(ELOWEN_ID);
    expect(row.derive_version).toBe(DERIVE_VERSION);
    expect(row.derived.hpMax).toBe(40);

    await create(cookie, String(LEGO_ID), 'Lego-eventyret');
    const list = gamesResponseSchema.parse((await call(cookie, 'GET', '/api/games')).json());
    expect(list.games.map((g) => g.name).sort()).toEqual(['Icewind Dale', 'Lego-eventyret']);
  });

  it('gjenbruker karakterraden for samme D&D Beyond-ID og oppdaterer arket', async () => {
    const cookie = await login();
    const a = await create(cookie);
    await db.updateTable('dd_characters').set({ summary: 'gammel' }).execute();
    const b = await create(cookie, String(ELOWEN_ID), 'Annet spill');
    expect(b.game.character?.id).toBe(a.game.character?.id);
    const rows = await db.selectFrom('dd_characters').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).not.toBe('gammel');
  });

  it('oppretter fra innlimt JSON uten å hente fra D&D Beyond', async () => {
    const cookie = await login();
    const asText = await call(cookie, 'POST', '/api/games', {
      name: 'Limt inn',
      json: JSON.stringify(ddbFixture('elowen-4')),
      cover: 'frost',
    });
    expect(asText.statusCode, asText.body).toBe(201);
    const body = gameDetailResponseSchema.parse(asText.json());
    expect(body.game).toMatchObject({ name: 'Limt inn', cover: 'frost' });
    expect(body.game.character?.hpMax).toBe(40);
    expect(body.state.state.hpRemoved).toBe(9);
    // Samme karakter fra objekt gjenbruker raden.
    const asObj = await call(cookie, 'POST', '/api/games', { name: 'To', json: ddbFixture('elowen-4') });
    expect(gameDetailResponseSchema.parse(asObj.json()).game.character?.id).toBe(body.game.character?.id);
    expect(ddb.calls).toHaveLength(0);
    // Stor innliming (1,5 MB) går gjennom.
    const big = { ...ddbFixture('lego-ranger-5'), padding: 'x'.repeat(1_500_000) };
    expect((await call(cookie, 'POST', '/api/games', { name: 'Stor', json: big })).statusCode).toBe(201);
  });

  it('opprett med innliming: norske feil, og ikke både lenke og JSON', async () => {
    const cookie = await login();
    const both = await call(cookie, 'POST', '/api/games', {
      name: 'x',
      ddbUrlOrId: String(ELOWEN_ID),
      json: ddbFixture('elowen-4'),
    });
    expect(both.statusCode).toBe(400);
    expect((await call(cookie, 'POST', '/api/games', { name: 'x' })).statusCode).toBe(400);
    const notJson = await call(cookie, 'POST', '/api/games', { name: 'x', json: '{tull' });
    expect(notJson.json().error).toBe('paste_invalid_json');
    const format = await call(cookie, 'POST', '/api/games', { name: 'x', json: { foo: 1 } });
    expect(format.statusCode).toBe(422);
    expect(format.json()).toEqual({ error: 'ddb_format', message: PASTE_FORMAT_MESSAGE });
    // Uten ID i rådataene kan karakteren ikke lagres.
    const raw = ddbFixture('elowen-4') as { data: Record<string, unknown> };
    delete raw.data.id;
    const noId = await call(cookie, 'POST', '/api/games', { name: 'x', json: raw });
    expect(noId.statusCode).toBe(422);
    expect(await db.selectFrom('dd_games').select('id').execute()).toHaveLength(0);
  });

  it('logger statusen fra D&D Beyond ved ddb_unavailable, men aldri ID-en', async () => {
    ddb.responses.set(987654321, 503);
    const cookie = await login();
    const res = await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: '987654321' });
    expect(res.statusCode).toBe(502);
    const line = logs.find((l) => l.includes('ddb_unavailable'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ ddbError: 'ddb_unavailable', ddbStatus: 503 });
    expect(logs.join('\n')).not.toContain('987654321');
  });

  it('validerer navn og cover', async () => {
    const cookie = await login();
    expect((await call(cookie, 'POST', '/api/games', { name: '', ddbUrlOrId: '1' })).statusCode).toBe(400);
    expect(
      (await call(cookie, 'POST', '/api/games', { name: 'x', ddbUrlOrId: String(ELOWEN_ID), cover: 'rosa' }))
        .statusCode,
    ).toBe(400);
  });

  it('PATCH endrer navn, status og cover, og arkiverte havner sist', async () => {
    const cookie = await login();
    const a = await create(cookie);
    await create(cookie, String(LEGO_ID), 'Lego');
    const res = await call(cookie, 'PATCH', `/api/games/${a.game.id}`, {
      name: 'Nytt navn',
      status: 'archived',
      cover: 'frost',
    });
    expect(res.statusCode).toBe(200);
    expect(gameDetailResponseSchema.parse(res.json()).game).toMatchObject({
      name: 'Nytt navn',
      status: 'archived',
      cover: 'frost',
    });
    const list = gamesResponseSchema.parse((await call(cookie, 'GET', '/api/games')).json());
    expect(list.games.map((g) => g.status)).toEqual(['active', 'archived']);
    expect((await call(cookie, 'PATCH', `/api/games/${a.game.id}`, {})).statusCode).toBe(400);
  });

  it('PATCH bytter karakter: ny tilstand, og den gamle karakterraden slettes', async () => {
    const cookie = await login();
    const a = await create(cookie);
    const res = await call(cookie, 'PATCH', `/api/games/${a.game.id}`, { ddbUrlOrId: String(LEGO_ID) });
    expect(res.statusCode).toBe(200);
    const body = gameDetailResponseSchema.parse(res.json());
    expect(body.game.character?.hpMax).toBe(39);
    expect(body.state.version).toBe(2);
    expect(body.state.state.hitDiceUsed).toEqual({ d10: 5 });
    const rows = await db.selectFrom('dd_characters').select('ddb_id').execute();
    expect(rows.map((r) => r.ddb_id)).toEqual([LEGO_ID]);
  });

  it('DELETE fjerner tilstanden, og karakteren når ingen spill bruker den', async () => {
    const cookie = await login();
    const a = await create(cookie);
    const b = await create(cookie, String(ELOWEN_ID), 'To');
    expect((await call(cookie, 'DELETE', `/api/games/${a.game.id}`)).statusCode).toBe(204);
    expect(await db.selectFrom('dd_characters').select('id').execute()).toHaveLength(1);
    expect(
      await db.selectFrom('dd_game_state').select('game_id').where('game_id', '=', a.game.id).execute(),
    ).toHaveLength(0);
    expect((await call(cookie, 'GET', `/api/games/${a.game.id}`)).statusCode).toBe(404);
    expect((await call(cookie, 'DELETE', `/api/games/${b.game.id}`)).statusCode).toBe(204);
    expect(await db.selectFrom('dd_characters').select('id').execute()).toHaveLength(0);
    expect((await call(cookie, 'DELETE', `/api/games/${b.game.id}`)).statusCode).toBe(404);
  });

  it('gir 404 for ugyldig ID', async () => {
    const cookie = await login();
    expect((await call(cookie, 'GET', '/api/games/abc')).statusCode).toBe(404);
    expect((await call(cookie, 'GET', '/api/games/0')).statusCode).toBe(404);
    expect((await call(cookie, 'GET', '/api/games/999999')).statusCode).toBe(404);
  });
});

describe('eierskap', () => {
  it('bruker B får 404 på spillet til bruker A', async () => {
    const a = await login('a');
    const game = await create(a);
    const id = game.game.id;
    const b = await login('b');
    const state = { state: game.state.state, version: 1 };
    const checks: Array<[Method, string, unknown]> = [
      ['GET', `/api/games/${id}`, undefined],
      ['PATCH', `/api/games/${id}`, { name: 'Stjålet' }],
      ['PATCH', `/api/games/${id}`, { ddbUrlOrId: String(LEGO_ID) }],
      ['POST', `/api/games/${id}/character/refresh`, {}],
      ['POST', `/api/games/${id}/character/paste`, { json: ddbFixture('lego-ranger-5') }],
      ['GET', `/api/games/${id}/state`, undefined],
      ['PUT', `/api/games/${id}/state`, state],
      ['DELETE', `/api/games/${id}`, undefined],
    ];
    for (const [method, url, payload] of checks) {
      const res = await call(b, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(gamesResponseSchema.parse((await call(b, 'GET', '/api/games')).json()).games).toEqual([]);
    // Ingenting er endret for A.
    const after = gameDetailResponseSchema.parse((await call(a, 'GET', `/api/games/${id}`)).json());
    expect(after.game.name).toBe('Icewind Dale');
    expect(after.game.character?.hpMax).toBe(40);
    expect(after.state.version).toBe(1);
  });
});

describe('tilstand og synk', () => {
  it('PUT med riktig versjon lagrer, og feil versjon gir 409 med gjeldende tilstand', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const url = `/api/games/${game.game.id}/state`;
    const sheet = game.sheet as Sheet;
    const next: GameState = applyDamage(game.state.state, sheet, 5).state;

    const ok = await call(cookie, 'PUT', url, { state: next, version: 1 });
    expect(ok.statusCode).toBe(200);
    expect(gameStateEnvelopeSchema.parse(ok.json())).toEqual({ state: next, version: 2 });

    const stale = await call(cookie, 'PUT', url, { state: game.state.state, version: 1 });
    expect(stale.statusCode).toBe(409);
    const conflict = stateConflictSchema.parse(stale.json());
    expect(conflict.version).toBe(2);
    expect(conflict.state).toEqual(next);

    const got = gameStateEnvelopeSchema.parse((await call(cookie, 'GET', url)).json());
    expect(got).toEqual({ state: next, version: 2 });
  });

  it('PUT avviser ugyldig tilstand', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const url = `/api/games/${game.game.id}/state`;
    const bad = await call(cookie, 'PUT', url, { state: { ...game.state.state, hpRemoved: -3 }, version: 1 });
    expect(bad.statusCode).toBe(400);
    expect((await call(cookie, 'PUT', url, { state: game.state.state })).statusCode).toBe(400);
  });
});

describe('refresh og lim inn', () => {
  it('hele flyten: opprett → refresh → state', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const id = game.game.id;
    const sheet = game.sheet as Sheet;
    const played = applyDamage(game.state.state, sheet, 10).state;
    expect(
      (await call(cookie, 'PUT', `/api/games/${id}/state`, { state: played, version: 1 })).statusCode,
    ).toBe(200);

    // Lat som det lagrede arket er fra et lavere nivå og en eldre DERIVE_VERSION.
    const old = { ...sheet, features: sheet.features.slice(0, -1) };
    await db
      .updateTable('dd_characters')
      .set({ derived: JSON.stringify(old), derive_version: DERIVE_VERSION - 1 })
      .execute();
    const before = gameDetailResponseSchema.parse((await call(cookie, 'GET', `/api/games/${id}`)).json());
    expect(before.game.character?.outdated).toBe(true);

    clock += 10 * 60 * 1000; // Bufferen er gått ut.
    const res = await call(cookie, 'POST', `/api/games/${id}/character/refresh`, {});
    expect(res.statusCode, res.body).toBe(200);
    const body = refreshCharacterResponseSchema.parse(res.json());
    expect(body.newFeatures).toEqual([sheet.features.at(-1)]);
    expect(body.game.character?.outdated).toBe(false);
    expect(body.state.version).toBe(3);
    // Uten «hent også HP» beholdes appens HP.
    expect(body.state.state.hpRemoved).toBe(played.hpRemoved);
    expect(ddb.calls).toHaveLength(2);

    const withHp = await call(cookie, 'POST', `/api/games/${id}/character/refresh`, {
      alsoHpAndResources: true,
    });
    const withHpBody = refreshCharacterResponseSchema.parse(withHp.json());
    expect(withHpBody.state.state.hpRemoved).toBe(9);
    expect(withHpBody.newFeatures).toEqual([]);
    expect(withHpBody.state.version).toBe(4);

    const state = gameStateEnvelopeSchema.parse((await call(cookie, 'GET', `/api/games/${id}/state`)).json());
    expect(state).toEqual(withHpBody.state);
  });

  it('refresh gir norsk feil når D&D Beyond svarer 403', async () => {
    const cookie = await login();
    const game = await create(cookie);
    clock += 10 * 60 * 1000;
    ddb.responses.set(ELOWEN_ID, 403);
    const res = await call(cookie, 'POST', `/api/games/${game.game.id}/character/refresh`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('ddb_private');
  });

  it('lim inn som tekst eller objekt virker som refresh, uten å hente fra D&D Beyond', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const url = `/api/games/${game.game.id}/character/paste`;
    const text = await call(cookie, 'POST', url, { json: JSON.stringify(ddbFixture('elowen-4')) });
    expect(text.statusCode, text.body).toBe(200);
    expect(refreshCharacterResponseSchema.parse(text.json()).state.version).toBe(2);
    const obj = await call(cookie, 'POST', url, { json: ddbFixture('elowen-4'), alsoHpAndResources: true });
    expect(obj.statusCode).toBe(200);
    expect(ddb.calls).toHaveLength(1);
  });

  it('lim inn av en annen karakter bytter karakter', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const res = await call(cookie, 'POST', `/api/games/${game.game.id}/character/paste`, {
      json: ddbFixture('lego-ranger-5'),
    });
    const body = refreshCharacterResponseSchema.parse(res.json());
    expect(body.game.character?.hpMax).toBe(39);
    expect(body.newFeatures).toEqual([]);
  });

  it('lim inn gir norske feil, og godtar opptil 2 MB', async () => {
    const cookie = await login();
    const game = await create(cookie);
    const url = `/api/games/${game.game.id}/character/paste`;
    const notJson = await call(cookie, 'POST', url, { json: '{ikke json' });
    expect(notJson.statusCode).toBe(400);
    expect(notJson.json().error).toBe('paste_invalid_json');
    const format = await call(cookie, 'POST', url, { json: { foo: 1 } });
    expect(format.statusCode).toBe(422);
    expect(format.json()).toEqual({ error: 'ddb_format', message: PASTE_FORMAT_MESSAGE });
    expect(PASTE_FORMAT_MESSAGE).not.toMatch(/lim inn/i);

    // 1,5 MB går gjennom her, selv om resten av API-et har 1 MB.
    const big = { ...ddbFixture('elowen-4'), padding: 'x'.repeat(1_500_000) };
    expect((await call(cookie, 'POST', url, { json: big })).statusCode).toBe(200);
    expect(
      (await call(cookie, 'POST', '/api/ddb/preview', { ddbUrlOrId: 'x'.repeat(1_500_000) })).statusCode,
    ).toBe(413);
    const huge = { json: { padding: 'x'.repeat(2_200_000) } };
    expect((await call(cookie, 'POST', url, huge)).statusCode).toBe(413);
  });
});

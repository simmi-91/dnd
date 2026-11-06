import { CHARACTER_ID, addEnemy, setInitiative, startCombat, turReducer, type CombatState } from '@dnd/rules';
import {
  combatConflictSchema,
  combatEnvelopeSchema,
  combatResponseSchema,
  endCombatResponseSchema,
  gameDetailResponseSchema,
  gamesResponseSchema,
  gameStateEnvelopeSchema,
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
import { COMBAT_CONFLICT_MESSAGE, COMBAT_GONE_MESSAGE } from './combat.ts';

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

async function createGame(cookie: string) {
  const res = await call(cookie, 'POST', '/api/games', {
    name: 'Icewind Dale',
    ddbUrlOrId: String(ELOWEN_ID),
  });
  expect(res.statusCode, res.body).toBe(201);
  return gameDetailResponseSchema.parse(res.json());
}

async function start(cookie: string, gameId: number, body: unknown = {}) {
  const res = await call(cookie, 'POST', `/api/games/${gameId}/combat`, body);
  expect(res.statusCode, res.body).toBe(201);
  return combatEnvelopeSchema.parse(res.json());
}

/** Kampen i gang: en goblin, initiativ for alle, og runde 1 med karakteren på tur. */
function running(state: CombatState): CombatState {
  let s = addEnemy(state, { name: 'Goblin', hpMax: 7, ac: 15, initiative: 3 }).state;
  s = setInitiative(s, CHARACTER_ID, { roll: 18 });
  for (const p of s.participants) if (p.initiative == null) s = setInitiative(s, p.id, { total: 2 });
  return startCombat(s);
}

describe('innlogging', () => {
  it.each<[Method, string]>([
    ['GET', '/api/games/1/combat'],
    ['POST', '/api/games/1/combat'],
    ['PUT', '/api/games/1/combat'],
    ['POST', '/api/games/1/combat/end'],
  ])('%s %s krever innlogging', async (method, url) => {
    const res = await call(null, method, url, method === 'GET' ? undefined : {});
    expect(res.statusCode).toBe(401);
  });

  it('skrivende kall krever X-Requested-With', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const res = await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/combat`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('kamp', () => {
  it('GET gir null før kampen, og POST lager oppsett fra arket og tilstanden', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const before = await call(cookie, 'GET', `/api/games/${game.id}/combat`);
    expect(before.statusCode).toBe(200);
    expect(combatResponseSchema.parse(before.json())).toEqual({ combat: null });

    const combat = await start(cookie, game.id);
    expect(combat).toMatchObject({ status: 'active', round: 0, version: 1, endedAt: null });
    expect(combat.state.status).toBe('setup');
    expect(combat.state.participants[0]).toMatchObject({ id: CHARACTER_ID, kind: 'character' });

    const after = combatResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${game.id}/combat`)).json(),
    );
    expect(after.combat).toEqual(combat);
  });

  it('POST uten body virker, og en kamp til gir 409 combat_exists med den som pågår', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const first = await app.inject({
      method: 'POST',
      url: `/api/games/${game.id}/combat`,
      headers: { ...WRITE_HEADERS, cookie },
    });
    expect(first.statusCode, first.body).toBe(201);
    const again = await call(cookie, 'POST', `/api/games/${game.id}/combat`, {});
    expect(again.statusCode).toBe(409);
    const conflict = combatConflictSchema.parse(again.json());
    expect(conflict.error).toBe('combat_exists');
    expect(conflict.message).toBe('En kamp pågår allerede i dette spillet.');
    expect(conflict.combat?.id).toBe(combatEnvelopeSchema.parse(first.json()).id);
  });

  it('to samtidige starter gir bare én kamp', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const results = await Promise.all([
      call(cookie, 'POST', `/api/games/${game.id}/combat`, {}),
      call(cookie, 'POST', `/api/games/${game.id}/combat`, {}),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const rows = await db.selectFrom('dd_combats').select('id').execute();
    expect(rows).toHaveLength(1);
  });

  it('excludeCompanions holder egne følgesvenner utenfor', async () => {
    const cookie = await login();
    const detail = await createGame(cookie);
    const state = {
      ...detail.state.state,
      companions: [
        { id: 'c1', name: 'Leiesoldat', initiativeBonus: 1 },
        { id: 'c2', name: 'Guide', initiativeBonus: 0 },
      ],
    };
    const put = await call(cookie, 'PUT', `/api/games/${detail.game.id}/state`, { state, version: 1 });
    expect(put.statusCode, put.body).toBe(200);
    const combat = await start(cookie, detail.game.id, { excludeCompanions: ['c2'] });
    const names = combat.state.participants.map((p) => p.name);
    expect(names).toContain('Leiesoldat');
    expect(names).not.toContain('Guide');
    const bad = await call(cookie, 'POST', `/api/games/${detail.game.id}/combat`, { other: 1 });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT med riktig versjon lagrer og oppdaterer runden, og feil versjon gir 409 med kampen', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const combat = await start(cookie, game.id);
    const next = running(combat.state);
    const ok = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: next,
      version: 1,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const saved = combatEnvelopeSchema.parse(ok.json());
    expect(saved).toMatchObject({ id: combat.id, version: 2, round: 1 });
    expect(saved.state).toEqual(next);

    const stale = turReducer(next, { type: 'action', action: 'dash' });
    const conflict = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: stale,
      version: 1,
    });
    expect(conflict.statusCode).toBe(409);
    const body = combatConflictSchema.parse(conflict.json());
    expect(body).toMatchObject({ error: 'version_conflict', message: COMBAT_CONFLICT_MESSAGE });
    expect(body.combat).toEqual(saved);
  });

  it('PUT avviser ugyldig tilstand og ended, og gir 404 uten spill', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const combat = await start(cookie, game.id);
    const url = `/api/games/${game.id}/combat`;
    const bad = { ...combat.state, participants: [{ id: 'x' }] };
    expect((await call(cookie, 'PUT', url, { id: combat.id, state: bad, version: 1 })).statusCode).toBe(400);
    const ended = { ...combat.state, status: 'ended' };
    expect((await call(cookie, 'PUT', url, { id: combat.id, state: ended, version: 1 })).statusCode).toBe(
      400,
    );
    expect((await call(cookie, 'PUT', url, { state: combat.state, version: 1 })).statusCode).toBe(400);
    const missing = await call(cookie, 'PUT', '/api/games/999999/combat', {
      id: combat.id,
      state: combat.state,
      version: 1,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('end avslutter, skriver conditions tilbake til spilltilstanden, og er idempotent', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const combat = await start(cookie, game.id);
    let s = running(combat.state);
    s = turReducer(s, { type: 'condition', who: CHARACTER_ID, condition: 'poisoned', on: true });
    s = turReducer(s, { type: 'exhaustion', who: CHARACTER_ID, level: 2 });
    const put = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: s,
      version: 1,
    });
    expect(put.statusCode, put.body).toBe(200);

    const end = await call(cookie, 'POST', `/api/games/${game.id}/combat/end`, { id: combat.id });
    expect(end.statusCode, end.body).toBe(200);
    const res = endCombatResponseSchema.parse(end.json());
    expect(res.combat).toMatchObject({ id: combat.id, status: 'ended', version: 3, round: 1 });
    expect(res.combat.endedAt).not.toBeNull();
    expect(res.combat.state.status).toBe('ended');
    expect(res.combat.state.log[0]?.text).toBe('Kampen er slutt');
    expect(res.state.version).toBe(2);
    expect(res.state.state).toMatchObject({ conditions: ['poisoned'], exhaustion: 2 });

    const gs = gameStateEnvelopeSchema.parse(
      (await call(cookie, 'GET', `/api/games/${game.id}/state`)).json(),
    );
    expect(gs).toEqual(res.state);
    const now = combatResponseSchema.parse(
      (await call(cookie, 'GET', `/api/games/${game.id}/combat`)).json(),
    );
    expect(now.combat).toBeNull();

    const twice = await call(cookie, 'POST', `/api/games/${game.id}/combat/end`, { id: combat.id });
    expect(twice.statusCode).toBe(200);
    expect(endCombatResponseSchema.parse(twice.json())).toEqual(res);

    // En enhet som ikke vet at kampen er slutt, får 409 og null.
    const late = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: s,
      version: 2,
    });
    expect(late.statusCode).toBe(409);
    expect(combatConflictSchema.parse(late.json())).toMatchObject({
      combat: null,
      message: COMBAT_GONE_MESSAGE,
    });

    // En ny kamp kan startes, og PUT mot den gamle ID-en treffer ikke den nye selv med samme versjon.
    const second = await start(cookie, game.id);
    expect(second.id).not.toBe(combat.id);
    const wrong = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: second.state,
      version: 1,
    });
    expect(wrong.statusCode).toBe(409);
    expect(combatConflictSchema.parse(wrong.json()).combat?.id).toBe(second.id);
  });

  it('spillisten viser runden i kampen som pågår, og null etter slutt', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const round = async () => {
      const list = gamesResponseSchema.parse((await call(cookie, 'GET', '/api/games')).json());
      return list.games.find((g) => g.id === game.id)?.combatRound;
    };
    expect(await round()).toBeNull();
    const combat = await start(cookie, game.id);
    const put = await call(cookie, 'PUT', `/api/games/${game.id}/combat`, {
      id: combat.id,
      state: running(combat.state),
      version: 1,
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(await round()).toBe(1);
    await call(cookie, 'POST', `/api/games/${game.id}/combat/end`, { id: combat.id });
    expect(await round()).toBeNull();
  });

  it('end gir 404 for ukjent kamp', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    const res = await call(cookie, 'POST', `/api/games/${game.id}/combat/end`, { id: 424242 });
    expect(res.statusCode).toBe(404);
  });

  it('sletting av spillet fjerner kampene', async () => {
    const cookie = await login();
    const { game } = await createGame(cookie);
    await start(cookie, game.id);
    expect((await call(cookie, 'DELETE', `/api/games/${game.id}`)).statusCode).toBe(204);
    expect(await db.selectFrom('dd_combats').select('id').execute()).toHaveLength(0);
  });
});

describe('eierskap', () => {
  it('bruker B får 404 på kampen til bruker A, og kan ikke endre eller avslutte den', async () => {
    const a = await login('a');
    const { game } = await createGame(a);
    const combat = await start(a, game.id);
    const b = await login('b');
    const base = `/api/games/${game.id}/combat`;
    expect((await call(b, 'GET', base)).statusCode).toBe(404);
    expect((await call(b, 'POST', base, {})).statusCode).toBe(404);
    expect((await call(b, 'PUT', base, { id: combat.id, state: combat.state, version: 1 })).statusCode).toBe(
      404,
    );
    expect((await call(b, 'POST', `${base}/end`, { id: combat.id })).statusCode).toBe(404);
    const still = combatResponseSchema.parse((await call(a, 'GET', base)).json());
    expect(still.combat).toEqual(combat);
  });
});

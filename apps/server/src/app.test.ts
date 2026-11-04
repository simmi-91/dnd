import { SESSION_COOKIE, apiErrorSchema, authConfigSchema, meResponseSchema } from '@dnd/shared';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, isApiPath } from './app.ts';
import { classifyGoogleError } from './auth/google.ts';
import { hashToken, newSessionToken } from './auth/session.ts';
import type { Db } from './db/index.ts';
import {
  WRITE_HEADERS,
  clearData,
  fakeGoogle,
  freshTestDb,
  sessionCookieFrom,
  testConfig,
} from './test/helpers.ts';

const DAY = 24 * 60 * 60 * 1000;
let db: Db;
const apps: FastifyInstance[] = [];

async function makeApp(env: Record<string, string> = {}, deps: Parameters<typeof buildApp>[1] = {}) {
  const app = await buildApp(testConfig(env), {
    db,
    logger: false,
    verifyGoogleToken: fakeGoogle(),
    ...deps,
  });
  apps.push(app);
  return app;
}

beforeAll(async () => {
  db = await freshTestDb(testConfig());
});

beforeEach(async () => {
  await clearData(db);
});

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
});

afterAll(async () => {
  await db?.destroy();
});

async function login(app: FastifyInstance, credential = 'ok:sub-1:Elin@Example.no') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/google',
    headers: WRITE_HEADERS,
    payload: { credential },
  });
  return { res, cookie: sessionCookieFrom(res) };
}

function cookieHeader(value: string) {
  return { cookie: `${SESSION_COOKIE}=${value}` };
}

describe('GET /api/health', () => {
  it('svarer 200 når databasen svarer', async () => {
    const app = await makeApp();
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  it('svarer 503 når databasen ikke svarer', async () => {
    const config = testConfig({ DB_PORT: '1' });
    const app = await buildApp(config, { logger: false });
    apps.push(app);
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: false });
  });
});

describe('GET /api/auth/config', () => {
  it('gir client ID og om dev-login er på', async () => {
    const app = await makeApp();
    const body = authConfigSchema.parse((await app.inject('/api/auth/config')).json());
    expect(body).toEqual({ googleClientId: 'test-client-id.apps.googleusercontent.com', devLogin: false });
  });

  it('gir null når GOOGLE_CLIENT_ID er tom', async () => {
    const app = await buildApp(testConfig({ GOOGLE_CLIENT_ID: '' }), { db, logger: false });
    apps.push(app);
    expect((await app.inject('/api/auth/config')).json()).toEqual({ googleClientId: null, devLogin: false });
    const res = await login(app);
    expect(res.res.statusCode).toBe(503);
    expect(res.res.json().error).toBe('google_not_configured');
  });
});

describe('POST /api/auth/google', () => {
  it('lager bruker og sesjon, og setter informasjonskapselen med riktige flagg', async () => {
    const app = await makeApp();
    const { res, cookie } = await login(app);
    expect(res.statusCode).toBe(200);
    const body = meResponseSchema.parse(res.json());
    expect(body.user).toMatchObject({ email: 'elin@example.no', name: 'Test Testesen', avatarUrl: null });

    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 24 * 60 * 60 });
    expect((cookie as { secure?: boolean }).secure).toBeFalsy();
    expect(Buffer.from(cookie!.value, 'base64url')).toHaveLength(32);

    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).not.toMatch(/Secure/);

    const session = await db
      .selectFrom('dd_auth_sessions')
      .selectAll()
      .where('user_id', '=', body.user.id)
      .executeTakeFirstOrThrow();
    expect(session.token_hash).toBe(hashToken(cookie!.value));
    expect(session.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.token_hash).not.toContain(cookie!.value);
    const days = (session.expires_at.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThan(60.1);
  });

  it('setter Secure i produksjon', async () => {
    const app = await makeApp({ NODE_ENV: 'production' });
    const { res, cookie } = await login(app);
    expect(res.statusCode).toBe(200);
    expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax' });
  });

  it('oppdaterer eksisterende bruker i stedet for å lage en ny', async () => {
    const app = await makeApp();
    const first = await login(app);
    const second = await login(app, 'ok:sub-1:elin@example.no');
    expect(second.res.json().user.id).toBe(first.res.json().user.id);
    const users = await db.selectFrom('dd_users').selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.last_login_at).toBeInstanceOf(Date);
  });

  it('avviser ugyldig token, manglende credential og ubekreftet e-post', async () => {
    const app = await makeApp();
    const bad = await login(app, 'nei');
    expect(bad.res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(bad.res.json()).error).toBe('invalid_token');
    expect(bad.cookie).toBeUndefined();

    const empty = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: WRITE_HEADERS,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('invalid_request');

    const unverified = await makeApp({}, { verifyGoogleToken: fakeGoogle({ emailVerified: false }) });
    const res = await login(unverified);
    expect(res.res.statusCode).toBe(403);
    expect(res.res.json().error).toBe('email_not_verified');
    expect(await db.selectFrom('dd_users').selectAll().execute()).toHaveLength(0);
  });

  it('gir 403 til en sperret bruker og lager ingen sesjon', async () => {
    const app = await makeApp();
    await login(app);
    await db.updateTable('dd_users').set({ blocked: 1 }).execute();
    await db.deleteFrom('dd_auth_sessions').execute();

    const { res, cookie } = await login(app);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'blocked', message: 'Kontoen er sperret' });
    expect(cookie).toBeUndefined();
    expect(await db.selectFrom('dd_auth_sessions').selectAll().execute()).toHaveLength(0);
  });
});

describe('GET /api/me', () => {
  it('gir 401 uten sesjon', async () => {
    const app = await makeApp();
    const res = await app.inject('/api/me');
    expect(res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(res.json())).toEqual({
      error: 'unauthorized',
      message: 'Du er ikke logget inn',
    });
  });

  it('gir 401 med ukjent token', async () => {
    const app = await makeApp();
    const res = await app.inject({ url: '/api/me', headers: cookieHeader(newSessionToken()) });
    expect(res.statusCode).toBe(401);
  });

  it('gir brukeren med en gyldig sesjon', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    const res = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(res.statusCode).toBe(200);
    expect(meResponseSchema.parse(res.json()).user.email).toBe('elin@example.no');
    // Nylig brukt sesjon: ingen ny informasjonskapsel og ingen skriving.
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('gir 403 med en gang når en innlogget bruker blir sperret', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    await db.updateTable('dd_users').set({ blocked: 1 }).execute();
    const res = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'blocked', message: 'Kontoen er sperret' });
  });

  it('avviser og sletter en utløpt sesjon', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    const hash = hashToken(cookie!.value);
    await db
      .updateTable('dd_auth_sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('token_hash', '=', hash)
      .execute();

    const res = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
    const cleared = sessionCookieFrom(res);
    expect(cleared?.value).toBe('');
    expect(
      await db.selectFrom('dd_auth_sessions').selectAll().where('token_hash', '=', hash).execute(),
    ).toEqual([]);
  });

  it('forlenger sesjonen høyst én gang i døgnet', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    const hash = hashToken(cookie!.value);
    const old = new Date(Date.now() - 2 * DAY);
    await db
      .updateTable('dd_auth_sessions')
      .set({ last_used_at: old, expires_at: new Date(Date.now() + 5 * DAY) })
      .where('token_hash', '=', hash)
      .execute();

    const first = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(first.statusCode).toBe(200);
    expect(sessionCookieFrom(first)).toMatchObject({ value: cookie!.value, httpOnly: true });
    const after = await db
      .selectFrom('dd_auth_sessions')
      .selectAll()
      .where('token_hash', '=', hash)
      .executeTakeFirstOrThrow();
    expect(after.last_used_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((after.expires_at.getTime() - Date.now()) / DAY).toBeGreaterThan(59.9);

    const second = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(second.statusCode).toBe(200);
    expect(sessionCookieFrom(second)).toBeUndefined();
    const again = await db
      .selectFrom('dd_auth_sessions')
      .selectAll()
      .where('token_hash', '=', hash)
      .executeTakeFirstOrThrow();
    expect(again.last_used_at.getTime()).toBe(after.last_used_at.getTime());
  });
});

describe('POST /api/auth/logout', () => {
  it('sletter sesjonen og fjerner informasjonskapselen', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...WRITE_HEADERS, ...cookieHeader(cookie!.value) },
    });
    expect(res.statusCode).toBe(204);
    const cleared = sessionCookieFrom(res);
    expect(cleared?.value).toBe('');
    expect(String(res.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await db.selectFrom('dd_auth_sessions').selectAll().execute()).toHaveLength(0);

    const me = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(me.statusCode).toBe(401);
  });

  it('virker også uten sesjon', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: WRITE_HEADERS });
    expect(res.statusCode).toBe(204);
  });
});

describe('X-Requested-With', () => {
  it('gir 403 på skrivende kall uten headeren, og sesjonen beholdes', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/auth/logout', headers: cookieHeader(cookie!.value) });
      expect(res.statusCode, method).toBe(403);
      expect(apiErrorSchema.parse(res.json()).error).toBe('csrf');
    }
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'x-requested-with': 'XMLHttpRequest', ...cookieHeader(cookie!.value) },
    });
    expect(wrong.statusCode).toBe(403);
    expect(await db.selectFrom('dd_auth_sessions').selectAll().execute()).toHaveLength(1);
  });

  it('gir 403 på innlogging uten headeren', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      payload: { credential: 'ok:sub-1:elin@example.no' },
    });
    expect(res.statusCode).toBe(403);
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('krever ikke headeren på GET', async () => {
    const app = await makeApp();
    expect((await app.inject('/api/auth/config')).statusCode).toBe(200);
  });

  it('kan ikke omgås med prosentkoding, store bokstaver eller doble skråstreker', async () => {
    const app = await makeApp();
    const { cookie } = await login(app);
    for (const url of ['/%61pi/auth/logout', '/API/auth/logout', '/Api/Auth/Logout', '//api/auth/logout']) {
      const res = await app.inject({ method: 'POST', url, headers: cookieHeader(cookie!.value) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error, url).toBe('csrf');
    }
    expect(await db.selectFrom('dd_auth_sessions').selectAll().execute()).toHaveLength(1);
    const me = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(me.statusCode).toBe(200);
  });

  it('gjelder alle skrivende kall, også ukjente stier utenfor /api', async () => {
    const app = await makeApp();
    for (const url of ['/finnes-ikke', '/spill/42', '/']) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode, url).toBe(403);
      expect(apiErrorSchema.parse(res.json()).error).toBe('csrf');
    }
    const withHeader = await app.inject({ method: 'POST', url: '/finnes-ikke', headers: WRITE_HEADERS });
    expect(withHeader.statusCode).toBe(404);
  });
});

describe('isApiPath', () => {
  it('normaliserer stien', () => {
    for (const url of ['/api', '/api/x', '/API/x', '/%61pi/x', '/%41PI/x?y=1', '//api/x', '/api%2Fx']) {
      expect(isApiPath(url), url).toBe(true);
    }
    for (const url of ['/', '/apix', '/spill/api', '/%zz']) {
      expect(isApiPath(url), url).toBe(false);
    }
  });
});

describe('GET /api/auth/dev-login', () => {
  it('finnes ikke når DEV_LOGIN_EMAIL er tom', async () => {
    const app = await makeApp();
    const res = await app.inject('/api/auth/dev-login');
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error).toBe('not_found');
  });

  it('finnes ikke i produksjon selv om DEV_LOGIN_EMAIL er satt', async () => {
    const app = await makeApp({ NODE_ENV: 'production', DEV_LOGIN_EMAIL: 'dev@example.no' });
    expect((await app.inject('/api/auth/dev-login')).statusCode).toBe(404);
    expect((await app.inject('/api/auth/config')).json().devLogin).toBe(false);
  });

  it('logger inn og videresender til / når den er på', async () => {
    const app = await makeApp({ DEV_LOGIN_EMAIL: 'Dev@Example.no' });
    expect((await app.inject('/api/auth/config')).json().devLogin).toBe(true);

    const res = await app.inject('/api/auth/dev-login');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = sessionCookieFrom(res);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const me = await app.inject({ url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('dev@example.no');

    // Andre gang brukes samme bruker.
    await app.inject('/api/auth/dev-login');
    expect(await db.selectFrom('dd_users').selectAll().execute()).toHaveLength(1);
  });

  it('kobler en dev-bruker til Google-kontoen med samme e-post', async () => {
    const app = await makeApp({ DEV_LOGIN_EMAIL: 'elin@example.no' });
    await app.inject('/api/auth/dev-login');
    const { res } = await login(app, 'ok:google-sub:elin@example.no');
    expect(res.statusCode).toBe(200);
    const users = await db.selectFrom('dd_users').selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.google_sub).toBe('google-sub');
  });
});

describe('kontokobling', () => {
  it('tar ikke over en ekte Google-konto med samme e-post (409)', async () => {
    const app = await makeApp();
    const first = await login(app, 'ok:sub-ekte:elin@example.no');
    expect(first.res.statusCode).toBe(200);

    const other = await login(app, 'ok:sub-annen:elin@example.no');
    expect(other.res.statusCode).toBe(409);
    expect(apiErrorSchema.parse(other.res.json())).toEqual({
      error: 'account_conflict',
      message: 'E-postadressen er allerede knyttet til en annen Google-konto',
    });
    expect(other.cookie).toBeUndefined();
    const users = await db.selectFrom('dd_users').selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.google_sub).toBe('sub-ekte');
    expect(await db.selectFrom('dd_auth_sessions').selectAll().execute()).toHaveLength(1);
  });

  it('gir 409 når en kjent konto bytter til en e-post som en annen bruker har', async () => {
    const app = await makeApp();
    await login(app, 'ok:sub-a:a@example.no');
    await login(app, 'ok:sub-b:b@example.no');
    const res = await login(app, 'ok:sub-a:b@example.no');
    expect(res.res.statusCode).toBe(409);
    const a = await db
      .selectFrom('dd_users')
      .selectAll()
      .where('google_sub', '=', 'sub-a')
      .executeTakeFirst();
    expect(a?.email).toBe('a@example.no');
  });
});

describe('logging', () => {
  it('skriver aldri Google-tokenet eller feilmeldingen fra verifiseringen til loggen', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const secret = 'eyJhbGciOiJSUzI1NiJ9.HEMMELIG-PAYLOAD.signatur';
    const app = await makeApp(
      {},
      {
        logger: { level: 'trace', stream },
        verifyGoogleToken: async (credential) => {
          throw new Error(`Wrong number of segments in token: ${credential}`);
        },
      },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { ...WRITE_HEADERS, cookie: `${SESSION_COOKIE}=HEMMELIG-COOKIE` },
      payload: { credential: secret },
    });
    expect(res.statusCode).toBe(401);
    const log = lines.join('');
    expect(log).toContain('ugyldig Google-token');
    expect(log).toContain('"reason":"malformed"');
    expect(log).not.toContain('HEMMELIG');
    expect(log).not.toContain('segments');
  });

  it('gjør feil fra google-auth-library om til faste kategorier', () => {
    expect(classifyGoogleError(new Error('Token used too late, 1 > 0: {"sub":"x"}'))).toBe('expired');
    expect(classifyGoogleError(new Error('Wrong recipient, payload audience != requiredAudience'))).toBe(
      'wrong_audience',
    );
    expect(classifyGoogleError(new Error('Invalid token signature: abc'))).toBe('bad_signature');
    expect(classifyGoogleError(new Error('noe helt annet'))).toBe('invalid_token');
    expect(classifyGoogleError('ikke en feil')).toBe('invalid_token');
  });
});

describe('feilsvar', () => {
  it('ukjente /api-ruter gir 404 i fast format', async () => {
    const app = await makeApp();
    const res = await app.inject('/api/finnes-ikke');
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json())).toEqual({ error: 'not_found', message: 'Fant ikke ressursen' });
    const post = await app.inject({ method: 'POST', url: '/api/finnes-ikke', headers: WRITE_HEADERS });
    expect(post.statusCode).toBe(404);
  });

  it('ugyldig JSON gir 400 i fast format', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { ...WRITE_HEADERS, 'content-type': 'application/json' },
      payload: '{nei',
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json()).error).toBe('invalid_request');
  });
});

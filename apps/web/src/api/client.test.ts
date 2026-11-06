import { meResponseSchema, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@dnd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe } from './auth';
import { api, ApiRequestError, KEEPALIVE_MAX_BYTES } from './client';

const user = { id: 1, email: 'elin@example.com', name: 'Elin Simenstad', avatarUrl: null };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function catchError(p: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiRequestError) return err;
    throw err;
  }
  throw new Error('Forventet en feil');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api-klienten', () => {
  it('sender X-Requested-With og JSON på POST, med samme opphav', async () => {
    const fetchFn = mockFetch(() => json(200, { user }));
    const res = await api.post('/api/auth/google', { credential: 'tok' }, meResponseSchema);

    expect(res.user.name).toBe('Elin Simenstad');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/auth/google');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe(JSON.stringify({ credential: 'tok' }));
    expect(headersOf(init)[REQUESTED_WITH_HEADER]).toBe(REQUESTED_WITH_VALUE);
    expect(headersOf(init)['Content-Type']).toBe('application/json');
  });

  it('sender ikke X-Requested-With på GET', async () => {
    const fetchFn = mockFetch(() => json(200, { user }));
    await api.get('/api/me', meResponseSchema);

    const init = fetchFn.mock.calls[0]![1];
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
    expect(headersOf(init)[REQUESTED_WITH_HEADER]).toBeUndefined();
  });

  it('bruker keepalive bare når kroppen er under grensen', async () => {
    const fetchFn = mockFetch(() => new Response(null, { status: 204 }));
    await api.put('/api/x', { a: 1 }, undefined, { keepalive: true });
    await api.put('/api/x', { a: 'x'.repeat(KEEPALIVE_MAX_BYTES) }, undefined, { keepalive: true });
    expect(fetchFn.mock.calls[0]![1]?.keepalive).toBe(true);
    expect(fetchFn.mock.calls[1]![1]?.keepalive).toBeUndefined();
  });

  it('godtar POST uten body og uten skjema', async () => {
    const fetchFn = mockFetch(() => new Response(null, { status: 204 }));
    await expect(api.post('/api/auth/logout')).resolves.toBeUndefined();
    const init = fetchFn.mock.calls[0]![1];
    expect(init?.body).toBeUndefined();
    expect(headersOf(init)[REQUESTED_WITH_HEADER]).toBe(REQUESTED_WITH_VALUE);
  });

  it('avviser et svar som ikke passer skjemaet', async () => {
    mockFetch(() => json(200, { user: { id: 'en', email: 'ikke-epost' } }));
    const err = await catchError(api.get('/api/me', meResponseSchema));
    expect(err.status).toBe(200);
    expect(err.error).toBe('invalid_response');
    expect(err.message).toBe('Fikk et uventet svar fra serveren.');
  });

  it('gir status, kode og norsk melding fra feilsvaret', async () => {
    mockFetch(() => json(403, { error: 'blocked', message: 'Kontoen er sperret' }));
    const err = await catchError(api.post('/api/auth/google', { credential: 'tok' }, meResponseSchema));
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(403);
    expect(err.error).toBe('blocked');
    expect(err.message).toBe('Kontoen er sperret');
  });

  it('gir en rolig melding når serveren svarer 502 uten JSON', async () => {
    mockFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const err = await catchError(api.get('/api/me', meResponseSchema));
    expect(err.status).toBe(502);
    expect(err.error).toBe('server');
    expect(err.message).toMatch(/Serveren svarer ikke/);
  });

  it('gjør nettverksfeil om til status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = await catchError(api.get('/api/me', meResponseSchema));
    expect(err.status).toBe(0);
    expect(err.error).toBe('network');
    expect(err.message).toMatch(/Fikk ikke kontakt med serveren/);
  });
});

describe('fetchMe', () => {
  it('gir null ved 401, ikke en feil', async () => {
    mockFetch(() => json(401, { error: 'unauthorized', message: 'Du er ikke logget inn' }));
    await expect(fetchMe()).resolves.toBeNull();
  });

  it('gir brukeren når innlogget', async () => {
    mockFetch(() => json(200, { user }));
    await expect(fetchMe()).resolves.toEqual(user);
  });

  it('kaster videre ved andre feil', async () => {
    mockFetch(() => json(500, { error: 'internal', message: 'Noe gikk galt på serveren' }));
    const err = await catchError(fetchMe());
    expect(err.status).toBe(500);
    expect(err.message).toBe('Noe gikk galt på serveren');
  });
});

import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@dnd/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, type InitialEntry } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api/client';
import { createQueryClient } from './api/auth';
import { App } from './App';

// Google-knappen laster et skript fra Google. Her byttes den ut med en knapp som gir et ferdig token.
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: ReactNode }) => children,
  GoogleLogin: ({ onSuccess }: { onSuccess: (res: { credential?: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ credential: 'google-token' })}>
      Logg inn med Google
    </button>
  ),
}));

const user = { id: 1, email: 'elin@example.com', name: 'Elin Simenstad', avatarUrl: null };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response;

function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const handler = routes[String(input)];
    return Promise.resolve(handler ? handler(init) : json(404, { error: 'not_found', message: 'Fant ikke' }));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const notLoggedIn: Handler = () => json(401, { error: 'unauthorized', message: 'Du er ikke logget inn' });
const loggedIn: Handler = () => json(200, { user });
const googleConfig: Handler = () => json(200, { googleClientId: 'klient-id', devLogin: false });

function renderAt(path: InitialEntry) {
  const queryClient = createQueryClient({ retry: false });
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <App queryClient={queryClient} />
    </MemoryRouter>,
  );
  return { ...result, queryClient };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rutevern', () => {
  it('sender en som ikke er innlogget, til innloggingssiden', async () => {
    mockApi({ '/api/me': notLoggedIn, '/api/auth/config': googleConfig });
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Kampguide' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logg inn med Google' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Mine spill' })).toBeNull();
  });

  it('viser Mine spill for en innlogget bruker', async () => {
    mockApi({ '/api/me': loggedIn });
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();
    expect(screen.getByText('Velkommen tilbake, Elin')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Hovedmeny' })).toBeTruthy();
  });

  it('sender en innlogget bruker fra /logg-inn til Mine spill', async () => {
    mockApi({ '/api/me': loggedIn, '/api/auth/config': googleConfig });
    renderAt('/logg-inn');

    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();
  });

  it('viser navn, e-post og Logg ut på Konto', async () => {
    mockApi({ '/api/me': loggedIn });
    renderAt('/konto');

    expect(await screen.findByRole('heading', { name: 'Konto' })).toBeTruthy();
    expect(screen.getByText('Elin Simenstad')).toBeTruthy();
    expect(screen.getByText('elin@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Logg ut' })).toBeTruthy();
  });

  it('logger ut og sender til innloggingssiden', async () => {
    const fetchFn = mockApi({
      '/api/me': loggedIn,
      '/api/auth/config': googleConfig,
      '/api/auth/logout': () => new Response(null, { status: 204 }),
    });
    renderAt('/konto');

    fireEvent.click(await screen.findByRole('button', { name: 'Logg ut' }));
    expect(await screen.findByRole('heading', { name: 'Kampguide' })).toBeTruthy();

    const call = fetchFn.mock.calls.find(([url]) => String(url) === '/api/auth/logout');
    expect(call?.[1]?.method).toBe('POST');
    expect((call?.[1]?.headers as Record<string, string>)[REQUESTED_WITH_HEADER]).toBe(REQUESTED_WITH_VALUE);
  });
});

describe('innlogging', () => {
  it('viser «Kontoen er sperret» for en sperret bruker', async () => {
    const fetchFn = mockApi({
      '/api/me': notLoggedIn,
      '/api/auth/config': googleConfig,
      '/api/auth/google': () => json(403, { error: 'blocked', message: 'Kontoen er sperret' }),
    });
    renderAt('/logg-inn');

    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn med Google' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Kontoen er sperret');
    expect(screen.queryByRole('heading', { name: 'Mine spill' })).toBeNull();

    const call = fetchFn.mock.calls.find(([url]) => String(url) === '/api/auth/google');
    expect(call?.[1]?.body).toBe(JSON.stringify({ credential: 'google-token' }));
    expect((call?.[1]?.headers as Record<string, string>)[REQUESTED_WITH_HEADER]).toBe(REQUESTED_WITH_VALUE);
  });

  it('går til Mine spill etter vellykket Google-innlogging', async () => {
    mockApi({
      '/api/me': notLoggedIn,
      '/api/auth/config': googleConfig,
      '/api/auth/google': () => json(200, { user }),
    });
    renderAt('/logg-inn');

    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn med Google' }));
    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();
  });

  it('logger inn lokalt med fetch uten å følge videresendingen', async () => {
    let session = false;
    const fetchFn = mockApi({
      '/api/me': () => (session ? json(200, { user }) : notLoggedIn()),
      '/api/auth/config': () => json(200, { googleClientId: null, devLogin: true }),
      '/api/auth/dev-login': () => {
        session = true;
        return new Response(null, { status: 302, headers: { Location: '/' } });
      },
    });
    renderAt('/logg-inn');

    expect(screen.queryByRole('button', { name: 'Logg inn med Google' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn lokalt' }));
    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();

    const call = fetchFn.mock.calls.find(([url]) => String(url) === '/api/auth/dev-login');
    expect(call?.[1]?.redirect).toBe('manual');
    expect(call?.[1]?.credentials).toBe('same-origin');
  });

  it('viser meldingen, ikke rå JSON, når lokal innlogging gjelder en sperret konto', async () => {
    mockApi({
      '/api/me': notLoggedIn,
      '/api/auth/config': () => json(200, { googleClientId: null, devLogin: true }),
      '/api/auth/dev-login': () => json(403, { error: 'blocked', message: 'Kontoen er sperret' }),
    });
    renderAt('/logg-inn');

    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn lokalt' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Kontoen er sperret');
    expect(screen.queryByRole('heading', { name: 'Mine spill' })).toBeNull();
  });

  it('viser meldingen fra serveren ved 409 account_conflict', async () => {
    const message = 'E-postadressen hører allerede til en annen Google-konto';
    mockApi({
      '/api/me': notLoggedIn,
      '/api/auth/config': googleConfig,
      '/api/auth/google': () => json(409, { error: 'account_conflict', message }),
    });
    renderAt('/logg-inn');

    fireEvent.click(await screen.findByRole('button', { name: 'Logg inn med Google' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.getByRole('button', { name: 'Logg inn med Google' })).toBeTruthy();
  });

  it('sier fra når innlogging ikke er satt opp', async () => {
    mockApi({
      '/api/me': notLoggedIn,
      '/api/auth/config': () => json(200, { googleClientId: null, devLogin: false }),
    });
    renderAt('/logg-inn');

    expect(await screen.findByText(/Innlogging er ikke satt opp ennå/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Logg inn lokalt' })).toBeNull();
  });
});

describe('videresending etter innlogging', () => {
  it.each(['//evil.example/x', '/\\evil', 'https://evil.example/', '/logg-inn'])(
    'sender til Mine spill i stedet for %s',
    async (from) => {
      mockApi({ '/api/me': loggedIn, '/api/auth/config': googleConfig });
      renderAt({ pathname: '/logg-inn', state: { from } });

      expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();
      expect(screen.queryByText('Noe gikk galt')).toBeNull();
    },
  );

  it('sender tilbake til en vanlig sti i appen', async () => {
    mockApi({ '/api/me': loggedIn, '/api/auth/config': googleConfig });
    renderAt({ pathname: '/logg-inn', state: { from: '/konto' } });

    expect(await screen.findByRole('heading', { name: 'Konto' })).toBeTruthy();
  });
});

describe('sperret konto', () => {
  const blocked: Handler = () => json(403, { error: 'blocked', message: 'Kontoen er sperret' });

  it('viser «Kontoen er sperret» uten «Prøv igjen» når /api/me gir blocked', async () => {
    mockApi({ '/api/me': blocked });
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Kontoen er sperret' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prøv igjen' })).toBeNull();
    expect(screen.queryByText('Får ikke kontakt')).toBeNull();
  });

  it('viser innloggingssiden med varsel på /logg-inn, så man kan bytte konto', async () => {
    const fetchFn = mockApi({ '/api/me': blocked, '/api/auth/config': googleConfig });
    renderAt('/logg-inn');

    expect(await screen.findByRole('button', { name: 'Logg inn med Google' })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe('Kontoen er sperret');

    // Regresjon: en feilet `me` skal ikke hentes i løkke når innloggingssiden monteres.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const meCalls = fetchFn.mock.calls.filter(([url]) => String(url) === '/api/me').length;
    expect(meCalls).toBe(1);
  });

  it('går til sperret-tilstanden når et annet kall gir blocked midt i økta', async () => {
    let isBlocked = false;
    mockApi({ '/api/me': () => (isBlocked ? blocked() : loggedIn()) });
    const { queryClient } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();

    isBlocked = true;
    await queryClient
      .fetchQuery({
        queryKey: ['spill'],
        queryFn: () => Promise.reject(new ApiRequestError(403, 'blocked', 'Kontoen er sperret')),
      })
      .catch(() => undefined);

    expect(await screen.findByRole('heading', { name: 'Kontoen er sperret' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prøv igjen' })).toBeNull();
  });
});

describe('401 midt i en økt', () => {
  it('tømmer me og sender til innloggingen når en spørring får 401', async () => {
    mockApi({ '/api/me': loggedIn, '/api/auth/config': googleConfig });
    const { queryClient } = renderAt('/konto');
    expect(await screen.findByRole('heading', { name: 'Konto' })).toBeTruthy();

    await queryClient
      .fetchQuery({
        queryKey: ['spill'],
        queryFn: () => Promise.reject(new ApiRequestError(401, 'unauthorized', 'Du er ikke logget inn')),
      })
      .catch(() => undefined);

    expect(await screen.findByRole('heading', { name: 'Kampguide' })).toBeTruthy();
    expect(queryClient.getQueryData(['me'])).toBeNull();
  });

  it('gjør det samme når en endring (mutation) får 401', async () => {
    mockApi({ '/api/me': loggedIn, '/api/auth/config': googleConfig });
    const { queryClient } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();

    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () => Promise.reject(new ApiRequestError(401, 'unauthorized', 'Du er ikke logget inn')),
      })
      .execute(undefined)
      .catch(() => undefined);

    expect(await screen.findByRole('heading', { name: 'Kampguide' })).toBeTruthy();
  });
});

describe('når API-et ikke svarer', () => {
  it('viser en feiltilstand med «Prøv igjen», og henter på nytt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderAt('/');

    expect(await screen.findByText(/Fikk ikke kontakt med serveren/)).toBeTruthy();

    mockApi({ '/api/me': loggedIn });
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }));
    expect(await screen.findByRole('heading', { name: 'Mine spill' })).toBeTruthy();
  });
});

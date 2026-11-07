import type { GameState } from '@dnd/rules';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/auth';
import { useGameState } from './useGameState';

const base: GameState = {
  hpRemoved: 0,
  tempHp: 0,
  resources: {},
  slotsUsed: {},
  hitDiceUsed: {},
  exhaustion: 0,
  conditions: [],
  deathSaves: { successes: 0, failures: 0 },
  pets: {},
  companions: [],
};

const STATE_URL = '/api/games/7/state';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Call {
  method: string;
  body: { state: GameState; version: number } | undefined;
  keepalive: boolean;
}

/** Fetch som svarer på GET og PUT av tilstanden. PUT-svarene styres av testen. */
function mockStateApi(opts: {
  get?: () => Response;
  put?: (body: Call['body']) => Promise<Response> | Response;
}) {
  const calls: Call[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Call['body']) : undefined;
    if (String(input) !== STATE_URL) return Promise.resolve(json(404, { error: 'not_found', message: 'x' }));
    calls.push({ method, body, keepalive: init?.keepalive === true });
    if (method === 'GET')
      return Promise.resolve(opts.get ? opts.get() : json(200, { state: base, version: 1 }));
    return Promise.resolve(
      opts.put ? opts.put(body) : json(200, { state: body?.state, version: (body?.version ?? 0) + 1 }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return {
    calls,
    puts: () => calls.filter((c) => c.method === 'PUT'),
    gets: () => calls.filter((c) => c.method === 'GET'),
  };
}

function setup() {
  const qc = createQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useGameState(7, { state: base, version: 1 }), { wrapper });
}

/** Lar ventende promiser og tidtakere gå. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useGameState', () => {
  it('lagrer 0,7 sekunder etter siste endring, med én PUT', async () => {
    const api = mockStateApi({});
    const { result } = setup();
    await advance(0); // henting ved oppstart

    act(() => result.current.update((s) => ({ ...s, hpRemoved: 1 })));
    expect(result.current.status).toBe('saving');
    await advance(400);
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    await advance(699);
    expect(api.puts()).toHaveLength(0);

    await advance(1);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0]?.body).toEqual({ state: { ...base, hpRemoved: 2 }, version: 1 });
    await advance(0);
    expect(result.current.status).toBe('saved');
    expect(result.current.version).toBe(2);
  });

  it('sender høyst én PUT om gangen, og endringer underveis i neste PUT', async () => {
    let release: (r: Response) => void = () => {};
    let first = true;
    const api = mockStateApi({
      put: (body) => {
        if (!first) return json(200, { state: body?.state, version: (body?.version ?? 0) + 1 });
        first = false;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    });
    const { result } = setup();
    await advance(0);

    act(() => result.current.update((s) => ({ ...s, hpRemoved: 3 })));
    await advance(700);
    expect(api.puts()).toHaveLength(1);

    act(() => result.current.update((s) => ({ ...s, tempHp: 5 })));
    await advance(2000);
    expect(api.puts()).toHaveLength(1);
    expect(result.current.status).toBe('saving');

    await act(async () => {
      release(json(200, { state: { ...base, hpRemoved: 3 }, version: 2 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.puts()).toHaveLength(2);
    expect(api.puts()[1]?.body).toEqual({ state: { ...base, hpRemoved: 3, tempHp: 5 }, version: 2 });
    await advance(0);
    expect(result.current.status).toBe('saved');
    expect(result.current.version).toBe(3);
  });

  it('bruker serverens tilstand og versjon ved 409, og viser en melding', async () => {
    const server: GameState = { ...base, hpRemoved: 10 };
    const message = 'Tilstanden er endret på en annen enhet. Den nyeste versjonen er hentet.';
    let conflict = true;
    const api = mockStateApi({
      put: (body) => {
        if (conflict) {
          conflict = false;
          return json(409, { error: 'version_conflict', message, state: server, version: 5 });
        }
        return json(200, { state: body?.state, version: (body?.version ?? 0) + 1 });
      },
    });
    const { result } = setup();
    await advance(0);
    const replacedBefore = result.current.replaced;

    act(() => result.current.update((s) => ({ ...s, hpRemoved: 1 })));
    await advance(700);
    expect(result.current.replaced).toBe(replacedBefore + 1);
    expect(result.current.state).toEqual(server);
    expect(result.current.version).toBe(5);
    expect(result.current.notice).toBe(message);
    expect(result.current.status).toBe('saved');

    act(() => result.current.update((s) => ({ ...s, tempHp: 2 })));
    await advance(700);
    expect(api.puts()[1]?.body).toEqual({ state: { ...server, tempHp: 2 }, version: 5 });
  });

  it('henter på nytt når fanen blir synlig, men ikke med endringer som ikke er lagret', async () => {
    const remote: GameState = { ...base, hpRemoved: 4 };
    const api = mockStateApi({ get: () => json(200, { state: remote, version: 9 }) });
    const { result } = setup();
    await advance(0);
    expect(api.gets()).toHaveLength(1);

    // Uten ulagrede endringer: hent og bruk serverens tilstand.
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(0);
    expect(api.gets()).toHaveLength(2);
    expect(result.current.state).toEqual(remote);
    expect(result.current.version).toBe(9);

    // Med en endring som venter på lagring: ingen henting.
    act(() => result.current.update((s) => ({ ...s, tempHp: 1 })));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(0);
    expect(api.gets()).toHaveLength(2);
    expect(result.current.state.tempHp).toBe(1);
  });

  it('sender med en gang når fanen skjules', async () => {
    const api = mockStateApi({});
    const { result } = setup();
    await advance(0);

    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await advance(0);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0]?.keepalive).toBe(true);
  });

  it('bruker ikke keepalive på vanlige lagringer', async () => {
    const api = mockStateApi({});
    const { result } = setup();
    await advance(0);
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    await advance(700);
    expect(api.puts()[0]?.keepalive).toBe(false);
  });

  it('sender med keepalive ved pagehide', async () => {
    const api = mockStateApi({});
    const { result } = setup();
    await advance(0);
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    act(() => window.dispatchEvent(new Event('pagehide')));
    await advance(0);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0]?.keepalive).toBe(true);
  });

  it('venter uten nett og prøver igjen ved nettverksfeil', async () => {
    let fail = true;
    const api = mockStateApi({
      put: (body) => {
        if (fail) {
          fail = false;
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return json(200, { state: body?.state, version: 2 });
      },
    });
    const { result } = setup();
    await advance(0);

    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    await advance(700);
    // Ingen svar: «Lagres når nettet er tilbake», ikke en feil.
    expect(result.current.status).toBe('offline');
    expect(result.current.error).toBeNull();

    await advance(5000);
    expect(api.puts()).toHaveLength(2);
    expect(result.current.status).toBe('saved');
  });
});

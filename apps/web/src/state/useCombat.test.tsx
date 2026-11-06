import { createCombat, type CombatState, type GameState } from '@dnd/rules';
import type { CombatEnvelope } from '@dnd/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/auth';
import { COMBAT_ENDED_ELSEWHERE, COMBAT_STARTED_ELSEWHERE } from './combatStore';
import { useCombat } from './useCombat';

const URL = '/api/games/7/combat';

const gameState: GameState = {
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function envelope(id: number, state: CombatState, version: number): CombatEnvelope {
  return {
    id,
    status: 'active',
    round: state.round,
    state,
    version,
    startedAt: '2026-11-06T10:00:00.000Z',
    endedAt: null,
  };
}

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | undefined;
}

/** En liten falsk server for kamp-rutene. Testene kan endre `server.combat` direkte (en annen enhet). */
function fakeServer() {
  const server = {
    combat: null as CombatEnvelope | null,
    nextId: 1,
    calls: [] as Call[],
    /** Neste PUT svarer med denne statusen (nettfeil = 0). */
    failPut: null as number | null,
  };
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    server.calls.push({ method, url, body });
    if (url === URL && method === 'GET') return Promise.resolve(json(200, { combat: server.combat }));
    if (url === URL && method === 'POST') {
      if (server.combat) {
        return Promise.resolve(
          json(409, {
            error: 'combat_exists',
            message: 'En kamp pågår allerede i dette spillet.',
            combat: server.combat,
          }),
        );
      }
      server.combat = envelope(server.nextId++, createCombat(), 1);
      return Promise.resolve(json(201, server.combat));
    }
    if (url === URL && method === 'PUT') {
      if (server.failPut != null) {
        const status = server.failPut;
        server.failPut = null;
        if (status === 0) return Promise.reject(new TypeError('nett'));
        return Promise.resolve(json(status, { error: 'server_error', message: 'Noe gikk galt på serveren' }));
      }
      const c = server.combat;
      if (!c || c.id !== body?.id || c.version !== body.version) {
        return Promise.resolve(
          json(409, {
            error: 'version_conflict',
            message: c && c.id === body?.id ? 'endret' : 'Kampen er avsluttet på en annen enhet.',
            combat: c,
          }),
        );
      }
      server.combat = envelope(c.id, body.state as CombatState, c.version + 1);
      return Promise.resolve(json(200, server.combat));
    }
    if (url === `${URL}/end` && method === 'POST') {
      const c = server.combat;
      if (!c || c.id !== body?.id) return Promise.resolve(json(404, { error: 'not_found', message: 'x' }));
      const ended = {
        ...c,
        status: 'ended' as const,
        state: { ...c.state, status: 'ended' as const },
        version: c.version + 1,
        endedAt: '2026-11-06T11:00:00.000Z',
      };
      server.combat = null;
      return Promise.resolve(
        json(200, { combat: ended, state: { state: { ...gameState, conditions: ['prone'] }, version: 5 } }),
      );
    }
    return Promise.resolve(json(404, { error: 'not_found', message: 'x' }));
  });
  vi.stubGlobal('fetch', fn);
  return {
    server,
    puts: () => server.calls.filter((c) => c.method === 'PUT'),
    gets: () => server.calls.filter((c) => c.method === 'GET'),
  };
}

function setup(game?: { flush: () => Promise<boolean>; replace: (env: unknown) => void }) {
  const qc = createQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCombat(7, { game }), { wrapper });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

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

describe('useCombat', () => {
  it('henter ved oppstart, og start lager kampen', async () => {
    const api = fakeServer();
    const { result } = setup();
    expect(result.current.loading).toBe(true);
    await advance(0);
    expect(result.current).toMatchObject({ loading: false, combat: null, sync: null });

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });
    expect(result.current.combat?.id).toBe(1);
    expect(result.current.sync?.state.status).toBe('setup');
    expect(api.server.calls.find((c) => c.method === 'POST')?.body).toEqual({});
  });

  it('start mens en kamp alt pågår (annen enhet) tar den i bruk', async () => {
    const api = fakeServer();
    const { result } = setup();
    await advance(0);
    api.server.combat = envelope(9, { ...createCombat(), round: 2 }, 4);
    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });
    expect(result.current.combat).toMatchObject({ id: 9, round: 2 });
    expect(result.current.sync?.version).toBe(4);
    expect(result.current.notice).toBe(COMBAT_STARTED_ELSEWHERE);
  });

  it('lagrer 0,7 sekunder etter siste endring, med ID og versjon', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    act(() => result.current.update((s) => ({ ...s, round: 1 })));
    expect(result.current.sync?.status).toBe('saving');
    await advance(699);
    expect(api.puts()).toHaveLength(0);
    await advance(1);
    expect(api.puts()).toHaveLength(1);
    expect(api.puts()[0]?.body).toMatchObject({ id: 3, version: 1, state: { darkness: true, round: 1 } });
    expect(result.current.sync).toMatchObject({ status: 'saved', version: 2 });
    expect(result.current.combat?.round).toBe(1);
  });

  it('henter hvert 10. sekund mens kampen pågår og fanen er synlig', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    const before = api.gets().length;
    api.server.combat = envelope(3, { ...createCombat(), darkness: true }, 2);
    await advance(10_000);
    expect(api.gets().length).toBe(before + 1);
    expect(result.current.sync).toMatchObject({ version: 2, state: { darkness: true } });

    act(() => setVisibility('hidden'));
    const hidden = api.gets().length;
    await advance(30_000);
    expect(api.gets().length).toBe(hidden);
    act(() => setVisibility('visible'));
    await advance(0);
    expect(api.gets().length).toBe(hidden + 1);
  });

  it('henter ikke over lokale endringer som ikke er lagret', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    const before = api.gets().length;
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await advance(0);
    // Skjult fane sender med en gang (keepalive), og hentingen venter til det er lagret.
    expect(api.puts()).toHaveLength(1);
    expect(api.gets().length).toBe(before);
    expect(result.current.sync?.state.darkness).toBe(true);
  });

  it('409 med samme kamp: serverens versjon brukes', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    api.server.combat = envelope(3, { ...createCombat(), round: 4 }, 6);
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    await advance(700);
    expect(result.current.sync).toMatchObject({
      version: 6,
      notice: 'endret',
      state: { round: 4, darkness: false },
    });
    expect(result.current.combat?.round).toBe(4);
  });

  it('kampen avsluttet på en annen enhet: lokale endringer forkastes, og ny tilstand hentes', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    api.server.combat = null;
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    await advance(700);
    expect(result.current).toMatchObject({ combat: null, sync: null, notice: COMBAT_ENDED_ELSEWHERE });
    // Etterpå hentes det som gjelder nå, og ingen flere PUT-er sendes.
    expect(api.gets().at(-1)?.url).toBe(URL);
    act(() => result.current.update((s) => ({ ...s, round: 9 })));
    await advance(5000);
    expect(api.puts()).toHaveLength(1);
  });

  it('ny kamp startet et annet sted oppdages ved neste henting', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    api.server.combat = envelope(4, createCombat(), 1);
    await advance(10_000);
    // Første henting ser at kamp 3 er borte, og neste tar i bruk kamp 4.
    await advance(0);
    expect(result.current.combat?.id).toBe(4);
    expect(result.current.sync?.version).toBe(1);
  });

  it('nettfeil prøves igjen etter 5 sekunder', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setup();
    await advance(0);
    api.server.failPut = 0;
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    await advance(700);
    expect(result.current.sync?.status).toBe('error');
    await advance(5000);
    expect(api.puts()).toHaveLength(2);
    expect(result.current.sync).toMatchObject({ status: 'saved', version: 2 });
  });

  it('end lagrer spilltilstanden og kampen først, og bytter til ny spilltilstand', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const order: string[] = [];
    const game = {
      flush: vi.fn(async () => {
        order.push('flush-game');
        return true;
      }),
      replace: vi.fn(),
    };
    const { result } = setup(game);
    await advance(0);
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    let res: Awaited<ReturnType<typeof result.current.end>> = null;
    await act(async () => {
      res = await result.current.end();
    });
    expect(order).toEqual(['flush-game']);
    const methods = api.server.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    expect(methods).toEqual([`PUT ${URL}`, `POST ${URL}/end`]);
    expect(api.server.calls.at(-1)?.body).toEqual({ id: 3 });
    expect(res).not.toBeNull();
    expect(game.replace).toHaveBeenCalledWith({ state: { ...gameState, conditions: ['prone'] }, version: 5 });
    expect(result.current).toMatchObject({ combat: null, sync: null, error: null });
  });
});

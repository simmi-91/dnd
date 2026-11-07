import { createCombat, type CombatState, type GameState } from '@dnd/rules';
import type { CombatEnvelope, GameStateEnvelope } from '@dnd/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient, fetchMe, useLogout } from '../api/auth';
import { api as apiClient } from '../api/client';
import { resetConnectivity } from '../offline/connectivity';
import {
  clearOffline,
  enableOfflineStorage,
  offlineKeys,
  offlineStorageKey,
  OFFLINE_CLEARED_KEY,
  isLogoutPending,
  setLogoutPending,
  readOffline,
  writeOffline,
} from '../offline/storage';
import { COMBAT_ENDED_OFFLINE_LOST, COMBAT_END_NEEDS_NETWORK } from './combatStore';
import { fingerprint, OFFLINE_DISCARDED, OTHER_TAB_REPLACED } from './stateSync';
import { useCombat } from './useCombat';
import { useGameState } from './useGameState';

// Fase 5: endringer i ark og kamp uten nett. De lagres lokalt, overlever omlasting og sendes når
// nettet er tilbake. Ved konflikt vinner serveren, med en egen melding.

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
const COMBAT_URL = '/api/games/7/combat';

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

/** Falsk server for tilstanden og kampen. `offline` gjør at ingen forespørsler får svar. */
function fakeServer() {
  const server = {
    offline: false,
    /** Sesjonen er borte: alt svarer 401. */
    unauthorized: false,
    state: { state: base, version: 1 } as GameStateEnvelope,
    combat: null as CombatEnvelope | null,
    calls: [] as Call[],
  };
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    if (server.offline) return Promise.reject(new TypeError('Failed to fetch'));
    server.calls.push({ method, url, body });
    if (server.unauthorized) {
      return Promise.resolve(json(401, { error: 'unauthorized', message: 'Logg inn' }));
    }
    if (url === STATE_URL && method === 'GET') return Promise.resolve(json(200, server.state));
    if (url === STATE_URL && method === 'PUT') {
      if (body?.version !== server.state.version) {
        return Promise.resolve(json(409, { error: 'version_conflict', message: 'endret', ...server.state }));
      }
      server.state = { state: body.state as GameState, version: server.state.version + 1 };
      return Promise.resolve(json(200, server.state));
    }
    if (url === COMBAT_URL && method === 'GET') return Promise.resolve(json(200, { combat: server.combat }));
    if (url === COMBAT_URL && method === 'PUT') {
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
    return Promise.resolve(json(404, { error: 'not_found', message: 'x' }));
  });
  vi.stubGlobal('fetch', fn);
  return {
    server,
    puts: (url: string) => server.calls.filter((c) => c.method === 'PUT' && c.url === url),
  };
}

function wrapper() {
  const qc = createQueryClient({ retry: false });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function setupState(initial: GameStateEnvelope) {
  return renderHook(() => useGameState(7, initial), { wrapper: wrapper() });
}

function setupCombat() {
  return renderHook(() => useCombat(7), { wrapper: wrapper() });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Det som ligger lagret for spilltilstanden. */
function storedState() {
  return readOffline(offlineKeys.stateSync(7), { safeParse: (d: unknown) => ({ success: true, data: d }) });
}

function storedCombat() {
  return readOffline(offlineKeys.combatSync(7), { safeParse: (d: unknown) => ({ success: true, data: d }) });
}

let online = true;

beforeEach(() => {
  vi.useFakeTimers();
  enableOfflineStorage();
  clearOffline();
  resetConnectivity();
  online = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});

afterEach(() => {
  cleanup();
  clearOffline();
  setLogoutPending(false);
  enableOfflineStorage(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('spilltilstanden uten nett', () => {
  it('viser «uten nett», beholder endringen over omlasting og sender den når nettet er tilbake', async () => {
    const api = fakeServer();
    const first = setupState({ state: base, version: 1 });
    await advance(0);

    api.server.offline = true;
    act(() => first.result.current.update((s) => ({ ...s, hpRemoved: 3 })));
    await advance(700);
    expect(first.result.current.status).toBe('offline');
    expect(first.result.current.error).toBeNull();
    expect(storedState()).toMatchObject({ version: 1, dirty: true, state: { hpRemoved: 3 } });

    // Omlasting uten nett: spillet kommer fra lokal lagring med gammel tilstand (versjon 1).
    first.unmount();
    const second = setupState({ state: base, version: 1 });
    await advance(0);
    expect(second.result.current.state.hpRemoved).toBe(3);
    expect(second.result.current.status).toBe('offline');

    // Nettet er tilbake: sendes med en gang, uten å vente på neste forsøk.
    api.server.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.puts(STATE_URL)).toHaveLength(1);
    expect(api.puts(STATE_URL)[0]?.body).toMatchObject({ version: 1, state: { hpRemoved: 3 } });
    expect(second.result.current).toMatchObject({ status: 'saved', version: 2, notice: null });
    expect(storedState()).toMatchObject({ version: 2, dirty: false });
  });

  it('bruker siste lagrede tilstand når spillet i bufferen er eldre', async () => {
    const api = fakeServer();
    api.server.state = { state: { ...base, tempHp: 5 }, version: 4 };
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, tempHp: 5 },
      version: 4,
      dirty: false,
      id: null,
    });
    const { result } = setupState({ state: base, version: 2 });
    expect(result.current).toMatchObject({ version: 4, status: 'saved' });
    expect(result.current.state.tempHp).toBe(5);
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(0);
    expect(result.current.version).toBe(4);
  });

  it('serveren er endret i mellomtiden (409): serveren vinner, med melding om endringene uten nett', async () => {
    const api = fakeServer();
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, hpRemoved: 3 },
      version: 1,
      dirty: true,
      id: null,
    });
    api.server.state = { state: { ...base, hpRemoved: 8 }, version: 2 };
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(1);
    expect(result.current).toMatchObject({ version: 2, status: 'saved', notice: OFFLINE_DISCARDED });
    expect(result.current.state.hpRemoved).toBe(8);
    expect(storedState()).toMatchObject({ version: 2, dirty: false });
  });

  it('spillet er hentet i nyere versjon: endringene uten nett forkastes uten PUT', async () => {
    const api = fakeServer();
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, hpRemoved: 3 },
      version: 1,
      dirty: true,
      id: null,
    });
    api.server.state = { state: { ...base, hpRemoved: 8 }, version: 2 };
    const { result } = setupState(api.server.state);
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(0);
    expect(result.current).toMatchObject({ version: 2, notice: OFFLINE_DISCARDED });
    expect(result.current.state.hpRemoved).toBe(8);
  });

  it('serveren uendret: alt lagres som vanlig, uten melding', async () => {
    const api = fakeServer();
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, hpRemoved: 3 },
      version: 1,
      dirty: true,
      id: null,
    });
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(1);
    expect(result.current).toMatchObject({ version: 2, status: 'saved', notice: null });
    expect(api.server.state.state.hpRemoved).toBe(3);
  });
});

describe('kampen uten nett', () => {
  it('åpnes fra lokal lagring etter omlasting, og endringene sendes når nettet er tilbake', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const first = setupCombat();
    await advance(0);
    expect(first.result.current.combat?.id).toBe(3);

    api.server.offline = true;
    act(() => first.result.current.update((s) => ({ ...s, darkness: true })));
    await advance(700);
    expect(first.result.current.sync?.status).toBe('offline');
    expect(first.result.current.sync?.error).toBeNull();
    first.unmount();

    const second = setupCombat();
    await advance(0);
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.error).toBeNull();
    expect(second.result.current.combat?.id).toBe(3);
    expect(second.result.current.sync?.state.darkness).toBe(true);

    // Avslutte kampen krever nett.
    await act(async () => {
      expect(await second.result.current.end()).toBeNull();
    });
    expect(second.result.current.error).toBe(COMBAT_END_NEEDS_NETWORK);

    api.server.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.puts(COMBAT_URL).at(-1)?.body).toMatchObject({ id: 3, version: 1, state: { darkness: true } });
    expect(second.result.current.sync).toMatchObject({ status: 'saved', version: 2 });
    expect(storedCombat()).toMatchObject({ id: 3, version: 2, dirty: false });
  });

  it('kampen avsluttet på en annen enhet mens vi var uten nett: tydelig melding, ingenting lagres', async () => {
    const api = fakeServer();
    api.server.combat = envelope(3, createCombat(), 1);
    const { result } = setupCombat();
    await advance(0);

    api.server.offline = true;
    act(() => result.current.update((s) => ({ ...s, darkness: true })));
    await advance(700);
    api.server.combat = null;
    api.server.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.combat).toBeNull();
    expect(result.current.notice).toBe(COMBAT_ENDED_OFFLINE_LOST);
    expect(storedCombat()).toBeUndefined();
  });

  it('kampen avsluttet på en annen enhet før omlasting: meldingen vises ved oppstart', async () => {
    const api = fakeServer();
    writeOffline(offlineKeys.combatSync(7), {
      state: { ...createCombat(), darkness: true },
      version: 1,
      dirty: true,
      id: 3,
    });
    const { result } = setupCombat();
    await advance(0);
    expect(result.current.combat).toBeNull();
    expect(result.current.notice).toBe(COMBAT_ENDED_OFFLINE_LOST);
    expect(api.puts(COMBAT_URL)).toHaveLength(0);
    expect(storedCombat()).toBeUndefined();
  });
});

describe('innlogging og meldinger uten nett', () => {
  it('fetchMe bruker forrige bruker uten nett, og 401 sletter alt som er lagret', async () => {
    const user = { id: 1, email: 'a@b.no', name: 'Elin', avatarUrl: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(200, { user }))),
    );
    expect(await fetchMe()).toEqual(user);
    writeOffline(offlineKeys.games, { games: [] });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await fetchMe()).toEqual(user);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(401, { error: 'unauthorized', message: 'Logg inn' }))),
    );
    expect(await fetchMe()).toBeNull();
    expect(readOffline(offlineKeys.games, { safeParse: (d: unknown) => ({ success: true, data: d }) })).toBe(
      undefined,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(fetchMe()).rejects.toMatchObject({ status: 0 });
  });

  it('andre skrivinger gir en norsk melding om at de krever nett', async () => {
    online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(apiClient.post('/api/games/7/sessions', {})).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/uten nett.*krever nett/),
    });
  });
});

describe('etter validering i Chromium', () => {
  it('401 når nettet er tilbake: ingenting skrives til lageret igjen', async () => {
    const api = fakeServer();
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);

    api.server.offline = true;
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 3 })));
    await advance(700);
    expect(storedState()).toMatchObject({ dirty: true });

    api.server.offline = false;
    api.server.unauthorized = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(storedState()).toBeUndefined();

    // Heller ikke senere endringer eller når fanen lukkes.
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 4 })));
    await advance(700);
    cleanup();
    await advance(0);
    expect(storedState()).toBeUndefined();
  });

  it('PUT-en nådde fram uten svar: ingen konfliktmelding når serveren har det samme', async () => {
    const api = fakeServer();
    const mine = { ...base, hpRemoved: 3 };
    writeOffline(offlineKeys.stateSync(7), { state: mine, version: 1, dirty: true, id: null });
    // Serveren lagret (med keepalive) samme tilstand, men nøklene kommer i en annen rekkefølge.
    const reordered = Object.fromEntries(Object.entries(mine).reverse()) as unknown as GameState;
    api.server.state = { state: reordered, version: 2 };

    const { result } = setupState(api.server.state);
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(0);
    expect(result.current).toMatchObject({ version: 2, notice: null, status: 'saved' });
  });

  it('409 med samme tilstand på serveren: ingen konfliktmelding', async () => {
    const api = fakeServer();
    const mine = { ...base, hpRemoved: 3 };
    writeOffline(offlineKeys.stateSync(7), { state: mine, version: 1, dirty: true, id: null });
    api.server.state = { state: mine, version: 2 };

    // Spillet kommer fra lageret (versjon 1), så PUT-en får 409.
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    expect(api.puts(STATE_URL)).toHaveLength(1);
    expect(result.current).toMatchObject({ version: 2, notice: null, status: 'saved' });
    expect(result.current.state.hpRemoved).toBe(3);
  });

  it('en annen fane lagrer lokalt: denne fanen tar det inn og sier fra om egne endringer', async () => {
    const api = fakeServer();
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    api.server.offline = true;
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    await advance(700);

    // Den andre fanen skriver sin post (også uten nett).
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, tempHp: 6 },
      version: 1,
      dirty: true,
      id: null,
    });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: offlineStorageKey(offlineKeys.stateSync(7)) }));
    });
    expect(result.current.state).toMatchObject({ tempHp: 6, hpRemoved: 0 });
    expect(result.current.notice).toBe(OTHER_TAB_REPLACED);

    // Når nettet er tilbake, sendes det som nå gjelder.
    api.server.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(api.server.state.state.tempHp).toBe(6);
  });

  it('en annen fane lagret en nyere versjon: tas inn uten melding når denne ikke har endringer', async () => {
    fakeServer();
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, tempHp: 1 },
      version: 2,
      dirty: false,
      id: null,
    });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: offlineStorageKey(offlineKeys.stateSync(7)) }));
    });
    expect(result.current).toMatchObject({ version: 2, notice: null, status: 'saved' });
    expect(result.current.state.tempHp).toBe(1);
  });
});

describe('andre runde i Chromium', () => {
  it('utlogging uten nett sendes før /api/me når nettet er tilbake, og appen er utlogget så lenge', async () => {
    writeOffline(offlineKeys.games, { games: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    expect(isLogoutPending()).toBe(true);
    expect(readOffline(offlineKeys.games, { safeParse: (d: unknown) => ({ success: true, data: d }) })).toBe(
      undefined,
    );

    // Fortsatt uten nett: utlogget, og /api/me spørres ikke.
    expect(await fetchMe()).toBeNull();
    expect(isLogoutPending()).toBe(true);

    // Nettet er tilbake, cookien er fortsatt gyldig: utloggingen sendes først, og /api/me ikke.
    const user = { id: 1, email: 'a@b.no', name: 'Elin', avatarUrl: null };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
        if (String(input) === '/api/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(json(200, { user }));
      }),
    );
    expect(await fetchMe()).toBeNull();
    expect(calls).toEqual(['POST /api/auth/logout']);
    expect(isLogoutPending()).toBe(false);
    expect(await fetchMe()).toEqual(user);
  });

  it('posten fra en annen fane bygde videre på denne fanens endringer: ingen melding', async () => {
    const api = fakeServer();
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    api.server.offline = true;
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 2 })));
    await advance(700);

    // Den andre fanen tok inn { hpRemoved: 2 } og endret videre.
    writeOffline(offlineKeys.stateSync(7), {
      state: { ...base, hpRemoved: 2, tempHp: 6 },
      version: 1,
      dirty: true,
      base: fingerprint({ ...base, hpRemoved: 2 }),
      id: null,
    });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: offlineStorageKey(offlineKeys.stateSync(7)) }));
    });
    expect(result.current.state).toMatchObject({ hpRemoved: 2, tempHp: 6 });
    expect(result.current.notice).toBeNull();
  });

  it('en annen fane tømmer lageret: denne fanen skriver ikke mer', async () => {
    fakeServer();
    const { result } = setupState({ state: base, version: 1 });
    await advance(0);
    expect(storedState()).toBeDefined();

    window.localStorage.removeItem(offlineStorageKey(offlineKeys.stateSync(7)));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: OFFLINE_CLEARED_KEY }));
    });
    act(() => result.current.update((s) => ({ ...s, hpRemoved: 1 })));
    await advance(700);
    expect(storedState()).toBeUndefined();
  });
});

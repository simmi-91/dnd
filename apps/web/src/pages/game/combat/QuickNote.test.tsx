import {
  combatFromGame,
  deriveCharacter,
  initialGameState,
  setInitiative,
  startCombat,
  turReducer,
  type CombatState,
  type Sheet,
} from '@dnd/rules';
import type { Game } from '@dnd/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import elowenRaw from '../../../../../../packages/rules/fixtures/elowen-4.json';
import { createQueryClient } from '../../../api/auth';
import { todayIso } from '../../../api/campaign';
import type { GameStateHook } from '../../../state/useGameState';
import { GameContext } from '../GameContext';
import { CombatContext } from './CombatContext';
import { RoundView } from './RoundView';

const sheet: Sheet = deriveCharacter(elowenRaw);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function savedSession() {
  return {
    session: {
      id: 5,
      gameId: 1,
      number: 7,
      title: '',
      playedOn: todayIso(),
      body: 'x',
      version: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    createdEntries: [],
  };
}

function Harness({ combat: start }: { combat: CombatState }) {
  const [combat, setCombat] = useState(start);
  const sync = { state: initialGameState(sheet), update: () => {} } as unknown as GameStateHook;
  return (
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <MemoryRouter>
        <GameContext.Provider value={{ game: { id: 1, name: 'Icewind Dale' } as Game, sheet, sync }}>
          <CombatContext.Provider
            value={{
              state: combat,
              dispatch: (e) => setCombat((s) => turReducer(s, e)),
              update: (fn) => setCombat((s) => fn(s)),
              locked: false,
              undo: null,
            }}
          >
            <RoundView />
          </CombatContext.Provider>
        </GameContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const combat = (): CombatState =>
  startCombat(setInitiative(combatFromGame(sheet, initialGameState(sheet)), 'char', { total: 20 }));

const listeners = new Set<() => void>();
let isLaptop = false;

/** Kan skiftes midt i en test: `setViewport(false)` etter første render varsler lytterne. */
function setViewport(laptop: boolean) {
  isLaptop = laptop;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return isLaptop && query.includes('1100px');
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  act(() => listeners.forEach((cb) => cb()));
}

let fetchFn: ReturnType<typeof vi.fn>;
const isAppend = (url: unknown) => String(url).includes('/today/append');
const appendCalls = () => fetchFn.mock.calls.filter(([url]) => isAppend(url));

beforeEach(() => {
  fetchFn = vi.fn((url: string) =>
    Promise.resolve(isAppend(url) ? json(200, savedSession()) : json(200, { entries: [], counts: {} })),
  );
  vi.stubGlobal('fetch', fetchFn);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = () => screen.getByRole('combobox', { name: 'Hurtignotat' }) as HTMLTextAreaElement;
const write = (v: string) =>
  fireEvent.change(field(), { target: { value: v, selectionStart: v.length, selectionEnd: v.length } });
const sendButton = () => screen.getByRole('button', { name: 'Legg til i økta i dag' });

describe('hurtignotat i kamp (4e)', () => {
  it('laptop: fanen Notater sender teksten med dagens dato og tømmer feltet', async () => {
    setViewport(true);
    render(<Harness combat={combat()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Notater' }));
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
    write('Karavanen er borte');
    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    expect(await screen.findByText('Lagt til i økt 7')).toBeTruthy();
    expect(appendCalls()).toHaveLength(1);
    const init = appendCalls()[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Karavanen er borte', playedOn: todayIso() });
    expect(field().value).toBe('');
    expect(screen.getByRole('link', { name: 'Åpne dagboka' }).getAttribute('href')).toBe('/spill/1/dagbok');
  });

  it('halvskrevet tekst overlever fanebytte', () => {
    setViewport(true);
    render(<Harness combat={combat()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Notater' }));
    write('halvveis');
    fireEvent.click(screen.getByRole('tab', { name: 'Ark' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Notater' }));
    expect(field().value).toBe('halvveis');
  });

  it('422 beholder teksten og viser meldingen', async () => {
    setViewport(true);
    fetchFn.mockImplementation((url: string) =>
      Promise.resolve(
        isAppend(url)
          ? json(422, { error: 'body_too_long', message: 'Teksten er for lang' })
          : json(200, { entries: [], counts: {} }),
      ),
    );
    render(<Harness combat={combat()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Notater' }));
    write('lang tekst');
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Teksten er for lang');
    expect(field().value).toBe('lang tekst');
  });

  it('mobil: flytende knapp åpner arket, og sending virker derfra', async () => {
    setViewport(false);
    render(<Harness combat={combat()} />);
    expect(screen.queryByRole('tab', { name: 'Notater' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hurtignotat' }));
    const dialog = screen.getByRole('dialog', { name: 'Hurtignotat' });
    write('Fra mobilen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Legg til i økta i dag' }));
    await waitFor(() => expect(appendCalls()).toHaveLength(1));
    await waitFor(() => expect(field().value).toBe(''));
  });

  it('tekst og lista overlever at bredden krysser 1100 px', async () => {
    setViewport(false);
    render(<Harness combat={combat()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hurtignotat' }));
    write('usendt');
    setViewport(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Notater' }));
    expect(field().value).toBe('usendt');
    fireEvent.click(sendButton());
    expect(await screen.findByText('Lagt til i økt 7')).toBeTruthy();
    setViewport(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hurtignotat' }));
    expect(screen.getByText('Lagt til i økt 7')).toBeTruthy();
    expect(field().value).toBe('');
  });

  it('arket: fokus til feltet, Escape lukker og fokus går tilbake til knappen', () => {
    setViewport(false);
    render(<Harness combat={combat()} />);
    const fab = screen.getByRole('button', { name: 'Hurtignotat' });
    fireEvent.click(fab);
    expect(document.activeElement).toBe(field());
    expect(screen.getAllByText('Hurtignotat')).toHaveLength(2);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hurtignotat' }));
  });
});

describe('tilgjengelighet i kampen (5b)', () => {
  it('fanene til høyre har piltaster, roving tabindex og et tabpanel', () => {
    setViewport(true);
    render(<Harness combat={combat()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0]!.id);

    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' });
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[3]);
    fireEvent.keyDown(tabs[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(tabs[3]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[3]!.id);
  });

  it('deltakerknappene sier hvem som har turen og hvor mye HP de har, uten symboler', () => {
    setViewport(false);
    render(<Harness combat={combat()} />);
    const nav = screen.getByRole('navigation', { name: 'Deltakere i initiativrekkefølge' });
    const first = within(nav).getAllByRole('button')[0]!;
    expect(first.textContent).toContain('har turen');
    expect(first.textContent).toMatch(/\d+ av \d+ HP/);
    expect(first.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('HP-raden leses opp når tallet endres (aria-live)', () => {
    setViewport(false);
    render(<Harness combat={combat()} />);
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(live?.textContent).toContain('HP');
  });
});

import { deriveCharacter, initialGameState, type Sheet } from '@dnd/rules';
import type { Game, GameDetailResponse, Session } from '@dnd/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import elowenRaw from '../../../../../packages/rules/fixtures/elowen-4.json';
import { createQueryClient } from '../../api/auth';
import { todayIso } from '../../api/campaign';
import { App } from '../../App';

const sheet: Sheet = deriveCharacter(elowenRaw);
const user = { id: 1, email: 'elin@example.com', name: 'Elin Simenstad', avatarUrl: null };
const NOW = '2026-11-05T18:00:00.000Z';
const game: Game = {
  id: 1,
  name: 'Icewind Dale',
  status: 'active',
  cover: 'frost',
  character: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const detail: GameDetailResponse = {
  game,
  sheet: null,
  state: { state: initialGameState(sheet), version: 1 },
};
const person = {
  id: 20,
  kind: 'person',
  name: 'Brann Holt',
  summary: '',
  archived: false,
  updatedAt: NOW,
  status: null,
  fields: { role: 'kjøpmann' },
};
const listing = { entries: [person], counts: { quest: 0, person: 1, place: 0, other: 0 } };

function session(over: Partial<Session> = {}): Session {
  return {
    id: 5,
    gameId: 1,
    number: 6,
    playedOn: '2026-10-28',
    title: 'Vadet',
    body: 'Vi møtte @[Brann Holt](e:20).',
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response;

function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const handler = routes[key];
    return Promise.resolve(handler ? handler(init) : json(404, { error: 'not_found', message: 'Fant ikke' }));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function bodiesOf(fn: ReturnType<typeof mockApi>, key: string): Record<string, unknown>[] {
  return fn.mock.calls
    .filter(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}` === key)
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

const suggestions = [{ id: 20, kind: 'person', name: 'Brann Holt' }];
const baseRoutes: Record<string, Handler> = {
  'GET /api/me': () => json(200, { user }),
  'GET /api/games': () => json(200, { games: [game] }),
  'GET /api/games/1': () => json(200, detail),
  'GET /api/games/1/entries?show=all': () => json(200, listing),
  'GET /api/games/1/entries/suggest?kind=person&q=': () => json(200, { suggestions }),
  'GET /api/games/1/entries/suggest?kind=person&q=Bra': () => json(200, { suggestions }),
  'GET /api/games/1/entries/suggest?kind=quest&q=': () => json(200, { suggestions: [] }),
  'GET /api/games/1/entries/suggest?kind=quest&q=finne+karavanen': () => json(200, { suggestions: [] }),
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App queryClient={createQueryClient({ retry: false })} />
    </MemoryRouter>,
  );
}

function type(el: HTMLElement, value: string) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Dagboka: økta i dag', () => {
  it('viser en tom skriveflate og oppretter økta ved første lagring, med neste nummer', async () => {
    const today = todayIso();
    const old = { id: 5, number: 6, playedOn: '2026-10-28', title: '', excerpt: '', updatedAt: NOW };
    const created = session({
      id: 9,
      number: 7,
      playedOn: today,
      title: '',
      body: 'Kom til byen.',
      version: 1,
    });
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/games/1/sessions': () => json(200, { sessions: [old] }),
      'POST /api/games/1/sessions': () => json(201, { session: created, createdEntries: [] }),
    });
    renderAt('/spill/1/dagbok');

    const editor = await screen.findByLabelText('Hva skjedde i økta?');
    expect(screen.getByText('Icewind Dale · Økt 7')).toBeTruthy();
    expect((editor as HTMLTextAreaElement).value).toBe('');
    expect(bodiesOf(fn, 'POST /api/games/1/sessions')).toHaveLength(0);

    type(editor, 'Kom til byen.');
    await waitFor(() => expect(bodiesOf(fn, 'POST /api/games/1/sessions')).toHaveLength(1), {
      timeout: 3000,
    });
    expect(bodiesOf(fn, 'POST /api/games/1/sessions')[0]).toEqual({
      title: '',
      playedOn: today,
      body: 'Kom til byen.',
    });
    expect(await screen.findByRole('button', { name: 'Slett økt' })).toBeTruthy();
  });

  it('åpner økta med dagens dato hvis den finnes', async () => {
    const today = todayIso();
    const existing = session({ id: 8, number: 7, playedOn: today, body: 'Allerede skrevet.' });
    mockApi({
      ...baseRoutes,
      'GET /api/games/1/sessions': () =>
        json(200, {
          sessions: [{ id: 8, number: 7, playedOn: today, title: 'Vadet', excerpt: '', updatedAt: NOW }],
        }),
      'GET /api/sessions/8': () => json(200, { session: existing }),
    });
    renderAt('/spill/1/dagbok');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    expect(editor.value).toBe('Allerede skrevet.');
    expect(screen.getByText('Icewind Dale · Økt 7')).toBeTruthy();
  });
});

describe('Dagboka: skriveflaten', () => {
  it('viser koblinger uten (e:ID), og registeret lenker til oppslagsverket', async () => {
    mockApi({ ...baseRoutes, 'GET /api/sessions/5': () => json(200, { session: session() }) });
    renderAt('/spill/1/dagbok/5');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    expect(editor.value).toBe('Vi møtte @Brann Holt.');
    expect((screen.getByLabelText('Tittel') as HTMLInputElement).value).toBe('Vadet');
    const register = await screen.findByText('Nevnt i økta');
    const details = register.parentElement as HTMLDetailsElement;
    details.open = true;
    expect(within(details).getByRole('link', { name: 'Brann Holt' }).getAttribute('href')).toBe(
      '/spill/1/bok/20?fane=personer',
    );
  });

  it('autofullføring: @ åpner forslag, Enter velger, og lagringen har ID-en', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/sessions/5': () => json(200, { session: session({ body: '' }) }),
      'PUT /api/sessions/5': (init) => {
        const body = JSON.parse(String(init?.body)) as Session;
        return json(200, { session: session({ ...body, version: 4 }), createdEntries: [] });
      },
    });
    renderAt('/spill/1/dagbok/5');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    type(editor, 'Vi møtte @Bra');
    expect(editor.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox', { name: 'Forslag: person' });
    expect(await within(list).findByRole('option', { name: /Brann Holt/ })).toBeTruthy();
    expect(within(list).getByRole('option', { name: 'Opprett «Bra»' })).toBeTruthy();

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(editor.value).toBe('Vi møtte @Brann Holt ');
    expect(editor.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(bodiesOf(fn, 'PUT /api/sessions/5')).toHaveLength(1), { timeout: 3000 });
    expect(bodiesOf(fn, 'PUT /api/sessions/5')[0]).toMatchObject({
      body: 'Vi møtte @[Brann Holt](e:20) ',
      version: 3,
    });
  });

  it('knappen ! og «Opprett «…»» setter inn (new)', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/sessions/5': () => json(200, { session: session({ body: 'Vi skal' }) }),
      'PUT /api/sessions/5': (init) => {
        const body = JSON.parse(String(init?.body)) as Session;
        return json(200, {
          session: session({ ...body, body: body.body.replace('(new)', '(e:31)'), version: 4 }),
          createdEntries: [],
        });
      },
    });
    renderAt('/spill/1/dagbok/5');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Sett inn quest (!)' }));
    expect(editor.value).toBe('Vi skal !');
    type(editor, 'Vi skal !finne karavanen');
    fireEvent.click(await screen.findByRole('option', { name: 'Opprett «finne karavanen»' }));
    expect(editor.value).toBe('Vi skal !finne karavanen ');
    await waitFor(() => expect(bodiesOf(fn, 'PUT /api/sessions/5')).toHaveLength(1), { timeout: 3000 });
    expect(bodiesOf(fn, 'PUT /api/sessions/5')[0]).toMatchObject({
      body: 'Vi skal ![finne karavanen](new) ',
    });
    // Serverens tekst med ID tas inn, og teksten i feltet er den samme.
    expect(await screen.findByText('Lagret')).toBeTruthy();
    expect(editor.value).toBe('Vi skal !finne karavanen ');
  });

  it('409: viser valget, og «Bruk den andre» bytter teksten', async () => {
    const theirs = session({ body: 'Skrevet på mobilen om #[Eldmark](e:30).', version: 7 });
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/sessions/5': () => json(200, { session: session() }),
      'PUT /api/sessions/5': () =>
        json(409, { error: 'version_conflict', message: 'Økta ble endret', session: theirs }),
    });
    renderAt('/spill/1/dagbok/5');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    type(editor, 'Vi møtte @Brann Holt. Min tekst.');
    const alert = await screen.findByText('Økta ble endret på en annen enhet.', {}, { timeout: 3000 });
    expect(editor.value).toBe('Vi møtte @Brann Holt. Min tekst.');
    expect(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Behold min' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bruk den andre' }));
    expect(editor.value).toBe('Skrevet på mobilen om #Eldmark.');
    expect(screen.queryByText('Økta ble endret på en annen enhet.')).toBeNull();
    expect(bodiesOf(fn, 'PUT /api/sessions/5')).toHaveLength(1);
  });

  it('409: «Behold min» lagrer på nytt med serverens versjon', async () => {
    const theirs = session({ body: 'Fra mobilen', version: 7 });
    let calls = 0;
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/sessions/5': () => json(200, { session: session() }),
      'PUT /api/sessions/5': (init) => {
        calls += 1;
        if (calls === 1) return json(409, { error: 'version_conflict', message: 'x', session: theirs });
        const body = JSON.parse(String(init?.body)) as Session;
        return json(200, { session: session({ ...body, version: 8 }), createdEntries: [] });
      },
    });
    renderAt('/spill/1/dagbok/5');
    const editor = (await screen.findByLabelText('Hva skjedde i økta?')) as HTMLTextAreaElement;
    type(editor, 'Min tekst.');
    fireEvent.click(await screen.findByRole('button', { name: 'Behold min' }, { timeout: 3000 }));
    await waitFor(() => expect(bodiesOf(fn, 'PUT /api/sessions/5')).toHaveLength(2));
    expect(bodiesOf(fn, 'PUT /api/sessions/5')[1]).toMatchObject({ body: 'Min tekst.', version: 7 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Behold min' })).toBeNull());
    expect(editor.value).toBe('Min tekst.');
  });
  it('sletting avbrytes når de siste endringene ikke er lagret', async () => {
    const theirs = session({ body: 'Fra mobilen', version: 7 });
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/sessions/5': () => json(200, { session: session() }),
      'PUT /api/sessions/5': () => json(409, { error: 'version_conflict', message: 'x', session: theirs }),
      'DELETE /api/sessions/5': () => new Response(null, { status: 204 }),
    });
    renderAt('/spill/1/dagbok/5');
    const editor = await screen.findByLabelText('Hva skjedde i økta?');
    type(editor, 'Min tekst.');
    await screen.findByRole('button', { name: 'Behold min' }, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Slett økt' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Slett' }));
    expect(await screen.findByText(/Økta er ikke slettet/)).toBeTruthy();
    expect(fn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});

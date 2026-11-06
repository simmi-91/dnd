import { deriveCharacter, initialGameState, type Sheet } from '@dnd/rules';
import type { Game, GameDetailResponse } from '@dnd/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import elowenRaw from '../../../../../packages/rules/fixtures/elowen-4.json';
import { createQueryClient } from '../../api/auth';
import { App } from '../../App';

const sheet: Sheet = deriveCharacter(elowenRaw);
const user = { id: 1, email: 'elin@example.com', name: 'Elin Simenstad', avatarUrl: null };
const game: Game = {
  id: 1,
  name: 'Icewind Dale',
  status: 'active',
  cover: 'frost',
  character: {
    id: 1,
    name: sheet.name,
    summary: sheet.summary,
    level: sheet.level,
    hpMax: sheet.hpMax,
    ac: sheet.ac,
    importedAt: '2026-11-04T18:00:00.000Z',
    deriveVersion: 1,
    outdated: false,
  },
  createdAt: '2026-11-04T18:00:00.000Z',
  updatedAt: '2026-11-04T18:00:00.000Z',
};
const state = { state: initialGameState(sheet), version: 1 };
const detail: GameDetailResponse = { game, sheet, state };

const NOW = '2026-11-05T18:00:00.000Z';
const common = { summary: '', archived: false, updatedAt: NOW };
const quest = {
  ...common,
  id: 10,
  kind: 'quest',
  name: 'Finn karavanen',
  summary: 'Karavanen forsvant ved vadet',
  status: 'active',
  fields: { giverEntryId: 20, placeEntryIds: [30], reward: '200 gp' },
};
const person = {
  ...common,
  id: 20,
  kind: 'person',
  name: 'Brann Holt',
  status: null,
  fields: { role: 'kjøpmann' },
};
const place = { ...common, id: 30, kind: 'place', name: 'Eldmark', status: null, fields: { type: 'by' } };
const doneQuest = {
  ...common,
  id: 11,
  kind: 'quest',
  name: 'Rydde ulvehiet',
  status: 'done',
  archived: true,
  fields: {},
};
const listing = {
  entries: [quest, person, place, doneQuest],
  counts: { quest: 1, person: 1, place: 1, other: 0 },
};
const fullQuest = {
  ...quest,
  gameId: 1,
  body: 'Karavanen skulle til @[Brann](e:20) via #[Eldmark](e:30). Se også ![Borte](e:999).',
  version: 3,
  createdAt: NOW,
};
const questDetail = {
  entry: fullQuest,
  mentionedIn: [
    { sourceType: 'session', sourceId: 5, number: 7, playedOn: '2026-11-04', title: 'Vadet' },
    { sourceType: 'entry', sourceId: 20, kind: 'person', name: 'Brann Holt' },
  ],
};

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

const baseRoutes: Record<string, Handler> = {
  'GET /api/me': () => json(200, { user }),
  'GET /api/games': () => json(200, { games: [game] }),
  'GET /api/games/1': () => json(200, detail),
  'GET /api/games/1/state': () => json(200, state),
  'GET /api/games/1/entries?show=all': () => json(200, listing),
  'GET /api/entries/10': () => json(200, questDetail),
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App queryClient={createQueryClient({ retry: false })} />
    </MemoryRouter>,
  );
}

function bodyOf(fn: ReturnType<typeof mockApi>, key: string): Record<string, unknown> | undefined {
  const call = fn.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}` === key);
  return call?.[1]?.body ? (JSON.parse(String(call[1].body)) as Record<string, unknown>) : undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Kampanjebok: lista', () => {
  it('viser faner med antall, felter og statusmerke, og skjuler arkiverte', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/bok');

    const tabs = await screen.findByRole('navigation', { name: 'Kategorier' });
    expect((await within(tabs).findByRole('link', { name: 'Quester 1' })).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(tabs).getByRole('link', { name: 'Personer 1' })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: 'Steder 1' })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: 'Økter' })).toBeTruthy();

    const list = await screen.findByRole('list', { name: 'Quester' });
    const row = within(list).getByRole('link', { name: /Finn karavanen/ });
    expect(row.textContent).toContain('fra Brann Holt · Eldmark');
    expect(row.textContent).toContain('Aktiv');
    expect(within(list).queryByText('Rydde ulvehiet')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /Vis arkiverte/ }));
    const archived = within(list).getByRole('link', { name: /Rydde ulvehiet/ });
    expect(archived.textContent).toContain('Ferdig');
  });

  it('bytter fane og viser øktene med lenke til dagboka', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/games/1/sessions': () =>
        json(200, {
          sessions: [
            {
              id: 5,
              number: 7,
              playedOn: '2026-11-04',
              title: 'Vadet',
              excerpt: 'Kom til Eldmark',
              updatedAt: NOW,
            },
          ],
        }),
    });
    renderAt('/spill/1/bok');
    fireEvent.click(await screen.findByRole('link', { name: 'Personer 1' }));
    expect(await screen.findByRole('link', { name: /Brann Holt/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Økter' }));
    const session = await screen.findByRole('link', { name: /Økt 7/ });
    expect(session.getAttribute('href')).toBe('/spill/1/dagbok/5');
  });

  it('søker med debounce og lenker treff til dagboka og detaljkortet', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/games/1/search?q=karavan': () =>
        json(200, {
          sessions: [{ id: 5, number: 7, playedOn: '2026-11-04', title: '', excerpt: 'Karavanen var borte' }],
          entries: [{ id: 10, kind: 'quest', name: 'Finn karavanen', archived: false, excerpt: 'forsvant' }],
        }),
    });
    renderAt('/spill/1/bok');
    const input = await screen.findByLabelText('Søk i boka');
    fireEvent.change(input, { target: { value: 'k' } });
    fireEvent.change(input, { target: { value: 'kara' } });
    fireEvent.change(input, { target: { value: 'karavan' } });

    const hit = await screen.findByRole('link', { name: /Økt 7/ });
    expect(hit.getAttribute('href')).toBe('/spill/1/dagbok/5');
    expect(hit.textContent).toContain('Karavanen var borte');
    expect(screen.getByRole('link', { name: /Finn karavanen/ }).getAttribute('href')).toBe(
      '/spill/1/bok/10?fane=quester',
    );
    // Bare det siste søket sendes.
    expect(fn.mock.calls.filter(([url]) => String(url).includes('/search'))).toHaveLength(1);
  });
});

describe('Kampanjebok: detaljkortet', () => {
  it('viser felter som lenker, notater med koblinger og «Nevnt i»', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/bok/10?fane=quester');

    expect(await screen.findByRole('heading', { level: 2, name: 'Finn karavanen' })).toBeTruthy();
    expect(screen.getByText('Quest · Aktiv')).toBeTruthy();
    expect(screen.getByText('200 gp')).toBeTruthy();
    expect(screen.getByText('Karavanen forsvant ved vadet')).toBeTruthy();

    const notes = screen.getByRole('region', { name: 'Notater' });
    expect(await within(notes).findByRole('link', { name: 'Brann' })).toBeTruthy();
    expect(within(notes).getByRole('link', { name: 'Brann' }).getAttribute('href')).toBe(
      '/spill/1/bok/20?fane=personer',
    );
    expect(within(notes).getByRole('link', { name: 'Eldmark' })).toBeTruthy();
    // ID 999 finnes ikke, så koblingen er vanlig tekst.
    expect(within(notes).queryByRole('link', { name: 'Borte' })).toBeNull();
    expect(notes.textContent).toContain('Se også Borte.');

    const giver = (screen.getByText('Gitt av').parentElement as HTMLElement) ?? document.body;
    expect(within(giver).getByRole('link', { name: 'Brann Holt' })).toBeTruthy();

    const mentioned = screen.getByRole('region', { name: 'Nevnt i' });
    expect(within(mentioned).getByRole('link', { name: 'Økt 7' }).getAttribute('href')).toBe(
      '/spill/1/dagbok/5',
    );
    expect(within(mentioned).getByRole('link', { name: 'Brann Holt' }).getAttribute('href')).toBe(
      '/spill/1/bok/20?fane=personer',
    );
  });

  it('arkiverer med hele oppføringen og versjonen, og sletter først etter bekreftelse', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'PUT /api/entries/10': () =>
        json(200, { entry: { ...fullQuest, archived: true, version: 4 }, createdEntries: [] }),
      'DELETE /api/entries/10': () => new Response(null, { status: 204 }),
    });
    renderAt('/spill/1/bok/10?fane=quester');
    fireEvent.click(await screen.findByRole('button', { name: 'Arkiver' }));
    await waitFor(() => expect(bodyOf(fn, 'PUT /api/entries/10')).toBeTruthy());
    expect(bodyOf(fn, 'PUT /api/entries/10')).toMatchObject({
      name: 'Finn karavanen',
      status: 'active',
      archived: true,
      version: 3,
      fields: { giverEntryId: 20, placeEntryIds: [30], reward: '200 gp' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Slett' }));
    const dialog = await screen.findByRole('dialog');
    expect(fn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Slett' }));
    await waitFor(() => expect(fn.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
  });
});

describe('Kampanjebok: skjema', () => {
  it('ved 409 version_conflict lastes serverens versjon inn og meldingen vises', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'PUT /api/entries/10': () =>
        json(409, {
          error: 'version_conflict',
          message: 'Endret',
          entry: { ...fullQuest, name: 'Finn karavanen (rettet)', version: 5 },
        }),
    });
    renderAt('/spill/1/bok/10?fane=quester&rediger=1');
    const name = await screen.findByLabelText('Navn');
    fireEvent.change(name, { target: { value: 'Mitt navn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(await screen.findByText(/endret på en annen enhet/)).toBeTruthy();
    expect((screen.getByLabelText('Navn') as HTMLInputElement).value).toBe('Finn karavanen (rettet)');
    expect(bodyOf(fn, 'PUT /api/entries/10')).toMatchObject({ name: 'Mitt navn', version: 3 });

    // Neste lagring bygger på serverens versjon.
    fn.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));
    await waitFor(() => expect(bodyOf(fn, 'PUT /api/entries/10')).toBeTruthy());
    expect(bodyOf(fn, 'PUT /api/entries/10')).toMatchObject({ version: 5 });
  });

  it('ved 409 name_taken vises meldingen ved navnefeltet, med lenke til den som har navnet', async () => {
    mockApi({
      ...baseRoutes,
      'POST /api/games/1/entries': () =>
        json(409, {
          error: 'name_taken',
          message: 'Navnet er tatt',
          entry: { ...person, gameId: 1, body: '', version: 1, createdAt: NOW },
        }),
    });
    renderAt('/spill/1/bok?fane=personer&ny=person');
    const name = await screen.findByLabelText('Navn');
    fireEvent.change(name, { target: { value: 'brann holt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    const alert = await screen.findByText(/finnes allerede en oppføring av typen Person/);
    expect(alert.id).toBe(name.getAttribute('aria-describedby'));
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(within(alert).getByRole('link', { name: 'Åpne «Brann Holt»' }).getAttribute('href')).toBe(
      '/spill/1/bok/20?fane=personer',
    );
  });

  it('ved 422 body_too_long vises meldingen ved notatene', async () => {
    mockApi({
      ...baseRoutes,
      'PUT /api/entries/10': () =>
        json(422, { error: 'body_too_long', message: 'Teksten er for lang.', max: 100000 }),
    });
    renderAt('/spill/1/bok/10?rediger=1');
    await screen.findByLabelText('Navn');
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));
    const msg = await screen.findByText('Teksten er for lang.');
    expect(screen.getByLabelText('Notater').getAttribute('aria-describedby')?.split(' ')).toContain(msg.id);
  });

  it('oppretter en ny person med valgt sted og går til detaljkortet', async () => {
    const created = {
      ...person,
      id: 21,
      name: 'Moder Hild',
      gameId: 1,
      body: '',
      version: 1,
      createdAt: NOW,
    };
    const fn = mockApi({
      ...baseRoutes,
      'GET /api/games/1/entries/suggest?kind=place&q=': () =>
        json(200, { suggestions: [{ id: 30, kind: 'place', name: 'Eldmark' }] }),
      'POST /api/games/1/entries': () => json(201, { entry: created, createdEntries: [] }),
      'GET /api/entries/21': () => json(200, { entry: created, mentionedIn: [] }),
    });
    renderAt('/spill/1/bok?fane=personer&ny=person');
    fireEvent.change(await screen.findByLabelText('Navn'), { target: { value: ' Moder Hild ' } });
    fireEvent.change(screen.getByLabelText('Rolle'), { target: { value: 'kroeier' } });
    fireEvent.change(screen.getByLabelText('Holdning'), { target: { value: 'friend' } });
    fireEvent.focus(screen.getByLabelText('Sted'));
    fireEvent.click(await screen.findByRole('button', { name: 'Eldmark' }));
    expect(screen.getByRole('button', { name: 'Fjern Eldmark fra Sted' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lagre' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Moder Hild' })).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/games/1/entries')).toEqual({
      kind: 'person',
      name: 'Moder Hild',
      summary: '',
      body: '',
      fields: { role: 'kroeier', attitude: 'friend', placeEntryId: 30 },
    });
  });
});

describe('Kampanjebok uten karakter', () => {
  const noChar = { game: { ...game, character: null }, sheet: null, state };
  const routes = {
    ...baseRoutes,
    'GET /api/games/1': () => json(200, noChar),
    'GET /api/games/1/sessions': () => json(200, { sessions: [] }),
  };

  it('virker på bok og dagbok, mens Ark fortsatt krever karakter', async () => {
    mockApi(routes);
    renderAt('/spill/1/bok');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kampanjebok' })).toBeTruthy();
    const menu = within(screen.getByRole('navigation', { name: 'Hovedmeny' }));
    expect(menu.getByRole('link', { name: 'Kampanjebok' })).toBeTruthy();
    expect(menu.getByRole('link', { name: 'Dagbok' })).toBeTruthy();
    cleanup();

    renderAt('/spill/1/dagbok');
    expect(await screen.findByLabelText('Hva skjedde i økta?')).toBeTruthy();
    cleanup();

    renderAt('/spill/1/ark');
    expect(await screen.findByRole('heading', { name: 'Ingen karakter' })).toBeTruthy();
  });
});

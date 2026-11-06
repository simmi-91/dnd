import { deriveCharacter, initialGameState, type Sheet } from '@dnd/rules';
import type { Game, GameDetailResponse } from '@dnd/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import elowenRaw from '../../../packages/rules/fixtures/elowen-4.json';
import { createQueryClient } from './api/auth';
import { App } from './App';

// Fixturen er anonymisert (ID 1000001), så ingen ekte D&D Beyond-ID-er brukes her.
const sheet: Sheet = deriveCharacter(elowenRaw);
const FAKE_REF = 'https://www.dndbeyond.com/characters/1000001';

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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response;

/** Ruter på «METODE sti». */
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
};

function renderAt(path: string) {
  const queryClient = createQueryClient({ retry: false });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App queryClient={queryClient} />
    </MemoryRouter>,
  );
}

function bodyOf(fn: ReturnType<typeof mockApi>, key: string): unknown {
  const call = fn.mock.calls.find(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mine spill', () => {
  it('viser spillene med karakter, og arkiverte i en egen seksjon', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/games': () =>
        json(200, { games: [game, { ...game, id: 2, name: 'Lego-eventyret', status: 'archived' }] }),
    });
    renderAt('/');

    const active = await screen.findByRole('list', { name: 'Aktive spill' });
    expect(within(active).getByRole('heading', { name: 'Icewind Dale' })).toBeTruthy();
    expect(within(active).getByText(`${sheet.name} · ${sheet.summary}`)).toBeTruthy();
    const archived = screen.getByRole('list', { name: 'Arkiverte spill', hidden: true });
    expect(within(archived).getByRole('heading', { name: 'Lego-eventyret', hidden: true })).toBeTruthy();
    expect(screen.getByRole('link', { name: '+ Nytt spill' })).toBeTruthy();
  });

  it('arkiverer et spill med PATCH', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'PATCH /api/games/1': () => json(200, { ...detail, game: { ...game, status: 'archived' } }),
    });
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Arkiver Icewind Dale' }));
    await waitFor(() => expect(bodyOf(fn, 'PATCH /api/games/1')).toEqual({ status: 'archived' }));
  });
});

describe('Nytt spill', () => {
  it('forhåndsviser karakteren, lagrer spillet og går til arket', async () => {
    const fn = mockApi({
      ...baseRoutes,
      'POST /api/ddb/preview': () =>
        json(200, {
          character: { name: sheet.name, summary: sheet.summary, level: 4, hpMax: sheet.hpMax, ac: sheet.ac },
          sheet,
        }),
      'POST /api/games': () => json(201, detail),
    });
    renderAt('/spill/nytt');

    expect(await screen.findByRole('heading', { name: 'Nytt spill' })).toBeTruthy();
    expect(screen.getByText(/Character Privacy/)).toBeTruthy();
    // Lagre vises først etter forhåndsvisningen.
    expect(screen.queryByRole('button', { name: 'Lagre spillet' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Navn på spillet'), { target: { value: 'Icewind Dale' } });
    fireEvent.change(screen.getByLabelText('Lenke eller ID fra D&D Beyond'), { target: { value: FAKE_REF } });
    fireEvent.click(screen.getByRole('button', { name: 'Forhåndsvis' }));

    const preview = await screen.findByRole('region', { name: 'Forhåndsvisning' });
    expect(within(preview).getByText(sheet.name)).toBeTruthy();
    expect(within(preview).getByText(sheet.summary)).toBeTruthy();
    expect(within(preview).getByText(String(sheet.hpMax))).toBeTruthy();
    expect(within(preview).getByText(String(sheet.ac))).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/ddb/preview')).toEqual({ ddbUrlOrId: FAKE_REF });

    fireEvent.click(screen.getByRole('button', { name: 'Lagre spillet' }));
    expect(await screen.findByRole('heading', { level: 1, name: sheet.name })).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/games')).toEqual({
      name: 'Icewind Dale',
      ddbUrlOrId: FAKE_REF,
      cover: 'pergament',
    });
  });

  it('viser meldingen fra serveren når D&D Beyond svarer med feil', async () => {
    const message = 'Karakteren er privat. Sett Character Privacy til Public på D&D Beyond.';
    mockApi({ ...baseRoutes, 'POST /api/ddb/preview': () => json(422, { error: 'ddb_private', message }) });
    renderAt('/spill/nytt');

    fireEvent.change(await screen.findByLabelText('Lenke eller ID fra D&D Beyond'), {
      target: { value: FAKE_REF },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forhåndsvis' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(screen.queryByRole('button', { name: 'Lagre spillet' })).toBeNull();
  });

  it('forhåndsviser innlimt JSON lokalt og oppretter med json', async () => {
    const fn = mockApi({ ...baseRoutes, 'POST /api/games': () => json(201, detail) });
    renderAt('/spill/nytt');

    fireEvent.change(await screen.findByLabelText('Navn på spillet'), { target: { value: 'Icewind Dale' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Lim inn JSON' }));
    const area = screen.getByLabelText('JSON fra D&D Beyond');

    fireEvent.change(area, { target: { value: '{ ikke json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forhåndsvis' }));
    expect(screen.getByText(/Teksten er ikke gyldig JSON/)).toBeTruthy();

    const text = JSON.stringify(elowenRaw);
    fireEvent.change(area, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Forhåndsvis' }));
    const preview = screen.getByRole('region', { name: 'Forhåndsvisning' });
    expect(within(preview).getByText(sheet.summary)).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/ddb/preview')).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Lagre spillet' }));
    expect(await screen.findByRole('heading', { level: 1, name: sheet.name })).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/games')).toEqual({ name: 'Icewind Dale', json: text, cover: 'pergament' });
  });

  it('krever lenke før forhåndsvisning', async () => {
    const fn = mockApi(baseRoutes);
    renderAt('/spill/nytt');
    fireEvent.click(await screen.findByRole('button', { name: 'Forhåndsvis' }));
    expect(screen.getByText('Skriv inn lenken til karakteren eller ID-en.')).toBeTruthy();
    expect(bodyOf(fn, 'POST /api/ddb/preview')).toBeUndefined();
  });
});

describe('Ark', () => {
  it('viser toppfeltet, evneverdier, skills, våpen og spells fra arket', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/ark');

    expect(await screen.findByRole('heading', { level: 1, name: sheet.name })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Hovedmeny' });
    expect(within(nav).getByRole('link', { name: 'Ark' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Følgesvenner' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Mine spill' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Kamp' }).getAttribute('href')).toMatch(/\/kamp$/);
    await waitFor(() => expect(within(nav).getByText('Icewind Dale')).toBeTruthy());

    // Fasit fra D&D Beyond (se derive.fixtures.test.ts): HP 40 med 9 tapt, AC 14, Init +6.
    const stat = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
    expect(stat('HP')).toBe('31/40');
    expect(stat('AC')).toBe('14');
    expect(stat('Init')).toBe('+6');
    expect(stat('Speed')).toBe('35 ft');
    expect(stat('Passiv Perc.')).toBe(String(sheet.passive.perception));

    expect(screen.getByRole('heading', { name: 'Evneverdier og saves' })).toBeTruthy();
    const longbow = screen.getByText('Longbow').closest('li');
    expect(longbow?.textContent).toContain('+7');
    expect(longbow?.textContent).toContain('1d8+3');
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hva skjer på neste nivå' })).toBeTruthy();
    if (sheet.spells.length > 0) expect(screen.getByText(sheet.spells[0]!.name)).toBeTruthy();
  });

  it('tar skade fra innskrevet tall og sjekker tallet', async () => {
    mockApi({
      ...baseRoutes,
      'PUT /api/games/1/state': (init) => json(200, { ...JSON.parse(String(init?.body)), version: 2 }),
    });
    renderAt('/spill/1/ark');
    const input = await screen.findByLabelText('Antall HP');

    fireEvent.change(input, { target: { value: '2,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skade' }));
    expect(screen.getByText(/Skriv et helt tall fra 1 til 9999/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skade' }));
    const stat = screen.getByText('HP', { selector: 'dt' }).nextElementSibling;
    expect(stat?.textContent).toBe('26/40');
    expect(screen.getByText(/CON save mot DC 10/)).toBeTruthy();
  });

  it('fjerner skademeldingen når en 409 erstatter tilstanden', async () => {
    const server = { ...state.state, hpRemoved: 0 };
    mockApi({
      ...baseRoutes,
      'PUT /api/games/1/state': () =>
        json(409, {
          error: 'version_conflict',
          message: 'Endret på en annen enhet.',
          state: server,
          version: 7,
        }),
    });
    renderAt('/spill/1/ark');
    fireEvent.change(await screen.findByLabelText('Antall HP'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skade' }));
    expect(screen.getByText(/Tok 5 skade/)).toBeTruthy();

    expect(await screen.findByText('Endret på en annen enhet.', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/Tok 5 skade/)).toBeNull();
    expect(screen.getByText('HP', { selector: 'dt' }).nextElementSibling?.textContent).toBe('40/40');
  });

  it('merker spell slots og ressurser med nummer og brukt eller ledig', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/ark');
    const box = await screen.findByRole('checkbox', { name: 'Nivå 1, slot 1: ledig' });
    expect(screen.getByRole('checkbox', { name: "Hunter's Mark, bruk 2: ledig" })).toBeTruthy();
    fireEvent.click(box);
    expect(screen.getByRole('checkbox', { name: 'Nivå 1, slot 1: brukt' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Nivå 1, slot 2: ledig' })).toBeTruthy();
  });

  it('Short Rest tar slag per terning og viser hvor mye HP det gir', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/ark');
    fireEvent.click(await screen.findByRole('button', { name: 'Short Rest' }));
    const dialog = await screen.findByRole('dialog', { name: 'Short Rest' });

    fireEvent.change(within(dialog).getByLabelText('Antall d10 (4 igjen)'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('d10, slag 1'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('d10, slag 2'), { target: { value: '11' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ta Short Rest' }));
    expect(within(dialog).getByText('Et slag med d10 er fra 1 til 10.')).toBeTruthy();

    // CON +3 per terning: (3 + 3) + (7 + 3) = 16.
    fireEvent.change(within(dialog).getByLabelText('d10, slag 2'), { target: { value: '7' } });
    expect(within(dialog).getByText('16')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ta Short Rest' }));
    expect(screen.getByText('HP', { selector: 'dt' }).nextElementSibling?.textContent).toBe('40/40');
    expect(screen.getByText(/Hit Dice: 2 av 4 d10/)).toBeTruthy();
  });

  it('bytter karakter med PATCH ddbUrlOrId etter en advarsel', async () => {
    const fn = mockApi({ ...baseRoutes, 'PATCH /api/games/1': () => json(200, detail) });
    renderAt('/spill/1/ark');
    await screen.findByRole('heading', { level: 1, name: sheet.name });
    expect(screen.getByText(/HP, brukte ressurser og kjæledyr starter på nytt/)).toBeTruthy();
    const panel = screen.getByText('Bytt karakter', { selector: 'summary' }).closest('details')!;
    fireEvent.change(within(panel).getByLabelText('Lenke eller ID fra D&D Beyond'), {
      target: { value: '1000002' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Bytt karakter' }));
    await waitFor(() => expect(bodyOf(fn, 'PATCH /api/games/1')).toEqual({ ddbUrlOrId: '1000002' }));
    expect(await within(panel).findByText('Karakteren er byttet.')).toBeTruthy();
  });

  it('viser Følgesvenner med kjæledyrene fra arket', async () => {
    mockApi(baseRoutes);
    renderAt('/spill/1/folgesvenner');
    expect(await screen.findByRole('heading', { level: 1, name: 'Følgesvenner' })).toBeTruthy();
    for (const p of sheet.pets) expect(screen.getByRole('heading', { name: p.name })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Egne følgesvenner' })).toBeTruthy();
  });
});

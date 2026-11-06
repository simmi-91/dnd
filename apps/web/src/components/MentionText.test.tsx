import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/auth';
import { MentionText } from './MentionText';

const base = { summary: '', archived: false, status: null, fields: {}, updatedAt: 'x' };
const entries = [
  { ...base, id: 20, kind: 'person', name: 'Brann Holt' },
  { ...base, id: 30, kind: 'place', name: 'Eldmark' },
  { ...base, id: 10, kind: 'quest', name: 'Finn karavanen', status: 'active' },
];

function mockEntries() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ entries, counts: { quest: 1, person: 1, place: 1, other: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
}

function renderText(text: string) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient({ retry: false })}>
        <MentionText text={text} gameId={1} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MentionText', () => {
  it('viser koblinger som lenker med farge etter typen oppføringen har', async () => {
    mockEntries();
    renderText('Møtte @[Brann](e:20) i #[Eldmark](e:30). Oppdrag: ![finne karavanen](e:10).');
    const person = await screen.findByRole('link', { name: 'Brann' });
    expect(person.getAttribute('href')).toBe('/spill/1/bok/20?fane=personer');
    expect(person.getAttribute('data-kind')).toBe('person');
    expect(screen.getByRole('link', { name: 'Eldmark' }).getAttribute('data-kind')).toBe('place');
    const quest = screen.getByRole('link', { name: 'finne karavanen' });
    expect(quest.getAttribute('data-kind')).toBe('quest');
    expect(quest.getAttribute('href')).toBe('/spill/1/bok/10?fane=quester');
  });

  it('bruker typen fra oppføringen, ikke tegnet i teksten', async () => {
    mockEntries();
    renderText('#[Brann](e:20)');
    expect((await screen.findByRole('link', { name: 'Brann' })).getAttribute('data-kind')).toBe('person');
  });

  it('viser koblinger til ukjente ID-er og (new) som vanlig tekst', async () => {
    mockEntries();
    const { container } = renderText('@[Borte](e:999) og @[Ny](new) og @[Brann](e:20)');
    await screen.findByRole('link', { name: 'Brann' });
    // Bare Brann finnes. De andre er tekst uten lenke.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(container.textContent).toBe('Borte og Ny og Brann');
  });

  it('beholder linjeskift', async () => {
    mockEntries();
    const { container } = renderText('Første linje\n@[Brann](e:20)\n\nSiste');
    await screen.findByRole('link', { name: 'Brann' });
    expect(container.textContent).toBe('Første linje\nBrann\n\nSiste');
  });
});

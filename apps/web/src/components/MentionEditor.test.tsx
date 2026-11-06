import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/auth';
import { MentionEditor } from './MentionEditor';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const suggestions = [
  { id: 30, kind: 'place', name: 'Eldmark' },
  { id: 31, kind: 'place', name: 'Grålia-vadet' },
];

function Harness({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="notat">Notat</label>
      <MentionEditor
        id="notat"
        gameId={1}
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
    </>
  );
}

function setup(initial = '') {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(json(200, { suggestions }))),
  );
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>
      <MemoryRouter>
        <Harness initial={initial} onChange={onChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText('Notat') as HTMLTextAreaElement;
  return { input, onChange };
}

function type(el: HTMLTextAreaElement, value: string, caret = value.length) {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value, selectionStart: caret, selectionEnd: caret } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MentionEditor', () => {
  it('piltaster flytter valget, Enter velger, og Esc lukker', async () => {
    const { input, onChange } = setup('Mot ');
    type(input, 'Mot #');
    const list = await screen.findByRole('listbox', { name: 'Forslag: sted' });
    const first = await within(list).findByRole('option', { name: /Eldmark/ });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = within(list).getByRole('option', { name: /Grålia-vadet/ });
    expect(second.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Mot #Grålia-vadet ');
    expect(onChange).toHaveBeenLastCalledWith('Mot #[Grålia-vadet](e:31) ');

    type(input, 'Mot #Grålia-vadet og @');
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('redigering inni en kobling gjør den til vanlig tekst', () => {
    const { input, onChange } = setup('Hos @[Brann Holt](e:20) i dag');
    expect(input.value).toBe('Hos @Brann Holt i dag');
    // Sletter «t» i «Holt».
    type(input, 'Hos @Brann Hol i dag', 14);
    expect(onChange).toHaveBeenLastCalledWith('Hos @Brann Hol i dag');
  });

  it('en ny verdi utenfra (f.eks. ID fra serveren) bytter koblingen uten å endre teksten', () => {
    function Outer() {
      const [value, setValue] = useState('Mot ![finne karavanen](new)');
      return (
        <>
          <label htmlFor="n2">N2</label>
          <MentionEditor id="n2" gameId={1} value={value} onChange={setValue} />
          <button type="button" onClick={() => setValue('Mot ![finne karavanen](e:9)')}>
            Svar
          </button>
          <output data-testid="lagret">{value}</output>
        </>
      );
    }
    render(
      <QueryClientProvider client={createQueryClient({ retry: false })}>
        <MemoryRouter>
          <Outer />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText('N2') as HTMLTextAreaElement;
    expect(input.value).toBe('Mot !finne karavanen');
    fireEvent.click(screen.getByRole('button', { name: 'Svar' }));
    expect(input.value).toBe('Mot !finne karavanen');
    type(input, 'Mot !finne karavanen.');
    expect(screen.getByTestId('lagret').textContent).toBe('Mot ![finne karavanen](e:9).');
  });
  it('en musepeker som står stille endrer ikke valget; bare bevegelse gjør det', async () => {
    const { input, onChange } = setup('Til ');
    type(input, 'Til #Eldm');
    const list = await screen.findByRole('listbox', { name: 'Forslag: sted' });
    const first = await within(list).findByRole('option', { name: /Eldmark/ });
    const create = within(list).getByRole('option', { name: 'Opprett «Eldm»' });
    // Lista dukker opp under pekeren: mouseenter uten bevegelse.
    fireEvent.mouseEnter(create);
    fireEvent.mouseOver(create);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseMove(create);
    expect(create.getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseMove(first);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('Til #[Eldmark](e:30) ');
  });
});

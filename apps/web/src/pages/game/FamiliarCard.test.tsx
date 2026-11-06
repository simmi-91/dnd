import { castsLeft, deriveCharacter, initialGameState, type GameState, type Sheet } from '@dnd/rules';
import type { Game } from '@dnd/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import elowenRaw from '../../../../../packages/rules/fixtures/elowen-4.json';
import type { GameStateHook } from '../../state/useGameState';
import { FamiliarSection } from './FamiliarCard';
import { GameContext } from './GameContext';

const sheet: Sheet = deriveCharacter(elowenRaw);
let latest: GameState;
const remember = (s: GameState) => {
  latest = s;
};

/** Gir FamiliarSection en enkel synk som bare holder tilstanden i minnet. */
function Harness({ start, sheetOverride }: { start: GameState; sheetOverride?: Sheet }) {
  const [state, setState] = useState(start);
  useEffect(() => remember(state), [state]);
  const sync = {
    state,
    update: (fn: (s: GameState) => GameState) => setState((s) => fn(s)),
  } as unknown as GameStateHook;
  return (
    <GameContext.Provider
      value={{ game: { name: 'Icewind Dale' } as Game, sheet: sheetOverride ?? sheet, sync }}
    >
      <FamiliarSection />
    </GameContext.Provider>
  );
}

afterEach(cleanup);

describe('familiar på Følgesvenner-siden', () => {
  it('vises ikke når arket mangler Find Familiar og spillet ikke har en', () => {
    const { container } = render(
      <Harness start={initialGameState(sheet)} sheetOverride={{ ...sheet, familiar: false }} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('kaller fram ugla som ritual, skader den til 0 HP og kaller den fram igjen', () => {
    render(<Harness start={initialGameState(sheet)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kall fram familiar' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Navn'), { target: { value: 'Ugla' } });
    fireEvent.change(within(dialog).getByLabelText('Skapningstype'), { target: { value: 'celestial' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kast Find Familiar' }));

    expect(latest.familiar).toEqual({
      form: 'owl',
      name: 'Ugla',
      hpRemoved: 0,
      present: true,
      creatureType: 'celestial',
    });
    // Ritual bruker ingen slot eller gratis-kast.
    expect(castsLeft(latest, sheet, 'Find Familiar')).toBe(
      castsLeft(initialGameState(sheet), sheet, 'Find Familiar'),
    );
    expect(screen.getByText(/Owl · Celestial · Til stede/)).toBeTruthy();
    expect(screen.getAllByText(/flyging 60 ft, gange 5 ft/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('HP for Ugla'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Skade på Ugla' }));
    expect(latest.familiar?.present).toBe(false);
    expect(screen.getByText(/forsvant på 0 HP/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hent tilbake' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Kall fram på nytt' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Kast Find Familiar' }));
    expect(latest.familiar).toMatchObject({
      name: 'Ugla',
      present: true,
      hpRemoved: 0,
      creatureType: 'celestial',
    });
  });

  it('sender bort og henter tilbake uten å endre HP, og spell slot-kast betaler', () => {
    const start: GameState = {
      ...initialGameState(sheet),
      familiar: { form: 'cat', name: 'Pus', hpRemoved: 1, present: true },
    };
    render(<Harness start={start} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send bort' }));
    expect(latest.familiar).toMatchObject({ present: false, hpRemoved: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Hent tilbake' }));
    expect(latest.familiar).toMatchObject({ present: true, hpRemoved: 1 });

    const before = castsLeft(latest, sheet, 'Find Familiar') ?? 0;
    fireEvent.click(screen.getByRole('button', { name: 'Kast på nytt / bytt form' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Form'), { target: { value: 'eagle' } });
    fireEvent.click(within(dialog).getByLabelText(/Med spell slot/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kast Find Familiar' }));
    expect(latest.familiar).toMatchObject({ form: 'eagle', name: 'Pus', hpRemoved: 0, present: true });
    expect(castsLeft(latest, sheet, 'Find Familiar')).toBe(before - 1);
  });
});

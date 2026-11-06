import {
  FAMILIAR_ID,
  castCost,
  payCast,
  combatFromGame,
  deriveCharacter,
  initialGameState,
  initiativeOrder,
  setInitiative,
  startCombat,
  turReducer,
  type CombatState,
  type FamiliarState,
  type GameState,
  type Sheet,
} from '@dnd/rules';
import type { Game } from '@dnd/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import elowenRaw from '../../../../../../packages/rules/fixtures/elowen-4.json';
import type { GameStateHook } from '../../../state/useGameState';
import { GameContext } from '../GameContext';
import { CombatContext } from './CombatContext';
import { RoundView } from './RoundView';
import { SetupView, StartButton } from './SetupView';

const sheet: Sheet = deriveCharacter(elowenRaw);
const OWL: FamiliarState = { form: 'owl', name: 'Ugla', hpRemoved: 0, present: true, creatureType: 'fey' };

let latest: { game: GameState; combat: CombatState };

/** Kamp der karakteren har tur først, så familiaren, så bjørnene. */
function fight(game: GameState): CombatState {
  let s = combatFromGame(sheet, game);
  const order = ['char', FAMILIAR_ID, ...s.participants.map((p) => p.id)];
  [...new Set(order)].forEach((id, i) => {
    s = setInitiative(s, id, { total: 20 - i });
  });
  return startCombat(s);
}

function Harness({
  game: startGame,
  combat: startCombat,
  setup,
}: {
  game: GameState;
  combat: CombatState;
  setup?: boolean;
}) {
  const [game, setGame] = useState(startGame);
  const [combat, setCombat] = useState(startCombat);
  useEffect(() => {
    latest = { game, combat };
  }, [game, combat]);
  const sync = {
    state: game,
    update: (fn: (s: GameState) => GameState) => setGame((s) => fn(s)),
  } as unknown as GameStateHook;
  return (
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
        {setup ? (
          <>
            <StartButton />
            <SetupView />
          </>
        ) : (
          <RoundView />
        )}
      </CombatContext.Provider>
    </GameContext.Provider>
  );
}

const withOwl = (f: FamiliarState = OWL): GameState => ({ ...initialGameState(sheet), familiar: f });
const panel = (name: string) => screen.getByRole('region', { name: `Panel for ${name}` });
const tab = (name: RegExp) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: /Deltakere/ })).getByRole('button', { name }),
  );
const step = (root: HTMLElement, title: string) => within(root).getByRole('region', { name: title });

afterEach(cleanup);

describe('familiaren på kampskjermen (F3)', () => {
  it('Help øverst som anbefalt, Flyby som påminnelse, Lever touch-spell som reaction og bevegelse med alle typene', () => {
    const g = withOwl();
    render(<Harness game={g} combat={turReducer(fight(g), { type: 'endTurn' })} />);
    const owl = panel('Ugla');
    const actions = within(step(owl, 'Action')).getAllByRole('button');
    expect(actions[0]?.textContent).toMatch(/^HelpAnbefalt/);
    expect(within(step(owl, 'Action')).queryByText(/^Attack/)).toBeNull();
    expect(within(owl).getByText(/Husk Flyby:/)).toBeTruthy();
    const reaction = step(owl, 'Reaction');
    expect(within(reaction).getByText('Lever touch-spell')).toBeTruthy();
    expect(within(reaction).queryByText('Ink Cloud')).toBeNull();
    expect(within(owl).getByText('Bevegelse: flyging 60 ft, gange 5 ft.')).toBeTruthy();
  });

  it('Ink Cloud bare for Octopus', () => {
    const g = withOwl({ ...OWL, form: 'octopus', name: 'Blekk' });
    render(<Harness game={g} combat={fight(g)} />);
    tab(/Blekk/);
    const octo = panel('Blekk');
    expect(within(step(octo, 'Reaction')).getByText('Ink Cloud')).toBeTruthy();
    expect(within(octo).queryByText(/Husk Flyby/)).toBeNull();
  });

  it('Help fra familiaren gir karakteren advantage', () => {
    const g = withOwl();
    let s = fight(g);
    s = turReducer(s, { type: 'endTurn' });
    expect(s.current).toBe(FAMILIAR_ID);
    render(<Harness game={g} combat={s} />);
    const owl = panel('Ugla');
    fireEvent.click(within(step(owl, 'Action')).getAllByRole('button')[0]!);
    fireEvent.click(within(owl).getByRole('button', { name: 'Bruk Help' }));
    expect(latest.combat.effects).toEqual([
      expect.objectContaining({ kind: 'help', source: FAMILIAR_ID, target: 'char' }),
    ]);
    tab(/Elowen/);
    expect(within(panel('Elowen')).getByText(/Advantage fra Help \(Ugla\)/)).toBeTruthy();
  });

  it('Se gjennom familiaren er bonus action for karakteren, bare når familiaren er til stede', () => {
    const g = withOwl();
    const { unmount } = render(<Harness game={g} combat={fight(g)} />);
    const bonus = step(panel('Elowen'), 'Bonus action');
    expect(within(bonus).getByText('Se gjennom familiaren')).toBeTruthy();
    expect(within(bonus).getByText(/gjennom Ugla, med Darkvision 120 ft/)).toBeTruthy();
    unmount();

    const away = withOwl({ ...OWL, present: false });
    render(<Harness game={away} combat={fight(withOwl())} />);
    expect(within(step(panel('Elowen'), 'Bonus action')).queryByText('Se gjennom familiaren')).toBeNull();
  });

  it('skade til 0 HP tar familiaren ut av kampen og av spillet', () => {
    const g = withOwl();
    render(<Harness game={g} combat={fight(g)} />);
    tab(/Ugla/);
    const owl = panel('Ugla');
    fireEvent.change(within(owl).getByLabelText('HP for Ugla'), { target: { value: '1' } });
    fireEvent.click(within(owl).getByRole('button', { name: 'Skade på Ugla' }));
    expect(latest.game.familiar?.present).toBe(false);
    expect(latest.combat.participants.some((p) => p.id === FAMILIAR_ID)).toBe(false);
  });
});

describe('kampskjermen', () => {
  it('angrep med Longbow: d20, traff, skade, og action er brukt', () => {
    const g = initialGameState(sheet);
    render(<Harness game={g} combat={fight(g)} />);
    const me = panel('Elowen');
    fireEvent.click(within(me).getByRole('button', { name: /Angrip med Longbow/ }));
    const flow = within(me).getByRole('group', { name: 'Angrep med Longbow' });
    fireEvent.change(within(flow).getByLabelText('Rull for å treffe'), { target: { value: '12' } });
    fireEvent.click(within(flow).getByRole('button', { name: 'OK' }));
    expect(latest.combat.participants[0]?.turn.action).toBe('attack');
    fireEvent.click(within(flow).getByRole('button', { name: 'Traff' }));
    const input = within(flow).getByLabelText(/Longbow: 1d8/);
    fireEvent.change(input, { target: { value: '30' } });
    expect(within(flow).getByText('1d8 gir mellom 1 og 8.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '5' } });
    // Dreadful Strike er på som standard, så fyll inn den også.
    const ds = within(flow).queryByLabelText(/Dreadful Strike/);
    if (ds) fireEvent.change(ds, { target: { value: '7' } });
    fireEvent.click(within(flow).getByRole('button', { name: 'Regn ut skade' }));
    expect(within(flow).getByText('Total skade')).toBeTruthy();
    fireEvent.click(within(flow).getByRole('button', { name: 'Ferdig' }));
    // Uten Extra Attack er Attack-actionen brukt opp, og grunnen vises.
    expect(within(me).getAllByText('Du har brukt alle angrepene i Attack-actionen').length).toBeGreaterThan(
      0,
    );
  });

  it('andre spell med slot samme tur er grå med grunnen under', () => {
    // Ingen gratis-kast igjen, så Hunter's Mark bruker en spell slot.
    let g = initialGameState(sheet);
    while (castCost(g, sheet, "Hunter's Mark")?.kind === 'free') g = payCast(g, sheet, "Hunter's Mark").state;
    render(<Harness game={g} combat={fight(g)} />);
    const me = panel('Elowen');
    fireEvent.click(within(step(me, 'Bonus action')).getByRole('button', { name: /^Hunter's Mark/ }));
    expect(latest.game.slotsUsed['1']).toBe(1);
    const disguise = within(step(me, 'Action')).getByRole('button', { name: /^Disguise Self/ });
    expect(disguise).toHaveProperty('disabled', true);
    expect(disguise.textContent).toMatch(/Du har alt brukt en spell slot denne turen/);
    expect(within(step(me, 'Action')).getByRole('button', { name: /^Druidcraft/ })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('ventende konsentrasjonssjekk gjør resten grått, og bevegelse går ikke i andres tur', () => {
    const g = withOwl();
    let s = turReducer(fight(g), { type: 'concentrate', spell: "Hunter's Mark" });
    s = turReducer(s, { type: 'damaged', who: 'char', amount: 4 });
    render(<Harness game={g} combat={s} />);
    const me = panel('Elowen');
    expect(within(me).getByText("Konsentrasjon på Hunter's Mark")).toBeTruthy();
    expect(within(me).getByRole('button', { name: /Angrip med Longbow/ })).toHaveProperty('disabled', true);
    expect(within(me).getByRole('button', { name: /^Resten/ })).toHaveProperty('disabled', true);
    tab(/Ugla/);
    expect(within(panel('Ugla')).getByRole('button', { name: /^Resten/ })).toHaveProperty('disabled', true);
  });

  it('«?» åpner infoen i skuffen uten å bruke valget, og skuffen kan lukkes', () => {
    const g = initialGameState(sheet);
    render(<Harness game={g} combat={fight(g)} />);
    const me = panel('Elowen');
    fireEvent.click(within(me).getByRole('button', { name: 'Hva gjør Druidcraft?' }));
    const drawer = screen.getByRole('region', { name: 'Info: Druidcraft' });
    expect(within(drawer).getByText(/Whispering to the spirits of nature/)).toBeTruthy();
    expect(latest.combat.participants[0]?.turn.action).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Lukk info' }));
    expect(screen.queryByRole('region', { name: 'Info: Druidcraft' })).toBeNull();
    fireEvent.click(within(me).getByRole('button', { name: 'Hva gjør Longbow?' }));
    expect(screen.getByText(/Mellom 150 og 600 ft \(lang avstand\) har angrepet disadvantage/)).toBeTruthy();
  });

  it('oppsett: initiativ med d20 og fiende uten HP, og start runde 1', () => {
    const g = initialGameState(sheet);
    render(<Harness game={g} combat={combatFromGame(sheet, g)} setup />);
    fireEvent.change(screen.getByLabelText('Initiativ d20 for Elowen'), { target: { value: '10' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'OK' })[0]!);
    expect(latest.combat.participants[0]?.initiative).toBe(10 + sheet.initiative);
    // «Rull» lar appen rulle d20 for den som ikke vil bruke fysisk terning.
    fireEvent.click(screen.getByRole('button', { name: 'Rull for alle uten initiativ (2)' }));
    for (const p of latest.combat.participants.slice(1)) {
      expect(p.roll).toBeGreaterThanOrEqual(1);
      expect(p.roll).toBeLessThanOrEqual(20);
      expect(p.initiative).toBe((p.roll ?? 0) + p.initiativeBonus);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Rull initiativ for Elowen' }));
    expect(latest.combat.participants[0]?.roll).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('Navn'), { target: { value: 'Goblin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Legg til' }));
    expect(latest.combat.participants.find((p) => p.name === 'Goblin')).toMatchObject({
      kind: 'enemy',
      hp: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start runde 1' }));
    // Kastene er tilfeldige, så den med høyest initiativ har tur.
    expect(latest.combat).toMatchObject({
      status: 'active',
      round: 1,
      current: initiativeOrder(latest.combat)[0],
    });
  });
});

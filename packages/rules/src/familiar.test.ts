import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import {
  DELIVER_TOUCH,
  FAMILIAR_FORMS,
  FAMILIAR_FORM_IDS,
  FAMILIAR_ID,
  activeRules,
  attackRoll,
  canDo,
  changeFamiliarForm,
  combatFromGame,
  damageFamiliar,
  damageFamiliarInCombat,
  deriveCharacter,
  familiarHp,
  familiarHpMax,
  familiarParticipant,
  familiarTurnOptions,
  healFamiliar,
  initialGameState,
  isFamiliarForm,
  longRest,
  mergeOnRefresh,
  modOf,
  setFamiliarPresent,
  setInitiative,
  startCombat,
  summonFamiliar,
  turReducer,
  turnOptions,
} from './index.ts';
import type { CombatState, GameState } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const lego = deriveCharacter(legoRaw);
const withOwl = (): GameState => summonFamiliar(initialGameState(elowen), { form: 'owl', name: 'Ugla' });

describe('formene i Find Familiar (2024)', () => {
  it('har alle elleve former', () => {
    expect([...FAMILIAR_FORM_IDS]).toEqual([
      'owl',
      'cat',
      'bat',
      'raven',
      'hawk',
      'rat',
      'spider',
      'frog',
      'lizard',
      'weasel',
      'octopus',
    ]);
    for (const id of FAMILIAR_FORM_IDS) {
      const f = FAMILIAR_FORMS[id];
      expect(f.id).toBe(id);
      expect(f.initiative).toBe(modOf(f.dex));
      expect(f.ac).toBeGreaterThanOrEqual(10);
      expect(f.hp).toBeGreaterThanOrEqual(1);
      expect(f.text.length).toBeGreaterThan(10);
      for (const t of f.traits) expect(t.text.length).toBeGreaterThan(5);
    }
  });

  it('tallene for formene', () => {
    const pick = (id: (typeof FAMILIAR_FORM_IDS)[number]) => {
      const f = FAMILIAR_FORMS[id];
      return [f.ac, f.hp, f.initiative, f.speed];
    };
    expect(pick('owl')).toEqual([11, 1, 1, { walk: 5, fly: 60 }]);
    expect(pick('cat')).toEqual([12, 2, 2, { walk: 40, climb: 40 }]);
    expect(pick('bat')).toEqual([12, 1, 2, { walk: 5, fly: 30 }]);
    expect(pick('raven')).toEqual([12, 2, 2, { walk: 10, fly: 50 }]);
    expect(pick('hawk')).toEqual([13, 1, 3, { walk: 10, fly: 60 }]);
    expect(pick('rat')).toEqual([10, 1, 0, { walk: 20, climb: 20 }]);
    expect(pick('spider')).toEqual([12, 1, 2, { walk: 20, climb: 20 }]);
    expect(pick('frog')).toEqual([11, 1, 1, { walk: 20, swim: 20 }]);
    expect(pick('lizard')).toEqual([10, 2, 1, { walk: 20, climb: 20 }]);
    expect(pick('weasel')).toEqual([13, 1, 3, { walk: 30, climb: 30 }]);
    expect(pick('octopus')).toEqual([12, 3, 2, { walk: 5, swim: 30 }]);
    expect(FAMILIAR_FORMS.owl.traits.map((t) => t.name)).toEqual(['Flyby']);
    expect(FAMILIAR_FORMS.owl.senses).toEqual(['Darkvision 120 ft']);
    expect(FAMILIAR_FORMS.owl.skills).toEqual({ Perception: 5, Stealth: 5 });
  });

  it('isFamiliarForm', () => {
    expect(isFamiliarForm('owl')).toBe(true);
    expect(isFamiliarForm('dragon')).toBe(false);
    expect(isFamiliarForm(3)).toBe(false);
  });

  it('Find Familiar står i registeret, uten valg for karakteren', () => {
    expect(activeRules(elowen).map((r) => r.key)).toContain('find-familiar');
    expect(turnOptions(elowen).reactions.map((o) => o.id)).not.toContain(DELIVER_TOUCH.id);
  });
});

describe('familiaren i GameState', () => {
  it('eldre tilstand uten familiar virker som før', () => {
    const g = initialGameState(elowen);
    expect('familiar' in g).toBe(false);
    expect(familiarHp(g.familiar)).toBe(0);
    expect(damageFamiliar(g, 3)).toEqual({ state: g, vanished: false });
    expect(healFamiliar(g, 3)).toBe(g);
    expect(changeFamiliarForm(g, 'cat')).toBe(g);
    expect(setFamiliarPresent(g, true)).toBe(g);
    expect(longRest(g, elowen)).not.toHaveProperty('familiar');
  });

  it('summonFamiliar gir full HP, og navnet beholdes ved nytt kast', () => {
    const g = withOwl();
    expect(g.familiar).toEqual({ form: 'owl', name: 'Ugla', hpRemoved: 0, present: true });
    expect(familiarHp(g.familiar)).toBe(1);
    expect(summonFamiliar(initialGameState(elowen), { form: 'cat' }).familiar?.name).toBe('Cat');
    const cat = changeFamiliarForm(g, 'cat');
    expect(cat.familiar).toEqual({ form: 'cat', name: 'Ugla', hpRemoved: 0, present: true });
    expect(familiarHpMax(cat.familiar!)).toBe(2);
  });

  it('skade og helbredelse', () => {
    let g = summonFamiliar(initialGameState(elowen), { form: 'octopus', name: 'Blekk' });
    g = damageFamiliar(g, 2).state;
    expect(familiarHp(g.familiar)).toBe(1);
    g = healFamiliar(g, 5);
    expect(familiarHp(g.familiar)).toBe(3);
  });

  it('på 0 HP forsvinner den, uten death saves', () => {
    const r = damageFamiliar(withOwl(), 5);
    expect(r.vanished).toBe(true);
    expect(r.state.familiar).toMatchObject({ present: false, hpRemoved: 1 });
    expect(r.state.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(familiarHp(r.state.familiar)).toBe(0);
    // Borte: ingen mer skade eller helbredelse.
    expect(damageFamiliar(r.state, 1).state).toBe(r.state);
    expect(healFamiliar(r.state, 1)).toBe(r.state);
  });

  it('Long Rest gir full HP hvis den er til stede, men henter den ikke tilbake', () => {
    const hurt = damageFamiliar(summonFamiliar(initialGameState(elowen), { form: 'cat' }), 1).state;
    expect(longRest(hurt, elowen).familiar?.hpRemoved).toBe(0);
    const gone = damageFamiliar(withOwl(), 1).state;
    expect(longRest(gone, elowen).familiar?.present).toBe(false);
    // Den kommer tilbake med et nytt kast.
    expect(summonFamiliar(gone, { form: 'owl' }).familiar).toMatchObject({ present: true, hpRemoved: 0 });
  });

  it('beholdes ved ny henting fra D&D Beyond', () => {
    const g = withOwl();
    expect(mergeOnRefresh(g, elowen, { alsoHpAndResources: true }).familiar).toEqual(g.familiar);
    expect(
      mergeOnRefresh(initialGameState(elowen), elowen, { alsoHpAndResources: false }),
    ).not.toHaveProperty('familiar');
  });
});

function fight(g: GameState = withOwl()): CombatState {
  let s = combatFromGame(elowen, g);
  s.participants.forEach((p, i) => {
    s = setInitiative(s, p.id, { total: 20 - i });
  });
  return startCombat(s);
}

describe('familiaren i kamp', () => {
  it('blir egen deltaker når arket har Find Familiar og den er til stede', () => {
    const s = combatFromGame(elowen, withOwl());
    const f = s.participants.find((p) => p.id === FAMILIAR_ID);
    expect(f).toMatchObject({
      kind: 'familiar',
      name: 'Ugla',
      refId: 'owl',
      initiativeBonus: 1,
      ac: 11,
      hp: null,
    });
    expect(f?.limits).toMatchObject({ canAttack: false, speed: 60 });
    expect(familiarParticipant({ form: 'cat', name: 'Pus', hpRemoved: 0, present: true }).limits.speed).toBe(
      40,
    );
  });

  it('er ikke med når den har forsvunnet, ikke finnes, eller arket mangler spellen', () => {
    const ids = (sheet: typeof elowen, g: GameState) =>
      combatFromGame(sheet, g).participants.map((p) => p.id);
    expect(ids(elowen, setFamiliarPresent(withOwl(), false))).not.toContain(FAMILIAR_ID);
    expect(ids(elowen, initialGameState(elowen))).not.toContain(FAMILIAR_ID);
    expect(
      ids({ ...lego, familiar: false }, summonFamiliar(initialGameState(lego), { form: 'owl' })),
    ).not.toContain(FAMILIAR_ID);
  });

  it('har eget initiativ og egen tur, og kan ikke angripe', () => {
    let s = fight();
    s = turReducer(s, { type: 'selectTurn', who: FAMILIAR_ID });
    expect(s.current).toBe(FAMILIAR_ID);
    expect(canDo(s, { kind: 'action', action: 'attack' }).reason).toBe(
      'En familiar kan ikke angripe (Find Familiar)',
    );
    const talons = { key: 'talons', name: 'Talons', light: false, ranged: false, mastery: null };
    expect(canDo(s, { kind: 'attack', weapon: talons, attack: 'main' }).ok).toBe(false);
    expect(canDo(s, { kind: 'attack', weapon: talons, attack: 'opportunity' }).ok).toBe(false);
    expect(canDo(s, { kind: 'action', action: 'help' }).ok).toBe(true);
  });

  it('Help er anbefalt, Attack finnes ikke blant valgene', () => {
    const o = familiarTurnOptions();
    expect(o.actions.filter((a) => a.recommended).map((a) => a.action.id)).toEqual(['help']);
    expect(o.actions.map((a) => a.action.id)).not.toContain('attack');
    expect(o.reactions).toEqual([DELIVER_TOUCH]);
  });

  it('Lever touch-spell bruker familiarens reaction', () => {
    let s = fight();
    expect(canDo(s, { who: 'char', kind: 'option', option: DELIVER_TOUCH }).reason).toBe(
      'Bare familiaren kan gjøre dette',
    );
    // Reaction går også utenfor egen tur.
    expect(canDo(s, { who: FAMILIAR_ID, kind: 'option', option: DELIVER_TOUCH }).ok).toBe(true);
    s = turReducer(s, { type: 'option', who: FAMILIAR_ID, option: DELIVER_TOUCH });
    expect(s.participants.find((p) => p.id === FAMILIAR_ID)?.turn.reaction).toBe('deliver-touch-spell');
    expect(canDo(s, { who: FAMILIAR_ID, kind: 'option', option: DELIVER_TOUCH }).ok).toBe(false);
  });

  it('skade til 0 HP fjerner den fra kampen, logger det og tar bort Help', () => {
    let s = turReducer(fight(), { type: 'selectTurn', who: FAMILIAR_ID });
    s = turReducer(s, { type: 'action', action: 'help', target: 'char' });
    expect(attackRoll(s, 'char').advantage).toEqual(['Help fra Ugla']);
    const r = damageFamiliarInCombat(s, withOwl(), 4);
    expect(r.vanished).toBe(true);
    expect(r.game.familiar?.present).toBe(false);
    expect(r.combat.participants.map((p) => p.id)).not.toContain(FAMILIAR_ID);
    expect(r.combat.log[0]?.text).toBe(
      'Ugla forsvant (0 HP). Den kommer tilbake når du kaster Find Familiar igjen.',
    );
    expect(r.combat.effects.some((e) => e.kind === 'help')).toBe(false);
    expect(attackRoll(r.combat, 'char').advantage).toEqual([]);
    // Turen går videre fra familiaren.
    expect(r.combat.current).not.toBe(FAMILIAR_ID);
    // Lever touch-spell går ikke når den er borte.
    expect(canDo(r.combat, { who: FAMILIAR_ID, kind: 'option', option: DELIVER_TOUCH }).ok).toBe(false);
  });

  it('skade under 0 HP holder den i kampen, og uten familiar skjer ingenting', () => {
    const cat = summonFamiliar(initialGameState(elowen), { form: 'cat', name: 'Pus' });
    const r = damageFamiliarInCombat(fight(cat), cat, 1);
    expect(r.vanished).toBe(false);
    expect(r.combat.participants.map((p) => p.id)).toContain(FAMILIAR_ID);
    expect(r.combat.log[0]?.text).toBe('Pus tok 1 skade');
    const none = initialGameState(elowen);
    const c = fight(none);
    expect(damageFamiliarInCombat(c, none, 3)).toEqual({ combat: c, game: none, vanished: false });
  });
});

// Funn fra den uavhengige valideringen av fase 3a. Én describe per funn.
import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import {
  REASONS,
  addEnemy,
  addParticipant,
  createCombat,
  attackRoll,
  canDo,
  castsLeft,
  combatFromGame,
  companionParticipant,
  concentratingOn,
  conditionsToGame,
  deriveCharacter,
  extraDamageOptions,
  initialGameState,
  movementLeft,
  payCast,
  resourceContext,
  setInitiative,
  startCombat,
  turReducer,
  turnOptions,
  turnWeapon,
} from './index.ts';
import type { CombatState, GameState, TurnEvent } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const OWL = { form: 'owl' as const, name: 'Ugla', hpRemoved: 0, present: true };
const BEAR = 'pet:25974574';
const OWL_ID = 'familiar';

function game(): GameState {
  return { ...initialGameState(elowen), familiar: OWL };
}

/** Elowen først, så bjørnene og ugla, så to orker (e1 med 10 HP, e2 uten HP). */
function fight(g: GameState = game()): CombatState {
  let s = combatFromGame(elowen, g);
  s = addEnemy(s, { name: 'Ork', hpMax: 10 }).state;
  s = addEnemy(s, { name: 'Ork 2' }).state;
  s.participants.forEach((p, i) => {
    s = setInitiative(s, p.id, { total: 20 - i });
  });
  return startCombat(s);
}

const run = (s: CombatState, ...events: TurnEvent[]): CombatState => events.reduce(turReducer, s);
const ofKind = (s: CombatState, id: string) => s.participants.find((p) => p.id === id)!;
const nextRoundAll = (s: CombatState): CombatState => {
  let n = s;
  while (n.current) n = turReducer(n, { type: 'endTurn' });
  return turReducer(n, { type: 'nextRound' });
};

const all = turnOptions(elowen);
const hmCast = all.bonus.find((o) => o.id === 'cast-hunters-mark')!;
const hmMove = all.bonus.find((o) => o.id === 'move-hunters-mark')!;
const hmDmg = extraDamageOptions(elowen).find((d) => d.id === 'hunters-mark')!;
const longbow = turnWeapon(elowen.weapons.find((w) => w.name === 'Longbow')!);
const dagger = turnWeapon(elowen.weapons.find((w) => w.name === 'Dagger')!);
const vexBlade = { key: 'vb', name: 'Shortsword', light: true, ranged: false, mastery: 'Vex' };

describe("1. Hunter's Mark: kast og ekstraskade blandes ikke", () => {
  it('ekstraskaden er ikke grå når siste slot er brukt mens HM er aktiv', () => {
    let g = game();
    // Bruk opp gratis-kast og alle slots.
    for (let i = 0; i < 10; i++) g = payCast(g, elowen, "Hunter's Mark").state;
    const resources = resourceContext(g, elowen);
    expect(resources.options['cast-hunters-mark']).toBe(0);
    expect(resources.damage['hunters-mark']).toBeUndefined();
    const s = run(fight(), { type: 'option', option: hmCast });
    expect(canDo(s, { kind: 'extraDamage', damage: hmDmg }, { resources })).toEqual({
      ok: true,
      reason: null,
    });
    expect(canDo(fight(), { kind: 'option', option: hmCast }, { resources }).reason).toBe(
      'Ingen gratis-kast eller spell slots igjen',
    );
  });
});

describe('2. Dodge virker ikke når den som tok Dodge er incapacitated eller har speed 0', () => {
  const dodging = () =>
    run(fight(), { type: 'endTurn' }, { type: 'obey', total: 15 }, { type: 'action', action: 'dodge' });
  it('vanlig Dodge gir disadvantage', () => {
    expect(attackRoll(dodging(), 'char', { target: BEAR }).disadvantage).toEqual(['målet bruker Dodge']);
  });
  it.each(['stunned', 'grappled', 'restrained'] as const)('%s tar bort Dodge', (condition) => {
    const s = run(dodging(), { type: 'condition', who: BEAR, condition, on: true });
    expect(attackRoll(s, 'char', { target: BEAR }).disadvantage).not.toContain('målet bruker Dodge');
  });
});

describe('3. Exhaustion', () => {
  it('−5 ft per nivå på speed og −2 per nivå på d20', () => {
    const s = run(fight(), { type: 'exhaustion', who: 'char', level: 2 });
    expect(movementLeft(s, 'char')).toBe(elowen.speed + 10 - 10);
    expect(attackRoll(s, 'char').d20Modifier).toBe(-4);
    expect(attackRoll(fight(), 'char').d20Modifier).toBe(0);
  });
  it('følger med fra spillet og tilbake', () => {
    const g = { ...game(), exhaustion: 1 };
    const s = fight(g);
    expect(ofKind(s, 'char').exhaustion).toBe(1);
    expect(conditionsToGame(g, run(s, { type: 'exhaustion', who: 'char', level: 3 })).exhaustion).toBe(3);
  });
});

describe("4. Hunter's Mark-skade bare mot det merkede målet", () => {
  const marked = () => run(fight(), { type: 'option', option: hmCast, target: 'e1' });
  it('riktig mål går, annet eller ukjent mål er grått', () => {
    expect(canDo(marked(), { kind: 'extraDamage', damage: hmDmg, target: 'e1' }).ok).toBe(true);
    expect(canDo(marked(), { kind: 'extraDamage', damage: hmDmg, target: 'e2' }).reason).toBe(
      "Hunter's Mark er på Ork, ikke på dette målet.",
    );
    expect(canDo(marked(), { kind: 'extraDamage', damage: hmDmg }).ok).toBe(false);
  });
  it('uten kjent mål på merket gjelder skaden alle', () => {
    const s = run(fight(), { type: 'option', option: hmCast });
    expect(canDo(s, { kind: 'extraDamage', damage: hmDmg, target: 'e2' }).ok).toBe(true);
  });
});

describe('5. canAttack og speed står på følgesvennen', () => {
  it('canAttack: false på følgesvennen gjør angrep grått', () => {
    const s = startCombat(
      addParticipant(
        createCombat(),
        companionParticipant({ id: 'u', name: 'Ulv', initiativeBonus: 0, canAttack: false }),
      ),
    );
    expect(canDo(s, { kind: 'action', action: 'attack' }).reason).toBe('Ulv kan ikke angripe');
  });
  it('mangler feltene: kan angripe, speed 30. Speed brukes når den finnes', () => {
    expect(companionParticipant({ id: 'x', name: 'X', initiativeBonus: 0 }).limits).toMatchObject({
      canAttack: true,
      speed: 30,
    });
    expect(companionParticipant({ id: 'y', name: 'Y', initiativeBonus: 0, speed: 60 }).limits.speed).toBe(60);
  });
});

describe('6. Krit', () => {
  it('damaged tar crit', () => {
    const s = run(fight(), { type: 'damaged', who: 'e1', amount: 3, crit: true });
    expect(s.log[0]?.text).toBe('Ork tok 3 skade (kritisk treff)');
  });
  it('treff innen 5 ft mot Paralyzed eller Unconscious er automatisk krit', () => {
    const s = run(fight(), { type: 'condition', who: 'e1', condition: 'unconscious', on: true });
    expect(attackRoll(s, 'char', { target: 'e1', weapon: dagger }).autoCrit).toContain('Unconscious');
    expect(attackRoll(s, 'char', { target: 'e1', weapon: longbow }).autoCrit).toBeNull();
    const p = run(fight(), { type: 'condition', who: 'e1', condition: 'paralyzed', on: true });
    expect(attackRoll(p, 'char', { target: 'e1', weapon: dagger }).autoCrit).toContain('Paralyzed');
  });
});

describe('7. Skjult mål, Grappled og å reise seg', () => {
  it('angrep mot et skjult mål har disadvantage', () => {
    const s = run(fight(), {
      type: 'effect',
      effect: { kind: 'hidden', source: 'e1', target: null, ends: null },
    });
    expect(attackRoll(s, 'char', { target: 'e1' }).disadvantage).toEqual(['målet er skjult']);
  });
  it('Grappled: disadvantage mot andre enn den som holder', () => {
    const s = run(fight(), { type: 'condition', who: 'char', condition: 'grappled', on: true, source: 'e1' });
    expect(attackRoll(s, 'char', { target: 'e1' }).disadvantage).toEqual([]);
    expect(attackRoll(s, 'char', { target: 'e2' }).disadvantage).toEqual(['du er Grappled']);
    const unknown = run(fight(), { type: 'condition', who: 'char', condition: 'grappled', on: true });
    expect(attackRoll(unknown, 'char', { target: 'e1' }).disadvantage).toEqual(['du er Grappled']);
    const free = run(s, { type: 'condition', who: 'char', condition: 'grappled', on: false });
    expect(free.effects.some((e) => e.kind === 'grapple')).toBe(false);
  });
  it('å reise seg fra Prone koster halve speeden', () => {
    expect(canDo(fight(), { kind: 'standUp' }).reason).toBe(REASONS.notProne);
    let s = run(fight(), { type: 'condition', who: 'char', condition: 'prone', on: true });
    s = run(s, { type: 'standUp' });
    expect(ofKind(s, 'char').conditions).toEqual([]);
    expect(ofKind(s, 'char').turn.moved).toBe(22); // 45 ft i første tur → 22
    const tired = run(
      fight(),
      { type: 'condition', who: 'char', condition: 'prone', on: true },
      { type: 'move', feet: 30 },
    );
    expect(canDo(tired, { kind: 'standUp' }).reason).toBe(REASONS.standUpCost(22));
  });
});

describe("8. Flytt Hunter's Mark krever at målet er nede", () => {
  it('grå mens orken har HP, lov når den er på 0', () => {
    let s = nextRoundAll(run(fight(), { type: 'option', option: hmCast, target: 'e1' }));
    expect(canDo(s, { kind: 'option', option: hmMove }).reason).toBe(
      "Ork har fortsatt HP. Du kan flytte Hunter's Mark når målet faller til 0 HP.",
    );
    s = run(s, { type: 'damaged', who: 'e1', amount: 10 });
    expect(canDo(s, { kind: 'option', option: hmMove }).ok).toBe(true);
    s = run(s, { type: 'option', option: hmMove, target: 'e2' });
    expect(concentratingOn(s, 'char')?.target).toBe('e2');
  });
});

describe('9. Fiende på 0 HP mister konsentrasjonen', () => {
  it('ingen sjekk i køen, konsentrasjonen er borte', () => {
    let s = run(fight(), { type: 'concentrate', who: 'e1', spell: 'Bless' });
    s = run(s, { type: 'damaged', who: 'e1', amount: 4 });
    expect(s.checks).toHaveLength(1);
    s = run(s, { type: 'damaged', who: 'e1', amount: 20 });
    expect(s.checks).toEqual([]);
    expect(concentratingOn(s, 'e1')).toBeNull();
  });
  it('også når den tas ut for hånd', () => {
    const s = run(
      fight(),
      { type: 'concentrate', who: 'e2', spell: 'Bless' },
      { type: 'defeated', who: 'e2', on: true },
    );
    expect(concentratingOn(s, 'e2')).toBeNull();
  });
});

describe('10. Help gjelder mot én fiende og forsvinner med hjelperen', () => {
  const helped = () =>
    run(
      fight(),
      { type: 'selectTurn', who: OWL_ID },
      { type: 'action', action: 'help', target: 'char', enemy: 'e1' },
    );
  it('bare mot fienden Help gjelder', () => {
    const s = helped();
    expect(attackRoll(s, 'char', { target: 'e1' }).advantage).toEqual(['Help fra Ugla']);
    expect(attackRoll(s, 'char', { target: 'e2' }).advantage).toEqual([]);
    // Et angrep mot en annen fiende bruker den ikke opp.
    const other = run(
      s,
      { type: 'selectTurn', who: 'char' },
      { type: 'attack', weapon: longbow, attack: 'main', target: 'e2' },
    );
    expect(attackRoll(other, 'char', { target: 'e1' }).advantage).toEqual(['Help fra Ugla']);
  });
  it('fjernes når hjelperen er ute', () => {
    const s = run(helped(), { type: 'defeated', who: OWL_ID, on: true });
    expect(s.effects.some((e) => e.kind === 'help')).toBe(false);
  });
});

describe('11. hit krever et angrep først', () => {
  it('uten angrep endres ingenting, og to hit gir bare én Vex', () => {
    const s = fight();
    expect(turReducer(s, { type: 'hit', weapon: vexBlade, target: 'e1' })).toBe(s);
    const once = run(
      s,
      { type: 'attack', weapon: vexBlade, attack: 'main' },
      { type: 'hit', weapon: vexBlade, target: 'e1' },
    );
    const twice = run(once, { type: 'hit', weapon: vexBlade, target: 'e1' });
    expect(twice).toBe(once);
    expect(once.effects.filter((e) => e.kind === 'vex')).toHaveLength(1);
    // Feil våpen teller ikke.
    expect(
      run(s, { type: 'attack', weapon: longbow, attack: 'main' }, { type: 'hit', weapon: vexBlade }).effects,
    ).toEqual([]);
  });
});

describe('12. castsLeft og resourceContext tåler JSON', () => {
  it('cantrips gir null (ubegrenset), ikke Infinity', () => {
    expect(castsLeft(game(), elowen, 'Druidcraft')).toBeNull();
    expect(castsLeft(game(), elowen, 'Finnes ikke')).toBe(0);
    const r = resourceContext(game(), elowen);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import {
  CHARACTER_ID,
  LOG_MAX,
  addEnemy,
  addLog,
  addParticipant,
  applyPetTraits,
  characterParticipant,
  combatFromGame,
  conditionsToGame,
  createCombat,
  deriveCharacter,
  endCombat,
  endTurn,
  initialGameState,
  initiativeOrder,
  nextRound,
  removeParticipant,
  roundComplete,
  selectTurn,
  setInitiative,
  shortName,
  startCombat,
  turReducer,
} from './index.ts';
import type { CombatState, GameState } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const wolf = { id: 'ulv', name: 'Ulv', initiativeBonus: 1, hpMax: 11 };
const BEAR = 'pet:25974574';
const SALOMON = 'pet:25974575';

function game(): GameState {
  return { ...initialGameState(elowen), companions: [wolf] };
}

describe('oppsett', () => {
  it('karakteren, kjæledyr med trekk og egne følgesvenner blir deltakere', () => {
    const g = game();
    const s = combatFromGame(elowen, g);
    expect(s.status).toBe('setup');
    const [char, bear, salomon, ulv] = s.participants;
    expect(char).toMatchObject({
      id: CHARACTER_ID,
      kind: 'character',
      name: 'Elowen',
      initiativeBonus: 6,
      ac: 14,
      hp: null,
    });
    expect(char?.limits).toMatchObject({
      attacksPerAction: 1,
      speed: 35,
      firstTurnSpeed: 10,
      canAttack: true,
    });
    const pet = elowen.pets[0]!;
    const ap = applyPetTraits(pet, g.pets[pet.id]?.traits);
    expect(bear).toMatchObject({ id: BEAR, kind: 'pet', name: 'Kvitebjørn', refId: pet.id });
    expect(bear?.initiativeBonus).toBe(ap.initiative);
    expect(bear?.limits.obeyDc).toBe(10);
    expect(bear?.turn.obey).toBe('pending');
    expect(salomon?.limits.obeyDc).toBeNull();
    expect(ulv).toMatchObject({ id: 'comp:ulv', kind: 'companion', initiativeBonus: 1 });
  });

  it('kjæledyr som ikke er med i kamp, og følgesvenner som er valgt bort, er ikke med', () => {
    const g = game();
    g.pets['25974574'] = { ...g.pets['25974574']!, inCombat: false };
    const s = combatFromGame(elowen, g, { excludeCompanions: ['ulv'] });
    expect(s.participants.map((p) => p.id)).toEqual([CHARACTER_ID, SALOMON]);
  });

  it('conditions på karakteren følger med inn og tilbake til spillet', () => {
    const g = { ...game(), conditions: ['poisoned', 'nope'] };
    let s = combatFromGame(elowen, g);
    expect(s.participants[0]?.conditions).toEqual(['poisoned']);
    s = turReducer(s, { type: 'condition', who: CHARACTER_ID, condition: 'prone', on: true });
    s = turReducer(s, { type: 'condition', who: CHARACTER_ID, condition: 'poisoned', on: false });
    expect(conditionsToGame(g, s).conditions).toEqual(['prone']);
    expect(conditionsToGame(g, createCombat())).toBe(g);
  });

  it('fiender og NPC-er legges inn for hånd, med eller uten HP', () => {
    let s = createCombat();
    const a = addEnemy(s, { name: 'Ork', initiative: 14, hpMax: 15, ac: 13 });
    s = a.state;
    const b = addEnemy(s, { name: '  ', kind: 'npc', initiativeBonus: 2 });
    s = b.state;
    expect([a.id, b.id]).toEqual(['e1', 'e2']);
    expect(s.participants[0]).toMatchObject({
      name: 'Ork',
      initiative: 14,
      hp: { max: 15, removed: 0 },
      ac: 13,
    });
    expect(s.participants[1]).toMatchObject({ name: 'Fiende 2', kind: 'npc', hp: null, initiative: null });
  });

  it('samme ID to ganger endrer ingenting', () => {
    const s = addParticipant(createCombat(), characterParticipant(elowen));
    expect(addParticipant(s, characterParticipant(elowen))).toBe(s);
  });

  it('shortName fjerner parentesen', () => {
    expect(shortName('Kvitebjørn (stupid)')).toBe('Kvitebjørn');
    expect(shortName('(x)')).toBe('(x)');
  });
});

describe('initiativ', () => {
  it('kast + bonus, eller totalen DM sier', () => {
    let s = combatFromGame(elowen, game());
    s = setInitiative(s, CHARACTER_ID, { roll: 12 });
    s = setInitiative(s, 'comp:ulv', { total: 9 });
    expect(s.participants[0]).toMatchObject({ roll: 12, initiative: 18 });
    expect(s.participants[3]).toMatchObject({ roll: null, initiative: 9 });
  });

  it('høyest først, likt avgjøres av bonus og så rekkefølgen, uten initiativ sist', () => {
    let s = createCombat();
    s = addEnemy(s, { name: 'A', initiative: 10, initiativeBonus: 0 }).state;
    s = addEnemy(s, { name: 'B', initiative: 10, initiativeBonus: 3 }).state;
    s = addEnemy(s, { name: 'C' }).state;
    s = addEnemy(s, { name: 'D', initiative: 15 }).state;
    s = addEnemy(s, { name: 'E', initiative: 10, initiativeBonus: 0 }).state;
    expect(initiativeOrder(s)).toEqual(['e4', 'e2', 'e1', 'e5', 'e3']);
  });
});

function three(): CombatState {
  let s = createCombat();
  s = addEnemy(s, { name: 'A', initiative: 20 }).state;
  s = addEnemy(s, { name: 'B', initiative: 15, hpMax: 10 }).state;
  s = addEnemy(s, { name: 'C', initiative: 10 }).state;
  return startCombat(s);
}

describe('runder og turer', () => {
  it('start: runde 1, høyest initiativ har tur', () => {
    const s = three();
    expect(s).toMatchObject({ status: 'active', round: 1, current: 'e1', done: [] });
    expect(s.log[0]?.text).toBe('Kampen starter – runde 1');
    expect(s.participants[0]?.turns).toBe(1);
  });

  it('ferdig → neste som ikke har spilt, og ny runde når alle har spilt', () => {
    let s = endTurn(three());
    expect(s.current).toBe('e2');
    expect(s.done).toEqual(['e1']);
    s = endTurn(endTurn(s));
    expect(s.current).toBeNull();
    expect(roundComplete(s)).toBe(true);
    s = nextRound(s);
    expect(s).toMatchObject({ round: 2, current: 'e1', done: [] });
    expect(s.log[0]?.text).toBe('— Runde 2 —');
    expect(s.participants[0]?.turns).toBe(2);
  });

  it('fanevalg utenom rekkefølgen, og så videre til den som ikke har spilt', () => {
    let s = selectTurn(three(), 'e3');
    expect(s.current).toBe('e3');
    s = endTurn(s);
    expect(s.current).toBe('e1');
    // Den som har spilt kan ikke velges igjen.
    expect(selectTurn(s, 'e3')).toBe(s);
  });

  it('å bytte fram og tilbake nullstiller ikke turen', () => {
    let s = turReducer(three(), { type: 'action', action: 'dash' });
    s = selectTurn(selectTurn(s, 'e2'), 'e1');
    expect(s.participants[0]?.turn.action).toBe('dash');
    expect(s.participants[0]?.turns).toBe(1);
  });

  it('endTurn for en som ikke har tur gir bare ✓', () => {
    const s = endTurn(three(), 'e3');
    expect(s.current).toBe('e1');
    expect(s.done).toEqual(['e3']);
    expect(endTurn(createCombat())).toEqual(createCombat());
  });

  it('fiender på 0 HP er ute og hoppes over', () => {
    let s = turReducer(three(), { type: 'damaged', who: 'e2', amount: 12 });
    expect(s.participants[1]).toMatchObject({ hp: { max: 10, removed: 10 }, defeated: true });
    expect(s.log[0]?.text).toBe('B er nede (0 HP)');
    s = endTurn(s);
    expect(s.current).toBe('e3');
    s = turReducer(s, { type: 'healed', who: 'e2', amount: 3 });
    expect(s.participants[1]).toMatchObject({ hp: { removed: 7 }, defeated: false });
    s = turReducer(s, { type: 'defeated', who: 'e3', on: true });
    expect(roundComplete(endTurn(s, 'e2'))).toBe(true);
  });

  it('å ta ut den som har tur, gir turen til neste', () => {
    let s = endTurn(three());
    s = turReducer(s, { type: 'effect', effect: { kind: 'custom', source: 'e2', target: 'e1', ends: null } });
    s = removeParticipant(s, 'e2');
    expect(s.current).toBe('e3');
    expect(s.effects).toEqual([]);
    expect(removeParticipant(s, 'zzz')).toBe(s);
  });

  it('avslutt kamp fjerner effekter og sjekker, men beholder loggen', () => {
    let s = turReducer(three(), { type: 'concentrate', spell: 'Bless' });
    s = turReducer(s, { type: 'damaged', who: 'e1', amount: 4 });
    expect(s.checks).toHaveLength(1);
    s = endCombat(s);
    expect(s).toMatchObject({ status: 'ended', current: null, effects: [], checks: [] });
    expect(s.log[0]?.text).toBe('Kampen er slutt');
    expect(nextRound(s)).toBe(s);
  });
});

describe('effekter som går ut', () => {
  it('Dodge varer til starten av din neste tur, Disengage til slutten av denne', () => {
    let s = turReducer(three(), { type: 'action', action: 'dodge' });
    expect(s.effects.map((e) => e.kind)).toEqual(['dodge']);
    s = selectTurn(s, 'e2');
    s = turReducer(s, { type: 'action', action: 'disengage' });
    expect(s.effects.map((e) => e.kind)).toEqual(['dodge', 'disengage']);
    s = endTurn(s); // e2 ferdig: Disengage går ut
    expect(s.effects.map((e) => e.kind)).toEqual(['dodge']);
    s = nextRound(endTurn(endTurn(s)));
    expect(s.current).toBe('e1');
    expect(s.effects).toEqual([]);
  });

  it('Vex varer til slutten av din neste tur', () => {
    const blade = { key: 'b', name: 'Shortsword', light: true, ranged: false, mastery: 'Vex' };
    let s = turReducer(three(), { type: 'attack', weapon: blade, attack: 'main' });
    s = turReducer(s, { type: 'hit', weapon: blade, target: 'e3' });
    s = nextRound(endTurn(endTurn(endTurn(s))));
    expect(s.effects.map((e) => e.kind)).toEqual(['vex']);
    s = endTurn(s);
    expect(s.effects).toEqual([]);
  });
});

describe('logg og serialisering', () => {
  it('nyeste først, høyst LOG_MAX', () => {
    let s = createCombat();
    for (let i = 0; i < LOG_MAX + 5; i++) s = addLog(s, `l${i}`);
    expect(s.log).toHaveLength(LOG_MAX);
    expect(s.log[0]?.text).toBe(`l${LOG_MAX + 4}`);
    expect(turReducer(s, { type: 'log', text: 'hei', who: null }).log[0]).toMatchObject({
      text: 'hei',
      who: null,
    });
  });

  it('tilstanden tåler JSON fram og tilbake', () => {
    let s = startCombat(setInitiative(combatFromGame(elowen, game()), CHARACTER_ID, { total: 20 }));
    s = turReducer(s, { type: 'darkness', on: true });
    s = turReducer(s, { type: 'action', action: 'hide', total: 18 });
    const copy = JSON.parse(JSON.stringify(s)) as CombatState;
    expect(copy).toEqual(s);
    expect(turReducer(copy, { type: 'endTurn' })).toEqual(turReducer(s, { type: 'endTurn' }));
  });

  it('endrer aldri den gamle tilstanden', () => {
    const s = three();
    const before = JSON.stringify(s);
    turReducer(s, { type: 'action', action: 'dash' });
    turReducer(s, { type: 'damaged', who: 'e2', amount: 3 });
    endTurn(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('mørke av og på', () => {
    const s = turReducer(three(), { type: 'darkness', on: true });
    expect(s.darkness).toBe(true);
    expect(turReducer(s, { type: 'darkness', on: true })).toBe(s);
  });
});

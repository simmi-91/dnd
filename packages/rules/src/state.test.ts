import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import {
  applyDamage,
  applyHealing,
  applyPetTraits,
  concentrationDc,
  currentHp,
  damageCompanion,
  damagePet,
  deriveCharacter,
  healCompanion,
  healPet,
  hitDiceLeft,
  initialGameState,
  longRest,
  petHpMax,
  restoreResource,
  restoreSlot,
  setTempHp,
  hitDiceHealing,
  shortRest,
  slotMax,
  spendResource,
  spendSlot,
} from './index.ts';
import type { GameState, Sheet } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const lego = deriveCharacter(legoRaw);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Tilstand uten noe brukt. */
function blank(sheet: Sheet = elowen): GameState {
  const g = initialGameState(sheet);
  return {
    ...g,
    hpRemoved: 0,
    tempHp: 0,
    resources: {},
    slotsUsed: {},
    hitDiceUsed: {},
    pets: Object.fromEntries(Object.entries(g.pets).map(([id, p]) => [id, { ...p, hpRemoved: 0 }])),
  };
}

/** Sjekker at funksjonen ikke endrer tilstanden den får. */
function frozen(state: GameState): GameState {
  const deep = (v: unknown): void => {
    if (v && typeof v === 'object') {
      Object.freeze(v);
      for (const c of Object.values(v)) deep(c);
    }
  };
  deep(state);
  return state;
}

/** Ark med Warlock og multiclass, laget for hånd. */
const multi: Sheet = {
  ...clone(elowen),
  hpMax: 30,
  mod: { ...elowen.mod, con: -1 },
  hitDice: [
    { die: 8, total: 3, used: 0 },
    { die: 10, total: 2, used: 0 },
  ],
  slots: { 1: 4, 2: 2 },
  pactSlots: { level: 1, count: 1 },
  resources: [
    { key: 'second-wind', name: 'Second Wind', max: 2, used: 0, reset: 'short' },
    { key: 'lucky', name: 'Lucky', max: 3, used: 0, reset: 'long' },
    { key: 'wand', name: 'Wand', max: 7, used: 0, reset: 'other' },
  ],
};

describe('applyDamage', () => {
  it('tar temp HP først', () => {
    const s = frozen({ ...blank(), tempHp: 5 });
    const r = applyDamage(s, elowen, 8);
    expect(r.state.tempHp).toBe(0);
    expect(r.state.hpRemoved).toBe(3);
    expect(r.absorbed).toBe(5);
    expect(r.hpLost).toBe(3);
    expect(s.tempHp).toBe(5);
  });

  it('temp HP som er større enn skaden, tar alt', () => {
    const r = applyDamage({ ...blank(), tempHp: 10 }, elowen, 4);
    expect(r.state.tempHp).toBe(6);
    expect(r.state.hpRemoved).toBe(0);
    expect(r.hpLost).toBe(0);
  });

  it('går ikke under 0 HP', () => {
    const r = applyDamage({ ...blank(), hpRemoved: 35 }, elowen, 20);
    expect(r.state.hpRemoved).toBe(40);
    expect(r.hpLost).toBe(5);
    expect(r.atZero).toBe(true);
    expect(r.instantDeath).toBe(false);
    expect(currentHp(r.state, elowen)).toBe(0);
  });

  it('gir død med en gang når skaden etter 0 HP er minst maks HP', () => {
    expect(applyDamage({ ...blank(), hpRemoved: 30 }, elowen, 50).instantDeath).toBe(true);
    expect(applyDamage({ ...blank(), hpRemoved: 30 }, elowen, 49).instantDeath).toBe(false);
  });

  it('regner ut DC for konsentrasjon: maks av 10 og halve skaden, høyst 30', () => {
    expect(applyDamage(blank(), elowen, 7).concentrationDc).toBe(10);
    expect(applyDamage(blank(), elowen, 21).concentrationDc).toBe(10);
    expect(applyDamage(blank(), elowen, 22).concentrationDc).toBe(11);
    expect(applyDamage(blank(), elowen, 23).concentrationDc).toBe(11);
    expect(concentrationDc(100)).toBe(30);
  });

  it('negative og ugyldige tall gir ingen skade', () => {
    const s = { ...blank(), hpRemoved: 5 };
    expect(applyDamage(s, elowen, -4).state.hpRemoved).toBe(5);
    expect(applyDamage(s, elowen, Number.NaN).state.hpRemoved).toBe(5);
    expect(applyDamage(s, elowen, 2.9).state.hpRemoved).toBe(7);
  });
});

describe('applyHealing og setTempHp', () => {
  it('helbreder opp til maks', () => {
    const s = frozen({ ...blank(), hpRemoved: 10 });
    expect(applyHealing(s, elowen, 4).hpRemoved).toBe(6);
    expect(applyHealing(s, elowen, 40).hpRemoved).toBe(0);
    expect(s.hpRemoved).toBe(10);
  });

  it('nullstiller death saves når karakteren får HP fra 0', () => {
    const down = { ...blank(), hpRemoved: 40, deathSaves: { successes: 1, failures: 2 } };
    expect(applyHealing(down, elowen, 1).deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(applyHealing(down, elowen, 0).deathSaves).toEqual({ successes: 1, failures: 2 });
  });

  it('temp HP stables ikke, den høyeste gjelder', () => {
    const s = frozen({ ...blank(), tempHp: 5 });
    expect(setTempHp(s, 3).tempHp).toBe(5);
    expect(setTempHp(s, 8).tempHp).toBe(8);
    expect(setTempHp(s, 0, { replace: true }).tempHp).toBe(0);
  });
});

describe('kjæledyr og følgesvenner', () => {
  const kvite = elowen.pets[0]!;

  it('skade og helbreding per kjæledyr, innenfor maks HP med trekk', () => {
    const s = frozen(blank());
    const max = applyPetTraits(kvite, s.pets[kvite.id]?.traits).hpMax;
    expect(petHpMax(s, elowen, kvite.id)).toBe(max);
    const hurt = damagePet(s, elowen, kvite.id, 10);
    expect(hurt.pets[kvite.id]?.hpRemoved).toBe(10);
    expect(damagePet(hurt, elowen, kvite.id, 999).pets[kvite.id]?.hpRemoved).toBe(max);
    expect(healPet(hurt, elowen, kvite.id, 4).pets[kvite.id]?.hpRemoved).toBe(6);
    expect(healPet(hurt, elowen, kvite.id, 99).pets[kvite.id]?.hpRemoved).toBe(0);
    // Det andre kjæledyret endres ikke.
    const other = elowen.pets[1]!.id;
    expect(hurt.pets[other]).toEqual(s.pets[other]);
    expect(s.pets[kvite.id]?.hpRemoved).toBe(0);
  });

  it('ukjente kjæledyr endrer ingenting', () => {
    const s = blank();
    expect(damagePet(s, elowen, 'finnes-ikke', 5)).toBe(s);
    expect(petHpMax(s, elowen, 'finnes-ikke')).toBeNull();
  });

  it('skade og helbreding på egne følgesvenner', () => {
    const s = frozen({
      ...blank(),
      companions: [
        { id: 'ugle', name: 'Ugle', initiativeBonus: 3, hpMax: 1 },
        { id: 'uten', name: 'Uten HP', initiativeBonus: 0 },
      ],
    });
    const hurt = damageCompanion(s, 'ugle', 5);
    expect(hurt.companions[0]?.hpRemoved).toBe(1);
    expect(healCompanion(hurt, 'ugle', 1).companions[0]?.hpRemoved).toBe(0);
    expect(damageCompanion(s, 'uten', 5)).toBe(s);
    expect(damageCompanion(s, 'borte', 5)).toBe(s);
    expect(s.companions[0]?.hpRemoved).toBeUndefined();
  });
});

describe('ressurser og slots', () => {
  it('bruker og fyller opp ressurser innenfor 0 og maks', () => {
    const s = frozen(blank());
    const used = spendResource(s, elowen, 'hunters-mark');
    expect(used.resources).toEqual({ 'hunters-mark': 1 });
    expect(spendResource(used, elowen, 'hunters-mark', 5).resources['hunters-mark']).toBe(2);
    expect(restoreResource(used, elowen, 'hunters-mark').resources).toEqual({});
    expect(restoreResource(s, elowen, 'hunters-mark', 3).resources).toEqual({});
    expect(spendResource(s, elowen, 'ukjent')).toBe(s);
    expect(s.resources).toEqual({});
  });

  it('bruker og fyller opp slots per nivå', () => {
    const s = frozen(blank(lego));
    const a = spendSlot(s, lego, 2);
    expect(a.slotsUsed).toEqual({ 2: 1 });
    expect(spendSlot(a, lego, 2, 5).slotsUsed).toEqual({ 2: 2 });
    expect(restoreSlot(a, lego, 2).slotsUsed).toEqual({});
    // Nivå uten slots endrer ingenting.
    expect(spendSlot(s, lego, 3)).toBe(s);
    expect(slotMax(lego, 1)).toBe(4);
  });

  it('Pact-slots holdes for seg', () => {
    const s = blank(multi);
    const a = spendSlot(spendSlot(s, multi, 'pact', 3), multi, 1);
    expect(a.slotsUsed).toEqual({ pact: 1, 1: 1 });
    expect(restoreSlot(a, multi, 'pact').slotsUsed).toEqual({ 1: 1 });
    expect(spendSlot(s, elowen, 'pact')).toBe(s);
  });
});

describe('shortRest', () => {
  it('legger CON-mod til per terning og bruker Hit Dice', () => {
    const s = frozen({ ...blank(), hpRemoved: 30 });
    const r = shortRest(s, elowen, { hitDiceSpent: { d10: 2 }, healed: 11 });
    // 11 + 2 × CON-mod 3 = 17.
    expect(r.hpRemoved).toBe(13);
    expect(r.hitDiceUsed).toEqual({ d10: 2 });
    expect(hitDiceLeft(r, elowen)).toEqual({ d10: 2 });
    expect(s.hitDiceUsed).toEqual({});
  });

  it('bruker ikke flere terninger enn det er igjen, og ukjente terninger ignoreres', () => {
    const s = { ...blank(), hpRemoved: 30, hitDiceUsed: { d10: 3 } };
    const r = shortRest(s, elowen, { hitDiceSpent: { d10: 4, d12: 1 }, healed: 6 });
    expect(r.hitDiceUsed).toEqual({ d10: 4 });
    expect(r.hpRemoved).toBe(30 - (6 + 3));
  });

  it('hver terning gir minst 1 HP med negativ CON-mod', () => {
    const s = { ...blank(multi), hpRemoved: 20 };
    const r = shortRest(s, multi, { hitDiceSpent: { d8: 2 }, healed: 2 });
    expect(r.hpRemoved).toBe(18);
  });

  it('med slag per terning gjelder minst 1 HP for hver terning', () => {
    const s = { ...blank(multi), hpRemoved: 25 };
    // CON-mod −1: slag 1 gir 1 (ikke 0), slag 8 gir 7. Summen ville gitt 7.
    const r = shortRest(s, multi, { rolls: { d8: [1, 8] } });
    expect(r.hpRemoved).toBe(25 - 8);
    expect(r.hitDiceUsed).toEqual({ d8: 2 });
    expect(hitDiceHealing(s, multi, { hitDiceSpent: { d8: 2 }, healed: 9 }).heal).toBe(7);
  });

  it('slag per terning: ikke flere enn det er igjen, og slag holdes innenfor terningen', () => {
    const s = { ...blank(multi), hpRemoved: 29, hitDiceUsed: { d10: 1 } };
    const r = hitDiceHealing(s, multi, { rolls: { d10: [99, 5], d12: [6] } });
    expect(r.spent).toEqual({ d10: 1 });
    expect(r.heal).toBe(10 - 1);
  });

  it('slag og sum kan blandes, og slag vinner for samme terning', () => {
    const s = { ...blank(elowen), hpRemoved: 39 };
    const r = hitDiceHealing(s, elowen, { rolls: { d10: [4] }, hitDiceSpent: { d10: 3 }, healed: 20 });
    expect(r).toEqual({ heal: 4 + 3, spent: { d10: 1 } });
    const m = { ...blank(multi), hpRemoved: 29 };
    expect(hitDiceHealing(m, multi, { rolls: { d10: [6] }, hitDiceSpent: { d8: 2 }, healed: 5 })).toEqual({
      heal: 5 + 3,
      spent: { d10: 1, d8: 2 },
    });
  });

  it('uten terninger helbredes ingenting', () => {
    const s = { ...blank(), hpRemoved: 10 };
    expect(shortRest(s, elowen, { hitDiceSpent: {}, healed: 9 }).hpRemoved).toBe(10);
  });

  it('fyller opp ressurser med reset short og Pact-slots, men ikke resten', () => {
    const s = {
      ...blank(multi),
      resources: { 'second-wind': 2, lucky: 1, wand: 3 },
      slotsUsed: { 1: 2, pact: 1 },
    };
    const r = shortRest(s, multi, { hitDiceSpent: {}, healed: 0 });
    expect(r.resources).toEqual({ lucky: 1, wand: 3 });
    expect(r.slotsUsed).toEqual({ 1: 2 });
  });
});

describe('longRest', () => {
  const played = (): GameState => ({
    ...blank(multi),
    hpRemoved: 25,
    tempHp: 4,
    resources: { 'second-wind': 2, lucky: 3, wand: 5 },
    slotsUsed: { 1: 4, 2: 1, pact: 1 },
    hitDiceUsed: { d8: 3, d10: 2 },
    exhaustion: 2,
    conditions: ['Poisoned'],
    deathSaves: { successes: 2, failures: 1 },
    companions: [
      { id: 'ugle', name: 'Ugle', initiativeBonus: 3, hpMax: 1, hpRemoved: 1 },
      { id: 'uten', name: 'Uten HP', initiativeBonus: 0 },
    ],
  });

  it('fyller opp HP, ressurser og slots, og nullstiller temp HP og death saves', () => {
    const s = frozen(played());
    const r = longRest(s, multi);
    expect(r.hpRemoved).toBe(0);
    expect(r.tempHp).toBe(0);
    expect(r.resources).toEqual({});
    expect(r.slotsUsed).toEqual({});
    expect(r.exhaustion).toBe(1);
    expect(r.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(r.conditions).toEqual(['Poisoned']);
    expect(s.hpRemoved).toBe(25);
  });

  it('gir tilbake alle brukte Hit Dice (2024)', () => {
    expect(longRest(played(), multi).hitDiceUsed).toEqual({});
    expect(longRest(initialGameState(lego), lego).hitDiceUsed).toEqual({});
  });

  it('exhaustion går ikke under 0', () => {
    expect(longRest(blank(), elowen).exhaustion).toBe(0);
  });

  it('gir kjæledyr og følgesvenner full HP', () => {
    const s = initialGameState(elowen);
    expect(Object.values(s.pets).some((p) => p.hpRemoved > 0)).toBe(true);
    const r = longRest(s, elowen);
    expect(Object.values(r.pets).every((p) => p.hpRemoved === 0)).toBe(true);
    const c = longRest(played(), multi).companions;
    expect(c[0]?.hpRemoved).toBe(0);
    expect(c[1]).toEqual({ id: 'uten', name: 'Uten HP', initiativeBonus: 0 });
  });
});

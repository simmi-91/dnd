import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import { deriveCharacter, initialGameState, mergeOnRefresh, newFeatures } from './index.ts';
import type { GameState, Sheet } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const lego = deriveCharacter(legoRaw);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const petId = (s: Sheet, prefix: string) => s.pets.find((p) => p.name.startsWith(prefix))?.id ?? '';

describe('initialGameState', () => {
  it('tar HP og brukte ressurser fra D&D Beyond', () => {
    const g = initialGameState(elowen);
    expect(g.hpRemoved).toBe(9);
    expect(g.resources).toEqual({ 'hunters-mark': 1 });
    expect(g.conditions).toEqual([]);
    expect(g.companions).toEqual([]);
    const l = initialGameState(lego);
    expect(l.slotsUsed).toEqual({ 2: 1 });
    expect(l.hitDiceUsed).toEqual({ d10: 5 });
    expect(l.resources).toEqual({ 'hunters-mark': 1, 'spell-find-familiar': 1 });
  });

  it('kjæledyr får trekk fra notatet og HP fra D&D Beyond', () => {
    let n = 0;
    const g = initialGameState(elowen, () => `id${++n}`);
    const kvite = g.pets[petId(elowen, 'Kvitebjørn')];
    expect(kvite?.traits.map((t) => t.kind)).toEqual(['ability', 'ability', 'obey']);
    expect(kvite?.hpRemoved).toBe(8);
    expect(kvite?.inCombat).toBe(true);
    expect(g.pets[petId(elowen, 'Salomon')]?.traits).toEqual([{ id: 'id4', kind: 'maxCrit' }]);
  });
});

describe('mergeOnRefresh', () => {
  const kviteId = petId(elowen, 'Kvitebjørn');
  const salomonId = petId(elowen, 'Salomon');
  const played = (): GameState => {
    const g = initialGameState(elowen);
    return {
      ...g,
      hpRemoved: 20,
      tempHp: 4,
      resources: { 'hunters-mark': 2, 'dreadful-strike': 3, 'gammel-ressurs': 1 },
      slotsUsed: { 1: 2 },
      exhaustion: 1,
      conditions: ['Poisoned'],
      companions: [{ id: 'c1', name: 'Ugle', initiativeBonus: 3 }],
      pets: {
        ...g.pets,
        [kviteId]: { traits: [{ id: 'egen', kind: 'hp', delta: 5 }], hpRemoved: 30, inCombat: false },
      },
    };
  };

  it('uten «hent også HP» beholdes appens tall og trekk', () => {
    const m = mergeOnRefresh(played(), elowen, { alsoHpAndResources: false });
    expect(m.hpRemoved).toBe(20);
    expect(m.tempHp).toBe(4);
    // Ukjente nøkler fjernes, og alt holdes innenfor maks.
    expect(m.resources).toEqual({ 'hunters-mark': 2, 'dreadful-strike': 3 });
    expect(m.slotsUsed).toEqual({ 1: 2 });
    expect(m.exhaustion).toBe(1);
    expect(m.conditions).toEqual(['Poisoned']);
    expect(m.companions).toEqual([{ id: 'c1', name: 'Ugle', initiativeBonus: 3 }]);
    expect(m.pets[kviteId]).toEqual({
      traits: [{ id: 'egen', kind: 'hp', delta: 5 }],
      hpRemoved: 30,
      inCombat: false,
    });
  });

  it('med «hent også HP» kommer HP og ressurser fra D&D Beyond, men trekkene beholdes', () => {
    const m = mergeOnRefresh(played(), elowen, { alsoHpAndResources: true });
    expect(m.hpRemoved).toBe(9);
    expect(m.tempHp).toBe(0);
    expect(m.resources).toEqual({ 'hunters-mark': 1 });
    expect(m.slotsUsed).toEqual({});
    expect(m.pets[kviteId]).toEqual({
      traits: [{ id: 'egen', kind: 'hp', delta: 5 }],
      hpRemoved: 8,
      inCombat: false,
    });
    expect(m.conditions).toEqual(['Poisoned']);
  });

  it('nye kjæledyr får trekk fra notatet, og borte kjæledyr beholdes til de kommer tilbake', () => {
    const prev = played();
    const salomonBefore = prev.pets[salomonId];
    const newPet = { ...elowen.pets[0]!, id: 'ny', name: 'Ny bjørn', notes: '+2 con' };
    const sheet: Sheet = { ...elowen, pets: [elowen.pets.find((p) => p.id === kviteId)!, newPet] };
    const m = mergeOnRefresh(prev, sheet, { alsoHpAndResources: true, makeId: () => 'seed' });
    expect(Object.keys(m.pets).sort()).toEqual([kviteId, salomonId, 'ny'].sort());
    expect(m.pets[salomonId]).toEqual(salomonBefore);
    expect(m.pets.ny?.traits).toEqual([{ id: 'seed', kind: 'ability', stat: 'con', delta: 2 }]);
    expect(m.pets[kviteId]?.traits[0]?.id).toBe('egen');

    // Salomon kommer tilbake: trekkene er der fortsatt og seedes ikke på nytt.
    const back = mergeOnRefresh(m, elowen, { alsoHpAndResources: false, makeId: () => 'seed' });
    expect(back.pets[salomonId]?.traits).toEqual(salomonBefore?.traits);
  });

  it('endrer ikke den gamle tilstanden', () => {
    const prev = played();
    const copy = clone(prev);
    mergeOnRefresh(prev, elowen, { alsoHpAndResources: true });
    expect(prev).toEqual(copy);
  });

  it('HP tatt kan ikke bli større enn maks HP', () => {
    const m = mergeOnRefresh({ ...played(), hpRemoved: 99 }, elowen, { alsoHpAndResources: false });
    expect(m.hpRemoved).toBe(40);
  });
});

describe('newFeatures', () => {
  it('gir evnene som kom med nivået', () => {
    const lvl5 = clone(elowenRaw);
    const c = lvl5.data.classes[0];
    if (!c) throw new Error('mangler klasse');
    c.level = 5;
    const next = deriveCharacter(lvl5);
    expect(newFeatures(elowen, next).map((f) => f.name)).toEqual(['Extra Attack']);
    expect(next.attacksPerAction).toBe(2);
    expect(next.slots).toEqual({ 1: 4, 2: 2 });
  });

  it('ingenting nytt uten gammelt ark eller uten endring', () => {
    expect(newFeatures(null, elowen)).toEqual([]);
    expect(newFeatures(elowen, elowen)).toEqual([]);
  });
});

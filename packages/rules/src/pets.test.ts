import { describe, expect, it } from 'vitest';
import { applyPetTraits, companionInitiativeBonus, seedPetTraits } from './index.ts';
import type { Pet, PetTrait } from './index.ts';

const bear: Pet = {
  id: 'p1',
  name: 'Bjørn',
  kind: 'Polar Bear',
  typeId: 2,
  ac: 12,
  hpMax: 42,
  hitDice: 5,
  hpRemoved: 0,
  tempHp: 0,
  initiativeBonus: 2,
  stats: { str: 20, dex: 14, con: 16, int: 2, wis: 13, cha: 7 },
  speeds: [{ id: 1, speed: 40 }],
  skills: [],
  senses: [],
  attacks: [
    { name: 'Rend', melee: true, hit: 7, reach: '5 ft', count: 1, sides: 8, mod: 5, dmgType: 'slashing' },
    {
      name: 'Rock',
      melee: false,
      hit: 4,
      reach: '30 ft',
      count: 1,
      sides: 6,
      mod: 2,
      dmgType: 'bludgeoning',
    },
  ],
  multiattack: { count: 2, attack: 'Rend' },
  actionsText: '',
  traitsText: '',
  notes: '',
};

describe('seedPetTraits', () => {
  it('lager ID-er med makeId, ikke tilfeldig', () => {
    let n = 0;
    const traits = seedPetTraits('+2 STR, -1 dex. Use Animal Handling', () => `x${++n}`);
    expect(traits).toEqual([
      { id: 'x1', kind: 'ability', stat: 'str', delta: 2 },
      { id: 'x2', kind: 'ability', stat: 'dex', delta: -1 },
      { id: 'x3', kind: 'obey', dc: 10 },
    ]);
  });

  it('standard-ID-ene er en teller og gir samme svar hver gang', () => {
    expect(seedPetTraits('+1 str +1 con').map((t) => t.id)).toEqual(['t1', 't2']);
    expect(seedPetTraits('+1 str +1 con')).toEqual(seedPetTraits('+1 str +1 con'));
  });

  it('tomt eller ukjent notat gir ingen trekk', () => {
    expect(seedPetTraits(null)).toEqual([]);
    expect(seedPetTraits('Snill bjørn')).toEqual([]);
  });
});

describe('applyPetTraits', () => {
  it('+2 STR gir +1 på treff og skade for nærkamp, ikke for avstand', () => {
    const a = applyPetTraits(bear, [{ id: 'a', kind: 'ability', stat: 'str', delta: 2 }]);
    expect(a.attacks[0]).toMatchObject({ name: 'Rend', hit: 8, mod: 6 });
    expect(a.attacks[1]).toMatchObject({ name: 'Rock', hit: 4, mod: 2 });
    expect(a.mod.str).toBe(6);
  });

  it('+1 STR (20 → 21) endrer ikke moden', () => {
    const a = applyPetTraits(bear, [{ id: 'a', kind: 'ability', stat: 'str', delta: 1 }]);
    expect(a.attacks[0]).toMatchObject({ hit: 7, mod: 5 });
  });

  it('DEX endrer avstandsangrep og initiativ, men ikke AC', () => {
    const a = applyPetTraits(bear, [{ id: 'a', kind: 'ability', stat: 'dex', delta: 2 }]);
    expect(a.attacks[1]).toMatchObject({ hit: 5, mod: 3 });
    expect(a.initiative).toBe(3);
    expect(a.ac).toBe(12);
  });

  it('CON endrer HP med endringen × hit dice, og faste trekk legges rett til', () => {
    const traits: PetTrait[] = [
      { id: '1', kind: 'ability', stat: 'con', delta: 2 },
      { id: '2', kind: 'attack', delta: 1 },
      { id: '3', kind: 'damage', delta: 2 },
      { id: '4', kind: 'ac', delta: 1 },
      { id: '5', kind: 'hp', delta: 3 },
      { id: '6', kind: 'speed', delta: 10 },
      { id: '7', kind: 'maxCrit' },
      { id: '8', kind: 'obey', dc: 12 },
      { id: '9', kind: 'note', text: 'bare tekst' },
    ];
    const a = applyPetTraits(bear, traits);
    expect(a.hpMax).toBe(42 + 5 + 3);
    expect(a.ac).toBe(13);
    expect(a.speeds).toEqual([{ id: 1, speed: 50 }]);
    expect(a.attacks[0]).toMatchObject({ hit: 8, mod: 7 });
    expect(a.flags).toEqual({ maxCrit: true, obey: 12 });
  });

  it('endrer ikke kjæledyret som sendes inn', () => {
    applyPetTraits(bear, [{ id: 'a', kind: 'ability', stat: 'str', delta: 4 }]);
    expect(bear.stats.str).toBe(20);
    expect(bear.attacks[0]?.hit).toBe(7);
  });
});

describe('companionInitiativeBonus', () => {
  it('bruker bonusen som er lagt inn, og 0 for ugyldige verdier', () => {
    expect(companionInitiativeBonus({ initiativeBonus: 3 })).toBe(3);
    expect(companionInitiativeBonus({ initiativeBonus: -1 })).toBe(-1);
    expect(companionInitiativeBonus({ initiativeBonus: Number.NaN })).toBe(0);
  });
});

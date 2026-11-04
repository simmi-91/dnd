import { describe, expect, it } from 'vitest';
import type { DdbClass, DdbItem, DdbModifier } from './ddb/types.ts';
import {
  DDB_FORMAT_MESSAGE,
  DdbFormatError,
  casterLevel,
  deriveCharacter,
  pactSlots,
  spellSlots,
} from './index.ts';

// Tabell for half casters i 2024 (Ranger/Paladin), indeksert på klassenivå.
const HALF = [[], [2], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2]];
const FULL = [[], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3]];

function cls(
  name: string,
  level: number,
  extra: Partial<DdbClass['definition']> = {},
  start = false,
): DdbClass {
  return { level, isStartingClass: start, definition: { name, hitDice: 8, classFeatures: [], ...extra } };
}

const wizard = (level: number, start = false) =>
  cls(
    'Wizard',
    level,
    {
      hitDice: 6,
      canCastSpells: true,
      spellCastingAbilityId: 4,
      spellRules: { levelSpellSlots: FULL, multiClassSpellSlotDivisor: 1, multiClassSpellSlotRounding: 1 },
    },
    start,
  );
const ranger = (level: number, start = false) =>
  cls(
    'Ranger',
    level,
    {
      hitDice: 10,
      canCastSpells: true,
      spellCastingAbilityId: 5,
      spellRules: { levelSpellSlots: HALF, multiClassSpellSlotDivisor: 2, multiClassSpellSlotRounding: 2 },
    },
    start,
  );

let nextItem = 1;
function item(def: Partial<DdbItem['definition']> & { name: string }, extra: Partial<DdbItem> = {}): DdbItem {
  const id = nextItem++;
  return { id, equipped: true, isAttuned: false, ...extra, definition: { id: 900 + id, ...def } };
}

const longbow = (mods: DdbModifier[] = [], extra: Partial<DdbItem> = {}, canAttune = false) =>
  item(
    {
      name: 'Longbow +1',
      type: 'Longbow',
      filterType: 'Weapon',
      categoryId: 2,
      attackType: 2,
      damage: { diceCount: 1, diceValue: 8 },
      damageType: 'Piercing',
      range: 150,
      longRange: 600,
      canAttune,
      grantedModifiers: mods,
    },
    extra,
  );

function char(over: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      name: 'Test',
      stats: [10, 14, 12, 10, 12, 10].map((value, i) => ({ id: i + 1, value })),
      baseHitPoints: 10,
      classes: [ranger(1, true)],
      modifiers: {
        class: [
          { type: 'proficiency', subType: 'martial-weapons' },
          { type: 'proficiency', subType: 'dexterity-saving-throws' },
        ],
      },
      inventory: [],
      ...over,
    },
  };
}

describe('DdbFormatError', () => {
  it.each([
    ['null', null],
    ['tekst', 'hei'],
    ['success false', { success: false, data: null }],
    ['uten stats', { data: { classes: [ranger(1)] } }],
    ['uten classes', { data: { stats: [1, 2, 3, 4, 5, 6].map((id) => ({ id, value: 10 })) } }],
    ['tom classes', char({ classes: [] })],
    ['klasse uten definition', char({ classes: [{ level: 1 }] })],
    ['modifiers som liste', char({ modifiers: [] })],
  ])('%s', (_n, raw) => {
    expect(() => deriveCharacter(raw)).toThrow(DdbFormatError);
    expect(() => deriveCharacter(raw)).toThrow(DDB_FORMAT_MESSAGE);
  });

  it('godtar både { success, data } og data direkte', () => {
    expect(deriveCharacter(char()).level).toBe(1);
    expect(deriveCharacter(char().data).level).toBe(1);
  });
});

describe('spell slots og multiclass', () => {
  it('Wizard 3 / Ranger 2 → caster-nivå 4 → 4/3', () => {
    const s = deriveCharacter(char({ classes: [wizard(3, true), ranger(2)] }));
    expect(s.slots).toEqual({ 1: 4, 2: 3 });
    expect(s.summary).toBe('Wizard 3 / Ranger 2');
    expect(s.level).toBe(5);
    expect(s.pb).toBe(3);
    expect(s.hitDice).toEqual([
      { die: 10, total: 2, used: 0 },
      { die: 6, total: 3, used: 0 },
    ]);
  });

  it('half caster rundes opp: Wizard 1 / Ranger 3 → 1 + 2 = 3 → 4/2', () => {
    expect(deriveCharacter(char({ classes: [wizard(1, true), ranger(3)] })).slots).toEqual({ 1: 4, 2: 2 });
  });

  it('third caster rundes ned: Wizard 2 + Eldritch Knight 5 → 2 + 1 = 3', () => {
    expect(
      casterLevel([
        { level: 2, divisor: 1, roundUp: false },
        { level: 5, divisor: 3, roundUp: false },
      ]),
    ).toBe(3);
  });

  it('én caster-klasse bruker klassens egen tabell, også med ikke-caster ved siden av', () => {
    const s = deriveCharacter(char({ classes: [ranger(3, true), cls('Rogue', 2)] }));
    expect(s.slots).toEqual({ 1: 3 });
    expect(s.summary).toBe('Ranger 3 / Rogue 2');
    expect(s.classLevel).toBe(3);
  });

  it('Warlock Pact Magic regnes for seg selv', () => {
    const warlock = cls('Warlock', 3, { canCastSpells: true, spellCastingAbilityId: 6 });
    const s = deriveCharacter(char({ classes: [wizard(2, true), warlock] }));
    expect(s.slots).toEqual({ 1: 3 });
    expect(s.pactSlots).toEqual({ level: 2, count: 2 });
    expect(pactSlots(11)).toEqual({ level: 5, count: 3 });
    expect(spellSlots([])).toEqual({});
  });

  it('evner per klasse etter klassens eget nivå, og upcoming per klasse', () => {
    const f = (id: number, name: string, requiredLevel: number) => ({ id, name, requiredLevel });
    const s = deriveCharacter(
      char({
        classes: [
          {
            ...ranger(2, true),
            definition: {
              ...ranger(2).definition,
              classFeatures: [f(1, 'Favored Enemy', 1), f(2, 'Extra Attack', 5)],
            },
          },
          cls('Rogue', 3, {
            classFeatures: [f(3, 'Sneak Attack', 1), f(4, 'Cunning Action', 2), f(5, 'Uncanny Dodge', 5)],
          }),
        ],
      }),
    );
    expect(s.features.map((x) => `${x.cls}:${x.name}`)).toEqual([
      'Ranger:Favored Enemy',
      'Rogue:Sneak Attack',
      'Rogue:Cunning Action',
    ]);
    expect(s.upcoming.map((x) => `${x.cls}:${x.name}`)).toEqual([
      'Ranger:Extra Attack',
      'Rogue:Uncanny Dodge',
    ]);
    expect(s.attacksPerAction).toBe(1);
  });
});

describe('magiske gjenstander', () => {
  const magic = (value: number, requiresAttunement = false): DdbModifier => ({
    type: 'bonus',
    subType: 'magic',
    value,
    requiresAttunement,
  });

  it('magic-bonus på våpen gir treff og skade, og telles én gang', () => {
    const s = deriveCharacter(
      char({
        inventory: [longbow([magic(1)])],
        // modifiers.item gjentar den samme bonusen. Den skal ikke telles en gang til.
        modifiers: { ...char().data.modifiers, item: [magic(1)] },
      }),
    );
    // DEX 14 → +2, PB +2, magic +1
    expect(s.weapons[0]).toMatchObject({ hit: 5, mod: 3, magic: 1 });
  });

  it('krever gjenstanden attunement, teller den bare når den er attunet', () => {
    const notAttuned = deriveCharacter(char({ inventory: [longbow([magic(2, true)], {}, true)] }));
    expect(notAttuned.weapons[0]).toMatchObject({ hit: 4, mod: 2, magic: 0 });
    const attuned = deriveCharacter(
      char({ inventory: [longbow([magic(2, true)], { isAttuned: true }, true)] }),
    );
    expect(attuned.weapons[0]).toMatchObject({ hit: 6, mod: 4, magic: 2 });
  });

  it('gjenstander som ikke er utrustet, teller ikke', () => {
    const manual = item(
      {
        name: 'Manual',
        filterType: 'Wondrous item',
        grantedModifiers: [{ type: 'bonus', subType: 'dexterity-score', value: 2 }],
      },
      { equipped: false },
    );
    expect(deriveCharacter(char({ inventory: [manual] })).scores.dex).toBe(14);
    expect(deriveCharacter(char({ inventory: [{ ...manual, equipped: true }] })).scores.dex).toBe(16);
  });

  it('rustning, skjold og andre AC-bonuser', () => {
    const chain = item({
      name: 'Chain Shirt +1',
      filterType: 'Armor',
      armorTypeId: 2,
      armorClass: 13,
      grantedModifiers: [magic(1)],
    });
    const shield = item({
      name: 'Shield +1',
      filterType: 'Armor',
      armorTypeId: 4,
      armorClass: 2,
      grantedModifiers: [magic(1)],
    });
    const ring = item(
      {
        name: 'Ring of Protection',
        filterType: 'Ring',
        canAttune: true,
        grantedModifiers: [
          { type: 'bonus', subType: 'armor-class', value: 1, requiresAttunement: true },
          { type: 'bonus', subType: 'saving-throws', value: 1, requiresAttunement: true },
        ],
      },
      { isAttuned: true },
    );
    const s = deriveCharacter(char({ inventory: [chain, shield, ring] }));
    // Medium: 13 + min(2, DEX 2) + 1, skjold 2 + 1, ring +1
    expect(s.ac).toBe(20);
    expect(s.shield).toBe(true);
    expect(s.saves.dex.bonus).toBe(2 + 2 + 1);
    expect(s.saves.str.bonus).toBe(0 + 1);

    const unattuned = deriveCharacter(char({ inventory: [chain, shield, { ...ring, isAttuned: false }] }));
    expect(unattuned.ac).toBe(19);
    expect(unattuned.saves.str.bonus).toBe(0);
  });

  it('uten rustning: 10 + DEX, og heavy får ikke DEX', () => {
    expect(deriveCharacter(char()).ac).toBe(12);
    const plate = item({ name: 'Plate', filterType: 'Armor', armorTypeId: 3, armorClass: 18 });
    expect(deriveCharacter(char({ inventory: [plate] })).ac).toBe(18);
  });

  it('to like gjenstander gir ikke dobbel bonus', () => {
    const cloak = () =>
      item({
        name: 'Cloak',
        filterType: 'Wondrous item',
        grantedModifiers: [{ type: 'bonus', subType: 'armor-class', value: 1 }],
      });
    const a = cloak();
    const b = { ...cloak(), definition: a.definition };
    expect(deriveCharacter(char({ inventory: [a, b] })).ac).toBe(13);
  });
});

describe('initiativ og andre regler', () => {
  it('bonus/initiative med statId uten verdi bruker evnens mod, med verdi brukes verdien', () => {
    const s = deriveCharacter(
      char({
        modifiers: {
          class: [
            { type: 'bonus', subType: 'initiative', value: null, statId: 5 },
            { type: 'bonus', subType: 'initiative', value: 2 },
          ],
        },
      }),
    );
    expect(s.initiative).toBe(2 + 1 + 2);
  });

  it('uten statId og verdi gir bonusen 0 (ingen reserve på evnenavn)', () => {
    expect(
      deriveCharacter(char({ modifiers: { class: [{ type: 'bonus', subType: 'initiative' }] } })).initiative,
    ).toBe(2);
  });

  it('set/extra-attacks gir antall angrep', () => {
    expect(
      deriveCharacter(char({ modifiers: { class: [{ type: 'set', subType: 'extra-attacks', value: 2 }] } }))
        .attacksPerAction,
    ).toBe(3);
  });

  it('resetType: 1 short, 2 long, ellers other, og dubletter får egen nøkkel', () => {
    const lu = (resetType: unknown) => ({ maxUses: 1, numberUsed: 0, resetType });
    const s = deriveCharacter(
      char({
        actions: {
          class: [
            { name: 'Second Wind', limitedUse: lu(1) },
            { name: 'Second Wind', limitedUse: lu(2) },
            { name: 'Wild Shape', limitedUse: { ...lu(4), maxUses: 0, useProficiencyBonus: true } },
            { name: 'Uten bruk', limitedUse: { ...lu(2), maxUses: 0 } },
          ],
        },
      }),
    );
    expect(s.resources).toEqual([
      { key: 'second-wind', name: 'Second Wind', max: 1, used: 0, reset: 'short' },
      { key: 'second-wind-2', name: 'Second Wind', max: 1, used: 0, reset: 'long' },
      { key: 'wild-shape', name: 'Wild Shape', max: 2, used: 0, reset: 'other' },
    ]);
  });
});

describe('funn fra valideringen', () => {
  const spell = (name: string, componentId: number) => ({
    componentId,
    definition: { name, level: 3 },
    limitedUse: { maxUses: 1, numberUsed: 0, resetType: 2 },
  });

  it('spells fra gjenstander tas bare med når gjenstanden virker', () => {
    const potion = item(
      { name: 'Potion of Speed', filterType: 'Potion', canEquip: false, isConsumable: true },
      { equipped: false },
    );
    const staff = item({ name: 'Staff', filterType: 'Staff', canAttune: true });
    const names = (inventory: DdbItem[]) =>
      deriveCharacter(
        char({
          inventory,
          spells: {
            item: [spell('Haste', potion.definition.id), spell('Fireball', staff.definition.id)],
          },
        }),
      );
    const notAttuned = names([potion, staff]);
    expect(notAttuned.spells.map((s) => s.name)).toEqual([]);
    expect(notAttuned.resources).toEqual([]);
    const attuned = names([potion, { ...staff, isAttuned: true }]);
    expect(attuned.spells.map((s) => s.name)).toEqual(['Fireball']);
    expect(attuned.resources.map((r) => r.key)).toEqual(['spell-fireball']);
  });

  it('gjenstander med canEquip false virker uten å være utrustet, med attunement der det kreves', () => {
    const stone = (canAttune: boolean, isAttuned: boolean) =>
      item(
        {
          name: 'Ioun Stone',
          filterType: 'Wondrous item',
          canEquip: false,
          canAttune,
          grantedModifiers: [{ type: 'bonus', subType: 'armor-class', value: 1 }],
        },
        { equipped: false, isAttuned },
      );
    expect(deriveCharacter(char({ inventory: [stone(false, false)] })).ac).toBe(13);
    expect(deriveCharacter(char({ inventory: [stone(true, false)] })).ac).toBe(12);
    expect(deriveCharacter(char({ inventory: [stone(true, true)] })).ac).toBe(13);
  });

  it('limitedUse: operator og proficiencyBonusOperator (1 = legg til, 2 = gang)', () => {
    const max = (limitedUse: Record<string, unknown>) =>
      deriveCharacter(
        char({ actions: { class: [{ name: 'X', limitedUse: { numberUsed: 0, ...limitedUse } }] } }),
      ).resources[0]?.max;
    // WIS 12 → +1, PB +2
    expect(max({ maxUses: 0, statModifierUsesId: 5, operator: 1 })).toBe(1);
    expect(max({ maxUses: 2, statModifierUsesId: 5, operator: 1 })).toBe(3);
    expect(max({ maxUses: 3, statModifierUsesId: 5, operator: 2 })).toBe(3);
    expect(max({ maxUses: 0, useProficiencyBonus: true, proficiencyBonusOperator: 1 })).toBe(2);
    expect(max({ maxUses: 3, useProficiencyBonus: true, proficiencyBonusOperator: 2 })).toBe(6);
  });

  it('initiativ får bonuser og halv proficiency på ability checks', () => {
    const s = deriveCharacter(
      char({
        modifiers: {
          class: [
            { type: 'half-proficiency', subType: 'ability-checks' },
            { type: 'bonus', subType: 'ability-checks', value: 1 },
          ],
        },
      }),
    );
    // DEX +2, halv PB 1, bonus 1
    expect(s.initiative).toBe(4);
  });
});

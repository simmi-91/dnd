// Tester mot anonymiserte, ekte D&D Beyond-svar i fixtures/.
import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import { applyPetTraits, deriveCharacter, seedPetTraits } from './index.ts';
import type { Sheet } from './index.ts';

const bonuses = (s: Sheet) => Object.fromEntries(Object.entries(s.saves).map(([k, v]) => [k, v.bonus]));
const skill = (s: Sheet, key: string) => s.skills.find((k) => k.key === key)?.bonus;
const weapon = (s: Sheet, name: string) => s.weapons.find((w) => w.name === name);

describe('Elowen, Gloom Stalker Ranger 4 (fasit fra D&D Beyond-arket)', () => {
  const s = deriveCharacter(elowenRaw);

  it('spells har tekst uten HTML, med avsnitt, som kampskjermen viser under «Hva gjør den?»', () => {
    const druidcraft = s.spells.find((x) => x.name === 'Druidcraft');
    expect(druidcraft?.desc).toMatch(/^Whispering to the spirits of nature/);
    expect(druidcraft?.desc).not.toMatch(/<|>/);
    // Hele teksten, med avsnitt (før ble den kuttet midt i «Fire Play»).
    expect(druidcraft?.desc).toMatch(/\nFire Play\. You/);
    expect(druidcraft?.desc).toMatch(/\.$/);
  });

  it('evneverdier, nivå og PB', () => {
    expect(s.scores).toEqual({ str: 10, dex: 16, con: 17, int: 12, wis: 16, cha: 8 });
    expect(s.level).toBe(4);
    expect(s.pb).toBe(2);
    expect(s.summary).toBe('Gloom Stalker Ranger 4');
    expect(s.classes).toEqual([{ name: 'Ranger', subclass: 'Gloom Stalker', level: 4, hitDie: 10 }]);
    expect(s.lineage).toBe('Wood Elf');
  });

  it('HP, AC, speed, initiativ og darkvision', () => {
    expect(s.hpMax).toBe(40);
    expect(s.hpRemoved).toBe(9);
    expect(s.ac).toBe(14);
    expect(s.armor).toBe('Leather Armor of Gleaming');
    expect(s.speed).toBe(35);
    // Dread Ambusher gir bonus/initiative med statId = WIS og uten verdi: 3 + 3.
    expect(s.initiative).toBe(6);
    expect(s.darkvision).toBe(120);
    expect(s.hitDice).toEqual([{ die: 10, total: 4, used: 0 }]);
  });

  it('saves og skills', () => {
    expect(bonuses(s)).toEqual({ str: 2, dex: 5, con: 3, int: 1, wis: 3, cha: -1 });
    expect(skill(s, 'acrobatics')).toBe(3);
    expect(skill(s, 'animal-handling')).toBe(5);
    expect(skill(s, 'arcana')).toBe(3);
    expect(skill(s, 'perception')).toBe(7);
    expect(s.passive.perception).toBe(17);
  });

  it('våpen og mastery', () => {
    expect(weapon(s, 'Longbow')).toMatchObject({
      hit: 7,
      count: 1,
      sides: 8,
      mod: 3,
      mastery: 'Slow',
      ranged: true,
    });
    expect(weapon(s, 'Scimitar')).toMatchObject({ hit: 5, sides: 6, mod: 3, mastery: 'Nick', light: true });
    expect(weapon(s, 'Dagger #2')).toBeDefined();
  });

  it('magi, ressurser og evner', () => {
    expect(s.slots).toEqual({ 1: 3 });
    expect(s.nextSlots).toEqual({ 1: 4, 2: 2 });
    expect(s.castAb).toBe('wis');
    expect(s.spellDc).toBe(13);
    expect(s.hm).toMatchObject({ max: 2, used: 1, die: 6, known: true, key: 'hunters-mark' });
    expect(s.ds).toMatchObject({ max: 3, used: 0, dice: 6, key: 'dreadful-strike' });
    expect(s.umbralSight).toBe(true);
    expect(s.ambusherLeap).toBe(true);
    expect(s.sharpshooter).toBe(true);
    expect(s.familiar).toBe(true);
    expect(s.xp).toBe(300);
    expect(s.attacksPerAction).toBe(1);
    expect(s.upcoming.map((f) => f.name)).toContain('Extra Attack');
    expect(s.features.find((f) => f.name === 'Dread Ambusher')?.sub).toBe(true);
  });

  it('ressurser fra limitedUse med stabile nøkler og resetType', () => {
    expect(s.resources.find((r) => r.key === 'dreadful-strike')).toEqual({
      key: 'dreadful-strike',
      name: 'Dreadful Strike',
      max: 3,
      used: 0,
      reset: 'long',
    });
    expect(s.resources.map((r) => r.key)).toEqual([
      'hunters-mark',
      'dreadful-strike',
      'spell-longstrider',
      'spell-find-familiar',
    ]);
  });

  it('arket har ikke D&D Beyond-ID eller avatar', () => {
    expect(s).not.toHaveProperty('id');
    expect(s).not.toHaveProperty('avatar');
    expect(JSON.stringify(s)).not.toContain('avatarUrl');
  });

  it('to isbjørner med multiattack', () => {
    expect(s.pets).toHaveLength(2);
    for (const p of s.pets) {
      expect(p.kind).toBe('Polar Bear');
      expect(p.multiattack).toEqual({ count: 2, attack: 'Rend' });
      expect(p.attacks).toEqual([
        { name: 'Rend', melee: true, hit: 7, reach: '5 ft', count: 1, sides: 8, mod: 5, dmgType: 'slashing' },
      ]);
      expect(p.ac).toBe(12);
      expect(p.hpMax).toBe(42);
    }
  });

  it('notatene seeder trekkene og trekkene regnes inn', () => {
    const kvite = s.pets.find((p) => p.name.startsWith('Kvitebjørn'));
    const salomon = s.pets.find((p) => p.name.startsWith('Salomon'));
    if (!kvite || !salomon) throw new Error('mangler bjørn');
    const kt = seedPetTraits(kvite.notes);
    expect(kt).toEqual([
      { id: 't1', kind: 'ability', stat: 'wis', delta: -1 },
      { id: 't2', kind: 'ability', stat: 'str', delta: 1 },
      { id: 't3', kind: 'obey', dc: 10 },
    ]);
    expect(seedPetTraits(salomon.notes).map((t) => t.kind)).toEqual(['maxCrit']);

    // STR 20 → 21 endrer ikke moden (+5), så Rend er fortsatt +7 og 1d8+5.
    const applied = applyPetTraits(kvite, kt);
    expect(applied.stats.str).toBe(21);
    expect(applied.stats.wis).toBe(12);
    expect(applied.attacks[0]).toMatchObject({ hit: 7, mod: 5 });
    expect(applied.flags).toEqual({ maxCrit: false, obey: 10 });
  });
});

describe('Lego-rangeren, Hunter Ranger 5', () => {
  const s = deriveCharacter(legoRaw);

  it('verdier som følger direkte av reglene', () => {
    expect(s.level).toBe(5);
    expect(s.pb).toBe(3);
    expect(s.subclass).toBe('Hunter');
    expect(s.summary).toBe('Hunter Ranger 5');
    expect(s.attacksPerAction).toBe(2);
    expect(s.slots).toEqual({ 1: 4, 2: 2 });
    expect(s.pets).toEqual([]);
    expect(s.xp).toBe(900);
    // Haste kommer fra Potion of Speed, som er en forbruksgjenstand.
    expect(s.spells.map((x) => x.name)).not.toContain('Haste');
    expect(s.hm.max).toBe(3);
    expect(s.ds).toBeNull();
    expect(s.slotsUsed).toEqual({ 2: 1 });
    expect(s.hitDice).toEqual([{ die: 10, total: 5, used: 5 }]);
  });

  // Fasit fra D&D Beyond-arket.
  it('evneverdier, HP, AC og initiativ', () => {
    // 2014-rase (Wood Elf) med 2024-bakgrunn (Sage): rasens +2 DEX og +1 WIS telles ikke.
    // DEX 16 + 2 (ASI). Manual of Quickness of Action er ikke utrustet og teller ikke.
    expect(s.scores).toEqual({ str: 9, dex: 18, con: 12, int: 10, wis: 16, cha: 11 });
    expect(s.hpMax).toBe(39); // 34 + 5 × 1
    expect(s.ac).toBe(18); // Studded Leather 12 + DEX 4 + Shield 2
    expect(s.initiative).toBe(4);
    expect(s.speed).toBe(35);
    expect(s.darkvision).toBe(60);
  });

  // Fasit fra D&D Beyond-arket.
  it('våpen, skills og saves', () => {
    expect(weapon(s, 'Longbow')).toMatchObject({ hit: 9, count: 1, sides: 8, mod: 4, mastery: 'Slow' });
    expect(weapon(s, 'Shortsword')).toMatchObject({ hit: 7, sides: 6, mod: 4, mastery: 'Vex' });
    // Scimitar of Speed krever attunement og er ikke attunet: ingen +2.
    expect(weapon(s, 'Scimitar of Speed')).toMatchObject({ hit: 7, sides: 6, mod: 4, magic: 0 });
    expect(Object.fromEntries(s.skills.map((k) => [k.name, k.bonus]))).toEqual({
      Acrobatics: 4,
      'Animal Handling': 6,
      Arcana: 3,
      Athletics: -1,
      Deception: 0,
      History: 3,
      Insight: 6,
      Intimidation: 0,
      Investigation: 0,
      Medicine: 3,
      Nature: 0,
      Perception: 9,
      Performance: 0,
      Persuasion: 0,
      Religion: 0,
      'Sleight of Hand': 4,
      Stealth: 4,
      Survival: 6,
    });
    expect(s.passive).toEqual({ perception: 19, investigation: 10, insight: 16 });
    expect(bonuses(s)).toEqual({ str: 2, dex: 7, con: 1, int: 0, wis: 3, cha: 0 });
  });

  it('rasens økninger telles når rasen ikke er legacy eller bakgrunnen ikke gir økninger', () => {
    const notLegacy = JSON.parse(JSON.stringify(legoRaw)) as typeof legoRaw;
    notLegacy.data.race.isLegacy = false;
    expect(deriveCharacter(notLegacy).scores).toMatchObject({ dex: 20, wis: 17 });

    // Uten bakgrunnens ASI-feat (ingen grantedFeats og ingen __INITIAL_ASI) telles rasen.
    const noBgAsi = JSON.parse(JSON.stringify(legoRaw)) as typeof legoRaw;
    noBgAsi.data.background.definition.grantedFeats = [];
    for (const f of noBgAsi.data.feats) f.definition.categories = [];
    expect(deriveCharacter(noBgAsi).scores).toMatchObject({ dex: 20, wis: 17 });
  });
});

// Katalogene: actions, conditions og evneregisteret.
import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import {
  ACTIONS,
  ACTION_IDS,
  CONDITIONS,
  CONDITION_DEFS,
  MASTERY_TEXT,
  RULES,
  actionDef,
  activeRules,
  conditionWith,
  deriveCharacter,
  exhaustionPenalty,
  expandConditions,
  extraDamageOptions,
  firstTurnSpeed,
  darknessAdvantage,
  masteryOf,
  ruleFlags,
  turnOptions,
} from './index.ts';
import type { Feature, Sheet } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const lego = deriveCharacter(legoRaw);

const feature = (name: string): Feature => ({ name, level: 1, cls: 'Ranger', sub: false, desc: '' });
const withFeatures = (s: Sheet, ...names: string[]): Sheet => ({
  ...s,
  features: [...s.features, ...names.map(feature)],
});

describe('actionkatalogen (2024)', () => {
  it('har alle tolv actions i rekkefølge, med forklaring, kostnad og mal', () => {
    expect(ACTIONS.map((a) => a.name)).toEqual([
      'Attack',
      'Dash',
      'Disengage',
      'Dodge',
      'Help',
      'Hide',
      'Influence',
      'Magic',
      'Ready',
      'Search',
      'Study',
      'Utilize',
    ]);
    expect(ACTIONS.map((a) => a.id)).toEqual([...ACTION_IDS]);
    for (const a of ACTIONS) {
      expect(a.cost).toBe('action');
      expect(a.text.length).toBeGreaterThan(20);
    }
  });

  it('Hide nevner DC 15', () => {
    expect(actionDef('hide').text).toContain('DC 15');
    expect(() => actionDef('nope' as never)).toThrow();
  });
});

describe('conditions (2024)', () => {
  it('har alle 15 med norsk forklaring', () => {
    expect(CONDITIONS).toHaveLength(15);
    for (const c of CONDITIONS) {
      expect(CONDITION_DEFS[c].id).toBe(c);
      expect(CONDITION_DEFS[c].text.length).toBeGreaterThan(20);
    }
  });

  it('Unconscious tar med Incapacitated og Prone, og ukjente ignoreres', () => {
    expect(expandConditions(['unconscious', 'nope'])).toEqual(['incapacitated', 'prone', 'unconscious']);
    expect(expandConditions(['stunned'])).toEqual(['incapacitated', 'stunned']);
  });

  it('effekter som kamplogikken leser', () => {
    expect(conditionWith(['poisoned'], 'attackDisadvantage')).toBe('poisoned');
    expect(conditionWith(['grappled'], 'speedZero')).toBe('grappled');
    expect(conditionWith(['charmed', 'deafened'], 'incapacitated')).toBeNull();
    expect(conditionWith(['paralyzed'], 'critWithin5')).toBe('paralyzed');
    expect(CONDITION_DEFS.prone.effects).toMatchObject({
      attackedAdvantage: 'within5',
      attackedDisadvantage: 'beyond5',
    });
    expect(CONDITION_DEFS.invisible.effects).toMatchObject({
      attackAdvantage: true,
      attackedDisadvantage: 'always',
    });
  });

  it('exhaustion: −2 per nivå på d20, −5 ft per nivå, død på 6', () => {
    expect(exhaustionPenalty(0)).toEqual({ d20: 0, speed: 0, dead: false });
    expect(exhaustionPenalty(2)).toEqual({ d20: -4, speed: -10, dead: false });
    expect(exhaustionPenalty(6).dead).toBe(true);
    expect(exhaustionPenalty(Number.NaN).d20).toBe(0);
  });
});

describe('evneregisteret', () => {
  it('dekker evnene prototypen kjenner, alle masteries og Sharpshooter', () => {
    const names = RULES.flatMap((r) => r.names);
    for (const n of [
      'Extra Attack',
      'Dread Ambusher',
      'Umbral Sight',
      "Stalker's Flurry",
      'Foe Slayer',
      'Roving',
      'Sharpshooter',
      "Hunter's Mark",
      ...Object.keys(MASTERY_TEXT),
    ])
      expect(names).toContain(n);
    for (const r of RULES) expect(r.text.length).toBeGreaterThan(10);
    expect(new Set(RULES.map((r) => r.key)).size).toBe(RULES.length);
  });

  it("Elowen: Gloom Stalker med Sharpshooter, Hunter's Mark, Nick og Slow", () => {
    const keys = activeRules(elowen).map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'opportunity-attack',
        'light',
        'dread-ambusher',
        'umbral-sight',
        'hunters-mark',
        'sharpshooter',
        'mastery-nick',
        'mastery-slow',
      ]),
    );
    expect(keys).not.toContain('extra-attack');
    expect(keys).not.toContain('mastery-vex');
    expect(ruleFlags(elowen)).toContain('no-ranged-melee-disadvantage');
    expect(firstTurnSpeed(elowen)).toBe(10);
    expect(darknessAdvantage(elowen)).toBe('mørke (Umbral Sight)');
  });

  it('Lego: Extra Attack og Vex, men ikke Gloom Stalker eller Sharpshooter', () => {
    const keys = activeRules(lego).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['extra-attack', 'mastery-vex', 'mastery-slow']));
    expect(keys).not.toContain('dread-ambusher');
    expect(ruleFlags(lego)).toEqual([]);
    expect(firstTurnSpeed(lego)).toBe(0);
    expect(darknessAdvantage(lego)).toBeNull();
  });

  it("ekstra skade stemmer med arket, og Stalker's Flurry og Foe Slayer gjør terningen større", () => {
    const ex = extraDamageOptions(elowen);
    const hm = ex.find((e) => e.id === 'hunters-mark');
    const ds = ex.find((e) => e.id === 'dreadful-strike');
    expect(hm).toMatchObject({ count: 1, sides: elowen.hm.die, dmgType: 'force', oncePerTurn: false });
    expect(ds).toMatchObject({ count: 2, sides: elowen.ds?.dice, dmgType: 'psychic', oncePerTurn: true });
    const high = extraDamageOptions(withFeatures(elowen, "Stalker's Flurry", 'Foe Slayer'));
    expect(high.find((e) => e.id === 'dreadful-strike')?.sides).toBe(8);
    expect(high.find((e) => e.id === 'hunters-mark')?.sides).toBe(10);
    expect(extraDamageOptions(lego).map((e) => e.id)).toEqual(['hunters-mark']);
  });

  it('Roving gir climb og swim, og speeden er alt i arket', () => {
    expect(ruleFlags(withFeatures(lego, 'Roving'))).toContain('climb-swim');
    expect(RULES.find((r) => r.key === 'roving')?.effects).toContainEqual({ kind: 'speedInSheet', feet: 10 });
  });

  it('masteryOf leser masteryen som data', () => {
    expect(masteryOf('Nick')).toBe('nick');
    expect(masteryOf('Graze')).toBe('graze');
    expect(masteryOf(null)).toBeNull();
    expect(masteryOf('Ukjent')).toBeNull();
  });

  it('bonus actions og reactions fra arket', () => {
    const o = turnOptions(elowen);
    expect(o.actions).toBe(ACTIONS);
    expect(o.bonus.map((b) => b.id)).toEqual([
      'light-attack',
      'cast-hunters-mark',
      'move-hunters-mark',
      'familiar-senses',
    ]);
    expect(o.reactions.map((b) => b.id)).toEqual(['opportunity-attack']);
    expect(o.part.map((b) => b.id)).toEqual(['nick-attack']);
    // Lego har to Light-våpen, men ingen Nick.
    const l = turnOptions(lego);
    expect(l.bonus.map((b) => b.id)).toContain('light-attack');
    expect(l.part).toEqual([]);
    // Uten to Light-våpen er det ikke noe Light-ekstraangrep.
    const one = turnOptions({ ...lego, weapons: lego.weapons.filter((w) => !w.light) });
    expect(one.bonus.map((b) => b.id)).not.toContain('light-attack');
  });

  it('spells med bonus action eller reaction uten egen regel blir enkle valg', () => {
    const s: Sheet = {
      ...lego,
      spells: [
        ...lego.spells,
        {
          name: 'Misty Step',
          level: 2,
          source: 'class',
          free: 0,
          resourceKey: null,
          concentration: false,
          ritual: false,
          time: 3,
        },
        {
          name: 'Shield',
          level: 1,
          source: 'class',
          free: 0,
          resourceKey: null,
          concentration: false,
          ritual: false,
          time: 4,
        },
      ],
    };
    const o = turnOptions(s);
    expect(o.bonus.find((b) => b.id === 'spell:misty-step')).toMatchObject({
      cost: 'bonus',
      spell: 'Misty Step',
    });
    expect(o.reactions.find((b) => b.id === 'spell:shield')).toMatchObject({ cost: 'reaction' });
    // Hunter's Mark har egen regel og kommer bare én gang.
    expect(o.bonus.filter((b) => b.spell === "Hunter's Mark")).toHaveLength(1);
  });
});

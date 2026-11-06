import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import {
  applyDamage,
  applyHealing,
  damageTotal,
  deathStatus,
  deriveCharacter,
  initialGameState,
  masteryNote,
  rollDeathSave,
  rollMode,
  validateRoll,
  damageGroups,
} from './index.ts';
import type { GameState } from './index.ts';

const elowen = deriveCharacter(elowenRaw);

describe('rollMode', () => {
  it('advantage og disadvantage opphever hverandre', () => {
    expect(rollMode(['a'], [])).toBe('advantage');
    expect(rollMode([], ['d'])).toBe('disadvantage');
    expect(rollMode(['a', 'b'], ['d'])).toBe('normal');
    expect(rollMode([], [])).toBe('normal');
  });
});

describe('validateRoll', () => {
  it('en d20 må være 1–20, en 2d6 2–12', () => {
    expect(validateRoll(1, 1, 20)).toBeNull();
    expect(validateRoll(20, 1, 20)).toBeNull();
    expect(validateRoll(21, 1, 20)).toBe('En d20 må være 1–20.');
    expect(validateRoll(0, 1, 20)).toBe('En d20 må være 1–20.');
    expect(validateRoll(2.5, 1, 20)).not.toBeNull();
    expect(validateRoll(1, 2, 6)).toBe('En 2d6 må være 2–12.');
    expect(validateRoll(12, 2, 6)).toBeNull();
  });
});

describe('skade', () => {
  it('summerer per gruppe og per type, ingen del under 0', () => {
    const bow = elowen.weapons.find((w) => w.name === 'Longbow')!;
    const groups = damageGroups({
      weapon: bow,
      attack: 'main',
      crit: false,
      extras: [
        {
          id: 'hm',
          rule: 'hm',
          label: 'HM',
          count: 1,
          sides: 6,
          dmgType: 'force',
          oncePerTurn: false,
          tone: 'gold',
        },
      ],
    });
    const r = damageTotal(groups, { weapon: 5, hm: 4 });
    expect(r.total).toBe(12);
    expect(r.byType).toEqual({ piercing: 8, force: 4 });
    const neg = damageTotal([{ ...groups[0]!, mod: -3 }], { weapon: 1 });
    expect(neg.total).toBe(0);
  });
});

describe('masteryNote', () => {
  const bow = { mastery: 'Slow', mod: 3, abMod: 3, dmgType: 'piercing' };
  it('viser effekten ved treff, med tallene i', () => {
    expect(masteryNote(bow, 'hit', 2)).toBe('Slow: Målet får −10 ft speed til starten av din neste tur.');
    expect(masteryNote(bow, 'miss', 2)).toBeNull();
    expect(masteryNote({ ...bow, mastery: 'Topple' }, 'hit', 2)).toBe(
      'Topple: målet må klare en CON save mot DC 13, ellers blir det Prone.',
    );
    expect(masteryNote({ ...bow, mastery: 'Nick' }, 'hit', 2)).toBeNull();
    expect(masteryNote({ ...bow, mastery: null }, 'hit', 2)).toBeNull();
  });

  it('Graze gir skade lik evne-moden ved bom', () => {
    const g = { mastery: 'Graze', mod: 4, abMod: 3, dmgType: 'slashing' };
    expect(masteryNote(g, 'miss', 3)).toBe('Graze: bom, men målet tar likevel 3 slashing.');
    expect(masteryNote(g, 'hit', 3)).toBeNull();
    expect(masteryNote({ ...g, abMod: 0 }, 'miss', 3)).toBeNull();
  });
});

describe('death saves ved 0 HP', () => {
  const down = (ds = { successes: 0, failures: 0 }): GameState => ({
    ...initialGameState(elowen),
    hpRemoved: elowen.hpMax,
    tempHp: 0,
    deathSaves: ds,
  });

  it('status: oppe, dying, stable og død', () => {
    expect(deathStatus(initialGameState(elowen), elowen)).toBe('up');
    expect(deathStatus(down(), elowen)).toBe('dying');
    expect(deathStatus(down({ successes: 3, failures: 0 }), elowen)).toBe('stable');
    expect(deathStatus(down({ successes: 0, failures: 3 }), elowen)).toBe('dead');
  });

  it('10 eller mer er suksess, under 10 feil, naturlig 1 gir to feil', () => {
    expect(rollDeathSave(down(), elowen, 10)).toMatchObject({
      result: 'success',
      state: { deathSaves: { successes: 1, failures: 0 } },
    });
    expect(rollDeathSave(down(), elowen, 9).state.deathSaves).toEqual({ successes: 0, failures: 1 });
    expect(rollDeathSave(down(), elowen, 1).state.deathSaves).toEqual({ successes: 0, failures: 2 });
  });

  it('3 suksesser: Stable. 3 feil: død', () => {
    expect(rollDeathSave(down({ successes: 2, failures: 1 }), elowen, 15).result).toBe('stable');
    expect(rollDeathSave(down({ successes: 0, failures: 2 }), elowen, 5).result).toBe('dead');
    expect(rollDeathSave(down({ successes: 0, failures: 2 }), elowen, 1).state.deathSaves.failures).toBe(3);
  });

  it('naturlig 20 gir 1 HP og nullstiller', () => {
    const r = rollDeathSave(down({ successes: 1, failures: 2 }), elowen, 20);
    expect(r.result).toBe('revived');
    expect(r.state.hpRemoved).toBe(elowen.hpMax - 1);
    expect(r.state.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('ingen death save over 0 HP eller når du er Stable', () => {
    const up = initialGameState(elowen);
    expect(rollDeathSave(up, elowen, 5)).toEqual({ state: up, result: null });
    const stable = down({ successes: 3, failures: 0 });
    expect(rollDeathSave(stable, elowen, 5).result).toBeNull();
  });

  it('skade på 0 HP gir én feil, to ved krit, og Stable blir Dying', () => {
    expect(applyDamage(down(), elowen, 3).state.deathSaves).toEqual({ successes: 0, failures: 1 });
    expect(applyDamage(down(), elowen, 3, { crit: true }).state.deathSaves).toEqual({
      successes: 0,
      failures: 2,
    });
    const stable = applyDamage(down({ successes: 3, failures: 0 }), elowen, 1).state;
    expect(stable.deathSaves).toEqual({ successes: 0, failures: 1 });
    expect(deathStatus(stable, elowen)).toBe('dying');
    // Temp HP tar skaden først: da blir det ingen feil.
    expect(applyDamage({ ...down(), tempHp: 5 }, elowen, 3).state.deathSaves.failures).toBe(0);
    // Skade som tar deg ned til 0 gir ingen feil.
    expect(applyDamage(initialGameState(elowen), elowen, 100).state.deathSaves.failures).toBe(0);
    expect(applyHealing(down({ successes: 1, failures: 1 }), elowen, 5).deathSaves).toEqual({
      successes: 0,
      failures: 0,
    });
  });
});

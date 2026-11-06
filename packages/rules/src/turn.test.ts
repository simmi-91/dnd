// «Spillregler i kampflyten» i byggebeskrivelsen: én describe per rad i tabellen, pluss bjørneturen og ugla.
import { describe, expect, it } from 'vitest';
import elowenRaw from '../fixtures/elowen-4.json';
import legoRaw from '../fixtures/lego-ranger-5.json';
import {
  REASONS,
  attackOutcome,
  attackRoll,
  canDo,
  castCost,
  combatFromGame,
  concentratingOn,
  damageGroups,
  deriveCharacter,
  extraDamageOptions,
  initialGameState,
  maxRolls,
  movementLeft,
  offhandMod,
  payCast,
  payExtraDamage,
  petTurnWeapon,
  resourceContext,
  setInitiative,
  spendResource,
  startCombat,
  turReducer,
  turnOptions,
  turnWeapon,
} from './index.ts';
import type { CombatState, GameState, Sheet, TurnEvent } from './index.ts';

const elowen = deriveCharacter(elowenRaw);
const lego = deriveCharacter(legoRaw);

const OWL = { form: 'owl' as const, name: 'Ugla', hpRemoved: 0, present: true };
const BEAR = 'pet:25974574'; // Kvitebjørn: må adlyde (Animal Handling DC 10)
const SALOMON = 'pet:25974575'; // Krit mot monstrosity

function game(sheet: Sheet): GameState {
  return { ...initialGameState(sheet), ...(sheet === elowen ? { familiar: OWL } : {}) };
}

/** Kamp der karakteren har tur først. */
function fight(sheet: Sheet = elowen): CombatState {
  let s = combatFromGame(sheet, game(sheet));
  s.participants.forEach((p, i) => {
    s = setInitiative(s, p.id, { total: 20 - i });
  });
  return startCombat(s);
}

const run = (s: CombatState, ...events: TurnEvent[]): CombatState => events.reduce(turReducer, s);

const w = (sheet: Sheet, name: string) => {
  const found = sheet.weapons.find((x) => x.name === name);
  if (!found) throw new Error(name);
  return turnWeapon(found);
};
const longbow = w(elowen, 'Longbow');
const dagger = w(elowen, 'Dagger');
const dagger2 = w(elowen, 'Dagger #2');
const scimitar = w(elowen, 'Scimitar');
const opt = (sheet: Sheet, id: string) => {
  const o = turnOptions(sheet);
  const found = [...o.bonus, ...o.reactions, ...o.part].find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};
const hmCast = opt(elowen, 'cast-hunters-mark');
const hmMove = opt(elowen, 'move-hunters-mark');
const extra = (sheet: Sheet, id: string) => {
  const found = extraDamageOptions(sheet).find((x) => x.id === id);
  if (!found) throw new Error(id);
  return found;
};
const ds = extra(elowen, 'dreadful-strike');
const hmDmg = extra(elowen, 'hunters-mark');

const main = (weapon = longbow): TurnEvent => ({ type: 'attack', weapon, attack: 'main' });
const me = (s: CombatState) => s.participants.find((p) => p.id === 'char')!;

describe('oppsett for testene', () => {
  it('Elowen har tur først, med bjørnene og ugla som deltakere', () => {
    const s = fight();
    expect(s.current).toBe('char');
    expect(s.participants.map((p) => p.id)).toEqual(['char', BEAR, SALOMON, 'familiar']);
  });
});

describe('Action: én per tur', () => {
  it.each(['dash', 'dodge', 'disengage'] as const)('%s bruker actionen', (action) => {
    const s = run(fight(), { type: 'action', action });
    expect(canDo(s, { kind: 'attack', weapon: longbow, attack: 'main' })).toEqual({
      ok: false,
      reason: 'Action er brukt denne turen',
    });
    expect(canDo(s, { kind: 'action', action: 'hide' }).reason).toBe(REASONS.action);
  });

  it('Hide bruker actionen, og angrep gjør det også', () => {
    expect(
      canDo(run(fight(), { type: 'action', action: 'hide', total: 3 }), { kind: 'action', action: 'dash' })
        .ok,
    ).toBe(false);
    const s = run(fight(), main());
    expect(me(s).turn.action).toBe('attack');
    expect(canDo(s, { kind: 'action', action: 'dodge' }).reason).toBe(REASONS.action);
  });

  it('en action som ikke er lov, endrer ingenting (dobbel melding)', () => {
    const s = run(fight(), { type: 'action', action: 'dash' });
    expect(turReducer(s, { type: 'action', action: 'dash' })).toBe(s);
  });

  it('ny tur gir ny action', () => {
    let s = run(fight(), { type: 'action', action: 'dash' }, { type: 'endTurn' });
    s = run(s, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'nextRound' });
    expect(s.current).toBe('char');
    expect(me(s).turn.action).toBeNull();
    expect(canDo(s, { kind: 'action', action: 'dash' }).ok).toBe(true);
  });
});

describe('Extra Attack', () => {
  it('nivå 4: ett angrep per Attack-action', () => {
    const s = run(fight(), main());
    expect(me(s).turn.attacksLeft).toBe(0);
    expect(canDo(s, { kind: 'attack', weapon: longbow, attack: 'main' }).reason).toBe(
      'Du har brukt alle angrepene i Attack-actionen',
    );
  });

  it('nivå 5: første angrep setter actionen, resten teller ned', () => {
    const bow = w(lego, 'Longbow');
    let s = run(fight(lego), main(bow));
    expect(me(s).turn).toMatchObject({ action: 'attack', attacksLeft: 1 });
    expect(canDo(s, { kind: 'attack', weapon: bow, attack: 'main' }).ok).toBe(true);
    // Attack-actionen er i gang, så Dash går ikke.
    expect(canDo(s, { kind: 'action', action: 'dash' }).reason).toBe(REASONS.action);
    s = run(s, main(bow));
    expect(me(s).turn.attacksLeft).toBe(0);
    expect(canDo(s, { kind: 'attack', weapon: bow, attack: 'main' }).reason).toBe(REASONS.attacksDone);
    expect(canDo(s, { kind: 'action', action: 'attack' }).reason).toBe(REASONS.attacksDone);
  });
});

describe('Bonus action: én per tur', () => {
  it("Hunter's Mark bruker bonus action", () => {
    const s = run(fight(), { type: 'option', option: hmCast });
    expect(me(s).turn.bonus).toBe('cast-hunters-mark');
    expect(concentratingOn(s, 'char')).toEqual({ spell: "Hunter's Mark", target: null });
    expect(canDo(s, { kind: 'option', option: hmMove }).reason).toBe('Bonus action er brukt denne turen');
    expect(canDo(s, { kind: 'attack', weapon: dagger2, attack: 'light' }).reason).toBe(REASONS.lightFirst);
  });

  it("flytt Hunter's Mark bruker bonus action og bytter mål", () => {
    let s = run(fight(), { type: 'option', option: hmCast, target: 'e1' });
    expect(canDo(s, { kind: 'option', option: hmMove }).ok).toBe(false);
    s = run(
      s,
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'nextRound' },
    );
    expect(canDo(s, { kind: 'option', option: hmMove }).ok).toBe(true);
    s = run(s, { type: 'option', option: hmMove, target: 'e2' });
    expect(concentratingOn(s, 'char')?.target).toBe('e2');
    expect(me(s).turn.bonus).toBe('move-hunters-mark');
  });

  it('Light-ekstraangrep uten Nick bruker bonus action', () => {
    let s = run(fight(), main(dagger));
    expect(canDo(s, { kind: 'attack', weapon: dagger2, attack: 'light' }).ok).toBe(true);
    s = run(s, { type: 'attack', weapon: dagger2, attack: 'light' });
    expect(me(s).turn.bonus).toBe('light-attack');
    expect(canDo(s, { kind: 'option', option: hmCast }).reason).toBe(REASONS.bonus);
  });

  it('Light-ekstraangrep går ikke når bonus action er brukt', () => {
    const s = run(fight(), { type: 'option', option: hmCast }, main(dagger));
    expect(canDo(s, { kind: 'attack', weapon: dagger2, attack: 'light' }).reason).toBe(REASONS.bonus);
  });
});

describe('Light', () => {
  it('krever først et angrep med et Light-våpen i Attack-actionen', () => {
    expect(canDo(fight(), { kind: 'attack', weapon: dagger2, attack: 'light' }).reason).toBe(
      REASONS.lightFirst,
    );
    const bow = run(fight(), main(longbow));
    expect(canDo(bow, { kind: 'attack', weapon: dagger2, attack: 'light' }).reason).toBe(REASONS.lightFirst);
  });

  it('må være et annet Light-våpen, og bare ett ekstra angrep', () => {
    let s = run(fight(), main(dagger));
    expect(me(s).turn.lightFrom).toBe(dagger.key);
    expect(canDo(s, { kind: 'attack', weapon: dagger, attack: 'light' }).reason).toBe(REASONS.lightFirst);
    expect(canDo(s, { kind: 'attack', weapon: longbow, attack: 'light' }).reason).toBe(
      REASONS.notLight('Longbow'),
    );
    s = run(s, { type: 'attack', weapon: dagger2, attack: 'light' });
    expect(canDo(s, { kind: 'attack', weapon: scimitar, attack: 'nick' }).reason).toBe(REASONS.lightUsed);
  });

  it('ingen evnemodifikator på skaden, med mindre den er negativ', () => {
    const d = elowen.weapons.find((x) => x.name === 'Dagger')!;
    expect(offhandMod(d)).toBe(0);
    expect(offhandMod({ ...d, mod: 2, abMod: 1 })).toBe(1); // +1 magic beholdes
    expect(offhandMod({ ...d, mod: -1, abMod: -1 })).toBe(-1);
    const g = damageGroups({ weapon: d, attack: 'light', crit: false });
    expect(g[0]).toMatchObject({ count: 1, sides: 4, mod: 0 });
    expect(damageGroups({ weapon: d, attack: 'main', crit: false })[0]?.mod).toBe(3);
  });
});

describe('Nick', () => {
  it('ekstra-angrepet med Nick-våpenet er del av Action og bruker ikke bonus action', () => {
    let s = run(fight(), main(dagger));
    expect(canDo(s, { kind: 'attack', weapon: scimitar, attack: 'nick' }).ok).toBe(true);
    s = run(s, { type: 'attack', weapon: scimitar, attack: 'nick' });
    expect(me(s).turn.bonus).toBeNull();
    expect(me(s).turn.lightUsed).toBe(true);
    expect(canDo(s, { kind: 'option', option: hmCast }).ok).toBe(true);
  });

  it('gjelder våpenet som gjør ekstra-angrepet (tolkningen fra prototypen)', () => {
    // Scimitar (Nick) først, så Dagger: Daggeren har ikke Nick, så det blir bonus action.
    const s = run(fight(), main(scimitar));
    expect(canDo(s, { kind: 'attack', weapon: dagger, attack: 'nick' }).reason).toBe(
      REASONS.notNick('Dagger'),
    );
    expect(canDo(s, { kind: 'attack', weapon: dagger, attack: 'light' }).ok).toBe(true);
  });

  it('Nick-angrepet får heller ikke evnemodifikatoren', () => {
    const sc = elowen.weapons.find((x) => x.name === 'Scimitar')!;
    expect(damageGroups({ weapon: sc, attack: 'nick', crit: false })[0]?.mod).toBe(0);
  });
});

describe('Sharpshooter', () => {
  it('ranged-angrep i nærkamp får ikke disadvantage med Sharpshooter', () => {
    const s = fight();
    const r = attackRoll(s, 'char', { weapon: longbow, rangedInMelee: true, longRange: true });
    expect(r.disadvantage).toEqual([]);
    expect(r.mode).toBe('normal');
  });

  it('uten Sharpshooter gir det disadvantage', () => {
    const s = fight(lego);
    const r = attackRoll(s, 'char', { weapon: w(lego, 'Longbow'), rangedInMelee: true, longRange: true });
    expect(r.disadvantage).toEqual(['fiende inntil deg (avstandsangrep)', 'lang avstand']);
    expect(r.mode).toBe('disadvantage');
    expect(r.hint).toBe('Rull 2d20 og skriv inn den laveste.');
  });
});

describe("Hunter's Mark", () => {
  it('gratis-kast brukes først, så laveste ledige spell slot', () => {
    let g = game(elowen); // 1 av 2 gratis-kast brukt i fixturen
    expect(castCost(g, elowen, "Hunter's Mark")).toEqual({ kind: 'free', key: 'hunters-mark', left: 1 });
    g = payCast(g, elowen, "Hunter's Mark").state;
    expect(g.resources['hunters-mark']).toBe(2);
    expect(castCost(g, elowen, "Hunter's Mark")).toEqual({ kind: 'slot', slot: 1, left: 3 });
    for (let i = 0; i < 3; i++) g = payCast(g, elowen, "Hunter's Mark").state;
    expect(g.slotsUsed['1']).toBe(3);
    expect(castCost(g, elowen, "Hunter's Mark")).toBeNull();
    const r = payCast(g, elowen, "Hunter's Mark");
    expect(r).toEqual({ state: g, cost: null });
    // Uten noe igjen er valget grått.
    expect(
      canDo(fight(), { kind: 'option', option: hmCast }, { resources: resourceContext(g, elowen) }).reason,
    ).toBe('Ingen gratis-kast eller spell slots igjen');
  });

  it('kan ikke kastes på nytt mens den er aktiv', () => {
    let s = run(fight(), { type: 'option', option: hmCast });
    s = run(
      s,
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'nextRound' },
    );
    expect(canDo(s, { kind: 'option', option: hmCast }).reason).toBe(
      "Allerede aktiv. Bruk «Flytt Hunter's Mark» hvis målet døde.",
    );
  });

  it('+1d6 force per treff mens den er aktiv, ellers grå', () => {
    expect(hmDmg).toMatchObject({ count: 1, sides: 6, dmgType: 'force' });
    expect(canDo(fight(), { kind: 'extraDamage', damage: hmDmg }).reason).toBe(
      "Hunter's Mark er ikke aktiv.",
    );
    const s = run(fight(), { type: 'option', option: hmCast });
    expect(canDo(s, { kind: 'extraDamage', damage: hmDmg }).ok).toBe(true);
    // Ikke én gang per tur: kan brukes på flere treff.
    const twice = run(s, { type: 'extraDamage', damage: hmDmg });
    expect(canDo(twice, { kind: 'extraDamage', damage: hmDmg }).ok).toBe(true);
    const g = damageGroups({
      weapon: elowen.weapons.find((x) => x.name === 'Longbow')!,
      attack: 'main',
      crit: false,
      extras: [hmDmg],
    });
    expect(g.map((x) => [x.key, x.count, x.sides, x.mod, x.dmgType])).toEqual([
      ['weapon', 1, 8, 3, 'piercing'],
      ['hunters-mark', 1, 6, 0, 'force'],
    ]);
  });
});

describe('Dreadful Strike', () => {
  it('én gang per tur, +2d6 psychic', () => {
    expect(ds).toMatchObject({ count: 2, sides: 6, dmgType: 'psychic' });
    let s = run(fight(), main(), { type: 'extraDamage', damage: ds });
    expect(canDo(s, { kind: 'extraDamage', damage: ds }).reason).toBe(
      'Dreadful Strike er brukt denne turen (1 per tur).',
    );
    s = run(
      s,
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'nextRound' },
    );
    expect(canDo(s, { kind: 'extraDamage', damage: ds }).ok).toBe(true);
  });

  it('WIS-mod ganger per Long Rest', () => {
    let g = game(elowen);
    expect(resourceContext(g, elowen).damage['dreadful-strike']).toBe(elowen.mod.wis);
    g = payExtraDamage(g, elowen, ds);
    g = spendResource(g, elowen, 'dreadful-strike', 2);
    const resources = resourceContext(g, elowen);
    expect(resources.damage['dreadful-strike']).toBe(0);
    expect(canDo(fight(), { kind: 'extraDamage', damage: ds }, { resources }).reason).toBe(
      'Ingen Dreadful Strike igjen før Long Rest.',
    );
  });
});

describe("Ambusher's Leap", () => {
  it('+10 ft speed i første tur', () => {
    let s = fight();
    expect(movementLeft(s, 'char')).toBe(elowen.speed + 10);
    s = run(
      s,
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'nextRound' },
    );
    expect(movementLeft(s, 'char')).toBe(elowen.speed);
    expect(movementLeft(fight(lego), 'char')).toBe(lego.speed);
  });
});

describe('Bevegelse', () => {
  it('fot brukt og fot igjen, og Dash dobler', () => {
    let s = run(fight(), { type: 'move', feet: 20 });
    expect(movementLeft(s, 'char')).toBe(25);
    expect(canDo(s, { kind: 'move', feet: 30 }).reason).toBe('Du har bare 25 ft igjen');
    s = run(s, { type: 'action', action: 'dash' });
    expect(movementLeft(s, 'char')).toBe(70);
    s = run(s, { type: 'move', feet: 70 });
    expect(canDo(s, { kind: 'move', feet: 5 }).reason).toBe(REASONS.noMovement);
    // For langt endrer ingenting.
    expect(turReducer(s, { type: 'move', feet: 5 })).toBe(s);
  });

  it('speed 0 med Grappled, og Slow gir −10 ft som ikke stables', () => {
    const grappled = run(fight(), { type: 'condition', who: 'char', condition: 'grappled', on: true });
    expect(canDo(grappled, { kind: 'move', feet: 5 }).reason).toBe('Speed er 0 (Grappled)');
    expect(movementLeft(grappled, 'char')).toBe(0);
    const slowEffect = { kind: 'slow' as const, source: 'e1', target: 'char', ends: null };
    const slowed = run(
      fight(),
      { type: 'effect', effect: slowEffect },
      { type: 'effect', effect: slowEffect },
    );
    expect(movementLeft(slowed, 'char')).toBe(elowen.speed + 10 - 10);
  });
});

describe('Advantage', () => {
  it('mørke med Umbral Sight', () => {
    const s = run(fight(), { type: 'darkness', on: true });
    expect(attackRoll(s, 'char').advantage).toEqual(['mørke (Umbral Sight)']);
    expect(attackRoll(s, 'char').hint).toBe('Rull 2d20 og skriv inn den høyeste.');
    // Lego har ikke Umbral Sight.
    expect(attackRoll(run(fight(lego), { type: 'darkness', on: true }), 'char').mode).toBe('normal');
  });

  it('uglas Help brukes opp på neste angrep', () => {
    let s = run(fight(), { type: 'selectTurn', who: 'familiar' });
    s = run(s, { type: 'action', action: 'help', target: 'char' });
    expect(attackRoll(s, 'char').advantage).toEqual(['Help fra Ugla']);
    s = run(s, { type: 'selectTurn', who: 'char' }, main());
    expect(attackRoll(s, 'char').advantage).toEqual([]);
  });

  it('Hide brukes opp på neste angrep', () => {
    let s = run(fight(), { type: 'action', action: 'hide', total: 17 });
    expect(attackRoll(s, 'char').advantage).toEqual(['du er skjult']);
    s = run(
      s,
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'nextRound' },
    );
    expect(attackRoll(s, 'char').mode).toBe('advantage');
    s = run(s, main());
    expect(attackRoll(s, 'char').mode).toBe('normal');
  });

  it('«annen fordel» for hånd, og advantage og disadvantage opphever hverandre', () => {
    const s = run(fight(), { type: 'darkness', on: true });
    expect(attackRoll(s, 'char', { advantage: true }).advantage).toEqual([
      'mørke (Umbral Sight)',
      'annen fordel',
    ]);
    const both = attackRoll(s, 'char', { disadvantage: true });
    expect(both.mode).toBe('normal');
    expect(both.hint).toBe('Rull 1d20.');
    const poisoned = run(s, { type: 'condition', who: 'char', condition: 'poisoned', on: true });
    expect(attackRoll(poisoned, 'char').disadvantage).toEqual(['du er Poisoned']);
    expect(attackRoll(poisoned, 'char').mode).toBe('normal');
  });

  it('conditions og Dodge på målet', () => {
    let s = fight();
    s = run(s, { type: 'condition', who: SALOMON, condition: 'prone', on: true });
    expect(attackRoll(s, 'char', { target: SALOMON, weapon: dagger }).advantage).toEqual(['målet er Prone']);
    expect(attackRoll(s, 'char', { target: SALOMON, weapon: longbow }).disadvantage).toEqual([
      'målet er Prone',
    ]);
    const dodge = run(
      fight(),
      { type: 'endTurn' },
      { type: 'obey', total: 15 },
      { type: 'action', action: 'dodge' },
    );
    expect(attackRoll(dodge, 'char', { target: BEAR }).disadvantage).toEqual(['målet bruker Dodge']);
  });

  it('Vex: advantage på neste angrep mot samme mål', () => {
    const blade = w(lego, 'Shortsword');
    const s = run(fight(lego), main(blade), { type: 'hit', weapon: blade, target: 'e9' });
    expect(attackRoll(s, 'char', { target: null }).advantage).toEqual(['Vex']);
    const after = run(s, main(blade));
    expect(attackRoll(after, 'char').advantage).toEqual([]);
  });
});

describe('Kritisk treff', () => {
  it('naturlig 20 går rett til skade, naturlig 1 er bom', () => {
    expect(attackOutcome(20, 7)).toEqual({ total: 27, crit: true, fumble: false, next: 'damage' });
    expect(attackOutcome(1, 7)).toEqual({ total: 8, crit: false, fumble: true, next: 'miss' });
    expect(attackOutcome(12, 7).next).toBe('ask');
  });

  it('alle skadeterninger dobles, bonusen legges til én gang', () => {
    const bow = elowen.weapons.find((x) => x.name === 'Longbow')!;
    const g = damageGroups({ weapon: bow, attack: 'main', crit: true, extras: [hmDmg, ds] });
    expect(g.map((x) => `${x.count}d${x.sides}+${x.mod}`)).toEqual(['2d8+3', '2d6+0', '4d6+0']);
    // Husregel på Salomon: krit mot monstrosity gir maks på alle terninger.
    expect(maxRolls(g)).toEqual({ weapon: 16, 'hunters-mark': 12, 'dreadful-strike': 24 });
  });

  it('loggen sier fra om krit', () => {
    const s = run(fight(), { type: 'attack', weapon: longbow, attack: 'main', nat: 20, total: 27 });
    expect(s.log[0]?.text).toContain('KRITISK TREFF');
  });
});

describe('Konsentrasjon', () => {
  it("skade mens Hunter's Mark er aktiv gir CON save mot maks av 10 og halve skaden", () => {
    let s = run(fight(), { type: 'option', option: hmCast }, { type: 'damaged', who: 'char', amount: 9 });
    expect(s.checks).toEqual([expect.objectContaining({ who: 'char', dc: 10, spell: "Hunter's Mark" })]);
    s = run(s, { type: 'damaged', who: 'char', amount: 30 });
    expect(s.checks.map((c) => c.dc)).toEqual([10, 15]);
  });

  it('klarer du den, holder du spellen', () => {
    const s = run(
      fight(),
      { type: 'option', option: hmCast },
      { type: 'damaged', who: 'char', amount: 9 },
      { type: 'concentrationSave', who: 'char', total: 10 },
    );
    expect(s.checks).toEqual([]);
    expect(concentratingOn(s, 'char')?.spell).toBe("Hunter's Mark");
  });

  it("bom avslutter Hunter's Mark", () => {
    const s = run(
      fight(),
      { type: 'option', option: hmCast },
      { type: 'damaged', who: 'char', amount: 9 },
      { type: 'concentrationSave', who: 'char', total: 9 },
    );
    expect(concentratingOn(s, 'char')).toBeNull();
    expect(canDo(s, { kind: 'extraDamage', damage: hmDmg }).reason).toBe("Hunter's Mark er ikke aktiv.");
    expect(s.log[0]?.text).toContain("mistet Hunter's Mark");
  });

  it('uten konsentrasjon blir det ingen sjekk, og Incapacitated bryter den', () => {
    expect(run(fight(), { type: 'damaged', who: 'char', amount: 9 }).checks).toEqual([]);
    const s = run(
      fight(),
      { type: 'option', option: hmCast },
      { type: 'condition', who: 'char', condition: 'unconscious', on: true },
    );
    expect(concentratingOn(s, 'char')).toBeNull();
    expect(canDo(s, { kind: 'action', action: 'dash' }).reason).toBe(
      'Elowen er Incapacitated og kan ikke ta action, bonus action eller reaction',
    );
  });

  it('ny konsentrasjon avslutter den gamle', () => {
    const s = run(fight(), { type: 'option', option: hmCast }, { type: 'concentrate', spell: 'Fog Cloud' });
    expect(concentratingOn(s, 'char')?.spell).toBe('Fog Cloud');
    expect(s.effects.filter((e) => e.kind === 'concentration')).toHaveLength(1);
  });
});

describe('Hide', () => {
  it('Stealth mot DC 15: 14 er ikke nok, 15 er skjult', () => {
    const miss = run(fight(), { type: 'action', action: 'hide', total: 14 });
    expect(miss.effects.some((e) => e.kind === 'hidden')).toBe(false);
    expect(miss.log[0]?.text).toContain('ikke skjult');
    const hit = run(fight(), { type: 'action', action: 'hide', total: 15 });
    expect(hit.effects.some((e) => e.kind === 'hidden' && e.source === 'char')).toBe(true);
  });
});

describe('Reaction og opportunity attack', () => {
  it('kan brukes utenfor egen tur, én gang til din neste tur begynner', () => {
    let s = run(fight(), { type: 'endTurn' });
    expect(s.current).toBe(BEAR);
    expect(canDo(s, { who: 'char', kind: 'attack', weapon: dagger, attack: 'opportunity' }).ok).toBe(true);
    expect(canDo(s, { who: 'char', kind: 'attack', weapon: longbow, attack: 'opportunity' }).reason).toBe(
      REASONS.meleeOnly,
    );
    s = run(s, { type: 'attack', who: 'char', weapon: dagger, attack: 'opportunity' });
    expect(canDo(s, { who: 'char', kind: 'attack', weapon: dagger, attack: 'opportunity' }).reason).toBe(
      REASONS.reaction,
    );
    expect(canDo(s, { who: 'char', kind: 'action', action: 'dash' }).reason).toBe(
      'Det er ikke turen til Elowen',
    );
    s = run(s, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'nextRound' });
    expect(me(s).turn.reaction).toBeNull();
  });
});

describe('Cleave og Graze (Weapon Mastery)', () => {
  const axe = { key: 'axe', name: 'Greataxe', light: false, ranged: false, mastery: 'Cleave' };
  it('Cleave: etter et nærkamptreff, én gang per tur, med samme våpen', () => {
    let s = run(fight(), main(axe));
    expect(canDo(s, { kind: 'attack', weapon: axe, attack: 'cleave' }).reason).toBe(
      REASONS.cleaveFirst('Greataxe'),
    );
    s = run(s, { type: 'hit', weapon: axe, target: null });
    expect(canDo(s, { kind: 'attack', weapon: axe, attack: 'cleave' }).ok).toBe(true);
    s = run(s, { type: 'attack', weapon: axe, attack: 'cleave' }, { type: 'hit', weapon: axe });
    expect(canDo(s, { kind: 'attack', weapon: axe, attack: 'cleave' }).reason).toBe(REASONS.cleaveUsed);
  });

  it('Slow og Sap legger effekter på målet', () => {
    let s = fight();
    s = run(s, main(longbow), { type: 'hit', weapon: longbow, target: BEAR });
    expect(s.effects.find((e) => e.kind === 'slow')).toMatchObject({ source: 'char', target: BEAR });
    s = run(s, { type: 'endTurn' }, { type: 'obey', total: 12 });
    expect(movementLeft(s, BEAR)).toBe(s.participants[1]!.limits.speed - 10);
    const sap = run(fight(), {
      type: 'effect',
      effect: { kind: 'sap', source: 'char', target: 'char', ends: null },
    });
    expect(attackRoll(sap, 'char').disadvantage).toEqual(['Sap']);
  });
});

describe('Bjørnenes tur', () => {
  it('Kvitebjørn må adlyde før den gjør noe', () => {
    let s = run(fight(), { type: 'endTurn' });
    const rend = petTurnWeapon(elowen.pets[0]!.attacks[0]!);
    expect(canDo(s, { kind: 'attack', weapon: rend, attack: 'main' }).reason).toBe(
      'Rull Animal Handling først',
    );
    const failed = run(s, { type: 'obey', total: 9 });
    expect(canDo(failed, { kind: 'attack', weapon: rend, attack: 'main' }).reason).toBe(
      'Kvitebjørn adlyder ikke denne runden. DM bestemmer hva den gjør.',
    );
    expect(canDo(failed, { kind: 'endTurn' }).ok).toBe(true);
    s = run(s, { type: 'obey', total: 10 });
    expect(canDo(s, { kind: 'attack', weapon: rend, attack: 'main' }).ok).toBe(true);
  });

  it('Multiattack gir to angrep i actionen', () => {
    const rend = petTurnWeapon(elowen.pets[1]!.attacks[0]!);
    let s = run(fight(), { type: 'selectTurn', who: SALOMON });
    expect(s.participants.find((p) => p.id === SALOMON)?.limits.attacksPerAction).toBe(2);
    s = run(s, main(rend), main(rend));
    expect(canDo(s, { kind: 'attack', weapon: rend, attack: 'main' }).reason).toBe(REASONS.attacksDone);
  });
});

describe('Ugla', () => {
  it('kan ikke angripe, men kan ta Help', () => {
    const s = run(fight(), { type: 'selectTurn', who: 'familiar' });
    expect(canDo(s, { kind: 'action', action: 'attack' }).reason).toBe(
      'En familiar kan ikke angripe (Find Familiar)',
    );
    expect(canDo(s, { kind: 'action', action: 'help' }).ok).toBe(true);
  });

  it('Help varer til starten av uglas neste tur', () => {
    let s = run(
      fight(),
      { type: 'selectTurn', who: 'familiar' },
      { type: 'action', action: 'help', target: 'char' },
    );
    s = run(s, { type: 'endTurn' }, { type: 'selectTurn', who: 'char' }, { type: 'endTurn' });
    s = run(s, { type: 'endTurn' }, { type: 'obey', total: 1 }, { type: 'endTurn' }, { type: 'nextRound' });
    expect(attackRoll(s, 'char').advantage).toEqual(['Help fra Ugla']);
    s = run(s, { type: 'selectTurn', who: 'familiar' });
    expect(attackRoll(s, 'char').advantage).toEqual([]);
  });
});

describe('canDo generelt', () => {
  it('busy, kamp ikke i gang og ukjent deltaker', () => {
    expect(canDo(fight(), { kind: 'action', action: 'dash' }, { busy: true }).reason).toBe(REASONS.busy);
    const setup = combatFromGame(elowen, game(elowen));
    expect(canDo(setup, { kind: 'action', action: 'dash' }).reason).toBe(REASONS.notActive);
    expect(canDo(fight(), { who: 'x', kind: 'action', action: 'dash' }).reason).toBe(REASONS.unknown);
  });

  it('angrepsvalg fra katalogen går via attack, ikke option', () => {
    expect(canDo(fight(), { kind: 'option', option: opt(elowen, 'light-attack') }).ok).toBe(false);
  });
});

describe('Én spell slot per tur (2024)', () => {
  const disguise = turnOptions(elowen).magic.find((o) => o.spell === 'Disguise Self');
  const druidcraft = turnOptions(elowen).magic.find((o) => o.spell === 'Druidcraft');
  if (!disguise || !druidcraft) throw new Error('magic');
  /** Hunter's Mark uten gratis-kast igjen, så neste kast bruker en slot. */
  const noFree = (): GameState => {
    let g = game(elowen);
    while (castCost(g, elowen, "Hunter's Mark")?.kind === 'free')
      g = payCast(g, elowen, "Hunter's Mark").state;
    return g;
  };

  it('spells med casting time Action står under Magic, også cantrips', () => {
    expect(disguise).toMatchObject({ cost: 'action', spell: 'Disguise Self' });
    expect(druidcraft.text).toBe('Cantrip.');
    expect(resourceContext(game(elowen), elowen).slot?.[disguise.id]).toBe(true);
    expect(resourceContext(game(elowen), elowen).slot?.[druidcraft.id]).toBeUndefined();
  });

  it('andre spell med slot samme tur er grå, cantrips og gratis-kast går', () => {
    const g = noFree();
    const resources = resourceContext(g, elowen);
    expect(resources.slot?.[hmCast.id]).toBe(true);
    let s = run(fight(), { type: 'option', option: hmCast, slot: true });
    expect(s.participants[0]?.turn.oncePerTurn).toContain('spell-slot');
    expect(canDo(s, { kind: 'option', option: disguise }, { resources }).reason).toBe(REASONS.oneSlot);
    expect(canDo(s, { kind: 'option', option: druidcraft }, { resources }).ok).toBe(true);
    // Med gratis-kast igjen teller ikke Hunter's Mark.
    s = run(fight(), { type: 'option', option: hmCast });
    expect(canDo(s, { kind: 'option', option: disguise }, { resources }).ok).toBe(true);
    // Reduceren godtar ikke en andre slot i samme tur.
    const twice = run(fight(), { type: 'option', option: hmCast, slot: true });
    expect(run(twice, { type: 'option', option: disguise, slot: true })).toBe(twice);
  });

  it('regelen gjelder bare deltakerens egen tur, og nullstilles i neste tur', () => {
    let s = run(fight(), { type: 'option', option: hmCast, slot: true }, { type: 'endTurn' });
    expect(canDo(s, { who: 'char', kind: 'option', option: disguise }).reason).toBe(
      REASONS.notTurn('Elowen'),
    );
    s = run(s, ...s.participants.slice(1).map((): TurnEvent => ({ type: 'endTurn' })), { type: 'nextRound' });
    expect(s.current).toBe('char');
    expect(
      canDo(s, { kind: 'option', option: disguise }, { resources: resourceContext(noFree(), elowen) }).ok,
    ).toBe(true);
  });
});

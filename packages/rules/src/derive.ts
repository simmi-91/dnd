// Utregning fra D&D Beyond character-service JSON (v5) til et kompakt ark.
// Rene funksjoner: ingen DOM, ingen nettverk, ingen tilfeldighet.
import { unwrapDdb } from './ddb/types.ts';
import type {
  DdbCharacter,
  DdbClass,
  DdbClassDefinition,
  DdbCreature,
  DdbItem,
  DdbLimitedUse,
  DdbModifier,
  DdbSpell,
} from './ddb/types.ts';
import { ABILITIES } from './sheet.ts';
import type {
  Ability,
  AbilityMap,
  Feature,
  HitDice,
  Pet,
  PetAttack,
  ResetType,
  Resource,
  Save,
  Sheet,
  SheetClass,
  Skill,
  Spell,
  SlotMap,
  Weapon,
} from './sheet.ts';
import { pactSlots, spellSlots, type CasterClass } from './slots.ts';
import { modOf, norm, slug, strip, stripParagraphs, sum } from './util.ts';

const ABILITY_NAME: AbilityMap<string> = {
  str: 'strength',
  dex: 'dexterity',
  con: 'constitution',
  int: 'intelligence',
  wis: 'wisdom',
  cha: 'charisma',
};

const SKILLS: readonly [string, string, Ability][] = [
  ['acrobatics', 'Acrobatics', 'dex'],
  ['animal-handling', 'Animal Handling', 'wis'],
  ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'],
  ['deception', 'Deception', 'cha'],
  ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'],
  ['intimidation', 'Intimidation', 'cha'],
  ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'],
  ['nature', 'Nature', 'int'],
  ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'],
  ['persuasion', 'Persuasion', 'cha'],
  ['religion', 'Religion', 'int'],
  ['sleight-of-hand', 'Sleight of Hand', 'dex'],
  ['stealth', 'Stealth', 'dex'],
  ['survival', 'Survival', 'wis'],
];

/** D&D Beyond sine skill-ID-er for monstre. */
const CREATURE_SKILL: Record<number, string> = {
  2: 'Athletics',
  3: 'Acrobatics',
  4: 'Sleight of Hand',
  5: 'Stealth',
  6: 'Arcana',
  7: 'History',
  8: 'Investigation',
  9: 'Nature',
  10: 'Religion',
  11: 'Animal Handling',
  12: 'Insight',
  13: 'Medicine',
  14: 'Perception',
  15: 'Survival',
  16: 'Deception',
  17: 'Intimidation',
  18: 'Performance',
  19: 'Persuasion',
};

export const MASTERY_TEXT: Record<string, string> = {
  Slow: 'Målet får −10 ft speed til starten av din neste tur.',
  Nick: 'Ekstra-angrepet fra Light kan gjøres som del av Action i stedet for bonus action.',
  Vex: 'Ved treff får du advantage på neste angrep mot samme mål.',
  Sap: 'Ved treff får målet disadvantage på sitt neste angrep.',
  Push: 'Ved treff kan du dytte målet 10 ft unna deg.',
  Topple: 'Ved treff må målet klare en CON save, ellers blir det Prone.',
  Graze: 'Ved bom gjør du likevel skade lik modifikatoren din.',
  Cleave: 'Ved treff kan du angripe en annen fiende innen 5 ft én gang per tur.',
};

const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** D&D Beyond: armorTypeId 1 light, 2 medium, 3 heavy, 4 shield. */
const SHIELD = 4;

function abilityById(id: number | null | undefined): Ability | null {
  return id && id >= 1 && id <= 6 ? (ABILITIES[id - 1] ?? null) : null;
}

// ---------- Modifikatorer og magiske gjenstander ----------

/**
 * Virker gjenstanden nå? Den må være utrustet, eller være en som ikke kan utrustes (`canEquip` false).
 * Forbruksgjenstander (potions, scrolls) virker først når de brukes, og teller ikke.
 */
export function itemActive(item: DdbItem): boolean {
  if (item.definition.isConsumable) return false;
  return item.equipped === true || item.definition.canEquip === false;
}

/** Er en modifikator fra en gjenstand aktiv? Gjenstanden må virke, og være attunet hvis det kreves. */
export function itemModifierActive(item: DdbItem, m: Pick<DdbModifier, 'requiresAttunement'>): boolean {
  if (!itemActive(item)) return false;
  const requires = m.requiresAttunement ?? item.definition.canAttune ?? false;
  return !requires || item.isAttuned === true;
}

/** Aktive modifikatorer på én gjenstand. */
export function activeItemModifiers(item: DdbItem): DdbModifier[] {
  return (item.definition.grantedModifiers ?? []).filter((m) => itemModifierActive(item, m));
}

/** Magic-bonus (+1/+2/+3) på en gjenstand. Gjelder bare gjenstanden selv (våpen eller rustning). */
export function itemMagicBonus(item: DdbItem | undefined): number {
  if (!item) return 0;
  return sum(
    activeItemModifiers(item)
      .filter((m) => m.type === 'bonus' && m.subType === 'magic')
      .map((m) => m.value),
  );
}

function isScoreBonus(m: DdbModifier): boolean {
  return (
    m.type === 'bonus' &&
    /^(strength|dexterity|constitution|intelligence|wisdom|charisma)-score$/.test(m.subType)
  );
}

/**
 * Gir en 2024-bakgrunn økninger i evneverdier? Det gjør den når en feat som bakgrunnen gir
 * (`background.definition.grantedFeats`), eller en feat med taggen `__INITIAL_ASI`, har
 * `bonus/*-score`-modifikatorer (`componentId` = featens ID).
 */
export function backgroundGivesScores(d: DdbCharacter): boolean {
  const ids = new Set<number>();
  for (const g of d.background?.definition?.grantedFeats ?? []) for (const id of g.featIds ?? []) ids.add(id);
  for (const f of d.feats ?? []) {
    const id = f.definition?.id;
    if (id != null && (f.definition?.categories ?? []).some((c) => c.tagName === '__INITIAL_ASI'))
      ids.add(id);
  }
  if (ids.size === 0) return false;
  const featIds = new Set((d.feats ?? []).map((f) => f.definition?.id).filter((id) => id != null));
  return (d.modifiers?.feat ?? []).some(
    (m) =>
      !!m && isScoreBonus(m) && m.componentId != null && ids.has(m.componentId) && featIds.has(m.componentId),
  );
}

/**
 * Samler alle modifikatorer som gjelder hele karakteren.
 * Har karakteren en 2014-rase (`race.isLegacy`) og en 2024-bakgrunn som gir økninger i evneverdier,
 * telles ikke rasens `bonus/*-score` (som i D&D Beyond).
 * `modifiers.item` fra D&D Beyond tas ikke med, fordi den inneholder alle gjenstander,
 * også de som ikke er utrustet eller attunet. I stedet brukes `grantedModifiers` på utrustede
 * gjenstander (minus `magic`, som bare gjelder gjenstanden selv). Like gjenstander teller én gang.
 */
export function collectModifiers(d: DdbCharacter): DdbModifier[] {
  const out: DdbModifier[] = [];
  const skipRaceScores = d.race?.isLegacy === true && backgroundGivesScores(d);
  for (const [group, list] of Object.entries(d.modifiers ?? {})) {
    if (group === 'item') continue;
    for (const m of list ?? []) {
      if (!m) continue;
      if (skipRaceScores && group === 'race' && isScoreBonus(m)) continue;
      out.push(m);
    }
  }
  const seen = new Set<number>();
  for (const item of d.inventory ?? []) {
    const mods = activeItemModifiers(item).filter((m) => m.subType !== 'magic');
    if (mods.length === 0 || seen.has(item.definition.id)) continue;
    seen.add(item.definition.id);
    out.push(...mods);
  }
  return out;
}

export class Mods {
  readonly all: DdbModifier[];
  constructor(all: DdbModifier[]) {
    this.all = all;
  }
  of(type: string, subType: string): DdbModifier[] {
    return this.all.filter((m) => m.type === type && m.subType === subType);
  }
  bonus(subType: string): number {
    return sum(this.of('bonus', subType).map((m) => m.value));
  }
  has(type: string, subType: string): boolean {
    return this.of(type, subType).length > 0;
  }
}

// ---------- Evneverdier ----------

export function abilityScores(d: DdbCharacter, mods: Mods): AbilityMap<number> {
  const find = (arr: DdbCharacter['stats'] | null | undefined, id: number): number | null =>
    arr?.find((s) => s.id === id)?.value ?? null;
  const out = {} as AbilityMap<number>;
  ABILITIES.forEach((a, i) => {
    const id = i + 1;
    let s = (find(d.stats, id) ?? 10) + (find(d.bonusStats, id) ?? 0);
    s += mods.bonus(`${ABILITY_NAME[a]}-score`);
    const sets = mods.of('set', `${ABILITY_NAME[a]}-score`).map((m) => m.value ?? 0);
    if (sets.length) s = Math.max(s, ...sets);
    out[a] = find(d.overrideStats, id) ?? s;
  });
  return out;
}

function mapAbilities<T>(fn: (a: Ability) => T): AbilityMap<T> {
  const out = {} as AbilityMap<T>;
  for (const a of ABILITIES) out[a] = fn(a);
  return out;
}

// ---------- Klasser og evner ----------

function mainClass(d: DdbCharacter): DdbClass {
  return d.classes.find((c) => c.isStartingClass) ?? (d.classes[0] as DdbClass);
}

/** Startklassen først, så de andre i samme rekkefølge som i D&D Beyond. */
function orderedClasses(d: DdbCharacter): DdbClass[] {
  const main = mainClass(d);
  return [main, ...d.classes.filter((c) => c !== main)];
}

export function sheetClasses(d: DdbCharacter): SheetClass[] {
  return orderedClasses(d).map((c) => ({
    name: norm(c.definition.name),
    subclass: c.subclassDefinition ? norm(c.subclassDefinition.name) : null,
    level: c.level,
    hitDie: c.definition.hitDice ?? 8,
  }));
}

export function summaryOf(classes: readonly SheetClass[]): string {
  if (classes.length === 1) {
    const c = classes[0] as SheetClass;
    return `${c.subclass ? c.subclass + ' ' : ''}${c.name} ${c.level}`;
  }
  return classes.map((c) => `${c.name} ${c.level}`).join(' / ');
}

/** Alle evner fra klasse og subclass, med klassens eget nivå. D&D Beyond gjentar klassens evner i subclassen. */
export function classFeatures(d: DdbCharacter): { features: Feature[]; upcoming: Feature[] } {
  const features: Feature[] = [];
  const upcoming: Feature[] = [];
  const seen = new Set<number>();
  for (const c of orderedClasses(d)) {
    const own = c.definition.classFeatures ?? [];
    const ownIds = new Set(own.map((f) => f.id));
    const list = [
      ...own.map((f) => ({ f, sub: false })),
      ...(c.subclassDefinition?.classFeatures ?? [])
        .filter((f) => !ownIds.has(f.id))
        .map((f) => ({ f, sub: true })),
    ].sort((a, b) => a.f.requiredLevel - b.f.requiredLevel);
    for (const { f, sub } of list) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const feature: Feature = {
        name: norm(f.name),
        level: f.requiredLevel,
        cls: norm(c.definition.name),
        sub,
        desc: strip(f.description).slice(0, 600),
      };
      if (f.requiredLevel <= c.level) features.push(feature);
      else if (f.requiredLevel <= c.level + 3) upcoming.push(feature);
    }
  }
  return { features, upcoming };
}

export function hitDiceOf(d: DdbCharacter): HitDice[] {
  const byDie = new Map<number, HitDice>();
  for (const c of orderedClasses(d)) {
    const die = c.definition.hitDice ?? 8;
    const e = byDie.get(die) ?? { die, total: 0, used: 0 };
    e.total += c.level;
    e.used += c.hitDiceUsed ?? 0;
    byDie.set(die, e);
  }
  return [...byDie.values()].sort((a, b) => b.die - a.die);
}

// ---------- Ferdigheter og saves ----------

function proficiencies(mods: Mods): { prof: Set<string>; exp: Set<string>; half: Set<string> } {
  const prof = new Set<string>();
  const exp = new Set<string>();
  const half = new Set<string>();
  for (const m of mods.all) {
    if (m.type === 'proficiency') prof.add(m.subType);
    if (m.type === 'expertise') exp.add(m.subType);
    if (m.type === 'half-proficiency') half.add(m.subType);
  }
  return { prof, exp, half };
}

export function skillsOf(mod: AbilityMap<number>, pb: number, mods: Mods): Skill[] {
  const { prof, exp, half } = proficiencies(mods);
  const checks = mods.bonus('ability-checks');
  return SKILLS.map(([key, name, ab]) => {
    const p: Skill['prof'] = exp.has(key)
      ? 2
      : prof.has(key)
        ? 1
        : half.has(key) || half.has('ability-checks')
          ? 0.5
          : 0;
    const profBonus = p === 0.5 ? Math.floor(pb / 2) : p * pb;
    return { key, name, ab, prof: p, bonus: mod[ab] + profBonus + mods.bonus(key) + checks };
  });
}

export function savesOf(mod: AbilityMap<number>, pb: number, mods: Mods): AbilityMap<Save> {
  const { prof } = proficiencies(mods);
  const all = mods.bonus('saving-throws');
  return mapAbilities((a) => {
    const sub = `${ABILITY_NAME[a]}-saving-throws`;
    const p = prof.has(sub);
    return { prof: p, bonus: mod[a] + (p ? pb : 0) + all + mods.bonus(sub) };
  });
}

// ---------- HP, AC, speed, sanser, initiativ ----------

export function hpMaxOf(d: DdbCharacter, level: number, mod: AbilityMap<number>, mods: Mods): number {
  if (d.overrideHitPoints != null) return d.overrideHitPoints;
  return (
    (d.baseHitPoints ?? 0) +
    (d.bonusHitPoints ?? 0) +
    level * mod.con +
    level * mods.bonus('hit-points-per-level') +
    mods.bonus('hit-points')
  );
}

function equippedItems(d: DdbCharacter): DdbItem[] {
  return (d.inventory ?? []).filter((i) => i.equipped);
}

export function armorClass(
  d: DdbCharacter,
  mod: AbilityMap<number>,
  mods: Mods,
): { ac: number; armor: DdbItem | undefined; shield: DdbItem | undefined } {
  const equipped = equippedItems(d);
  const armor = equipped.find((i) => {
    const t = i.definition.armorTypeId;
    return i.definition.filterType === 'Armor' && t != null && t >= 1 && t <= 3;
  });
  const shield = equipped.find((i) => i.definition.armorTypeId === SHIELD);
  let ac: number;
  if (armor) {
    const t = armor.definition.armorTypeId;
    const dexPart = t === 1 ? mod.dex : t === 2 ? Math.min(2, mod.dex) : 0;
    ac = (armor.definition.armorClass ?? 10) + dexPart + itemMagicBonus(armor);
  } else {
    // Unarmored Defense (Monk, Barbarian): 10 + DEX + en annen evne.
    const unarmored = mods
      .of('set', 'unarmored-armor-class')
      .map(
        (m) =>
          10 + mod.dex + (abilityById(m.statId) ? mod[abilityById(m.statId) as Ability] : (m.value ?? 0)),
      );
    ac = Math.max(10 + mod.dex, ...unarmored) + mods.bonus('unarmored-armor-class');
  }
  if (shield) ac += (shield.definition.armorClass || 2) + itemMagicBonus(shield);
  ac += mods.bonus('armor-class');
  return { ac, armor, shield };
}

export function speedOf(
  d: DdbCharacter,
  mods: Mods,
  armor: DdbItem | undefined,
  has: (n: string) => boolean,
): number {
  let speed = d.race?.weightSpeeds?.normal?.walk || 30;
  const set = mods.of('set', 'innate-speed-walking').map((m) => m.value ?? 0);
  if (set.length) speed = Math.max(...set);
  let bonus = mods.bonus('speed') + mods.bonus('speed-walking') + mods.bonus('unarmored-movement');
  // Roving gir +10 ft uten tung rustning. D&D Beyond gir den ikke alltid som modifikator.
  if (has('Roving') && bonus === 0 && armor?.definition.armorTypeId !== 3) bonus = 10;
  return speed + bonus;
}

export function darkvisionOf(mods: Mods): number {
  const base = Math.max(0, ...mods.of('set-base', 'darkvision').map((m) => m.value ?? 0));
  return base + sum(mods.of('sense', 'darkvision').map((m) => m.value));
}

/**
 * DEX-mod + `bonus`/`initiative`. Har modifikatoren `statId` uten verdi (Dread Ambusher), brukes den evnens mod.
 * Initiativ er et DEX-kast i 2024, så bonuser og halv proficiency på ability checks gjelder også.
 */
export function initiativeOf(mod: AbilityMap<number>, pb: number, mods: Mods): number {
  const { half } = proficiencies(mods);
  const halfProf = half.has('ability-checks') || half.has('initiative') ? Math.floor(pb / 2) : 0;
  return (
    mod.dex +
    halfProf +
    mods.bonus('ability-checks') +
    sum(
      mods.of('bonus', 'initiative').map((m) => {
        if (m.value != null) return m.value;
        const ab = abilityById(m.statId);
        return ab ? mod[ab] : 0;
      }),
    )
  );
}

// ---------- Våpen ----------

function masteries(mods: Mods): Map<string, string> {
  // subType er f.eks. «slow-longbow» eller «nick-scimitar». Mastery-navnet er ett ord.
  const out = new Map<string, string>();
  for (const m of mods.all) {
    if (m.type !== 'weapon-mastery') continue;
    const [first, ...rest] = m.subType.split('-');
    if (!first || rest.length === 0) continue;
    const weapon = rest.join('-');
    if (!out.has(weapon)) out.set(weapon, first.charAt(0).toUpperCase() + first.slice(1));
  }
  return out;
}

export function weaponsOf(d: DdbCharacter, mod: AbilityMap<number>, pb: number, mods: Mods): Weapon[] {
  const { prof } = proficiencies(mods);
  const mastery = masteries(mods);
  const ranged = mods.bonus('ranged-weapon-attacks');
  const melee = mods.bonus('melee-weapon-attacks');
  const count = new Map<string, number>();
  return equippedItems(d)
    .filter((i) => i.definition.filterType === 'Weapon' && i.definition.damage)
    .map((i) => {
      const w = i.definition;
      const props = (w.properties ?? []).map((p) => p.name);
      const isRanged = w.attackType === 2;
      const finesse = props.includes('Finesse');
      const ab: Ability = isRanged ? 'dex' : finesse && mod.dex >= mod.str ? 'dex' : 'str';
      const type = norm(w.type || w.name);
      const typeSlug = slug(type);
      const proficient =
        prof.has(w.categoryId === 2 ? 'martial-weapons' : 'simple-weapons') || prof.has(typeSlug);
      const magic = itemMagicBonus(i);
      const n = (count.get(type) ?? 0) + 1;
      count.set(type, n);
      const thrown = props.includes('Thrown');
      const m = mastery.get(typeSlug) ?? null;
      return {
        key: `w${i.id}`,
        name: norm(w.name) + (n > 1 ? ` #${n}` : ''),
        type,
        hit: mod[ab] + (proficient ? pb : 0) + (isRanged ? ranged : melee) + magic,
        count: w.damage?.diceCount || 1,
        sides: w.damage?.diceValue || 1,
        mod: mod[ab] + magic,
        abMod: mod[ab],
        magic,
        dmgType: String(w.damageType ?? '').toLowerCase(),
        ranged: isRanged,
        range: isRanged || thrown ? `${w.range}/${w.longRange} ft` : `${w.range || 5} ft`,
        light: props.includes('Light'),
        thrown,
        heavy: props.includes('Heavy'),
        mastery: m,
        masteryText: m ? (MASTERY_TEXT[m] ?? '') : null,
      };
    });
}

// ---------- Magi ----------

function castingDefinition(c: DdbClass): DdbClassDefinition | null {
  const hasSlots = (def: DdbClassDefinition | null | undefined): boolean =>
    !!def?.canCastSpells && (def.spellRules?.levelSpellSlots ?? []).some((row) => row.some((n) => n > 0));
  if (hasSlots(c.definition)) return c.definition;
  if (hasSlots(c.subclassDefinition)) return c.subclassDefinition ?? null;
  return null;
}

function isWarlock(c: DdbClass): boolean {
  return norm(c.definition.name).toLowerCase() === 'warlock';
}

export function casterClasses(
  d: DdbCharacter,
  levelOf: (c: DdbClass) => number = (c) => c.level,
): CasterClass[] {
  const out: CasterClass[] = [];
  for (const c of d.classes) {
    if (isWarlock(c)) continue;
    const def = castingDefinition(c);
    if (!def) continue;
    const rules = def.spellRules ?? {};
    out.push({
      level: levelOf(c),
      divisor: rules.multiClassSpellSlotDivisor || 1,
      roundUp: rules.multiClassSpellSlotRounding === 2,
      table: rules.levelSpellSlots,
    });
  }
  return out;
}

function castAbility(d: DdbCharacter): Ability | null {
  for (const c of orderedClasses(d)) {
    const ab =
      abilityById(c.definition.spellCastingAbilityId) ??
      abilityById(c.subclassDefinition?.spellCastingAbilityId);
    if (ab && (c.definition.canCastSpells || c.subclassDefinition?.canCastSpells || isWarlock(c))) return ab;
  }
  return null;
}

function slotsUsedOf(d: DdbCharacter): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of d.spellSlots ?? []) if ((s.used ?? 0) > 0) out[String(s.level)] = s.used ?? 0;
  const pact = sum((d.pactMagic ?? []).map((s) => s.used));
  if (pact > 0) out.pact = pact;
  return out;
}

export function resetOf(r: DdbLimitedUse['resetType']): ResetType {
  if (r === 1) return 'short';
  if (r === 2) return 'long';
  if (typeof r === 'string') {
    const s = r.toLowerCase();
    if (s.includes('short')) return 'short';
    if (s.includes('long')) return 'long';
  }
  return 'other';
}

/**
 * Maks bruk av en `limitedUse`. Alle fixturene har `operator` og `proficiencyBonusOperator` = 1 (eller null),
 * og «maxUses 0 + WIS-mod» gir 3 for Dreadful Strike, så 1 betyr «legg til». 2 tolkes som «gang»
 * (D&D Beyonds verdi for multiplikasjon). Det er ikke sett i ekte data. Ukjente verdier behandles som 1.
 */
export function limitedUseMax(lu: DdbLimitedUse, mod: AbilityMap<number>, pb: number): number {
  const combine = (base: number, x: number, op: number | null | undefined): number =>
    op === 2 ? base * x : base + x;
  let max = lu.maxUses ?? 0;
  const ab = abilityById(lu.statModifierUsesId);
  if (ab) max = Math.max(1, combine(max, mod[ab], lu.operator));
  if (lu.useProficiencyBonus) max = combine(max, pb, lu.proficiencyBonusOperator);
  return max;
}

/** Spells per kilde. Spells fra gjenstander tas bare med når gjenstanden virker (se `itemModifierActive`). */
function spellGroups(d: DdbCharacter): [string, DdbSpell[]][] {
  const items = d.inventory ?? [];
  return Object.entries(d.spells ?? {}).map(([source, list]) => {
    const spells = list ?? [];
    if (source !== 'item') return [source, spells];
    return [
      source,
      spells.filter((s) => items.some((i) => i.definition.id === s.componentId && itemModifierActive(i, {}))),
    ];
  });
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base || 'ressurs';
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

/** Alle begrensede ressurser fra `actions` og gratis-kast fra `spells`. Nøkkelen er en slug av navnet. */
export function resourcesOf(
  d: DdbCharacter,
  mod: AbilityMap<number>,
  pb: number,
): { resources: Resource[]; spellKeys: Map<string, string> } {
  const resources: Resource[] = [];
  const taken = new Set<string>();
  for (const list of Object.values(d.actions ?? {})) {
    for (const a of list ?? []) {
      const lu = a.limitedUse;
      if (!lu) continue;
      const max = limitedUseMax(lu, mod, pb);
      if (max <= 0) continue;
      const name = norm(a.name);
      resources.push({
        key: uniqueKey(slug(name), taken),
        name,
        max,
        used: Math.min(max, lu.numberUsed ?? 0),
        reset: resetOf(lu.resetType),
      });
    }
  }
  const spellKeys = new Map<string, string>();
  for (const [source, list] of spellGroups(d)) {
    for (const s of list) {
      const lu = s.limitedUse;
      const name = norm(s.definition?.name);
      if (!lu || !name) continue;
      const max = limitedUseMax(lu, mod, pb);
      const id = `${name}|${source}`;
      if (max <= 0 || spellKeys.has(id)) continue;
      const key = uniqueKey(`spell-${slug(name)}`, taken);
      spellKeys.set(id, key);
      resources.push({
        key,
        name,
        max,
        used: Math.min(max, lu.numberUsed ?? 0),
        reset: resetOf(lu.resetType),
      });
    }
  }
  return { resources, spellKeys };
}

export function spellsOf(d: DdbCharacter, resources: Resource[], spellKeys: Map<string, string>): Spell[] {
  const byName = new Map<string, Spell>();
  const add = (s: DdbSpell[], source: string): void => {
    for (const sp of s) {
      const def = sp.definition;
      const name = norm(def?.name);
      if (!name || !def) continue;
      const key = spellKeys.get(`${name}|${source}`) ?? null;
      const free = key ? (resources.find((r) => r.key === key)?.max ?? 0) : 0;
      const prev = byName.get(name);
      if (prev) {
        if (free > prev.free) Object.assign(prev, { free, resourceKey: key });
        continue;
      }
      byName.set(name, {
        name,
        level: def.level ?? 0,
        source,
        free,
        resourceKey: free > 0 ? key : null,
        concentration: !!def.concentration,
        ritual: !!def.ritual,
        time: def.activation?.activationType ?? null,
        desc: stripParagraphs(def.description).slice(0, 4000),
      });
    }
  };
  for (const [source, list] of spellGroups(d)) add(list, source);
  for (const c of d.classSpells ?? []) {
    add(
      (c.spells ?? []).filter((s) => s.prepared || s.alwaysPrepared || s.definition?.level === 0),
      'class',
    );
  }
  return [...byName.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

// ---------- Kjæledyr (Extras) ----------

const ATTACK_RE =
  /([A-Z][A-Za-z' ]{1,30})\.\s*(Melee|Ranged)(?: or Ranged)? (?:Weapon )?Attack(?: Roll)?:\s*\+(\d+),\s*(?:reach|range) ([^.]*?ft)\.?.*?Hit:\s*(\d+)\s*\((\d+)d(\d+)\s*(?:([+−-])\s*(\d+))?\)\s*(\w+) damage/g;

export function parseCreatureAttacks(actionsText: string): PetAttack[] {
  const attacks: PetAttack[] = [];
  for (const m of actionsText.matchAll(ATTACK_RE)) {
    const dm = m[9] ? (m[8] === '+' ? 1 : -1) * Number(m[9]) : 0;
    attacks.push({
      name: (m[1] ?? '').trim(),
      melee: m[2] === 'Melee',
      hit: Number(m[3]),
      reach: m[4] ?? '',
      count: Number(m[6]),
      sides: Number(m[7]),
      mod: dm,
      dmgType: (m[10] ?? '').toLowerCase(),
    });
  }
  return attacks;
}

function petNotes(d: DdbCharacter): Map<string, string> {
  const notes = new Map<string, string>();
  for (const v of d.characterValues ?? []) {
    if (v.typeId !== 47 || !v.value || v.valueId == null) continue;
    const id = String(v.valueId);
    const prev = notes.get(id);
    notes.set(id, prev ? `${prev} ${String(v.value)}` : String(v.value));
  }
  return notes;
}

export function petOf(c: DdbCreature, notes: Map<string, string>): Pet {
  const def = c.definition ?? {};
  const stats: Partial<AbilityMap<number>> = {};
  for (const s of def.stats ?? []) {
    const ab = abilityById(s.statId);
    if (ab) stats[ab] = s.value;
  }
  const actionsText = strip(def.actionsDescription);
  const multi = actionsText.match(/makes (one|two|three|four|five|\d) ([A-Z][A-Za-z']+)/);
  const multiCount = multi ? (WORDNUM[multi[1] ?? ''] ?? Number(multi[1])) : 0;
  return {
    id: String(c.id),
    name: norm(c.name) || norm(def.name),
    kind: norm(def.name),
    typeId: def.typeId ?? null,
    ac: def.armorClass ?? 10,
    hpMax: def.averageHitPoints ?? 0,
    hitDice: def.hitPointDice?.diceCount ?? 0,
    hpRemoved: c.removedHitPoints ?? 0,
    tempHp: c.temporaryHitPoints ?? 0,
    initiativeBonus: def.initiative?.bonus ?? modOf(stats.dex ?? 10),
    stats,
    speeds: (def.movements ?? []).map((m) => ({ id: m.movementId, speed: m.speed })),
    skills: (def.skills ?? []).map((s) => ({
      name: CREATURE_SKILL[s.skillId] ?? `Skill ${s.skillId}`,
      bonus: s.value,
    })),
    senses: (def.senses ?? []).map((s) => norm(s.notes)).filter(Boolean),
    attacks: parseCreatureAttacks(actionsText),
    multiattack: multi && multiCount ? { count: multiCount, attack: multi[2] ?? '' } : null,
    actionsText: actionsText.slice(0, 1200),
    traitsText: strip(def.specialTraitsDescription).slice(0, 800),
    notes: notes.get(String(c.id)) ?? strip(c.description),
  };
}

// ---------- Hele arket ----------

export function deriveCharacter(raw: unknown): Sheet {
  const d = unwrapDdb(raw);
  const mods = new Mods(collectModifiers(d));

  const scores = abilityScores(d, mods);
  const mod = mapAbilities((a) => modOf(scores[a]));

  const classes = sheetClasses(d);
  const main = mainClass(d);
  const level = sum(d.classes.map((c) => c.level));
  const pb = 2 + Math.floor((Math.max(1, level) - 1) / 4);

  const { features, upcoming } = classFeatures(d);
  const has = (name: string): boolean => features.some((f) => f.name.toLowerCase() === name.toLowerCase());

  const feats = (d.feats ?? []).map((f) => norm(f.definition?.name)).filter(Boolean);
  const skills = skillsOf(mod, pb, mods);
  const skill = (k: string): number => skills.find((s) => s.key === k)?.bonus ?? 0;
  const { ac, armor, shield } = armorClass(d, mod, mods);

  const casters = casterClasses(d);
  const warlock = d.classes.find(isWarlock);
  const castAb = castAbility(d);
  const { resources, spellKeys } = resourcesOf(d, mod, pb);
  const spells = spellsOf(d, resources, spellKeys);

  const hmRes = resources.find((r) => r.name === "Hunter's Mark");
  const dsRes = resources.find((r) => r.name === 'Dreadful Strike');
  const extraAttacks = mods.of('set', 'extra-attacks').map((m) => m.value ?? 0);
  const attacksPerAction = extraAttacks.length ? 1 + Math.max(...extraAttacks) : has('Extra Attack') ? 2 : 1;

  const lineage =
    (d.options?.race ?? []).map((o) => norm(o.definition?.name)).find((n) => /Lineage$/.test(n)) ?? null;

  const notes = petNotes(d);
  const nextSlots: SlotMap = spellSlots(casterClasses(d, (c) => (c === main ? c.level + 1 : c.level)));

  return {
    name: norm(d.name),
    race: norm(d.race?.fullName || d.race?.baseName) || null,
    lineage: lineage ? lineage.replace(/ Lineage$/, '') : null,
    cls: norm(main.definition.name),
    subclass: main.subclassDefinition ? norm(main.subclassDefinition.name) : null,
    classes,
    summary: summaryOf(classes),
    level,
    classLevel: main.level,
    pb,
    scores,
    mod,
    saves: savesOf(mod, pb, mods),
    skills,
    passive: {
      perception: 10 + skill('perception'),
      insight: 10 + skill('insight'),
      investigation: 10 + skill('investigation'),
    },
    hpMax: hpMaxOf(d, level, mod, mods),
    hpRemoved: d.removedHitPoints ?? 0,
    tempHp: d.temporaryHitPoints ?? 0,
    hitDie: main.definition.hitDice ?? 8,
    hitDice: hitDiceOf(d),
    ac,
    armor: armor ? norm(armor.definition.name) : null,
    shield: !!shield,
    speed: speedOf(d, mods, armor, has),
    darkvision: darkvisionOf(mods),
    initiative: initiativeOf(mod, pb, mods),
    weapons: weaponsOf(d, mod, pb, mods),
    feats,
    sharpshooter: feats.includes('Sharpshooter'),
    attacksPerAction,
    castAb,
    spellDc: castAb ? 8 + pb + mod[castAb] : null,
    spellAttack: castAb ? pb + mod[castAb] : null,
    slots: spellSlots(casters),
    nextSlots,
    pactSlots: warlock ? pactSlots(warlock.level) : null,
    slotsUsed: slotsUsedOf(d),
    spells,
    resources,
    hm: {
      key: hmRes?.key ?? null,
      max: hmRes?.max ?? 0,
      used: hmRes?.used ?? 0,
      die: has('Foe Slayer') ? 10 : 6,
      known: spells.some((s) => s.name === "Hunter's Mark"),
    },
    ds: has('Dread Ambusher')
      ? {
          key: dsRes?.key ?? null,
          max: dsRes?.max ?? Math.max(1, mod.wis),
          used: dsRes?.used ?? 0,
          dice: has("Stalker's Flurry") ? 8 : 6,
        }
      : null,
    ambusherLeap: has('Dread Ambusher'),
    umbralSight: has('Umbral Sight'),
    familiar: spells.some((s) => s.name === 'Find Familiar'),
    features,
    upcoming,
    pets: (d.creatures ?? []).map((c) => petOf(c, notes)),
    xp: d.currentXp ?? 0,
    dateModified: d.dateModified ?? null,
  };
}

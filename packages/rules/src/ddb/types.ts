// Typer for svaret fra D&D Beyond character-service (v5). Bare feltene regelmotoren bruker.
// Alle felt er valgfrie eller nullable, fordi formatet er uoffisielt og kan endres.

export const DDB_FORMAT_MESSAGE = 'D&D Beyond har endret formatet. Bruk lim inn.';

export class DdbFormatError extends Error {
  /** Teknisk grunn, til logg. Meldingen til brukeren er alltid `DDB_FORMAT_MESSAGE`. */
  readonly detail: string | undefined;

  constructor(detail?: string) {
    super(DDB_FORMAT_MESSAGE);
    this.name = 'DdbFormatError';
    this.detail = detail;
  }
}

export interface DdbStat {
  id: number;
  value: number | null;
}

export interface DdbModifier {
  type: string;
  subType: string;
  value?: number | null;
  fixedValue?: number | null;
  statId?: number | null;
  friendlySubtypeName?: string | null;
  componentId?: number | null;
  requiresAttunement?: boolean | null;
}

export interface DdbLimitedUse {
  maxUses?: number | null;
  numberUsed?: number | null;
  statModifierUsesId?: number | null;
  useProficiencyBonus?: boolean | null;
  /** Hvordan evne-moden kombineres med `maxUses`: 1 = legg til, 2 = gang. */
  operator?: number | null;
  /** Hvordan PB kombineres: 1 = legg til, 2 = gang. */
  proficiencyBonusOperator?: number | null;
  /** Tall i actions og spells (1 = Short Rest, 2 = Long Rest), tekst i inventory («Other»). */
  resetType?: number | string | null;
}

export interface DdbFeatureDefinition {
  id: number;
  name: string;
  requiredLevel: number;
  description?: string | null;
}

export interface DdbSpellRules {
  levelSpellSlots?: number[][] | null;
  /** 1 = full caster, 2 = half caster, 3 = third caster. */
  multiClassSpellSlotDivisor?: number | null;
  /** 1 = rund ned, 2 = rund opp. */
  multiClassSpellSlotRounding?: number | null;
}

export interface DdbClassDefinition {
  name: string;
  hitDice?: number | null;
  canCastSpells?: boolean | null;
  spellCastingAbilityId?: number | null;
  spellRules?: DdbSpellRules | null;
  classFeatures?: DdbFeatureDefinition[] | null;
}

export interface DdbClass {
  id?: number;
  level: number;
  isStartingClass?: boolean | null;
  hitDiceUsed?: number | null;
  definition: DdbClassDefinition;
  subclassDefinition?: DdbClassDefinition | null;
}

export interface DdbItemDefinition {
  id: number;
  name: string;
  type?: string | null;
  filterType?: string | null;
  magic?: boolean | null;
  canAttune?: boolean | null;
  /** false for gjenstander som ikke kan utrustes (de virker uten). */
  canEquip?: boolean | null;
  /** Potions, scrolls og lignende. */
  isConsumable?: boolean | null;
  armorTypeId?: number | null;
  armorClass?: number | null;
  categoryId?: number | null;
  attackType?: number | null;
  damage?: { diceCount?: number | null; diceValue?: number | null } | null;
  damageType?: string | null;
  range?: number | null;
  longRange?: number | null;
  properties?: { name: string }[] | null;
  grantedModifiers?: DdbModifier[] | null;
}

export interface DdbItem {
  id: number;
  equipped?: boolean | null;
  isAttuned?: boolean | null;
  definition: DdbItemDefinition;
}

export interface DdbAction {
  name: string;
  limitedUse?: DdbLimitedUse | null;
}

export interface DdbSpell {
  definition?: {
    name: string;
    level?: number | null;
    concentration?: boolean | null;
    ritual?: boolean | null;
    activation?: { activationType?: number | null } | null;
  } | null;
  limitedUse?: DdbLimitedUse | null;
  prepared?: boolean | null;
  alwaysPrepared?: boolean | null;
  /** For spells fra gjenstander: gjenstandens `definition.id`. */
  componentId?: number | null;
}

export interface DdbCreature {
  id: number;
  name?: string | null;
  description?: string | null;
  removedHitPoints?: number | null;
  temporaryHitPoints?: number | null;
  definition?: {
    name?: string | null;
    typeId?: number | null;
    armorClass?: number | null;
    averageHitPoints?: number | null;
    hitPointDice?: { diceCount?: number | null } | null;
    stats?: { statId: number; value: number }[] | null;
    movements?: { movementId: number; speed: number }[] | null;
    skills?: { skillId: number; value: number }[] | null;
    senses?: { senseId?: number; notes?: string | null }[] | null;
    initiative?: { bonus?: number | null } | null;
    actionsDescription?: string | null;
    specialTraitsDescription?: string | null;
  } | null;
}

export interface DdbSlot {
  level: number;
  used?: number | null;
}

export interface DdbCharacter {
  name?: string | null;
  stats: DdbStat[];
  bonusStats?: DdbStat[] | null;
  overrideStats?: DdbStat[] | null;
  baseHitPoints?: number | null;
  bonusHitPoints?: number | null;
  overrideHitPoints?: number | null;
  removedHitPoints?: number | null;
  temporaryHitPoints?: number | null;
  race?: {
    /** true for 2014-raser (f.eks. Wood Elf fra Player's Handbook 2014). */
    isLegacy?: boolean | null;
    fullName?: string | null;
    baseName?: string | null;
    weightSpeeds?: { normal?: { walk?: number | null } | null } | null;
  } | null;
  classes: DdbClass[];
  feats?:
    | {
        definition?: {
          id?: number | null;
          name?: string | null;
          /** Bl.a. `tagName: '__INITIAL_ASI'` for økningene fra en 2024-bakgrunn. */
          categories?: { tagName?: string | null }[] | null;
        } | null;
      }[]
    | null;
  background?: {
    definition?: { grantedFeats?: { featIds?: number[] | null }[] | null } | null;
  } | null;
  inventory?: DdbItem[] | null;
  modifiers?: Record<string, DdbModifier[] | null> | null;
  actions?: Record<string, DdbAction[] | null> | null;
  spells?: Record<string, DdbSpell[] | null> | null;
  classSpells?: { spells?: DdbSpell[] | null }[] | null;
  spellSlots?: DdbSlot[] | null;
  pactMagic?: DdbSlot[] | null;
  options?: Record<string, { definition?: { name?: string | null } | null }[] | null> | null;
  characterValues?: { typeId: number; value: unknown; valueId?: string | number | null }[] | null;
  creatures?: DdbCreature[] | null;
  dateModified?: string | null;
  currentXp?: number | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pakker ut karakteren fra `{ success, data }` eller fra `data` direkte, og sjekker grovt
 * at feltene som utregningen ikke klarer seg uten, finnes. Kaster `DdbFormatError` ellers.
 */
export function unwrapDdb(raw: unknown): DdbCharacter {
  if (!isObject(raw)) throw new DdbFormatError('ikke et objekt');
  if (raw.success === false) throw new DdbFormatError('success er false');
  const d = isObject(raw.data) ? raw.data : raw;
  if (!Array.isArray(d.stats) || d.stats.length < 6) throw new DdbFormatError('stats mangler');
  if (!d.stats.every((s) => isObject(s) && typeof s.id === 'number')) {
    throw new DdbFormatError('stats har feil form');
  }
  if (!Array.isArray(d.classes) || d.classes.length === 0) throw new DdbFormatError('classes mangler');
  for (const c of d.classes) {
    if (!isObject(c) || typeof c.level !== 'number' || !isObject(c.definition)) {
      throw new DdbFormatError('classes har feil form');
    }
    if (typeof c.definition.name !== 'string') throw new DdbFormatError('klassen mangler navn');
  }
  for (const key of ['modifiers', 'actions', 'spells', 'options'] as const) {
    if (d[key] != null && !isObject(d[key])) throw new DdbFormatError(`${key} har feil form`);
  }
  for (const key of ['inventory', 'creatures', 'feats', 'characterValues', 'classSpells'] as const) {
    if (d[key] != null && !Array.isArray(d[key])) throw new DdbFormatError(`${key} har feil form`);
  }
  return d as unknown as DdbCharacter;
}

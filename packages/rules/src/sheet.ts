// Arket som `deriveCharacter` lager, og som lagres i `dd_characters.derived`.
// Endres formen eller utregningen, skal DERIVE_VERSION økes, så serveren vet at arket må regnes ut på nytt.

export const DERIVE_VERSION = 1;

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityMap<T> = Record<Ability, T>;

export type ResetType = 'short' | 'long' | 'other';

export interface SheetClass {
  name: string;
  subclass: string | null;
  level: number;
  hitDie: number;
}

export interface Skill {
  key: string;
  name: string;
  ab: Ability;
  /** 0 = ingen, 0.5 = halv (Jack of All Trades), 1 = proficiency, 2 = expertise. */
  prof: 0 | 0.5 | 1 | 2;
  bonus: number;
}

export interface Save {
  prof: boolean;
  bonus: number;
}

export interface Weapon {
  key: string;
  name: string;
  type: string;
  hit: number;
  count: number;
  sides: number;
  /** Skademodifikator: evne-mod + magic-bonus. */
  mod: number;
  /** Bare evne-moden, for Light-ekstraangrep. */
  abMod: number;
  magic: number;
  dmgType: string;
  ranged: boolean;
  range: string;
  light: boolean;
  thrown: boolean;
  heavy: boolean;
  mastery: string | null;
  masteryText: string | null;
}

export interface Spell {
  name: string;
  level: number;
  source: string;
  /** Gratis kast per hvile (fra `limitedUse`), 0 hvis ingen. */
  free: number;
  /** Nøkkel i `resources` for gratis-kastene, eller null. */
  resourceKey: string | null;
  concentration: boolean;
  ritual: boolean;
  time: number | null;
  /** Kort tekst fra D&D Beyond (uten HTML). Mangler i ark som ble regnet ut før feltet kom. */
  desc?: string;
}

export interface Resource {
  key: string;
  name: string;
  max: number;
  used: number;
  reset: ResetType;
}

export interface Feature {
  name: string;
  level: number;
  cls: string;
  sub: boolean;
  desc: string;
}

export interface HitDice {
  die: number;
  total: number;
  /** Brukt ifølge D&D Beyond. Leses bare ved første import eller når HP og ressurser hentes. */
  used: number;
}

export interface PetAttack {
  name: string;
  melee: boolean;
  hit: number;
  reach: string;
  count: number;
  sides: number;
  mod: number;
  dmgType: string;
}

export interface Pet {
  id: string;
  name: string;
  kind: string;
  typeId: number | null;
  ac: number;
  hpMax: number;
  hitDice: number;
  hpRemoved: number;
  tempHp: number;
  initiativeBonus: number;
  stats: Partial<AbilityMap<number>>;
  speeds: { id: number; speed: number }[];
  skills: { name: string; bonus: number }[];
  senses: string[];
  attacks: PetAttack[];
  multiattack: { count: number; attack: string } | null;
  actionsText: string;
  traitsText: string;
  notes: string;
}

/** Spell slots per nivå, f.eks. `{ 1: 4, 2: 2 }`. */
export type SlotMap = Record<number, number>;

export interface Sheet {
  name: string;
  race: string | null;
  lineage: string | null;
  /** Hovedklassen (startklassen). */
  cls: string;
  subclass: string | null;
  classes: SheetClass[];
  /** «Gloom Stalker Ranger 4» eller «Ranger 3 / Rogue 2». */
  summary: string;
  level: number;
  /** Nivået i hovedklassen. */
  classLevel: number;
  pb: number;
  scores: AbilityMap<number>;
  mod: AbilityMap<number>;
  saves: AbilityMap<Save>;
  skills: Skill[];
  passive: { perception: number; insight: number; investigation: number };
  hpMax: number;
  hpRemoved: number;
  tempHp: number;
  /** Hit die i hovedklassen. */
  hitDie: number;
  hitDice: HitDice[];
  ac: number;
  armor: string | null;
  shield: boolean;
  speed: number;
  darkvision: number;
  initiative: number;
  weapons: Weapon[];
  feats: string[];
  sharpshooter: boolean;
  attacksPerAction: number;
  castAb: Ability | null;
  spellDc: number | null;
  spellAttack: number | null;
  slots: SlotMap;
  /** Slots hvis hovedklassen går opp ett nivå. */
  nextSlots: SlotMap;
  /** Warlock Pact Magic, for seg selv. */
  pactSlots: { level: number; count: number } | null;
  /** Brukte slots ifølge D&D Beyond (nøkkel `'1'`–`'9'` og `'pact'`). */
  slotsUsed: Record<string, number>;
  spells: Spell[];
  resources: Resource[];
  hm: { key: string | null; max: number; used: number; die: number; known: boolean };
  ds: { key: string | null; max: number; used: number; dice: number } | null;
  ambusherLeap: boolean;
  umbralSight: boolean;
  familiar: boolean;
  features: Feature[];
  upcoming: Feature[];
  pets: Pet[];
  /** `currentXp` fra D&D Beyond. */
  xp: number;
  dateModified: string | null;
}

// Evneregisteret (UTVIKLINGSPLAN 7.2): et kart fra evnenavn til effekt, beskrevet som data.
// Alle oppslag på navn (evner, feats, spells og Weapon Mastery) skjer i `activeRules` her, så resten
// av koden og UI-et leser bare effektene. Nye klasser legges til som nye rader i `RULES`.
import { ACTIONS, type ActionDef, type Cost } from './actions.ts';
import { MASTERY_TEXT } from './derive.ts';
import type { GameState } from './import.ts';
import type { Sheet, Spell } from './sheet.ts';
import { slotMax, spendResource, spendSlot, type SlotKey } from './state.ts';
import { norm, slug } from './util.ts';

/** Hvordan et angrep passer inn i action-økonomien. */
export type AttackKind = 'main' | 'light' | 'nick' | 'cleave' | 'opportunity';

export type RuleFlag =
  /** Ranged-angrep med fiende inntil deg får ikke disadvantage (Sharpshooter). */
  | 'no-ranged-melee-disadvantage'
  /** Ingen disadvantage på lang avstand (Sharpshooter). */
  | 'no-long-range-disadvantage'
  /** Ignorerer half og three-quarters cover (Sharpshooter). */
  | 'ignore-cover'
  /** Climb og swim speed lik speed (Roving). */
  | 'climb-swim';

export type MasteryId = 'slow' | 'nick' | 'vex' | 'sap' | 'topple' | 'push' | 'graze' | 'cleave';

/** Et valg en evne gir i turen (bonus action, reaction eller del av Action). */
export interface OptionDef {
  id: string;
  /** Regelen valget kommer fra. */
  rule: string;
  name: string;
  cost: Cost;
  text: string;
  /** Valget starter en angrepsflyt av denne typen. */
  attack?: AttackKind;
  /** Spell som må betales (gratis-kast først, så laveste ledige slot). */
  spell?: string;
  /** Valget starter konsentrasjon på denne spellen. */
  startsConcentration?: string;
  /** Grunn når samme konsentrasjon alt er aktiv. */
  activeReason?: string;
  /** Valget krever at konsentrasjonen på denne spellen er aktiv. */
  requiresConcentration?: string;
  /** Valget vises bare med minst to Light-våpen. */
  requiresTwoLight?: boolean;
  /** Valget krever at målet for konsentrasjonen er nede (0 HP), hvis målet er en deltaker. */
  requiresTargetDown?: boolean;
  /** Bare en familiar (Find Familiar) kan bruke valget. */
  familiarOnly?: boolean;
  /** Bare familiaren i denne formen (`refId`) kan bruke valget, f.eks. Ink Cloud for Octopus. */
  familiarForm?: string;
  /** Grunn når ressursen er brukt opp. */
  emptyReason?: string;
}

/** Ekstra skade på et treff. */
export interface ExtraDamageDef {
  id: string;
  rule: string;
  label: string;
  count: number;
  sides: number;
  dmgType: string;
  /** Én gang per tur (Dreadful Strike). */
  oncePerTurn: boolean;
  /** Ressurs i `sheet.resources` (på navn) som brukes per treff. */
  resourceName?: string;
  /**
   * Krever at konsentrasjonen på denne spellen er aktiv (Hunter's Mark). Har konsentrasjonen et mål,
   * gjelder skaden bare mot det målet.
   */
  requiresConcentration?: string;
  /** Fargetone i UI-et: gull for Hunter's Mark, lilla for psychic. */
  tone: 'gold' | 'psychic' | 'none';
  emptyReason?: string;
}

export type RuleEffect =
  /** Attack-actionen gir `sheet.attacksPerAction` angrep. */
  | { kind: 'extraAttacks' }
  | { kind: 'extraDamage'; damage: ExtraDamageDef }
  /** Gjør terningen i en annen regels ekstra skade større (Stalker's Flurry, Foe Slayer). */
  | { kind: 'dieSize'; target: string; sides: number }
  /** Ekstra speed i din første tur i kampen (Ambusher's Leap). */
  | { kind: 'firstTurnSpeed'; feet: number }
  /** Speed som alt er regnet inn i arket (Roving). Bare til forklaring. */
  | { kind: 'speedInSheet'; feet: number }
  /** Advantage på angrep i mørke (Umbral Sight). */
  | { kind: 'advantageInDarkness'; label: string }
  | { kind: 'flag'; flag: RuleFlag }
  | { kind: 'option'; option: OptionDef }
  | { kind: 'mastery'; mastery: MasteryId; trigger: 'hit' | 'miss' | 'light' };

export type RuleSource = 'core' | 'class' | 'feat' | 'spell' | 'mastery';

export interface RuleDef {
  key: string;
  name: string;
  source: RuleSource;
  /** Navn i arket som slår regelen på. Tom liste og `always` betyr at den alltid gjelder. */
  names: string[];
  always?: boolean;
  /** Kort norsk forklaring. */
  text: string;
  effects: RuleEffect[];
  /** Tolkning eller husregel som er kodet her. */
  note?: string;
}

const HM = "Hunter's Mark";

function mastery(
  id: MasteryId,
  name: string,
  trigger: 'hit' | 'miss' | 'light',
  extra: RuleEffect[] = [],
): RuleDef {
  return {
    key: `mastery-${id}`,
    name,
    source: 'mastery',
    names: [name],
    text: MASTERY_TEXT[name] ?? '',
    effects: [{ kind: 'mastery', mastery: id, trigger }, ...extra],
  };
}

export const RULES: readonly RuleDef[] = [
  // ---------- Grunnregler ----------
  {
    key: 'opportunity-attack',
    name: 'Opportunity Attack',
    source: 'core',
    names: [],
    always: true,
    text: 'Når en fiende du ser går ut av rekkevidden din, kan du bruke reaction på ett nærkampangrep mot den.',
    effects: [
      {
        kind: 'option',
        option: {
          id: 'opportunity-attack',
          rule: 'opportunity-attack',
          name: 'Opportunity Attack',
          cost: 'reaction',
          attack: 'opportunity',
          text: 'Ett nærkampangrep når en fiende går ut av rekkevidden din.',
        },
      },
    ],
  },
  {
    key: 'light',
    name: 'Light',
    source: 'core',
    names: [],
    always: true,
    text: 'Etter et angrep med et Light-våpen i Attack-actionen kan du ta ett ekstra angrep med et annet Light-våpen som bonus action. Skaden får ikke evnemodifikatoren, med mindre den er negativ.',
    effects: [
      {
        kind: 'option',
        option: {
          id: 'light-attack',
          rule: 'light',
          name: 'Ekstra angrep (Light)',
          cost: 'bonus',
          attack: 'light',
          requiresTwoLight: true,
          text: 'Angrip med et annet Light-våpen. Ingen evnemodifikator på skaden.',
        },
      },
    ],
  },
  // ---------- Klasser ----------
  {
    key: 'extra-attack',
    name: 'Extra Attack',
    source: 'class',
    names: ['Extra Attack'],
    text: 'Attack-actionen gir to angrep. Du kan bevege deg mellom dem.',
    effects: [{ kind: 'extraAttacks' }],
  },
  {
    key: 'dread-ambusher',
    name: 'Dread Ambusher',
    source: 'class',
    names: ['Dread Ambusher'],
    text: "Dreadful Strike: én gang per tur gir et treff +2d6 psychic, WIS-mod ganger per Long Rest. Ambusher's Leap: +10 ft speed i din første tur i kampen. WIS-mod legges til initiative (regnet inn i arket).",
    note: "Ambusher's Leap gjelder din første tur i kampen (2024), som prototypen kalte runde 1.",
    effects: [
      {
        kind: 'extraDamage',
        damage: {
          id: 'dreadful-strike',
          rule: 'dread-ambusher',
          label: 'Dreadful Strike',
          count: 2,
          sides: 6,
          dmgType: 'psychic',
          oncePerTurn: true,
          resourceName: 'Dreadful Strike',
          tone: 'psychic',
          emptyReason: 'Ingen Dreadful Strike igjen før Long Rest.',
        },
      },
      { kind: 'firstTurnSpeed', feet: 10 },
    ],
  },
  {
    key: 'umbral-sight',
    name: 'Umbral Sight',
    source: 'class',
    names: ['Umbral Sight'],
    text: 'Darkvision +60 ft. I mørke er du usynlig for vesener som ser med darkvision, så du får advantage på angrep mot dem.',
    note: 'Appen gir advantage på alle angrep når «Mørke» er slått på, som prototypen. Fiender uten darkvision eller med truesight ser deg likevel. Sjekk med DM.',
    effects: [{ kind: 'advantageInDarkness', label: 'mørke (Umbral Sight)' }],
  },
  {
    key: 'stalkers-flurry',
    name: "Stalker's Flurry",
    source: 'class',
    names: ["Stalker's Flurry"],
    text: 'Dreadful Strike gjør 2d8 i stedet for 2d6.',
    effects: [{ kind: 'dieSize', target: 'dreadful-strike', sides: 8 }],
  },
  {
    key: 'foe-slayer',
    name: 'Foe Slayer',
    source: 'class',
    names: ['Foe Slayer'],
    text: "Hunter's Mark gjør 1d10 i stedet for 1d6.",
    effects: [{ kind: 'dieSize', target: 'hunters-mark', sides: 10 }],
  },
  {
    key: 'roving',
    name: 'Roving',
    source: 'class',
    names: ['Roving'],
    text: '+10 ft speed uten tung rustning (regnet inn i arket), og climb og swim speed lik speeden.',
    effects: [
      { kind: 'speedInSheet', feet: 10 },
      { kind: 'flag', flag: 'climb-swim' },
    ],
  },
  // ---------- Spells ----------
  {
    key: 'hunters-mark',
    name: HM,
    source: 'spell',
    names: [HM],
    text: 'Bonus action, konsentrasjon. Merk et mål: +1d6 force per treff på det. Faller målet til 0 HP, kan du flytte merket med en bonus action uten å bruke noe.',
    effects: [
      {
        kind: 'option',
        option: {
          id: 'cast-hunters-mark',
          rule: 'hunters-mark',
          name: HM,
          cost: 'bonus',
          spell: HM,
          startsConcentration: HM,
          activeReason: "Allerede aktiv. Bruk «Flytt Hunter's Mark» hvis målet døde.",
          emptyReason: 'Ingen gratis-kast eller spell slots igjen',
          text: 'Merk et mål: ekstra force-skade per treff. Konsentrasjon. Gratis-kast brukes først, så laveste ledige spell slot.',
        },
      },
      {
        kind: 'option',
        option: {
          id: 'move-hunters-mark',
          rule: 'hunters-mark',
          name: "Flytt Hunter's Mark",
          cost: 'bonus',
          requiresConcentration: HM,
          requiresTargetDown: true,
          text: 'Når det merkede målet faller til 0 HP. Koster ingen ressurser.',
        },
      },
      {
        kind: 'extraDamage',
        damage: {
          id: 'hunters-mark',
          rule: 'hunters-mark',
          label: HM,
          count: 1,
          sides: 6,
          dmgType: 'force',
          oncePerTurn: false,
          requiresConcentration: HM,
          tone: 'gold',
        },
      },
    ],
  },
  {
    key: 'find-familiar',
    name: 'Find Familiar',
    source: 'spell',
    names: ['Find Familiar'],
    text: '1 time med spell slot, eller 1 time og 10 minutter som ritual. Familiaren er egen deltaker med eget initiativ og egen tur. Den kan ikke angripe, men kan ta Help og levere touch-spells med sin reaction. På 0 HP forsvinner den til du kaster spellen igjen. Du kan se gjennom sansene dens som bonus action.',
    note: 'Familiaren og valgene dens står i `familiar.ts`. Karakteren får bare «Se gjennom familiaren».',
    effects: [
      {
        kind: 'option',
        option: {
          id: 'familiar-senses',
          rule: 'find-familiar',
          name: 'Se gjennom familiaren',
          cost: 'bonus',
          text: 'Til starten av din neste tur ser og hører du det familiaren ser og hører, med sansene dens (f.eks. Darkvision). Du beholder dine egne sanser (ingen blindhet i 2024).',
        },
      },
    ],
  },
  // ---------- Feats ----------
  {
    key: 'sharpshooter',
    name: 'Sharpshooter',
    source: 'feat',
    names: ['Sharpshooter'],
    text: 'Ranged-angrep får ikke disadvantage når en fiende står inntil deg eller på lang avstand, og du ignorerer half og three-quarters cover.',
    effects: [
      { kind: 'flag', flag: 'no-ranged-melee-disadvantage' },
      { kind: 'flag', flag: 'no-long-range-disadvantage' },
      { kind: 'flag', flag: 'ignore-cover' },
    ],
  },
  // ---------- Weapon Mastery (bare når masteryen er valgt for våpentypen) ----------
  mastery('slow', 'Slow', 'hit'),
  mastery('nick', 'Nick', 'light', [
    {
      kind: 'option',
      option: {
        id: 'nick-attack',
        rule: 'mastery-nick',
        name: 'Nick: ekstra angrep (del av Action)',
        cost: 'part',
        attack: 'nick',
        requiresTwoLight: true,
        text: 'Ekstra-angrepet fra Light, som del av Action. Bonus action er fortsatt ledig.',
      },
    },
  ]),
  mastery('vex', 'Vex', 'hit'),
  mastery('sap', 'Sap', 'hit'),
  mastery('topple', 'Topple', 'hit'),
  mastery('push', 'Push', 'hit'),
  mastery('graze', 'Graze', 'miss'),
  mastery('cleave', 'Cleave', 'hit', [
    {
      kind: 'option',
      option: {
        id: 'cleave-attack',
        rule: 'mastery-cleave',
        name: 'Cleave: angrip en til',
        cost: 'part',
        attack: 'cleave',
        text: 'Etter et nærkamptreff: angrip en annen fiende innen 5 ft av den første, med samme våpen. Ingen evnemodifikator på skaden. Én gang per tur.',
      },
    },
  ]),
];

const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]));

export function ruleDef(key: string): RuleDef | null {
  return RULE_BY_KEY.get(key) ?? null;
}

/** Navnene arket har: evner, feats, spells og valgte Weapon Mastery. Små bokstaver. */
function sheetNames(sheet: Sheet): Set<string> {
  const names = [
    ...sheet.features.map((f) => f.name),
    ...sheet.feats,
    ...sheet.spells.map((s) => s.name),
    ...sheet.weapons.map((w) => w.mastery ?? ''),
  ];
  return new Set(names.map((n) => norm(n).toLowerCase()).filter(Boolean));
}

/** Reglene som gjelder for arket. Dette er det eneste stedet evner slås opp på navn. */
export function activeRules(sheet: Sheet): RuleDef[] {
  const have = sheetNames(sheet);
  return RULES.filter((r) => r.always || r.names.some((n) => have.has(norm(n).toLowerCase())));
}

function effectsOf<K extends RuleEffect['kind']>(
  rules: readonly RuleDef[],
  kind: K,
): Extract<RuleEffect, { kind: K }>[] {
  return rules.flatMap((r) =>
    r.effects.filter((e): e is Extract<RuleEffect, { kind: K }> => e.kind === kind),
  );
}

/** Masteryen til et våpen som data, eller null. */
export function masteryOf(name: string | null | undefined): MasteryId | null {
  if (!name) return null;
  const rule = RULES.find((r) => r.source === 'mastery' && r.names.some((n) => n === norm(name)));
  const eff = rule?.effects.find((e) => e.kind === 'mastery');
  return eff?.kind === 'mastery' ? eff.mastery : null;
}

/** Flaggene fra reglene, f.eks. Sharpshooter. */
export function ruleFlags(sheet: Sheet): RuleFlag[] {
  return [...new Set(effectsOf(activeRules(sheet), 'flag').map((e) => e.flag))];
}

/** Ekstra speed i første tur i kampen (Ambusher's Leap). */
export function firstTurnSpeed(sheet: Sheet): number {
  return effectsOf(activeRules(sheet), 'firstTurnSpeed').reduce((s, e) => s + e.feet, 0);
}

/** Etikett for advantage i mørke, eller null hvis ingen regel gir det. */
export function darknessAdvantage(sheet: Sheet): string | null {
  return effectsOf(activeRules(sheet), 'advantageInDarkness')[0]?.label ?? null;
}

/** Ekstra skade arket har tilgang til, med større terninger fra andre evner. */
export function extraDamageOptions(sheet: Sheet): ExtraDamageDef[] {
  const rules = activeRules(sheet);
  const sizes = effectsOf(rules, 'dieSize');
  return effectsOf(rules, 'extraDamage').map(({ damage }) => {
    const up = sizes.filter((s) => s.target === damage.id).map((s) => s.sides);
    return { ...damage, sides: Math.max(damage.sides, ...up) };
  });
}

export interface TurnOptions {
  actions: readonly ActionDef[];
  bonus: OptionDef[];
  reactions: OptionDef[];
  /** Valg som er del av Action (Nick, Cleave). */
  part: OptionDef[];
  /** Spells med casting time Action. De bruker Magic-actionen. */
  magic: OptionDef[];
}

/** D&D Beyond `activation.activationType`: 1 = action, 3 = bonus action, 4 = reaction. */
const SPELL_TIME_COST: Partial<Record<number, Cost>> = { 1: 'action', 3: 'bonus', 4: 'reaction' };

function spellOption(s: Spell, cost: Cost): OptionDef {
  return {
    id: `spell:${slug(s.name)}`,
    rule: `spell:${slug(s.name)}`,
    name: s.name,
    cost,
    spell: s.name,
    ...(s.concentration ? { startsConcentration: s.name } : {}),
    emptyReason: 'Ingen gratis-kast eller spell slots igjen',
    text: s.level === 0 ? 'Cantrip.' : `Spell nivå ${s.level}${s.concentration ? ', konsentrasjon' : ''}.`,
  };
}

/**
 * Valgene i turen ut fra arket: actionkatalogen, bonus actions og reactions fra evner og spells.
 * Spells med casting time action, bonus action eller reaction som ikke har en egen regel, kommer med
 * som enkle valg. Spells med casting time action står i `magic` (Magic-actionen).
 */
export function turnOptions(sheet: Sheet): TurnOptions {
  const options = effectsOf(activeRules(sheet), 'option').map((e) => e.option);
  const light = sheet.weapons.filter((w) => w.light).length;
  const shown = options.filter((o) => !o.requiresTwoLight || light >= 2);
  const covered = new Set(options.map((o) => o.spell).filter(Boolean));
  for (const s of sheet.spells) {
    const cost = s.time == null ? undefined : SPELL_TIME_COST[s.time];
    if (cost && !covered.has(s.name)) shown.push(spellOption(s, cost));
  }
  return {
    actions: ACTIONS,
    bonus: shown.filter((o) => o.cost === 'bonus'),
    reactions: shown.filter((o) => o.cost === 'reaction'),
    part: shown.filter((o) => o.cost === 'part'),
    magic: shown.filter((o) => o.cost === 'action'),
  };
}

// ---------- Ressurser ----------

function resourceByName(sheet: Sheet, name: string) {
  return sheet.resources.find((r) => r.name === name) ?? null;
}

/** Hvor mange ganger det er igjen av en ressurs (på navn), eller null hvis arket ikke har den. */
export function resourceLeft(game: GameState, sheet: Sheet, name: string): number | null {
  const r = resourceByName(sheet, name);
  return r ? Math.max(0, r.max - (game.resources[r.key] ?? 0)) : null;
}

export type CastCost =
  | { kind: 'cantrip' }
  | { kind: 'free'; key: string; left: number }
  | { kind: 'slot'; slot: SlotKey; left: number };

function slotsFrom(game: GameState, sheet: Sheet, level: number): { slot: SlotKey; left: number }[] {
  const out: { slot: SlotKey; left: number }[] = [];
  for (let l = Math.max(1, level); l <= 9; l++) {
    const left = slotMax(sheet, l) - (game.slotsUsed[String(l)] ?? 0);
    if (left > 0) out.push({ slot: l, left });
  }
  const pact = sheet.pactSlots;
  if (pact && pact.level >= level) {
    const left = pact.count - (game.slotsUsed.pact ?? 0);
    if (left > 0) out.push({ slot: 'pact', left });
  }
  return out;
}

/**
 * Gratis-kast for en spell: fra spellen selv (`resourceKey`), eller fra en klasseevne med samme navn
 * (Ranger får Hunter's Mark som `actions`-ressurs i D&D Beyond, ikke på spellen).
 */
function freeCasts(game: GameState, sheet: Sheet, spell: Spell): { key: string; left: number } | null {
  const own = spell.resourceKey && spell.free > 0 ? { key: spell.resourceKey, max: spell.free } : null;
  const res = own ?? resourceByName(sheet, spell.name);
  return res ? { key: res.key, left: Math.max(0, res.max - (game.resources[res.key] ?? 0)) } : null;
}

/**
 * Hva det koster å kaste en spell nå: gratis-kast først, så laveste ledige spell slot
 * (Pact-slots sist). Null hvis det ikke går, eller spellen ikke finnes på arket.
 */
export function castCost(game: GameState, sheet: Sheet, spellName: string): CastCost | null {
  const spell = sheet.spells.find((s) => s.name === spellName);
  if (!spell) return null;
  if (spell.level === 0) return { kind: 'cantrip' };
  const free = freeCasts(game, sheet, spell);
  if (free && free.left > 0) return { kind: 'free', ...free };
  const slot = slotsFrom(game, sheet, spell.level)[0];
  return slot ? { kind: 'slot', ...slot } : null;
}

/** Hvor mange ganger spellen kan kastes nå (gratis-kast + slots), eller null for ubegrenset (cantrips). */
export function castsLeft(game: GameState, sheet: Sheet, spellName: string): number | null {
  const spell = sheet.spells.find((s) => s.name === spellName);
  if (!spell) return 0;
  if (spell.level === 0) return null;
  const free = freeCasts(game, sheet, spell)?.left ?? 0;
  return free + slotsFrom(game, sheet, spell.level).reduce((s, x) => s + x.left, 0);
}

/** Betaler for en spell (se `castCost`). Går det ikke, er tilstanden uendret og `cost` null. */
export function payCast(
  game: GameState,
  sheet: Sheet,
  spellName: string,
): { state: GameState; cost: CastCost | null } {
  const cost = castCost(game, sheet, spellName);
  if (!cost) return { state: game, cost: null };
  if (cost.kind === 'free') return { state: spendResource(game, sheet, cost.key), cost };
  if (cost.kind === 'slot') return { state: spendSlot(game, sheet, cost.slot), cost };
  return { state: game, cost };
}

/** Bruker ressursen til en ekstra skade (Dreadful Strike). Uten ressurs er tilstanden uendret. */
export function payExtraDamage(game: GameState, sheet: Sheet, damage: ExtraDamageDef): GameState {
  const r = damage.resourceName ? resourceByName(sheet, damage.resourceName) : null;
  return r ? spendResource(game, sheet, r.key) : game;
}

/**
 * Hva som er igjen, til `canDo`. Valg (`OptionDef.id`) og ekstra skade (`ExtraDamageDef.id`) har hvert
 * sitt kart, så de aldri blandes (Hunter's Mark finnes som begge). Det som ikke står i kartet, er
 * ubegrenset (cantrips, eller ekstra skade uten ressurs på arket). Tåler JSON.
 */
export interface ResourceContext {
  options: Record<string, number>;
  damage: Record<string, number>;
  /**
   * Valg der neste kast bruker en spell slot (ikke cantrip, og ingen gratis-kast igjen). Brukes til
   * regelen om én spell slot per tur. Mangler kartet, sjekkes ikke regelen.
   */
  slot?: Record<string, boolean>;
}

export function resourceContext(game: GameState, sheet: Sheet): ResourceContext {
  const slot: Record<string, boolean> = {};
  const out: ResourceContext = { options: {}, damage: {}, slot };
  const { bonus, reactions, part, magic } = turnOptions(sheet);
  for (const o of [...bonus, ...reactions, ...part, ...magic]) {
    if (!o.spell) continue;
    const n = castsLeft(game, sheet, o.spell);
    if (n != null) out.options[o.id] = n;
    if (castCost(game, sheet, o.spell)?.kind === 'slot') slot[o.id] = true;
  }
  for (const d of extraDamageOptions(sheet)) {
    const n = d.resourceName ? resourceLeft(game, sheet, d.resourceName) : null;
    if (n != null) out.damage[d.id] = n;
  }
  return out;
}

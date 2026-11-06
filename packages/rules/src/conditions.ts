// Conditions i 2024-reglene, med kort norsk forklaring og effekter som koden kan lese
// (UTVIKLINGSPLAN 7.2). Exhaustion har nivåer og ligger som tall i `GameState.exhaustion`.

export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
] as const;
export type ConditionId = (typeof CONDITIONS)[number];

/** Effekter som kamplogikken bruker. Alt annet står bare i teksten. */
export interface ConditionEffects {
  /** Ingen action, bonus action eller reaction. Konsentrasjonen brytes. */
  incapacitated?: boolean;
  speedZero?: boolean;
  /** Dine angrep har disadvantage. */
  attackDisadvantage?: boolean;
  /** Dine angrep har advantage. */
  attackAdvantage?: boolean;
  /** Angrep mot deg: `always` advantage, eller bare innen 5 ft (`within5`, Prone). */
  attackedAdvantage?: 'always' | 'within5';
  /** Angrep mot deg har disadvantage: `always`, eller bare fra mer enn 5 ft (`beyond5`, Prone). */
  attackedDisadvantage?: 'always' | 'beyond5';
  /** Treff fra innen 5 ft er kritiske. */
  critWithin5?: boolean;
  autoFailStrDexSaves?: boolean;
  checkDisadvantage?: boolean;
  /** Andre conditions som følger med. */
  implies?: ConditionId[];
}

export interface ConditionDef {
  id: ConditionId;
  name: string;
  /** Hva den betyr for deg, kort og på norsk. */
  text: string;
  effects: ConditionEffects;
}

export const CONDITION_DEFS: Readonly<Record<ConditionId, ConditionDef>> = {
  blinded: {
    id: 'blinded',
    name: 'Blinded',
    text: 'Du ser ingenting og klarer ikke sjekker som krever syn. Dine angrep har disadvantage, og angrep mot deg har advantage.',
    effects: { attackDisadvantage: true, attackedAdvantage: 'always' },
  },
  charmed: {
    id: 'charmed',
    name: 'Charmed',
    text: 'Du kan ikke angripe eller skade den som charmet deg. Den har advantage på sosiale sjekker mot deg.',
    effects: {},
  },
  deafened: {
    id: 'deafened',
    name: 'Deafened',
    text: 'Du hører ingenting og klarer ikke sjekker som krever hørsel.',
    effects: {},
  },
  exhaustion: {
    id: 'exhaustion',
    name: 'Exhaustion',
    text: 'Har nivåer. Hvert nivå gir −2 på alle d20-kast og −5 ft speed. På nivå 6 dør du. Long Rest tar bort ett nivå.',
    effects: {},
  },
  frightened: {
    id: 'frightened',
    name: 'Frightened',
    text: 'Disadvantage på angrep og ability checks mens du ser det du er redd. Du kan ikke gå nærmere det.',
    effects: { attackDisadvantage: true, checkDisadvantage: true },
  },
  grappled: {
    id: 'grappled',
    name: 'Grappled',
    text: 'Speed 0. Disadvantage på angrep mot andre enn den som holder deg. Den kan dra deg med seg.',
    effects: { speedZero: true },
  },
  incapacitated: {
    id: 'incapacitated',
    name: 'Incapacitated',
    text: 'Du kan ikke ta action, bonus action eller reaction, og mister konsentrasjonen. Du kan ikke snakke.',
    effects: { incapacitated: true },
  },
  invisible: {
    id: 'invisible',
    name: 'Invisible',
    text: 'Ingen ser deg. Dine angrep har advantage, og angrep mot deg har disadvantage, med mindre de kan se deg likevel.',
    effects: { attackAdvantage: true, attackedDisadvantage: 'always' },
  },
  paralyzed: {
    id: 'paralyzed',
    name: 'Paralyzed',
    text: 'Incapacitated og speed 0. Du klarer ikke STR og DEX saves. Angrep mot deg har advantage, og treff fra innen 5 ft er kritiske.',
    effects: {
      incapacitated: true,
      speedZero: true,
      autoFailStrDexSaves: true,
      attackedAdvantage: 'always',
      critWithin5: true,
      implies: ['incapacitated'],
    },
  },
  petrified: {
    id: 'petrified',
    name: 'Petrified',
    text: 'Du er blitt til stein: incapacitated, speed 0, klarer ikke STR og DEX saves, angrep mot deg har advantage, og du har resistance mot all skade.',
    effects: {
      incapacitated: true,
      speedZero: true,
      autoFailStrDexSaves: true,
      attackedAdvantage: 'always',
      implies: ['incapacitated'],
    },
  },
  poisoned: {
    id: 'poisoned',
    name: 'Poisoned',
    text: 'Disadvantage på angrep og ability checks.',
    effects: { attackDisadvantage: true, checkDisadvantage: true },
  },
  prone: {
    id: 'prone',
    name: 'Prone',
    text: 'Du ligger. Å reise seg koster halve speed. Dine angrep har disadvantage. Angrep mot deg har advantage innen 5 ft og disadvantage lenger unna.',
    effects: { attackDisadvantage: true, attackedAdvantage: 'within5', attackedDisadvantage: 'beyond5' },
  },
  restrained: {
    id: 'restrained',
    name: 'Restrained',
    text: 'Speed 0. Dine angrep har disadvantage, angrep mot deg har advantage, og du har disadvantage på DEX saves.',
    effects: { speedZero: true, attackDisadvantage: true, attackedAdvantage: 'always' },
  },
  stunned: {
    id: 'stunned',
    name: 'Stunned',
    text: 'Incapacitated. Du klarer ikke STR og DEX saves, og angrep mot deg har advantage.',
    effects: {
      incapacitated: true,
      autoFailStrDexSaves: true,
      attackedAdvantage: 'always',
      implies: ['incapacitated'],
    },
  },
  unconscious: {
    id: 'unconscious',
    name: 'Unconscious',
    text: 'Du er bevisstløs: incapacitated og Prone, speed 0, klarer ikke STR og DEX saves. Angrep mot deg har advantage, og treff fra innen 5 ft er kritiske.',
    effects: {
      incapacitated: true,
      speedZero: true,
      autoFailStrDexSaves: true,
      attackedAdvantage: 'always',
      critWithin5: true,
      implies: ['incapacitated', 'prone'],
    },
  },
};

export function isConditionId(s: unknown): s is ConditionId {
  return typeof s === 'string' && (CONDITIONS as readonly string[]).includes(s);
}

/** Alle conditions, med dem som følger med (Unconscious → Incapacitated og Prone). Ukjente ignoreres. */
export function expandConditions(ids: readonly string[]): ConditionId[] {
  const out = new Set<ConditionId>();
  for (const id of ids) {
    if (!isConditionId(id)) continue;
    out.add(id);
    for (const i of CONDITION_DEFS[id].effects.implies ?? []) out.add(i);
  }
  return CONDITIONS.filter((c) => out.has(c));
}

/** Første condition (med det som følger med) som har en gitt effekt, eller null. */
export function conditionWith(
  ids: readonly string[],
  effect: keyof Omit<ConditionEffects, 'implies'>,
): ConditionId | null {
  return expandConditions(ids).find((c) => CONDITION_DEFS[c].effects[effect]) ?? null;
}

/** Exhaustion (2024): −2 per nivå på alle d20-kast, −5 ft speed per nivå, død på nivå 6. */
export function exhaustionPenalty(level: number): { d20: number; speed: number; dead: boolean } {
  const l = Math.max(0, Math.min(6, Math.trunc(Number.isFinite(level) ? level : 0)));
  return { d20: l === 0 ? 0 : -2 * l, speed: l === 0 ? 0 : -5 * l, dead: l >= 6 };
}

// Find Familiar (2024, SRD 5.2.1): formene som data, tilstanden i `GameState.familiar` og rene funksjoner
// for å kalle den fram, bytte form, skade og helbrede. En familiar er ikke en vanlig følgesvenn:
// - Den kan ikke angripe, men kan ta andre actions. Den ruller eget initiativ og har egen tur.
// - På 0 HP forsvinner den (ingen death saves). Den kommer tilbake når spellen kastes igjen.
// - Den kan levere en spell med range Touch med sin reaction, innen 100 ft av deg.
import type { ActionDef, ActionId } from './actions.ts';
import { ACTIONS } from './actions.ts';
import { payCast, type CastCost, type OptionDef } from './features.ts';
import type { GameState } from './import.ts';
import type { Sheet } from './sheet.ts';
import { modOf } from './util.ts';

/** De elleve formene som står i spellen først, så andre dyr med CR 0 fra SRD (`group: 'other'`). */
export const FAMILIAR_FORM_IDS = [
  'owl',
  'cat',
  'bat',
  'raven',
  'hawk',
  'rat',
  'spider',
  'frog',
  'lizard',
  'weasel',
  'octopus',
  'eagle',
  'jackal',
  'badger',
  'crab',
  'baboon',
  'deer',
] as const;
export type FamiliarFormId = (typeof FAMILIAR_FORM_IDS)[number];

export const FAMILIAR_CREATURE_TYPES = ['celestial', 'fey', 'fiend'] as const;
export type FamiliarCreatureType = (typeof FAMILIAR_CREATURE_TYPES)[number];
export const CREATURE_TYPE_NAME: Readonly<Record<FamiliarCreatureType, string>> = {
  celestial: 'Celestial',
  fey: 'Fey',
  fiend: 'Fiend',
};
/** Brukes når tilstanden ikke har valgt skapningstype (eldre tilstand). */
export const DEFAULT_CREATURE_TYPE: FamiliarCreatureType = 'fey';

export interface FamiliarSpeeds {
  walk: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
}

export type FamiliarSkill = 'Acrobatics' | 'Perception' | 'Stealth';

export interface FamiliarForm {
  id: FamiliarFormId;
  name: string;
  /** `spell`: står i Find Familiar. `other`: annet dyr med CR 0, bør avtales med DM. */
  group: 'spell' | 'other';
  size: 'Tiny' | 'Small' | 'Medium';
  ac: number;
  hp: number;
  speed: FamiliarSpeeds;
  dex: number;
  /** Initiativbonus = DEX-mod (statblokkene har ingen annen bonus). */
  initiative: number;
  /** Skills med bonus, f.eks. `{ Perception: 5 }`. */
  skills: Partial<Record<FamiliarSkill, number>>;
  passivePerception: number;
  senses: string[];
  /** Trekk med kort norsk forklaring. Trekk som bare gjelder angrep er utelatt. */
  traits: { name: string; text: string }[];
  /** Kort norsk forklaring av hva formen er god til. */
  text: string;
}

function form(f: Omit<FamiliarForm, 'initiative'>): FamiliarForm {
  return { ...f, initiative: modOf(f.dex) };
}

const SPIDER_CLIMB = {
  name: 'Spider Climb',
  text: 'Klatrer på vegger og i taket uten å slå terning.',
};
const AMPHIBIOUS = { name: 'Amphibious', text: 'Puster både i luft og vann.' };
const AGILE = {
  name: 'Agile',
  text: 'Utløser ikke opportunity attack når den går ut av rekkevidden til en fiende.',
};

/** Formene i Find Familiar (2024). Statblokkene er sjekket mot SRD 5.2.1 («Animals»). */
export const FAMILIAR_FORMS: Readonly<Record<FamiliarFormId, FamiliarForm>> = {
  owl: form({
    id: 'owl',
    name: 'Owl',
    group: 'spell',
    size: 'Tiny',
    ac: 11,
    hp: 1,
    speed: { walk: 5, fly: 60 },
    dex: 13,
    skills: { Perception: 5, Stealth: 5 },
    passivePerception: 15,
    senses: ['Darkvision 120 ft'],
    traits: [
      {
        name: 'Flyby',
        text: 'Utløser ikke opportunity attack når den flyr ut av rekkevidden til en fiende.',
      },
    ],
    text: 'Den beste allround-formen. Ser lengst i mørket, er stille, og flyr inn med Help og ut igjen uten å bli angrepet.',
  }),
  cat: form({
    id: 'cat',
    name: 'Cat',
    group: 'spell',
    size: 'Tiny',
    ac: 12,
    hp: 2,
    speed: { walk: 40, climb: 40 },
    dex: 15,
    skills: { Perception: 3, Stealth: 4 },
    passivePerception: 13,
    senses: ['Darkvision 60 ft'],
    traits: [{ name: 'Jumper', text: 'Hopper like langt som om Dexterity var Strength.' }],
    text: 'Rask på bakken, klatrer godt og vekker ikke oppsikt i byer.',
  }),
  bat: form({
    id: 'bat',
    name: 'Bat',
    group: 'spell',
    size: 'Tiny',
    ac: 12,
    hp: 1,
    speed: { walk: 5, fly: 30 },
    dex: 15,
    skills: {},
    passivePerception: 11,
    senses: ['Blindsight 60 ft'],
    traits: [],
    text: 'Grotter og magisk mørke. Blindsight virker også der Darkvision ikke gjør det.',
  }),
  raven: form({
    id: 'raven',
    name: 'Raven',
    group: 'spell',
    size: 'Tiny',
    ac: 12,
    hp: 2,
    speed: { walk: 10, fly: 50 },
    dex: 14,
    skills: { Perception: 3 },
    passivePerception: 13,
    senses: [],
    traits: [
      {
        name: 'Mimicry',
        text: 'Herme etter enkle lyder den har hørt, som en hvisking. DC 10 Insight avslører det.',
      },
    ],
    text: 'Bære beskjeder og lure fiender med lyder. Tåler ett slag mer enn ugla.',
  }),
  hawk: form({
    id: 'hawk',
    name: 'Hawk',
    group: 'spell',
    size: 'Tiny',
    ac: 13,
    hp: 1,
    speed: { walk: 10, fly: 60 },
    dex: 16,
    skills: { Perception: 6 },
    passivePerception: 16,
    senses: [],
    traits: [],
    text: 'Best til å følge med i dagslys og høyest Armor Class av fuglene. Ser ikke i mørket.',
  }),
  rat: form({
    id: 'rat',
    name: 'Rat',
    group: 'spell',
    size: 'Tiny',
    ac: 10,
    hp: 1,
    speed: { walk: 20, climb: 20 },
    dex: 11,
    skills: { Perception: 2 },
    passivePerception: 12,
    senses: ['Darkvision 30 ft'],
    traits: [AGILE],
    text: 'Kloakker og byer. Kan gå fra en fiende uten å bli angrepet.',
  }),
  spider: form({
    id: 'spider',
    name: 'Spider',
    group: 'spell',
    size: 'Tiny',
    ac: 12,
    hp: 1,
    speed: { walk: 20, climb: 20 },
    dex: 14,
    skills: { Stealth: 4 },
    passivePerception: 10,
    senses: ['Darkvision 30 ft'],
    traits: [
      SPIDER_CLIMB,
      {
        name: 'Web Walker',
        text: 'Hindres ikke av spindelvev, og vet hvor alle som rører det samme vevet er.',
      },
    ],
    text: 'Går i taket og venter skjult. Merker alt som rører spindelvevet.',
  }),
  frog: form({
    id: 'frog',
    name: 'Frog',
    group: 'spell',
    size: 'Tiny',
    ac: 11,
    hp: 1,
    speed: { walk: 20, swim: 20 },
    dex: 13,
    skills: { Perception: 1, Stealth: 3 },
    passivePerception: 11,
    senses: ['Darkvision 30 ft'],
    traits: [
      AMPHIBIOUS,
      { name: 'Standing Leap', text: 'Hopper 10 ft langt og 5 ft høyt, med eller uten tilløp.' },
    ],
    text: 'Både land og vann.',
  }),
  lizard: form({
    id: 'lizard',
    name: 'Lizard',
    group: 'spell',
    size: 'Tiny',
    ac: 10,
    hp: 2,
    speed: { walk: 20, climb: 20 },
    dex: 11,
    skills: {},
    passivePerception: 9,
    senses: ['Darkvision 30 ft'],
    traits: [SPIDER_CLIMB],
    text: 'Går i taket. Ellers svak.',
  }),
  weasel: form({
    id: 'weasel',
    name: 'Weasel',
    group: 'spell',
    size: 'Tiny',
    ac: 13,
    hp: 1,
    speed: { walk: 30, climb: 30 },
    dex: 16,
    skills: { Acrobatics: 5, Perception: 3, Stealth: 5 },
    passivePerception: 13,
    senses: ['Darkvision 60 ft'],
    traits: [],
    text: 'Sniker seg inn og er vanskelig å treffe.',
  }),
  octopus: form({
    id: 'octopus',
    name: 'Octopus',
    group: 'spell',
    size: 'Small',
    ac: 12,
    hp: 3,
    speed: { walk: 5, swim: 30 },
    dex: 15,
    skills: { Perception: 2, Stealth: 6 },
    passivePerception: 12,
    senses: ['Darkvision 30 ft'],
    traits: [
      {
        name: 'Compression',
        text: 'Kommer seg gjennom en åpning på 1 tomme uten ekstra bevegelse.',
      },
      { name: 'Water Breathing', text: 'Puster bare under vann.' },
      {
        name: 'Ink Cloud',
        text: 'Reaction, én gang per dag, under vann: når en skapning avslutter turen innen 5 ft, fyller blekk en kube på 5 ft (Heavily Obscured i 1 minutt), og den svømmer unna.',
      },
    ],
    text: 'Bare under vann. Kommer gjennom små åpninger og kan sprute blekk og svømme unna.',
  }),
  eagle: form({
    id: 'eagle',
    name: 'Eagle',
    group: 'other',
    size: 'Small',
    ac: 12,
    hp: 4,
    speed: { walk: 10, fly: 60 },
    dex: 15,
    skills: { Perception: 6 },
    passivePerception: 16,
    senses: [],
    traits: [],
    text: 'Som Hawk, men med 4 HP. Den sterkeste flygeren. Ser ikke i mørket.',
  }),
  jackal: form({
    id: 'jackal',
    name: 'Jackal',
    group: 'other',
    size: 'Small',
    ac: 12,
    hp: 3,
    speed: { walk: 40 },
    dex: 15,
    skills: { Perception: 5, Stealth: 4 },
    passivePerception: 15,
    senses: ['Darkvision 90 ft'],
    traits: [],
    text: 'Speider på bakken og ser nesten like godt i mørket som ugla.',
  }),
  badger: form({
    id: 'badger',
    name: 'Badger',
    group: 'other',
    size: 'Tiny',
    ac: 11,
    hp: 5,
    speed: { walk: 20, burrow: 5 },
    dex: 11,
    skills: { Perception: 3 },
    passivePerception: 13,
    senses: ['Darkvision 30 ft'],
    traits: [{ name: 'Poison Resistance', text: 'Tar halv skade av gift.' }],
    text: 'Tåler mest av alle formene.',
  }),
  crab: form({
    id: 'crab',
    name: 'Crab',
    group: 'other',
    size: 'Tiny',
    ac: 11,
    hp: 3,
    speed: { walk: 20, swim: 20 },
    dex: 11,
    skills: { Stealth: 2 },
    passivePerception: 9,
    senses: ['Blindsight 30 ft'],
    traits: [AMPHIBIOUS],
    text: 'Både land og vann, og merker ting rundt seg uten å se.',
  }),
  baboon: form({
    id: 'baboon',
    name: 'Baboon',
    group: 'other',
    size: 'Small',
    ac: 12,
    hp: 3,
    speed: { walk: 30, climb: 30 },
    dex: 14,
    skills: {},
    passivePerception: 11,
    senses: [],
    traits: [],
    text: 'Klatrer godt og tåler litt mer enn de små formene.',
  }),
  deer: form({
    id: 'deer',
    name: 'Deer',
    group: 'other',
    size: 'Medium',
    ac: 13,
    hp: 4,
    speed: { walk: 50 },
    dex: 16,
    skills: { Perception: 4 },
    passivePerception: 14,
    senses: ['Darkvision 60 ft'],
    traits: [AGILE],
    text: 'Raskest på bakken, men for stor til å være diskret.',
  }),
};

export function isFamiliarForm(s: unknown): s is FamiliarFormId {
  return typeof s === 'string' && (FAMILIAR_FORM_IDS as readonly string[]).includes(s);
}

const SPEED_NAME: Readonly<Record<keyof FamiliarSpeeds, string>> = {
  walk: 'gange',
  fly: 'flyging',
  swim: 'svømming',
  climb: 'klatring',
  burrow: 'graving',
};

/** Alle bevegelsestypene, raskest først: «flyging 60 ft, gange 5 ft». */
export function familiarSpeedText(f: Pick<FamiliarForm, 'speed'>): string {
  return (Object.entries(f.speed) as [keyof FamiliarSpeeds, number | undefined][])
    .filter((e): e is [keyof FamiliarSpeeds, number] => e[1] != null)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${SPEED_NAME[k]} ${v} ft`)
    .join(', ');
}

/** Den raskeste bevegelsen formen har, til grensen i kampen. */
export function familiarMaxSpeed(f: Pick<FamiliarForm, 'speed'>): number {
  const s = f.speed;
  return Math.max(s.walk, s.fly ?? 0, s.swim ?? 0, s.climb ?? 0, s.burrow ?? 0);
}

/** Regler for Find Familiar (2024) som data. */
export const FIND_FAMILIAR = {
  spell: 'Find Familiar',
  level: 1,
  castingTime: '1 time med spell slot, eller 1 time og 10 minutter som ritual uten slot',
  cost: 'Røkelse for minst 10 GP (gullmynter), som brennes opp',
  /** Telepatisk kontakt og levering av touch-spells innen denne avstanden. */
  rangeFt: 100,
  /** Hentes tilbake fra lomme-dimensjonen innen denne avstanden. */
  returnFt: 30,
  canAttack: false,
  creatureTypes: ['Celestial', 'Fey', 'Fiend'],
  text: 'Familiaren er en alliert med eget initiativ og egen tur. Den kan ikke angripe, men kan ta andre actions, f.eks. Help. På 0 HP forsvinner den til du kaster spellen igjen. Kaster du spellen mens du har en familiar, bytter den form.',
  dismissText:
    'Magic action: send den til en lomme-dimensjon. Ny Magic action: den kommer tilbake innen 30 ft av deg. Det den bærer, blir liggende igjen.',
} as const;

/** Grunnen når en familiar prøver å angripe. */
export const FAMILIAR_NO_ATTACK = 'En familiar kan ikke angripe (Find Familiar)';

/** Reaction: familiaren leverer en spell med range Touch for deg. */
export const DELIVER_TOUCH: OptionDef = {
  id: 'deliver-touch-spell',
  rule: 'find-familiar',
  name: 'Lever touch-spell',
  cost: 'reaction',
  familiarOnly: true,
  text: 'Når du kaster en spell med range Touch, kan familiaren levere den med sin reaction. Den må være innen 100 ft av deg.',
};

/** Reaction for Octopus. Appen holder ikke rede på «én gang per dag». */
export const INK_CLOUD: OptionDef = {
  id: 'ink-cloud',
  rule: 'find-familiar',
  name: 'Ink Cloud',
  cost: 'reaction',
  familiarOnly: true,
  familiarForm: 'octopus',
  text: 'Én gang per dag, under vann: når en skapning avslutter turen innen 5 ft, fyller blekk en kube på 5 ft (Heavily Obscured i 1 minutt), og familiaren svømmer unna.',
};

/**
 * Familiarens valg i turen: alle actions unntatt Attack, med Help øverst som anbefalt, og reaction-valgene.
 * Med form tas bare reactions formen har (Ink Cloud for Octopus).
 */
export function familiarTurnOptions(formId?: FamiliarFormId): {
  actions: { action: ActionDef; recommended: boolean }[];
  reactions: OptionDef[];
} {
  const recommended: ActionId = 'help';
  return {
    actions: ACTIONS.filter((a) => a.id !== 'attack')
      .map((a) => ({ action: a, recommended: a.id === recommended }))
      .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    reactions: [DELIVER_TOUCH, ...(formId === 'octopus' ? [INK_CLOUD] : [])],
  };
}

/** Trekk som er verdt å huske på i turen, fordi de gjelder bevegelse (Flyby, Agile). */
const REMINDER_TRAITS = new Set(['Flyby', 'Agile']);

/** Påminnelser til familiarens tur, f.eks. Flyby for Owl. Tom liste for former uten slike trekk. */
export function familiarReminders(formId: FamiliarFormId): { name: string; text: string }[] {
  return FAMILIAR_FORMS[formId].traits.filter((t) => REMINDER_TRAITS.has(t.name));
}

/**
 * Teksten på «Se gjennom familiaren» (bonus action for karakteren), med sansene til formen:
 * «Til starten av din neste tur ser og hører du gjennom Ugla, med Darkvision 120 ft.»
 */
export function familiarSensesText(f: Pick<FamiliarState, 'form' | 'name'>): string {
  const senses = FAMILIAR_FORMS[f.form].senses;
  const withSenses = senses.length > 0 ? `, med ${senses.join(' og ')}` : '';
  return `Til starten av din neste tur ser og hører du gjennom ${f.name}${withSenses}. Du beholder dine egne sanser.`;
}

// ---------- Tilstand i GameState ----------

/** `GameState.familiar`. Mangler feltet, har spillet ingen familiar. */
export interface FamiliarState {
  form: FamiliarFormId;
  name: string;
  hpRemoved: number;
  /** Til stede. Blir false på 0 HP eller når den sendes bort. */
  present: boolean;
  /** Celestial, Fey eller Fiend, valgt ved kastet. Mangler i eldre tilstand (da gjelder Fey). */
  creatureType?: FamiliarCreatureType;
}

/** `present`: til stede. `dismissed`: sendt til lomme-dimensjonen. `gone`: forsvant på 0 HP. */
export type FamiliarStatus = 'present' | 'dismissed' | 'gone';

export function familiarStatus(f: FamiliarState): FamiliarStatus {
  if (f.present) return 'present';
  return f.hpRemoved >= familiarHpMax(f) ? 'gone' : 'dismissed';
}

export function familiarCreatureType(f: FamiliarState): FamiliarCreatureType {
  return f.creatureType ?? DEFAULT_CREATURE_TYPE;
}

function amount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

export function familiarHpMax(f: Pick<FamiliarState, 'form'>): number {
  return FAMILIAR_FORMS[f.form].hp;
}

/** Nåværende HP, 0 når den ikke er til stede. */
export function familiarHp(f: FamiliarState | undefined): number {
  if (!f || !f.present) return 0;
  return Math.max(0, familiarHpMax(f) - f.hpRemoved);
}

export interface SummonInput {
  form: FamiliarFormId;
  name?: string;
  creatureType?: FamiliarCreatureType;
}

/**
 * Familiaren kommer fram med full HP (selve kastet, uten betaling). Har du en fra før, kan du bytte
 * form, navn og skapningstype. Uten navn eller type beholdes det gamle, ellers formens navn og Fey.
 */
export function summonFamiliar(state: GameState, input: SummonInput): GameState {
  const prev = state.familiar;
  const name = input.name?.trim() || prev?.name || FAMILIAR_FORMS[input.form].name;
  const creatureType = input.creatureType ?? prev?.creatureType ?? DEFAULT_CREATURE_TYPE;
  return { ...state, familiar: { form: input.form, name, hpRemoved: 0, present: true, creatureType } };
}

export type FindFamiliarCost = CastCost | { kind: 'ritual' };

/**
 * Kaster Find Familiar. Som ritual koster det ingenting i appen. Uten ritual betales det som andre
 * spells: gratis-kast først, så laveste ledige spell slot. Går det ikke, er tilstanden uendret og
 * `cost` null. Røkelsen for 10 GP trekkes ikke (materialer koster ikke i denne gruppa).
 */
export function castFindFamiliar(
  state: GameState,
  sheet: Sheet,
  input: SummonInput & { ritual: boolean },
): { state: GameState; cost: FindFamiliarCost | null } {
  const { ritual, ...summon } = input;
  if (ritual) return { state: summonFamiliar(state, summon), cost: { kind: 'ritual' } };
  const paid = payCast(state, sheet, FIND_FAMILIAR.spell);
  if (!paid.cost) return { state, cost: null };
  return { state: summonFamiliar(paid.state, summon), cost: paid.cost };
}

/** Bytter form ved å kaste spellen på nytt (full HP). Uten familiar er tilstanden uendret. */
export function changeFamiliarForm(state: GameState, form: FamiliarFormId): GameState {
  return state.familiar ? summonFamiliar(state, { form }) : state;
}

/** Endrer navn eller skapningstype uten nytt kast. Tomt navn ignoreres. */
export function updateFamiliar(
  state: GameState,
  patch: { name?: string; creatureType?: FamiliarCreatureType },
): GameState {
  const f = state.familiar;
  if (!f) return state;
  const name = patch.name?.trim() || f.name;
  return {
    ...state,
    familiar: { ...f, name, ...(patch.creatureType ? { creatureType: patch.creatureType } : {}) },
  };
}

/** Fjerner familiaren for godt. */
export function dismissFamiliarForever(state: GameState): GameState {
  if (!state.familiar) return state;
  const next = { ...state };
  delete next.familiar;
  return next;
}

/**
 * Sender familiaren til lomme-dimensjonen (`false`) eller henter den tilbake (`true`), uten å endre HP.
 * Begge er en Magic action. En familiar som forsvant på 0 HP kan ikke hentes, bare kalles fram på nytt.
 */
export function setFamiliarPresent(state: GameState, present: boolean): GameState {
  const f = state.familiar;
  if (!f || (present && familiarStatus(f) === 'gone')) return state;
  return { ...state, familiar: { ...f, present } };
}

/** Skade på familiaren. På 0 HP forsvinner den (`present` false, `vanished` true). Ingen death saves. */
export function damageFamiliar(state: GameState, n: number): { state: GameState; vanished: boolean } {
  const f = state.familiar;
  if (!f || !f.present || amount(n) === 0) return { state, vanished: false };
  const max = familiarHpMax(f);
  const hpRemoved = Math.min(max, f.hpRemoved + amount(n));
  const vanished = hpRemoved >= max;
  return { state: { ...state, familiar: { ...f, hpRemoved, present: !vanished } }, vanished };
}

/** Helbreder familiaren, bare når den er til stede. */
export function healFamiliar(state: GameState, n: number): GameState {
  const f = state.familiar;
  if (!f || !f.present) return state;
  return { ...state, familiar: { ...f, hpRemoved: Math.max(0, f.hpRemoved - amount(n)) } };
}

// Find Familiar (2024, SRD 5.2): formene som data, tilstanden i `GameState.familiar` og rene funksjoner
// for å kalle den fram, bytte form, skade og helbrede. En familiar er ikke en vanlig følgesvenn:
// - Den kan ikke angripe, men kan ta andre actions. Den ruller eget initiativ og har egen tur.
// - På 0 HP forsvinner den (ingen death saves). Den kommer tilbake når spellen kastes igjen.
// - Den kan levere en spell med range Touch med sin reaction, innen 100 ft av deg.
import type { ActionDef, ActionId } from './actions.ts';
import { ACTIONS } from './actions.ts';
import type { OptionDef } from './features.ts';
import type { GameState } from './import.ts';
import { modOf } from './util.ts';

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
] as const;
export type FamiliarFormId = (typeof FAMILIAR_FORM_IDS)[number];

export interface FamiliarSpeeds {
  walk: number;
  fly?: number;
  swim?: number;
  climb?: number;
}

export interface FamiliarForm {
  id: FamiliarFormId;
  name: string;
  ac: number;
  hp: number;
  speed: FamiliarSpeeds;
  dex: number;
  /** Initiativbonus = DEX-mod (statblokkene har ingen annen bonus). */
  initiative: number;
  /** Skills med bonus, f.eks. `{ Perception: 5 }`. */
  skills: Partial<Record<'Perception' | 'Stealth', number>>;
  senses: string[];
  /** Trekk med kort norsk forklaring. */
  traits: { name: string; text: string }[];
  /** Kort norsk forklaring av hva formen er god til. */
  text: string;
  /** Tall eller trekk som bør sjekkes mot 2024 Monster Manual. */
  uncertain?: string;
}

function form(f: Omit<FamiliarForm, 'initiative'>): FamiliarForm {
  return { ...f, initiative: modOf(f.dex) };
}

/** Formene i Find Familiar (2024). Statblokkene fra SRD 5.2 / Monster Manual 2024. */
export const FAMILIAR_FORMS: Readonly<Record<FamiliarFormId, FamiliarForm>> = {
  owl: form({
    id: 'owl',
    name: 'Owl',
    ac: 11,
    hp: 1,
    speed: { walk: 5, fly: 60 },
    dex: 13,
    skills: { Perception: 5, Stealth: 5 },
    senses: ['Darkvision 120 ft'],
    traits: [
      {
        name: 'Flyby',
        text: 'Utløser ikke opportunity attack når den flyr ut av rekkevidden til en fiende.',
      },
    ],
    text: 'Speider i mørket og flyr inn med Help uten å bli angrepet.',
    uncertain: 'Keen Hearing and Sight fra 2014 ser ut til å være borte i 2024 (Perception +5 i stedet).',
  }),
  cat: form({
    id: 'cat',
    name: 'Cat',
    ac: 12,
    hp: 2,
    speed: { walk: 40, climb: 40 },
    dex: 15,
    skills: { Perception: 3, Stealth: 4 },
    senses: ['Darkvision 60 ft'],
    traits: [{ name: 'Jumper', text: 'Hopper like langt som om DEX var STR.' }],
    text: 'Rask og stille, klatrer godt.',
  }),
  bat: form({
    id: 'bat',
    name: 'Bat',
    ac: 12,
    hp: 1,
    speed: { walk: 5, fly: 30 },
    dex: 15,
    skills: {},
    senses: ['Blindsight 60 ft'],
    traits: [],
    text: 'Finner veien uten lys med blindsight.',
    uncertain: 'Echolocation og Keen Hearing fra 2014 er ikke tatt med.',
  }),
  raven: form({
    id: 'raven',
    name: 'Raven',
    ac: 12,
    hp: 2,
    speed: { walk: 10, fly: 50 },
    dex: 14,
    skills: { Perception: 3 },
    senses: [],
    traits: [{ name: 'Mimicry', text: 'Kan herme etter enkle lyder og ord den har hørt.' }],
    text: 'Flyr fort og kan herme etter stemmer.',
  }),
  hawk: form({
    id: 'hawk',
    name: 'Hawk',
    ac: 13,
    hp: 1,
    speed: { walk: 10, fly: 60 },
    dex: 16,
    skills: { Perception: 6 },
    senses: [],
    traits: [],
    text: 'Best Perception og høyest AC blant de flygende.',
    uncertain: 'Keen Sight fra 2014 er ikke tatt med.',
  }),
  rat: form({
    id: 'rat',
    name: 'Rat',
    ac: 10,
    hp: 1,
    speed: { walk: 20, climb: 20 },
    dex: 11,
    skills: { Perception: 2 },
    senses: ['Darkvision 30 ft'],
    traits: [],
    text: 'Liten og lite påfallende i byer og kloakker.',
    uncertain:
      'Climb 20 ft og Perception +2 er fra 2024-blokken etter beste kunnskap. 2014: Keen Smell, ingen climb.',
  }),
  spider: form({
    id: 'spider',
    name: 'Spider',
    ac: 12,
    hp: 1,
    speed: { walk: 20, climb: 20 },
    dex: 14,
    skills: { Stealth: 4 },
    senses: ['Darkvision 30 ft'],
    traits: [
      { name: 'Spider Climb', text: 'Klatrer på vegger og i taket uten sjekk.' },
      { name: 'Web Walker', text: 'Hindres ikke av spindelvev.' },
    ],
    text: 'Kommer seg inn overalt og klatrer i taket.',
    uncertain: 'Web Sense fra 2014 er ikke tatt med.',
  }),
  frog: form({
    id: 'frog',
    name: 'Frog',
    ac: 11,
    hp: 1,
    speed: { walk: 20, swim: 20 },
    dex: 13,
    skills: { Perception: 1, Stealth: 3 },
    senses: ['Darkvision 30 ft'],
    traits: [
      { name: 'Amphibious', text: 'Puster både i luft og vann.' },
      { name: 'Standing Leap', text: 'Hopper langt uten tilløp.' },
    ],
    text: 'Fungerer både på land og i vann.',
  }),
  lizard: form({
    id: 'lizard',
    name: 'Lizard',
    ac: 10,
    hp: 2,
    speed: { walk: 20, climb: 20 },
    dex: 12,
    skills: {},
    senses: ['Darkvision 30 ft'],
    traits: [{ name: 'Spider Climb', text: 'Klatrer på vegger og i taket uten sjekk.' }],
    text: 'Seig liten klatrer.',
    uncertain: 'Spider Climb er lagt til i 2024 etter beste kunnskap.',
  }),
  weasel: form({
    id: 'weasel',
    name: 'Weasel',
    ac: 13,
    hp: 1,
    speed: { walk: 30, climb: 30 },
    dex: 16,
    skills: { Perception: 3, Stealth: 5 },
    senses: ['Darkvision 60 ft'],
    traits: [],
    text: 'Rask, stille og vanskelig å treffe.',
    uncertain: 'Climb 30 ft er fra 2024 etter beste kunnskap. 2014: Keen Hearing and Smell, ingen climb.',
  }),
  octopus: form({
    id: 'octopus',
    name: 'Octopus',
    ac: 12,
    hp: 3,
    speed: { walk: 5, swim: 30 },
    dex: 15,
    skills: { Perception: 2, Stealth: 6 },
    senses: ['Darkvision 30 ft'],
    traits: [
      { name: 'Compression', text: 'Kommer seg gjennom en åpning på 1 tomme.' },
      { name: 'Water Breathing', text: 'Puster bare under vann.' },
    ],
    text: 'Bare til bruk under vann. Kan sprute blekk (Ink Cloud) og gjemme seg.',
    uncertain: 'Trekkene endret seg fra 2014 (Hold Breath, Underwater Camouflage).',
  }),
};

export function isFamiliarForm(s: unknown): s is FamiliarFormId {
  return typeof s === 'string' && (FAMILIAR_FORM_IDS as readonly string[]).includes(s);
}

/** Regler for Find Familiar (2024) som data. */
export const FIND_FAMILIAR = {
  spell: 'Find Familiar',
  castingTime: '1 time (ritual)',
  cost: 'Brennende røkelse for 10 gp, som brukes opp',
  /** Telepatisk kontakt og levering av touch-spells innen denne avstanden. */
  rangeFt: 100,
  canAttack: false,
  creatureTypes: ['Celestial', 'Fey', 'Fiend'],
  text: 'Familiaren er en alliert med eget initiativ og egen tur. Den kan ikke angripe, men kan ta andre actions, f.eks. Help. På 0 HP forsvinner den til du kaster spellen igjen. Kaster du spellen mens du har en familiar, kan du bytte form.',
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

/** Familiarens valg i turen: alle actions unntatt Attack, med Help som anbefalt, og reaction-valgene. */
export function familiarTurnOptions(): {
  actions: { action: ActionDef; recommended: boolean }[];
  reactions: OptionDef[];
} {
  const recommended: ActionId = 'help';
  return {
    actions: ACTIONS.filter((a) => a.id !== 'attack').map((a) => ({
      action: a,
      recommended: a.id === recommended,
    })),
    reactions: [DELIVER_TOUCH],
  };
}

// ---------- Tilstand i GameState ----------

/** `GameState.familiar`. Mangler feltet, har spillet ingen familiar. */
export interface FamiliarState {
  form: FamiliarFormId;
  name: string;
  hpRemoved: number;
  /** Til stede. Blir false på 0 HP eller når den sendes bort. */
  present: boolean;
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

/**
 * Kaster Find Familiar (ritual, 1 time, 10 gp): familiaren kommer fram med full HP. Har du en fra før,
 * kan du bytte form og navn. Uten navn beholdes det gamle, ellers brukes formens navn.
 */
export function summonFamiliar(state: GameState, input: { form: FamiliarFormId; name?: string }): GameState {
  const name = input.name?.trim() || state.familiar?.name || FAMILIAR_FORMS[input.form].name;
  return { ...state, familiar: { form: input.form, name, hpRemoved: 0, present: true } };
}

/** Bytter form ved å kaste spellen på nytt. Uten familiar er tilstanden uendret. */
export function changeFamiliarForm(state: GameState, form: FamiliarFormId): GameState {
  return state.familiar ? summonFamiliar(state, { form, name: state.familiar.name }) : state;
}

/** Sender familiaren bort (eller tilbake med `present`), uten å endre HP. */
export function setFamiliarPresent(state: GameState, present: boolean): GameState {
  return state.familiar ? { ...state, familiar: { ...state.familiar, present } } : state;
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

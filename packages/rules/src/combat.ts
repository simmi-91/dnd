// Kamptilstanden som lagres i `dd_combats.state` (UTVIKLINGSPLAN 4 og 7.2): deltakere med initiativ,
// hvem som har tur og hvem som har spilt, turobjektet per deltaker, aktive effekter, ventende
// konsentrasjonssjekker og kamplogg. Alt er rene data (JSON) og uavhengig av UI-et.
//
// HP for karakteren, kjæledyr, familiaren og egne følgesvenner ligger i `GameState` (varig), ikke her. Fiender og
// NPC-er som legges inn for hånd har HP her (`hp`), hvis den er oppgitt.
import type { ActionId } from './actions.ts';
import type { Companion } from './companions.ts';
import { companionInitiativeBonus } from './companions.ts';
import { isConditionId, type ConditionId } from './conditions.ts';
import { FAMILIAR_FORMS, FIND_FAMILIAR, familiarMaxSpeed, type FamiliarState } from './familiar.ts';
import { darknessAdvantage, firstTurnSpeed, ruleFlags, type RuleFlag } from './features.ts';
import type { GameState, PetState } from './import.ts';
import { applyPetTraits } from './pets.ts';
import type { Pet, Sheet } from './sheet.ts';

export const COMBAT_VERSION = 1;
export const LOG_MAX = 200;

export type ParticipantKind = 'character' | 'pet' | 'familiar' | 'companion' | 'enemy' | 'npc';

/** Det som er fast for en deltaker gjennom kampen. Hentes fra arket og trekkene ved oppsett. */
export interface TurnLimits {
  attacksPerAction: number;
  speed: number;
  /** Ekstra speed i første tur (Ambusher's Leap). */
  firstTurnSpeed: number;
  /** Kan deltakeren angripe? En familiar kan aldri det (regelen i Find Familiar). */
  canAttack: boolean;
  /** Må adlyde: Animal Handling mot denne DC-en før hver tur (husregel på bjørnene). */
  obeyDc: number | null;
  flags: RuleFlag[];
  /** Etikett for advantage i mørke (Umbral Sight), eller null. */
  darknessAdvantage: string | null;
}

/** Turobjektet. Nullstilles når deltakerens tur begynner. */
export interface TurnState {
  /** Hva actionen ble brukt til, eller null. */
  action: ActionId | null;
  /** Angrep igjen i Attack-actionen (Extra Attack, Multiattack). */
  attacksLeft: number;
  /** Hva bonus action ble brukt til, eller null. */
  bonus: string | null;
  /** Hva reaction ble brukt til. Kommer tilbake når din neste tur begynner. */
  reaction: string | null;
  /** Fot brukt denne turen. */
  moved: number;
  /** Speed denne turen, med Ambusher's Leap. Slow, conditions og exhaustion trekkes fra i `movementLeft`. */
  speed: number;
  dashes: number;
  /** Våpenet som gjorde første Light-angrep i Attack-actionen. */
  lightFrom: string | null;
  /** Ekstra-angrepet fra Light er brukt (som bonus action eller med Nick). */
  lightUsed: boolean;
  /** Våpenet som traff med Cleave denne turen. */
  cleaveFrom: string | null;
  /** Ting som bare går én gang per tur, f.eks. `dreadful-strike` og `cleave`. */
  oncePerTurn: string[];
  /** Våpenet i siste angrep som ikke har fått treff ennå. `hit` krever det, så Vex og Sap ikke kommer to ganger. */
  pendingHit: string | null;
  /** Adlyder kjæledyret? `pending` til Animal Handling er rullet. */
  obey: 'pending' | 'ok' | 'failed' | null;
}

export interface Participant {
  id: string;
  kind: ParticipantKind;
  name: string;
  /** ID-en i arket eller tilstanden: kjæledyr-ID eller følgesvenn-ID. */
  refId: string | null;
  initiativeBonus: number;
  /** Total initiativ, eller null før den er satt. */
  initiative: number | null;
  /** d20-kastet, hvis det ble skrevet inn. */
  roll: number | null;
  /** Bare for fiender og NPC-er med oppgitt HP. */
  hp: { max: number; removed: number } | null;
  ac: number | null;
  conditions: ConditionId[];
  /** Exhaustion-nivå (0–6): −5 ft speed og −2 på d20 per nivå. */
  exhaustion: number;
  limits: TurnLimits;
  turn: TurnState;
  /** Antall turer deltakeren har begynt i denne kampen. */
  turns: number;
  /** Runden da gjeldende tur begynte (0 før første tur). */
  turnRound: number;
  /** Ute av kampen (0 HP for fiender, eller tatt ut for hånd). */
  defeated: boolean;
  notes: string;
}

export type EffectKind =
  'concentration' | 'help' | 'hidden' | 'vex' | 'sap' | 'slow' | 'dodge' | 'disengage' | 'grapple' | 'custom';

/** Når en effekt tar slutt: ved start eller slutt av en deltakers tur nummer `turn`. */
export interface EffectEnd {
  at: 'startOfTurn' | 'endOfTurn';
  of: string;
  turn: number;
}

/**
 * En aktiv effekt. `source` er den som lagde den. `target` er den den gjelder:
 * - `concentration`: målet for spellen (f.eks. Hunter's Mark), eller null.
 * - `help`: den som får advantage. `hidden`: null (gjelder `source`).
 * - `help`: `against` er fienden hjelpen gjelder mot (null = hvem som helst).
 * - `vex`: målet `source` har advantage mot. `sap` og `slow`: den som rammes.
 * - `grapple`: `source` holder `target` (Grappled).
 */
export interface CombatEffect {
  id: string;
  kind: EffectKind;
  source: string;
  target: string | null;
  spell?: string;
  /** Help: fienden advantage gjelder mot. */
  against?: string | null;
  ends: EffectEnd | null;
  text?: string;
}

export interface PendingCheck {
  id: string;
  kind: 'concentration';
  who: string;
  dc: number;
  spell: string;
}

export interface LogEntry {
  id: number;
  round: number;
  who: string | null;
  text: string;
}

export interface CombatState {
  v: typeof COMBAT_VERSION;
  status: 'setup' | 'active' | 'ended';
  round: number;
  participants: Participant[];
  /** Hvem som har tur, eller null når alle har spilt runden (eller før start). */
  current: string | null;
  /** Hvem som har spilt denne runden. */
  done: string[];
  /** Mørke er slått på (Umbral Sight). */
  darkness: boolean;
  effects: CombatEffect[];
  checks: PendingCheck[];
  /** Nyeste først. */
  log: LogEntry[];
  /** Teller for ID-er på fiender, effekter, sjekker og logg. */
  seq: number;
}

export const CHARACTER_ID = 'char';

// ---------- Hjelpere ----------

function int(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

export function freshTurn(limits: TurnLimits, firstTurn: boolean): TurnState {
  return {
    action: null,
    attacksLeft: 0,
    bonus: null,
    reaction: null,
    moved: 0,
    speed: limits.speed + (firstTurn ? limits.firstTurnSpeed : 0),
    dashes: 0,
    lightFrom: null,
    lightUsed: false,
    cleaveFrom: null,
    oncePerTurn: [],
    pendingHit: null,
    obey: limits.obeyDc != null ? 'pending' : null,
  };
}

function baseLimits(over: Partial<TurnLimits> = {}): TurnLimits {
  return {
    attacksPerAction: 1,
    speed: 30,
    firstTurnSpeed: 0,
    canAttack: true,
    obeyDc: null,
    flags: [],
    darknessAdvantage: null,
    ...over,
  };
}

function makeParticipant(
  p: Pick<Participant, 'id' | 'kind' | 'name'> &
    Partial<Omit<Participant, 'id' | 'kind' | 'name' | 'turn' | 'limits'>> & { limits?: Partial<TurnLimits> },
): Participant {
  const limits = baseLimits(p.limits);
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    refId: p.refId ?? null,
    initiativeBonus: int(p.initiativeBonus),
    initiative: p.initiative ?? null,
    roll: p.roll ?? null,
    hp: p.hp ?? null,
    ac: p.ac ?? null,
    conditions: [...new Set((p.conditions ?? []).filter(isConditionId))],
    exhaustion: Math.max(0, Math.min(6, int(p.exhaustion))),
    limits,
    turn: freshTurn(limits, true),
    turns: 0,
    turnRound: 0,
    defeated: false,
    notes: p.notes ?? '',
  };
}

/** «Kvitebjørn (stupid)» → «Kvitebjørn». */
export function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim() || name;
}

// ---------- Deltakere ----------

export function characterParticipant(
  sheet: Sheet,
  game?: Pick<GameState, 'conditions' | 'exhaustion'>,
): Participant {
  return makeParticipant({
    id: CHARACTER_ID,
    kind: 'character',
    name: sheet.name.split(' ')[0] || sheet.name,
    initiativeBonus: sheet.initiative,
    ac: sheet.ac,
    conditions: (game?.conditions ?? []).filter(isConditionId),
    exhaustion: game?.exhaustion ?? 0,
    limits: {
      attacksPerAction: sheet.attacksPerAction,
      speed: sheet.speed,
      firstTurnSpeed: firstTurnSpeed(sheet),
      flags: ruleFlags(sheet),
      darknessAdvantage: darknessAdvantage(sheet),
    },
  });
}

/** Walking speed (D&D Beyond `movementId` 1), ellers den første. */
function walkSpeed(speeds: readonly { id: number; speed: number }[]): number {
  return (speeds.find((s) => s.id === 1) ?? speeds[0])?.speed ?? 30;
}

/**
 * Et kjæledyr fra D&D Beyond (f.eks. en bjørn) som egen deltaker med trekkene regnet inn. Bjørnene har
 * egen tur i initiativ, slik bordet spiller (husregel). Multiattack gir antall angrep i Attack-actionen.
 */
export function petParticipant(pet: Pet, state?: Pick<PetState, 'traits'>): Participant {
  const ap = applyPetTraits(pet, state?.traits);
  return makeParticipant({
    id: `pet:${pet.id}`,
    kind: 'pet',
    name: shortName(pet.name),
    refId: pet.id,
    initiativeBonus: ap.initiative,
    ac: ap.ac,
    limits: {
      attacksPerAction: pet.multiattack?.count ?? 1,
      speed: walkSpeed(ap.speeds),
      canAttack: ap.attacks.length > 0,
      obeyDc: ap.flags.obey,
    },
  });
}

/** En egen følgesvenn som legges inn for hånd, som vanlig deltaker. `canAttack` og `speed` står på følgesvennen. */
export function companionParticipant(c: Companion): Participant {
  return makeParticipant({
    id: `comp:${c.id}`,
    kind: 'companion',
    name: c.name,
    refId: c.id,
    initiativeBonus: companionInitiativeBonus(c),
    ac: c.ac ?? null,
    notes: c.notes ?? '',
    limits: { canAttack: c.canAttack ?? true, speed: c.speed ?? 30 },
  });
}

export const FAMILIAR_ID = 'familiar';

/**
 * Familiaren fra Find Familiar som egen deltaker: eget initiativ (DEX-mod fra formen) og egen tur.
 * Den kan ikke angripe. Grensen for bevegelse er den raskeste formen har (f.eks. fly 60 ft for Owl).
 * Alle typene vises med `familiarSpeedText`.
 */
export function familiarParticipant(f: FamiliarState): Participant {
  const form = FAMILIAR_FORMS[f.form];
  return makeParticipant({
    id: FAMILIAR_ID,
    kind: 'familiar',
    name: f.name,
    refId: f.form,
    initiativeBonus: form.initiative,
    ac: form.ac,
    limits: {
      canAttack: FIND_FAMILIAR.canAttack,
      speed: familiarMaxSpeed(form),
    },
  });
}

export interface EnemyInput {
  name: string;
  kind?: 'enemy' | 'npc';
  initiativeBonus?: number;
  /** Total initiativ hvis DM sier tallet. */
  initiative?: number | null;
  hpMax?: number | null;
  ac?: number | null;
  speed?: number;
  notes?: string;
}

// ---------- Oppsett ----------

export function createCombat(): CombatState {
  return {
    v: COMBAT_VERSION,
    status: 'setup',
    round: 0,
    participants: [],
    current: null,
    done: [],
    darkness: false,
    effects: [],
    checks: [],
    log: [],
    seq: 0,
  };
}

export interface CombatFromGameOptions {
  /** Følgesvenner som ikke er med. */
  excludeCompanions?: string[];
}

/**
 * Oppsett fra spillet: karakteren, kjæledyr med «med i kamp» på, familiaren (når arket har Find Familiar
 * og den er til stede) og egne følgesvenner.
 */
export function combatFromGame(sheet: Sheet, game: GameState, opts: CombatFromGameOptions = {}): CombatState {
  let state = addParticipant(createCombat(), characterParticipant(sheet, game));
  for (const pet of sheet.pets) {
    const ps = game.pets[pet.id];
    if (ps?.inCombat === false) continue;
    state = addParticipant(state, petParticipant(pet, ps));
  }
  if (sheet.familiar && game.familiar?.present)
    state = addParticipant(state, familiarParticipant(game.familiar));
  const skip = new Set(opts.excludeCompanions ?? []);
  for (const c of game.companions) {
    if (!skip.has(c.id)) state = addParticipant(state, companionParticipant(c));
  }
  return state;
}

/** Legger til en deltaker. Finnes ID-en fra før, er tilstanden uendret. */
export function addParticipant(state: CombatState, p: Participant): CombatState {
  if (state.participants.some((x) => x.id === p.id)) return state;
  return { ...state, participants: [...state.participants, p] };
}

/** Legger til en fiende eller NPC skrevet inn for hånd. Får ID-en `e1`, `e2`, … */
export function addEnemy(state: CombatState, input: EnemyInput): { state: CombatState; id: string } {
  const seq = state.seq + 1;
  const id = `e${seq}`;
  const hpMax = input.hpMax != null ? Math.max(0, int(input.hpMax)) : null;
  const p = makeParticipant({
    id,
    kind: input.kind ?? 'enemy',
    name: input.name.trim() || `Fiende ${seq}`,
    initiativeBonus: int(input.initiativeBonus),
    initiative: input.initiative != null ? int(input.initiative) : null,
    hp: hpMax != null ? { max: hpMax, removed: 0 } : null,
    ac: input.ac != null ? int(input.ac) : null,
    notes: input.notes ?? '',
    limits: { speed: input.speed ?? 30 },
  });
  return { state: { ...state, seq, participants: [...state.participants, p] }, id };
}

/** Tar ut en deltaker, med effektene og sjekkene som hører til. Har den tur, går turen videre. */
export function removeParticipant(state: CombatState, id: string): CombatState {
  if (!state.participants.some((p) => p.id === id)) return state;
  const wasCurrent = state.current === id;
  let next: CombatState = {
    ...state,
    participants: state.participants.filter((p) => p.id !== id),
    done: state.done.filter((d) => d !== id),
    effects: state.effects.filter((e) => e.source !== id && e.target !== id),
    checks: state.checks.filter((c) => c.who !== id),
  };
  // Plassen før den som ble tatt ut, så neste i den nye rekkefølgen får tur.
  if (wasCurrent) next = advance({ ...next, current: null }, orderIndex(state, id) - 1);
  return next;
}

/** Setter initiativ: `roll` (d20, bonusen legges til) eller `total` (tallet DM sier). */
export function setInitiative(
  state: CombatState,
  id: string,
  input: { roll: number } | { total: number },
): CombatState {
  return updateParticipant(state, id, (p) =>
    'roll' in input
      ? { ...p, roll: int(input.roll), initiative: int(input.roll) + p.initiativeBonus }
      : { ...p, roll: null, initiative: int(input.total) },
  );
}

/**
 * Initiativrekkefølgen. Høyest total først. Likt: høyest bonus først, så rekkefølgen de ble lagt inn i
 * (2024-reglene lar DM og spillerne avgjøre likt, så dette er bare standarden). Uten initiativ havner
 * deltakeren sist.
 */
export function initiativeOrder(state: CombatState): string[] {
  return state.participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const A = a.p.initiative;
      const B = b.p.initiative;
      if (A != null && B != null && A !== B) return B - A;
      if (A != null && B == null) return -1;
      if (A == null && B != null) return 1;
      return b.p.initiativeBonus - a.p.initiativeBonus || a.i - b.i;
    })
    .map((x) => x.p.id);
}

export function participant(state: CombatState, id: string | null | undefined): Participant | null {
  return state.participants.find((p) => p.id === id) ?? null;
}

export function updateParticipant(
  state: CombatState,
  id: string,
  fn: (p: Participant) => Participant,
): CombatState {
  let hit = false;
  const participants = state.participants.map((p) => {
    if (p.id !== id) return p;
    hit = true;
    return fn(p);
  });
  return hit ? { ...state, participants } : state;
}

// ---------- Logg ----------

export function addLog(state: CombatState, text: string, who: string | null = state.current): CombatState {
  const seq = state.seq + 1;
  const entry: LogEntry = { id: seq, round: state.round, who, text };
  return { ...state, seq, log: [entry, ...state.log].slice(0, LOG_MAX) };
}

// ---------- Runder og turer ----------

function orderIndex(state: CombatState, id: string): number {
  return initiativeOrder(state).indexOf(id);
}

function canAct(state: CombatState, id: string): boolean {
  const p = participant(state, id);
  return !!p && !p.defeated && !state.done.includes(id);
}

/** Effekter som tar slutt ved start eller slutt av deltakerens tur. */
function expire(state: CombatState, id: string, at: EffectEnd['at']): CombatState {
  const p = participant(state, id);
  if (!p) return state;
  const effects = state.effects.filter(
    (e) => !(e.ends && e.ends.at === at && e.ends.of === id && e.ends.turn <= p.turns),
  );
  return effects.length === state.effects.length ? state : { ...state, effects };
}

/** Begynner turen til en deltaker: nytt turobjekt, reaction tilbake og effekter som går ut. */
function beginTurn(state: CombatState, id: string): CombatState {
  const p = participant(state, id);
  if (!p || p.turnRound >= state.round) return { ...state, current: id };
  const next = updateParticipant({ ...state, current: id }, id, (x) => ({
    ...x,
    turns: x.turns + 1,
    turnRound: state.round,
    turn: freshTurn(x.limits, x.turns === 0),
  }));
  return expire(next, id, 'startOfTurn');
}

/** Neste deltaker etter plass `from` i rekkefølgen som ikke har spilt. Ellers er runden ferdig. */
function advance(state: CombatState, from: number): CombatState {
  const order = initiativeOrder(state);
  const rotated = [...order.slice(from + 1), ...order.slice(0, from + 1)];
  const next = rotated.find((id) => canAct(state, id));
  return next ? beginTurn(state, next) : { ...state, current: null };
}

/** Starter kampen: runde 1, og den med høyest initiativ har tur. */
export function startCombat(state: CombatState): CombatState {
  const started: CombatState = { ...state, status: 'active', round: 1, done: [], current: null };
  return addLog(advance(started, -1), 'Kampen starter – runde 1', null);
}

/**
 * Ferdig med turen (standard: den som har tur). Deltakeren får ✓, effekter som varer til slutten av
 * turen går ut, og turen går til neste som ikke har spilt. Når alle har spilt, blir `current` null.
 */
export function endTurn(state: CombatState, id: string | null = state.current): CombatState {
  if (!id || state.status !== 'active' || !participant(state, id)) return state;
  let next: CombatState = state.done.includes(id) ? state : { ...state, done: [...state.done, id] };
  next = expire(next, id, 'endOfTurn');
  if (state.current !== id && state.current != null) return next;
  return advance(next, orderIndex(next, id));
}

/** Gir turen til en bestemt deltaker (fanevalg utenom rekkefølgen). */
export function selectTurn(state: CombatState, id: string): CombatState {
  if (state.status !== 'active' || !canAct(state, id)) return state;
  return beginTurn(state, id);
}

/** Alle har spilt runden. */
export function roundComplete(state: CombatState): boolean {
  return (
    state.status === 'active' && state.participants.every((p) => p.defeated || state.done.includes(p.id))
  );
}

export function nextRound(state: CombatState): CombatState {
  if (state.status !== 'active') return state;
  const round = state.round + 1;
  return addLog(advance({ ...state, round, done: [], current: null }, -1), `— Runde ${round} —`, null);
}

/** Avslutter kampen. Effekter og sjekker fjernes, loggen beholdes. */
export function endCombat(state: CombatState): CombatState {
  return addLog(
    { ...state, status: 'ended', current: null, effects: [], checks: [] },
    'Kampen er slutt',
    null,
  );
}

/**
 * Conditions på karakteren følger med tilbake til `GameState` (f.eks. ved slutten av kampen), så de
 * gjelder utenfor kamp også.
 */
export function conditionsToGame(game: GameState, state: CombatState): GameState {
  const me = participant(state, CHARACTER_ID);
  return me ? { ...game, conditions: [...me.conditions], exhaustion: me.exhaustion ?? 0 } : game;
}

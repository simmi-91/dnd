// Turen i kamp (UTVIKLINGSPLAN 7.2): `turReducer` holder rede på action, bonus action, reaction,
// bevegelse, angrep igjen (Extra Attack), Light og Nick, Dreadful Strike én gang per tur,
// advantage-kilder og konsentrasjon. `canDo` svarer `{ ok, reason }`, der `reason` er teksten på
// grå valg. Begge er rene funksjoner på `CombatState`.
import { ACTIONS, HIDE_DC, type ActionId } from './actions.ts';
import { ROLL_HINT, rollMode, type RollMode } from './attack.ts';
import {
  addLog,
  endTurn,
  nextRound,
  participant,
  removeParticipant,
  selectTurn,
  FAMILIAR_ID,
  updateParticipant,
  type CombatEffect,
  type CombatState,
  type EffectEnd,
  type Participant,
  type TurnState,
} from './combat.ts';
import {
  CONDITION_DEFS,
  conditionWith,
  exhaustionPenalty,
  expandConditions,
  type ConditionId,
} from './conditions.ts';
import {
  masteryOf,
  type AttackKind,
  type ExtraDamageDef,
  type OptionDef,
  type ResourceContext,
} from './features.ts';
import { FAMILIAR_FORMS, FAMILIAR_NO_ATTACK, damageFamiliar, isFamiliarForm } from './familiar.ts';
import type { GameState } from './import.ts';
import type { PetAttack, Weapon } from './sheet.ts';
import { concentrationDc } from './state.ts';

/** Det turen trenger å vite om våpenet. Lages med `turnWeapon` eller `petTurnWeapon`. */
export interface AttackWeapon {
  key: string;
  name: string;
  light: boolean;
  ranged: boolean;
  mastery: string | null;
}

export function turnWeapon(w: Weapon): AttackWeapon {
  return { key: w.key, name: w.name, light: w.light, ranged: w.ranged, mastery: w.mastery };
}

export function petTurnWeapon(a: PetAttack): AttackWeapon {
  return { key: `pet:${a.name}`, name: a.name, light: false, ranged: !a.melee, mastery: null };
}

/** Et valg i turen. `who` er deltakeren, standard den som har tur. */
export type TurnOption = { who?: string } & (
  | { kind: 'action'; action: ActionId }
  | { kind: 'option'; option: OptionDef }
  | { kind: 'attack'; weapon: AttackWeapon; attack: AttackKind }
  /** Ekstra skade på et treff. `target` er målet for angrepet (Hunter's Mark gjelder bare det merkede). */
  | { kind: 'extraDamage'; damage: ExtraDamageDef; target?: string | null }
  | { kind: 'move'; feet: number }
  /** Reise seg fra Prone: koster halve speeden. */
  | { kind: 'standUp' }
  | { kind: 'endTurn' }
);

/** Det `canDo` ikke kan lese fra kamptilstanden. */
export interface TurnContext {
  /** Et angrep eller en sjekk er halvveis. */
  busy?: boolean;
  /** Hva som er igjen av valg og ekstra skade, fra `resourceContext`. */
  resources?: ResourceContext;
}

export interface CanDo {
  ok: boolean;
  /** Norsk tekst for grå valg, null når valget går. */
  reason: string | null;
}

/** Tekstene på grå valg. */
export const REASONS = {
  busy: 'Gjør ferdig det du holder på med først',
  notActive: 'Kampen er ikke i gang',
  unknown: 'Fant ikke deltakeren',
  defeated: (n: string) => `${n} er ute av kampen`,
  notTurn: (n: string) => `Det er ikke turen til ${n}`,
  incapacitated: (n: string, c: string) => `${n} er ${c} og kan ikke ta action, bonus action eller reaction`,
  obeyPending: 'Rull Animal Handling først',
  obeyFailed: (n: string) => `${n} adlyder ikke denne runden. DM bestemmer hva den gjør.`,
  action: 'Action er brukt denne turen',
  attacksDone: 'Du har brukt alle angrepene i Attack-actionen',
  bonus: 'Bonus action er brukt denne turen',
  reaction: 'Reaction er brukt. Den kommer tilbake når din neste tur begynner.',
  cantAttack: (n: string) => `${n} kan ikke angripe`,
  notLight: (w: string) => `${w} er ikke et Light-våpen`,
  lightFirst: 'Krever først et angrep med et annet Light-våpen i Attack-actionen',
  lightUsed: 'Ekstra-angrepet fra Light er brukt denne turen',
  notNick: (w: string) => `${w} har ikke Weapon Mastery Nick`,
  cleaveFirst: (w: string) => `Cleave krever et nærkamptreff med ${w} denne turen`,
  cleaveUsed: 'Cleave er brukt denne turen (1 per tur)',
  meleeOnly: 'Opportunity attack må være et nærkampangrep',
  oncePerTurn: (l: string) => `${l} er brukt denne turen (1 per tur).`,
  notActiveSpell: (s: string) => `${s} er ikke aktiv.`,
  alreadyActive: (s: string) => `${s} er allerede aktiv.`,
  empty: (l: string) => `Ingen ${l} igjen`,
  speedZero: (c: string) => `Speed er 0 (${c})`,
  noMovement: 'Du har ikke mer bevegelse denne turen',
  moveLeft: (n: number) => `Du har bare ${n} ft igjen`,
  otherTarget: (s: string, n: string) => `${s} er på ${n}, ikke på dette målet.`,
  targetUp: (s: string, n: string) => `${n} har fortsatt HP. Du kan flytte ${s} når målet faller til 0 HP.`,
  notProne: 'Du ligger ikke (Prone)',
  familiarOnly: 'Bare familiaren kan gjøre dette',
  familiarForm: (f: string) => `Bare familiaren i formen ${f} kan gjøre dette`,
  standUpCost: (n: number) => `Å reise seg koster ${n} ft, og du har ikke nok bevegelse igjen`,
} as const;

const OK: CanDo = { ok: true, reason: null };
const no = (reason: string): CanDo => ({ ok: false, reason });

// ---------- Oppslag ----------

function who(state: CombatState, id: string | undefined): Participant | null {
  return participant(state, id ?? state.current);
}

function concentration(state: CombatState, id: string): CombatEffect | null {
  return state.effects.find((e) => e.kind === 'concentration' && e.source === id) ?? null;
}

/** Spellen deltakeren holder konsentrasjonen på, med mål, eller null. */
export function concentratingOn(
  state: CombatState,
  id: string,
): { spell: string; target: string | null } | null {
  const c = concentration(state, id);
  return c ? { spell: c.spell ?? '', target: c.target } : null;
}

function conditionName(c: ConditionId): string {
  return CONDITION_DEFS[c].name;
}

/**
 * Speed denne turen: med Ambusher's Leap, minus Slow (høyst −10 ft, stables ikke) og exhaustion
 * (−5 ft per nivå). 0 med Grappled, Restrained, Paralyzed osv.
 */
export function effectiveSpeed(state: CombatState, id: string): number {
  const p = participant(state, id);
  if (!p || conditionWith(p.conditions, 'speedZero')) return 0;
  const slowed = state.effects.some((e) => e.kind === 'slow' && e.target === id);
  return Math.max(0, p.turn.speed - (slowed ? 10 : 0) + exhaustionPenalty(p.exhaustion ?? 0).speed);
}

/** Fot igjen denne turen: speeden ganger Dash, minus brukt. */
export function movementLeft(state: CombatState, id: string): number {
  const p = participant(state, id);
  if (!p) return 0;
  return Math.max(0, effectiveSpeed(state, id) * (1 + p.turn.dashes) - p.turn.moved);
}

/** Å reise seg fra Prone koster halve speeden (rundet ned). */
export function standUpCost(state: CombatState, id: string): number {
  return Math.floor(effectiveSpeed(state, id) / 2);
}

/** Målet er nede: ute av kampen, eller 0 HP. */
function isDown(p: Participant): boolean {
  return p.defeated || (p.hp != null && p.hp.removed >= p.hp.max);
}

/** Help gjelder mot fienden i `against`, eller mot hvem som helst når den mangler. */
function helpApplies(e: CombatEffect, attacker: string, target: string | null): boolean {
  return e.kind === 'help' && e.target === attacker && (e.against == null || e.against === target);
}

// ---------- canDo ----------

function attackCheck(p: Participant, weapon: AttackWeapon, attack: AttackKind): CanDo {
  const t = p.turn;
  if (p.kind === 'familiar') return no(FAMILIAR_NO_ATTACK);
  if (!p.limits.canAttack) return no(REASONS.cantAttack(p.name));
  switch (attack) {
    case 'main':
      if (t.action == null) return OK;
      if (t.action !== 'attack') return no(REASONS.action);
      return t.attacksLeft > 0 ? OK : no(REASONS.attacksDone);
    case 'light':
    case 'nick':
      if (!weapon.light) return no(REASONS.notLight(weapon.name));
      if (attack === 'nick' && masteryOf(weapon.mastery) !== 'nick') return no(REASONS.notNick(weapon.name));
      if (t.lightUsed) return no(REASONS.lightUsed);
      if (t.action !== 'attack' || !t.lightFrom || t.lightFrom === weapon.key) return no(REASONS.lightFirst);
      if (attack === 'light' && t.bonus != null) return no(REASONS.bonus);
      return OK;
    case 'cleave':
      if (t.oncePerTurn.includes('cleave')) return no(REASONS.cleaveUsed);
      return t.cleaveFrom === weapon.key ? OK : no(REASONS.cleaveFirst(weapon.name));
    case 'opportunity':
      if (weapon.ranged) return no(REASONS.meleeOnly);
      return t.reaction == null ? OK : no(REASONS.reaction);
  }
}

function isReaction(option: TurnOption): boolean {
  return (
    (option.kind === 'attack' && option.attack === 'opportunity') ||
    (option.kind === 'option' && option.option.cost === 'reaction')
  );
}

/**
 * Kan deltakeren gjøre dette nå? Gir `{ ok: false, reason }` med norsk tekst for grå valg.
 * Ressurser (gratis-kast, slots, Dreadful Strike) sjekkes bare når `ctx.left` er gitt.
 */
export function canDo(state: CombatState, option: TurnOption, ctx: TurnContext = {}): CanDo {
  if (ctx.busy) return no(REASONS.busy);
  if (state.status !== 'active') return no(REASONS.notActive);
  const p = who(state, option.who);
  if (!p) return no(REASONS.unknown);
  if (p.defeated) return no(REASONS.defeated(p.name));
  const reaction = isReaction(option);
  if (!reaction && state.current !== p.id) return no(REASONS.notTurn(p.name));
  if (option.kind === 'endTurn') return OK;

  if (option.kind !== 'move') {
    const incap = conditionWith(p.conditions, 'incapacitated');
    if (incap) return no(REASONS.incapacitated(p.name, conditionName(incap)));
  }
  if (!reaction && p.turn.obey === 'pending') return no(REASONS.obeyPending);
  if (!reaction && p.turn.obey === 'failed') return no(REASONS.obeyFailed(p.name));

  const t = p.turn;
  switch (option.kind) {
    case 'action':
      if (option.action === 'attack') {
        if (p.kind === 'familiar') return no(FAMILIAR_NO_ATTACK);
        if (!p.limits.canAttack) return no(REASONS.cantAttack(p.name));
        if (t.action === 'attack') return t.attacksLeft > 0 ? OK : no(REASONS.attacksDone);
      }
      return t.action == null ? OK : no(REASONS.action);
    case 'attack':
      return attackCheck(p, option.weapon, option.attack);
    case 'option': {
      const o = option.option;
      if (o.attack) return no(REASONS.unknown);
      if (o.familiarOnly && p.kind !== 'familiar') return no(REASONS.familiarOnly);
      if (o.familiarForm && p.refId !== o.familiarForm)
        return no(
          REASONS.familiarForm(
            isFamiliarForm(o.familiarForm) ? FAMILIAR_FORMS[o.familiarForm].name : o.familiarForm,
          ),
        );
      if (o.cost === 'bonus' && t.bonus != null) return no(REASONS.bonus);
      if (o.cost === 'reaction' && t.reaction != null) return no(REASONS.reaction);
      if (o.cost === 'action' && t.action != null) return no(REASONS.action);
      const conc = concentration(state, p.id);
      if (o.requiresConcentration && conc?.spell !== o.requiresConcentration)
        return no(REASONS.notActiveSpell(o.requiresConcentration));
      if (o.startsConcentration && conc?.spell === o.startsConcentration)
        return no(o.activeReason ?? REASONS.alreadyActive(o.startsConcentration));
      if (o.requiresTargetDown && conc) {
        // Merket står på en deltaker som fortsatt er oppe. Ukjente mål kan ikke sjekkes.
        const marked = participant(state, conc.target);
        if (marked && !isDown(marked)) return no(REASONS.targetUp(conc.spell ?? '', marked.name));
      }
      if (ctx.resources?.options[o.id] === 0) return no(o.emptyReason ?? REASONS.empty(o.name));
      return OK;
    }
    case 'extraDamage': {
      const d = option.damage;
      if (d.oncePerTurn && t.oncePerTurn.includes(d.id)) return no(REASONS.oncePerTurn(d.label));
      if (d.requiresConcentration) {
        const conc = concentration(state, p.id);
        if (conc?.spell !== d.requiresConcentration)
          return no(REASONS.notActiveSpell(d.requiresConcentration));
        // Har merket et mål, gjelder skaden bare mot det (også når angrepsmålet ikke er oppgitt).
        if (conc.target != null && (option.target ?? null) !== conc.target)
          return no(REASONS.otherTarget(d.requiresConcentration, targetName(state, conc.target)));
      }
      if (ctx.resources?.damage[d.id] === 0) return no(d.emptyReason ?? REASONS.empty(d.label));
      return OK;
    }
    case 'standUp': {
      if (!p.conditions.includes('prone')) return no(REASONS.notProne);
      const zero = conditionWith(p.conditions, 'speedZero');
      if (zero) return no(REASONS.speedZero(conditionName(zero)));
      const cost = standUpCost(state, p.id);
      return cost <= movementLeft(state, p.id) ? OK : no(REASONS.standUpCost(cost));
    }
    case 'move': {
      const zero = conditionWith(p.conditions, 'speedZero');
      if (zero) return no(REASONS.speedZero(conditionName(zero)));
      const ft = movementLeft(state, p.id);
      if (ft <= 0) return no(REASONS.noMovement);
      return option.feet <= ft ? OK : no(REASONS.moveLeft(ft));
    }
  }
}

// ---------- Advantage ----------

export interface AttackRollInput {
  /** Målet, hvis det er en deltaker i kampen. */
  target?: string | null;
  weapon?: Pick<AttackWeapon, 'ranged'>;
  /** Målet står innen 5 ft. Standard: nærkamp = ja, avstand = nei. */
  within5?: boolean;
  /** En fiende står inntil deg mens du bruker et avstandsvåpen. */
  rangedInMelee?: boolean;
  /** Målet er utenfor vanlig rekkevidde (lang avstand). */
  longRange?: boolean;
  /** «Annen fordel» og «disadvantage» slått på for hånd. */
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface AttackRoll {
  mode: RollMode;
  advantage: string[];
  disadvantage: string[];
  /** «Rull 2d20 og skriv inn den høyeste.» osv. */
  hint: string;
  /** Legges til d20-kastet: −2 per exhaustion-nivå (0 uten exhaustion). */
  d20Modifier: number;
  /** Treff er automatisk kritiske (Paralyzed eller Unconscious innen 5 ft), med grunnen, ellers null. */
  autoCrit: string | null;
}

/**
 * Advantage og disadvantage på et angrep, med norske navn på kildene. Kilder: mørke (Umbral Sight),
 * Help, skjult (Hide), Vex, conditions på deg og målet, Dodge på målet, Sap, avstandsangrep i
 * nærkamp og lang avstand (ikke med Sharpshooter), og «annen fordel» for hånd.
 */
export function attackRoll(state: CombatState, attackerId: string, input: AttackRollInput = {}): AttackRoll {
  const adv: string[] = [];
  const dis: string[] = [];
  const me = participant(state, attackerId);
  const target = participant(state, input.target ?? null);
  const ranged = input.weapon?.ranged ?? false;
  const within5 = input.within5 ?? !ranged;
  if (me) {
    if (state.darkness && me.limits.darknessAdvantage) adv.push(me.limits.darknessAdvantage);
    for (const c of expandConditions(me.conditions)) {
      const e = CONDITION_DEFS[c].effects;
      if (e.attackAdvantage) adv.push(`du er ${CONDITION_DEFS[c].name}`);
      if (e.attackDisadvantage) dis.push(`du er ${CONDITION_DEFS[c].name}`);
    }
    // Grappled: disadvantage mot alle andre enn den som holder deg (ukjent holder: alle).
    if (me.conditions.includes('grappled')) {
      const holders = state.effects.filter((e) => e.kind === 'grapple' && e.target === attackerId);
      if (!target || !holders.some((e) => e.source === target.id)) dis.push('du er Grappled');
    }
    for (const e of state.effects) {
      if (helpApplies(e, attackerId, target?.id ?? null))
        adv.push(`Help fra ${participant(state, e.source)?.name ?? 'en alliert'}`);
      if (e.kind === 'hidden' && e.source === attackerId) adv.push('du er skjult');
      if (e.kind === 'vex' && e.source === attackerId && (!e.target || !target || e.target === target.id))
        adv.push('Vex');
      if (e.kind === 'sap' && e.target === attackerId) dis.push('Sap');
    }
    if (ranged && input.rangedInMelee && !me.limits.flags.includes('no-ranged-melee-disadvantage'))
      dis.push('fiende inntil deg (avstandsangrep)');
    if (ranged && input.longRange && !me.limits.flags.includes('no-long-range-disadvantage'))
      dis.push('lang avstand');
  }
  let autoCrit: string | null = null;
  if (target) {
    for (const c of expandConditions(target.conditions)) {
      const e = CONDITION_DEFS[c].effects;
      const name = CONDITION_DEFS[c].name;
      if (e.attackedAdvantage === 'always' || (e.attackedAdvantage === 'within5' && within5))
        adv.push(`målet er ${name}`);
      if (e.attackedDisadvantage === 'always' || (e.attackedDisadvantage === 'beyond5' && !within5))
        dis.push(`målet er ${name}`);
      if (e.critWithin5 && within5 && !autoCrit)
        autoCrit = `målet er ${name} og innen 5 ft: treff er kritiske`;
    }
    if (state.effects.some((e) => e.kind === 'hidden' && e.source === target.id)) dis.push('målet er skjult');
    // Dodge virker ikke når den som tok Dodge er incapacitated eller har speed 0 (2024).
    const dodging = state.effects.some((e) => e.kind === 'dodge' && e.source === target.id);
    if (dodging && !conditionWith(target.conditions, 'incapacitated') && effectiveSpeed(state, target.id) > 0)
      dis.push('målet bruker Dodge');
  }
  if (input.advantage) adv.push('annen fordel');
  if (input.disadvantage) dis.push('annen ulempe');
  const mode = rollMode(adv, dis);
  return {
    mode,
    advantage: adv,
    disadvantage: dis,
    hint: ROLL_HINT[mode],
    d20Modifier: exhaustionPenalty(me?.exhaustion ?? 0).d20,
    autoCrit,
  };
}

// ---------- turReducer ----------

export type TurnEvent =
  /**
   * En action som ikke er angrep. Hide trenger `total` (Stealth). Help trenger `target` (den som får
   * hjelp) og kan ha `enemy` (fienden hjelpen gjelder mot).
   */
  | {
      type: 'action';
      who?: string;
      action: Exclude<ActionId, 'attack'>;
      total?: number;
      target?: string | null;
      enemy?: string | null;
    }
  /** Et valg fra evnene (bonus action, reaction). `target` er målet, f.eks. for Hunter's Mark. */
  | { type: 'option'; who?: string; option: OptionDef; target?: string | null }
  /** d20 er skrevet inn: action-økonomien oppdateres først nå, så «Avbryt» før kastet koster ingenting. */
  | {
      type: 'attack';
      who?: string;
      weapon: AttackWeapon;
      attack: AttackKind;
      target?: string | null;
      nat?: number;
      total?: number;
    }
  /** Angrepet traff: Weapon Mastery (Vex, Sap, Slow, Cleave) slår inn. Krever et angrep med våpenet først. */
  | { type: 'hit'; who?: string; weapon: AttackWeapon; target?: string | null }
  /** Ekstra skade på et treff ble brukt (Dreadful Strike, Hunter's Mark). */
  | { type: 'extraDamage'; who?: string; damage: ExtraDamageDef; target?: string | null }
  | { type: 'move'; who?: string; feet: number }
  /** Reiser seg fra Prone: koster halve speeden. */
  | { type: 'standUp'; who?: string }
  | { type: 'concentrate'; who?: string; spell: string; target?: string | null }
  | { type: 'endConcentration'; who?: string }
  /**
   * Deltakeren tok skade (`crit` ved kritisk treff). Fiender med HP mister HP. Konsentrasjon gir en CON
   * save-sjekk, men faller deltakeren til 0 HP, er konsentrasjonen borte. For karakteren brukes `crit`
   * også i `applyDamage` (to feilede death saves på 0 HP).
   */
  | { type: 'damaged'; who: string; amount: number; crit?: boolean }
  | { type: 'healed'; who: string; amount: number }
  /** Svar på en konsentrasjonssjekk: CON save-totalen. */
  | { type: 'concentrationSave'; who?: string; checkId?: string; total: number }
  /** Animal Handling før kjæledyrets tur (husregel). */
  | { type: 'obey'; who?: string; total: number }
  /** Condition av eller på. For Grappled kan `source` være den som holder. */
  | { type: 'condition'; who: string; condition: ConditionId; on: boolean; source?: string | null }
  | { type: 'exhaustion'; who: string; level: number }
  | { type: 'darkness'; on: boolean }
  | { type: 'defeated'; who: string; on: boolean }
  | { type: 'effect'; effect: Omit<CombatEffect, 'id'> }
  | { type: 'removeEffect'; id: string }
  | { type: 'endTurn'; who?: string }
  | { type: 'selectTurn'; who: string }
  | { type: 'nextRound' }
  | { type: 'log'; text: string; who?: string | null }
  /** Familiaren falt til 0 HP og forsvant: den tas ut av kampen, og Help fra den forsvinner. */
  | { type: 'vanished'; who?: string };

function setTurn(state: CombatState, id: string, fn: (t: TurnState) => TurnState): CombatState {
  return updateParticipant(state, id, (p) => ({ ...p, turn: fn(p.turn) }));
}

function addEffect(state: CombatState, effect: Omit<CombatEffect, 'id'>): CombatState {
  const seq = state.seq + 1;
  return { ...state, seq, effects: [...state.effects, { ...effect, id: `x${seq}` }] };
}

function removeEffects(state: CombatState, pred: (e: CombatEffect) => boolean): CombatState {
  const effects = state.effects.filter((e) => !pred(e));
  return effects.length === state.effects.length ? state : { ...state, effects };
}

/** Fjerner den første effekten som passer (Help brukes opp én om gangen). */
function removeFirst(state: CombatState, pred: (e: CombatEffect) => boolean): CombatState {
  const i = state.effects.findIndex(pred);
  return i < 0 ? state : { ...state, effects: state.effects.filter((_, j) => j !== i) };
}

/** Effekt som varer til start (eller slutt) av deltakerens neste tur. */
function untilNext(p: Participant, at: EffectEnd['at']): EffectEnd {
  return { at, of: p.id, turn: p.turns + 1 };
}

function dropConcentration(state: CombatState, id: string, why: string): CombatState {
  const c = concentration(state, id);
  if (!c) return state;
  const next = removeEffects(state, (e) => e.kind === 'concentration' && e.source === id);
  const p = participant(state, id);
  return addLog(
    { ...next, checks: next.checks.filter((k) => k.who !== id) },
    `${p?.name ?? id} mistet ${c.spell ?? 'konsentrasjonen'} (${why})`,
    id,
  );
}

function startConcentration(
  state: CombatState,
  id: string,
  spell: string,
  target: string | null,
): CombatState {
  const old = concentration(state, id);
  let next = state;
  if (old && old.spell !== spell) next = dropConcentration(next, id, `ny konsentrasjon på ${spell}`);
  else if (old) next = removeEffects(next, (e) => e === old);
  return addEffect(next, { kind: 'concentration', source: id, target, spell, ends: null });
}

function targetName(state: CombatState, id: string | null | undefined): string {
  return id ? (participant(state, id)?.name ?? id) : '';
}

const SIMPLE_ACTION_LOG: Partial<Record<ActionId, string>> = {
  dash: 'Dash: dobbel bevegelse denne turen',
  disengage: 'Disengage: ingen opportunity attacks denne turen',
  dodge: 'Dodge: angrep mot deg har disadvantage til din neste tur',
};

function actionEvent(
  state: CombatState,
  p: Participant,
  e: Extract<TurnEvent, { type: 'action' }>,
): CombatState {
  let next = setTurn(state, p.id, (t) => ({
    ...t,
    action: e.action,
    dashes: t.dashes + (e.action === 'dash' ? 1 : 0),
  }));
  const name = ACTIONS.find((a) => a.id === e.action)?.name ?? e.action;
  switch (e.action) {
    case 'disengage':
      next = addEffect(next, {
        kind: 'disengage',
        source: p.id,
        target: null,
        ends: { at: 'endOfTurn', of: p.id, turn: p.turns },
      });
      break;
    case 'dodge': {
      next = addEffect(next, {
        kind: 'dodge',
        source: p.id,
        target: null,
        ends: untilNext(p, 'startOfTurn'),
      });
      break;
    }
    case 'help': {
      if (e.target) {
        next = addEffect(next, {
          kind: 'help',
          source: p.id,
          target: e.target,
          against: e.enemy ?? null,
          ends: untilNext(p, 'startOfTurn'),
        });
      }
      return addLog(
        next,
        `${p.name}: Help${e.target ? ` → ${targetName(state, e.target)} får advantage på neste angrep` : ''}`,
        p.id,
      );
    }
    case 'hide': {
      const total = e.total ?? 0;
      const ok = total >= HIDE_DC;
      if (ok) next = addEffect(next, { kind: 'hidden', source: p.id, target: null, ends: null });
      return addLog(
        next,
        `${p.name}: Hide, Stealth ${total} mot DC ${HIDE_DC} → ${ok ? 'skjult, advantage på neste angrep' : 'ikke skjult'}`,
        p.id,
      );
    }
    default:
      break;
  }
  return addLog(next, `${p.name}: ${SIMPLE_ACTION_LOG[e.action] ?? `Action: ${name}`}`, p.id);
}

function attackEvent(
  state: CombatState,
  p: Participant,
  e: Extract<TurnEvent, { type: 'attack' }>,
): CombatState {
  let next = setTurn(state, p.id, (t) => {
    const n: TurnState = { ...t, pendingHit: e.weapon.key };
    switch (e.attack) {
      case 'main':
        if (n.action == null) {
          n.action = 'attack';
          n.attacksLeft = Math.max(0, p.limits.attacksPerAction - 1);
        } else n.attacksLeft = Math.max(0, n.attacksLeft - 1);
        if (e.weapon.light && !n.lightFrom) n.lightFrom = e.weapon.key;
        break;
      case 'light':
        n.lightUsed = true;
        n.bonus = 'light-attack';
        break;
      case 'nick':
        n.lightUsed = true;
        break;
      case 'cleave':
        n.oncePerTurn = [...n.oncePerTurn, 'cleave'];
        n.cleaveFrom = null;
        break;
      case 'opportunity':
        n.reaction = 'opportunity-attack';
        break;
    }
    return n;
  });
  // Help, skjult, Vex og Sap brukes opp på dette angrepet.
  const target = e.target ?? null;
  next = removeFirst(next, (x) => helpApplies(x, p.id, target));
  next = removeEffects(next, (x) => x.kind === 'hidden' && x.source === p.id);
  next = removeFirst(
    next,
    (x) => x.kind === 'vex' && x.source === p.id && (!x.target || !target || x.target === target),
  );
  next = removeFirst(next, (x) => x.kind === 'sap' && x.target === p.id);
  const kindText: Record<AttackKind, string> = {
    main: '',
    light: ' (Light, bonus action)',
    nick: ' (Nick, del av Action)',
    cleave: ' (Cleave)',
    opportunity: ' (opportunity attack)',
  };
  const roll =
    e.nat != null && e.total != null
      ? `: ${e.nat} → ${e.total}${e.nat === 20 ? ' – KRITISK TREFF!' : e.nat === 1 ? ' – naturlig 1, bom' : ''}`
      : '';
  const on = target ? ` mot ${targetName(state, target)}` : '';
  return addLog(next, `${p.name}: ${e.weapon.name}${kindText[e.attack]}${on}${roll}`, p.id);
}

function hitEvent(state: CombatState, p: Participant, e: Extract<TurnEvent, { type: 'hit' }>): CombatState {
  const m = masteryOf(e.weapon.mastery);
  const target = e.target ?? null;
  let next = setTurn(state, p.id, (t) => ({ ...t, pendingHit: null }));
  const end = untilNext(p, 'startOfTurn');
  if (m === 'vex')
    next = addEffect(next, { kind: 'vex', source: p.id, target, ends: { ...end, at: 'endOfTurn' } });
  if (m === 'sap' && target) next = addEffect(next, { kind: 'sap', source: p.id, target, ends: end });
  if (m === 'slow' && target) next = addEffect(next, { kind: 'slow', source: p.id, target, ends: end });
  if (m === 'cleave' && !e.weapon.ranged && !p.turn.oncePerTurn.includes('cleave'))
    next = setTurn(next, p.id, (t) => ({ ...t, cleaveFrom: e.weapon.key }));
  return addLog(
    next,
    `${p.name}: traff${target ? ` ${targetName(state, target)}` : ''}${m ? ` (${e.weapon.mastery})` : ''}`,
    p.id,
  );
}

function changeHp(state: CombatState, id: string, delta: number): CombatState {
  return updateParticipant(state, id, (p) => {
    if (!p.hp) return p;
    const removed = Math.min(p.hp.max, Math.max(0, p.hp.removed + delta));
    return {
      ...p,
      hp: { ...p.hp, removed },
      defeated: removed >= p.hp.max ? true : delta < 0 ? false : p.defeated,
    };
  });
}

/**
 * Deltakeren er nede (0 HP eller ute av kampen): konsentrasjonen er borte uten sjekk, ventende sjekker
 * fjernes, og Help fra den gjelder ikke lenger.
 */
function knockOut(state: CombatState, id: string): CombatState {
  const next = dropConcentration(state, id, 'nede');
  return removeEffects(
    { ...next, checks: next.checks.filter((k) => k.who !== id) },
    (e) => e.kind === 'help' && e.source === id,
  );
}

function amount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * Ren funksjon for alt som skjer i turen og i kampen. Valg som `canDo` sier nei til, endrer ingenting,
 * så en dobbel melding fra en annen enhet ikke bruker action to ganger.
 */
export function turReducer(state: CombatState, event: TurnEvent): CombatState {
  switch (event.type) {
    case 'action': {
      const p = who(state, event.who);
      if (!p || !canDo(state, { who: p.id, kind: 'action', action: event.action }).ok) return state;
      return actionEvent(state, p, event);
    }
    case 'option': {
      const p = who(state, event.who);
      if (!p || !canDo(state, { who: p.id, kind: 'option', option: event.option }).ok) return state;
      const o = event.option;
      let next = setTurn(state, p.id, (t) => ({
        ...t,
        ...(o.cost === 'bonus' ? { bonus: o.id } : {}),
        ...(o.cost === 'reaction' ? { reaction: o.id } : {}),
        ...(o.cost === 'action' ? { action: 'magic' as const } : {}),
      }));
      const target = event.target ?? null;
      if (o.startsConcentration) next = startConcentration(next, p.id, o.startsConcentration, target);
      if (o.requiresConcentration) {
        next = {
          ...next,
          effects: next.effects.map((x) =>
            x.kind === 'concentration' && x.source === p.id ? { ...x, target } : x,
          ),
        };
      }
      const label = o.cost === 'bonus' ? 'Bonus action' : o.cost === 'reaction' ? 'Reaction' : 'Valg';
      return addLog(
        next,
        `${p.name}: ${label}: ${o.name}${target ? ` → ${targetName(state, target)}` : ''}`,
        p.id,
      );
    }
    case 'attack': {
      const p = who(state, event.who);
      if (!p || !canDo(state, { who: p.id, kind: 'attack', weapon: event.weapon, attack: event.attack }).ok)
        return state;
      return attackEvent(state, p, event);
    }
    case 'hit': {
      const p = who(state, event.who);
      // Bare etter et angrep med samme våpen, og bare én gang per angrep.
      if (!p || p.turn.pendingHit == null || p.turn.pendingHit !== event.weapon.key) return state;
      return hitEvent(state, p, event);
    }
    case 'extraDamage': {
      const p = who(state, event.who);
      const opt: TurnOption = {
        who: p?.id,
        kind: 'extraDamage',
        damage: event.damage,
        target: event.target ?? null,
      };
      if (!p || !canDo(state, opt).ok) return state;
      const d = event.damage;
      const next = d.oncePerTurn
        ? setTurn(state, p.id, (t) => ({ ...t, oncePerTurn: [...t.oncePerTurn, d.id] }))
        : state;
      return d.oncePerTurn ? addLog(next, `${p.name}: ${d.label}`, p.id) : next;
    }
    case 'move': {
      const p = who(state, event.who);
      const feet = amount(event.feet);
      if (!p || feet === 0 || !canDo(state, { who: p.id, kind: 'move', feet }).ok) return state;
      return setTurn(state, p.id, (t) => ({ ...t, moved: t.moved + feet }));
    }
    case 'standUp': {
      const p = who(state, event.who);
      if (!p || !canDo(state, { who: p.id, kind: 'standUp' }).ok) return state;
      const cost = standUpCost(state, p.id);
      const next = updateParticipant(state, p.id, (x) => ({
        ...x,
        conditions: x.conditions.filter((c) => c !== 'prone'),
        turn: { ...x.turn, moved: x.turn.moved + cost },
      }));
      return addLog(next, `${p.name} reiser seg (${cost} ft)`, p.id);
    }
    case 'concentrate': {
      const p = who(state, event.who);
      if (!p) return state;
      return addLog(
        startConcentration(state, p.id, event.spell, event.target ?? null),
        `${p.name}: konsentrasjon på ${event.spell}`,
        p.id,
      );
    }
    case 'endConcentration': {
      const p = who(state, event.who);
      return p ? dropConcentration(state, p.id, 'avsluttet') : state;
    }
    case 'damaged': {
      const p = participant(state, event.who);
      const n = amount(event.amount);
      if (!p || n === 0) return state;
      let next = addLog(
        changeHp(state, p.id, n),
        `${p.name} tok ${n} skade${event.crit ? ' (kritisk treff)' : ''}`,
        p.id,
      );
      const after = participant(next, p.id);
      if (after?.defeated && !p.defeated)
        return knockOut(addLog(next, `${p.name} er nede (0 HP)`, p.id), p.id);
      const c = concentration(next, p.id);
      if (c) {
        const seq = next.seq + 1;
        const dc = concentrationDc(n);
        next = {
          ...next,
          seq,
          checks: [
            ...next.checks,
            { id: `k${seq}`, kind: 'concentration', who: p.id, dc, spell: c.spell ?? '' },
          ],
        };
      }
      return next;
    }
    case 'healed': {
      const p = participant(state, event.who);
      const n = amount(event.amount);
      if (!p || n === 0) return state;
      return addLog(changeHp(state, p.id, -n), `${p.name} fikk ${n} HP`, p.id);
    }
    case 'concentrationSave': {
      const check = state.checks.find((k) =>
        event.checkId ? k.id === event.checkId : k.who === (event.who ?? state.current),
      );
      if (!check) return state;
      const rest = { ...state, checks: state.checks.filter((k) => k !== check) };
      const name = participant(state, check.who)?.name ?? check.who;
      if (event.total >= check.dc)
        return addLog(
          rest,
          `${name}: konsentrasjon (DC ${check.dc}): ${event.total} → holder ${check.spell}`,
          check.who,
        );
      return dropConcentration(
        addLog(rest, `${name}: konsentrasjon (DC ${check.dc}): ${event.total} → bom`, check.who),
        check.who,
        'bommet på konsentrasjonssjekken',
      );
    }
    case 'obey': {
      const p = who(state, event.who);
      if (!p || p.limits.obeyDc == null || p.turn.obey !== 'pending') return state;
      const ok = event.total >= p.limits.obeyDc;
      const next = setTurn(state, p.id, (t) => ({ ...t, obey: ok ? 'ok' : 'failed' }));
      return addLog(
        next,
        `${p.name} – Animal Handling: ${event.total} mot DC ${p.limits.obeyDc} → ${ok ? 'adlyder' : 'adlyder ikke'}`,
        p.id,
      );
    }
    case 'condition': {
      const p = participant(state, event.who);
      if (!p) return state;
      const has = p.conditions.includes(event.condition);
      if (has === event.on) return state;
      const conditions = event.on
        ? [...p.conditions, event.condition]
        : p.conditions.filter((c) => c !== event.condition);
      let next = updateParticipant(state, p.id, (x) => ({ ...x, conditions }));
      // Grappled: husk hvem som holder, så angrep mot den ikke får disadvantage.
      if (event.condition === 'grappled') {
        next = removeEffects(next, (e) => e.kind === 'grapple' && e.target === p.id);
        if (event.on && event.source)
          next = addEffect(next, { kind: 'grapple', source: event.source, target: p.id, ends: null });
      }
      const name = CONDITION_DEFS[event.condition].name;
      next = addLog(next, `${p.name}: ${event.on ? '' : 'ikke lenger '}${name}`, p.id);
      // Incapacitated (også via Unconscious, Stunned osv.) bryter konsentrasjonen.
      if (event.on && conditionWith(conditions, 'incapacitated')) next = dropConcentration(next, p.id, name);
      return next;
    }
    case 'darkness':
      return state.darkness === event.on
        ? state
        : addLog({ ...state, darkness: event.on }, event.on ? 'Mørke' : 'Ikke mørke lenger', null);
    case 'defeated': {
      const p = participant(state, event.who);
      if (!p || p.defeated === event.on) return state;
      const next = addLog(
        updateParticipant(state, p.id, (x) => ({ ...x, defeated: event.on })),
        `${p.name} er ${event.on ? 'ute av kampen' : 'tilbake i kampen'}`,
        p.id,
      );
      return event.on ? knockOut(next, p.id) : next;
    }
    case 'exhaustion': {
      const p = participant(state, event.who);
      const level = Math.max(0, Math.min(6, amount(event.level)));
      if (!p || (p.exhaustion ?? 0) === level) return state;
      return addLog(
        updateParticipant(state, p.id, (x) => ({ ...x, exhaustion: level })),
        `${p.name}: exhaustion ${level}`,
        p.id,
      );
    }
    case 'effect':
      return addEffect(state, event.effect);
    case 'removeEffect':
      return removeEffects(state, (e) => e.id === event.id);
    case 'endTurn':
      return endTurn(state, event.who ?? state.current);
    case 'selectTurn':
      return selectTurn(state, event.who);
    case 'nextRound':
      return nextRound(state);
    case 'vanished': {
      const p = participant(state, event.who ?? FAMILIAR_ID);
      if (!p) return state;
      const next = addLog(
        state,
        `${p.name} forsvant (0 HP). Den kommer tilbake når du kaster Find Familiar igjen.`,
        p.id,
      );
      return removeParticipant(knockOut(next, p.id), p.id);
    }
    case 'log':
      return addLog(state, event.text, event.who ?? state.current);
  }
}

/**
 * Skade på familiaren i kamp. HP bor i `GameState`, så begge tilstandene oppdateres: skaden logges, og på
 * 0 HP forsvinner familiaren fra spillet og fra kampen (se `vanished`).
 */
export function damageFamiliarInCombat(
  combat: CombatState,
  game: GameState,
  n: number,
): { combat: CombatState; game: GameState; vanished: boolean } {
  const r = damageFamiliar(game, n);
  if (r.state === game) return { combat, game, vanished: false };
  let next = turReducer(combat, { type: 'damaged', who: FAMILIAR_ID, amount: n });
  if (r.vanished) next = turReducer(next, { type: 'vanished', who: FAMILIAR_ID });
  return { combat: next, game: r.state, vanished: r.vanished };
}

import { ACTION_IDS, CONDITIONS, COMBAT_VERSION, LOG_MAX } from '@dnd/rules';
import type {
  CombatEffect,
  CombatState,
  EffectEnd,
  LogEntry,
  Participant,
  PendingCheck,
  RuleFlag,
  TurnLimits,
  TurnState,
} from '@dnd/rules';
import { z } from 'zod';
import { gameStateEnvelopeSchema } from './games.ts';

// Kontrakten for kamp (fase 3b, `dd_combats`). Typene i @dnd/rules er fasit, og `combat.test.ts`
// sjekker at skjemaene og typene er like.

const id = z.string().min(1).max(64);
const count = z.number().int().min(0).max(100_000);
const signed = z.number().int().min(-1000).max(1000);
const label = z.string().max(200);

/** Holdes lik `RuleFlag` i `features.ts` (sjekkes i testen). */
const RULE_FLAGS = [
  'no-ranged-melee-disadvantage',
  'no-long-range-disadvantage',
  'ignore-cover',
  'climb-swim',
] as const satisfies readonly RuleFlag[];

export const turnLimitsSchema = z.object({
  attacksPerAction: z.number().int().min(0).max(20),
  speed: count,
  firstTurnSpeed: count,
  canAttack: z.boolean(),
  obeyDc: z.number().int().min(0).max(40).nullable(),
  flags: z.array(z.enum(RULE_FLAGS)).max(RULE_FLAGS.length),
  darknessAdvantage: label.nullable(),
}) satisfies z.ZodType<TurnLimits>;

export const turnStateSchema = z.object({
  action: z.enum(ACTION_IDS).nullable(),
  attacksLeft: z.number().int().min(0).max(20),
  bonus: label.nullable(),
  reaction: label.nullable(),
  moved: count,
  speed: count,
  dashes: z.number().int().min(0).max(20),
  lightFrom: id.nullable(),
  lightUsed: z.boolean(),
  cleaveFrom: id.nullable(),
  oncePerTurn: z.array(id).max(50),
  pendingHit: id.nullable(),
  obey: z.enum(['pending', 'ok', 'failed']).nullable(),
}) satisfies z.ZodType<TurnState>;

export const participantSchema = z.object({
  id,
  kind: z.enum(['character', 'pet', 'familiar', 'companion', 'enemy', 'npc']),
  name: z.string().max(255),
  refId: id.nullable(),
  initiativeBonus: z.number().int().min(-20).max(30),
  initiative: signed.nullable(),
  roll: z.number().int().min(1).max(20).nullable(),
  hp: z.object({ max: count, removed: count }).nullable(),
  ac: z.number().int().min(0).max(50).nullable(),
  conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length),
  exhaustion: z.number().int().min(0).max(10),
  limits: turnLimitsSchema,
  turn: turnStateSchema,
  turns: count,
  turnRound: count,
  defeated: z.boolean(),
  notes: z.string().max(5000),
}) satisfies z.ZodType<Participant>;

export const effectEndSchema = z.object({
  at: z.enum(['startOfTurn', 'endOfTurn']),
  of: id,
  turn: count,
}) satisfies z.ZodType<EffectEnd>;

export const combatEffectSchema = z.object({
  id,
  kind: z.enum([
    'concentration',
    'help',
    'hidden',
    'vex',
    'sap',
    'slow',
    'dodge',
    'disengage',
    'grapple',
    'custom',
  ]),
  source: id,
  target: id.nullable(),
  spell: label.optional(),
  against: id.nullable().optional(),
  ends: effectEndSchema.nullable(),
  text: z.string().max(500).optional(),
}) satisfies z.ZodType<CombatEffect>;

export const pendingCheckSchema = z.object({
  id,
  kind: z.literal('concentration'),
  who: id,
  dc: z.number().int().min(0).max(40),
  spell: label,
}) satisfies z.ZodType<PendingCheck>;

export const logEntrySchema = z.object({
  id: count,
  round: count,
  who: id.nullable(),
  text: z.string().max(1000),
}) satisfies z.ZodType<LogEntry>;

/**
 * `dd_combats.state`. Kampen avsluttes bare med `POST …/combat/end`, så PUT godtar ikke `ended`.
 * Ellers er formen den samme som i regelmotoren.
 */
export const combatStateSchema = z.object({
  v: z.literal(COMBAT_VERSION),
  status: z.enum(['setup', 'active', 'ended']),
  round: count,
  participants: z.array(participantSchema).max(100),
  current: id.nullable(),
  done: z.array(id).max(100),
  darkness: z.boolean(),
  effects: z.array(combatEffectSchema).max(200),
  checks: z.array(pendingCheckSchema).max(100),
  log: z.array(logEntrySchema).max(LOG_MAX),
  seq: count,
}) satisfies z.ZodType<CombatState>;

export const COMBAT_STATUSES = ['active', 'ended'] as const;
export const combatStatusSchema = z.enum(COMBAT_STATUSES);
export type CombatStatus = z.infer<typeof combatStatusSchema>;

/** En kamp med versjon (5.3). `status` er raden: `active` dekker både oppsett og runder. */
export const combatEnvelopeSchema = z.object({
  id: z.number().int().positive(),
  status: combatStatusSchema,
  round: count,
  state: combatStateSchema,
  version: z.number().int().min(1),
  /** ISO-tid. */
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type CombatEnvelope = z.infer<typeof combatEnvelopeSchema>;

/** GET /api/games/:id/combat. `combat` er null når ingen kamp pågår. */
export const combatResponseSchema = z.object({ combat: combatEnvelopeSchema.nullable() });
export type CombatResponse = z.infer<typeof combatResponseSchema>;

/**
 * POST /api/games/:id/combat (body). Serveren lager oppsettet fra arket og spilltilstanden
 * (`combatFromGame`). Svarer 201 med kampen, eller 409 `combat_exists` med kampen som pågår.
 */
export const startCombatRequestSchema = z.strictObject({
  /** Egne følgesvenner som ikke er med. */
  excludeCompanions: z.array(id).max(50).optional(),
});
export type StartCombatRequest = z.infer<typeof startCombatRequestSchema>;

/** PUT /api/games/:id/combat (body). `id` er kampen, `version` er versjonen klienten bygde på. */
export const putCombatRequestSchema = z.strictObject({
  id: z.number().int().positive(),
  state: combatStateSchema.refine((s) => s.status !== 'ended', {
    message: 'Avslutt kampen med POST …/combat/end',
  }),
  version: z.number().int().min(1),
});
export type PutCombatRequest = z.infer<typeof putCombatRequestSchema>;

/**
 * POST /api/games/:id/combat/end (body). Avslutter kampen med tilstanden som er lagret, så lagre
 * først. Conditions og exhaustion på karakteren skrives tilbake til spilltilstanden.
 */
export const endCombatRequestSchema = z.strictObject({ id: z.number().int().positive() });
export type EndCombatRequest = z.infer<typeof endCombatRequestSchema>;

/** Svar fra POST …/combat/end: kampen som ble avsluttet, og ny spilltilstand. */
export const endCombatResponseSchema = z.object({
  combat: combatEnvelopeSchema,
  state: gameStateEnvelopeSchema,
});
export type EndCombatResponse = z.infer<typeof endCombatResponseSchema>;

/**
 * 409 fra kamp-rutene. `version_conflict`: PUT bygde på en gammel versjon, eller kampen er avsluttet
 * (da er `combat` null eller en annen kamp). `combat_exists`: POST mens en kamp pågår.
 */
export const combatConflictSchema = z.object({
  error: z.enum(['version_conflict', 'combat_exists']),
  message: z.string(),
  combat: combatEnvelopeSchema.nullable(),
});
export type CombatConflict = z.infer<typeof combatConflictSchema>;

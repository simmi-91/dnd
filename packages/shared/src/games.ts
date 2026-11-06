import { FAMILIAR_CREATURE_TYPES, FAMILIAR_FORM_IDS } from '@dnd/rules';
import type { Companion, FamiliarState, GameState, PetState, PetTrait, Sheet } from '@dnd/rules';
import { z } from 'zod';

// Kontrakten for spill, karakterer og spilltilstand (fase 2b). Typene i @dnd/rules er fasit.
// `games.test.ts` sjekker at skjemaene og typene er like, så avvik stopper typecheck.

const count = z.number().int().min(0).max(10_000);
const id = z.string().min(1).max(64);
const shortText = z.string().max(200);

const DELTA_KINDS = ['attack', 'damage', 'ac', 'hp', 'speed'] as const;

export const petTraitSchema = z.discriminatedUnion('kind', [
  z.object({
    id,
    kind: z.literal('ability'),
    stat: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
    delta: z.number().int().min(-30).max(30),
  }),
  z.object({ id, kind: z.enum(DELTA_KINDS), delta: z.number().int().min(-1000).max(1000) }),
  z.object({ id, kind: z.literal('maxCrit') }),
  z.object({ id, kind: z.literal('obey'), dc: z.number().int().min(0).max(40) }),
  z.object({ id, kind: z.literal('note'), text: z.string().max(2000) }),
]) satisfies z.ZodType<PetTrait>;

export const petStateSchema = z.object({
  traits: z.array(petTraitSchema).max(50),
  hpRemoved: count,
  inCombat: z.boolean(),
}) satisfies z.ZodType<PetState>;

export const companionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  kind: shortText.optional(),
  ac: z.number().int().min(0).max(50).optional(),
  hpMax: z.number().int().min(0).max(10_000).optional(),
  hpRemoved: count.optional(),
  initiativeBonus: z.number().int().min(-20).max(30),
  canAttack: z.boolean().optional(),
  speed: z.number().int().min(0).max(1000).optional(),
  notes: z.string().max(5000).optional(),
}) satisfies z.ZodType<Companion>;

export const familiarSchema = z.object({
  form: z.enum(FAMILIAR_FORM_IDS),
  name: z.string().trim().min(1).max(100),
  hpRemoved: count,
  present: z.boolean(),
  creatureType: z.enum(FAMILIAR_CREATURE_TYPES).optional(),
}) satisfies z.ZodType<FamiliarState>;

const countMap = z.record(z.string().max(64), count);

/** `dd_game_state.state`. Brukes av serveren til å sjekke PUT. */
export const gameStateSchema = z.object({
  hpRemoved: count,
  tempHp: count,
  resources: countMap,
  slotsUsed: countMap,
  hitDiceUsed: countMap,
  exhaustion: z.number().int().min(0).max(10),
  conditions: z.array(z.string().max(64)).max(50),
  deathSaves: z.object({
    successes: z.number().int().min(0).max(3),
    failures: z.number().int().min(0).max(3),
  }),
  pets: z.record(id, petStateSchema),
  companions: z.array(companionSchema).max(50),
  familiar: familiarSchema.optional(),
}) satisfies z.ZodType<GameState>;

/** Arket fra `deriveCharacter`. Serveren lager det selv, så her sjekkes bare at det er et objekt. */
export const sheetSchema = z.custom<Sheet>(
  (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Sheet).name === 'string',
);

/** Spilltilstanden med versjon (5.3). */
export const gameStateEnvelopeSchema = z.object({
  state: gameStateSchema,
  version: z.number().int().min(1),
});
export type GameStateEnvelope = z.infer<typeof gameStateEnvelopeSchema>;

// ---------- D&D Beyond ----------

/** Lenke til karakteren på D&D Beyond, eller bare ID-en. */
export const ddbRefSchema = z.string().trim().min(1).max(500);

/** POST /api/ddb/preview (body) */
export const ddbPreviewRequestSchema = z.object({ ddbUrlOrId: ddbRefSchema });
export type DdbPreviewRequest = z.infer<typeof ddbPreviewRequestSchema>;

/** Kort sammendrag av et ark. */
export const characterSummarySchema = z.object({
  name: z.string(),
  summary: z.string(),
  level: z.number().int(),
  hpMax: z.number().int(),
  ac: z.number().int(),
});
export type CharacterSummary = z.infer<typeof characterSummarySchema>;

/** Svar fra POST /api/ddb/preview */
export const ddbPreviewResponseSchema = z.object({
  character: characterSummarySchema,
  sheet: sheetSchema,
});
export type DdbPreviewResponse = z.infer<typeof ddbPreviewResponseSchema>;

// ---------- Spill ----------

export const GAME_STATUSES = ['active', 'archived'] as const;
export const gameStatusSchema = z.enum(GAME_STATUSES);
export type GameStatus = z.infer<typeof gameStatusSchema>;

/** Forhåndsvalgte fargetemaer for kortet i «Mine spill». Web bestemmer hvordan de ser ut. */
export const GAME_COVERS = ['pergament', 'frost', 'lego', 'skog', 'ild', 'natt'] as const;
export const gameCoverSchema = z.enum(GAME_COVERS);
export type GameCover = z.infer<typeof gameCoverSchema>;
export const DEFAULT_GAME_COVER: GameCover = 'pergament';

export const gameNameSchema = z.string().trim().min(1).max(100);

/** Karakteren som er koblet til et spill. */
export const gameCharacterSchema = characterSummarySchema.extend({
  id: z.number().int(),
  /** ISO-tid for siste henting fra D&D Beyond eller innliming. */
  importedAt: z.string(),
  deriveVersion: z.number().int(),
  /** Arket er regnet ut med en eldre `DERIVE_VERSION`. Vises som før, og regnes ut på nytt ved neste henting. */
  outdated: z.boolean(),
});
export type GameCharacter = z.infer<typeof gameCharacterSchema>;

export const gameSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: gameStatusSchema,
  cover: gameCoverSchema,
  character: gameCharacterSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Runden i kampen som pågår. Bare i listen (GET /api/games), og null uten kamp. */
  combatRound: z.number().int().min(0).nullable().optional(),
});
export type Game = z.infer<typeof gameSchema>;

/** GET /api/games. Aktive først, så sist endret. */
export const gamesResponseSchema = z.object({ games: z.array(gameSchema) });
export type GamesResponse = z.infer<typeof gamesResponseSchema>;

/** Rå JSON fra D&D Beyond, limt inn som tekst eller sendt som objekt. */
export const ddbJsonSchema = z.union([z.string().min(1), z.record(z.string(), z.unknown())]);

/**
 * POST /api/games (body). Enten `ddbUrlOrId` (hentes fra D&D Beyond) eller `json` (limt inn),
 * aldri begge. Body-grensen er 2 MB, som for paste.
 */
export const createGameRequestSchema = z.union([
  z.strictObject({ name: gameNameSchema, ddbUrlOrId: ddbRefSchema, cover: gameCoverSchema.optional() }),
  z.strictObject({ name: gameNameSchema, json: ddbJsonSchema, cover: gameCoverSchema.optional() }),
]);
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

/**
 * PATCH /api/games/:id (body). Alle felt er valgfrie, men minst ett må være med.
 * `ddbUrlOrId` bytter karakter: arket hentes, og tilstanden starter på nytt.
 */
export const updateGameRequestSchema = z
  .object({
    name: gameNameSchema.optional(),
    status: gameStatusSchema.optional(),
    cover: gameCoverSchema.optional(),
    ddbUrlOrId: ddbRefSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Ingen endringer' });
export type UpdateGameRequest = z.infer<typeof updateGameRequestSchema>;

/** Svar fra POST /api/games, GET og PATCH /api/games/:id. */
export const gameDetailResponseSchema = z.object({
  game: gameSchema,
  sheet: sheetSchema.nullable(),
  state: gameStateEnvelopeSchema,
});
export type GameDetailResponse = z.infer<typeof gameDetailResponseSchema>;

/** POST /api/games/:id/character/refresh (body) */
export const refreshCharacterRequestSchema = z.object({
  /** Hent også HP og brukte ressurser fra D&D Beyond. */
  alsoHpAndResources: z.boolean().default(false),
});
export type RefreshCharacterRequest = z.input<typeof refreshCharacterRequestSchema>;

/** POST /api/games/:id/character/paste (body). Rå JSON fra D&D Beyond, som tekst eller objekt. */
export const pasteCharacterRequestSchema = z.object({
  json: ddbJsonSchema,
  alsoHpAndResources: z.boolean().default(false),
});
export type PasteCharacterRequest = z.input<typeof pasteCharacterRequestSchema>;

/** Svar fra refresh og paste. `newFeatures` er evnene som kom med et nytt nivå. */
export const refreshCharacterResponseSchema = gameDetailResponseSchema.extend({
  newFeatures: z.array(
    z.object({ name: z.string(), level: z.number(), cls: z.string(), sub: z.boolean(), desc: z.string() }),
  ),
});
export type RefreshCharacterResponse = z.infer<typeof refreshCharacterResponseSchema>;

/** PUT /api/games/:id/state (body). `version` er versjonen klienten bygde på. */
export const putGameStateRequestSchema = gameStateEnvelopeSchema;
export type PutGameStateRequest = GameStateEnvelope;

/** 409 fra PUT /api/games/:id/state: gjeldende tilstand på serveren. */
export const stateConflictSchema = z.object({
  error: z.literal('version_conflict'),
  message: z.string(),
  state: gameStateSchema,
  version: z.number().int(),
});
export type StateConflict = z.infer<typeof stateConflictSchema>;

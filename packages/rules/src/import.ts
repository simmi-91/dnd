// Fletteregler ved import og ny henting fra D&D Beyond (UTVIKLINGSPLAN 5.2, byggebeskrivelsen «Lagring og tilstand»).
import type { Companion } from './companions.ts';
import type { FamiliarState } from './familiar.ts';
import { seedPetTraits, type PetTrait } from './pets.ts';
import type { Feature, Pet, Sheet } from './sheet.ts';
import { counterIds } from './util.ts';

export interface PetState {
  traits: PetTrait[];
  hpRemoved: number;
  inCombat: boolean;
}

/** Varig spilltilstand (`dd_game_state.state`). */
export interface GameState {
  hpRemoved: number;
  tempHp: number;
  /** Brukte ganger per ressursnøkkel (`Sheet.resources[].key`). */
  resources: Record<string, number>;
  /** Brukte slots per nivå (`'1'`–`'9'`) og `'pact'`. */
  slotsUsed: Record<string, number>;
  /** Brukte hit dice per terning (`'d10'`). */
  hitDiceUsed: Record<string, number>;
  exhaustion: number;
  conditions: string[];
  deathSaves: { successes: number; failures: number };
  pets: Record<string, PetState>;
  companions: Companion[];
  /** Familiar fra Find Familiar. Mangler i eldre tilstand og når spillet ikke har noen. */
  familiar?: FamiliarState;
}

export interface MergeOptions {
  /** Hent også HP og brukte ressurser fra D&D Beyond. */
  alsoHpAndResources: boolean;
  makeId?: () => string;
}

function hpAndResources(
  sheet: Sheet,
): Pick<GameState, 'hpRemoved' | 'tempHp' | 'resources' | 'slotsUsed' | 'hitDiceUsed'> {
  return {
    hpRemoved: Math.min(sheet.hpMax, Math.max(0, sheet.hpRemoved)),
    tempHp: Math.max(0, sheet.tempHp),
    resources: Object.fromEntries(sheet.resources.filter((r) => r.used > 0).map((r) => [r.key, r.used])),
    slotsUsed: { ...sheet.slotsUsed },
    hitDiceUsed: Object.fromEntries(
      sheet.hitDice.filter((h) => h.used > 0).map((h) => [`d${h.die}`, h.used]),
    ),
  };
}

function newPetState(pet: Pet, makeId: () => string): PetState {
  return { traits: seedPetTraits(pet.notes, makeId), hpRemoved: pet.hpRemoved, inCombat: true };
}

/** Tilstand ved første import: HP og brukte ressurser fra D&D Beyond, kjæledyr med trekk fra notatet. */
export function initialGameState(sheet: Sheet, makeId: () => string = counterIds()): GameState {
  return {
    ...hpAndResources(sheet),
    exhaustion: 0,
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    pets: Object.fromEntries(sheet.pets.map((p) => [p.id, newPetState(p, makeId)])),
    companions: [],
  };
}

/** Beholder bare nøkler som fortsatt finnes, og holder verdiene innenfor maks. */
function clampUsed(used: Record<string, number>, max: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(used)) {
    const m = max[k];
    if (m != null && v > 0) out[k] = Math.min(v, m);
  }
  return out;
}

/**
 * Ny henting fra D&D Beyond. Arket byttes alltid (det lagres for seg), så her flettes bare tilstanden:
 * - HP og brukte ressurser hentes bare med `alsoHpAndResources`. Ellers beholdes appens egne tall.
 * - Kjæledyr som finnes fra før beholder trekkene. Nye får trekk fra notatet. Borte kjæledyr
 *   beholdes i tilstanden, men vises ikke, fordi de ikke står i arket.
 * - Følgesvenner, exhaustion, conditions og death saves eies av appen og beholdes.
 */
export function mergeOnRefresh(prev: GameState, sheet: Sheet, opts: MergeOptions): GameState {
  // Trekk-ID-ene trenger bare å være unike innenfor ett kjæledyr.
  const makeId = opts.makeId ?? counterIds();
  const fresh = hpAndResources(sheet);
  // Kjæledyr som er borte fra D&D Beyond, beholdes med trekk og HP, så de er der hvis dyret kommer
  // tilbake. Hvilke dyr som finnes, står i arket (`sheet.pets`).
  const pets: Record<string, PetState> = Object.fromEntries(
    Object.entries(prev.pets).map(([id, old]) => [id, { ...old, traits: [...old.traits] }]),
  );
  for (const p of sheet.pets) {
    const old = prev.pets[p.id];
    pets[p.id] = old
      ? { ...old, traits: [...old.traits], hpRemoved: opts.alsoHpAndResources ? p.hpRemoved : old.hpRemoved }
      : newPetState(p, makeId);
  }
  const base = opts.alsoHpAndResources
    ? fresh
    : {
        hpRemoved: Math.min(sheet.hpMax, Math.max(0, prev.hpRemoved)),
        tempHp: prev.tempHp,
        resources: clampUsed(prev.resources, Object.fromEntries(sheet.resources.map((r) => [r.key, r.max]))),
        slotsUsed: clampUsed(prev.slotsUsed, {
          ...sheet.slots,
          ...(sheet.pactSlots ? { pact: sheet.pactSlots.count } : {}),
        }),
        hitDiceUsed: clampUsed(
          prev.hitDiceUsed,
          Object.fromEntries(sheet.hitDice.map((h) => [`d${h.die}`, h.total])),
        ),
      };
  return {
    ...base,
    exhaustion: prev.exhaustion,
    conditions: [...prev.conditions],
    deathSaves: { ...prev.deathSaves },
    pets,
    companions: prev.companions.map((c) => ({ ...c })),
    ...(prev.familiar ? { familiar: { ...prev.familiar } } : {}),
  };
}

function featureKey(f: Feature): string {
  return `${f.cls}|${f.name}|${f.level}`;
}

/** Evnene som kom med det nye nivået (finnes i det nye arket, men ikke i det gamle). */
export function newFeatures(oldSheet: Sheet | null | undefined, newSheet: Sheet): Feature[] {
  if (!oldSheet) return [];
  const old = new Set(oldSheet.features.map(featureKey));
  return newSheet.features.filter((f) => !old.has(featureKey(f)));
}

// Spell slots etter 2024-reglene (Player's Handbook 2024, «Multiclassing»).
import type { SlotMap } from './sheet.ts';

/** Multiclass Spellcaster-tabellen: slots per spell-nivå (indeks 0 = nivå 1) for caster-nivå 1–20. */
export const MULTICLASS_SLOTS: readonly (readonly number[])[] = [
  [],
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Warlock Pact Magic: [antall slots, slot-nivå] for Warlock-nivå 1–20. */
const PACT: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2],
  [2, 3],
  [2, 3],
  [2, 4],
  [2, 4],
  [2, 5],
  [2, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [4, 5],
  [4, 5],
  [4, 5],
  [4, 5],
];

export interface CasterClass {
  level: number;
  /** 1 = full, 2 = half, 3 = third. */
  divisor: number;
  /** Rund opp (2024 half casters) eller ned (third casters). */
  roundUp: boolean;
  /** Klassens egen tabell (D&D Beyond `levelSpellSlots`), indeksert på klassenivå. */
  table?: readonly (readonly number[])[] | null;
}

export function toSlotMap(row: readonly number[] | undefined): SlotMap {
  const out: SlotMap = {};
  (row ?? []).forEach((n, i) => {
    if (n > 0) out[i + 1] = n;
  });
  return out;
}

export function casterLevel(casters: readonly CasterClass[]): number {
  return casters.reduce((total, c) => {
    const d = c.divisor > 0 ? c.divisor : 1;
    return total + (d === 1 ? c.level : c.roundUp ? Math.ceil(c.level / d) : Math.floor(c.level / d));
  }, 0);
}

/**
 * Slots fra alle klasser som har Spellcasting (Warlock regnes for seg, se `pactSlots`).
 * Én klasse: klassens egen tabell. Flere: den samlede multiclass-tabellen.
 */
export function spellSlots(casters: readonly CasterClass[]): SlotMap {
  const active = casters.filter((c) => c.level > 0);
  if (active.length === 0) return {};
  const only = active.length === 1 ? active[0] : undefined;
  if (only?.table?.[only.level]) return toSlotMap(only.table[only.level]);
  const lvl = Math.min(20, casterLevel(active));
  return toSlotMap(MULTICLASS_SLOTS[lvl]);
}

export function pactSlots(warlockLevel: number): { level: number; count: number } | null {
  const row = PACT[Math.min(20, Math.max(0, warlockLevel))];
  if (!row || row[0] === 0) return null;
  return { count: row[0], level: row[1] };
}

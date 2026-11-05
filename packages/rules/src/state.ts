// Endringer i den varige spilltilstanden utenfor kamp: skade, helbreding, temp HP, ressurser,
// spell slots og hvile (UTVIKLINGSPLAN 7.3 «Utenfor kamp»). Alle funksjonene er rene: de
// returnerer ny tilstand og endrer aldri den gamle.
import type { Companion } from './companions.ts';
import type { GameState, PetState } from './import.ts';
import { applyPetTraits } from './pets.ts';
import type { Sheet } from './sheet.ts';

/** Nøkkel for en spell slot: nivå 1–9 eller Warlock Pact Magic. */
export type SlotKey = number | 'pact';

export interface DamageResult {
  state: GameState;
  /** DC for konsentrasjonssjekken: maks av 10 og halve skaden, høyst 30 (2024). */
  concentrationDc: number;
  /** Skade som gikk til temp HP. */
  absorbed: number;
  /** HP som faktisk ble borte (etter temp HP, og ikke under 0 HP). */
  hpLost: number;
  /** Karakteren står på 0 HP etter skaden. */
  atZero: boolean;
  /** Skaden som er igjen når HP når 0, er minst maks HP: død med en gang (Massive Damage). */
  instantDeath: boolean;
}

/**
 * Hit Dice brukt på en Short Rest. To måter, som kan blandes per terning:
 * - `rolls`: hvert slag for seg, f.eks. `{ d10: [3, 7] }`. Gir nøyaktig «minst 1 HP per terning».
 * - `hitDiceSpent` + `healed`: antall per terning og summen av alle slagene. Med negativ CON-mod
 *   kan ikke minimum per terning regnes ut nøyaktig fra summen, så da gjelder minst 1 per terning
 *   for summen samlet. Med CON-mod ≥ 0 gir hver terning alltid minst 1, og svaret er nøyaktig.
 * Står samme terning i begge, brukes `rolls`.
 */
export interface ShortRestInput {
  /** Hit Dice brukt per terning, f.eks. `{ d10: 2 }`. */
  hitDiceSpent?: Record<string, number>;
  /** Summen av slagene for terningene i `hitDiceSpent` (uten CON-mod). */
  healed?: number;
  /** Slagene per terning (uten CON-mod), f.eks. `{ d10: [3, 7] }`. */
  rolls?: Record<string, number[]>;
}

/** Heltall ≥ 0. Ugyldige tall blir 0. */
function amount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Kopierer tilstanden dypt nok til at ingen del deles med den gamle. */
function copy(state: GameState): GameState {
  return {
    ...state,
    resources: { ...state.resources },
    slotsUsed: { ...state.slotsUsed },
    hitDiceUsed: { ...state.hitDiceUsed },
    conditions: [...state.conditions],
    deathSaves: { ...state.deathSaves },
    pets: Object.fromEntries(
      Object.entries(state.pets).map(([id, p]) => [id, { ...p, traits: [...p.traits] }]),
    ),
    companions: state.companions.map((c) => ({ ...c })),
  };
}

/** Setter en telling. 0 fjernes, som i `initialGameState`. */
function setCount(map: Record<string, number>, key: string, value: number): void {
  if (value > 0) map[key] = value;
  else delete map[key];
}

// ---------- HP ----------

/** Tar skade. Temp HP tas først, og `hpRemoved` går ikke over maks HP. */
export function applyDamage(state: GameState, sheet: Sheet, n: number): DamageResult {
  const dmg = amount(n);
  const next = copy(state);
  const absorbed = Math.min(next.tempHp, dmg);
  next.tempHp -= absorbed;
  const rest = dmg - absorbed;
  const hpLeft = Math.max(0, sheet.hpMax - next.hpRemoved);
  const hpLost = Math.min(hpLeft, rest);
  next.hpRemoved = clamp(next.hpRemoved + rest, 0, sheet.hpMax);
  const atZero = next.hpRemoved >= sheet.hpMax;
  return {
    state: next,
    concentrationDc: concentrationDc(dmg),
    absorbed,
    hpLost,
    atZero,
    instantDeath: sheet.hpMax > 0 && rest - hpLost >= sheet.hpMax,
  };
}

/** DC for konsentrasjonssjekken etter skade: maks av 10 og halve skaden, høyst 30. */
export function concentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(amount(damage) / 2)));
}

/** Helbreder. Får karakteren HP igjen fra 0, nullstilles death saves. */
export function applyHealing(state: GameState, sheet: Sheet, n: number): GameState {
  const heal = amount(n);
  const next = copy(state);
  const wasDown = next.hpRemoved >= sheet.hpMax;
  next.hpRemoved = clamp(next.hpRemoved - heal, 0, sheet.hpMax);
  if (wasDown && heal > 0) next.deathSaves = { successes: 0, failures: 0 };
  return next;
}

/**
 * Temp HP stables ikke: den høyeste verdien gjelder. Med `replace` settes verdien uansett,
 * f.eks. for å rette en feil eller fjerne temp HP.
 */
export function setTempHp(state: GameState, n: number, opts: { replace?: boolean } = {}): GameState {
  const v = amount(n);
  return { ...copy(state), tempHp: opts.replace ? v : Math.max(state.tempHp, v) };
}

/** Nåværende HP. */
export function currentHp(state: GameState, sheet: Sheet): number {
  return Math.max(0, sheet.hpMax - state.hpRemoved);
}

// ---------- Kjæledyr og følgesvenner ----------

/** Maks HP for et kjæledyr med trekkene regnet inn, eller null hvis det ikke finnes i arket. */
export function petHpMax(state: GameState, sheet: Sheet, petId: string): number | null {
  const pet = sheet.pets.find((p) => p.id === petId);
  if (!pet) return null;
  return Math.max(0, applyPetTraits(pet, state.pets[petId]?.traits).hpMax);
}

function changePet(state: GameState, sheet: Sheet, petId: string, delta: number): GameState {
  const max = petHpMax(state, sheet, petId);
  const old: PetState | undefined = state.pets[petId];
  // Kjæledyr som ikke står i arket, eller som mangler i tilstanden, endres ikke.
  if (max == null || !old) return state;
  const next = copy(state);
  next.pets[petId] = { ...old, traits: [...old.traits], hpRemoved: clamp(old.hpRemoved + delta, 0, max) };
  return next;
}

/** Skade på et kjæledyr fra D&D Beyond. Holdes mellom 0 og maks HP (med trekk). */
export function damagePet(state: GameState, sheet: Sheet, petId: string, n: number): GameState {
  return changePet(state, sheet, petId, amount(n));
}

export function healPet(state: GameState, sheet: Sheet, petId: string, n: number): GameState {
  return changePet(state, sheet, petId, -amount(n));
}

function changeCompanion(state: GameState, id: string, delta: number): GameState {
  const idx = state.companions.findIndex((c) => c.id === id);
  const c: Companion | undefined = state.companions[idx];
  // Følgesvenner uten maks HP har ingen HP å holde rede på.
  if (!c || c.hpMax == null) return state;
  const next = copy(state);
  next.companions[idx] = { ...c, hpRemoved: clamp((c.hpRemoved ?? 0) + delta, 0, Math.max(0, c.hpMax)) };
  return next;
}

/** Skade på en egen følgesvenn. Følgesvenner uten `hpMax` endres ikke. */
export function damageCompanion(state: GameState, id: string, n: number): GameState {
  return changeCompanion(state, id, amount(n));
}

export function healCompanion(state: GameState, id: string, n: number): GameState {
  return changeCompanion(state, id, -amount(n));
}

// ---------- Ressurser og slots ----------

function resourceMax(sheet: Sheet, key: string): number | null {
  return sheet.resources.find((r) => r.key === key)?.max ?? null;
}

function changeResource(state: GameState, sheet: Sheet, key: string, delta: number): GameState {
  const max = resourceMax(sheet, key);
  if (max == null) return state;
  const next = copy(state);
  setCount(next.resources, key, clamp((state.resources[key] ?? 0) + delta, 0, max));
  return next;
}

/** Bruker `n` ganger av en ressurs (nøkkel fra `sheet.resources`). Ukjente nøkler endrer ingenting. */
export function spendResource(state: GameState, sheet: Sheet, key: string, n = 1): GameState {
  return changeResource(state, sheet, key, amount(n));
}

export function restoreResource(state: GameState, sheet: Sheet, key: string, n = 1): GameState {
  return changeResource(state, sheet, key, -amount(n));
}

/** Antall slots på et nivå (eller Pact-slots). */
export function slotMax(sheet: Sheet, slot: SlotKey): number {
  if (slot === 'pact') return sheet.pactSlots?.count ?? 0;
  return sheet.slots[slot] ?? 0;
}

function changeSlot(state: GameState, sheet: Sheet, slot: SlotKey, delta: number): GameState {
  const max = slotMax(sheet, slot);
  const key = String(slot);
  if (max <= 0 && !(key in state.slotsUsed)) return state;
  const next = copy(state);
  setCount(next.slotsUsed, key, clamp((state.slotsUsed[key] ?? 0) + delta, 0, max));
  return next;
}

/** Bruker en spell slot på et nivå, eller en Pact-slot med `'pact'`. */
export function spendSlot(state: GameState, sheet: Sheet, slot: SlotKey, n = 1): GameState {
  return changeSlot(state, sheet, slot, amount(n));
}

export function restoreSlot(state: GameState, sheet: Sheet, slot: SlotKey, n = 1): GameState {
  return changeSlot(state, sheet, slot, -amount(n));
}

// ---------- Hit Dice og hvile ----------

/** Hit Dice som er igjen per terning, f.eks. `{ d10: 3 }`. */
export function hitDiceLeft(state: GameState, sheet: Sheet): Record<string, number> {
  return Object.fromEntries(
    sheet.hitDice.map((h) => {
      const key = `d${h.die}`;
      return [key, Math.max(0, h.total - (state.hitDiceUsed[key] ?? 0))];
    }),
  );
}

/** HP fra Hit Dice på en Short Rest, og hvor mange terninger som brukes per størrelse. */
export function hitDiceHealing(
  state: GameState,
  sheet: Sheet,
  input: ShortRestInput,
): { heal: number; spent: Record<string, number> } {
  const left = hitDiceLeft(state, sheet);
  const con = sheet.mod.con;
  const rolls = input.rolls ?? {};
  const spent: Record<string, number> = {};
  let heal = 0;
  // Slag per terning: hver terning gir minst 1 HP. Slag holdes mellom 1 og terningens sider.
  for (const [key, list] of Object.entries(rolls)) {
    const sides = Number(key.slice(1)) || 1;
    const use = list.slice(0, left[key] ?? 0);
    if (use.length === 0) continue;
    spent[key] = use.length;
    for (const r of use) heal += Math.max(1, clamp(amount(r), 1, sides) + con);
  }
  // Sum-varianten for terninger uten egne slag: minst 1 per terning for summen samlet.
  let dice = 0;
  for (const [key, n] of Object.entries(input.hitDiceSpent ?? {})) {
    if (key in rolls) continue;
    const spend = Math.min(amount(n), left[key] ?? 0);
    if (spend === 0) continue;
    spent[key] = spend;
    dice += spend;
  }
  if (dice > 0) heal += Math.max(dice, amount(input.healed ?? 0) + con * dice);
  return { heal, spent };
}

/**
 * Short Rest. Spilleren slår Hit Dice med fysiske terninger og skriver inn slagene eller summen
 * (se `ShortRestInput`). CON-mod legges til per terning, og hver terning gir minst 1 HP. Det brukes
 * ikke flere terninger enn det er igjen. Ressurser med `reset 'short'` og Pact-slots fylles opp.
 */
export function shortRest(state: GameState, sheet: Sheet, input: ShortRestInput): GameState {
  let next = copy(state);
  const { heal, spent } = hitDiceHealing(state, sheet, input);
  for (const [key, n] of Object.entries(spent)) {
    setCount(next.hitDiceUsed, key, (next.hitDiceUsed[key] ?? 0) + n);
  }
  if (heal > 0) next = applyHealing(next, sheet, heal);
  for (const r of sheet.resources) if (r.reset === 'short') delete next.resources[r.key];
  delete next.slotsUsed.pact;
  return next;
}

/**
 * Long Rest (2024): full HP, temp HP 0, alle ressurser og slots, alle brukte Hit Dice tilbake,
 * exhaustion −1, death saves nullstilt, og alle kjæledyr og følgesvenner til full HP.
 * Conditions endres ikke.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function longRest(state: GameState, _sheet: Sheet): GameState {
  const next = copy(state);
  next.hpRemoved = 0;
  next.tempHp = 0;
  next.resources = {};
  next.slotsUsed = {};
  next.hitDiceUsed = {};
  next.exhaustion = Math.max(0, next.exhaustion - 1);
  next.deathSaves = { successes: 0, failures: 0 };
  for (const p of Object.values(next.pets)) p.hpRemoved = 0;
  for (const c of next.companions) if (c.hpRemoved != null) c.hpRemoved = 0;
  return next;
}

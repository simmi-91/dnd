import { isApiRequestError, type Schema } from '../api/client';

// Lokal lagring for bruk uten nett (fase 5). Alt ligger i localStorage under ett prefiks, så det kan
// slettes samlet ved utlogging. Lagringen er av til `enableOfflineStorage()` kalles (i main.tsx), så
// testene ikke deler data gjennom localStorage uten å be om det.

const PREFIX = 'dnd:offline:v1:';
/**
 * Markør utenfor prefikset: endres hver gang en fane tømmer lageret, så de andre fanene (gjennom
 * `storage`-eventen) også øker generasjonen og slutter å skrive.
 */
export const OFFLINE_CLEARED_KEY = 'dnd:offline-cleared';
/** Utlogging uten nett som ikke er sendt til serveren ennå. Utenfor prefikset, så `clearOffline` ikke sletter den. */
const LOGOUT_PENDING_KEY = 'dnd:logout-pending';

let enabled = false;
/**
 * Øker hver gang lageret tømmes (utlogging, 401, sperret konto, annen bruker). Den som skriver,
 * kan oppgi generasjonen den startet i, så ingenting skrives tilbake etter at lageret er tømt.
 */
let generation = 0;

export function offlineGeneration(): number {
  return generation;
}

/** Hele nøkkelen i localStorage, f.eks. for `storage`-eventen. */
export function offlineStorageKey(key: string): string {
  return PREFIX + key;
}

/** Kaller `fn` når en annen fane endrer `key` (eller tømmer lageret). */
export function onOfflineChange(key: string, fn: () => void): () => void {
  const full = PREFIX + key;
  const listener = (e: StorageEvent) => {
    if (e.key === full || e.key === null) fn();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

let listening = false;

export function enableOfflineStorage(on = true): void {
  enabled = on;
  if (on && !listening && typeof window !== 'undefined') {
    listening = true;
    // En annen fane har tømt lageret (utlogging, 401): heller ikke denne fanen skal skrive mer.
    window.addEventListener('storage', (e) => {
      if (e.key === OFFLINE_CLEARED_KEY || e.key === null) generation += 1;
    });
  }
}

export function offlineStorageEnabled(): boolean {
  return enabled;
}

function storage(): Storage | null {
  if (!enabled) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Leser og sjekker en verdi. Gir undefined hvis den mangler eller ikke passer skjemaet. */
export function readOffline<T>(key: string, schema: Schema<T>): T | undefined {
  const s = storage();
  if (!s) return undefined;
  try {
    const raw = s.getItem(PREFIX + key);
    if (raw == null) return undefined;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Skriver en verdi. Er lagringen full eller sperret, gjør det ingenting. Med `gen` skrives det bare
 * hvis lageret ikke er tømt siden.
 */
export function writeOffline(key: string, value: unknown, gen?: number): void {
  if (gen !== undefined && gen !== generation) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Full eller sperret lagring: appen virker fortsatt med nett.
  }
}

export function removeOffline(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(PREFIX + key);
  } catch {
    // Ingenting å gjøre.
  }
}

/** Sletter alt som er lagret for bruk uten nett (utlogging eller annen bruker). */
export function clearOffline(): void {
  generation += 1;
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
    s.setItem(OFFLINE_CLEARED_KEY, `${Date.now()}-${Math.random()}`);
  } catch {
    // Ingenting å gjøre.
  }
}

/** Står det en utlogging som ikke er sendt til serveren (logget ut uten nett)? */
export function isLogoutPending(): boolean {
  const s = storage();
  try {
    return s?.getItem(LOGOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLogoutPending(on: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    if (on) s.setItem(LOGOUT_PENDING_KEY, '1');
    else s.removeItem(LOGOUT_PENDING_KEY);
  } catch {
    // Ingenting å gjøre.
  }
}

/** Fikk ikke kontakt med serveren (ingen svar i det hele tatt). */
export function isNetworkError(err: unknown): boolean {
  return isApiRequestError(err) && err.status === 0;
}

/**
 * Henter fra serveren og husker svaret. Uten nett brukes det siste svaret som ble husket.
 * Andre feil (401, 404 osv.) kastes som før.
 */
export async function fetchWithOffline<T>(
  key: string,
  schema: Schema<T>,
  fetch: () => Promise<T>,
): Promise<T> {
  const gen = generation;
  try {
    const data = await fetch();
    writeOffline(key, data, gen);
    return data;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = readOffline(key, schema);
      if (cached !== undefined) return cached;
    }
    throw err;
  }
}

/** Nøklene som brukes i lagringen. */
export const offlineKeys = {
  me: 'me',
  games: 'games',
  game: (id: number) => `game:${id}`,
  combat: (gameId: number) => `combat:${gameId}`,
  stateSync: (gameId: number) => `sync:state:${gameId}`,
  combatSync: (gameId: number) => `sync:combat:${gameId}`,
};

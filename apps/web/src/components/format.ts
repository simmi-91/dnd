/** +3 eller −1 (ekte minustegn, som i regelbøkene). */
export function sign(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Negative tall med minustegn, andre som de er. */
function sign0(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

export type IntResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Leser et innskrevet heltall. Tomt felt, desimaltall og tall utenfor grensene gir en norsk feilmelding.
 * Både vanlig bindestrek og minustegn godtas foran negative tall.
 */
export function parseIntInput(raw: string, min: number, max: number): IntResult {
  const text = raw.trim().replace('−', '-').replace(/^\+/, '');
  const error = `Skriv et helt tall fra ${sign0(min)} til ${sign0(max)}.`;
  if (!/^-?\d+$/.test(text)) return { ok: false, error };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, error };
  return { ok: true, value };
}

/** Største tall som kan skrives inn for skade og helbreding. */
export const MAX_HP_INPUT = 9999;

/** Farge på HP-tallet: over halvparten, over en fjerdedel, eller lavt. */
export function hpTone(hp: number, max: number): 'good' | 'mid' | 'low' {
  if (hp > max / 2) return 'good';
  if (hp > max / 4) return 'mid';
  return 'low';
}

const MOVE: Record<number, string> = { 1: 'gå', 2: 'grave', 3: 'klatre', 4: 'fly', 5: 'svømme' };

/** «40 ft gå, 30 ft svømme» for speeds fra D&D Beyond. */
export function speedsText(speeds: { id: number; speed: number }[]): string {
  return speeds.map((s) => `${s.speed} ft${MOVE[s.id] ? ` ${MOVE[s.id]}` : ''}`).join(', ');
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Lager en ID til trekk og følgesvenner (høyst 64 tegn, som kontrakten krever). */
export function makeId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

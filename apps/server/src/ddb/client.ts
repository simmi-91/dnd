// Henting fra D&D Beyond character-service (UTVIKLINGSPLAN 5.2). Uoffisiell tjeneste, så:
// svar bufres i minnet per ID, User-Agent er tydelig, og hver bruker har en grense per time.
// Logg aldri ID-er eller rådata herfra: feil kastes som `DdbError` med fast kode.
import { DdbFormatError, deriveCharacter, unwrapDdb, type Sheet } from '@dnd/rules';

export const DDB_API = 'https://character-service.dndbeyond.com/character/v5/character/';
// Bare ASCII: D&D Beyond svarer 400 på User-Agent med andre tegn.
export const DDB_USER_AGENT = 'dnd-kampguide/1.0 (+https://dnd.3lin.no; fetches only on user request)';
const HOUR_MS = 60 * 60 * 1000;

export type DdbErrorCode =
  'ddb_invalid_ref' | 'ddb_private' | 'ddb_not_found' | 'ddb_format' | 'ddb_unavailable' | 'ddb_rate_limited';

export class DdbError extends Error {
  override name = 'DdbError';
  constructor(
    readonly code: DdbErrorCode,
    /** Sekunder til neste henting er lov (bare for `ddb_rate_limited`). */
    readonly retryAfterSeconds?: number,
    /** HTTP-status fra D&D Beyond (bare for `ddb_unavailable`, null ved nettfeil). Til logg. */
    readonly upstreamStatus?: number | null,
  ) {
    super(code);
  }
}

/** Nettfeil eller 5xx hos D&D Beyond: forsøket gis tilbake. */
function isOutage(error: unknown): boolean {
  if (!(error instanceof DdbError) || error.code !== 'ddb_unavailable') return false;
  return error.upstreamStatus == null || error.upstreamStatus >= 500;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DdbClientOptions {
  fetch?: FetchLike;
  cacheSeconds: number;
  fetchesPerHour: number;
  now?: () => number;
  timeoutMs?: number;
}

export interface DdbCharacterResult {
  ddbId: number;
  sheet: Sheet;
}

const MAX_ID = Number.MAX_SAFE_INTEGER;

/**
 * Finner karakter-ID-en i en lenke eller en ID. Godtar `123456789`,
 * `https://www.dndbeyond.com/characters/123456789(/navn)`, delingslenker
 * (`dndbeyond.com/characters/123456789/AbCdEf`) og lenker til character-service.
 */
export function parseDdbRef(input: string): number | null {
  const text = input.trim();
  if (/^\d{1,15}$/.test(text)) return toId(text);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'dndbeyond.com' && !host.endsWith('.dndbeyond.com')) return null;
  const m =
    /\/(?:characters|character\/v\d+\/character|profile\/[^/]+\/characters)\/(\d{1,15})(?:\/|$)/i.exec(
      url.pathname,
    );
  return m?.[1] ? toId(m[1]) : null;
}

function toId(digits: string): number | null {
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_ID ? n : null;
}

/** Regner ut arket fra rådata. Alle feil i formatet blir `ddb_format`. */
export function sheetFromRaw(raw: unknown): { ddbId: number | null; sheet: Sheet } {
  try {
    const d = unwrapDdb(raw);
    const id = typeof d.id === 'number' && Number.isSafeInteger(d.id) && d.id > 0 ? d.id : null;
    return { ddbId: id, sheet: deriveCharacter(raw) };
  } catch (error) {
    // Utregningen kan også feile med TypeError hvis formatet er endret på en måte unwrapDdb ikke ser.
    if (error instanceof DdbFormatError || error instanceof TypeError || error instanceof RangeError) {
      throw new DdbError('ddb_format');
    }
    throw error;
  }
}

export interface DdbClient {
  /** Henter (eller tar fra bufferen) og regner ut arket. Kaster `DdbError`. */
  fetchCharacter(userId: number, ref: string): Promise<DdbCharacterResult>;
}

export function createDdbClient(options: DdbClientOptions): DdbClient {
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const ttlMs = options.cacheSeconds * 1000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const cache = new Map<number, { expires: number; sheet: Sheet }>();
  const attempts = new Map<number, number[]>();

  function fromCache(id: number): Sheet | null {
    const t = now();
    for (const [key, entry] of cache) if (entry.expires <= t) cache.delete(key);
    return cache.get(id)?.sheet ?? null;
  }

  /** Kaster 429 hvis brukeren har nådd grensen den siste timen. */
  function checkLimit(userId: number): void {
    const t = now();
    const recent = (attempts.get(userId) ?? []).filter((at) => at > t - HOUR_MS);
    attempts.set(userId, recent);
    if (recent.length >= options.fetchesPerHour) {
      const oldest = recent[0] ?? t;
      throw new DdbError('ddb_rate_limited', Math.max(1, Math.ceil((oldest + HOUR_MS - t) / 1000)));
    }
  }

  /** Teller forsøket med en gang, så samtidige forespørsler ikke slipper forbi grensen. */
  function countAttempt(userId: number): number {
    const at = now();
    const list = attempts.get(userId) ?? [];
    list.push(at);
    attempts.set(userId, list);
    return at;
  }

  function refundAttempt(userId: number, at: number): void {
    const list = attempts.get(userId);
    const i = list?.lastIndexOf(at) ?? -1;
    if (list && i >= 0) list.splice(i, 1);
  }

  async function download(id: number): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(DDB_API + id, {
        headers: { 'User-Agent': DDB_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DdbError('ddb_unavailable', undefined, null);
    }
    if (res.status === 403 || res.status === 401) throw new DdbError('ddb_private');
    if (res.status === 404) throw new DdbError('ddb_not_found');
    if (!res.ok) throw new DdbError('ddb_unavailable', undefined, res.status);
    try {
      return await res.json();
    } catch {
      throw new DdbError('ddb_format');
    }
  }

  return {
    async fetchCharacter(userId, ref) {
      const id = parseDdbRef(ref);
      if (id == null) throw new DdbError('ddb_invalid_ref');
      const cached = fromCache(id);
      if (cached) return { ddbId: id, sheet: cached };
      checkLimit(userId);
      const at = countAttempt(userId);
      let raw: unknown;
      try {
        raw = await download(id);
      } catch (error) {
        // Nettfeil og 5xx hos D&D Beyond gis tilbake. 403, 404, 405, 429 o.l. teller,
        // så appen ikke fortsetter å hente mot en tjeneste som struper.
        if (isOutage(error)) refundAttempt(userId, at);
        throw error;
      }
      const { sheet } = sheetFromRaw(raw);
      if (ttlMs > 0) cache.set(id, { expires: now() + ttlMs, sheet });
      return { ddbId: id, sheet };
    },
  };
}

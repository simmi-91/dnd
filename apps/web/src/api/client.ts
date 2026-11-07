import { apiErrorSchema, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@dnd/shared';
import { reportRequest } from '../offline/connectivity';

/** Det vi trenger av et Zod-skjema. Holder klienten fri for en direkte zod-avhengighet. */
export interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Feil fra API-et, eller fra veien dit. `message` er norsk og kan vises. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly error: string;
  /** Hele feilsvaret, f.eks. `{ state, version }` ved 409 `version_conflict`. */
  readonly body: unknown;

  constructor(status: number, error: string, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.error = error;
    this.body = body;
  }
}

export function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
}

/** Grensen for keepalive-kropper, litt under 64 kB i nettleseren. */
export const KEEPALIVE_MAX_BYTES = 60_000;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions<T> {
  method?: Method;
  body?: unknown;
  /** Skjema for svaret. Uten skjema ignoreres innholdet i svaret. */
  schema?: Schema<T>;
  signal?: AbortSignal;
  /** La forespørselen fullføre selv om siden lukkes (høyst 64 kB kropp). */
  keepalive?: boolean;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Ingen svar fra serveren. Meldingen sier at handlingen krever nett. */
export function networkError(): ApiRequestError {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return new ApiRequestError(
    0,
    'network',
    offline
      ? 'Du er uten nett. Dette krever nett, så prøv igjen når nettet er tilbake.'
      : 'Fikk ikke kontakt med serveren. Dette krever nett, så sjekk nettet og prøv igjen.',
  );
}

export async function apiRequest<T = undefined>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[REQUESTED_WITH_HEADER] = REQUESTED_WITH_VALUE;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  // Nettleseren avviser keepalive over 64 kB (kroppen telles i byte). Da sendes en vanlig forespørsel.
  const keepalive =
    options.keepalive === true && (body === undefined || new Blob([body]).size <= KEEPALIVE_MAX_BYTES);

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body,
      signal: options.signal,
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    reportRequest(false);
    throw networkError();
  }
  reportRequest(true);

  const data = await readJson(res);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error, parsed.data.message, data);
    if (res.status >= 500) {
      throw new ApiRequestError(
        res.status,
        'server',
        'Serveren svarer ikke som den skal. Prøv igjen om litt.',
      );
    }
    throw new ApiRequestError(res.status, 'http', `Forespørselen feilet (${res.status}).`);
  }

  if (!options.schema) return undefined as T;
  const parsed = options.schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiRequestError(res.status, 'invalid_response', 'Fikk et uventet svar fra serveren.');
  }
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema: Schema<T>, signal?: AbortSignal) => apiRequest(path, { schema, signal }),
  post: <T = undefined>(path: string, body?: unknown, schema?: Schema<T>) =>
    apiRequest<T>(path, { method: 'POST', body, schema }),
  put: <T = undefined>(
    path: string,
    body?: unknown,
    schema?: Schema<T>,
    opts: { keepalive?: boolean } = {},
  ) => apiRequest<T>(path, { method: 'PUT', body, schema, keepalive: opts.keepalive }),
  patch: <T = undefined>(path: string, body?: unknown, schema?: Schema<T>) =>
    apiRequest<T>(path, { method: 'PATCH', body, schema }),
  delete: (path: string) => apiRequest(path, { method: 'DELETE' }),
};

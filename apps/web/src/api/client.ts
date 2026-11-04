import { apiErrorSchema, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@dnd/shared';

/** Det vi trenger av et Zod-skjema. Holder klienten fri for en direkte zod-avhengighet. */
export interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** Feil fra API-et, eller fra veien dit. `message` er norsk og kan vises. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.error = error;
  }
}

export function isApiRequestError(err: unknown): err is ApiRequestError {
  return err instanceof ApiRequestError;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions<T> {
  method?: Method;
  body?: unknown;
  /** Skjema for svaret. Uten skjema ignoreres innholdet i svaret. */
  schema?: Schema<T>;
  signal?: AbortSignal;
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

export async function apiRequest<T = undefined>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers[REQUESTED_WITH_HEADER] = REQUESTED_WITH_VALUE;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError(0, 'network', 'Fikk ikke kontakt med serveren. Sjekk nettet og prøv igjen.');
  }

  const data = await readJson(res);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error, parsed.data.message);
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
};

import { apiErrorSchema, authConfigSchema, meResponseSchema, type User } from '@dnd/shared';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, ApiRequestError, isApiRequestError } from './client';

export const queryKeys = {
  me: ['me'] as const,
  authConfig: ['auth', 'config'] as const,
};

/** Feilkoden serveren bruker for sperrede kontoer. */
export const BLOCKED_ERROR = 'blocked';

export function isBlockedError(err: unknown): boolean {
  return isApiRequestError(err) && err.status === 403 && err.error === BLOCKED_ERROR;
}

/** Prøv på nytt én gang ved nettverks- og serverfeil, aldri ved 4xx. */
function shouldRetry(failureCount: number, err: unknown): boolean {
  if (isApiRequestError(err) && err.status >= 400 && err.status < 500) return false;
  return failureCount < 1;
}

/**
 * Felles svar på innloggingsfeil fra alle spørringer og endringer, også de som kommer senere:
 * - 401: sesjonen er borte. `me` settes til null, og rutevernet sender brukeren til /logg-inn.
 * - 403 `blocked`: `me` hentes på nytt. Svaret gir den samme feilen, og rutevernet viser «Kontoen er sperret».
 * `/api/me` selv gjør 401 om til null og utløser derfor ikke dette.
 */
function handleAuthError(qc: QueryClient, err: unknown, key?: readonly unknown[]) {
  if (!isApiRequestError(err)) return;
  const isMe = key?.[0] === queryKeys.me[0];
  if (err.status === 401 && qc.getQueryData(queryKeys.me)) {
    qc.setQueryData(queryKeys.me, null);
  } else if (isBlockedError(err) && !isMe && !isBlockedError(qc.getQueryState(queryKeys.me)?.error)) {
    void qc.invalidateQueries({ queryKey: queryKeys.me });
  }
}

interface QueryClientOptions {
  /** Slå av nye forsøk, for tester. */
  retry?: false;
}

export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (err, query) => handleAuthError(qc, err, query.queryKey) }),
    mutationCache: new MutationCache({ onError: (err) => handleAuthError(qc, err) }),
    defaultOptions: {
      queries: {
        retry: options.retry ?? shouldRetry,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
  return qc;
}

/** Innlogget bruker, eller `null` når API-et svarer 401. */
export async function fetchMe(signal?: AbortSignal): Promise<User | null> {
  try {
    const res = await api.get('/api/me', meResponseSchema, signal);
    return res.user;
  } catch (err) {
    if (isApiRequestError(err) && err.status === 401) return null;
    throw err;
  }
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => fetchMe(signal),
    // Uten dette henter hver nye komponent som bruker useMe, en feilet `me` på nytt. Statusen går da
    // tilbake til «pending», rutevernet viser lasting, siden monteres på nytt, og det går i løkke.
    // Ny henting skjer i stedet med «Prøv igjen» eller invalidateQueries.
    retryOnMount: false,
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: queryKeys.authConfig,
    queryFn: ({ signal }) => api.get('/api/auth/config', authConfigSchema, signal),
    staleTime: Infinity,
  });
}

export function useGoogleSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credential: string) => api.post('/api/auth/google', { credential }, meResponseSchema),
    onSuccess: (res) => qc.setQueryData(queryKeys.me, res.user),
  });
}

/**
 * GET /api/auth/dev-login uten å følge videresendingen. Lykkes den, er informasjonskapselen satt
 * (svaret er en «opaqueredirect» eller 2xx). Ellers kastes feilen med `message` fra serveren,
 * i stedet for at nettleseren viser rå JSON.
 */
export async function devLogin(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/auth/dev-login', {
      credentials: 'same-origin',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Fikk ikke kontakt med serveren. Sjekk nettet og prøv igjen.');
  }
  if (res.type === 'opaqueredirect' || (res.status >= 200 && res.status < 400)) return;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) throw new ApiRequestError(res.status, parsed.data.error, parsed.data.message);
  throw new ApiRequestError(res.status, 'http', `Lokal innlogging feilet (${res.status}).`);
}

export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await devLogin();
      const user = await qc.fetchQuery({ queryKey: queryKeys.me, queryFn: () => fetchMe(), staleTime: 0 });
      // Informasjonskapselen ble satt, men er ikke synlig ennå: last siden på nytt som reserve.
      if (!user) window.location.assign('/');
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const clear = () => {
    qc.setQueryData(queryKeys.me, null);
    // Fjern alt som hørte til brukeren, men behold innloggingsoppsettet.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth' });
  };
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: clear,
    // Er sesjonen allerede borte eller kontoen sperret, er brukeren i praksis logget ut.
    onError: (err) => {
      if (isBlockedError(err) || (isApiRequestError(err) && err.status === 401)) clear();
    },
  });
}

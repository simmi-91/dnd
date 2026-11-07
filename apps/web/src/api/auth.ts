import { apiErrorSchema, authConfigSchema, meResponseSchema, userSchema, type User } from '@dnd/shared';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, ApiRequestError, isApiRequestError, networkError } from './client';
import {
  clearOffline,
  isLogoutPending,
  isNetworkError,
  offlineKeys,
  readOffline,
  setLogoutPending,
  writeOffline,
} from '../offline/storage';

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
export function handleAuthError(qc: QueryClient, err: unknown, key?: readonly unknown[]) {
  if (!isApiRequestError(err)) return;
  const isMe = key?.[0] === queryKeys.me[0];
  if (err.status === 401) clearOffline();
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
      // Spør alltid, også når nettleseren sier at nettet er borte. Spørringene faller da tilbake på det
      // som er lagret lokalt (src/offline/), og endringer gir straks en melding om at de krever nett, i
      // stedet for å vente i det stille.
      queries: {
        retry: options.retry ?? shouldRetry,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
  return qc;
}

/**
 * Innlogget bruker, eller `null` når API-et svarer 401. Uten nett brukes brukeren fra forrige gang,
 * så ark og kamp kan åpnes. Lagringen slettes ved 401, sperret konto og når en annen bruker logger inn.
 */
export async function fetchMe(signal?: AbortSignal): Promise<User | null> {
  // Logget ut uten nett: send utloggingen først. Til serveren har svart, er brukeren logget ut her.
  if (isLogoutPending()) {
    await flushPendingLogout();
    return null;
  }
  try {
    const res = await api.get('/api/me', meResponseSchema, signal);
    if (readOffline(offlineKeys.me, userSchema)?.id !== res.user.id) clearOffline();
    writeOffline(offlineKeys.me, res.user);
    return res.user;
  } catch (err) {
    if (isApiRequestError(err) && err.status === 401) {
      clearOffline();
      return null;
    }
    if (isBlockedError(err)) clearOffline();
    if (isNetworkError(err)) {
      const cached = readOffline(offlineKeys.me, userSchema);
      if (cached) return cached;
    }
    throw err;
  }
}

let flushing: Promise<boolean> | null = null;

/**
 * Sender en utlogging som ble gjort uten nett. Flagget fjernes først når serveren har svart 2xx eller
 * 401 (sesjonen er borte). Gir true når ingen utlogging venter lenger.
 */
export function flushPendingLogout(): Promise<boolean> {
  if (!isLogoutPending()) return Promise.resolve(true);
  flushing ??= (async () => {
    try {
      await api.post('/api/auth/logout');
      setLogoutPending(false);
    } catch (err) {
      if (isApiRequestError(err) && err.status === 401) setLogoutPending(false);
    } finally {
      flushing = null;
    }
    clearOffline();
    return !isLogoutPending();
  })();
  return flushing;
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
    onSuccess: (res) => {
      // Ny innlogging: en gammel utlogging uten nett skal ikke sendes etterpå.
      setLogoutPending(false);
      qc.setQueryData(queryKeys.me, res.user);
    },
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
    throw networkError();
  }
  if (res.type === 'opaqueredirect' || (res.status >= 200 && res.status < 400)) {
    setLogoutPending(false);
    return;
  }

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
    // Også det som er lagret for bruk uten nett, og endringer som ikke er sendt.
    clearOffline();
    qc.setQueryData(queryKeys.me, null);
    // Fjern alt som hørte til brukeren, men behold innloggingsoppsettet.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'auth' });
  };
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: clear,
    // Er sesjonen allerede borte eller kontoen sperret, er brukeren i praksis logget ut. Uten nett
    // logges brukeren ut her på enheten (lageret tømmes), selv om serveren ikke fikk beskjed.
    onError: (err) => {
      if (isNetworkError(err)) {
        // Serveren fikk ikke beskjed: send utloggingen når nettet er tilbake (flushPendingLogout).
        setLogoutPending(true);
        clear();
      } else if (isBlockedError(err) || (isApiRequestError(err) && err.status === 401)) {
        clear();
      }
    },
  });
}

import {
  entriesResponseSchema,
  entryConflictSchema,
  entryDetailResponseSchema,
  entrySaveResponseSchema,
  searchResponseSchema,
  sessionConflictSchema,
  sessionResponseSchema,
  sessionSaveResponseSchema,
  sessionsResponseSchema,
  suggestResponseSchema,
  type AppendTodayRequest,
  type CreateEntryRequest,
  type CreateSessionRequest,
  type EntryConflict,
  type EntryKind,
  type Session,
  type SessionConflict,
  type SessionListItem,
  type UpdateEntryRequest,
  type UpdateSessionRequest,
} from '@dnd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest, isApiRequestError } from './client';
import { gamePath } from './games';

// Kampanjeboka (fase 4): oppslagsverk, dagbok, søk og autofullføring. Delt av oppslagsverket (4d)
// og dagboka (4c). Alle nøkler starter med 'campaign', så en skriving kan ugyldiggjøre alt i boka.

export const campaignKeys = {
  all: ['campaign'] as const,
  entries: (gameId: number) => ['campaign', 'entries', gameId] as const,
  entry: (id: number) => ['campaign', 'entry', id] as const,
  suggest: (gameId: number, kind: EntryKind, q: string) => ['campaign', 'suggest', gameId, kind, q] as const,
  search: (gameId: number, q: string) => ['campaign', 'search', gameId, q] as const,
  sessions: (gameId: number) => ['campaign', 'sessions', gameId] as const,
  session: (id: number) => ['campaign', 'session', id] as const,
};

// ---------- Adresser i appen ----------

/** Fanene i oppslagsverket, slik de står i `?fane=`. */
export const BOOK_TABS = ['quester', 'personer', 'steder', 'andre', 'okter'] as const;
export type BookTab = (typeof BOOK_TABS)[number];

export const KIND_TAB: Record<EntryKind, BookTab> = {
  quest: 'quester',
  person: 'personer',
  place: 'steder',
  other: 'andre',
};

export const bookPath = (gameId: number) => `/spill/${gameId}/bok`;

/** Detaljkortet til en oppføring. Med `kind` åpnes riktig fane i lista ved siden av. */
export function entryPath(gameId: number, id: number, kind?: EntryKind): string {
  return `${bookPath(gameId)}/${id}${kind ? `?fane=${KIND_TAB[kind]}` : ''}`;
}

/** Dagboka, eller en bestemt økt i den. */
export function journalPath(gameId: number, sessionId?: number): string {
  return `/spill/${gameId}/dagbok${sessionId != null ? `/${sessionId}` : ''}`;
}

// ---------- Konflikter ----------

/** 409 fra en oppføring (`version_conflict` eller `name_taken`) med oppføringen fra serveren. */
export function entryConflictOf(err: unknown): EntryConflict | undefined {
  if (!isApiRequestError(err) || err.status !== 409) return undefined;
  const parsed = entryConflictSchema.safeParse(err.body);
  return parsed.success ? parsed.data : undefined;
}

/** 409 fra en økt (`version_conflict` eller `number_taken`) med økta fra serveren. */
export function sessionConflictOf(err: unknown): SessionConflict | undefined {
  if (!isApiRequestError(err) || err.status !== 409) return undefined;
  const parsed = sessionConflictSchema.safeParse(err.body);
  return parsed.success ? parsed.data : undefined;
}

/** 404 fra serveren: finnes ikke, eller tilhører ikke brukeren. */
export function isNotFound(err: unknown): boolean {
  return isApiRequestError(err) && err.status === 404;
}

/** 422 `body_too_long`: teksten ble for lang. `message` kan vises. */
export function isBodyTooLong(err: unknown): boolean {
  return isApiRequestError(err) && err.status === 422 && err.error === 'body_too_long';
}

// ---------- Oppføringer ----------

/**
 * Alle oppføringer i spillet, også arkiverte (lista filtrerer selv). `counts` er antall som ikke er
 * arkivert. Deles av listen, detaljkortet og `MentionText`, som slår opp navn og typer her.
 */
export function useEntries(gameId: number) {
  return useQuery({
    queryKey: campaignKeys.entries(gameId),
    queryFn: ({ signal }) => api.get(`${gamePath(gameId)}/entries?show=all`, entriesResponseSchema, signal),
    staleTime: 15_000,
  });
}

export function useEntry(id: number | null) {
  return useQuery({
    queryKey: campaignKeys.entry(id ?? 0),
    queryFn: ({ signal }) => api.get(`/api/entries/${id ?? 0}`, entryDetailResponseSchema, signal),
    enabled: id != null,
  });
}

export function useCreateEntry(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEntryRequest) =>
      api.post(`${gamePath(gameId)}/entries`, body, entrySaveResponseSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateEntryRequest }) =>
      api.put(`/api/entries/${id}`, body, entrySaveResponseSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/entries/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/** Autofullføring. Tom `q` gir de sist endrede. Arkiverte er ikke med. */
export function useSuggest(gameId: number, kind: EntryKind, q: string, enabled = true) {
  return useQuery({
    queryKey: campaignKeys.suggest(gameId, kind, q),
    queryFn: ({ signal }) =>
      api.get(
        `${gamePath(gameId)}/entries/suggest?${new URLSearchParams({ kind, q })}`,
        suggestResponseSchema,
        signal,
      ),
    enabled,
    staleTime: 10_000,
    select: (res) => res.suggestions,
  });
}

/** Søk i økter og oppføringer. Hold `q` trimmet; tom `q` henter ingenting. */
export function useSearch(gameId: number, q: string) {
  return useQuery({
    queryKey: campaignKeys.search(gameId, q),
    queryFn: ({ signal }) =>
      api.get(`${gamePath(gameId)}/search?${new URLSearchParams({ q })}`, searchResponseSchema, signal),
    enabled: q !== '',
    staleTime: 10_000,
  });
}

// ---------- Dagbok (brukes av 4c) ----------

/** Øktene i spillet, nyeste først. */
export function useSessions(gameId: number) {
  return useQuery({
    queryKey: campaignKeys.sessions(gameId),
    queryFn: ({ signal }) => api.get(`${gamePath(gameId)}/sessions`, sessionsResponseSchema, signal),
    select: (res) => res.sessions,
  });
}

export function useSession(id: number | null) {
  return useQuery({
    queryKey: campaignKeys.session(id ?? 0),
    queryFn: ({ signal }) => api.get(`/api/sessions/${id ?? 0}`, sessionResponseSchema, signal),
    enabled: id != null,
    select: (res) => res.session,
  });
}

export function useCreateSession(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSessionRequest) =>
      api.post(`${gamePath(gameId)}/sessions`, body, sessionSaveResponseSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/**
 * Lagrer en økt. Ugyldiggjør alt i boka unntatt selve økta (`['campaign','session',id]`), så
 * skriveflaten ikke får teksten byttet under seg. Hent økta på nytt selv ved 409.
 */
export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateSessionRequest }) =>
      api.put(`/api/sessions/${id}`, body, sessionSaveResponseSchema),
    onSettled: () =>
      qc.invalidateQueries({
        queryKey: campaignKeys.all,
        predicate: (q) => q.queryKey[1] !== 'session',
      }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/sessions/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/** Hurtignotatet: legger teksten nederst i økta med datoen (4e). */
export function useAppendToday(gameId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppendTodayRequest) =>
      api.post(`${gamePath(gameId)}/sessions/today/append`, body, sessionSaveResponseSchema),
    onSettled: () => qc.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

// ---------- Skriveflaten i dagboka (4c) ----------
// Kallene under brukes av `JournalSync`, som styrer lagringen selv (én skriving om gangen og
// `keepalive` når fanen skjules), så de er vanlige funksjoner og ikke mutasjoner.

export const sessionRequests = {
  create: (gameId: number, body: CreateSessionRequest, opts: { keepalive?: boolean } = {}) =>
    apiRequest(`${gamePath(gameId)}/sessions`, {
      method: 'POST',
      body,
      schema: sessionSaveResponseSchema,
      keepalive: opts.keepalive,
    }),
  update: (id: number, body: UpdateSessionRequest, opts: { keepalive?: boolean } = {}) =>
    apiRequest(`/api/sessions/${id}`, {
      method: 'PUT',
      body,
      schema: sessionSaveResponseSchema,
      keepalive: opts.keepalive,
    }),
  /** Økta, eller null hvis den er slettet. */
  get: async (id: number): Promise<Session | null> => {
    try {
      return (await api.get(`/api/sessions/${id}`, sessionResponseSchema)).session;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },
  /** Økta med høyest nummer for datoen, eller null. */
  findByDate: async (gameId: number, playedOn: string): Promise<Session | null> => {
    const { sessions } = await api.get(`${gamePath(gameId)}/sessions`, sessionsResponseSchema);
    const match = latestOn(sessions, playedOn);
    return match ? sessionRequests.get(match.id) : null;
  },
};

/** Økta med høyest nummer for datoen i lista. */
export function latestOn(sessions: SessionListItem[], playedOn: string): SessionListItem | undefined {
  let best: SessionListItem | undefined;
  for (const s of sessions) if (s.playedOn === playedOn && (!best || s.number > best.number)) best = s;
  return best;
}

/** Dagens dato i brukerens tidssone, `YYYY-MM-DD`. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

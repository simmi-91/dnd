import {
  ddbPreviewResponseSchema,
  gameDetailResponseSchema,
  gamesResponseSchema,
  refreshCharacterResponseSchema,
  type CreateGameRequest,
  type GameDetailResponse,
  type PasteCharacterRequest,
  type RefreshCharacterRequest,
  type UpdateGameRequest,
} from '@dnd/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchWithOffline, offlineKeys, removeOffline, writeOffline } from '../offline/storage';
import { api } from './client';

export const gameKeys = {
  all: ['games'] as const,
  list: () => ['games', 'list'] as const,
  detail: (id: number) => ['games', 'detail', id] as const,
};

export const gamePath = (id: number) => `/api/games/${id}`;

/** Henter ett spill. Uten nett brukes det som ble hentet sist (arket, til lesing). */
function fetchGame(id: number, signal?: AbortSignal) {
  return fetchWithOffline(offlineKeys.game(id), gameDetailResponseSchema, () =>
    api.get(gamePath(id), gameDetailResponseSchema, signal),
  );
}

/** Legger et ferskt detaljsvar i bufferen og ber listen hente seg på nytt. */
function storeDetail(qc: QueryClient, detail: GameDetailResponse) {
  qc.setQueryData(gameKeys.detail(detail.game.id), detail);
  writeOffline(offlineKeys.game(detail.game.id), detail);
  void qc.invalidateQueries({ queryKey: gameKeys.list() });
}

export function useGames() {
  return useQuery({
    queryKey: gameKeys.list(),
    queryFn: ({ signal }) =>
      fetchWithOffline(offlineKeys.games, gamesResponseSchema, () =>
        api.get('/api/games', gamesResponseSchema, signal),
      ),
    select: (res) => res.games,
  });
}

export function useGame(id: number) {
  return useQuery({
    queryKey: gameKeys.detail(id),
    queryFn: ({ signal }) => fetchGame(id, signal),
  });
}

/** Navnet på spillet til menyen. Deler buffer med `useGame`. */
export function useGameName(id: number | null): string | undefined {
  const q = useQuery({
    queryKey: gameKeys.detail(id ?? 0),
    queryFn: ({ signal }) => fetchGame(id ?? 0, signal),
    enabled: id != null,
    select: (d) => d.game.name,
  });
  return id == null ? undefined : q.data;
}

/** ID-en til et spill ut fra adressen, eller null hvis den ikke er et gyldig tall. */
export function parseGameId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= 2 ** 31 ? n : null;
}

export function usePreviewCharacter() {
  return useMutation({
    mutationFn: (ddbUrlOrId: string) =>
      api.post('/api/ddb/preview', { ddbUrlOrId }, ddbPreviewResponseSchema),
  });
}

export function useCreateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGameRequest) => api.post('/api/games', body, gameDetailResponseSchema),
    onSuccess: (detail) => storeDetail(qc, detail),
  });
}

export function useUpdateGame(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGameRequest) => api.patch(gamePath(id), body, gameDetailResponseSchema),
    onSuccess: (detail) => storeDetail(qc, detail),
  });
}

export function useDeleteGame(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(gamePath(id)),
    onSuccess: () => {
      removeOffline(offlineKeys.game(id));
      removeOffline(offlineKeys.stateSync(id));
      removeOffline(offlineKeys.combat(id));
      removeOffline(offlineKeys.combatSync(id));
      qc.removeQueries({ queryKey: gameKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: gameKeys.list() });
    },
  });
}

export function useRefreshCharacter(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RefreshCharacterRequest) =>
      api.post(`${gamePath(id)}/character/refresh`, body, refreshCharacterResponseSchema),
    onSuccess: (res) => storeDetail(qc, res),
  });
}

export function usePasteCharacter(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PasteCharacterRequest) =>
      api.post(`${gamePath(id)}/character/paste`, body, refreshCharacterResponseSchema),
    onSuccess: (res) => storeDetail(qc, res),
  });
}

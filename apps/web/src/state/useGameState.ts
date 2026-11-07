import {
  gameStateEnvelopeSchema,
  gameStateSchema,
  type GameDetailResponse,
  type GameStateEnvelope,
} from '@dnd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { handleAuthError } from '../api/auth';
import { api } from '../api/client';
import { gameKeys, gamePath } from '../api/games';
import { onOnline } from '../offline/connectivity';
import { offlineKeys, onOfflineChange } from '../offline/storage';
import { localSyncStorage } from '../offline/syncStorage';
import { StateSync, type SyncSnapshot } from './stateSync';

export interface GameStateHook extends SyncSnapshot {
  update: StateSync['update'];
  replace: StateSync['replace'];
  flush: StateSync['flush'];
  clearNotice: StateSync['clearNotice'];
  /** Henter tilstanden på nytt, men ikke hvis noe ikke er lagret ennå. */
  refetch: StateSync['refetch'];
}

interface Options {
  debounceMs?: number;
  retryMs?: number;
}

/**
 * Spilltilstanden for ett spill, med lagring i bakgrunnen (5.3). `initial` brukes bare første gang.
 * Hent på nytt når fanen blir synlig, men ikke hvis noe ikke er lagret ennå.
 */
export function useGameState(
  gameId: number,
  initial: GameStateEnvelope,
  options: Options = {},
): GameStateHook {
  const qc = useQueryClient();
  const [sync] = useState(
    () =>
      new StateSync({
        initial,
        debounceMs: options.debounceMs,
        retryMs: options.retryMs,
        put: (env, { keepalive }) =>
          api.put(`${gamePath(gameId)}/state`, env, gameStateEnvelopeSchema, { keepalive }),
        get: () => api.get(`${gamePath(gameId)}/state`, gameStateEnvelopeSchema),
        onConfirmed: (env) =>
          qc.setQueryData<GameDetailResponse>(gameKeys.detail(gameId), (d) => (d ? { ...d, state: env } : d)),
        onError: (err) => handleAuthError(qc, err),
        // Uten nett: endringene lagres lokalt og sendes når nettet er tilbake.
        storage: localSyncStorage(offlineKeys.stateSync(gameId), gameStateSchema),
      }),
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sync.refetch();
      else sync.sendNow();
    };
    const onPageHide = () => sync.sendNow();
    // Endringer fra forrige gang (uten nett) sendes først. Tilstanden i bufferen kan være gammel
    // (endret på en annen enhet), så hent den ved oppstart når alt er lagret.
    sync.resume();
    void sync.refetch();
    const offOnline = onOnline(sync.retryNow);
    // Samme spill i en annen fane: ta inn det den har lagret lokalt.
    const offStorage = onOfflineChange(offlineKeys.stateSync(gameId), sync.syncFromStorage);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      offOnline();
      offStorage();
      window.removeEventListener('pagehide', onPageHide);
      sync.sendNow();
    };
  }, [sync, gameId]);

  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  return {
    ...snap,
    update: sync.update,
    replace: sync.replace,
    flush: sync.flush,
    clearNotice: sync.clearNotice,
    refetch: sync.refetch,
  };
}

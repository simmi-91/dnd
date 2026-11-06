import type { GameDetailResponse } from '@dnd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { handleAuthError } from '../api/auth';
import { gameKeys } from '../api/games';
import { COMBAT_POLL_MS, CombatStore, type CombatSnapshot, type GameSyncLink } from './combatStore';

export interface CombatHook extends CombatSnapshot {
  update: CombatStore['update'];
  flush: CombatStore['flush'];
  start: CombatStore['start'];
  end: CombatStore['end'];
  refetch: CombatStore['refetch'];
  clearNotice: CombatStore['clearNotice'];
}

interface Options {
  /** Spilltilstanden (fra `useGameState`), så den lagres før kampen starter og slutter. */
  game?: GameSyncLink;
  debounceMs?: number;
  retryMs?: number;
  pollMs?: number;
}

/**
 * Kampen som pågår i spillet, med lagring i bakgrunnen (5.3). Henter ved oppstart, når fanen blir
 * synlig, og hvert 10. sekund mens en kamp pågår og fanen er synlig.
 */
export function useCombat(gameId: number, options: Options = {}): CombatHook {
  const qc = useQueryClient();
  const { game } = options;
  const [store] = useState(
    () =>
      new CombatStore({
        gameId,
        debounceMs: options.debounceMs,
        retryMs: options.retryMs,
        game: game && { flush: () => game.flush(), replace: (env) => game.replace(env) },
        onGameState: (env) =>
          qc.setQueryData<GameDetailResponse>(gameKeys.detail(gameId), (d) => (d ? { ...d, state: env } : d)),
        onError: (err) => handleAuthError(qc, err),
      }),
  );
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const active = snap.combat != null;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void store.refetch();
      else store.sendNow();
    };
    const onPageHide = () => store.sendNow();
    void store.refetch();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      store.sendNow();
    };
  }, [store]);

  const pollMs = options.pollMs ?? COMBAT_POLL_MS;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void store.refetch();
    }, pollMs);
    return () => clearInterval(timer);
  }, [store, active, pollMs]);

  return {
    ...snap,
    update: store.update,
    flush: store.flush,
    start: store.start,
    end: store.end,
    refetch: store.refetch,
    clearNotice: store.clearNotice,
  };
}

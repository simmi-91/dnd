import type { Session, SessionResponse } from '@dnd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { handleAuthError } from '../api/auth';
import { campaignKeys, sessionRequests } from '../api/campaign';
import { JournalSync, type JournalDoc, type JournalSnapshot } from './journalSync';

export interface JournalSyncHook extends JournalSnapshot {
  edit: JournalSync['edit'];
  keepMine: JournalSync['keepMine'];
  useTheirs: JournalSync['useTheirs'];
  saveAsNew: JournalSync['saveAsNew'];
  stop: JournalSync['stop'];
  flush: JournalSync['flush'];
}

interface Options {
  debounceMs?: number;
  retryMs?: number;
}

/**
 * Lagring av en økt i bakgrunnen (se `JournalSync`). `initial` null er en tom skriveflate for
 * `initialDoc.playedOn`, som opprettes ved første lagring. Henter på nytt når fanen blir synlig,
 * og sender det som ikke er lagret (med `keepalive`) når den skjules eller siden forlates.
 */
export function useJournalSync(
  gameId: number,
  initial: Session | null,
  initialDoc?: Partial<JournalDoc>,
  options: Options = {},
): JournalSyncHook {
  const qc = useQueryClient();
  const [sync] = useState(
    () =>
      new JournalSync({
        initial,
        initialDoc,
        debounceMs: options.debounceMs,
        retryMs: options.retryMs,
        create: (body, opts) => sessionRequests.create(gameId, body, opts),
        update: (id, body, opts) => sessionRequests.update(id, body, opts),
        get: (id) => sessionRequests.get(id),
        findByDate: (playedOn) => sessionRequests.findByDate(gameId, playedOn),
        onSaved: (res) => {
          qc.setQueryData<SessionResponse>(campaignKeys.session(res.session.id), { session: res.session });
          // Lista, registeret og «Nevnt i» endres. Selve økta er satt over, så den hentes ikke.
          void qc.invalidateQueries({
            queryKey: campaignKeys.all,
            predicate: (q) => q.queryKey[1] !== 'session',
          });
        },
        onError: (err) => handleAuthError(qc, err),
      }),
  );
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sync.refetch();
      else sync.sendNow();
    };
    const onPageHide = () => sync.sendNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      sync.sendNow();
    };
  }, [sync]);

  return {
    ...snap,
    edit: sync.edit,
    keepMine: sync.keepMine,
    useTheirs: sync.useTheirs,
    saveAsNew: sync.saveAsNew,
    stop: sync.stop,
    flush: sync.flush,
  };
}

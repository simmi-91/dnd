import { useSyncExternalStore } from 'react';

// Er vi uten nett? Nettleseren vet det ofte (`navigator.onLine`), men ikke alltid, så en forespørsel
// som ikke får svar i det hele tatt, teller også. Første svar fra serveren etterpå nullstiller det.

let failed = false;
const listeners = new Set<() => void>();

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function emit(): void {
  for (const l of listeners) l();
}

/** Kalles av API-klienten etter hver forespørsel. */
export function reportRequest(reachedServer: boolean): void {
  const next = !reachedServer;
  if (next === failed) return;
  failed = next;
  emit();
}

export function isOffline(): boolean {
  return !browserOnline() || failed;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onChange = () => {
    // Kommer nettet tilbake, prøver vi igjen før vi sier noe annet.
    if (browserOnline()) failed = false;
    listener();
  };
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Sann når appen er uten nett. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, () => false);
}

/** Kaller `fn` når nettleseren melder at nettet er tilbake. Gir en funksjon som fjerner lytteren. */
export function onOnline(fn: () => void): () => void {
  window.addEventListener('online', fn);
  return () => window.removeEventListener('online', fn);
}

/** For tester. */
export function resetConnectivity(): void {
  failed = false;
  emit();
}

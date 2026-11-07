import { useSyncExternalStore } from 'react';

// Ny versjon av appen (service workeren) venter. Den tas i bruk først når brukeren trykker, så siden
// aldri lastes inn på nytt midt i en kamp. Registreringen skjer i main.tsx (virtual:pwa-register).

let apply: (() => Promise<void> | void) | null = null;
let waiting = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Kalles når en ny versjon er klar. `reload` tar den i bruk og laster siden på nytt. */
export function setUpdateWaiting(reload: () => Promise<void> | void): void {
  apply = reload;
  waiting = true;
  emit();
}

/** Skjuler meldingen til neste gang en ny versjon blir klar. */
export function dismissUpdate(): void {
  waiting = false;
  emit();
}

export function applyUpdate(): void {
  waiting = false;
  emit();
  if (apply) void apply();
  else window.location.reload();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting,
    () => false,
  );
}

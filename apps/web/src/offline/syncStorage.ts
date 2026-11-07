import type { Schema } from '../api/client';
import type { PersistedSync, SyncStorage } from '../state/stateSync';
import { offlineGeneration, readOffline, removeOffline, writeOffline } from './storage';

// Lokal lagring for `VersionedSync`: én post per nøkkel med tilstand, versjon og om den er sendt.
// Kampen lagres med ID-en sin, så en post fra en tidligere kamp aldri brukes på en ny.

interface StoredRecord<T> extends PersistedSync<T> {
  id: number | null;
}

function recordSchema<T>(stateSchema: Schema<T>): Schema<StoredRecord<T>> {
  return {
    safeParse(data) {
      if (typeof data !== 'object' || data === null) return { success: false };
      const d = data as Record<string, unknown>;
      const id = d.id ?? null;
      if (
        typeof d.version !== 'number' ||
        typeof d.dirty !== 'boolean' ||
        (id !== null && typeof id !== 'number')
      ) {
        return { success: false };
      }
      const state = stateSchema.safeParse(d.state);
      if (!state.success) return { success: false };
      const base = typeof d.base === 'string' ? d.base : undefined;
      return { success: true, data: { state: state.data, version: d.version, dirty: d.dirty, base, id } };
    },
  };
}

/** Posten som ligger lagret under `key`, uansett ID. */
export function readStoredSync<T>(key: string, stateSchema: Schema<T>): StoredRecord<T> | null {
  return readOffline(key, recordSchema(stateSchema)) ?? null;
}

/**
 * Lagring under `key`. Med `id` (kampen) leses bare en post med samme ID, og bare den slettes.
 * Er lageret tømt etter at lagringen ble laget (utlogging, 401), skrives ingenting mer.
 */
export function localSyncStorage<T>(
  key: string,
  stateSchema: Schema<T>,
  id: number | null = null,
): SyncStorage<T> {
  const gen = offlineGeneration();
  return {
    read: () => {
      const rec = readStoredSync(key, stateSchema);
      return rec && rec.id === id
        ? { state: rec.state, version: rec.version, dirty: rec.dirty, base: rec.base }
        : null;
    },
    write: (rec) => {
      if (rec) {
        writeOffline(key, { ...rec, id }, gen);
        return;
      }
      if (gen !== offlineGeneration()) return;
      const stored = readStoredSync(key, stateSchema);
      if (!stored || stored.id === id) removeOffline(key);
    },
  };
}

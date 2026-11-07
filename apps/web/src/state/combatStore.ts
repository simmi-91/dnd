import type { CombatState } from '@dnd/rules';
import {
  combatConflictSchema,
  combatEnvelopeSchema,
  combatResponseSchema,
  combatStateSchema,
  endCombatResponseSchema,
  type CombatEnvelope,
  type EndCombatResponse,
  type GameStateEnvelope,
  type StartCombatRequest,
} from '@dnd/shared';
import { api, isApiRequestError } from '../api/client';
import { errorMessage } from '../components/errorMessage';
import { fetchWithOffline, offlineGeneration, offlineKeys, writeOffline } from '../offline/storage';
import { localSyncStorage, readStoredSync } from '../offline/syncStorage';
import { VersionedSync, type SyncOptions, type SyncSnapshot } from './stateSync';

// Kampen som pågår i et spill (fase 3b). Holder rede på hvilken kamp som er aktiv, og lager en
// `VersionedSync` per kamp, så endringer lagres med versjon som spilltilstanden. Avsluttes kampen
// eller startes en ny på en annen enhet, merkes det ved neste henting (fokus eller hvert 10. sekund).

/** Kampen uten tilstanden, som ligger i `sync`. */
export type CombatInfo = Omit<CombatEnvelope, 'state' | 'version'>;

export interface CombatSnapshot {
  /** Første henting pågår. */
  loading: boolean;
  /** Henting, start eller slutt feilet. Teksten kan vises. */
  error: string | null;
  /** Kampen som pågår, eller null. */
  combat: CombatInfo | null;
  /** Tilstanden til kampen som pågår, med lagringsstatus. */
  sync: SyncSnapshot<CombatState> | null;
  /** Melding om noe som skjedde på en annen enhet, f.eks. at kampen ble avsluttet der. */
  notice: string | null;
}

/** Det kampen trenger av spilltilstanden, så den kan lagres før kampen avsluttes, og byttes ut etterpå. */
export interface GameSyncLink {
  flush: () => Promise<boolean>;
  replace: (env: GameStateEnvelope) => void;
}

export interface CombatStoreOptions {
  gameId: number;
  debounceMs?: number;
  retryMs?: number;
  game?: GameSyncLink;
  /** Ny spilltilstand etter at kampen er avsluttet. */
  onGameState?: (env: GameStateEnvelope) => void;
  onError?: (err: unknown) => void;
}

export const COMBAT_POLL_MS = 10_000;
export const COMBAT_ENDED_ELSEWHERE = 'Kampen er avsluttet på en annen enhet.';
export const COMBAT_STARTED_ELSEWHERE = 'En kamp pågår allerede. Den er hentet.';
export const COMBAT_ENDED_OFFLINE_LOST =
  'Kampen er avsluttet på en annen enhet. Endringene du gjorde uten nett, ble ikke lagret.';
export const COMBAT_END_NEEDS_NETWORK =
  'Du er uten nett. Å avslutte kampen krever nett. Endringene i kampen lagres når nettet er tilbake.';

function infoOf(c: CombatEnvelope): CombatInfo {
  return { id: c.id, status: c.status, round: c.round, startedAt: c.startedAt, endedAt: c.endedAt };
}

export class CombatStore {
  private loading = true;
  private error: string | null = null;
  private notice: string | null = null;
  private info: CombatInfo | null = null;
  private sync: VersionedSync<CombatState> | null = null;
  private unsubscribeSync: (() => void) | null = null;
  /** Teller hentinger, så et svar som kommer for sent, ikke overskriver et nyere. */
  private loads = 0;
  private snapshot: CombatSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly opts: CombatStoreOptions;
  /** Generasjonen til den lokale lagringen. Tømmes den (utlogging, 401), skrives ingenting mer. */
  private readonly gen = offlineGeneration();

  constructor(opts: CombatStoreOptions) {
    this.opts = opts;
    this.snapshot = this.makeSnapshot();
  }

  private get path(): string {
    return `/api/games/${this.opts.gameId}/combat`;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CombatSnapshot => this.snapshot;

  /** Endrer kampen lokalt og lagrer etter en liten pause. Gjør ingenting uten aktiv kamp. */
  update = (fn: (state: CombatState) => CombatState): void => {
    this.sync?.update(fn);
  };

  /** Lagrer det som ikke er lagret. Gir false ved feil, eller hvis kampen er borte. */
  flush = async (): Promise<boolean> => (this.sync ? this.sync.flush() : true);

  clearNotice = (): void => {
    this.notice = null;
    this.sync?.clearNotice();
    this.emit();
  };

  /** Henter kampen som pågår. Med aktiv kamp hentes bare den, og bare når alt er lagret. */
  refetch = async (): Promise<void> => {
    if (this.sync) return this.sync.refetch();
    return this.load();
  };

  /** Fanen lukkes eller skjules: send det som ikke er lagret, uten å vente. */
  sendNow = (): void => {
    this.sync?.sendNow();
  };

  /** En annen fane har endret kampen i den lokale lagringen. */
  syncFromStorage = (): void => {
    this.sync?.syncFromStorage();
  };

  /** Nettet er tilbake: send det som venter, eller hent kampen hvis hentingen feilet. */
  retryNow = (): void => {
    if (this.sync) this.sync.retryNow();
    else if (this.error) void this.load();
  };

  /** Starter en kamp (oppsett fra arket og tilstanden). Pågår det alt en, brukes den. */
  start = async (body: StartCombatRequest = {}): Promise<boolean> => {
    if (this.info) return true;
    // Oppsettet bygger på spilltilstanden på serveren, så lagre den først.
    await this.opts.game?.flush();
    try {
      const combat = await api.post(this.path, body, combatEnvelopeSchema);
      this.adopt(combat);
      return true;
    } catch (err) {
      if (isApiRequestError(err) && err.status === 409) {
        const conflict = combatConflictSchema.safeParse(err.body);
        if (conflict.success && conflict.data.combat) {
          this.notice = COMBAT_STARTED_ELSEWHERE;
          this.adopt(conflict.data.combat);
          return true;
        }
      }
      this.fail(err);
      return false;
    }
  };

  /**
   * Avslutter kampen: lagrer spilltilstanden og kampen, ber serveren avslutte, og bytter til den nye
   * spilltilstanden (conditions og exhaustion fra kampen). Gir svaret, eller null ved feil.
   */
  end = async (): Promise<EndCombatResponse | null> => {
    const info = this.info;
    if (!info) return null;
    await this.opts.game?.flush();
    if (this.sync && !(await this.sync.flush()) && !this.sync.getSnapshot().gone) {
      const snap = this.sync.getSnapshot();
      this.error =
        snap.status === 'offline'
          ? COMBAT_END_NEEDS_NETWORK
          : (snap.error ?? 'Kampen er ikke lagret. Prøv igjen.');
      this.emit();
      return null;
    }
    try {
      const res = await api.post(`${this.path}/end`, { id: info.id }, endCombatResponseSchema);
      this.drop();
      writeOffline(offlineKeys.combat(this.opts.gameId), { combat: null }, this.gen);
      this.error = null;
      this.opts.game?.replace(res.state);
      this.opts.onGameState?.(res.state);
      this.emit();
      return res;
    } catch (err) {
      // Er kampen alt borte (404), er den avsluttet et annet sted. Hent det som gjelder nå.
      if (isApiRequestError(err) && err.status === 404) {
        this.drop();
        this.emit();
        await this.load();
        return null;
      }
      this.fail(err);
      return null;
    }
  };

  private async load(): Promise<void> {
    const load = ++this.loads;
    try {
      // Uten nett brukes kampen slik den var sist (endringene ligger i den lokale lagringen).
      const res = await fetchWithOffline(offlineKeys.combat(this.opts.gameId), combatResponseSchema, () =>
        api.get(this.path, combatResponseSchema),
      );
      if (load !== this.loads) return;
      this.loading = false;
      this.error = null;
      // Endringer uten nett i en kamp som er avsluttet på en annen enhet i mellomtiden, er tapt.
      const pending = readStoredSync(offlineKeys.combatSync(this.opts.gameId), combatStateSchema);
      if (pending && pending.id !== res.combat?.id) {
        if (pending.dirty) this.notice = COMBAT_ENDED_OFFLINE_LOST;
        localSyncStorage(offlineKeys.combatSync(this.opts.gameId), combatStateSchema, pending.id).write(null);
      }
      if (res.combat) {
        if (res.combat.id !== this.info?.id) this.adopt(res.combat);
      } else if (this.info) {
        this.drop();
      }
      this.emit();
    } catch (err) {
      if (load !== this.loads) return;
      this.loading = false;
      this.fail(err);
    }
  }

  private adopt(combat: CombatEnvelope): void {
    this.drop();
    this.loads += 1;
    this.loading = false;
    this.error = null;
    this.info = infoOf(combat);
    const id = combat.id;
    const options: SyncOptions<CombatState> = {
      initial: { state: combat.state, version: combat.version },
      debounceMs: this.opts.debounceMs,
      retryMs: this.opts.retryMs,
      put: async (env, { keepalive }) => {
        const saved = await api.put(this.path, { id, ...env }, combatEnvelopeSchema, { keepalive });
        this.setRound(id, saved.round);
        return saved;
      },
      get: async () => {
        const res = await api.get(this.path, combatResponseSchema);
        return res.combat?.id === id ? { state: res.combat.state, version: res.combat.version } : null;
      },
      parseConflict: (body) => {
        const c = combatConflictSchema.safeParse(body);
        if (!c.success || c.data.error !== 'version_conflict') return null;
        const same = c.data.combat?.id === id ? c.data.combat : null;
        return { env: same ? { state: same.state, version: same.version } : null, message: c.data.message };
      },
      onConfirmed: (env) => this.setRound(id, env.state.round),
      onGone: (lostOffline) => {
        // Kampen er avsluttet eller byttet ut et annet sted. Hent den som gjelder nå (eller ingen).
        if (this.info?.id !== id) return;
        this.notice = lostOffline ? COMBAT_ENDED_OFFLINE_LOST : COMBAT_ENDED_ELSEWHERE;
        this.drop();
        this.emit();
        void this.load();
      },
      onError: this.opts.onError,
      // Uten nett: endringene lagres lokalt (med kampens ID) og sendes når nettet er tilbake.
      storage:
        this.gen === offlineGeneration()
          ? localSyncStorage(offlineKeys.combatSync(this.opts.gameId), combatStateSchema, id)
          : undefined,
    };
    // Husk kampen, så den kan åpnes uten nett etter omlasting.
    writeOffline(offlineKeys.combat(this.opts.gameId), { combat }, this.gen);
    const sync = new VersionedSync(options);
    this.sync = sync;
    this.unsubscribeSync = sync.subscribe(() => this.emit());
    // Tilstanden kan komme fra lokal lagring (nyere enn `combat`), så runden hentes derfra.
    this.setRound(id, sync.getSnapshot().state.round);
    this.emit();
    // Send endringer som ble liggende fra forrige gang.
    sync.resume();
  }

  private setRound(id: number, round: number): void {
    if (this.info?.id !== id || this.info.round === round) return;
    this.info = { ...this.info, round };
    this.emit();
  }

  private drop(): void {
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.sync = null;
    this.info = null;
  }

  private fail(err: unknown): void {
    this.error = errorMessage(err);
    this.opts.onError?.(err);
    this.emit();
  }

  private makeSnapshot(): CombatSnapshot {
    return {
      loading: this.loading,
      error: this.error,
      combat: this.info,
      sync: this.sync ? this.sync.getSnapshot() : null,
      notice: this.notice,
    };
  }

  private emit(): void {
    const next = this.makeSnapshot();
    const prev = this.snapshot;
    if (
      prev.loading === next.loading &&
      prev.error === next.error &&
      prev.combat === next.combat &&
      prev.sync === next.sync &&
      prev.notice === next.notice
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

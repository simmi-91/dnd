import type { GameState } from '@dnd/rules';
import { stateConflictSchema, type GameStateEnvelope } from '@dnd/shared';
import { isApiRequestError } from '../api/client';
import { errorMessage } from '../components/errorMessage';

// Synk av spilltilstanden (UTVIKLINGSPLAN 5.3). Tilstanden holdes lokalt og lagres 0,7 sekunder etter
// siste endring, med høyst én PUT om gangen. Endringer som kommer mens en PUT pågår, sendes i neste.
// Ved 409 brukes serverens tilstand. Motoren er ren TypeScript, så React bare abonnerer på den.

export type SyncStatus = 'saved' | 'saving' | 'error';

export interface SyncSnapshot {
  state: GameState;
  version: number;
  status: SyncStatus;
  /** Kort melding til brukeren, f.eks. etter en 409. */
  notice: string | null;
  /** Lagringen feilet. Teksten kan vises. */
  error: string | null;
  /**
   * Øker hver gang tilstanden byttes ut fra serveren (409, ny henting eller `replace`), så
   * meldinger om lokale endringer kan fjernes.
   */
  replaced: number;
}

export interface StateSyncOptions {
  initial: GameStateEnvelope;
  /** `keepalive` er sann når siden lukkes eller fanen skjules, så PUT-en fullføres likevel. */
  put: (env: GameStateEnvelope, opts: { keepalive: boolean }) => Promise<GameStateEnvelope>;
  get: () => Promise<GameStateEnvelope>;
  debounceMs?: number;
  retryMs?: number;
  /** Ny tilstand som serveren har bekreftet (lagret, hentet eller fra 409). */
  onConfirmed?: (env: GameStateEnvelope) => void;
  /** Feil fra API-et, så 401 og sperret konto håndteres som ellers i appen. */
  onError?: (err: unknown) => void;
}

export const SAVE_DEBOUNCE_MS = 700;
const RETRY_MS = 5000;

export class StateSync {
  private state: GameState;
  private version: number;
  private dirty = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Teller lokale endringer, så en henting som kommer for sent, ikke overskriver dem. */
  private edits = 0;
  private notice: string | null = null;
  private error: string | null = null;
  private replaced = 0;
  /** Neste PUT skal ha `keepalive` (siden lukkes eller fanen skjules). */
  private keepalive = false;
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly opts: StateSyncOptions;

  constructor(opts: StateSyncOptions) {
    this.opts = opts;
    this.state = opts.initial.state;
    this.version = opts.initial.version;
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  /** Endrer tilstanden lokalt og lagrer etter en liten pause. */
  update = (fn: (state: GameState) => GameState): void => {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    this.dirty = true;
    this.edits += 1;
    this.schedule(this.opts.debounceMs ?? SAVE_DEBOUNCE_MS);
    this.emit();
  };

  /** Bytter til en tilstand fra serveren, f.eks. etter «Oppdater fra D&D Beyond». */
  replace = (env: GameStateEnvelope): void => {
    this.clearTimer();
    this.state = env.state;
    this.version = env.version;
    this.dirty = false;
    this.error = null;
    this.edits += 1;
    this.replaced += 1;
    this.emit();
  };

  clearNotice = (): void => {
    this.notice = null;
    this.emit();
  };

  /** Sender det som ikke er lagret, med en gang, og venter til alt er lagret. Gir false ved feil. */
  flush = async (): Promise<boolean> => {
    this.clearTimer();
    while (this.dirty || this.inFlight) {
      if (this.inFlight) await this.inFlight;
      else {
        await this.send();
        if (this.error) return false;
      }
    }
    return this.error == null;
  };

  /** Henter tilstanden på nytt, men bare når alt er lagret. */
  refetch = async (): Promise<void> => {
    if (!this.isIdle()) return;
    const edits = this.edits;
    let env: GameStateEnvelope;
    try {
      env = await this.opts.get();
    } catch (err) {
      this.opts.onError?.(err);
      return;
    }
    // Endret brukeren noe mens hentingen pågikk, gjelder de lokale endringene.
    if (edits !== this.edits || !this.isIdle()) return;
    // Samme versjon betyr samme tilstand: ingenting er byttet ut.
    if (env.version === this.version) return;
    this.state = env.state;
    this.version = env.version;
    this.replaced += 1;
    this.opts.onConfirmed?.(env);
    this.emit();
  };

  /** Fanen lukkes eller komponenten forsvinner: send det som ikke er lagret, uten å vente. */
  sendNow = (): void => {
    if (!this.dirty) return;
    this.clearTimer();
    // Pågår en PUT, sendes endringene med keepalive når den er ferdig.
    this.keepalive = true;
    void this.send();
  };

  private isIdle(): boolean {
    return !this.dirty && !this.inFlight && !this.timer;
  }

  private schedule(ms: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private send(): Promise<void> {
    if (this.inFlight || !this.dirty) return this.inFlight ?? Promise.resolve();
    const sent = this.state;
    const keepalive = this.keepalive;
    this.keepalive = false;
    this.dirty = false;
    const run = async () => {
      try {
        const res = await this.opts.put({ state: sent, version: this.version }, { keepalive });
        this.version = res.version;
        this.error = null;
        this.opts.onConfirmed?.({ state: sent, version: res.version });
      } catch (err) {
        this.handleError(err);
      } finally {
        this.inFlight = null;
        // Endringer som kom mens PUT-en pågikk, og som ikke venter på en pause, sendes nå.
        if (this.dirty && !this.timer && !this.error) void this.send();
        this.emit();
      }
    };
    this.inFlight = run();
    this.emit();
    return this.inFlight;
  }

  private handleError(err: unknown): void {
    if (isApiRequestError(err) && err.status === 409) {
      const conflict = stateConflictSchema.safeParse(err.body);
      if (conflict.success) {
        this.clearTimer();
        this.state = conflict.data.state;
        this.version = conflict.data.version;
        this.dirty = false;
        this.error = null;
        this.edits += 1;
        this.replaced += 1;
        this.notice = conflict.data.message;
        this.opts.onConfirmed?.({ state: conflict.data.state, version: conflict.data.version });
        return;
      }
    }
    this.dirty = true;
    this.error = errorMessage(err);
    this.opts.onError?.(err);
    // Nett- og serverfeil prøves igjen. 4xx prøves først ved neste endring.
    const retryable = !isApiRequestError(err) || err.status === 0 || err.status >= 500;
    if (retryable && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.error = null;
        void this.send();
      }, this.opts.retryMs ?? RETRY_MS);
    }
  }

  private makeSnapshot(): SyncSnapshot {
    const status: SyncStatus = this.error
      ? 'error'
      : this.dirty || this.inFlight || this.timer
        ? 'saving'
        : 'saved';
    return {
      state: this.state,
      version: this.version,
      status,
      notice: this.notice,
      error: this.error,
      replaced: this.replaced,
    };
  }

  private emit(): void {
    const next = this.makeSnapshot();
    const prev = this.snapshot;
    if (
      prev.state === next.state &&
      prev.version === next.version &&
      prev.status === next.status &&
      prev.notice === next.notice &&
      prev.error === next.error &&
      prev.replaced === next.replaced
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

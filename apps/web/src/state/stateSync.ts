import type { GameState } from '@dnd/rules';
import { stateConflictSchema } from '@dnd/shared';
import { isApiRequestError } from '../api/client';
import { errorMessage } from '../components/errorMessage';

// Synk av data med versjon (UTVIKLINGSPLAN 5.3), brukt av spilltilstanden og kampen. Tilstanden holdes
// lokalt og lagres 0,7 sekunder etter siste endring, med høyst én PUT om gangen. Endringer som kommer
// mens en PUT pågår, sendes i neste. Ved 409 brukes serverens tilstand. Er raden borte på serveren
// (f.eks. kampen er avsluttet på en annen enhet), blir `gone` sann, og lokale endringer forkastes.
// Uten nett (fase 5) beholdes endringene i `storage` (overlever omlasting) og sendes når nettet er
// tilbake. Har serveren endret seg i mellomtiden, vinner serveren som ved 409, med egen melding.
// Motoren er ren TypeScript, så React bare abonnerer på den.

/** `offline`: endringene er ikke sendt fordi nettet er borte. De sendes når det er tilbake. */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

export interface Envelope<T> {
  state: T;
  version: number;
}

export interface SyncSnapshot<T = GameState> {
  state: T;
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
  /** Raden finnes ikke lenger på serveren. Ingenting mer lagres. */
  gone: boolean;
}

/** Det som lagres lokalt: siste kjente tilstand, versjonen den bygger på, og om den er sendt. */
export interface PersistedSync<T> {
  state: T;
  version: number;
  /** Endringer som serveren ikke har bekreftet ennå. */
  dirty: boolean;
  /**
   * Fingeravtrykk av tilstanden endringene bygger på (den fanen sist fikk utenfra). Brukes til å se
   * om en post fra en annen fane bygde videre på denne fanens endringer.
   */
  base?: string;
}

/** Lokal lagring av tilstanden, så den kan leses og sendes etter omlasting uten nett. */
export interface SyncStorage<T> {
  read: () => PersistedSync<T> | null;
  /** Null sletter (raden er borte). */
  write: (rec: PersistedSync<T> | null) => void;
}

/** Endringer uten nett tapte mot en nyere versjon på serveren. */
export const OFFLINE_DISCARDED =
  'Endringene du gjorde uten nett, ble ikke lagret, fordi det var endret på en annen enhet i mellomtiden. Du ser nå det som er lagret.';

/** En annen fane har lagret en annen tilstand lokalt, og den brukes nå. */
export const OTHER_TAB_REPLACED =
  'Endret i en annen fane. Det som ble gjort der, vises nå, og endringene dine her er erstattet.';

/** Lik tilstand, uavhengig av rekkefølgen på nøklene (MySQL-JSON kan stokke dem). */
export function sameState(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** Kort fingeravtrykk av en tilstand (FNV-1a over den kanoniske JSON-en). */
export function fingerprint(v: unknown): string {
  const s = canonical(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : value,
  );
}

/** Svaret i en 409: ny tilstand, eller null hvis raden er borte. */
export interface Conflict<T> {
  env: Envelope<T> | null;
  message: string;
}

export interface SyncOptions<T> {
  initial: Envelope<T>;
  /** `keepalive` er sann når siden lukkes eller fanen skjules, så PUT-en fullføres likevel. */
  put: (env: Envelope<T>, opts: { keepalive: boolean }) => Promise<{ version: number }>;
  /** Gjeldende tilstand på serveren, eller null hvis raden er borte. */
  get: () => Promise<Envelope<T> | null>;
  /** Tolker kroppen i et 409-svar. Null betyr at det ikke var en versjonskonflikt. */
  parseConflict: (body: unknown) => Conflict<T> | null;
  debounceMs?: number;
  retryMs?: number;
  /** Ny tilstand som serveren har bekreftet (lagret, hentet eller fra 409). */
  onConfirmed?: (env: Envelope<T>) => void;
  /**
   * Raden er borte på serveren (henting gav null, eller 409 uten tilstand). `lostOffline` er sann
   * hvis endringer gjort uten nett gikk tapt.
   */
  onGone?: (lostOffline: boolean) => void;
  /** Lokal lagring (fase 5). Uten den lever endringene bare i minnet. */
  storage?: SyncStorage<T>;
  /** Feil fra API-et, så 401 og sperret konto håndteres som ellers i appen. */
  onError?: (err: unknown) => void;
}

export const SAVE_DEBOUNCE_MS = 700;
const RETRY_MS = 5000;

export class VersionedSync<T> {
  private state: T;
  private version: number;
  private dirty = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Teller lokale endringer, så en henting som kommer for sent, ikke overskriver dem. */
  private edits = 0;
  private notice: string | null = null;
  private error: string | null = null;
  private replaced = 0;
  private gone = false;
  /** Neste PUT skal ha `keepalive` (siden lukkes eller fanen skjules). */
  private keepalive = false;
  /** Siste lagring nådde ikke serveren (ingen nett). Endringene venter. */
  private offline = false;
  /** Endringene som venter, ble gjort eller beholdt uten nett. Gir egen melding hvis de taper. */
  private queued = false;
  /** Fingeravtrykk av tilstanden de lokale endringene bygger på (se `PersistedSync.base`). */
  private base: string;
  private snapshot: SyncSnapshot<T>;
  private readonly listeners = new Set<() => void>();
  private readonly opts: SyncOptions<T>;

  constructor(opts: SyncOptions<T>) {
    this.opts = opts;
    this.state = opts.initial.state;
    this.version = opts.initial.version;
    // Det som er lagret lokalt, gjelder hvis det bygger på samme eller nyere versjon. `initial` kan
    // være gammel (lagret uten nett), mens lokal lagring har det siste som ble lagret eller endret.
    const stored = opts.storage?.read() ?? null;
    if (stored && stored.version >= opts.initial.version) {
      this.state = stored.state;
      this.version = stored.version;
      if (stored.dirty) {
        this.dirty = true;
        this.queued = true;
      }
    } else if (stored?.dirty && !sameState(stored.state, opts.initial.state)) {
      // Serveren har en nyere versjon enn den endringene bygde på: serveren vinner. Er tilstanden lik,
      // nådde den siste PUT-en (f.eks. med keepalive) fram, og ingenting er tapt.
      this.notice = OFFLINE_DISCARDED;
    }
    this.base =
      stored?.dirty && stored.version >= opts.initial.version && stored.base
        ? stored.base
        : fingerprint(this.state);
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncSnapshot<T> => this.snapshot;

  /** Endrer tilstanden lokalt og lagrer etter en liten pause. Gjør ingenting når raden er borte. */
  update = (fn: (state: T) => T): void => {
    if (this.gone) return;
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    this.dirty = true;
    this.edits += 1;
    if (this.offline) this.queued = true;
    this.schedule(this.opts.debounceMs ?? SAVE_DEBOUNCE_MS);
    this.persist();
    this.emit();
  };

  /** Bytter til en tilstand fra serveren, f.eks. etter «Oppdater fra D&D Beyond». */
  replace = (env: Envelope<T>): void => {
    this.clearTimer();
    this.state = env.state;
    this.version = env.version;
    this.dirty = false;
    this.error = null;
    this.offline = false;
    this.queued = false;
    this.gone = false;
    this.edits += 1;
    this.replaced += 1;
    this.base = fingerprint(this.state);
    this.persist();
    this.emit();
  };

  /**
   * Kalles når skjermen tas i bruk: lagrer tilstanden lokalt og sender endringer som ble liggende
   * fra forrige gang (lagret uten nett før omlasting).
   */
  resume = (): void => {
    this.persist();
    this.retryNow();
  };

  /** Sender ventende endringer med en gang, f.eks. når nettet er tilbake. */
  retryNow = (): void => {
    if (!this.dirty || this.inFlight || this.gone) return;
    this.clearTimer();
    this.error = null;
    void this.send();
  };

  /**
   * En annen fane har skrevet til den lokale lagringen. Er posten der like ny eller nyere, tas den i
   * bruk, så fanene ikke overskriver hverandre i det stille. Hadde denne fanen endringer som ikke er
   * sendt, og som blir erstattet, sier en melding det.
   */
  syncFromStorage = (): void => {
    if (this.gone || this.inFlight) return;
    const rec = this.opts.storage?.read();
    if (!rec || rec.version < this.version) return;
    const same = sameState(rec.state, this.state);
    if (same && rec.version === this.version && rec.dirty === this.dirty) return;
    // Meldingen bare når egne endringer forkastes: posten bygde ikke på det denne fanen har nå.
    if (this.dirty && !same && rec.base !== fingerprint(this.state)) this.notice = OTHER_TAB_REPLACED;
    this.clearTimer();
    this.state = rec.state;
    this.version = rec.version;
    this.dirty = rec.dirty;
    this.base = fingerprint(rec.state);
    this.queued = rec.dirty;
    this.error = null;
    this.offline = false;
    this.edits += 1;
    this.replaced += 1;
    // Den andre fanen sender også, men denne gjør det i tilfelle den andre lukkes. Blir det 409 med
    // samme tilstand, er det ingen melding.
    if (this.dirty) this.schedule(this.opts.debounceMs ?? SAVE_DEBOUNCE_MS);
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
    return this.error == null && !this.gone;
  };

  /** Henter tilstanden på nytt, men bare når alt er lagret. */
  refetch = async (): Promise<void> => {
    if (!this.isIdle() || this.gone) return;
    const edits = this.edits;
    let env: Envelope<T> | null;
    try {
      env = await this.opts.get();
    } catch (err) {
      this.opts.onError?.(err);
      return;
    }
    // Endret brukeren noe mens hentingen pågikk, gjelder de lokale endringene.
    if (edits !== this.edits || !this.isIdle() || this.gone) return;
    if (env == null) {
      this.markGone();
      return;
    }
    // Samme versjon betyr samme tilstand: ingenting er byttet ut.
    if (env.version === this.version) return;
    this.state = env.state;
    this.version = env.version;
    this.replaced += 1;
    this.opts.onConfirmed?.(env);
    this.base = fingerprint(this.state);
    this.persist();
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

  private markGone(notice?: string): void {
    const lostOffline = this.queued;
    this.clearTimer();
    this.gone = true;
    this.dirty = false;
    this.error = null;
    this.offline = false;
    this.queued = false;
    this.edits += 1;
    if (notice) this.notice = notice;
    this.persist();
    this.opts.onGone?.(lostOffline);
    this.emit();
  }

  /** Lagrer tilstanden lokalt. En PUT som ikke er besvart, regnes som ikke lagret. */
  private persist(): void {
    const storage = this.opts.storage;
    if (!storage) return;
    if (this.gone) {
      storage.write(null);
      return;
    }
    storage.write({
      state: this.state,
      version: this.version,
      dirty: this.dirty || this.inFlight != null,
      base: this.base,
    });
  }

  private send(): Promise<void> {
    if (this.inFlight || !this.dirty || this.gone) return this.inFlight ?? Promise.resolve();
    const sent = this.state;
    const keepalive = this.keepalive;
    this.keepalive = false;
    this.dirty = false;
    const run = async () => {
      try {
        const res = await this.opts.put({ state: sent, version: this.version }, { keepalive });
        this.version = res.version;
        this.error = null;
        this.offline = false;
        // Endringer gjort etter denne PUT-en er ikke lenger «uten nett» før en ny lagring feiler.
        this.queued = false;
        this.opts.onConfirmed?.({ state: sent, version: res.version });
      } catch (err) {
        this.handleError(err);
      } finally {
        this.inFlight = null;
        this.persist();
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
      const conflict = this.opts.parseConflict(err.body);
      if (conflict) {
        if (!conflict.env) {
          this.markGone(conflict.message);
          return;
        }
        // Serveren vinner. Var endringene gjort uten nett, sier meldingen det.
        // Har serveren alt det samme (en PUT nådde fram uten at svaret kom), er ingenting tapt.
        const notice = sameState(conflict.env.state, this.state)
          ? null
          : this.queued
            ? OFFLINE_DISCARDED
            : conflict.message;
        this.clearTimer();
        this.state = conflict.env.state;
        this.version = conflict.env.version;
        this.base = fingerprint(this.state);
        this.dirty = false;
        this.error = null;
        this.offline = false;
        this.queued = false;
        this.edits += 1;
        this.replaced += 1;
        if (notice) this.notice = notice;
        this.opts.onConfirmed?.(conflict.env);
        return;
      }
    }
    this.dirty = true;
    this.error = errorMessage(err);
    // Ingen svar i det hele tatt: endringene venter på nettet.
    this.offline = isApiRequestError(err) && err.status === 0;
    if (this.offline) this.queued = true;
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

  private makeSnapshot(): SyncSnapshot<T> {
    // Uten nett vises «Lagres når nettet er tilbake», også mens et nytt forsøk pågår.
    const waiting = this.dirty || this.inFlight || this.timer;
    const status: SyncStatus =
      this.offline && waiting ? 'offline' : this.error ? 'error' : waiting ? 'saving' : 'saved';
    return {
      state: this.state,
      version: this.version,
      status,
      notice: this.notice,
      // Uten nett er det ingen feil å vise: endringene er tatt vare på.
      error: status === 'offline' ? null : this.error,
      replaced: this.replaced,
      gone: this.gone,
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
      prev.replaced === next.replaced &&
      prev.gone === next.gone
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

export type StateSyncOptions = Omit<SyncOptions<GameState>, 'parseConflict'>;

/** Spilltilstanden (`dd_game_state`). Raden finnes så lenge spillet finnes, så den blir aldri `gone`. */
export class StateSync extends VersionedSync<GameState> {
  constructor(opts: StateSyncOptions) {
    super({
      ...opts,
      parseConflict: (body) => {
        const c = stateConflictSchema.safeParse(body);
        return c.success
          ? { env: { state: c.data.state, version: c.data.version }, message: c.data.message }
          : null;
      },
    });
  }
}

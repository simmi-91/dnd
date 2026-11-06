import type { CreateSessionRequest, Session, SessionSaveResponse, UpdateSessionRequest } from '@dnd/shared';
import { isBodyTooLong, isNotFound, sessionConflictOf } from '../api/campaign';
import { isApiRequestError } from '../api/client';
import { errorMessage } from '../components/errorMessage';
import { SAVE_DEBOUNCE_MS, type SyncStatus } from './stateSync';

// Lagring av en økt i dagboka (5.3 og «Avklart før fase 4», punkt 2–4). Som `VersionedSync`:
// lagrer 0,7 s etter siste endring, én skriving om gangen, og `keepalive` når fanen skjules. Men
// fritekst skal aldri byttes ut uten at brukeren velger det:
// - Økta i dag finnes kanskje ikke ennå. Da opprettes den (POST) ved første lagring som har tekst.
// - Svaret har teksten der `(new)` er byttet med `(e:ID)`. Den tas inn bare hvis brukeren ikke har
//   skrevet videre. Ellers sendes den lokale teksten ved neste lagring, og serveren gjenbruker navnet.
// - 409: den lokale teksten beholdes, og brukeren velger «Behold min» eller «Bruk den andre».
// - 422 `body_too_long`: meldingen vises, teksten beholdes, og neste endring prøver igjen.
// - Er økta slettet på en annen enhet, beholdes teksten, og den kan lagres som en ny økt.
// Ren TypeScript, så React bare abonnerer.

export interface JournalDoc {
  title: string;
  playedOn: string;
  body: string;
}

export interface JournalSnapshot {
  doc: JournalDoc;
  /** Økta slik serveren sist bekreftet den. Null før økta i dag er opprettet. */
  session: Session | null;
  status: SyncStatus;
  /** Lagringen feilet (også 422). Teksten kan vises. */
  error: string | null;
  /** 422 `body_too_long`: teksten er for lang til å lagres. */
  tooLong: boolean;
  /** 409: økta slik den er på serveren. Lagringen venter til brukeren har valgt. */
  conflict: Session | null;
  /** Økta er slettet på serveren. */
  gone: boolean;
  /** Øker når teksten byttes ut fra serveren (henting eller «Bruk den andre»). */
  replaced: number;
}

export interface JournalSyncOptions {
  /** Økta fra serveren, eller null for en tom skriveflate som opprettes ved første lagring. */
  initial: Session | null;
  /** Tittel og dato for en ny økt. */
  initialDoc?: Partial<JournalDoc>;
  create: (body: CreateSessionRequest, opts: { keepalive: boolean }) => Promise<SessionSaveResponse>;
  update: (
    id: number,
    body: UpdateSessionRequest,
    opts: { keepalive: boolean },
  ) => Promise<SessionSaveResponse>;
  /** Økta på serveren, eller null hvis den er slettet. */
  get: (id: number) => Promise<Session | null>;
  /** Før økta er opprettet: en økt med datoen som er laget et annet sted (annen enhet, hurtignotat). */
  findByDate?: (playedOn: string) => Promise<Session | null>;
  /** Lagret (svaret fra serveren). */
  onSaved?: (res: SessionSaveResponse) => void;
  /** Feil fra API-et, så 401 og sperret konto håndteres som ellers i appen. */
  onError?: (err: unknown) => void;
  debounceMs?: number;
  retryMs?: number;
}

const RETRY_MS = 5000;

function docOf(s: Session): JournalDoc {
  return { title: s.title, playedOn: s.playedOn, body: s.body };
}

function sameDoc(a: JournalDoc, b: JournalDoc): boolean {
  return a.title === b.title && a.playedOn === b.playedOn && a.body === b.body;
}

export class JournalSync {
  private doc: JournalDoc;
  private session: Session | null;
  private dirty = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Teller lokale endringer, så et svar eller en henting som kommer for sent, ikke overskriver dem. */
  private edits = 0;
  private error: string | null = null;
  private tooLong = false;
  private conflict: Session | null = null;
  private gone = false;
  private stopped = false;
  private replaced = 0;
  private keepalive = false;
  /** Versjonen den pågående lagringen bygger på (null for en ny økt). */
  private sendingBase: number | null = null;
  private snapshot: JournalSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly opts: JournalSyncOptions;

  constructor(opts: JournalSyncOptions) {
    this.opts = opts;
    this.session = opts.initial;
    this.doc = opts.initial ? docOf(opts.initial) : { title: '', playedOn: '', body: '', ...opts.initialDoc };
    this.snapshot = this.makeSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): JournalSnapshot => this.snapshot;

  /** Endrer teksten lokalt og lagrer etter en liten pause. */
  edit = (patch: Partial<JournalDoc>): void => {
    if (this.stopped) return;
    const next = { ...this.doc, ...patch };
    if (sameDoc(next, this.doc)) return;
    this.doc = next;
    this.dirty = true;
    this.edits += 1;
    this.schedule(this.opts.debounceMs ?? SAVE_DEBOUNCE_MS);
    this.emit();
  };

  /** 409: lagre min tekst over den andre (bygger på serverens versjon). */
  keepMine = (): void => {
    const theirs = this.conflict;
    if (!theirs) return;
    this.conflict = null;
    this.session = theirs;
    this.error = null;
    this.dirty = true;
    this.emit();
    void this.send();
  };

  /** 409: bruk teksten fra den andre enheten, og forkast min. */
  useTheirs = (): void => {
    const theirs = this.conflict;
    if (!theirs) return;
    this.clearTimer();
    this.conflict = null;
    this.session = theirs;
    this.doc = docOf(theirs);
    this.dirty = false;
    this.error = null;
    this.edits += 1;
    this.replaced += 1;
    this.emit();
  };

  /** Økta er slettet et annet sted: lagre teksten som en ny økt. */
  saveAsNew = (): void => {
    if (!this.gone) return;
    this.gone = false;
    this.session = null;
    this.error = null;
    this.dirty = true;
    this.emit();
    void this.send();
  };

  /** Slutter å lagre, f.eks. før økta slettes. */
  stop = (): void => {
    this.stopped = true;
    this.clearTimer();
    this.dirty = false;
    this.emit();
  };

  /** Sender det som ikke er lagret, med en gang, og venter. Gir false ved feil eller konflikt. */
  flush = async (): Promise<boolean> => {
    this.clearTimer();
    while (this.canSend() || this.inFlight) {
      if (this.inFlight) await this.inFlight;
      else {
        await this.send();
        if (this.error) return false;
      }
    }
    return this.error == null && this.conflict == null && !this.gone && !this.dirty;
  };

  /**
   * Fanen skjules eller komponenten forsvinner: send det som ikke er lagret, med `keepalive` og uten
   * å vente. Pågår en lagring av økta, sendes den siste teksten med en gang likevel (siden kan være
   * borte før svaret kommer), med versjonen den pågående lagringen gir (serveren øker med 1).
   */
  sendNow = (): void => {
    if (!this.dirty || this.stopped || this.conflict || this.gone) return;
    this.clearTimer();
    const running = this.inFlight;
    const id = this.session?.id;
    if (running && this.sendingBase != null && id != null) {
      const sent = this.doc;
      const editsAtSend = this.edits;
      const version = this.sendingBase + 1;
      this.sendingBase = version;
      this.dirty = false;
      const req = this.opts.update(id, { ...sent, version }, { keepalive: true });
      // Avvisningen håndteres når svaret tas imot (etter den pågående lagringen).
      req.catch(() => undefined);
      void this.track(async () => ({ res: await req, editsAtSend }), running);
      return;
    }
    this.keepalive = true;
    void this.send();
  };

  /** Henter økta på nytt, men bare når alt er lagret, så ulagret tekst aldri overskrives. */
  refetch = async (): Promise<void> => {
    if (!this.isIdle()) return;
    const edits = this.edits;
    const id = this.session?.id;
    let fresh: Session | null;
    try {
      if (id != null) fresh = await this.opts.get(id);
      else if (this.opts.findByDate && this.doc.playedOn)
        fresh = await this.opts.findByDate(this.doc.playedOn);
      else return;
    } catch (err) {
      this.opts.onError?.(err);
      return;
    }
    if (edits !== this.edits || !this.isIdle() || this.session?.id !== id) return;
    if (fresh == null) {
      if (id != null) {
        this.gone = true;
        this.emit();
      }
      return;
    }
    if (this.session && fresh.version === this.session.version) return;
    this.session = fresh;
    this.doc = docOf(fresh);
    this.replaced += 1;
    this.emit();
  };

  private isIdle(): boolean {
    return (
      !this.dirty &&
      !this.inFlight &&
      !this.timer &&
      !this.conflict &&
      !this.gone &&
      !this.stopped &&
      this.error == null
    );
  }

  private canSend(): boolean {
    return this.dirty && !this.conflict && !this.gone && !this.stopped;
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
    if (this.inFlight) return this.inFlight;
    if (!this.canSend()) return Promise.resolve();
    const session = this.session;
    // En tom skriveflate lages ikke som økt.
    if (!session && this.isEmpty()) {
      this.dirty = false;
      this.emit();
      return Promise.resolve();
    }
    const keepalive = this.keepalive;
    this.keepalive = false;
    this.dirty = false;
    this.sendingBase = session ? session.version : null;
    return this.track(async () => {
      let base = session;
      // Før økta i dag opprettes: finnes det nå en økt med datoen (annen enhet, hurtignotat), brukes
      // den, og teksten legges til under dens. Ikke når siden lukkes, for da rekker ikke hentingen.
      if (!base && !keepalive && this.opts.findByDate) {
        const found = await this.opts.findByDate(this.doc.playedOn);
        if (found && !this.stopped) {
          base = found;
          this.adoptExisting(found);
        }
      }
      const sent = this.doc;
      const editsAtSend = this.edits;
      this.sendingBase = base ? base.version : null;
      const res = base
        ? await this.opts.update(base.id, { ...sent, version: base.version }, { keepalive })
        : await this.opts.create(sent, { keepalive });
      return { res, editsAtSend };
    });
  }

  /** Legger den lokale teksten under teksten i en økt som allerede finnes, og bruker den økta. */
  private adoptExisting(found: Session): void {
    const mine = this.doc;
    const body =
      found.body.trim() === ''
        ? mine.body
        : mine.body.trim() === ''
          ? found.body
          : `${found.body.replace(/\s+$/, '')}\n\n${mine.body}`;
    this.session = found;
    this.doc = { title: found.title || mine.title, playedOn: found.playedOn, body };
    this.replaced += 1;
    this.emit();
  }

  private isEmpty(): boolean {
    return this.doc.body.trim() === '' && this.doc.title.trim() === '';
  }

  /**
   * Kjører en lagring og tar imot svaret. `after` er en lagring som pågår: svaret på den tas imot
   * først, så svarene behandles i rekkefølge selv om forespørslene ble sendt samtidig.
   */
  private track(
    request: () => Promise<{ res: SessionSaveResponse; editsAtSend: number }>,
    after?: Promise<void>,
  ): Promise<void> {
    const run = async () => {
      if (after) await after;
      try {
        const { res, editsAtSend } = await request();
        if (this.stopped) return;
        this.session = res.session;
        this.error = null;
        this.tooLong = false;
        // Serverens tekst (med `(new)` byttet med ID) tas inn bare hvis brukeren ikke har skrevet videre.
        if (this.edits === editsAtSend) {
          const server = docOf(res.session);
          if (!sameDoc(server, this.doc)) this.doc = server;
        }
        this.opts.onSaved?.(res);
      } catch (err) {
        this.handleError(err);
      } finally {
        if (this.inFlight === promise) {
          this.inFlight = null;
          // Endringer som kom mens lagringen pågikk, og som ikke venter på en pause, sendes nå.
          if (this.dirty && !this.timer && !this.error) void this.send();
        }
        this.emit();
      }
    };
    const promise: Promise<void> = run();
    this.inFlight = promise;
    this.emit();
    return promise;
  }

  private handleError(err: unknown): void {
    this.dirty = true;
    const conflict = sessionConflictOf(err);
    if (conflict?.error === 'version_conflict') {
      this.clearTimer();
      this.conflict = conflict.session;
      this.error = null;
      return;
    }
    if (this.session && isNotFound(err)) {
      this.clearTimer();
      this.gone = true;
      this.error = null;
      return;
    }
    this.error = errorMessage(err);
    this.opts.onError?.(err);
    this.tooLong = isBodyTooLong(err);
    if (this.tooLong) return;
    // Nett- og serverfeil prøves igjen. Andre 4xx prøves først ved neste endring.
    const retryable = !isApiRequestError(err) || err.status === 0 || err.status >= 500;
    if (retryable && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.error = null;
        void this.send();
      }, this.opts.retryMs ?? RETRY_MS);
    }
  }

  private makeSnapshot(): JournalSnapshot {
    const status: SyncStatus =
      this.error || this.conflict || this.gone
        ? 'error'
        : this.dirty || this.inFlight || this.timer
          ? 'saving'
          : 'saved';
    return {
      doc: this.doc,
      session: this.session,
      status,
      error: this.error,
      tooLong: this.tooLong,
      conflict: this.conflict,
      gone: this.gone,
      replaced: this.replaced,
    };
  }

  private emit(): void {
    const next = this.makeSnapshot();
    const prev = this.snapshot;
    if (
      prev.doc === next.doc &&
      prev.session === next.session &&
      prev.status === next.status &&
      prev.error === next.error &&
      prev.tooLong === next.tooLong &&
      prev.conflict === next.conflict &&
      prev.gone === next.gone &&
      prev.replaced === next.replaced
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of this.listeners) l();
  }
}

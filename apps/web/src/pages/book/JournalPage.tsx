import { SESSION_TITLE_MAX, type Game, type Session } from '@dnd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import {
  bookPath,
  campaignKeys,
  isNotFound,
  journalPath,
  latestOn,
  todayIso,
  useSession,
  useSessions,
} from '../../api/campaign';
import { api } from '../../api/client';
import { parseGameId } from '../../api/games';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from '../../components/errorMessage';
import { MentionEditor } from '../../components/MentionEditor';
import { ErrorState, Loading } from '../../components/States';
import { useDocumentTitle } from '../../components/useDocumentTitle';
import { useMediaQuery } from '../../components/useMediaQuery';
import type { SyncStatus } from '../../state/stateSync';
import { useJournalSync } from '../../state/useJournalSync';
import { useGameBase } from '../game/GameContext';
import { JournalRegister } from './JournalRegister';
import { formatPlayedOn } from './labels';
import styles from './Journal.module.css';

/** Fra 1100 px: øktene til venstre, skriveflaten i midten og registeret til høyre. */
const WIDE_QUERY = '(min-width: 1100px)';

/**
 * `/spill/:gameId/dagbok` (økta i dag) og `/spill/:gameId/dagbok/:sessionId`. Finnes ingen økt med
 * dagens dato, vises en tom skriveflate, og økta opprettes ved første lagring med neste nummer.
 * Skriveflaten er alltid redigerbar, som en notatbok. Koblingene er lenker i registeret.
 */
export function JournalPage() {
  const game = useGameBase();
  useDocumentTitle(`Dagbok · ${game.name}`);
  const wide = useMediaQuery(WIDE_QUERY);
  const { sessionId: raw } = useParams();
  const sessionId = raw === undefined ? null : (parseGameId(raw) ?? -1);

  return (
    <div className={`${styles.layout} ${wide ? styles.wide : ''}`}>
      {wide && <JournalNav gameId={game.id} />}
      <div className={styles.content}>
        {sessionId == null ? (
          <TodayLoader key="i-dag" game={game} wide={wide} />
        ) : (
          <SessionLoader key={sessionId} game={game} sessionId={sessionId} wide={wide} />
        )}
      </div>
    </div>
  );
}

/** Øktene i spillet, med «I dag» øverst (laptop). */
function JournalNav({ gameId }: { gameId: number }) {
  const sessions = useSessions(gameId);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.navLink} ${styles.navOn}` : styles.navLink;
  return (
    <nav className={styles.nav} aria-label="Økter">
      <div className="sc">Dagbok</div>
      <ul className={styles.navList}>
        <li>
          <NavLink to={journalPath(gameId)} end className={linkClass}>
            I dag
          </NavLink>
        </li>
        {sessions.data?.map((s) => (
          <li key={s.id}>
            <NavLink to={journalPath(gameId, s.id)} className={linkClass}>
              Økt {s.number} · {formatPlayedOn(s.playedOn)}
              {s.title && <span className={`dim ${styles.navTitle}`}>{s.title}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      {sessions.isError && <p className="dim">Fikk ikke hentet øktene.</p>}
    </nav>
  );
}

interface LoaderProps {
  game: Game;
  wide: boolean;
}

/** Økta i dag: den med høyest nummer for datoen, eller en tom skriveflate. Valget låses ved oppstart. */
function TodayLoader({ game, wide }: LoaderProps) {
  const sessions = useSessions(game.id);
  const [today] = useState(todayIso);
  const [target, setTarget] = useState<{ id: number | null; next: number } | undefined>(undefined);
  if (target === undefined && sessions.data) {
    const found = latestOn(sessions.data, today);
    const next = sessions.data.reduce((max, s) => Math.max(max, s.number), 0) + 1;
    setTarget({ id: found?.id ?? null, next });
  }

  if (target === undefined) {
    if (sessions.isError) {
      return (
        <ErrorState
          title="Fikk ikke hentet dagboka"
          message={errorMessage(sessions.error)}
          onRetry={() => void sessions.refetch()}
          retrying={sessions.isFetching}
        />
      );
    }
    return <Loading label="Henter dagboka …" />;
  }
  if (target.id != null) return <SessionLoader game={game} sessionId={target.id} wide={wide} />;
  return <JournalEditor game={game} initial={null} nextNumber={target.next} playedOn={today} wide={wide} />;
}

function SessionLoader({ game, sessionId, wide }: LoaderProps & { sessionId: number }) {
  const session = useSession(sessionId > 0 ? sessionId : null);
  const missing = (
    <div className="card">
      <h1>Fant ikke økta</h1>
      <p className="dim">Den kan være slettet, eller lenken er feil.</p>
      <Link className="btn" to={journalPath(game.id)}>
        Til økta i dag
      </Link>
    </div>
  );
  if (sessionId < 0) return missing;
  if (session.isPending) return <Loading label="Henter økta …" />;
  if (!session.data) {
    if (isNotFound(session.error)) return missing;
    return (
      <ErrorState
        title="Fikk ikke hentet økta"
        message={errorMessage(session.error)}
        onRetry={() => void session.refetch()}
        retrying={session.isFetching}
      />
    );
  }
  if (session.data.gameId !== game.id) return missing;
  return (
    <JournalEditor
      key={session.data.id}
      game={game}
      initial={session.data}
      nextNumber={session.data.number}
      playedOn={session.data.playedOn}
      wide={wide}
    />
  );
}

interface EditorProps {
  game: Game;
  initial: Session | null;
  nextNumber: number;
  playedOn: string;
  wide: boolean;
}

function JournalEditor({ game, initial, nextNumber, playedOn, wide }: EditorProps) {
  const gameId = game.id;
  const sync = useJournalSync(gameId, initial, { playedOn });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = { heading: useId(), title: useId(), date: useId(), body: useId(), error: useId() };
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { doc, session, conflict } = sync;
  const number = session?.number ?? nextNumber;

  async function doDelete() {
    if (!session) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (!(await sync.flush())) {
        setDeleting(false);
        setConfirming(false);
        setDeleteError(
          'Økta er ikke slettet, fordi de siste endringene ikke ble lagret. Løs det først, og prøv igjen.',
        );
        return;
      }
      await api.delete(`/api/sessions/${session.id}`);
      sync.stop();
      qc.removeQueries({ queryKey: campaignKeys.session(session.id) });
      void navigate(`${bookPath(gameId)}?fane=okter`, { replace: true });
      void qc.invalidateQueries({ queryKey: campaignKeys.all });
    } catch (err) {
      setDeleting(false);
      setConfirming(false);
      setDeleteError(errorMessage(err));
    }
  }

  const register = <JournalRegister gameId={gameId} body={doc.body} />;

  return (
    <div className={`${styles.editorGrid} ${wide ? styles.editorWide : ''}`}>
      <article className={styles.main} aria-labelledby={ids.heading}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div className="sc">
              {game.name} · Økt {number}
            </div>
            {(session != null || sync.status !== 'saved') && (
              <SaveIndicator status={sync.status} error={sync.error} />
            )}
          </div>
          <h1 id={ids.heading} className={styles.date}>
            {formatPlayedOn(doc.playedOn)}
          </h1>
          {!wide && (
            <Link className={styles.allLink} to={`${bookPath(gameId)}?fane=okter`}>
              Alle økter
            </Link>
          )}
        </header>

        <div className={styles.meta}>
          <div className={`field ${styles.titleField}`}>
            <label className="field__label" htmlFor={ids.title}>
              Tittel
            </label>
            <input
              id={ids.title}
              className="input"
              value={doc.title}
              maxLength={SESSION_TITLE_MAX}
              placeholder="Valgfri"
              onChange={(e) => sync.edit({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.date}>
              Dato
            </label>
            <input
              id={ids.date}
              className="input"
              type="date"
              required
              value={doc.playedOn}
              onChange={(e) => {
                if (e.target.value) sync.edit({ playedOn: e.target.value });
              }}
            />
          </div>
        </div>

        {conflict && (
          <div className="alert" role="alert">
            <p>
              <strong>Økta ble endret på en annen enhet.</strong> Teksten din er ikke lagret. Vil du beholde
              din versjon, eller bruke den andre?
            </p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={sync.keepMine}>
                Behold min
              </button>
              <button type="button" className="btn btn--ghost" onClick={sync.useTheirs}>
                Bruk den andre
              </button>
            </div>
          </div>
        )}
        {sync.gone && (
          <div className="alert" role="alert">
            <p>Økta er slettet på en annen enhet. Teksten din er ikke lagret.</p>
            <div className="btn-row">
              <button type="button" className="btn" onClick={sync.saveAsNew}>
                Lagre som ny økt
              </button>
            </div>
          </div>
        )}
        {sync.error && (
          <p id={ids.error} className="alert" role="alert">
            {sync.error}
          </p>
        )}

        <label htmlFor={ids.body} className="visually-hidden">
          Hva skjedde i økta?
        </label>
        <MentionEditor
          id={ids.body}
          gameId={gameId}
          value={doc.body}
          onChange={(body) => sync.edit({ body })}
          placeholder="Skriv her …"
          className={styles.surface}
          aria-describedby={sync.error ? ids.error : undefined}
          aria-invalid={sync.tooLong}
        />

        {!wide && (
          <details className={styles.registerDetails}>
            <summary>Nevnt i økta</summary>
            {register}
          </details>
        )}

        {deleteError && (
          <p className="alert" role="alert">
            {deleteError}
          </p>
        )}
        {session && (
          <div className="btn-row">
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirming(true)}>
              Slett økt
            </button>
          </div>
        )}
      </article>

      {wide && (
        <aside className={styles.register} aria-label="Register">
          <div className="sc">Register · bygges automatisk</div>
          {register}
        </aside>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Slette økt ${number}?`}>
        <p>
          Økta og teksten i den slettes for godt. Personer, steder og quester som er nevnt, blir stående i
          oppslagsverket.
        </p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void doDelete()} disabled={deleting}>
            {deleting ? 'Sletter …' : 'Slett'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
            Avbryt
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function SaveIndicator({ status, error }: { status: SyncStatus; error: string | null }) {
  const text = status === 'error' ? 'Ikke lagret' : status === 'saving' ? 'Lagrer …' : 'Lagret';
  // Bare feil kunngjøres. «Lagrer …» og «Lagret» mens man skriver blir for pratsomt.
  const announce = status === 'error';
  return (
    <div
      className={`${styles.sync} ${status === 'error' ? styles.syncError : ''}`}
      data-status={status}
      title={error ?? undefined}
    >
      <span className={styles.dot} aria-hidden="true" data-status={status} />
      <span aria-hidden={announce ? true : undefined}>{text}</span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announce ? `${text}${error ? `: ${error}` : ''}` : ''}
      </span>
    </div>
  );
}

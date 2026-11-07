import type { Sheet } from '@dnd/rules';
import type { Game, GameStateEnvelope } from '@dnd/shared';
import { Link, Outlet, useParams } from 'react-router';
import { parseGameId, useGame } from '../../api/games';
import { isApiRequestError } from '../../api/client';
import { errorMessage } from '../../components/errorMessage';
import { ErrorState, Loading } from '../../components/States';
import { useGameState } from '../../state/useGameState';
import { NotFoundPage } from '../NotFoundPage';
import { GameBaseContext, GameContext, useGameBase } from './GameContext';
import styles from './GameLayout.module.css';
import { RefreshPanel } from './RefreshPanel';

/** `/spill/:gameId/*`: henter spillet og deler spillet med alle underrutene. */
export function GameLayout() {
  const { gameId: raw } = useParams();
  const gameId = parseGameId(raw);
  if (gameId == null) return <NotFoundPage />;
  return <GameLoader key={gameId} gameId={gameId} />;
}

function GameLoader({ gameId }: { gameId: number }) {
  const detail = useGame(gameId);

  if (detail.isPending) return <Loading label="Henter spillet …" />;
  // En feil ved ny henting i bakgrunnen skal ikke ta bort et spill som allerede vises.
  if (detail.isError && !detail.data) {
    if (isApiRequestError(detail.error) && detail.error.status === 404) {
      return (
        <div className="state state--center">
          <h1>Fant ikke spillet</h1>
          <p className="dim">Det kan være slettet, eller lenken er feil.</p>
          <Link to="/" className="btn">
            Til Mine spill
          </Link>
        </div>
      );
    }
    return (
      <ErrorState
        title="Fikk ikke hentet spillet"
        message={errorMessage(detail.error)}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    );
  }

  if (!detail.data) return <Loading label="Henter spillet …" />;
  return (
    <GameBaseContext.Provider value={detail.data.game}>
      <Outlet />
    </GameBaseContext.Provider>
  );
}

/** Rutene som trenger karakteren (Ark, Følgesvenner, Kamp). Uten karakter vises «Ingen karakter». */
export function CharacterLayout() {
  const base = useGameBase();
  const detail = useGame(base.id);
  if (!detail.data) return <Loading label="Henter spillet …" />;
  const { game, sheet, state } = detail.data;
  if (!sheet) {
    return (
      <div className="page page--narrow">
        <header className="page__head">
          <div className="sc">{game.name}</div>
          <h1>Ingen karakter</h1>
        </header>
        <p>Spillet har ingen karakter ennå. Lim inn JSON fra D&amp;D Beyond for å koble til en.</p>
        <RefreshPanel game={game} />
      </div>
    );
  }
  return <GameSession game={game} sheet={sheet} initial={state} />;
}

function GameSession({ game, sheet, initial }: { game: Game; sheet: Sheet; initial: GameStateEnvelope }) {
  const sync = useGameState(game.id, initial);
  return (
    <GameContext.Provider value={{ game, sheet, sync }}>
      <SyncIndicator status={sync.status} error={sync.error} />
      {sync.notice && (
        <div className={`alert ${styles.notice}`} role="alert">
          <span>{sync.notice}</span>
          <button type="button" className="link-btn" onClick={sync.clearNotice}>
            OK
          </button>
        </div>
      )}
      <Outlet />
    </GameContext.Provider>
  );
}

function SyncIndicator({ status, error }: { status: string; error: string | null }) {
  const text =
    status === 'error'
      ? 'Ikke lagret'
      : status === 'offline'
        ? 'Lagres når nettet er tilbake'
        : status === 'saving'
          ? 'Lagrer …'
          : 'Lagret';
  // Bare problemer kunngjøres. «Lagrer …» og «Lagret» ved hver endring blir for pratsomt.
  const announce = status === 'error' || status === 'offline';
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

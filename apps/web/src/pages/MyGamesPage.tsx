import type { Game, GameCover } from '@dnd/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../api/auth';
import { useDeleteGame, useGames, useUpdateGame } from '../api/games';
import { CoverPicker } from '../components/CoverPicker';
import { coverStyle } from '../components/covers';
import { Dialog } from '../components/Dialog';
import { errorMessage } from '../components/errorMessage';
import { ErrorState, Loading } from '../components/States';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { useMediaQuery, WIDE_QUERY } from '../components/useMediaQuery';
import styles from './MyGamesPage.module.css';
import { NewGameForm } from './NewGameForm';

export function MyGamesPage() {
  useDocumentTitle('Mine spill');
  const me = useMe();
  const firstName = me.data?.name.split(' ')[0];
  const games = useGames();
  const wide = useMediaQuery(WIDE_QUERY);
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const active = games.data?.filter((g) => g.status === 'active') ?? [];
  const archived = games.data?.filter((g) => g.status === 'archived') ?? [];

  const newGame = (
    <Link
      to="/spill/nytt"
      className="btn"
      onClick={(e) => {
        // På nettbrett og laptop åpnes skjemaet i en dialog i stedet for en egen side.
        if (wide) {
          e.preventDefault();
          setDialogOpen(true);
        }
      }}
    >
      + Nytt spill
    </Link>
  );

  return (
    <div className="page">
      <header className={`page__head ${styles.head}`}>
        <div>
          <div className="sc">{firstName ? `Velkommen tilbake, ${firstName}` : 'Velkommen'}</div>
          <h1>Mine spill</h1>
        </div>
        {games.data && games.data.length > 0 && newGame}
      </header>

      {games.isPending && <Loading label="Henter spillene …" />}
      {games.isError && (
        <ErrorState
          title="Fikk ikke hentet spillene"
          message={errorMessage(games.error)}
          onRetry={() => void games.refetch()}
          retrying={games.isFetching}
        />
      )}

      {games.data && games.data.length === 0 && (
        <section className={`card card--dashed ${styles.empty}`} aria-labelledby="empty-title">
          <div className={styles.ornament} aria-hidden="true">
            ✦
          </div>
          <h2 id="empty-title" className="sc">
            Ingen spill ennå
          </h2>
          <p className="dim">
            Legg inn et spill med en lenke til karakteren på D&amp;D Beyond. Hvert spill får sin egen
            kampguide og kampanjebok.
          </p>
          {newGame}
        </section>
      )}

      {active.length > 0 && (
        <ul className={styles.grid} aria-label="Aktive spill">
          {active.map((g) => (
            <li key={g.id}>
              <GameCard game={g} />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className={styles.archived}>
          <summary className={styles.archivedSummary}>
            <span className="sc">Arkiverte spill</span>{' '}
            <span className="dim tabular">({archived.length})</span>
          </summary>
          <ul className={styles.grid} aria-label="Arkiverte spill">
            {archived.map((g) => (
              <li key={g.id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nytt spill">
        <NewGameForm
          onCreated={(d) => {
            setDialogOpen(false);
            navigate(`/spill/${d.game.id}/ark`);
          }}
          onCancel={() => setDialogOpen(false)}
        />
      </Dialog>
    </div>
  );
}

function GameCard({ game }: { game: Game }) {
  const update = useUpdateGame(game.id);
  const remove = useDeleteGame(game.id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = game.status === 'archived';
  const titleId = useId();

  return (
    <article className={`card ${styles.card} ${archived ? styles.isArchived : ''}`} aria-labelledby={titleId}>
      <div className={styles.cover} style={coverStyle(game.cover)} aria-hidden="true" />
      <div className="sc">
        {archived
          ? 'Arkivert'
          : game.combatRound != null
            ? `Kamp pågår · runde ${game.combatRound}`
            : 'Pågår'}
      </div>
      <h2 id={titleId} className={styles.title}>
        {game.name}
      </h2>
      <p className="dim">
        {game.character ? `${game.character.name} · ${game.character.summary}` : 'Ingen karakter koblet til'}
      </p>
      {game.character?.outdated && <p className="field__help">Arket regnes ut på nytt ved neste henting.</p>}
      {update.error && (
        <p className="field__error" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
      <div className={`btn-row ${styles.actions}`}>
        {game.combatRound != null ? (
          // Kampen er lagret på serveren. Knappen tar deg rett tilbake til den.
          <>
            <Link
              to={`/spill/${game.id}/kamp`}
              className="btn btn--small"
              aria-label={`Til kampen i ${game.name}`}
            >
              Til kampen
            </Link>
            <Link
              to={`/spill/${game.id}/ark`}
              className="btn btn--ghost btn--small"
              aria-label={`Ark i ${game.name}`}
            >
              Ark
            </Link>
          </>
        ) : (
          <>
            <Link to={`/spill/${game.id}/ark`} className="btn btn--small" aria-label={`Åpne ${game.name}`}>
              Åpne
            </Link>
            {!archived && (
              <Link
                to={`/spill/${game.id}/kamp`}
                className="btn btn--ghost btn--small"
                aria-label={`Kamp i ${game.name}`}
              >
                Kamp
              </Link>
            )}
          </>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setEditing(true)}
          aria-label={`Endre ${game.name}`}
        >
          Endre
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          disabled={update.isPending}
          onClick={() => update.mutate({ status: archived ? 'active' : 'archived' })}
          aria-label={`${archived ? 'Gjenopprett' : 'Arkiver'} ${game.name}`}
        >
          {archived ? 'Gjenopprett' : 'Arkiver'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setConfirmDelete(true)}
          aria-label={`Slett ${game.name}`}
        >
          Slett
        </button>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Endre spillet">
        <EditGameForm game={game} onDone={() => setEditing(false)} />
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette spillet?">
        <p>
          «{game.name}» slettes for godt, med karakteren og alt som er lagret i spillet. Vil du heller ta vare
          på det, kan du arkivere det.
        </p>
        {remove.error && (
          <p className="alert" role="alert">
            {errorMessage(remove.error)}
          </p>
        )}
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setConfirmDelete(false) })}
          >
            {remove.isPending ? 'Sletter …' : 'Slett spillet'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </button>
        </div>
      </Dialog>
    </article>
  );
}

function EditGameForm({ game, onDone }: { game: Game; onDone: () => void }) {
  const update = useUpdateGame(game.id);
  const [name, setName] = useState(game.name);
  const [cover, setCover] = useState<GameCover>(game.cover);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameId = useId();
  const errId = useId();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      setNameError(trimmed ? 'Navnet kan ha høyst 100 tegn.' : 'Gi spillet et navn.');
      return;
    }
    setNameError(null);
    update.mutate({ name: trimmed, cover }, { onSuccess: onDone });
  };

  return (
    <form className={styles.editForm} onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={nameId}>
          Navn
        </label>
        <input
          id={nameId}
          className="input"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? errId : undefined}
        />
        {nameError && (
          <p id={errId} className="field__error">
            {nameError}
          </p>
        )}
      </div>
      <CoverPicker value={cover} onChange={setCover} />
      {update.error && (
        <p className="alert" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={update.isPending}>
          {update.isPending ? 'Lagrer …' : 'Lagre'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Avbryt
        </button>
      </div>
    </form>
  );
}

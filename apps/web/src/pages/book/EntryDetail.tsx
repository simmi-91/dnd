import type { Entry, EntryListItem, MentionSource } from '@dnd/shared';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  bookPath,
  entryConflictOf,
  entryPath,
  journalPath,
  KIND_TAB,
  useDeleteEntry,
  useUpdateEntry,
} from '../../api/campaign';
import { Dialog } from '../../components/Dialog';
import { errorMessage } from '../../components/errorMessage';
import { MentionText } from '../../components/MentionText';
import { buildUpdate } from './entryValues';
import { ATTITUDE_LABEL, formatPlayedOn, KIND_LABEL, PLACE_TYPE_LABEL, type EntryLookup } from './labels';
import { KindTag } from './Tags';
import styles from './Book.module.css';

interface EntryDetailProps {
  gameId: number;
  entry: Entry;
  mentionedIn: MentionSource[];
  lookup: EntryLookup;
  /** Lenke tilbake til lista (mobil og nettbrett, der detaljkortet er egen visning). */
  backTo?: string;
}

function FieldCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`card ${styles.fieldCard}`}>
      <div className="sc">{label}</div>
      <div>{children}</div>
    </div>
  );
}

/** Lenker til oppføringene en ID-liste peker på. ID-er som er slettet, er utelatt. */
function Links({
  gameId,
  ids,
  lookup,
}: {
  gameId: number;
  ids: (number | undefined)[];
  lookup: EntryLookup;
}) {
  const items: EntryListItem[] = ids.flatMap((id) => {
    const item = id == null ? undefined : lookup.get(id);
    return item ? [item] : [];
  });
  if (items.length === 0) return <span className="dim">–</span>;
  return (
    <>
      {items.map((item, i) => (
        <span key={item.id}>
          {i > 0 && ' → '}
          <Link to={entryPath(gameId, item.id, item.kind)}>{item.name}</Link>
        </span>
      ))}
    </>
  );
}

function Fields({ gameId, entry, lookup }: { gameId: number; entry: Entry; lookup: EntryLookup }) {
  switch (entry.kind) {
    case 'quest': {
      const f = entry.fields;
      return (
        <div className={styles.fieldGrid}>
          <FieldCard label="Gitt av">
            <Links gameId={gameId} ids={[f.giverEntryId]} lookup={lookup} />
          </FieldCard>
          <FieldCard label="Sted">
            <Links gameId={gameId} ids={f.placeEntryIds ?? []} lookup={lookup} />
          </FieldCard>
          <FieldCard label="Belønning">{f.reward || <span className="dim">–</span>}</FieldCard>
        </div>
      );
    }
    case 'person': {
      const f = entry.fields;
      return (
        <div className={styles.fieldGrid}>
          <FieldCard label="Rolle">{f.role || <span className="dim">–</span>}</FieldCard>
          <FieldCard label="Holdning">
            {f.attitude ? ATTITUDE_LABEL[f.attitude] : <span className="dim">–</span>}
          </FieldCard>
          <FieldCard label="Sted">
            <Links gameId={gameId} ids={[f.placeEntryId]} lookup={lookup} />
          </FieldCard>
        </div>
      );
    }
    case 'place': {
      const f = entry.fields;
      return (
        <div className={styles.fieldGrid}>
          <FieldCard label="Type">
            {f.type ? PLACE_TYPE_LABEL[f.type] : <span className="dim">–</span>}
          </FieldCard>
          <FieldCard label="Ligger i">
            <Links gameId={gameId} ids={[f.parentEntryId]} lookup={lookup} />
          </FieldCard>
        </div>
      );
    }
    default:
      return null;
  }
}

function MentionedIn({ gameId, sources }: { gameId: number; sources: MentionSource[] }) {
  return (
    <section className="card" aria-labelledby="nevnt-i">
      <h3 id="nevnt-i" className="sc">
        Nevnt i
      </h3>
      <hr className="rule" />
      {sources.length === 0 ? (
        <p className="dim">Ikke nevnt noe sted ennå.</p>
      ) : (
        <ul className={styles.mentioned}>
          {sources.map((s) =>
            s.sourceType === 'session' ? (
              <li key={`s${s.sourceId}`}>
                <Link to={journalPath(gameId, s.sourceId)}>Økt {s.number}</Link>{' '}
                <span className="dim">
                  · {formatPlayedOn(s.playedOn)}
                  {s.title ? ` · ${s.title}` : ''}
                </span>
              </li>
            ) : (
              <li key={`e${s.sourceId}`}>
                <Link to={entryPath(gameId, s.sourceId, s.kind)}>{s.name}</Link>{' '}
                <span className="dim">· {KIND_LABEL[s.kind]}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

/** Detaljkortet: navn, type og status, felter, oppsummering, notater og «Nevnt i». */
export function EntryDetail({ gameId, entry, mentionedIn, lookup, backTo }: EntryDetailProps) {
  const navigate = useNavigate();
  const update = useUpdateEntry();
  const remove = useDeleteEntry();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listPath = `${bookPath(gameId)}?fane=${KIND_TAB[entry.kind]}`;

  async function toggleArchived() {
    setError(null);
    try {
      await update.mutateAsync({ id: entry.id, body: buildUpdate(entry, { archived: !entry.archived }) });
    } catch (err) {
      const conflict = entryConflictOf(err);
      setError(
        conflict?.error === 'version_conflict'
          ? 'Oppføringen ble endret på en annen enhet. Den er lastet inn på nytt, så prøv igjen.'
          : errorMessage(err),
      );
    }
  }

  async function doDelete() {
    setError(null);
    try {
      await remove.mutateAsync(entry.id);
      setConfirming(false);
      void navigate(listPath, { replace: true });
    } catch (err) {
      setConfirming(false);
      setError(errorMessage(err));
    }
  }

  return (
    <article className={styles.detail} aria-labelledby="entry-name">
      {backTo && (
        <Link to={backTo} className={styles.back}>
          <span aria-hidden="true">←</span> Tilbake til lista
        </Link>
      )}
      <header className={styles.detailHead}>
        <KindTag kind={entry.kind} status={entry.status} />
        <h2 id="entry-name" className={styles.detailName} tabIndex={-1}>
          {entry.name}
        </h2>
        {entry.archived && <p className="dim">Arkivert</p>}
      </header>

      <Fields gameId={gameId} entry={entry} lookup={lookup} />

      {entry.summary && <p className={styles.summary}>{entry.summary}</p>}

      {entry.body && (
        <section className="card" aria-labelledby="notater">
          <h3 id="notater" className="sc">
            Notater
          </h3>
          <hr className="rule" />
          <MentionText text={entry.body} gameId={gameId} />
        </section>
      )}

      <MentionedIn gameId={gameId} sources={mentionedIn} />

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <Link className="btn" to={`${entryPath(gameId, entry.id, entry.kind)}&rediger=1`}>
          Endre
        </Link>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void toggleArchived()}
          disabled={update.isPending}
        >
          {entry.archived ? 'Gjenopprett' : 'Arkiver'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setConfirming(true)}>
          Slett
        </button>
      </div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Slette oppføringen?">
        <p>
          «{entry.name}» slettes for godt. Koblinger til den i økter og notater blir vanlig tekst. Du kan
          arkivere i stedet, så den kan hentes tilbake.
        </p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void doDelete()} disabled={remove.isPending}>
            {remove.isPending ? 'Sletter …' : 'Slett'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
            Avbryt
          </button>
        </div>
      </Dialog>
    </article>
  );
}

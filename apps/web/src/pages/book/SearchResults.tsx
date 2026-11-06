import { Link } from 'react-router';
import { entryPath, journalPath, useSearch } from '../../api/campaign';
import { errorMessage } from '../../components/errorMessage';
import { ErrorState, Loading } from '../../components/States';
import { formatPlayedOn, KIND_LABEL } from './labels';
import styles from './Book.module.css';

interface SearchResultsProps {
  gameId: number;
  /** Søketeksten etter debounce, trimmet. */
  q: string;
}

/** Treff i økter (går til dagboka) og oppføringer (går til detaljkortet), med utdrag. */
export function SearchResults({ gameId, q }: SearchResultsProps) {
  const search = useSearch(gameId, q);
  if (search.isPending) return <Loading label="Søker …" />;
  if (search.isError) {
    return (
      <ErrorState
        title="Søket feilet"
        message={errorMessage(search.error)}
        onRetry={() => void search.refetch()}
        retrying={search.isFetching}
      />
    );
  }
  const { sessions, entries } = search.data;
  if (sessions.length === 0 && entries.length === 0) {
    return (
      <p className="card dim" role="status">
        Ingen treff på «{q}».
      </p>
    );
  }
  return (
    <div className={styles.results} role="region" aria-label="Søketreff">
      {entries.length > 0 && (
        <ul className={`card ${styles.rows}`} aria-label="Treff i oppføringer">
          {entries.map((e) => (
            <li key={`e${e.id}`}>
              <Link
                to={entryPath(gameId, e.id, e.kind)}
                className={`${styles.row} ${e.archived ? styles.faded : ''}`}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{e.name}</span>
                  <span className={`dim ${styles.rowMeta}`}>
                    {KIND_LABEL[e.kind]}
                    {e.archived ? ' · arkivert' : ''}
                  </span>
                  {e.excerpt && <span className={`dim ${styles.rowSummary}`}>{e.excerpt}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sessions.length > 0 && (
        <ul className={`card ${styles.rows}`} aria-label="Treff i økter">
          {sessions.map((s) => (
            <li key={`s${s.id}`}>
              <Link to={journalPath(gameId, s.id)} className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    Økt {s.number}
                    {s.title ? ` · ${s.title}` : ''}
                  </span>
                  <span className={`dim ${styles.rowMeta}`}>{formatPlayedOn(s.playedOn)}</span>
                  {s.excerpt && <span className={`dim ${styles.rowSummary}`}>{s.excerpt}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

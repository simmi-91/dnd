import { Link } from 'react-router';
import { journalPath, useSessions } from '../../api/campaign';
import { errorMessage } from '../../components/errorMessage';
import { ErrorState, Loading } from '../../components/States';
import { formatPlayedOn } from './labels';
import styles from './Book.module.css';

/** Fanen «Økter»: nummer, dato og tittel. Hver rad går til dagboka. */
export function SessionList({ gameId }: { gameId: number }) {
  const sessions = useSessions(gameId);
  if (sessions.isPending) return <Loading label="Henter øktene …" />;
  if (sessions.isError) {
    return (
      <ErrorState
        title="Fikk ikke hentet øktene"
        message={errorMessage(sessions.error)}
        onRetry={() => void sessions.refetch()}
        retrying={sessions.isFetching}
      />
    );
  }
  if (sessions.data.length === 0) {
    return <p className="card dim">Ingen økter ennå. Dagboka lages når du skriver den første.</p>;
  }
  return (
    <ul className={`card ${styles.rows}`} aria-label="Økter">
      {sessions.data.map((s) => (
        <li key={s.id}>
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
  );
}

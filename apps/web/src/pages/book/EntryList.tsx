import type { EntryListItem } from '@dnd/shared';
import { Link } from 'react-router';
import { entryPath } from '../../api/campaign';
import { fieldsLine, type EntryLookup } from './labels';
import { StatusTag } from './Tags';
import styles from './Book.module.css';

interface EntryListProps {
  gameId: number;
  label: string;
  items: EntryListItem[];
  lookup: EntryLookup;
  selectedId: number | null;
}

/** Lista over oppføringer i fanen: navn, felter, utdrag og statusmerke. */
export function EntryList({ gameId, label, items, lookup, selectedId }: EntryListProps) {
  return (
    <ul className={`card ${styles.rows}`} aria-label={label}>
      {items.map((item) => {
        const line = fieldsLine(item, lookup);
        const selected = item.id === selectedId;
        return (
          <li key={item.id}>
            <Link
              to={entryPath(gameId, item.id, item.kind)}
              className={`${styles.row} ${selected ? styles.selected : ''} ${item.archived || item.status === 'done' ? styles.faded : ''}`}
              aria-current={selected ? 'page' : undefined}
            >
              <span className={styles.rowMain}>
                <span className={`${styles.rowName} ${item.status === 'done' ? styles.struck : ''}`}>
                  {item.name}
                </span>
                {line && <span className={`dim ${styles.rowMeta}`}>{line}</span>}
                {item.summary && <span className={`dim ${styles.rowSummary}`}>{item.summary}</span>}
              </span>
              {item.archived && <span className={`dim ${styles.archivedMark}`}>arkivert</span>}
              {item.status && <StatusTag status={item.status} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

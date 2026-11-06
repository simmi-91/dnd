import type { EntryKind, QuestStatus } from '@dnd/shared';
import { KIND_LABEL, STATUS_LABEL } from './labels';
import styles from './Book.module.css';

/** Statusmerket til en quest: AKTIV, ÅPEN, FERDIG eller FEILET. */
export function StatusTag({ status }: { status: QuestStatus }) {
  return <span className={`${styles.tag} ${styles[`status_${status}`]}`}>{STATUS_LABEL[status]}</span>;
}

/** Typemerket i detaljkortet, f.eks. «Quest · Aktiv». */
export function KindTag({ kind, status }: { kind: EntryKind; status: QuestStatus | null }) {
  return (
    <span className={`${styles.tag} ${styles[`kind_${kind}`]}`}>
      {KIND_LABEL[kind]}
      {status ? ` · ${STATUS_LABEL[status]}` : ''}
    </span>
  );
}

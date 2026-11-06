import { KIND_TRIGGER, parseMentionList, type EntryListItem, type MentionKind } from '@dnd/shared';
import { useDeferredValue, useMemo } from 'react';
import { Link } from 'react-router';
import { entryPath, useEntries } from '../../api/campaign';
import { ATTITUDE_LABEL, STATUS_LABEL } from './labels';
import styles from './Journal.module.css';

const GROUPS: { kind: MentionKind; label: string }[] = [
  { kind: 'quest', label: 'Quester' },
  { kind: 'person', label: 'Personer' },
  { kind: 'place', label: 'Steder' },
];

interface Group {
  entries: EntryListItem[];
  /** Koblinger som opprettes ved neste lagring. */
  pending: string[];
}

function detail(e: EntryListItem): string | undefined {
  if (e.kind === 'quest') return STATUS_LABEL[e.status].toLowerCase();
  if (e.kind === 'person') return e.fields.role ?? (e.fields.attitude && ATTITUDE_LABEL[e.fields.attitude]);
  return undefined;
}

/**
 * Registeret: personer, steder og quester som er nevnt i økta, gruppert, som lenker til
 * oppslagsverket. Bygges fra teksten, så det følger med mens man skriver.
 */
export function JournalRegister({ gameId, body }: { gameId: number; body: string }) {
  const entries = useEntries(gameId);
  const text = useDeferredValue(body);
  const groups = useMemo(() => {
    const byId = new Map((entries.data?.entries ?? []).map((e) => [e.id, e]));
    const result: Record<MentionKind, Group> = {
      quest: { entries: [], pending: [] },
      person: { entries: [], pending: [] },
      place: { entries: [], pending: [] },
    };
    const seen = new Set<string>();
    for (const m of parseMentionList(text)) {
      if ('id' in m.ref) {
        const e = byId.get(m.ref.id);
        if (!e || e.kind === 'other' || seen.has(`e${e.id}`)) continue;
        seen.add(`e${e.id}`);
        result[e.kind].entries.push(e);
      } else {
        const label = m.label.trim();
        const key = `${m.kind}:${label.toLocaleLowerCase('nb')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result[m.kind].pending.push(label);
      }
    }
    return result;
  }, [entries.data, text]);

  const empty = GROUPS.every(
    (g) => groups[g.kind].entries.length === 0 && groups[g.kind].pending.length === 0,
  );
  if (empty) {
    return (
      <p className={`dim ${styles.registerEmpty}`}>
        Ingen koblinger ennå. Skriv @ for en person, # for et sted eller ! for en quest.
      </p>
    );
  }

  return (
    <div className={styles.registerGroups}>
      {GROUPS.map(({ kind, label }) => {
        const g = groups[kind];
        if (g.entries.length === 0 && g.pending.length === 0) return null;
        return (
          <section key={kind} className={`card ${styles.registerCard}`} aria-label={label}>
            <span className={`${styles.tag} ${styles[`tag_${kind}`]}`}>{label}</span>
            <ul className={styles.registerList}>
              {g.entries.map((e) => {
                const extra = detail(e);
                return (
                  <li key={e.id}>
                    <Link to={entryPath(gameId, e.id, e.kind)} className={styles[kind]}>
                      {e.name}
                    </Link>
                    {extra && <span className="dim"> · {extra}</span>}
                  </li>
                );
              })}
              {g.pending.map((name) => (
                <li key={`ny-${name}`}>
                  <span className={styles[kind]}>
                    {KIND_TRIGGER[kind]}
                    {name}
                  </span>
                  <span className="dim"> · ny, lagres snart</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

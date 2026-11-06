import { parseMentions } from '@dnd/shared';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { entryPath, useEntries } from '../api/campaign';
import styles from './MentionText.module.css';

interface MentionTextProps {
  /** Teksten slik serveren lagrer den, med koblinger som `@[Brann](e:42)`. */
  text: string;
  gameId: number;
  className?: string;
}

/**
 * Viser fritekst med koblinger som fargede lenker til detaljkortet: person grønn, sted blå, quest
 * rød. Fargen følger typen oppføringen har nå. Koblinger til oppføringer som ikke finnes (slettet,
 * `(new)` eller ikke lastet ennå) er vanlig tekst. Linjeskift beholdes.
 */
export function MentionText({ text, gameId, className }: MentionTextProps) {
  const entries = useEntries(gameId);
  const segments = useMemo(() => parseMentions(text), [text]);
  const byId = useMemo(() => new Map((entries.data?.entries ?? []).map((e) => [e.id, e])), [entries.data]);

  return (
    <span className={className ? `${styles.text} ${className}` : styles.text}>
      {segments.map((s, i) => {
        if (s.type === 'text') return s.text;
        const entry = 'id' in s.ref ? byId.get(s.ref.id) : undefined;
        if (!entry) return s.label;
        return (
          <Link
            key={i}
            to={entryPath(gameId, entry.id, entry.kind)}
            className={`${styles.mention} ${styles[entry.kind]}`}
            data-kind={entry.kind}
          >
            {s.label}
          </Link>
        );
      })}
    </span>
  );
}

import { useState } from 'react';
import { hpTone, MAX_HP_INPUT, parseIntInput } from '../../components/format';
import { IntField } from '../../components/IntField';
import styles from './Companions.module.css';

/** HP med felt for skade og helbredelse. Brukes av kjæledyr, egne følgesvenner og familiaren. */
export function HpControl({
  name,
  hp,
  max,
  onDamage,
  onHeal,
  downText,
}: {
  name: string;
  hp: number;
  max: number;
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  /** Tekst når HP er 0. Standard: «… er nede på 0 HP.» */
  downText?: string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (n: number) => void) => {
    const r = parseIntInput(value, 1, MAX_HP_INPUT);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setValue('');
    fn(r.value);
  };
  return (
    <div className={styles.hp}>
      <div className={styles.hpRow}>
        <span className="sc">HP</span>
        <span className={`${styles.hpNum} tabular`} data-tone={hpTone(hp, max)}>
          {hp}
        </span>
        <span className="dim tabular">/ {max}</span>
      </div>
      {hp === 0 && <p className={styles.down}>{downText ?? `${name} er nede på 0 HP.`}</p>}
      <div className={styles.hpControls}>
        <IntField
          label={`HP for ${name}`}
          hideLabel
          value={value}
          onChange={setValue}
          error={error}
          placeholder="Antall"
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => run(onDamage)}
            aria-label={`Skade på ${name}`}
          >
            Skade
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => run(onHeal)}
            aria-label={`Helbred ${name}`}
          >
            Helbred
          </button>
        </div>
      </div>
    </div>
  );
}

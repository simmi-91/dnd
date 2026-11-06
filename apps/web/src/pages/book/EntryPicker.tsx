import type { EntryKind } from '@dnd/shared';
import { useId, useState } from 'react';
import { useSuggest } from '../../api/campaign';
import { useDebounced } from './useDebounced';
import styles from './Book.module.css';

export interface Picked {
  id: number;
  name: string;
}

interface EntryPickerProps {
  gameId: number;
  kind: EntryKind;
  label: string;
  value: Picked[];
  onChange: (value: Picked[]) => void;
  /** Flere valg (steder i en quest). Ellers ett, som kan tømmes. */
  multiple?: boolean;
  /** En oppføring som ikke kan velges, f.eks. stedet selv som «Ligger i». */
  excludeId?: number;
}

/** Søk og velg en oppføring (eller flere) av en type. Valgene vises som merker som kan fjernes. */
export function EntryPicker({ gameId, kind, label, value, onChange, multiple, excludeId }: EntryPickerProps) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const q = useDebounced(text.trim(), 200);
  const showInput = multiple || value.length === 0;
  const suggest = useSuggest(gameId, kind, q, open && showInput);
  const options = (suggest.data ?? []).filter((s) => s.id !== excludeId && !value.some((v) => v.id === s.id));

  function pick(p: Picked) {
    onChange(multiple ? [...value, p] : [p]);
    setText('');
    setOpen(false);
  }

  return (
    <div
      className={`field ${styles.picker}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      {value.length > 0 && (
        <ul className={styles.chips} aria-label={`Valgt: ${label}`}>
          {value.map((v) => (
            <li key={v.id} className={styles.chip}>
              <span>{v.name}</span>
              <button
                type="button"
                className={styles.chipX}
                aria-label={`Fjern ${v.name} fra ${label}`}
                onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showInput && (
        <>
          <input
            id={inputId}
            className="input"
            type="search"
            autoComplete="off"
            value={text}
            placeholder="Søk og velg …"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && (
            <ul
              className={styles.options}
              aria-label={`Forslag: ${label}`}
              // Hindrer at feltet mister fokus før valget er registrert.
              onMouseDown={(e) => e.preventDefault()}
            >
              {suggest.isPending && <li className={`dim ${styles.optionNote}`}>Søker …</li>}
              {suggest.isError && <li className={`dim ${styles.optionNote}`}>Fikk ikke hentet forslag.</li>}
              {suggest.isSuccess && options.length === 0 && (
                <li className={`dim ${styles.optionNote}`}>Ingen treff.</li>
              )}
              {options.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={styles.option}
                    onClick={() => pick({ id: s.id, name: s.name })}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

import { useId } from 'react';

interface IntFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** Skjul etiketten (den leses fortsatt av skjermlesere). */
  hideLabel?: boolean;
  /** Tillat minus. Mobiltastaturet med bare tall har ikke minus, så da brukes vanlig tastatur. */
  allowNegative?: boolean;
  placeholder?: string;
  help?: string;
}

/** Tekstfelt for heltall. Sjekken gjøres av den som bruker feltet, med `parseIntInput`. */
export function IntField({
  label,
  value,
  onChange,
  error,
  hideLabel = false,
  allowNegative = false,
  placeholder,
  help,
}: IntFieldProps) {
  const id = useId();
  const errId = `${id}-err`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label className={hideLabel ? 'visually-hidden' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input input--num"
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {help && (
        <p id={helpId} className="field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={errId} className="field__error">
          {error}
        </p>
      )}
    </div>
  );
}

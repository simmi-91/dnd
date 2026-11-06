import { validateRoll, type CanDo, type DamageGroup } from '@dnd/rules';
import { useState, type FormEvent, type ReactNode } from 'react';
import { sign } from '../../../components/format';
import { IntField } from '../../../components/IntField';
import styles from './Combat.module.css';
import { useShowInfo } from './info';
import type { StepTone } from './steps';

// Små byggeklosser på kampskjermen: valg med grunn når det er grått, steg, tips og innskriving av
// fysiske terninger.

/**
 * Et valg. Grå valg viser grunnen under, og i `title` (musepeker på PC). Med `info` får kortet en rund
 * «?»-knapp i hjørnet som åpner infopanelet. Den er en egen knapp ved siden av valget (ikke inni), så et
 * trykk på «?» aldri bruker valget.
 */
export function Opt({
  title,
  sub,
  check,
  rec,
  onClick,
  info,
  infoTitle,
}: {
  title: ReactNode;
  sub?: ReactNode;
  check: CanDo;
  rec?: boolean;
  onClick: () => void;
  /** Lengre forklaring, f.eks. hva en spell gjør. Avsnitt skilles med `\n`. */
  info?: string;
  /** Tittel i infopanelet. Standard: `title` når den er tekst. */
  infoTitle?: string;
}) {
  const showInfo = useShowInfo();
  const disabled = !check.ok;
  const hasInfo = !!info && !!showInfo;
  const name = infoTitle ?? (typeof title === 'string' ? title : 'Info');
  return (
    <div className={styles.optWrap}>
      <button
        type="button"
        className={`${styles.opt} ${rec && !disabled ? styles.optRec : ''} ${hasInfo ? styles.optWithInfo : ''}`}
        disabled={disabled}
        onClick={onClick}
        title={check.reason ?? undefined}
      >
        <span className={styles.optTitle}>
          {title}
          {rec && !disabled && <span className={styles.recChip}>Anbefalt</span>}
        </span>
        {sub && <span className={styles.optSub}>{sub}</span>}
        {disabled && check.reason && <span className={styles.optWhy}>{check.reason}</span>}
      </button>
      {hasInfo && (
        <button
          type="button"
          className={styles.infoBtn}
          aria-label={`Hva gjør ${name}?`}
          title={`Hva gjør ${name}?`}
          onClick={(e) => {
            e.stopPropagation();
            showInfo({ title: name, text: info });
          }}
        >
          ?
        </button>
      )}
    </div>
  );
}

/**
 * Et steg i turen: 1 Bevegelse, 2 Bonus action, 3 Action, R Reaction. Når ingenting kan velges
 * (`open` false), er steget lukket med `closedText`, men kan åpnes. Chipsene i turlinja finner steget
 * med `data-step` og åpner det.
 */
export function Step({
  n,
  title,
  hint,
  tone,
  open = true,
  closedText,
  children,
}: {
  n: string;
  title: string;
  hint?: ReactNode;
  tone: StepTone;
  open?: boolean;
  closedText?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.step} data-tone={tone} data-step={tone} aria-label={title}>
      {/* Ny `key` når steget blir mulig eller umulig, så det åpnes og lukkes av seg selv. */}
      <details key={String(open)} open={open} className={styles.stepDetails}>
        <summary className={styles.stepHead}>
          <span className={styles.stepN} aria-hidden="true">
            {n}
          </span>
          <h3 className={styles.stepTitle}>{title}</h3>
          {!open && closedText ? (
            <span className={styles.hint}>{closedText}</span>
          ) : (
            hint && <span className={styles.hint}>{hint}</span>
          )}
        </summary>
        <div className={styles.stepBody}>{children}</div>
      </details>
    </section>
  );
}

export function Tip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'warn' | 'good' | 'gold' | 'psychic';
}) {
  return (
    <div className={styles.tip} data-tone={tone}>
      {children}
    </div>
  );
}

const rollDie = (sides: number) => Math.floor(Math.random() * sides) + 1;

/**
 * d20 fra en fysisk terning: du skriver inn det terningen viste, og appen legger til bonusen.
 * `onResult` får det naturlige kastet.
 */
export function D20Entry({
  label,
  bonus,
  hint,
  dc,
  onResult,
}: {
  label: string;
  bonus: number;
  hint?: string;
  dc?: number;
  onResult: (nat: number) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.trim());
  const ok = value.trim() !== '' && validateRoll(n, 1, 20) == null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateRoll(n, 1, 20);
    if (value.trim() === '' || err) {
      setError(err ?? 'En d20 må være 1–20.');
      return;
    }
    setError(null);
    setValue('');
    onResult(n);
  };
  return (
    <form className={styles.entry} onSubmit={submit}>
      {(hint || dc != null) && (
        <p className="dim">
          {hint}
          {dc != null && ` Du trenger ${dc} eller mer totalt.`}
        </p>
      )}
      <div className={styles.entryRow}>
        <IntField label={label} value={value} onChange={setValue} error={error} placeholder="d20" />
        <span className={styles.op}>{sign(bonus)} =</span>
        <span className={`${styles.total} tabular`} data-dim={!ok}>
          {ok ? n + bonus : '?'}
        </span>
        <button type="submit" className="btn btn--small">
          OK
        </button>
      </div>
      <button type="button" className="link-btn dim" onClick={() => onResult(rollDie(20))}>
        eller rull i appen
      </button>
    </form>
  );
}

/** Skade: én linje per terninggruppe, der du skriver inn summen du rullet. */
export function DiceEntry({
  groups,
  onDone,
}: {
  groups: readonly DamageGroup[];
  onDone: (rolled: Record<string, number>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const read = (g: DamageGroup): number | null => {
    const raw = (values[g.key] ?? '').trim();
    if (raw === '') return null;
    const n = Number(raw);
    return validateRoll(n, g.count, g.sides) == null ? n : null;
  };
  const all = groups.every((g) => read(g) != null);
  const total = all ? groups.reduce((s, g) => s + Math.max(0, (read(g) ?? 0) + g.mod), 0) : null;
  const auto = () => {
    const out: Record<string, string> = {};
    for (const g of groups) {
      let sum = 0;
      for (let i = 0; i < g.count; i++) sum += rollDie(g.sides);
      out[g.key] = String(sum);
    }
    setValues(out);
  };
  return (
    <div className={styles.stack}>
      <p className="dim">Rull terningene og skriv inn summen på hver linje.</p>
      {groups.map((g) => {
        const raw = values[g.key] ?? '';
        const bad = raw.trim() !== '' && read(g) == null;
        return (
          <div key={g.key} className={styles.diceLine} data-tone={g.tone}>
            <IntField
              label={`${g.label}: ${g.count}d${g.sides}${g.mod ? ` (${sign(g.mod)} legges til)` : ''}`}
              value={raw}
              onChange={(v) => setValues((s) => ({ ...s, [g.key]: v }))}
              error={bad ? `${g.count}d${g.sides} gir mellom ${g.count} og ${g.count * g.sides}.` : null}
              placeholder={`${g.count}–${g.count * g.sides}`}
            />
          </div>
        );
      })}
      <div className={styles.sumRow}>
        <span>Total skade</span>
        <span className={`${styles.total} tabular`} data-dim={total == null}>
          {total ?? '?'}
        </span>
      </div>
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={!all}
          onClick={() => onDone(Object.fromEntries(groups.map((g) => [g.key, read(g) ?? 0])))}
        >
          Regn ut skade
        </button>
        <button type="button" className="link-btn dim" onClick={auto}>
          eller rull i appen
        </button>
      </div>
    </div>
  );
}

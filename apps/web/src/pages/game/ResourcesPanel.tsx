import { hitDiceLeft, restoreResource, restoreSlot, slotMax, spendResource, spendSlot } from '@dnd/rules';
import type { ResetType, SlotKey } from '@dnd/rules';
import { useGameContext } from './GameContext';
import styles from './Sheet.module.css';

const RESET_LABEL: Record<ResetType, string> = {
  short: 'Short Rest',
  long: 'Long Rest',
  other: 'annet',
};

/** Over så mange brukes en teller i stedet for avkrysningsbokser. */
const MAX_BOXES = 10;

interface TrackerProps {
  name: string;
  max: number;
  used: number;
  onSpend: (n: number) => void;
  onRestore: (n: number) => void;
  detail?: string;
  /** Hva én boks er, i skjermleser-etiketten: «slot» eller «bruk». */
  unit: string;
}

/** Avkrysningsbokser (kryss = brukt) eller en teller for én ressurs. */
function Tracker({ name, max, used, onSpend, onRestore, detail, unit }: TrackerProps) {
  const left = Math.max(0, max - used);
  return (
    <div className={styles.tracker}>
      <div className={styles.trackerHead}>
        <span className={styles.trackerName}>{name}</span>
        <span className="dim tabular">
          {left} av {max} igjen{detail ? ` · ${detail}` : ''}
        </span>
      </div>
      {max <= MAX_BOXES ? (
        <div className={styles.boxes} role="group" aria-label={`${name}: kryss av det som er brukt`}>
          {Array.from({ length: max }, (_, i) => {
            const checked = i < used;
            return (
              <label key={i} className={styles.box}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => (checked ? onRestore(used - i) : onSpend(i + 1 - used))}
                  aria-label={`${name}, ${unit} ${i + 1}: ${checked ? 'brukt' : 'ledig'}`}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <div className={styles.counter}>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => onRestore(1)}
            disabled={used <= 0}
            aria-label={`Få tilbake én ${name}`}
          >
            −
          </button>
          <span className="tabular" aria-live="polite">
            {used} brukt
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => onSpend(1)}
            disabled={left <= 0}
            aria-label={`Bruk én ${name}`}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function ResourcesPanel() {
  const { sheet, sync } = useGameContext();
  const { state } = sync;
  const slotKeys: SlotKey[] = [];
  for (let l = 1; l <= 9; l++) if (slotMax(sheet, l) > 0) slotKeys.push(l);
  if (sheet.pactSlots && sheet.pactSlots.count > 0) slotKeys.push('pact');
  const resources = sheet.resources.filter((r) => r.max > 0);
  const dice = hitDiceLeft(state, sheet);

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="res-title">
      <h2 id="res-title" className="sc">
        Ressurser
      </h2>
      {slotKeys.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Spell slots</h3>
          {slotKeys.map((k) => (
            <Tracker
              key={k}
              name={k === 'pact' ? `Pact Magic (nivå ${sheet.pactSlots?.level ?? ''})` : `Nivå ${k}`}
              max={slotMax(sheet, k)}
              used={state.slotsUsed[String(k)] ?? 0}
              onSpend={(n) => sync.update((s) => spendSlot(s, sheet, k, n))}
              onRestore={(n) => sync.update((s) => restoreSlot(s, sheet, k, n))}
              detail={k === 'pact' ? 'Short Rest' : undefined}
              unit="slot"
            />
          ))}
        </div>
      )}
      {resources.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Evner og gratis kast</h3>
          {resources.map((r) => (
            <Tracker
              key={r.key}
              name={r.name}
              max={r.max}
              used={state.resources[r.key] ?? 0}
              onSpend={(n) => sync.update((s) => spendResource(s, sheet, r.key, n))}
              onRestore={(n) => sync.update((s) => restoreResource(s, sheet, r.key, n))}
              detail={RESET_LABEL[r.reset]}
              unit="bruk"
            />
          ))}
        </div>
      )}
      {slotKeys.length === 0 && resources.length === 0 && (
        <p className="dim">Ingen ressurser å holde rede på.</p>
      )}
      <p className="dim tabular">
        Hit Dice:{' '}
        {sheet.hitDice.map((h) => `${dice[`d${h.die}`] ?? 0} av ${h.total} d${h.die}`).join(' · ') || 'ingen'}
      </p>
    </section>
  );
}

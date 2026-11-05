import { applyDamage, applyHealing, currentHp, setTempHp, type DamageResult } from '@dnd/rules';
import { useState } from 'react';
import { hpTone, MAX_HP_INPUT, parseIntInput } from '../../components/format';
import { IntField } from '../../components/IntField';
import { useGameContext } from './GameContext';
import styles from './Sheet.module.css';

export function HpPanel() {
  const { sheet, sync } = useGameContext();
  const { state } = sync;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Meldingen gjelder en lokal endring. Byttes tilstanden ut fra serveren (409 eller ny henting),
  // passer den ikke lenger og skjules.
  const [note, setNote] = useState<{ text: string; replaced: number } | null>(null);
  const message = note && note.replaced === sync.replaced ? note.text : null;
  const setMessage = (text: string) => setNote({ text, replaced: sync.replaced });
  const hp = currentHp(state, sheet);

  const read = (): number | null => {
    const r = parseIntInput(value, 1, MAX_HP_INPUT);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setError(null);
    setValue('');
    return r.value;
  };

  const damage = () => {
    const n = read();
    if (n == null) return;
    // Regnes ut på den nyeste tilstanden inne i `update`, ikke på det som sist ble vist.
    const out: { res?: DamageResult } = {};
    sync.update((s) => {
      out.res = applyDamage(s, sheet, n);
      return out.res.state;
    });
    const res = out.res;
    if (!res) return;
    const parts = [`Tok ${n} skade`];
    if (res.absorbed > 0) parts.push(`${res.absorbed} gikk til temp HP`);
    let text = `${parts.join(', ')}. Konsentrerer du deg på en spell: CON save mot DC ${res.concentrationDc}.`;
    if (res.instantDeath) text += ' Massive Damage: skaden som er igjen, er minst maks HP. Karakteren dør.';
    setMessage(text);
  };

  const heal = () => {
    const n = read();
    if (n == null) return;
    sync.update((s) => applyHealing(s, sheet, n));
    setMessage(`Helbredet ${n} HP.`);
  };

  const temp = () => {
    const n = read();
    if (n == null) return;
    let before = 0;
    sync.update((s) => {
      before = s.tempHp;
      return setTempHp(s, n);
    });
    setMessage(
      n > before
        ? `Temp HP er ${n}.`
        : `Temp HP stables ikke. Du har allerede ${before}, så det høyeste gjelder.`,
    );
  };

  return (
    <section className={`card ${styles.panel}`} aria-labelledby="hp-title">
      <h2 id="hp-title" className="sc">
        Hit Points
      </h2>
      <div className={styles.hpRow}>
        <span className={`${styles.hpNum} tabular`} data-tone={hpTone(hp, sheet.hpMax)}>
          {hp}
        </span>
        <span className="dim tabular">/ {sheet.hpMax}</span>
        {state.tempHp > 0 && (
          <span className={`${styles.temp} tabular`}>
            +{state.tempHp} temp
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                sync.update((s) => setTempHp(s, 0, { replace: true }));
                setMessage('Temp HP er fjernet.');
              }}
            >
              fjern
            </button>
          </span>
        )}
      </div>
      {hp === 0 && (
        <p className={styles.down} role="alert">
          0 HP: du er nede. Si fra til DM og slå death saves.
        </p>
      )}
      <div className={styles.hpControls}>
        <IntField
          label="Antall HP"
          hideLabel
          value={value}
          onChange={setValue}
          error={error}
          placeholder="Antall"
        />
        <div className="btn-row">
          <button type="button" className="btn btn--small" onClick={damage}>
            Skade
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={heal}>
            Helbred
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={temp}>
            Temp HP
          </button>
        </div>
      </div>
      {message && (
        <p className="dim" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

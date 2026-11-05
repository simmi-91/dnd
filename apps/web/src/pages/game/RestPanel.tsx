import { hitDiceHealing, hitDiceLeft, longRest, shortRest } from '@dnd/rules';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { parseIntInput, sign } from '../../components/format';
import { IntField } from '../../components/IntField';
import { useGameContext } from './GameContext';
import styles from './Sheet.module.css';

export function RestPanel() {
  const [open, setOpen] = useState<'short' | 'long' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const close = () => setOpen(null);
  return (
    <section className={`card ${styles.panel}`} aria-labelledby="rest-title">
      <h2 id="rest-title" className="sc">
        Hvile
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn--ghost" onClick={() => setOpen('short')}>
          Short Rest
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen('long')}>
          Long Rest
        </button>
      </div>
      {done && (
        <p role="status" className="dim">
          {done}
        </p>
      )}
      <Dialog open={open === 'short'} onClose={close} title="Short Rest">
        <ShortRestForm
          onDone={(text) => {
            setDone(text);
            close();
          }}
          onCancel={close}
        />
      </Dialog>
      <Dialog open={open === 'long'} onClose={close} title="Long Rest">
        <LongRestConfirm
          onDone={() => {
            setDone('Long Rest er tatt.');
            close();
          }}
          onCancel={close}
        />
      </Dialog>
    </section>
  );
}

function ShortRestForm({ onDone, onCancel }: { onDone: (text: string) => void; onCancel: () => void }) {
  const { sheet, sync } = useGameContext();
  const left = hitDiceLeft(sync.state, sheet);
  const dice = sheet.hitDice.map((h) => ({ key: `d${h.die}`, die: h.die, left: left[`d${h.die}`] ?? 0 }));
  const [counts, setCounts] = useState<Record<string, string>>({});
  /** Slagene per terning, som tekst fra feltene. */
  const [rolls, setRolls] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const con = sheet.mod.con;
  const shortResources = sheet.resources.filter((r) => r.reset === 'short' && r.max > 0);

  /** Antall terninger per størrelse, eller 0 hvis feltet er tomt eller ugyldig. */
  const countOf = (d: (typeof dice)[number]): number => {
    const r = parseIntInput(counts[d.key] ?? '', 0, d.left);
    return r.ok ? r.value : 0;
  };

  /** Gyldige slag, til forhåndsvisningen. Ugyldige og tomme felt hoppes over. */
  const validRolls: Record<string, number[]> = {};
  for (const d of dice) {
    const list = (rolls[d.key] ?? [])
      .slice(0, countOf(d))
      .map((raw) => parseIntInput(raw, 1, d.die))
      .flatMap((r) => (r.ok ? [r.value] : []));
    if (list.length > 0) validRolls[d.key] = list;
  }
  const previewHeal = hitDiceHealing(sync.state, sheet, { rolls: validRolls }).heal;

  const setRoll = (key: string, i: number, v: string) =>
    setRolls((r) => {
      const list = [...(r[key] ?? [])];
      list[i] = v;
      return { ...r, [key]: list };
    });

  const onSubmit = () => {
    const errs: Record<string, string> = {};
    const input: Record<string, number[]> = {};
    for (const d of dice) {
      const raw = counts[d.key] ?? '';
      if (raw.trim() === '') continue;
      const c = parseIntInput(raw, 0, d.left);
      if (!c.ok) {
        errs[d.key] = c.error;
        continue;
      }
      const list: number[] = [];
      for (let i = 0; i < c.value; i++) {
        const r = parseIntInput(rolls[d.key]?.[i] ?? '', 1, d.die);
        if (!r.ok) errs[`${d.key}-${i}`] = `Et slag med ${d.key} er fra 1 til ${d.die}.`;
        else list.push(r.value);
      }
      if (list.length > 0) input[d.key] = list;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const heal = hitDiceHealing(sync.state, sheet, { rolls: input }).heal;
    sync.update((s) => shortRest(s, sheet, { rolls: input }));
    onDone(heal > 0 ? `Short Rest er tatt. Du fikk inntil ${heal} HP.` : 'Short Rest er tatt.');
  };

  return (
    <div className={styles.restForm}>
      <p>
        Velg hvor mange Hit Dice du bruker, slå dem med ekte terninger, og skriv inn hvert slag. CON-moden (
        {sign(con)}) legges til per terning, og hver terning gir minst 1 HP.
      </p>
      {dice.map((d) => (
        <div key={d.key} className={styles.group}>
          <IntField
            label={`Antall ${d.key} (${d.left} igjen)`}
            value={counts[d.key] ?? ''}
            onChange={(v) => setCounts((c) => ({ ...c, [d.key]: v }))}
            error={errors[d.key]}
            placeholder="0"
          />
          {countOf(d) > 0 && (
            <div className={styles.rollRow}>
              {Array.from({ length: countOf(d) }, (_, i) => (
                <IntField
                  key={i}
                  label={`${d.key}, slag ${i + 1}`}
                  value={rolls[d.key]?.[i] ?? ''}
                  onChange={(v) => setRoll(d.key, i, v)}
                  error={errors[`${d.key}-${i}`]}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="tabular" role="status">
        Du får <b>{previewHeal}</b> HP.
      </p>
      <p className="dim">
        Fylles opp: Pact-slots
        {shortResources.length > 0 ? `, ${shortResources.map((r) => r.name).join(', ')}` : ''}.
      </p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onSubmit}>
          Ta Short Rest
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

function LongRestConfirm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { sheet, sync } = useGameContext();
  return (
    <div className={styles.restForm}>
      <p>Long Rest gir:</p>
      <ul className={styles.list}>
        <li>full HP, og temp HP går til 0</li>
        <li>alle spell slots og ressurser tilbake</li>
        <li>alle brukte Hit Dice tilbake</li>
        <li>exhaustion −1 og nullstilte death saves</li>
        <li>full HP på kjæledyr og følgesvenner</li>
      </ul>
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            sync.update((s) => longRest(s, sheet));
            onDone();
          }}
        >
          Ta Long Rest
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

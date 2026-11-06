import {
  addEnemy,
  addLog,
  addParticipant,
  familiarParticipant,
  familiarStatus,
  removeParticipant,
  setInitiative,
  startCombat,
  validateRoll,
  type Participant,
} from '@dnd/rules';
import { useId, useState, type FormEvent } from 'react';
import { parseIntInput, sign } from '../../../components/format';
import { IntField } from '../../../components/IntField';
import { useGameContext } from '../GameContext';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { KIND_LABEL } from './helpers';
import { Toggle } from './AttackFlow';

/** En d20 rullet i appen, for den som ikke vil bruke fysisk terning. */
const rollD20 = () => Math.floor(Math.random() * 20) + 1;

/** Oppsett: initiativ per deltaker, fiender og NPC-er (valgfritt), mørke, og start. */
export function SetupView() {
  const { sheet, sync } = useGameContext();
  const { state, update, dispatch } = useCombatContext();
  const f = sync.state.familiar;
  const familiarMissing =
    sheet.familiar &&
    f &&
    familiarStatus(f) === 'present' &&
    !state.participants.some((p) => p.kind === 'familiar');
  const me = state.participants.find((p) => p.kind === 'character');
  const waiting = state.participants.filter((p) => p.initiative == null);
  return (
    <div className={styles.stack}>
      <div className="card">
        <h2>Klar for kamp?</h2>
        <p className="dim">
          Rull initiativ med ekte terninger og skriv inn hva terningen viste, trykk «Rull» for å la appen
          rulle, eller skriv inn totalen DM sier. Deltakere uten initiativ havner sist.
        </p>
        <div className={`btn-row ${styles.setupActions}`}>
          {waiting.length > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() =>
                update((s) => waiting.reduce((acc, p) => setInitiative(acc, p.id, { roll: rollD20() }), s))
              }
            >
              Rull for alle uten initiativ ({waiting.length})
            </button>
          )}
          {me?.limits.darknessAdvantage && (
            <Toggle on={state.darkness} onClick={() => dispatch({ type: 'darkness', on: !state.darkness })}>
              {me.name} står i mørke
            </Toggle>
          )}
        </div>
      </div>
      {state.participants.map((p) => (
        <InitiativeRow key={p.id} p={p} />
      ))}
      {familiarMissing && f && (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => update((s) => addParticipant(s, familiarParticipant(f)))}
        >
          Ta med {f.name} (familiar)
        </button>
      )}
      <AddEnemy />
    </div>
  );
}

function InitiativeRow({ p }: { p: Participant }) {
  const { update } = useCombatContext();
  const [value, setValue] = useState('');
  const [total, setTotal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseIntInput(value, total ? -10 : 1, total ? 60 : 20);
    if (!r.ok) return setError(total ? r.error : (validateRoll(Number(value), 1, 20) ?? r.error));
    setError(null);
    setValue('');
    update((s) => setInitiative(s, p.id, total ? { total: r.value } : { roll: r.value }));
  };
  return (
    <div className={`card ${styles.initRow}`}>
      <div className={styles.initHead}>
        <b>{p.name}</b>
        <span className="dim">
          {KIND_LABEL[p.kind]} · Initiativ {sign(p.initiativeBonus)}
        </span>
        {p.initiative != null && (
          <span className={styles.initValue}>
            <b className="tabular">{p.initiative}</b>
            {p.roll != null && <span className="dim tabular"> (d20 {p.roll})</span>}
          </span>
        )}
      </div>
      <span className="field__label" aria-hidden="true">
        {total ? 'Total initiativ' : 'Initiativ d20'}
      </span>
      <form className={styles.entryRow} onSubmit={submit}>
        <IntField
          label={total ? `Total initiativ for ${p.name}` : `Initiativ d20 for ${p.name}`}
          hideLabel
          value={value}
          onChange={setValue}
          error={error}
          allowNegative={total}
          placeholder={total ? 'total' : 'd20'}
        />
        <button type="submit" className="btn btn--small">
          {p.initiative != null ? 'Endre' : 'OK'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          aria-label={`Rull initiativ for ${p.name}`}
          onClick={() => {
            setError(null);
            update((s) => setInitiative(s, p.id, { roll: rollD20() }));
          }}
        >
          Rull
        </button>
        <button type="button" className="link-btn" onClick={() => setTotal(!total)}>
          {total ? 'Skriv d20 i stedet' : 'Skriv total i stedet'}
        </button>
      </form>
      {p.kind !== 'character' && (
        <button
          type="button"
          className="link-btn dim"
          onClick={() => update((s) => removeParticipant(s, p.id))}
        >
          Ta ut av kampen
        </button>
      )}
    </div>
  );
}

/** «Legg til fiende/NPC»: et valgfritt, lukket felt. Bare navnet må fylles ut. */
export function AddEnemy() {
  const { update } = useCombatContext();
  const id = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'enemy' | 'npc'>('enemy');
  const [init, setInit] = useState('');
  const [hp, setHp] = useState('');
  const [ac, setAc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const opt = (raw: string, min: number, max: number) => {
    if (raw.trim() === '') return { ok: true as const, value: null };
    return parseIntInput(raw, min, max);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const i = opt(init, -10, 60);
    const h = opt(hp, 1, 9999);
    const a = opt(ac, 0, 50);
    const bad = [i, h, a].find((x) => !x.ok);
    if (bad && !bad.ok) return setError(bad.error);
    if (!name.trim()) return setError('Skriv et navn.');
    setError(null);
    update((s) => {
      const r = addEnemy(s, {
        name,
        kind,
        initiative: i.ok ? i.value : null,
        hpMax: h.ok ? h.value : null,
        ac: a.ok ? a.value : null,
      });
      // Midt i kampen logges det, så alle enheter ser hvem som kom til.
      const added = r.state.participants.find((p) => p.id === r.id)?.name ?? name;
      return s.status === 'active' ? addLog(r.state, `${added} er med i kampen`, null) : r.state;
    });
    setName('');
    setInit('');
    setHp('');
    setAc('');
  };
  return (
    <details className={styles.details}>
      <summary>Legg til fiende/NPC (valgfritt)</summary>
      <form className={styles.stack} onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-n`}>
            Navn
          </label>
          <input id={`${id}-n`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-k`}>
            Type
          </label>
          <select
            id={`${id}-k`}
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value === 'npc' ? 'npc' : 'enemy')}
          >
            <option value="enemy">Fiende</option>
            <option value="npc">NPC (alliert eller nøytral)</option>
          </select>
        </div>
        <div className={styles.entryRow}>
          <IntField
            label="Initiativ (total)"
            value={init}
            onChange={setInit}
            allowNegative
            placeholder="valgfritt"
          />
          <IntField label="HP" value={hp} onChange={setHp} placeholder="valgfritt" />
          <IntField label="AC" value={ac} onChange={setAc} placeholder="valgfritt" />
        </div>
        {error && <p className="field__error">{error}</p>}
        <button type="submit" className="btn btn--small">
          Legg til
        </button>
      </form>
    </details>
  );
}

/** «Start runde 1». Står øverst, til venstre for «Avslutt kamp». */
export function StartButton() {
  const { update } = useCombatContext();
  return (
    <button type="button" className="btn btn--small" onClick={() => update(startCombat)}>
      Start runde 1
    </button>
  );
}

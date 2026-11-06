import {
  CREATURE_TYPE_NAME,
  FAMILIAR_CREATURE_TYPES,
  FAMILIAR_FORMS,
  FAMILIAR_FORM_IDS,
  FIND_FAMILIAR,
  castCost,
  castFindFamiliar,
  damageFamiliar,
  dismissFamiliarForever,
  familiarCreatureType,
  familiarHp,
  familiarHpMax,
  familiarSpeedText,
  familiarStatus,
  healFamiliar,
  setFamiliarPresent,
  updateFamiliar,
  type FamiliarCreatureType,
  type FamiliarForm,
  type FamiliarFormId,
  type FamiliarState,
} from '@dnd/rules';
import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { sign } from '../../components/format';
import { useGameContext } from './GameContext';
import { HpControl } from './HpControl';
import styles from './Companions.module.css';

const STATUS_TEXT = {
  present: 'Til stede',
  dismissed: 'Sendt bort til lomme-dimensjonen',
  gone: 'Forsvant på 0 HP',
} as const;

const SPELL_FORMS = FAMILIAR_FORM_IDS.filter((id) => FAMILIAR_FORMS[id].group === 'spell');
const OTHER_FORMS = FAMILIAR_FORM_IDS.filter((id) => FAMILIAR_FORMS[id].group === 'other');

/** Tallene for en form: Armor Class, HP, initiativ, bevegelse, sanser, skills og trekk. */
function FormStats({ form }: { form: FamiliarForm }) {
  const skills = Object.entries(form.skills).map(([k, v]) => `${k} ${sign(v)}`);
  return (
    <>
      <p className="dim">
        {form.size} · AC <span className="tabular">{form.ac}</span> · HP{' '}
        <span className="tabular">{form.hp}</span> · Init{' '}
        <span className="tabular">{sign(form.initiative)}</span> · {familiarSpeedText(form)}
      </p>
      <p className="dim">
        {[...form.senses, `Passive Perception ${form.passivePerception}`, ...skills].join(' · ')}
      </p>
      {form.traits.length > 0 && (
        <ul className={styles.attacks}>
          {form.traits.map((t) => (
            <li key={t.name}>
              <b>{t.name}</b> {t.text}
            </li>
          ))}
        </ul>
      )}
      <p>
        <span className="sc">God til</span> {form.text}
      </p>
    </>
  );
}

function RulesDetails() {
  return (
    <details className={styles.details}>
      <summary>Regler for Find Familiar</summary>
      <ul className={styles.attacks}>
        <li>
          <b>Kastetid</b> {FIND_FAMILIAR.castingTime}.
        </li>
        <li>
          <b>Materiale</b> {FIND_FAMILIAR.cost}. Trekkes ikke i appen.
        </li>
        <li>{FIND_FAMILIAR.text}</li>
        <li>
          Telepati og levering av touch-spells (familiarens reaction) innen {FIND_FAMILIAR.rangeFt} ft. Som
          bonus action kan du se og høre gjennom den til starten av din neste tur.
        </li>
        <li>{FIND_FAMILIAR.dismissText}</li>
      </ul>
    </details>
  );
}

/** Seksjonen på Følgesvenner-siden. Vises når arket har Find Familiar, eller spillet har en familiar. */
export function FamiliarSection() {
  const { sheet, sync } = useGameContext();
  const familiar = sync.state.familiar;
  const [summoning, setSummoning] = useState(false);
  if (!sheet.familiar && !familiar) return null;

  return (
    <section aria-labelledby="familiar-title" className={styles.section}>
      <h2 id="familiar-title" className="sc">
        Familiar (Find Familiar)
      </h2>
      {familiar ? (
        <FamiliarCard familiar={familiar} />
      ) : (
        <div className={`card ${styles.card}`}>
          <p>Du har Find Familiar, men ingen familiar i dette spillet ennå.</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setSummoning(true)}>
              Kall fram familiar
            </button>
          </div>
          <RulesDetails />
        </div>
      )}
      {!sheet.familiar && familiar && (
        <p className="dim">Arket har ikke lenger Find Familiar. Familiaren er ikke med i kamp.</p>
      )}
      <Dialog open={summoning} onClose={() => setSummoning(false)} title="Kall fram familiar">
        <SummonForm onDone={() => setSummoning(false)} />
      </Dialog>
    </section>
  );
}

function FamiliarCard({ familiar: f }: { familiar: FamiliarState }) {
  const { sync } = useGameContext();
  const [dialog, setDialog] = useState<'summon' | 'edit' | 'remove' | null>(null);
  const titleId = useId();
  const form = FAMILIAR_FORMS[f.form];
  const status = familiarStatus(f);
  const close = () => setDialog(null);

  return (
    <article className={`card ${styles.card}`} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <div>
          <h3 id={titleId} className={styles.name}>
            {f.name}
          </h3>
          <p className="dim">
            {form.name} · {CREATURE_TYPE_NAME[familiarCreatureType(f)]} · {STATUS_TEXT[status]}
          </p>
        </div>
      </div>

      {status === 'present' && (
        <HpControl
          name={f.name}
          hp={familiarHp(f)}
          max={familiarHpMax(f)}
          onDamage={(n) => sync.update((s) => damageFamiliar(s, n).state)}
          onHeal={(n) => sync.update((s) => healFamiliar(s, n))}
        />
      )}
      <div role="status">
        {status === 'gone' && (
          <p className={styles.down}>
            {f.name} forsvant på 0 HP. Kast Find Familiar igjen for å kalle den fram med full HP.
          </p>
        )}
        {status === 'dismissed' && (
          <p className="dim">
            {f.name} venter i lomme-dimensjonen med {Math.max(0, familiarHpMax(f) - f.hpRemoved)} HP. Hent den
            tilbake med en Magic action.
          </p>
        )}
      </div>

      <FormStats form={form} />

      <div className="btn-row">
        {status === 'present' && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => sync.update((s) => setFamiliarPresent(s, false))}
          >
            Send bort
          </button>
        )}
        {status === 'dismissed' && (
          <button
            type="button"
            className="btn btn--small"
            onClick={() => sync.update((s) => setFamiliarPresent(s, true))}
          >
            Hent tilbake
          </button>
        )}
        <button
          type="button"
          className={`btn btn--small ${status === 'gone' ? '' : 'btn--ghost'}`}
          onClick={() => setDialog('summon')}
        >
          {status === 'gone' ? 'Kall fram på nytt' : 'Kast på nytt / bytt form'}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setDialog('edit')}>
          Endre navn og type
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setDialog('remove')}>
          Fjern for godt
        </button>
      </div>

      <RulesDetails />

      <Dialog
        open={dialog === 'summon'}
        onClose={close}
        title={status === 'gone' ? 'Kall fram på nytt' : 'Kast Find Familiar på nytt'}
      >
        <SummonForm initial={f} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'edit'} onClose={close} title={`Endre ${f.name}`}>
        <EditForm familiar={f} onDone={close} />
      </Dialog>
      <Dialog open={dialog === 'remove'} onClose={close} title={`Fjerne ${f.name}?`}>
        <p>
          {f.name} sendes bort for godt. Du kan kalle fram en ny familiar senere ved å kaste Find Familiar.
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              sync.update(dismissFamiliarForever);
              close();
            }}
          >
            Fjern
          </button>
          <button type="button" className="btn btn--ghost" onClick={close}>
            Avbryt
          </button>
        </div>
      </Dialog>
    </article>
  );
}

function CreatureTypeField({
  value,
  onChange,
}: {
  value: FamiliarCreatureType;
  onChange: (t: FamiliarCreatureType) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Skapningstype
      </label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value as FamiliarCreatureType)}
      >
        {FAMILIAR_CREATURE_TYPES.map((t) => (
          <option key={t} value={t}>
            {CREATURE_TYPE_NAME[t]}
          </option>
        ))}
      </select>
    </div>
  );
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Navn
      </label>
      <input
        id={id}
        className="input"
        value={value}
        maxLength={100}
        placeholder="F.eks. Ugla"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Kaster Find Familiar: form, navn, skapningstype, og ritual eller spell slot. */
function SummonForm({ initial, onDone }: { initial?: FamiliarState; onDone: () => void }) {
  const { sheet, sync } = useGameContext();
  const ids = { form: useId(), cast: useId() };
  const [formId, setFormId] = useState<FamiliarFormId>(initial?.form ?? 'owl');
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<FamiliarCreatureType>(initial ? familiarCreatureType(initial) : 'fey');
  const [ritual, setRitual] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cost = castCost(sync.state, sheet, FIND_FAMILIAR.spell);
  const costText = !cost
    ? 'Ingen gratis-kast eller spell slots igjen'
    : cost.kind === 'free'
      ? `Gratis-kast (${cost.left} igjen)`
      : cost.kind === 'slot'
        ? `Spell slot ${cost.slot === 'pact' ? 'Pact' : `level ${cost.slot}`} (${cost.left} igjen)`
        : 'Gratis';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!ritual && !cost) {
      setError('Ingen spell slots igjen. Kast den som ritual i stedet.');
      return;
    }
    const n = name.trim();
    const input = { form: formId, ritual, creatureType: type, ...(n ? { name: n } : {}) };
    sync.update((s) => castFindFamiliar(s, sheet, input).state);
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.form}>
          Form
        </label>
        <select
          id={ids.form}
          className="input"
          value={formId}
          onChange={(e) => setFormId(e.target.value as FamiliarFormId)}
        >
          <optgroup label="Fra spellen">
            {SPELL_FORMS.map((id) => (
              <option key={id} value={id}>
                {FAMILIAR_FORMS[id].name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Andre dyr med CR 0 (spør DM)">
            {OTHER_FORMS.map((id) => (
              <option key={id} value={id}>
                {FAMILIAR_FORMS[id].name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <FormStats form={FAMILIAR_FORMS[formId]} />
      <NameField value={name} onChange={setName} />
      <CreatureTypeField value={type} onChange={setType} />
      <fieldset className={styles.fieldset}>
        <legend className="field__label">Kast</legend>
        <label className="check">
          <input type="radio" name={ids.cast} checked={ritual} onChange={() => setRitual(true)} />
          Ritual (1 time og 10 minutter, ingen spell slot)
        </label>
        <label className="check">
          <input
            type="radio"
            name={ids.cast}
            checked={!ritual}
            disabled={!cost}
            onChange={() => setRitual(false)}
          />
          Med spell slot (1 time) · {costText}
        </label>
      </fieldset>
      <p className="dim">
        Familiaren kommer fram med full HP. {FIND_FAMILIAR.cost}, som ikke trekkes i appen.
      </p>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button type="submit" className="btn">
          Kast Find Familiar
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Avbryt
        </button>
      </div>
    </form>
  );
}

function EditForm({ familiar: f, onDone }: { familiar: FamiliarState; onDone: () => void }) {
  const { sync } = useGameContext();
  const [name, setName] = useState(f.name);
  const [type, setType] = useState<FamiliarCreatureType>(familiarCreatureType(f));
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Gi familiaren et navn.');
      return;
    }
    sync.update((s) => updateFamiliar(s, { name, creatureType: type }));
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <NameField value={name} onChange={setName} />
      <CreatureTypeField value={type} onChange={setType} />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button type="submit" className="btn">
          Lagre
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Avbryt
        </button>
      </div>
    </form>
  );
}

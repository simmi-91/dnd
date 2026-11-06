import {
  ABILITIES,
  applyPetTraits,
  damageCompanion,
  damagePet,
  healCompanion,
  healPet,
  type Ability,
  type Companion,
  type GameState,
  type Pet,
  type PetState,
  type PetTrait,
  type PetTraitKind,
  type Sheet,
} from '@dnd/rules';
import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { makeId, parseIntInput, sign, speedsText } from '../../components/format';
import { IntField } from '../../components/IntField';
import { useDocumentTitle } from '../../components/useDocumentTitle';
import { FamiliarSection } from './FamiliarCard';
import { useGameContext } from './GameContext';
import { HpControl } from './HpControl';
import styles from './Companions.module.css';

const AB_LABEL: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

const TRAIT_KINDS: Record<PetTraitKind, string> = {
  ability: 'Evneverdi',
  attack: 'Treff-bonus',
  damage: 'Skade-bonus',
  ac: 'AC',
  hp: 'Maks HP',
  speed: 'Speed',
  maxCrit: 'Krit mot monstrosity: all skade maks',
  obey: 'Må adlyde: Animal Handling',
  note: 'Notat',
};

const DELTA_KINDS: PetTraitKind[] = ['attack', 'damage', 'ac', 'hp', 'speed'];
const MAX_TRAITS = 50;
const MAX_COMPANIONS = 50;

function traitLabel(t: PetTrait): string {
  switch (t.kind) {
    case 'ability':
      return `${sign(t.delta)} ${AB_LABEL[t.stat]}`;
    case 'obey':
      return `Animal Handling DC ${t.dc} for å adlyde`;
    case 'maxCrit':
      return TRAIT_KINDS.maxCrit;
    case 'note':
      return t.text;
    default:
      return `${sign(t.delta)} ${TRAIT_KINDS[t.kind]}${t.kind === 'speed' ? ' (ft)' : ''}`;
  }
}

const NEW_PET: PetState = { traits: [], hpRemoved: 0, inCombat: true };

/** Endrer tilstanden til ett kjæledyr. Mangler det i tilstanden, starter det tomt. */
function withPet(state: GameState, id: string, fn: (p: PetState) => PetState): GameState {
  return { ...state, pets: { ...state.pets, [id]: fn(state.pets[id] ?? NEW_PET) } };
}

export function CompanionsPage() {
  const { game, sheet, sync } = useGameContext();
  useDocumentTitle(`Følgesvenner · ${game.name}`);
  const ah = sheet.skills.find((k) => k.key === 'animal-handling')?.bonus ?? 0;

  return (
    <div className="page">
      <header className="page__head">
        <div className="sc">{game.name}</div>
        <h1>Følgesvenner</h1>
      </header>

      <section aria-labelledby="pets-title" className={styles.section}>
        <h2 id="pets-title" className="sc">
          Fra arket på D&amp;D Beyond
        </h2>
        {sheet.pets.length === 0 ? (
          <p className="card dim">
            Ingen kjæledyr i arket. Legg dem til under Extras på D&amp;D Beyond og hent arket på nytt.
          </p>
        ) : (
          <ul className={styles.grid}>
            {sheet.pets.map((p) => (
              <li key={p.id}>
                <PetCard pet={p} state={sync.state.pets[p.id] ?? NEW_PET} ah={ah} sheet={sheet} />
              </li>
            ))}
          </ul>
        )}
        <p className="dim">
          Trekkene lagres bare her og blir værende når du henter fra D&amp;D Beyond på nytt.
        </p>
      </section>

      <FamiliarSection />

      <OwnCompanions />
    </div>
  );
}

function PetCard({ pet, state, ah, sheet }: { pet: Pet; state: PetState; ah: number; sheet: Sheet }) {
  const { sync } = useGameContext();
  const ap = applyPetTraits(pet, state.traits);
  const hpMax = Math.max(0, ap.hpMax);
  const hp = Math.max(0, hpMax - state.hpRemoved);
  const titleId = useId();
  const update = (fn: (p: PetState) => PetState) => sync.update((s) => withPet(s, pet.id, fn));

  return (
    <article className={`card ${styles.card}`} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <div>
          <h3 id={titleId} className={styles.name}>
            {pet.name}
          </h3>
          <p className="dim">
            {pet.kind} · AC <span className="tabular">{ap.ac}</span> · Init{' '}
            <span className="tabular">{sign(ap.initiative)}</span>
            {ap.speeds.length > 0 && ` · ${speedsText(ap.speeds)}`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.inCombat}
          className={styles.switch}
          onClick={() => update((p) => ({ ...p, inCombat: !p.inCombat }))}
        >
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchThumb} />
          </span>
          Med i kamp
        </button>
      </div>

      <HpControl
        name={pet.name}
        hp={hp}
        max={hpMax}
        onDamage={(n) =>
          sync.update((s) =>
            damagePet(
              withPet(s, pet.id, (p) => p),
              sheet,
              pet.id,
              n,
            ),
          )
        }
        onHeal={(n) =>
          sync.update((s) =>
            healPet(
              withPet(s, pet.id, (p) => p),
              sheet,
              pet.id,
              n,
            ),
          )
        }
      />

      <ul className={styles.abilities} aria-label="Evneverdier">
        {ABILITIES.map((a) => {
          const base = pet.stats[a];
          const now = ap.stats[a];
          const changed = base !== now;
          return (
            <li key={a} className={`${styles.ability} ${changed ? styles.changed : ''}`}>
              <span className={styles.abLabel}>{AB_LABEL[a]}</span>
              <span className={`${styles.abMod} tabular`}>{sign(ap.mod[a])}</span>
              <span className="tabular">
                {changed ? (
                  <>
                    <s className="dim">{base ?? '–'}</s> {now ?? '–'}
                  </>
                ) : (
                  (base ?? '–')
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {ap.attacks.length > 0 && (
        <ul className={styles.attacks}>
          {pet.multiattack && (
            <li className="dim">
              Multiattack: {pet.multiattack.count}× {pet.multiattack.attack}
            </li>
          )}
          {ap.attacks.map((atk) => (
            <li key={atk.name} className="tabular">
              <b>{atk.name}</b> {sign(atk.hit)} · {atk.count}d{atk.sides}
              {atk.mod !== 0 && sign(atk.mod)} {atk.dmgType} · {atk.reach}
              {ap.flags.maxCrit && <span className="dim"> · krit mot monstrosity: maks skade</span>}
            </li>
          ))}
        </ul>
      )}
      {(pet.skills.length > 0 || pet.senses.length > 0) && (
        <p className="dim">
          {[...pet.skills.map((k) => `${k.name} ${sign(k.bonus)}`), ...pet.senses].join(' · ')}
        </p>
      )}
      {(pet.traitsText || pet.actionsText) && (
        <details className={styles.details}>
          <summary>Statblokk fra D&amp;D Beyond</summary>
          {pet.traitsText && <p className={styles.desc}>{pet.traitsText}</p>}
          {pet.actionsText && <p className={styles.desc}>{pet.actionsText}</p>}
        </details>
      )}
      {pet.notes && (
        <p className={styles.note}>
          <span className="sc">Notat fra D&amp;D Beyond</span> <q>{pet.notes}</q>
        </p>
      )}
      {ap.flags.obey != null && (
        <p className="dim">
          Før hver tur slår du Animal Handling ({sign(ah)}) mot DC {ap.flags.obey}.
        </p>
      )}

      <Traits traits={state.traits} petName={pet.name} update={update} />
    </article>
  );
}

function Traits({
  traits,
  petName,
  update,
}: {
  traits: PetTrait[];
  petName: string;
  update: (fn: (p: PetState) => PetState) => void;
}) {
  const ids = { kind: useId(), stat: useId(), note: useId(), noteErr: useId() };
  const [kind, setKind] = useState<PetTraitKind>('ability');
  const [stat, setStat] = useState<Ability>('str');
  const [delta, setDelta] = useState('1');
  const [dc, setDc] = useState('10');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    let trait: PetTrait;
    const id = makeId();
    if (kind === 'ability') {
      const r = parseIntInput(delta, -30, 30);
      if (!r.ok) return setError(r.error);
      trait = { id, kind, stat, delta: r.value };
    } else if (kind === 'obey') {
      const r = parseIntInput(dc, 1, 40);
      if (!r.ok) return setError(r.error);
      trait = { id, kind, dc: r.value };
    } else if (kind === 'note') {
      const t = text.trim();
      if (!t || t.length > 2000) return setError(t ? 'Notatet kan ha høyst 2000 tegn.' : 'Skriv et notat.');
      trait = { id, kind, text: t };
    } else if (kind === 'maxCrit') {
      trait = { id, kind };
    } else {
      const r = parseIntInput(delta, -1000, 1000);
      if (!r.ok) return setError(r.error);
      trait = { id, kind, delta: r.value };
    }
    const replaces = (kind === 'maxCrit' || kind === 'obey') && traits.some((t) => t.kind === kind);
    if (!replaces && traits.length >= MAX_TRAITS) return setError(`Høyst ${MAX_TRAITS} trekk.`);
    setError(null);
    setText('');
    // maxCrit og obey finnes bare én gang: en ny erstatter den gamle.
    update((p) => ({
      ...p,
      traits: replaces
        ? p.traits.map((t) => (t.kind === kind ? { ...trait, id: t.id } : t))
        : [...p.traits, trait],
    }));
  };

  const remove = (id: string) => update((p) => ({ ...p, traits: p.traits.filter((t) => t.id !== id) }));
  const needsDelta = kind === 'ability' || DELTA_KINDS.includes(kind);

  return (
    <div className={styles.traits}>
      <h4 className="sc">Trekk</h4>
      {traits.length === 0 ? (
        <p className="dim">Ingen trekk ennå.</p>
      ) : (
        <ul className={styles.traitList}>
          {traits.map((t) => (
            <li key={t.id} className={styles.trait}>
              <span>{traitLabel(t)}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => remove(t.id)}
                aria-label={`Fjern ${traitLabel(t)} fra ${petName}`}
              >
                fjern
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.addTrait} onSubmit={add} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={ids.kind}>
            Nytt trekk
          </label>
          <select
            id={ids.kind}
            className="input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PetTraitKind);
              setError(null);
            }}
          >
            {(Object.keys(TRAIT_KINDS) as PetTraitKind[]).map((k) => (
              <option key={k} value={k}>
                {TRAIT_KINDS[k]}
              </option>
            ))}
          </select>
        </div>
        {kind === 'ability' && (
          <div className="field">
            <label className="field__label" htmlFor={ids.stat}>
              Evne
            </label>
            <select
              id={ids.stat}
              className="input"
              value={stat}
              onChange={(e) => setStat(e.target.value as Ability)}
            >
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {AB_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        )}
        {needsDelta && <IntField label="Endring (±)" value={delta} onChange={setDelta} allowNegative />}
        {kind === 'obey' && <IntField label="DC" value={dc} onChange={setDc} />}
        {kind === 'note' && (
          <div className="field">
            <label className="field__label" htmlFor={ids.note}>
              Notat
            </label>
            <input
              id={ids.note}
              className="input"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        <button type="submit" className="btn btn--small" aria-label={`Legg til trekk på ${petName}`}>
          Legg til
        </button>
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

// ---------- Egne følgesvenner ----------

function OwnCompanions() {
  const { sync } = useGameContext();
  const [adding, setAdding] = useState(false);
  const companions = sync.state.companions;
  return (
    <section aria-labelledby="own-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="own-title" className="sc">
          Egne følgesvenner
        </h2>
        {companions.length < MAX_COMPANIONS && (
          <button type="button" className="btn btn--small" onClick={() => setAdding(true)}>
            + Legg til
          </button>
        )}
      </div>
      <p className="dim">
        For følgesvenner som ikke finnes i D&amp;D Beyond, f.eks. leiesoldater eller NPC-er som følger gruppa.
        Familiaren fra Find Familiar har sitt eget kort.
      </p>
      {companions.length > 0 && (
        <ul className={styles.grid}>
          {companions.map((c) => (
            <li key={c.id}>
              <CompanionCard companion={c} />
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Ny følgesvenn">
        <CompanionForm
          onSave={(c) => {
            sync.update((s) => ({ ...s, companions: [...s.companions, { ...c, id: makeId() }] }));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
    </section>
  );
}

function CompanionCard({ companion: c }: { companion: Companion }) {
  const { sync } = useGameContext();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const titleId = useId();
  const hpMax = c.hpMax;

  return (
    <article className={`card ${styles.card}`} aria-labelledby={titleId}>
      <div>
        <h3 id={titleId} className={styles.name}>
          {c.name}
        </h3>
        <p className="dim">
          {[c.kind, c.ac != null ? `AC ${c.ac}` : null, `Init ${sign(c.initiativeBonus)}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {hpMax != null && (
        <HpControl
          name={c.name}
          hp={Math.max(0, hpMax - (c.hpRemoved ?? 0))}
          max={hpMax}
          onDamage={(n) => sync.update((s) => damageCompanion(s, c.id, n))}
          onHeal={(n) => sync.update((s) => healCompanion(s, c.id, n))}
        />
      )}
      {c.notes && <p className={styles.desc}>{c.notes}</p>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setEditing(true)}
          aria-label={`Endre ${c.name}`}
        >
          Endre
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setRemoving(true)}
          aria-label={`Fjern ${c.name}`}
        >
          Fjern
        </button>
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title={`Endre ${c.name}`}>
        <CompanionForm
          initial={c}
          onSave={(next) => {
            sync.update((s) => ({
              ...s,
              companions: s.companions.map((x) => {
                if (x.id !== c.id) return x;
                const merged: Companion = { ...next, id: c.id };
                // Tapt HP holdes innenfor ny maks HP.
                if (merged.hpMax != null) merged.hpRemoved = Math.min(x.hpRemoved ?? 0, merged.hpMax);
                return merged;
              }),
            }));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Dialog>
      <Dialog open={removing} onClose={() => setRemoving(false)} title={`Fjerne ${c.name}?`}>
        <p>{c.name} fjernes fra spillet.</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              sync.update((s) => ({ ...s, companions: s.companions.filter((x) => x.id !== c.id) }));
              setRemoving(false);
            }}
          >
            Fjern
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setRemoving(false)}>
            Avbryt
          </button>
        </div>
      </Dialog>
    </article>
  );
}

type CompanionDraft = Omit<Companion, 'id'>;

function CompanionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Companion;
  onSave: (c: CompanionDraft) => void;
  onCancel: () => void;
}) {
  const ids = { name: useId(), kind: useId(), notes: useId(), nameErr: useId() };
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState(initial?.kind ?? '');
  const [ac, setAc] = useState(initial?.ac != null ? String(initial.ac) : '');
  const [hpMax, setHpMax] = useState(initial?.hpMax != null ? String(initial.hpMax) : '');
  const [init, setInit] = useState(String(initial?.initiativeBonus ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const optional = (raw: string, min: number, max: number, key: string, errs: Record<string, string>) => {
    if (raw.trim() === '') return undefined;
    const r = parseIntInput(raw, min, max);
    if (!r.ok) {
      errs[key] = r.error;
      return undefined;
    }
    return r.value;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const n = name.trim();
    if (!n) errs.name = 'Gi følgesvennen et navn.';
    const acV = optional(ac, 0, 50, 'ac', errs);
    const hpV = optional(hpMax, 0, 10_000, 'hp', errs);
    const initR = parseIntInput(init.trim() === '' ? '0' : init, -20, 30);
    if (!initR.ok) errs.init = initR.error;
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !initR.ok) return;
    const draft: CompanionDraft = { name: n, initiativeBonus: initR.value };
    if (kind.trim()) draft.kind = kind.trim();
    if (acV != null) draft.ac = acV;
    if (hpV != null) {
      draft.hpMax = hpV;
      draft.hpRemoved = 0;
    }
    if (notes.trim()) draft.notes = notes.trim();
    onSave(draft);
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.name}>
          Navn
        </label>
        <input
          id={ids.name}
          className="input"
          value={name}
          maxLength={100}
          placeholder="F.eks. Brann"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? ids.nameErr : undefined}
        />
        {errors.name && (
          <p id={ids.nameErr} className="field__error">
            {errors.name}
          </p>
        )}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.kind}>
          Art
        </label>
        <input
          id={ids.kind}
          className="input"
          value={kind}
          maxLength={200}
          placeholder="F.eks. Mercenary"
          onChange={(e) => setKind(e.target.value)}
        />
      </div>
      <div className={styles.formRow}>
        <IntField label="AC" value={ac} onChange={setAc} error={errors.ac} placeholder="11" />
        <IntField label="Maks HP" value={hpMax} onChange={setHpMax} error={errors.hp} placeholder="1" />
        <IntField label="Initiativbonus" value={init} onChange={setInit} error={errors.init} allowNegative />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.notes}>
          Notater
        </label>
        <textarea
          id={ids.notes}
          className="input"
          value={notes}
          maxLength={5000}
          placeholder="F.eks. Følger gruppa til Bryn Shander."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="btn-row">
        <button type="submit" className="btn">
          Lagre
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </form>
  );
}

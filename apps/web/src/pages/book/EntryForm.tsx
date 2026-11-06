import {
  ENTRY_KINDS,
  ENTRY_NAME_MAX,
  ENTRY_SUMMARY_MAX,
  PERSON_ATTITUDES,
  PLACE_TYPES,
  QUEST_STATUSES,
  type Entry,
  type EntryKind,
  type EntryListItem,
} from '@dnd/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  entryConflictOf,
  entryPath,
  isBodyTooLong,
  useCreateEntry,
  useUpdateEntry,
} from '../../api/campaign';
import { errorMessage } from '../../components/errorMessage';
import { MentionEditor } from '../../components/MentionEditor';
import { EntryPicker } from './EntryPicker';
import { emptyValues, toCreate, toUpdate, valuesFrom, type Values } from './entryValues';
import { ATTITUDE_LABEL, KIND_LABEL, PLACE_TYPE_LABEL, STATUS_LABEL, type EntryLookup } from './labels';
import styles from './Book.module.css';

interface EntryFormProps {
  gameId: number;
  /** Uten oppføring lages en ny av typen `initialKind`. */
  entry?: Entry;
  initialKind?: EntryKind;
  lookup: EntryLookup;
  /** Dit «Avbryt» går. */
  cancelTo: string;
}

/** Skjema for å lage eller endre en oppføring. Lagrer med `version` og håndterer 409 og 422. */
export function EntryForm({ gameId, entry, initialKind = 'quest', lookup, cancelTo }: EntryFormProps) {
  const navigate = useNavigate();
  const create = useCreateEntry(gameId);
  const update = useUpdateEntry();
  const ids = { name: useId(), nameErr: useId(), body: useId(), bodyErr: useId() };
  const [base, setBase] = useState<Entry | undefined>(entry);
  const [v, setV] = useState<Values>(() => (entry ? valuesFrom(entry, lookup) : emptyValues(initialKind)));
  const [taken, setTaken] = useState<EntryListItem | Entry | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setV((old) => ({ ...old, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTaken(null);
    setNameError(null);
    setBodyError(null);
    setNotice(null);
    setFormError(null);
    if (v.name.trim() === '') {
      setNameError('Skriv et navn.');
      return;
    }
    try {
      const res = base
        ? await update.mutateAsync({ id: base.id, body: toUpdate(v, base) })
        : await create.mutateAsync(toCreate(v));
      void navigate(entryPath(gameId, res.entry.id, res.entry.kind));
    } catch (err) {
      const conflict = entryConflictOf(err);
      if (conflict?.error === 'version_conflict') {
        // Serverens versjon erstatter skjemaet, så neste lagring bygger på den.
        setBase(conflict.entry);
        setV(valuesFrom(conflict.entry, lookup));
        setNotice(
          'Oppføringen ble endret på en annen enhet. Skjemaet er lastet inn på nytt med den nyeste versjonen. Gjør endringene dine på nytt og lagre.',
        );
      } else if (conflict?.error === 'name_taken') {
        setTaken(conflict.entry);
        setNameError(
          `Det finnes allerede en oppføring av typen ${KIND_LABEL[conflict.entry.kind]} med dette navnet.`,
        );
      } else if (isBodyTooLong(err)) {
        setBodyError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    }
  }

  const kind = base?.kind ?? v.kind;
  const heading = base ? 'Endre oppføring' : 'Ny oppføring';

  return (
    <form
      className={`card ${styles.form}`}
      onSubmit={(e) => void submit(e)}
      aria-labelledby="form-title"
      noValidate
    >
      <h2 id="form-title">{heading}</h2>

      {notice && (
        <p className="alert" role="alert">
          {notice}
        </p>
      )}

      {!base && (
        <div className="field">
          <label className="field__label" htmlFor="entry-kind">
            Type
          </label>
          <select
            id="entry-kind"
            className="input"
            value={v.kind}
            onChange={(e) => set('kind', e.target.value as EntryKind)}
          >
            {ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor={ids.name}>
          Navn
        </label>
        <input
          id={ids.name}
          className="input"
          value={v.name}
          maxLength={ENTRY_NAME_MAX}
          onChange={(e) => set('name', e.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? ids.nameErr : undefined}
        />
        {nameError && (
          <p id={ids.nameErr} className="field__error" role="alert">
            {nameError}{' '}
            {taken && <Link to={entryPath(gameId, taken.id, taken.kind)}>Åpne «{taken.name}»</Link>}
          </p>
        )}
      </div>

      {kind === 'quest' && (
        <div className="field">
          <label className="field__label" htmlFor="entry-status">
            Status
          </label>
          <select
            id="entry-status"
            className="input"
            value={v.status}
            onChange={(e) => set('status', e.target.value as Values['status'])}
          >
            {QUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === 'quest' && (
        <>
          <EntryPicker
            gameId={gameId}
            kind="person"
            label="Gitt av"
            value={v.giver ? [v.giver] : []}
            onChange={(p) => set('giver', p[0] ?? null)}
          />
          <EntryPicker
            gameId={gameId}
            kind="place"
            label="Sted"
            multiple
            value={v.places}
            onChange={(p) => set('places', p)}
          />
          <div className="field">
            <label className="field__label" htmlFor="entry-reward">
              Belønning
            </label>
            <input
              id="entry-reward"
              className="input"
              value={v.reward}
              maxLength={500}
              onChange={(e) => set('reward', e.target.value)}
            />
          </div>
        </>
      )}

      {kind === 'person' && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="entry-role">
              Rolle
            </label>
            <input
              id="entry-role"
              className="input"
              value={v.role}
              maxLength={200}
              onChange={(e) => set('role', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="entry-attitude">
              Holdning
            </label>
            <select
              id="entry-attitude"
              className="input"
              value={v.attitude}
              onChange={(e) => set('attitude', e.target.value as Values['attitude'])}
            >
              <option value="">Ikke valgt</option>
              {PERSON_ATTITUDES.map((a) => (
                <option key={a} value={a}>
                  {ATTITUDE_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <EntryPicker
            gameId={gameId}
            kind="place"
            label="Sted"
            value={v.home ? [v.home] : []}
            onChange={(p) => set('home', p[0] ?? null)}
          />
        </>
      )}

      {kind === 'place' && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="entry-place-type">
              Type
            </label>
            <select
              id="entry-place-type"
              className="input"
              value={v.placeType}
              onChange={(e) => set('placeType', e.target.value as Values['placeType'])}
            >
              <option value="">Ikke valgt</option>
              {PLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLACE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <EntryPicker
            gameId={gameId}
            kind="place"
            label="Ligger i"
            excludeId={base?.id}
            value={v.parent ? [v.parent] : []}
            onChange={(p) => set('parent', p[0] ?? null)}
          />
        </>
      )}

      <div className="field">
        <label className="field__label" htmlFor="entry-summary">
          Oppsummering
        </label>
        <input
          id="entry-summary"
          className="input"
          value={v.summary}
          maxLength={ENTRY_SUMMARY_MAX}
          onChange={(e) => set('summary', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={ids.body}>
          Notater
        </label>
        <MentionEditor
          id={ids.body}
          gameId={gameId}
          rows={8}
          value={v.body}
          onChange={(body) => set('body', body)}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? ids.bodyErr : undefined}
        />
        {bodyError && (
          <p id={ids.bodyErr} className="field__error" role="alert">
            {bodyError}
          </p>
        )}
      </div>

      {formError && (
        <p className="alert" role="alert">
          {formError}
        </p>
      )}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Lagrer …' : 'Lagre'}
        </button>
        <Link className="btn btn--ghost" to={cancelTo}>
          Avbryt
        </Link>
      </div>
    </form>
  );
}

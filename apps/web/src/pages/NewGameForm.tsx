import {
  DEFAULT_GAME_COVER,
  type CharacterSummary,
  type GameCover,
  type GameDetailResponse,
} from '@dnd/shared';
import { useId, useState, type FormEvent } from 'react';
import { useCreateGame, usePreviewCharacter } from '../api/games';
import { CoverPicker } from '../components/CoverPicker';
import { errorMessage } from '../components/errorMessage';
import { previewPastedJson } from '../components/pastePreview';
import styles from './NewGameForm.module.css';

interface NewGameFormProps {
  onCreated: (detail: GameDetailResponse) => void;
  onCancel?: () => void;
}

type Source = 'ref' | 'json';

/**
 * Navn og karakter, forhåndsvisning, så lagring. Karakteren hentes med lenke eller ID, eller limes
 * inn som JSON (reserven). Brukes både som side og i dialog.
 */
export function NewGameForm({ onCreated, onCancel }: NewGameFormProps) {
  const ids = {
    name: useId(),
    ref: useId(),
    json: useId(),
    help: useId(),
    nameErr: useId(),
    srcErr: useId(),
    source: useId(),
  };
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('ref');
  const [ref, setRef] = useState('');
  const [json, setJson] = useState('');
  const [cover, setCover] = useState<GameCover>(DEFAULT_GAME_COVER);
  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** Hva forhåndsvisningen gjelder. Endres feltet, må den tas på nytt. */
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [jsonPreview, setJsonPreview] = useState<CharacterSummary | null>(null);
  const preview = usePreviewCharacter();
  const create = useCreateGame();

  const trimmedRef = ref.trim();
  const trimmedJson = json.trim();
  const key = source === 'ref' ? `ref:${trimmedRef}` : `json:${trimmedJson}`;
  const fresh = previewedFor === key;
  const shown: CharacterSummary | null = !fresh
    ? null
    : source === 'ref'
      ? (preview.data?.character ?? null)
      : jsonPreview;

  const onPreview = () => {
    create.reset();
    if (source === 'ref') {
      if (!trimmedRef) return setSourceError('Skriv inn lenken til karakteren eller ID-en.');
      if (trimmedRef.length > 500) return setSourceError('Lenken er for lang.');
      setSourceError(null);
      setPreviewedFor(key);
      preview.mutate(trimmedRef);
      return;
    }
    const r = previewPastedJson(json);
    if (!r.ok) {
      setJsonPreview(null);
      return setSourceError(r.error);
    }
    setSourceError(null);
    setJsonPreview(r.character);
    setPreviewedFor(key);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!shown) return onPreview();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      setNameError(trimmedName ? 'Navnet kan ha høyst 100 tegn.' : 'Gi spillet et navn.');
      return;
    }
    setNameError(null);
    const body =
      source === 'ref'
        ? { name: trimmedName, ddbUrlOrId: trimmedRef, cover }
        : { name: trimmedName, json: trimmedJson, cover };
    create.mutate(body, { onSuccess: onCreated });
  };

  const apiError = create.error ?? (source === 'ref' && fresh ? preview.error : null);

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={ids.name}>
          Navn på spillet
        </label>
        <input
          id={ids.name}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="F.eks. Icewind Dale"
          maxLength={100}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? ids.nameErr : undefined}
        />
        {nameError && (
          <p id={ids.nameErr} className="field__error">
            {nameError}
          </p>
        )}
      </div>

      <fieldset className={styles.source}>
        <legend className="field__label">Karakteren</legend>
        <div className={styles.sourceOptions}>
          <label className="check">
            <input
              type="radio"
              name={ids.source}
              checked={source === 'ref'}
              onChange={() => {
                setSource('ref');
                setSourceError(null);
              }}
            />
            Hent fra D&amp;D Beyond
          </label>
          <label className="check">
            <input
              type="radio"
              name={ids.source}
              checked={source === 'json'}
              onChange={() => {
                setSource('json');
                setSourceError(null);
              }}
            />
            Lim inn JSON
          </label>
        </div>
      </fieldset>

      {source === 'ref' ? (
        <div className="field">
          <label className="field__label" htmlFor={ids.ref}>
            Lenke eller ID fra D&amp;D Beyond
          </label>
          <input
            id={ids.ref}
            className="input"
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setSourceError(null);
            }}
            placeholder="dndbeyond.com/characters/…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={sourceError ? true : undefined}
            aria-describedby={sourceError ? `${ids.srcErr} ${ids.help}` : ids.help}
          />
          {sourceError && (
            <p id={ids.srcErr} className="field__error">
              {sourceError}
            </p>
          )}
          <p id={ids.help} className="field__help">
            Karakteren må være offentlig: åpne karakteren på D&amp;D Beyond, velg <i>Edit</i> → <i>Home</i>,
            og sett <i>Character Privacy</i> til <i>Public</i>.
          </p>
        </div>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor={ids.json}>
            JSON fra D&amp;D Beyond
          </label>
          <p id={ids.help} className="field__help">
            Virker ikke hentingen, kan du åpne{' '}
            <code>character-service.dndbeyond.com/character/v5/character/&lt;ID&gt;</code> i nettleseren,
            kopiere alt og lime det inn her.
          </p>
          <textarea
            id={ids.json}
            className="input"
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setSourceError(null);
            }}
            spellCheck={false}
            aria-invalid={sourceError ? true : undefined}
            aria-describedby={sourceError ? `${ids.srcErr} ${ids.help}` : ids.help}
          />
          {sourceError && (
            <p id={ids.srcErr} className="field__error">
              {sourceError}
            </p>
          )}
        </div>
      )}

      <CoverPicker value={cover} onChange={setCover} />

      {apiError && (
        <p className="alert" role="alert">
          {errorMessage(apiError)}
        </p>
      )}

      {shown && (
        <section className={`card ${styles.preview}`} aria-label="Forhåndsvisning">
          <div className="sc">Forhåndsvisning</div>
          <div className={styles.previewName}>{shown.name}</div>
          <div className="dim">{shown.summary}</div>
          <div className={`${styles.previewStats} tabular`}>
            <span>
              HP <b>{shown.hpMax}</b>
            </span>
            <span>
              AC <b>{shown.ac}</b>
            </span>
            <span>
              Nivå <b>{shown.level}</b>
            </span>
          </div>
        </section>
      )}

      <div className="btn-row">
        <button
          type="button"
          className={shown ? 'btn btn--ghost' : 'btn'}
          onClick={onPreview}
          disabled={preview.isPending}
        >
          {preview.isPending ? 'Henter …' : 'Forhåndsvis'}
        </button>
        {shown && (
          <button type="submit" className="btn" disabled={create.isPending}>
            {create.isPending ? 'Lagrer …' : 'Lagre spillet'}
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Avbryt
          </button>
        )}
      </div>
    </form>
  );
}

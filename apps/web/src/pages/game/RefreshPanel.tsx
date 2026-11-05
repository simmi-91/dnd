import type { Game, RefreshCharacterResponse } from '@dnd/shared';
import { useId, useState } from 'react';
import { usePasteCharacter, useRefreshCharacter, useUpdateGame } from '../../api/games';
import { errorMessage } from '../../components/errorMessage';
import { formatDateTime } from '../../components/format';
import { MAX_PASTE } from '../../components/pastePreview';
import type { GameStateHook } from '../../state/useGameState';
import styles from './RefreshPanel.module.css';

interface RefreshPanelProps {
  game: Game;
  /** Uten synk (spill uten ark) byttes tilstanden når spillet hentes på nytt. */
  sync?: Pick<GameStateHook, 'flush' | 'replace'>;
}

/** «Oppdater fra D&D Beyond», med «Lim inn JSON» som reserve og kort med nye evner etterpå. */
export function RefreshPanel({ game, sync }: RefreshPanelProps) {
  const refresh = useRefreshCharacter(game.id);
  const paste = usePasteCharacter(game.id);
  const [alsoHp, setAlsoHp] = useState(false);
  const [json, setJson] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [result, setResult] = useState<RefreshCharacterResponse | null>(null);
  const ids = { check: useId(), json: useId(), jsonErr: useId() };
  const busy = refresh.isPending || paste.isPending;
  const hasCharacter = game.character != null;

  const done = (res: RefreshCharacterResponse) => {
    sync?.replace(res.state);
    setResult(res);
  };

  const onRefresh = async () => {
    paste.reset();
    setResult(null);
    // Lagre det som ikke er lagret først, så serveren fletter med den nyeste tilstanden.
    await sync?.flush();
    refresh.mutate({ alsoHpAndResources: alsoHp }, { onSuccess: done });
  };

  const onPaste = async () => {
    const text = json.trim();
    if (!text) {
      setPasteError('Lim inn JSON-svaret fra D&D Beyond først.');
      return;
    }
    if (text.length > MAX_PASTE) {
      setPasteError('Teksten er for stor (over 2 MB).');
      return;
    }
    setPasteError(null);
    refresh.reset();
    setResult(null);
    await sync?.flush();
    paste.mutate(
      { json: text, alsoHpAndResources: alsoHp },
      {
        onSuccess: (res) => {
          setJson('');
          done(res);
        },
      },
    );
  };

  const apiError = refresh.error ?? paste.error;

  return (
    <section className={`card ${styles.panel}`} aria-labelledby={`${ids.check}-title`}>
      <h2 id={`${ids.check}-title`} className="sc">
        D&amp;D Beyond
      </h2>
      {game.character && (
        <p className="dim">
          Sist hentet {formatDateTime(game.character.importedAt)}.
          {game.character.outdated &&
            ' Arket er regnet ut med en eldre versjon og oppdateres ved neste henting.'}
        </p>
      )}
      <label className="check" htmlFor={ids.check}>
        <input
          id={ids.check}
          type="checkbox"
          checked={alsoHp}
          onChange={(e) => setAlsoHp(e.target.checked)}
        />
        Hent også HP og brukte ressurser
      </label>
      {hasCharacter && (
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => void onRefresh()} disabled={busy}>
            {refresh.isPending ? 'Henter …' : 'Oppdater fra D&D Beyond'}
          </button>
        </div>
      )}

      {apiError && (
        <p className="alert" role="alert">
          {errorMessage(apiError)}
        </p>
      )}

      {result && result.newFeatures.length === 0 && (
        <p role="status" className={styles.ok}>
          Arket er oppdatert.
        </p>
      )}
      {result && result.newFeatures.length > 0 && (
        <div className={`card ${styles.newFeatures}`} role="status">
          <div className="sc">Nye evner</div>
          <p>Nivå {result.sheet?.level ?? ''}! Arket er regnet ut på nytt. Dette er nytt:</p>
          <ul className={styles.featureList}>
            {result.newFeatures.map((f) => (
              <li key={`${f.cls}-${f.name}-${f.level}`}>
                <details>
                  <summary>
                    <b>{f.name}</b>{' '}
                    <span className="dim">
                      {f.cls} {f.level}
                    </span>
                  </summary>
                  <p className={styles.desc}>{f.desc || 'Ingen beskrivelse.'}</p>
                </details>
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button type="button" className="btn btn--small" onClick={() => setResult(null)}>
              OK
            </button>
          </div>
        </div>
      )}

      <details className={styles.paste} open={!hasCharacter || undefined}>
        <summary className={styles.pasteSummary}>Lim inn JSON (reserve)</summary>
        <div className="field">
          <label className="field__label" htmlFor={ids.json}>
            JSON fra D&amp;D Beyond
          </label>
          <p className="field__help">
            Virker ikke hentingen, kan du åpne{' '}
            <code>character-service.dndbeyond.com/character/v5/character/&lt;ID&gt;</code> i nettleseren,
            kopiere alt og lime det inn her.
          </p>
          <textarea
            id={ids.json}
            className="input"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            aria-invalid={pasteError ? true : undefined}
            aria-describedby={pasteError ? ids.jsonErr : undefined}
          />
          {pasteError && (
            <p id={ids.jsonErr} className="field__error">
              {pasteError}
            </p>
          )}
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn--ghost" onClick={() => void onPaste()} disabled={busy}>
            {paste.isPending ? 'Leser …' : 'Bruk innlimt JSON'}
          </button>
        </div>
      </details>

      <SwitchCharacter game={game} sync={sync} />
    </section>
  );
}

/** «Bytt karakter»: PATCH med ny lenke eller ID. Tilstanden (HP, ressurser) starter på nytt. */
function SwitchCharacter({ game, sync }: RefreshPanelProps) {
  const update = useUpdateGame(game.id);
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ids = { input: useId(), err: useId(), warn: useId() };
  const hasCharacter = game.character != null;

  const onSwitch = async () => {
    const trimmed = ref.trim();
    if (!trimmed) return setError('Skriv inn lenken til karakteren eller ID-en.');
    if (trimmed.length > 500) return setError('Lenken er for lang.');
    setError(null);
    setDone(false);
    await sync?.flush();
    update.mutate(
      { ddbUrlOrId: trimmed },
      {
        onSuccess: (detail) => {
          sync?.replace(detail.state);
          setRef('');
          setDone(true);
        },
      },
    );
  };

  return (
    <details className={styles.paste} open={!hasCharacter || undefined}>
      <summary className={styles.pasteSummary}>Bytt karakter</summary>
      <p id={ids.warn} className={styles.warning}>
        Spillet kobles til en annen karakter. HP, brukte ressurser og kjæledyr starter på nytt fra den nye
        karakteren. Egne følgesvenner beholdes ikke.
      </p>
      <div className="field">
        <label className="field__label" htmlFor={ids.input}>
          Lenke eller ID fra D&amp;D Beyond
        </label>
        <input
          id={ids.input}
          className="input"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            setError(null);
          }}
          placeholder="dndbeyond.com/characters/…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids.err} ${ids.warn}` : ids.warn}
        />
        {error && (
          <p id={ids.err} className="field__error">
            {error}
          </p>
        )}
      </div>
      {update.error && (
        <p className="alert" role="alert">
          {errorMessage(update.error)}
        </p>
      )}
      {done && (
        <p role="status" className={styles.ok}>
          Karakteren er byttet.
        </p>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onSwitch()}
          disabled={update.isPending}
        >
          {update.isPending ? 'Henter …' : 'Bytt karakter'}
        </button>
      </div>
    </details>
  );
}

import { familiarStatus, turReducer, type CombatState, type GameState, type TurnEvent } from '@dnd/rules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loading } from '../../../components/States';
import { useDocumentTitle } from '../../../components/useDocumentTitle';
import { COMBAT_POLL_MS } from '../../../state/combatStore';
import { useCombat } from '../../../state/useCombat';
import { useGameContext } from '../GameContext';
import styles from './Combat.module.css';
import { CombatContext, type CombatContextValue } from './CombatContext';
import { RoundView } from './RoundView';
import { useFocusRescue } from './steps';
import { SetupView, StartButton } from './SetupView';

interface Snapshot {
  combat: CombatState;
  game: GameState;
}

/** Hvor mange valg som kan angres. */
const UNDO_MAX = 20;

type History = { id: number | null; snaps: Snapshot[] };

/** Angre-historikken lagres i fanen (sessionStorage), så den overlever omlasting. Feil ignoreres. */
function loadHistory(key: string): History {
  try {
    const raw = sessionStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as History) : null;
    return v && Array.isArray(v.snaps) ? v : { id: null, snaps: [] };
  } catch {
    return { id: null, snaps: [] };
  }
}

function saveHistory(key: string, h: History): void {
  try {
    if (h.snaps.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(h));
  } catch {
    // Full eller blokkert lagring: angre virker fortsatt til siden lastes på nytt.
  }
}

/** `/spill/:gameId/kamp`: kampen som pågår, eller knappen for å starte en. */
export function CombatPage() {
  const { game, sheet, sync } = useGameContext();
  useDocumentTitle(`Kamp · ${game.name}`);
  const combat = useCombat(game.id, { game: sync });
  const [ending, setEnding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rescue = useFocusRescue();
  // Bekreftelsen bytter ut knappene, så fokus flyttes til «Avbryt» og tilbake til «Avslutt kamp».
  const endBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const confirmWas = useRef(false);
  useEffect(() => {
    if (confirm) cancelBtn.current?.focus();
    else if (confirmWas.current) endBtn.current?.focus();
    confirmWas.current = confirm;
  }, [confirm]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const state = combat.sync?.state ?? null;
  const { update } = combat;

  // HP, slots og familiaren bor i spilltilstanden. Hent den like ofte som kampen mens kampen pågår, så
  // en annen enhet ser det samme.
  const active = combat.combat != null;
  const refetchGame = sync.refetch;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refetchGame();
    }, COMBAT_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refetchGame]);

  // Angre: før hvert valg lagres kampen og spilltilstanden slik de var vist. Flere hendelser fra samme
  // trykk (f.eks. angrep og treff) blir ett steg, fordi de har samme utgangspunkt.
  const combatId = combat.combat?.id ?? null;
  const undoKey = `dnd:angre:${game.id}`;
  const [history, setHistory] = useState<History>(() => loadHistory(undoKey));
  useEffect(() => saveHistory(undoKey, history), [undoKey, history]);
  const snaps = useMemo(() => (history.id === combatId ? history.snaps : []), [history, combatId]);
  const gameState = sync.state;
  const syncUpdate = sync.update;
  const value = useMemo<CombatContextValue | null>(() => {
    if (!state) return null;
    const record = () =>
      setHistory((h) => {
        const list = h.id === combatId ? h.snaps : [];
        if (list.at(-1)?.combat === state) return h;
        return { id: combatId, snaps: [...list.slice(-(UNDO_MAX - 1)), { combat: state, game: gameState }] };
      });
    const last = snaps.at(-1);
    return {
      state,
      dispatch: ending
        ? () => undefined
        : (e: TurnEvent) => {
            record();
            update((s) => turReducer(s, e));
          },
      update: ending
        ? () => undefined
        : (fn: (s: CombatState) => CombatState) => {
            record();
            update(fn);
          },
      locked: ending,
      undo:
        ending || !last
          ? null
          : () => {
              setHistory({ id: combatId, snaps: snaps.slice(0, -1) });
              update(() => last.combat);
              syncUpdate(() => last.game);
            },
    };
  }, [state, gameState, snaps, combatId, update, syncUpdate, ending]);

  if (combat.loading) return <Loading label="Henter kampen …" />;

  const end = async () => {
    setEnding(true);
    setConfirm(false);
    await combat.end();
    setEnding(false);
  };

  return (
    <div className={`page ${styles.page}`} {...rescue}>
      {combat.notice && (
        <div className="alert" role="alert">
          {combat.notice}{' '}
          <button type="button" className="link-btn" onClick={combat.clearNotice}>
            OK
          </button>
        </div>
      )}
      {combat.error && (
        <div className="alert" role="alert">
          {combat.error}
        </div>
      )}
      {combat.sync?.error && (
        <div className="alert" role="alert">
          Kampen er ikke lagret: {combat.sync.error}
        </div>
      )}
      {combat.sync?.status === 'offline' && (
        <p className="dim" role="status">
          Uten nett: kampen lagres når nettet er tilbake.
        </p>
      )}

      {!value && (
        <section className="card">
          <h1 tabIndex={-1}>Kamp</h1>
          <p className="dim">
            Karakteren, kjæledyr med «med i kamp» på og familiaren (når den er til stede) er med. Fiender er
            valgfrie.
          </p>
          {sync.state.companions.length > 0 && (
            <fieldset className={styles.fieldset}>
              <legend className="field__label">Egne følgesvenner som er med</legend>
              {sync.state.companions.map((c) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={!exclude.includes(c.id)}
                    onChange={(e) =>
                      setExclude((x) => (e.target.checked ? x.filter((i) => i !== c.id) : [...x, c.id]))
                    }
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            className={`btn ${styles.big}`}
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              await combat.start(exclude.length ? { excludeCompanions: exclude } : {});
              setStarting(false);
            }}
          >
            {starting ? 'Starter …' : 'Start kamp'}
          </button>
          <p className="dim">
            <Link to={`/spill/${game.id}/folgesvenner`}>Følgesvenner</Link> bestemmer hvem som er med.{' '}
            {sheet.familiar &&
              !(sync.state.familiar && familiarStatus(sync.state.familiar) === 'present') &&
              'Kall fram familiaren der før kampen.'}
          </p>
        </section>
      )}

      {value && (
        <CombatContext.Provider value={value}>
          <header className={styles.bar}>
            <h1 className={styles.round} tabIndex={-1}>
              {value.state.status === 'setup' ? 'Oppsett' : `Runde ${value.state.round}`}
            </h1>
            {confirm ? (
              <div className="btn-row">
                <button type="button" className="btn btn--small" onClick={() => void end()}>
                  Ja, avslutt kampen
                </button>
                <button
                  ref={cancelBtn}
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setConfirm(false)}
                >
                  Avbryt
                </button>
              </div>
            ) : (
              <div className="btn-row">
                {value.state.status === 'setup' && <StartButton />}
                <button
                  ref={endBtn}
                  type="button"
                  className="btn btn--ghost btn--small"
                  disabled={ending}
                  onClick={() => setConfirm(true)}
                >
                  {ending ? 'Avslutter …' : 'Avslutt kamp'}
                </button>
              </div>
            )}
          </header>
          <fieldset className={styles.lock} disabled={ending} aria-busy={ending}>
            {value.state.status === 'setup' ? <SetupView /> : <RoundView />}
          </fieldset>
          {value.undo && (
            // Vises etter hvert valg, nederst på skjermen der du er, og forsvinner etter noen sekunder.
            // Ny `key` per steg, så den kommer fram igjen etter neste valg (og etter en angring).
            <div key={snaps.length} className={styles.snack}>
              <span className={styles.snackText}>{value.state.log[0]?.text ?? 'Endret'}</span>
              <button type="button" className="btn btn--small" onClick={value.undo}>
                Angre
              </button>
            </div>
          )}
        </CombatContext.Provider>
      )}
    </div>
  );
}

import {
  ABILITIES,
  addLog,
  addParticipant,
  familiarParticipant,
  familiarStatus,
  initiativeOrder,
  petHpMax,
  roundComplete,
  type Participant,
} from '@dnd/rules';
import { useState } from 'react';
import { sign, speedsText } from '../../../components/format';
import { useMediaQuery } from '../../../components/useMediaQuery';
import { useGameContext } from '../GameContext';
import { CharacterTurn } from './CharacterTurn';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { FamiliarTurn } from './FamiliarTurn';
import { participantHp } from './helpers';
import { OtherTurn } from './OtherTurn';
import { PetTurn } from './PetTurn';
import { AddEnemy } from './SetupView';
import { InfoContext, type InfoContent } from './info';
import { InfoBox, InfoDrawer } from './InfoPanel';
import { Toggle } from './AttackFlow';

export const LAPTOP_QUERY = '(min-width: 1100px)';

function Panel({ p }: { p: Participant }) {
  switch (p.kind) {
    case 'character':
      return <CharacterTurn p={p} />;
    case 'pet':
      return <PetTurn p={p} />;
    case 'familiar':
      return <FamiliarTurn p={p} />;
    default:
      return <OtherTurn p={p} />;
  }
}

/**
 * Rundene: faner per deltaker i initiativrekkefølge (festet øverst på mobil, liste til venstre på
 * laptop), panelet til valgt deltaker, og på laptop ark, bjørner og notater til høyre. Panelene skjules
 * i stedet for å fjernes, så et halvveis angrep beholdes ved fanebytte.
 */
export function RoundView() {
  const { sheet, sync } = useGameContext();
  const { state, dispatch, update } = useCombatContext();
  const order = initiativeOrder(state);
  // Valget gjelder bare mens turen er den samme. Går turen videre (også fra en annen enhet), følger fanen med.
  const [picked, setPicked] = useState<{ id: string; current: string | null } | null>(null);
  const selected = picked && picked.current === state.current ? picked.id : state.current;
  const laptop = useMediaQuery(LAPTOP_QUERY);
  const [info, setInfo] = useState<InfoContent | null>(null);
  const who = selected && order.includes(selected) ? selected : (state.current ?? order[0] ?? null);
  const complete = roundComplete(state);
  const f = sync.state.familiar;
  const familiarMissing =
    sheet.familiar &&
    f &&
    familiarStatus(f) === 'present' &&
    !state.participants.some((p) => p.kind === 'familiar');
  const me = state.participants.find((p) => p.kind === 'character');

  return (
    <InfoContext.Provider value={setInfo}>
      <div className={styles.layout}>
        <div className={laptop ? styles.leftCol : styles.leftColMobile}>
          <nav className={styles.tabs} aria-label="Deltakere i initiativrekkefølge">
            {order.map((id) => {
              const p = state.participants.find((x) => x.id === id);
              if (!p) return null;
              const hp = participantHp(p, sync.state, sheet);
              const done = state.done.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.tab}
                  aria-pressed={who === id}
                  data-current={state.current === id}
                  data-done={done}
                  data-defeated={p.defeated}
                  onClick={() => setPicked({ id, current: state.current })}
                >
                  <span className={styles.tabName}>
                    {done ? '✓ ' : p.defeated ? '✗ ' : state.current === id ? '▶ ' : ''}
                    {p.name}
                    {state.checks.some((c) => c.who === id) ? ' !' : ''}
                  </span>
                  <span className={`${styles.tabMeta} tabular`}>
                    {p.initiative ?? '–'}
                    {hp ? ` · ${hp.hp}/${hp.max}` : ''}
                  </span>
                </button>
              );
            })}
          </nav>
          {laptop && <InfoBox info={info} onClose={() => setInfo(null)} />}
        </div>

        <div className={styles.main}>
          {complete && (
            <div className={`card ${styles.flow}`}>
              <b>Alle har spilt runde {state.round}</b>
              <button
                type="button"
                className={`btn ${styles.big}`}
                onClick={() => dispatch({ type: 'nextRound' })}
              >
                Start runde {state.round + 1}
              </button>
            </div>
          )}
          {state.participants.map((p) => (
            <section key={p.id} data-panel hidden={who !== p.id} aria-label={`Panel for ${p.name}`}>
              <h2 className={styles.panelTitle}>{p.name}</h2>
              <Panel p={p} />
            </section>
          ))}
          <details className={styles.details}>
            <summary>Flere i kampen</summary>
            <div className={styles.stack}>
              {me?.limits.darknessAdvantage && (
                <Toggle
                  on={state.darkness}
                  onClick={() => dispatch({ type: 'darkness', on: !state.darkness })}
                >
                  {me.name} står i mørke
                </Toggle>
              )}
              {familiarMissing && f && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    update((s) =>
                      addLog(addParticipant(s, familiarParticipant(f)), `${f.name} er med i kampen`, null),
                    )
                  }
                >
                  Ta med {f.name} (familiar)
                </button>
              )}
              <AddEnemy />
            </div>
          </details>
          {!laptop && <CombatLog />}
        </div>

        {laptop && <SideColumn />}
        {!laptop && <InfoDrawer info={info} onClose={() => setInfo(null)} />}
      </div>
    </InfoContext.Provider>
  );
}

/** Kamploggen, nyeste først. */
function LogList() {
  const { state } = useCombatContext();
  if (state.log.length === 0) return <p className="dim">Ingenting i loggen ennå.</p>;
  return (
    <ol className={styles.log}>
      {state.log.map((e) => (
        <li key={e.id}>
          {e.round > 0 && <span className={styles.logRound}>R{e.round}</span>} {e.text}
        </li>
      ))}
    </ol>
  );
}

/** På mobil: loggen nederst, lukket som standard. På laptop står den i høyre kolonne. */
function CombatLog() {
  const { state } = useCombatContext();
  return (
    <details className={styles.details}>
      <summary>Kamplogg ({state.log.length})</summary>
      <LogList />
    </details>
  );
}

const SIDE_TABS = [
  ['ark', 'Ark'],
  ['logg', 'Logg'],
  ['bjorner', 'Bjørner'],
  ['notater', 'Notater'],
] as const;

/** Høyre kolonne på laptop: ark, bjørner eller notater (notater kommer i fase 4). */
function SideColumn() {
  const { sheet, sync } = useGameContext();
  const [tab, setTab] = useState<(typeof SIDE_TABS)[number][0]>('ark');
  return (
    <aside className={styles.side} aria-label="Ark og notater">
      <div className={styles.sideTabs} role="tablist">
        {SIDE_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={styles.sideTab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'ark' && (
        <div className={styles.stack}>
          <p className="dim">
            Spell DC {sheet.spellDc ?? '–'} · Spell attack{' '}
            {sheet.spellAttack != null ? sign(sheet.spellAttack) : '–'} · PB {sign(sheet.pb)}
          </p>
          <span className="sc">Saves</span>
          <ul className={styles.plainGrid}>
            {ABILITIES.map((a) => (
              <li key={a}>
                {a.toUpperCase()} <b className="tabular">{sign(sheet.saves[a].bonus)}</b>
              </li>
            ))}
          </ul>
          <span className="sc">Skills</span>
          <ul className={styles.plainGrid}>
            {sheet.skills.map((s) => (
              <li key={s.key}>
                {s.name} <b className="tabular">{sign(s.bonus)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'bjorner' && (
        <div className={styles.stack}>
          {sheet.pets.length === 0 && <p className="dim">Ingen kjæledyr i arket.</p>}
          {sheet.pets.map((pet) => {
            const removed = sync.state.pets[pet.id]?.hpRemoved ?? 0;
            const max = petHpMax(sync.state, sheet, pet.id) ?? pet.hpMax;
            return (
              <div key={pet.id} className="card">
                <b>{pet.name}</b>
                <p className="dim">
                  AC {pet.ac} · HP {Math.max(0, max - removed)}/{max} · {speedsText(pet.speeds)}
                </p>
                <ul className={styles.plain}>
                  {pet.attacks.map((a) => (
                    <li key={a.name}>
                      {a.name} {sign(a.hit)} · {a.count}d{a.sides}
                      {a.mod ? sign(a.mod) : ''} {a.dmgType}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'logg' && <LogList />}
      {tab === 'notater' && <p className="dim">Notater kommer med kampanjeboka (fase 4).</p>}
    </aside>
  );
}

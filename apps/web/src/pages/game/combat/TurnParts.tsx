import {
  CONDITIONS,
  CONDITION_DEFS,
  canDo,
  concentratingOn,
  damageCompanion,
  damageFamiliar,
  damagePet,
  effectiveSpeed,
  healCompanion,
  healFamiliar,
  healPet,
  movementLeft,
  standUpCost,
  type ActionDef,
  type CombatEffect,
  type CombatState,
  type Participant,
} from '@dnd/rules';
import { useId, useState, type ReactNode } from 'react';
import { MAX_HP_INPUT, parseIntInput, sign } from '../../../components/format';
import { IntField } from '../../../components/IntField';
import { useGameContext } from '../GameContext';
import { HpControl } from '../HpControl';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { allies, nameOf, participantHp, targets } from './helpers';
import { goToStep, stepState, turnLeft, useScrollIntoView, type StepTone } from './steps';
import { D20Entry, Opt, Step, Tip } from './ui';

// Deler som går igjen i panelet til hver deltaker.

/**
 * Turlinja øverst i panelet: hva som er ledig (trykk for å gå til steget), hva som sist skjedde,
 * «Angre» og «Avslutt tur».
 */
export function TurnBar({ p, busy }: { p: Participant; busy: boolean }) {
  const { state, undo } = useCombatContext();
  const t = p.turn;
  const left = turnLeft(state, p);
  const items: { step: StepTone; label: string; free: boolean }[] = [
    { step: 'move', label: `${movementLeft(state, p.id)} ft igjen`, free: left.move },
    { step: 'bonus', label: 'Bonus action', free: left.bonus },
    {
      step: 'action',
      label: t.action === 'attack' && t.attacksLeft > 0 ? `Angrep igjen: ${t.attacksLeft}` : 'Action',
      free: left.action,
    },
    { step: 'reaction', label: 'Reaction', free: left.reaction },
  ];
  const last = state.log.find((e) => e.who === p.id && e.round === state.round);
  return (
    <div className={styles.turnBar}>
      <div className={styles.econ} aria-label="Turen så langt">
        {items.map((i) => (
          <button
            key={i.step}
            type="button"
            className={styles.econItem}
            data-used={!i.free}
            onClick={(e) => goToStep(e.currentTarget, i.step)}
          >
            {i.free ? '●' : '✗'} {i.label}
          </button>
        ))}
      </div>
      {last && (
        <p className={styles.last} role="status" aria-live="polite">
          Sist: {last.text}
        </p>
      )}
      <div className="btn-row">
        <TurnButton p={p} busy={busy} />
        {undo && (
          <button type="button" className="btn btn--ghost btn--small" onClick={undo}>
            Angre
          </button>
        )}
      </div>
    </div>
  );
}

/** Steg 1: bevegelse. `speedText` viser alle typene (familiaren: «flyging 60 ft, gange 5 ft»). */
export function MovementStep({ p, busy, speedText }: { p: Participant; busy: boolean; speedText?: string }) {
  const { state, dispatch } = useCombatContext();
  const left = movementLeft(state, p.id);
  const speed = effectiveSpeed(state, p.id);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const move = (feet: number) => dispatch({ type: 'move', who: p.id, feet });
  const check = (feet: number) => canDo(state, { who: p.id, kind: 'move', feet }, { busy });
  const custom = () => {
    const r = parseIntInput(value, 1, 1000);
    if (!r.ok) return setError(r.error);
    const c = check(r.value);
    if (!c.ok) return setError(c.reason);
    setError(null);
    setValue('');
    move(r.value);
  };
  const first = p.turns === 1 && p.limits.firstTurnSpeed > 0;
  return (
    <Step
      n="1"
      title="Bevegelse"
      tone="move"
      {...stepState(state, p, 'move')}
      hint={
        <>
          <span className="tabular">{left}</span> av {speed * (1 + p.turn.dashes)} ft igjen
        </>
      }
    >
      {speedText && <p className="dim">{speedText}</p>}
      {first && (
        <Tip tone="psychic">Første tur: +{p.limits.firstTurnSpeed} ft speed (Ambusher&apos;s Leap).</Tip>
      )}
      <div className="btn-row">
        {[5, 10, 15, 30].map((ft) => (
          <button
            key={ft}
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!check(ft).ok}
            title={check(ft).reason ?? undefined}
            onClick={() => move(ft)}
          >
            {ft} ft
          </button>
        ))}
        {left > 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={!check(left).ok}
            title={check(left).reason ?? undefined}
            onClick={() => move(left)}
          >
            Resten ({left} ft)
          </button>
        )}
      </div>
      <span className="field__label" aria-hidden="true">
        Annen avstand (ft)
      </span>
      <div className={styles.entryRow}>
        <IntField
          label="Annen avstand (ft)"
          hideLabel
          value={value}
          onChange={setValue}
          error={error}
          placeholder="ft"
        />
        <button type="button" className="btn btn--small" onClick={custom}>
          Flytt
        </button>
      </div>
      {p.conditions.includes('prone') && (
        <Opt
          title="Reis deg (Prone)"
          sub={`Koster ${standUpCost(state, p.id)} ft (halve speeden).`}
          check={canDo(state, { who: p.id, kind: 'standUp' }, { busy })}
          onClick={() => dispatch({ type: 'standUp', who: p.id })}
        />
      )}
      <p className="dim">Du kan dele opp bevegelsen før og etter angrepet.</p>
    </Step>
  );
}

const SIMPLE: readonly ActionDef['id'][] = [
  'dash',
  'disengage',
  'dodge',
  'influence',
  'magic',
  'ready',
  'search',
  'study',
  'utilize',
];

/**
 * Actions som ikke er angrep. Help åpner et valg av hvem som får hjelp, Hide en Stealth-sjekk.
 * `list` bestemmer rekkefølgen og hva som er anbefalt (familiaren har Help øverst).
 */
export function ActionOptions({
  p,
  busy,
  list,
  onHelp,
  onHide,
  extra,
}: {
  p: Participant;
  busy: boolean;
  list: readonly { action: ActionDef; recommended: boolean }[];
  onHelp: () => void;
  onHide: () => void;
  /** Ekstra tekst under et valg, f.eks. Flyby under Help. */
  extra?: Partial<Record<ActionDef['id'], ReactNode>>;
}) {
  const { state, dispatch } = useCombatContext();
  return (
    <>
      {list.map(({ action, recommended }) => {
        if (action.id === 'attack') return null;
        const check = canDo(state, { who: p.id, kind: 'action', action: action.id }, { busy });
        const onClick =
          action.id === 'help'
            ? onHelp
            : action.id === 'hide'
              ? onHide
              : SIMPLE.includes(action.id)
                ? () =>
                    dispatch({
                      type: 'action',
                      who: p.id,
                      action: action.id as Exclude<ActionDef['id'], 'attack'>,
                    })
                : () => undefined;
        return (
          <div key={action.id} className={styles.optWrap}>
            <Opt title={action.name} sub={action.text} check={check} rec={recommended} onClick={onClick} />
            {extra?.[action.id]}
          </div>
        );
      })}
    </>
  );
}

/** Help: hvem som får advantage, og eventuelt mot hvilken fiende. Begge er valgfrie. */
export function HelpPicker({ p, onClose }: { p: Participant; onClose: () => void }) {
  const scrollRef = useScrollIntoView<HTMLDivElement>();
  const { state, dispatch } = useCombatContext();
  const id = useId();
  const friends = allies(state, p.id);
  const foes = targets(state);
  const [target, setTarget] = useState(
    friends.find((x) => x.kind === 'character')?.id ?? friends[0]?.id ?? '',
  );
  const [enemy, setEnemy] = useState('');
  return (
    <div ref={scrollRef} className={`card ${styles.flow}`} role="group" aria-label="Help">
      <b>Help</b>
      <p className="dim">
        Den du hjelper, får advantage på neste angrep mot en fiende innen 5 ft av {p.name}, til starten av
        neste tur til {p.name}.
      </p>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-a`}>
          Hvem får hjelp
        </label>
        <select id={`${id}-a`} className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Ingen bestemt</option>
          {friends.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {foes.length > 0 && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-e`}>
            Mot fienden (valgfritt)
          </label>
          <select id={`${id}-e`} className="input" value={enemy} onChange={(e) => setEnemy(e.target.value)}>
            <option value="">Hvem som helst</option>
            {foes.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            dispatch({
              type: 'action',
              who: p.id,
              action: 'help',
              target: target || null,
              enemy: enemy || null,
            });
            onClose();
          }}
        >
          Bruk Help
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

/** Hide: Stealth mot DC 15. Uten kjent bonus skrives totalen inn med bonus 0. */
export function HideCheck({ p, bonus, onClose }: { p: Participant; bonus: number; onClose: () => void }) {
  const scrollRef = useScrollIntoView<HTMLDivElement>();
  const { dispatch } = useCombatContext();
  return (
    <div ref={scrollRef} className={`card ${styles.flow}`} role="group" aria-label="Hide">
      <b>Hide</b>
      <D20Entry
        label="Stealth"
        bonus={bonus}
        dc={15}
        hint="Krever dekning eller tungt mørke."
        onResult={(nat) => {
          dispatch({ type: 'action', who: p.id, action: 'hide', total: nat + bonus });
          onClose();
        }}
      />
      <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
        Avbryt
      </button>
    </div>
  );
}

function effectText(state: CombatState, e: CombatEffect, self: string): string | null {
  const src = nameOf(state, e.source);
  const tgt = nameOf(state, e.target);
  switch (e.kind) {
    case 'concentration':
      return e.source === self ? `Konsentrasjon: ${e.spell ?? ''}${tgt ? ` på ${tgt}` : ''}` : null;
    case 'help':
      if (e.target === self)
        return `Advantage fra Help (${src})${e.against ? ` mot ${nameOf(state, e.against)}` : ''}`;
      return e.source === self ? `Hjelper ${tgt || 'en alliert'}` : null;
    case 'hidden':
      return e.source === self ? 'Skjult: advantage på neste angrep' : null;
    case 'dodge':
      return e.source === self ? 'Dodge: angrep mot deg har disadvantage' : null;
    case 'disengage':
      return e.source === self ? 'Disengage: ingen opportunity attacks' : null;
    case 'vex':
      return e.source === self ? `Vex: advantage på neste angrep${tgt ? ` mot ${tgt}` : ''}` : null;
    case 'sap':
      return e.target === self ? `Sap fra ${src}: disadvantage på neste angrep` : null;
    case 'slow':
      return e.target === self ? `Slow fra ${src}: −10 ft speed` : null;
    case 'grapple':
      return e.target === self ? `Grappled av ${src}` : e.source === self ? `Holder ${tgt}` : null;
    default:
      return e.source === self || e.target === self ? (e.text ?? 'Effekt') : null;
  }
}

/** Aktive effekter på deltakeren, med knapp for å fjerne. */
export function Effects({ p }: { p: Participant }) {
  const { state, dispatch } = useCombatContext();
  const list = state.effects
    .map((e) => ({ e, text: effectText(state, e, p.id) }))
    .filter((x): x is { e: CombatEffect; text: string } => x.text != null);
  const conc = concentratingOn(state, p.id);
  if (list.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label="Aktive effekter">
      {list.map(({ e, text }) => (
        <li key={e.id} className={styles.chip} data-tone={e.kind === 'concentration' ? 'gold' : undefined}>
          {text}
          <button
            type="button"
            className="link-btn"
            onClick={() =>
              e.kind === 'concentration' && conc
                ? dispatch({ type: 'endConcentration', who: p.id })
                : dispatch({ type: 'removeEffect', id: e.id })
            }
          >
            {e.kind === 'concentration' ? 'avslutt' : 'fjern'}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Ventende konsentrasjonssjekker (CON save mot DC). */
export function ConcentrationChecks({ p, conBonus }: { p: Participant; conBonus: number }) {
  const { state, dispatch } = useCombatContext();
  const checks = state.checks.filter((c) => c.who === p.id);
  return (
    <>
      {checks.map((c) => (
        <div key={c.id} className={`card ${styles.flow}`} role="alert">
          <b>Konsentrasjon på {c.spell}</b>
          <D20Entry
            label={`CON save mot DC ${c.dc}`}
            bonus={conBonus}
            dc={c.dc}
            onResult={(nat) => dispatch({ type: 'concentrationSave', checkId: c.id, total: nat + conBonus })}
          />
        </div>
      ))}
    </>
  );
}

/** Conditions og exhaustion, lukket som standard. Aktive vises alltid. */
export function Conditions({ p }: { p: Participant }) {
  const { state, dispatch } = useCombatContext();
  const id = useId();
  const others = state.participants.filter((x) => x.id !== p.id);
  const grapple = state.effects.find((e) => e.kind === 'grapple' && e.target === p.id) ?? null;
  const setHolder = (holder: string) => {
    if (grapple) dispatch({ type: 'removeEffect', id: grapple.id });
    if (holder)
      dispatch({ type: 'effect', effect: { kind: 'grapple', source: holder, target: p.id, ends: null } });
  };
  return (
    <details className={styles.details}>
      <summary>
        Conditions
        {p.conditions.length > 0 && `: ${p.conditions.map((c) => CONDITION_DEFS[c].name).join(', ')}`}
        {p.exhaustion > 0 && ` · exhaustion ${p.exhaustion}`}
      </summary>
      <div className={styles.stack}>
        <p className="dim">Trykk for å slå av og på. Hold musa over for å se hva den betyr.</p>
        <div className={styles.toggles}>
          {CONDITIONS.filter((c) => c !== 'exhaustion').map((c) => {
            const on = p.conditions.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={styles.toggle}
                aria-pressed={on}
                title={CONDITION_DEFS[c].text}
                onClick={() => dispatch({ type: 'condition', who: p.id, condition: c, on: !on })}
              >
                {on ? '✓ ' : ''}
                {CONDITION_DEFS[c].name}
              </button>
            );
          })}
        </div>
        {p.conditions.includes('grappled') && others.length > 0 && (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-g`}>
              Hvem holder {p.name}?
            </label>
            <select
              id={`${id}-g`}
              className="input"
              value={grapple?.source ?? ''}
              onChange={(e) => setHolder(e.target.value)}
            >
              <option value="">Vet ikke</option>
              {others.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <p className="field__help">
              Valgfritt. Angrep mot den som holder, får ikke disadvantage. Mot alle andre har du disadvantage.
            </p>
          </div>
        )}
        {p.conditions.map((c) => (
          <p key={c} className="dim">
            <b>{CONDITION_DEFS[c].name}:</b> {CONDITION_DEFS[c].text}
          </p>
        ))}
        <div className={styles.entryRow}>
          <span>Exhaustion</span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-label="Mindre exhaustion"
            disabled={p.exhaustion <= 0}
            onClick={() => dispatch({ type: 'exhaustion', who: p.id, level: p.exhaustion - 1 })}
          >
            −
          </button>
          <b className="tabular">{p.exhaustion}</b>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-label="Mer exhaustion"
            disabled={p.exhaustion >= 6}
            onClick={() => dispatch({ type: 'exhaustion', who: p.id, level: p.exhaustion + 1 })}
          >
            +
          </button>
          {p.exhaustion > 0 && (
            <span className="dim">
              {sign(-2 * p.exhaustion)} på d20, −{5 * p.exhaustion} ft speed
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

/** I turlinja: avslutt turen, eller gi turen til deltakeren. Ute av kampen eller ferdig: bare tekst. */
function TurnButton({ p, busy }: { p: Participant; busy: boolean }) {
  const { state, dispatch } = useCombatContext();
  if (p.defeated) return <span className="dim">{p.name} er ute av kampen.</span>;
  if (state.done.includes(p.id)) return <span className="dim">Har spilt runde {state.round}.</span>;
  if (state.current !== p.id) {
    return (
      <button
        type="button"
        className="btn btn--ghost btn--small"
        title="Reactions kan brukes når som helst, også uten at det er turen din."
        onClick={() => dispatch({ type: 'selectTurn', who: p.id })}
      >
        Gi turen til {p.name}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--small"
      disabled={busy}
      title={busy ? 'Gjør ferdig det du holder på med først' : undefined}
      onClick={() => dispatch({ type: 'endTurn', who: p.id })}
    >
      Avslutt tur
    </button>
  );
}

/**
 * HP for andre enn karakteren: kjæledyr og følgesvenner (i spilltilstanden), familiaren (forsvinner
 * på 0 HP) og fiender med oppgitt HP (i kampen). Uten kjent HP: «Ute av kampen».
 */
export function OtherHp({ p }: { p: Participant }) {
  const { sheet, sync } = useGameContext();
  const { dispatch } = useCombatContext();
  const hp = participantHp(p, sync.state, sheet);
  const after = (damage: boolean, before: number, n: number) => {
    if (p.kind === 'familiar') return;
    dispatch(damage ? { type: 'damaged', who: p.id, amount: n } : { type: 'healed', who: p.id, amount: n });
    if (hp && ['pet', 'companion'].includes(p.kind)) {
      const nowZero = damage && before - n <= 0;
      if (nowZero && !p.defeated) dispatch({ type: 'defeated', who: p.id, on: true });
      if (!damage && p.defeated && before === 0) dispatch({ type: 'defeated', who: p.id, on: false });
    }
  };
  const onDamage = (n: number) => {
    const before = hp?.hp ?? 0;
    const ref = p.refId ?? '';
    if (p.kind === 'pet') sync.update((g) => damagePet(g, sheet, ref, n));
    if (p.kind === 'companion') sync.update((g) => damageCompanion(g, ref, n));
    if (p.kind === 'familiar') {
      let vanished = false;
      sync.update((g) => {
        const r = damageFamiliar(g, n);
        vanished = r.vanished;
        return r.state;
      });
      dispatch({ type: 'damaged', who: p.id, amount: n });
      if (vanished) dispatch({ type: 'vanished', who: p.id });
    }
    after(true, before, n);
  };
  const onHeal = (n: number) => {
    const before = hp?.hp ?? 0;
    const ref = p.refId ?? '';
    if (p.kind === 'pet') sync.update((g) => healPet(g, sheet, ref, n));
    if (p.kind === 'companion') sync.update((g) => healCompanion(g, ref, n));
    if (p.kind === 'familiar') {
      sync.update((g) => healFamiliar(g, n));
      dispatch({ type: 'healed', who: p.id, amount: n });
    }
    after(false, before, n);
  };
  return (
    <div className={styles.stack}>
      {hp ? (
        <HpControl
          name={p.name}
          hp={hp.hp}
          max={Math.min(hp.max, MAX_HP_INPUT)}
          onDamage={onDamage}
          onHeal={onHeal}
          downText={p.kind === 'familiar' ? `${p.name} forsvinner på 0 HP.` : undefined}
        />
      ) : (
        <p className="dim">HP er ikke kjent. Merk {p.name} som ute av kampen når DM sier det.</p>
      )}
      {p.kind !== 'familiar' && (
        <label className="check">
          <input
            type="checkbox"
            checked={p.defeated}
            onChange={(e) => dispatch({ type: 'defeated', who: p.id, on: e.target.checked })}
          />
          Ute av kampen
        </label>
      )}
    </div>
  );
}

/** Forklaringen øverst i Reaction-steget. */
export function ReactionHelp() {
  return (
    <p className="dim">
      Du har én reaction per runde. Den kan brukes fra starten av kampen, også før din første tur, når noe
      utløser den, for eksempel at en fiende går ut av rekkevidden din (Opportunity Attack). Du trenger ikke
      Ready for det. Ready er en action der du bestemmer på forhånd hva du gjør, og så bruker du reaction når
      det skjer. Valg med terninger åpner en boks, og siden går dit.
    </p>
  );
}

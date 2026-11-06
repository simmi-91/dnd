import {
  attackOutcome,
  attackRoll,
  canDo,
  damageGroups,
  damageTotal,
  masteryNote,
  maxRolls,
  payExtraDamage,
  type AttackKind,
  type AttackWeapon,
  type DamagePart,
  type DamageSource,
  type ExtraDamageDef,
  type ResourceContext,
} from '@dnd/rules';
import { useId, useState, type ReactNode } from 'react';
import { sign } from '../../../components/format';
import { useGameContext } from '../GameContext';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { nameOf, targets } from './helpers';
import { useScrollIntoView } from './steps';
import { D20Entry, DiceEntry, Tip } from './ui';

export interface AttackSpec {
  weapon: AttackWeapon;
  attack: AttackKind;
  /** Bonus for å treffe. */
  hit: number;
  damage: DamageSource;
  /** Weapon Mastery og evne-mod, til teksten etter treff eller bom. */
  mastery: { mastery: string | null; abMod?: number; mod: number; dmgType: string } | null;
}

const KIND_TEXT: Partial<Record<AttackKind, string>> = {
  light: 'Light (bonus action): ingen evnemodifikator på skaden.',
  nick: 'Nick (del av Action): ingen evnemodifikator på skaden.',
  cleave: 'Cleave: ingen evnemodifikator på skaden.',
  opportunity: 'Opportunity attack (reaction).',
};

type Stage = 'aim' | 'rolled' | 'damage' | 'done' | 'miss';

/**
 * Angrepsflyten som i prototypen: våpen → d20 → total → Traff/Bom → ekstra skade → skade per type.
 * Action-økonomien oppdateres først når d20 er skrevet inn, så «Avbryt» før kastet koster ingenting.
 */
export function AttackFlow({
  who,
  spec,
  extras = [],
  resources,
  maxCrit = false,
  pb,
  onClose,
}: {
  who: string;
  spec: AttackSpec;
  extras?: readonly ExtraDamageDef[];
  resources?: ResourceContext;
  /** Husregel: krit mot monstrosity gir maks skade. */
  maxCrit?: boolean;
  pb: number;
  onClose: () => void;
}) {
  const scrollRef = useScrollIntoView<HTMLDivElement>();
  const { state, dispatch } = useCombatContext();
  const { sheet, sync } = useGameContext();
  const id = useId();
  const [stage, setStage] = useState<Stage>('aim');
  const [target, setTarget] = useState<string>('');
  const [inMelee, setInMelee] = useState(false);
  const [longRange, setLongRange] = useState(false);
  const [adv, setAdv] = useState(false);
  const [dis, setDis] = useState(false);
  const [roll, setRoll] = useState<{ nat: number; total: number; crit: boolean } | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [monstrosity, setMonstrosity] = useState(false);
  const [result, setResult] = useState<{ parts: DamagePart[]; total: number } | null>(null);
  const [applied, setApplied] = useState(false);

  const { weapon, attack } = spec;
  const ranged = weapon.ranged;
  const foes = targets(state);
  const tgt = target || null;
  const r = attackRoll(state, who, {
    target: tgt,
    weapon,
    rangedInMelee: ranged && inMelee,
    longRange: ranged && longRange,
    advantage: adv,
    disadvantage: dis,
  });
  const bonus = spec.hit + r.d20Modifier;

  const gotD20 = (nat: number) => {
    const out = attackOutcome(nat, bonus);
    const crit = out.crit;
    dispatch({ type: 'attack', who, weapon, attack, target: tgt, nat, total: out.total });
    setRoll({ nat, total: out.total, crit });
    if (out.next === 'damage') {
      dispatch({ type: 'hit', who, weapon, target: tgt });
      setStage('damage');
    } else if (out.next === 'miss') {
      setStage('miss');
    } else setStage('rolled');
  };

  const hit = () => {
    dispatch({ type: 'hit', who, weapon, target: tgt });
    // Paralyzed eller Unconscious innen 5 ft: treffet er kritisk.
    if (r.autoCrit && roll) setRoll({ ...roll, crit: true });
    setStage('damage');
  };

  const miss = () => {
    dispatch({ type: 'log', who, text: `${nameOf(state, who)}: bom` });
    setStage('miss');
  };

  const crit = roll?.crit ?? false;
  const extraCheck = (d: ExtraDamageDef) =>
    canDo(state, { who, kind: 'extraDamage', damage: d, target: tgt }, { resources });
  const usable = extras.filter((d) => extraCheck(d).ok);
  const selected = usable.filter((d) => chosen[d.id] ?? true);
  const groups = damageGroups({ weapon: spec.damage, attack, crit, extras: selected });
  const allMax = crit && maxCrit && monstrosity;

  const finish = (rolled: Record<string, number>) => {
    const res = damageTotal(groups, rolled);
    for (const d of selected) {
      dispatch({ type: 'extraDamage', who, damage: d, target: tgt });
      if (d.resourceName) sync.update((g) => payExtraDamage(g, sheet, d));
    }
    const text = res.parts.map((p) => `${p.total} ${p.dmgType}`).join(' + ');
    dispatch({
      type: 'log',
      who,
      text: `Skade: ${text} = ${res.total}${allMax ? ' (maks-krit)' : crit ? ' (kritisk)' : ''}`,
    });
    setResult(res);
    setStage('done');
  };

  const targetHasHp = tgt != null && state.participants.find((p) => p.id === tgt)?.hp != null;
  const note = spec.mastery ? masteryNote(spec.mastery, stage === 'miss' ? 'miss' : 'hit', pb) : null;

  return (
    <div
      ref={scrollRef}
      className={`card ${styles.flow}`}
      aria-label={`Angrep med ${weapon.name}`}
      role="group"
    >
      <div className={styles.flowHead}>
        <b>{weapon.name}</b>
        <span className="dim tabular">
          {sign(spec.hit)} for å treffe · {spec.damage.count}d{spec.damage.sides}
          {spec.damage.mod ? sign(spec.damage.mod) : ''} {spec.damage.dmgType}
        </span>
      </div>
      {KIND_TEXT[attack] && <p className="dim">{KIND_TEXT[attack]}</p>}

      {stage === 'aim' && (
        <>
          {foes.length > 0 && (
            <div className="field">
              <label className="field__label" htmlFor={`${id}-t`}>
                Mål (valgfritt)
              </label>
              <select
                id={`${id}-t`}
                className="input"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Ikke valgt</option>
                {foes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={styles.toggles}>
            {ranged && (
              <>
                <Toggle on={inMelee} onClick={() => setInMelee(!inMelee)}>
                  Fiende inntil meg
                </Toggle>
                <Toggle on={longRange} onClick={() => setLongRange(!longRange)}>
                  Lang avstand
                </Toggle>
              </>
            )}
            <Toggle on={adv} onClick={() => setAdv(!adv)}>
              Annen fordel
            </Toggle>
            <Toggle on={dis} onClick={() => setDis(!dis)}>
              Disadvantage
            </Toggle>
          </div>
          {r.mode === 'advantage' && (
            <p>
              <b className={styles.good}>Advantage</b>: {r.advantage.join(', ')}.
            </p>
          )}
          {r.mode === 'disadvantage' && (
            <p>
              <b className={styles.bad}>Disadvantage</b>: {r.disadvantage.join(', ')}.
            </p>
          )}
          {r.mode === 'normal' && r.advantage.length > 0 && (
            <p className="dim">Advantage og disadvantage opphever hverandre.</p>
          )}
          {r.d20Modifier !== 0 && <p className="dim">Exhaustion: {sign(r.d20Modifier)} på d20.</p>}
          {r.autoCrit && <Tip tone="gold">{r.autoCrit}.</Tip>}
          <D20Entry label="Rull for å treffe" bonus={bonus} hint={r.hint} onResult={gotD20} />
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
            Avbryt
          </button>
        </>
      )}

      {roll && (
        <p className={styles.rollRow}>
          d20 <b className="tabular">{roll.nat}</b> {sign(bonus)} ={' '}
          <b
            className={`${styles.total} tabular`}
            data-tone={roll.nat === 20 ? 'good' : roll.nat === 1 ? 'low' : undefined}
          >
            {roll.total}
          </b>
          {roll.nat === 20 && <span className={styles.good}> Kritisk treff!</span>}
          {roll.nat === 1 && <span className={styles.bad}> Naturlig 1: bom.</span>}
        </p>
      )}

      {stage === 'rolled' && (
        <>
          <p>Du fikk {roll?.total} for å treffe. Traff det?</p>
          <div className="btn-row">
            <button type="button" className="btn" onClick={hit}>
              Traff
            </button>
            <button type="button" className="btn btn--ghost" onClick={miss}>
              Bom
            </button>
          </div>
        </>
      )}

      {stage === 'damage' && (
        <>
          {crit && <p className={styles.good}>Kritisk treff: alle skadeterningene dobles.</p>}
          {crit && maxCrit && (
            <Toggle on={monstrosity} onClick={() => setMonstrosity(!monstrosity)}>
              Målet er en monstrosity: all skade maks
            </Toggle>
          )}
          {extras.length > 0 && (
            <div className={styles.stack}>
              <span className="sc">Ekstra skade på dette treffet</span>
              <div className={styles.toggles}>
                {extras.map((d) => {
                  const ok = extraCheck(d);
                  const on = ok.ok && (chosen[d.id] ?? true);
                  const left = resources?.damage[d.id];
                  return (
                    <Toggle
                      key={d.id}
                      on={on}
                      disabled={!ok.ok}
                      title={ok.reason ?? undefined}
                      onClick={() => setChosen((c) => ({ ...c, [d.id]: !on }))}
                    >
                      {d.label} +{d.count}d{d.sides}
                      {left != null ? ` (${left} igjen)` : ''}
                    </Toggle>
                  );
                })}
              </div>
              {extras
                .map((d) => extraCheck(d))
                .filter((c) => !c.ok && c.reason)
                .map((c) => (
                  <p key={c.reason} className={styles.why}>
                    {c.reason}
                  </p>
                ))}
            </div>
          )}
          {allMax ? (
            <button type="button" className="btn" onClick={() => finish(maxRolls(groups))}>
              Regn ut maks skade
            </button>
          ) : (
            <DiceEntry
              key={groups.map((g) => `${g.key}${g.count}`).join('|')}
              groups={groups}
              onDone={finish}
            />
          )}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              // Angrepet er alt brukt. Bare skaden hoppes over (f.eks. etter «Traff» ved en feil).
              dispatch({ type: 'log', who, text: `${nameOf(state, who)}: skaden ble ikke skrevet inn` });
              onClose();
            }}
          >
            Hopp over skaden
          </button>
        </>
      )}

      {stage === 'done' && result && (
        <>
          <ul className={styles.parts}>
            {result.parts.map((p) => (
              <li key={p.key}>
                <span>{p.label}</span>
                <span className="dim tabular">
                  {p.rolled}
                  {p.mod ? ` ${sign(p.mod)}` : ''}
                </span>
                <b className="tabular">
                  {p.total} {p.dmgType}
                </b>
              </li>
            ))}
          </ul>
          <div className={styles.sumRow}>
            <span>Total skade</span>
            <span className={`${styles.total} tabular`}>{result.total}</span>
          </div>
          {note && <Tip>{note}</Tip>}
          {targetHasHp && tgt && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={applied}
              onClick={() => {
                dispatch({ type: 'damaged', who: tgt, amount: result.total, crit });
                setApplied(true);
              }}
            >
              {applied ? 'Trukket fra' : `Trekk ${result.total} HP fra ${nameOf(state, tgt)}`}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Ferdig
          </button>
        </>
      )}

      {stage === 'miss' && (
        <>
          <p className={styles.bad}>Bom.</p>
          {note && <Tip>{note}</Tip>}
          <button type="button" className="btn" onClick={onClose}>
            Ferdig
          </button>
        </>
      )}
    </div>
  );
}

export function Toggle({
  on,
  onClick,
  disabled,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {on ? '✓ ' : ''}
      {children}
    </button>
  );
}

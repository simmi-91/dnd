import {
  SLOT_RULE_TEXT,
  applyDamage,
  applyHealing,
  castCost,
  concentratingOn,
  currentHp,
  deathStatus,
  extraDamageOptions,
  familiarSensesText,
  familiarStatus,
  masteryOf,
  payCast,
  rollDeathSave,
  setTempHp,
  turnOptions,
  turnWeapon,
  type AttackKind,
  type CanDo,
  type CastCost,
  type OptionDef,
  type Participant,
  type Weapon,
} from '@dnd/rules';
import { useId, useMemo, useState } from 'react';
import { MAX_HP_INPUT, hpTone, parseIntInput, sign } from '../../../components/format';
import { IntField } from '../../../components/IntField';
import { useGameContext } from '../GameContext';
import { AttackFlow, type AttackSpec } from './AttackFlow';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { characterResources, checker, hasCheck, targets, OTHER_ACTIONS } from './helpers';
import {
  ActionOptions,
  ConcentrationChecks,
  Conditions,
  TurnBar,
  ReactionHelp,
  Effects,
  HelpPicker,
  HideCheck,
  MovementStep,
} from './TurnParts';
import { stepState, useScrollIntoView } from './steps';
import { D20Entry, Opt, Step, Tip } from './ui';

type Flow =
  | { kind: 'attack'; weapon: Weapon; attack: AttackKind }
  | { kind: 'help' }
  | { kind: 'hide' }
  | { kind: 'target'; option: OptionDef };

function weaponSpec(w: Weapon, attack: AttackKind): AttackSpec {
  return {
    weapon: turnWeapon(w),
    attack,
    hit: w.hit,
    damage: { name: w.name, count: w.count, sides: w.sides, mod: w.mod, abMod: w.abMod, dmgType: w.dmgType },
    mastery: { mastery: w.mastery, abMod: w.abMod, mod: w.mod, dmgType: w.dmgType },
  };
}

/** «150/600 ft» → «rekkevidde 150 ft (opptil 600 ft med disadvantage)». Kastevåpen i nærkamp får begge. */
function rangeText(w: Weapon): string {
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(w.range);
  if (!m) return w.range ? `rekkevidde ${w.range}` : '';
  const far = `${m[1]} ft (lang ${m[2]} ft)`;
  return !w.ranged && w.thrown ? `nærkamp 5 ft, eller kast ${far}` : `rekkevidde ${far}`;
}

/** Teksten under et våpen: treff, skade, rekkevidde og Mastery i klartekst. */
function weaponSub(w: Weapon): string {
  return [
    `${sign(w.hit)} for å treffe`,
    `${w.count}d${w.sides}${w.mod ? sign(w.mod) : ''} ${w.dmgType}`,
    rangeText(w),
    w.mastery ? `Mastery: ${w.mastery}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** «Hva gjør den?» for et våpen: hva tallene betyr og hva Mastery gjør. */
function weaponInfo(w: Weapon): string {
  const lines = [
    `${sign(w.hit)} legges til d20 når du angriper. Treffer du, ruller du ${w.count}d${w.sides}${w.mod ? ` og legger til ${sign(w.mod)}` : ''}.`,
  ];
  const m = /^(\d+)\s*\/\s*(\d+)/.exec(w.range);
  if (m)
    lines.push(
      `Rekkevidde ${m[1]} ft. Mellom ${m[1]} og ${m[2]} ft (lang avstand) har angrepet disadvantage. Lenger enn ${m[2]} ft går ikke.`,
    );
  if (w.mastery) lines.push(`Mastery ${w.mastery}: ${w.masteryText ?? ''}`.trim());
  if (w.light)
    lines.push('Light: etter et angrep med dette våpenet kan du angripe med et annet Light-våpen.');
  return lines.join('\n');
}

function costText(c: CastCost | null): string {
  if (!c) return '';
  if (c.kind === 'cantrip') return '';
  if (c.kind === 'free') return `Bruker gratis-kast (${c.left} igjen).`;
  return `Bruker spell slot ${c.slot === 'pact' ? 'Pact' : `nivå ${c.slot}`} (${c.left} igjen).`;
}

/** Karakterens tur: HP, steg 1–3 (Bevegelse, Bonus action, Action) og R (Reaction). */
export function CharacterTurn({ p }: { p: Participant }) {
  const { sheet, sync } = useGameContext();
  const { state, dispatch } = useCombatContext();
  const game = sync.state;
  const [flow, setFlow] = useState<Flow | null>(null);
  const busy = flow != null || hasCheck(state, p.id);
  const resources = characterResources(game, sheet);
  const check = checker(state, p.id, busy, resources);
  const opts = useMemo(() => turnOptions(sheet), [sheet]);
  const extras = useMemo(() => extraDamageOptions(sheet), [sheet]);
  const t = p.turn;
  const stealth = sheet.skills.find((s) => s.key === 'stealth')?.bonus ?? 0;
  const familiar = game.familiar && familiarStatus(game.familiar) === 'present' ? game.familiar : null;
  const conc = concentratingOn(state, p.id);

  /** Betaler for spellen (gratis-kast først, så slot) og bruker valget. */
  const applyOption = (o: OptionDef, target: string | null = null) => {
    let slot = false;
    let free = false;
    if (o.spell) {
      const spell = o.spell;
      const out: { cost: CastCost | null } = { cost: null };
      sync.update((g) => {
        const r = payCast(g, sheet, spell);
        out.cost = r.cost;
        return r.state;
      });
      if (!out.cost) return;
      slot = out.cost.kind === 'slot';
      free = out.cost.kind === 'free';
    }
    dispatch({ type: 'option', who: p.id, option: o, target, slot, free });
  };
  const pick = (o: OptionDef) => {
    if ((o.startsConcentration || o.requiresConcentration) && targets(state).length > 0)
      setFlow({ kind: 'target', option: o });
    else applyOption(o);
  };
  const optCheck = (o: OptionDef): CanDo => check({ kind: 'option', option: o });
  /** Hva spellen gjør, fra D&D Beyond. Eldre ark mangler teksten til de er hentet på nytt. */
  const spellInfo = (o: OptionDef): string | undefined => {
    if (!o.spell) return undefined;
    const s = sheet.spells.find((x) => x.name === o.spell);
    if (!s) return undefined;
    return s.desc || 'Teksten kommer når arket er oppdatert (Ark → «Oppdater fra D&D Beyond»).';
  };
  const optSub = (o: OptionDef) => {
    if (o.id === 'familiar-senses' && familiar) return familiarSensesText(familiar);
    const cost = o.spell ? costText(castCost(game, sheet, o.spell)) : '';
    return [o.text, cost].filter(Boolean).join(' ');
  };
  const attackCheck = (w: Weapon, attack: AttackKind) =>
    check({ kind: 'attack', weapon: turnWeapon(w), attack });
  const startAttack = (w: Weapon, attack: AttackKind) => setFlow({ kind: 'attack', weapon: w, attack });

  const bonus = opts.bonus.filter((o) => o.id !== 'familiar-senses' || familiar != null);
  const light = sheet.weapons.filter((w) => w.light);
  const lightOther = light.filter((w) => w.key !== t.lightFrom);
  const nickWeapons = lightOther.filter((w) => masteryOf(w.mastery) === 'nick');
  const cleave = sheet.weapons.find((w) => w.key === t.cleaveFrom);
  const melee = sheet.weapons.filter((w) => !w.ranged);
  const bonusSpells = bonus.some((o) => o.spell);

  return (
    <div className={styles.stack}>
      <CharacterHp p={p} />
      <ConcentrationChecks p={p} conBonus={sheet.saves.con.bonus} />
      <TurnBar p={p} busy={busy} />
      <Effects p={p} />
      {state.darkness && p.limits.darknessAdvantage && (
        <Tip tone="good">Mørke: advantage på angrep ({p.limits.darknessAdvantage}).</Tip>
      )}

      {flow?.kind === 'attack' && (
        <AttackFlow
          who={p.id}
          spec={weaponSpec(flow.weapon, flow.attack)}
          extras={extras}
          resources={resources}
          pb={sheet.pb}
          onClose={() => setFlow(null)}
        />
      )}
      {flow?.kind === 'help' && <HelpPicker p={p} onClose={() => setFlow(null)} />}
      {flow?.kind === 'hide' && <HideCheck p={p} bonus={stealth} onClose={() => setFlow(null)} />}
      {flow?.kind === 'target' && (
        <TargetPicker
          title={flow.option.name}
          onPick={(target) => {
            applyOption(flow.option, target);
            setFlow(null);
          }}
          onCancel={() => setFlow(null)}
        />
      )}

      <MovementStep p={p} busy={busy} />

      <Step n="2" title="Bonus action" tone="bonus" {...stepState(state, p, 'bonus')} hint="én per tur">
        {bonus.map((o) =>
          o.attack === 'light' ? (
            lightOther.map((w) => (
              <Opt
                key={`${o.id}-${w.key}`}
                title={`Ekstra angrep (Light): ${w.name}`}
                sub={`${weaponSub(w)}. Ingen evnemodifikator på skaden.`}
                info={weaponInfo(w)}
                infoTitle={w.name}
                check={attackCheck(w, 'light')}
                onClick={() => startAttack(w, 'light')}
              />
            ))
          ) : (
            <Opt
              key={o.id}
              title={o.name}
              sub={optSub(o)}
              check={optCheck(o)}
              rec={o.startsConcentration != null && conc?.spell !== o.startsConcentration}
              onClick={() => pick(o)}
              info={spellInfo(o)}
            />
          ),
        )}
        {bonus.length === 0 && <p className="dim">Ingen bonus actions fra arket.</p>}
        {bonusSpells && <p className="dim">{SLOT_RULE_TEXT}</p>}
      </Step>

      <Step
        n="3"
        title="Action"
        tone="action"
        {...stepState(state, p, 'action')}
        hint={
          sheet.attacksPerAction > 1 ? `${sheet.attacksPerAction} angrep per Attack-action` : 'én per tur'
        }
      >
        {sheet.weapons.map((w) => (
          <Opt
            key={w.key}
            title={`Angrip med ${w.name}`}
            sub={weaponSub(w)}
            info={weaponInfo(w)}
            infoTitle={w.name}
            check={attackCheck(w, 'main')}
            rec={w.ranged}
            onClick={() => startAttack(w, 'main')}
          />
        ))}
        {t.lightFrom &&
          opts.part.some((o) => o.attack === 'nick') &&
          nickWeapons.map((w) => (
            <Opt
              key={`nick-${w.key}`}
              title={`Nick: ${w.name} (del av Action)`}
              sub={`${weaponSub(w)}. Bonus action er fortsatt ledig.`}
              info={weaponInfo(w)}
              infoTitle={w.name}
              check={attackCheck(w, 'nick')}
              onClick={() => startAttack(w, 'nick')}
            />
          ))}
        {!t.lightFrom && nickWeapons.length > 0 && light.length >= 2 && (
          <p className="dim">
            Tips: angrip med et annet Light-våpen først. Da kan du ta {nickWeapons[0]?.name} som Nick-angrep
            uten å bruke bonus action.
          </p>
        )}
        {cleave && (
          <Opt
            title={`Cleave: angrip en til med ${cleave.name}`}
            sub="En annen fiende innen 5 ft av den første. Ingen evnemodifikator på skaden."
            check={attackCheck(cleave, 'cleave')}
            onClick={() => startAttack(cleave, 'cleave')}
          />
        )}
        <span className={`sc ${styles.groupHead}`}>Andre actions</span>
        <ActionOptions
          p={p}
          busy={busy}
          list={OTHER_ACTIONS}
          onHelp={() => setFlow({ kind: 'help' })}
          onHide={() => setFlow({ kind: 'hide' })}
        />
        {opts.magic.length > 0 && (
          <>
            <span className={`sc ${styles.groupHead}`}>Spells (Magic action)</span>
            <p className="dim">{SLOT_RULE_TEXT}</p>
            {opts.magic.map((o) => (
              <Opt
                key={o.id}
                title={o.name}
                sub={optSub(o)}
                check={optCheck(o)}
                onClick={() => pick(o)}
                info={spellInfo(o)}
              />
            ))}
          </>
        )}
      </Step>

      <Step n="R" title="Reaction" tone="reaction" {...stepState(state, p, 'reaction')} hint="én per runde">
        <ReactionHelp />
        {opts.reactions.map((o) =>
          o.attack === 'opportunity' ? (
            melee.map((w) => (
              <Opt
                key={`oa-${w.key}`}
                title={`Opportunity Attack: ${w.name}`}
                sub={`${o.text} ${weaponSub(w)}`}
                info={weaponInfo(w)}
                infoTitle={w.name}
                check={attackCheck(w, 'opportunity')}
                onClick={() => startAttack(w, 'opportunity')}
              />
            ))
          ) : (
            <Opt
              key={o.id}
              title={o.name}
              sub={optSub(o)}
              check={optCheck(o)}
              onClick={() => pick(o)}
              info={spellInfo(o)}
            />
          ),
        )}
      </Step>

      <Conditions p={p} />
    </div>
  );
}

/** Mål for Hunter's Mark og lignende. Valgfritt: «Uten mål» virker også. */
function TargetPicker({
  title,
  onPick,
  onCancel,
}: {
  title: string;
  onPick: (target: string | null) => void;
  onCancel: () => void;
}) {
  const scrollRef = useScrollIntoView<HTMLDivElement>();
  const { state } = useCombatContext();
  const id = useId();
  const [target, setTarget] = useState('');
  return (
    <div ref={scrollRef} className={`card ${styles.flow}`} role="group" aria-label={title}>
      <b>{title}</b>
      <div className="field">
        <label className="field__label" htmlFor={id}>
          Mål (valgfritt)
        </label>
        <select id={id} className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Uten mål</option>
          {targets(state).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => onPick(target || null)}>
          Bruk
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

/** HP for karakteren: skade (med konsentrasjonssjekk), helbredelse, temp HP og death saves. */
function CharacterHp({ p }: { p: Participant }) {
  const { sheet, sync } = useGameContext();
  const { dispatch } = useCombatContext();
  const game = sync.state;
  const hp = currentHp(game, sheet);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = deathStatus(game, sheet);

  const read = (): number | null => {
    const r = parseIntInput(value, 1, MAX_HP_INPUT);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setError(null);
    setValue('');
    return r.value;
  };
  const damage = () => {
    const n = read();
    if (n == null) return;
    const wasUp = hp > 0;
    const holder: { res: ReturnType<typeof applyDamage> | null } = { res: null };
    sync.update((g) => {
      holder.res = applyDamage(g, sheet, n);
      return holder.res.state;
    });
    const out = holder.res;
    dispatch({ type: 'damaged', who: p.id, amount: n });
    if (out?.atZero && wasUp) dispatch({ type: 'condition', who: p.id, condition: 'unconscious', on: true });
    setMessage(
      out?.instantDeath
        ? 'Massive Damage: skaden som er igjen, er minst maks HP. Karakteren dør.'
        : out?.atZero
          ? '0 HP: du er Unconscious og slår death saves i turen din.'
          : `Tok ${n} skade${out && out.absorbed > 0 ? ` (${out.absorbed} gikk til temp HP)` : ''}.`,
    );
  };
  const heal = () => {
    const n = read();
    if (n == null) return;
    sync.update((g) => applyHealing(g, sheet, n));
    dispatch({ type: 'log', who: p.id, text: `${p.name} fikk ${n} HP` });
    if (hp === 0 && p.conditions.includes('unconscious'))
      dispatch({ type: 'condition', who: p.id, condition: 'unconscious', on: false });
    setMessage(`Helbredet ${n} HP.`);
  };
  const temp = () => {
    const n = read();
    if (n == null) return;
    sync.update((g) => setTempHp(g, n));
    setMessage(`Temp HP: ${Math.max(game.tempHp, n)}.`);
  };
  const deathSave = (nat: number) => {
    const holder: { result: string | null } = { result: null };
    sync.update((g) => {
      const r = rollDeathSave(g, sheet, nat);
      holder.result = r.result;
      return r.state;
    });
    const result = holder.result;
    const text: Record<string, string> = {
      success: 'suksess',
      failure: nat === 1 ? 'naturlig 1: to feil' : 'feil',
      revived: 'naturlig 20: 1 HP tilbake!',
      stable: 'tre suksesser: Stable',
      dead: 'tre feil: død',
    };
    dispatch({ type: 'log', who: p.id, text: `Death save: ${nat} → ${text[result ?? ''] ?? '–'}` });
    if (result === 'revived') dispatch({ type: 'condition', who: p.id, condition: 'unconscious', on: false });
  };

  return (
    <section className={`card ${styles.hpCard}`} aria-label={`HP for ${p.name}`}>
      <div className={styles.hpRow}>
        <span className="sc" aria-hidden="true">
          HP
        </span>
        <span className={`${styles.hpNum} tabular`} data-tone={hpTone(hp, sheet.hpMax)} aria-hidden="true">
          {hp}
        </span>
        <span className="dim tabular" aria-hidden="true">
          / {sheet.hpMax}
        </span>
        <span className="visually-hidden" aria-live="polite" aria-atomic="true">
          HP {hp} av {sheet.hpMax}
        </span>
        {game.tempHp > 0 && <span className="tabular">+{game.tempHp} temp</span>}
        <span className="dim">AC {sheet.ac}</span>
      </div>
      <div className={styles.entryRow}>
        <IntField
          label="Antall HP"
          hideLabel
          value={value}
          onChange={setValue}
          error={error}
          placeholder="Antall"
        />
        <div className="btn-row">
          <button type="button" className="btn btn--small" onClick={damage}>
            Tok skade
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={heal}>
            Helbred
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={temp}>
            Temp HP
          </button>
        </div>
      </div>
      {message && <p className="dim">{message}</p>}
      {status !== 'up' && (
        <div className={styles.stack} role="group" aria-label="Death saves">
          <p>
            Death saves: <b className="tabular">{game.deathSaves.successes}</b> suksess ·{' '}
            <b className="tabular">{game.deathSaves.failures}</b> feil
          </p>
          {status === 'dying' && (
            <D20Entry
              label="Death save (d20)"
              bonus={0}
              hint="10 eller mer er suksess. Naturlig 1 gir to feil, naturlig 20 gir 1 HP."
              onResult={deathSave}
            />
          )}
          {status === 'stable' && <Tip tone="good">Stable. Du våkner med 1 HP etter 1d4 timer.</Tip>}
          {status === 'dead' && <Tip tone="warn">Tre feilede death saves: karakteren er død.</Tip>}
        </div>
      )}
    </section>
  );
}

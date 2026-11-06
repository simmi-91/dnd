import {
  CREATURE_TYPE_NAME,
  FAMILIAR_FORMS,
  canDo,
  familiarCreatureType,
  familiarReminders,
  familiarSpeedText,
  familiarStatus,
  familiarTurnOptions,
  isFamiliarForm,
  type Participant,
} from '@dnd/rules';
import { useState } from 'react';
import { sign } from '../../../components/format';
import { useGameContext } from '../GameContext';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { hasCheck } from './helpers';
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
  OtherHp,
} from './TurnParts';
import { stepState } from './steps';
import { Opt, Step, Tip } from './ui';

/**
 * Familiarens tur (F3 i `docs/FAMILIAR.md`): Help øverst som anbefalt, Flyby og lignende som påminnelse,
 * bevegelse med alle typene, og reactions (Lever touch-spell, og Ink Cloud bare for Octopus).
 */
export function FamiliarTurn({ p }: { p: Participant }) {
  const { sync } = useGameContext();
  const { state, dispatch } = useCombatContext();
  const [flow, setFlow] = useState<'help' | 'hide' | null>(null);
  const busy = flow != null || hasCheck(state, p.id);
  const formId = isFamiliarForm(p.refId) ? p.refId : 'owl';
  const form = FAMILIAR_FORMS[formId];
  const f = sync.state.familiar;
  const { actions, reactions } = familiarTurnOptions(formId);
  const reminders = familiarReminders(formId);
  const stealth = form.skills.Stealth ?? 0;
  const status = f ? familiarStatus(f) : 'gone';

  return (
    <div className={styles.stack}>
      <p className="dim">
        {form.name}
        {f && ` · ${CREATURE_TYPE_NAME[familiarCreatureType(f)]}`} · AC{' '}
        <span className="tabular">{form.ac}</span> · Initiativ{' '}
        <span className="tabular">{sign(form.initiative)}</span> ·{' '}
        {form.senses.join(', ') || 'ingen sanser i mørket'}
      </p>
      {status !== 'present' && (
        <Tip tone="warn">
          {status === 'dismissed'
            ? `${p.name} er sendt bort til lomme-dimensjonen. Hent den tilbake på Følgesvenner-siden (Magic action).`
            : `${p.name} har forsvunnet. Den kommer tilbake når du kaster Find Familiar igjen.`}
        </Tip>
      )}
      <OtherHp p={p} />
      <ConcentrationChecks p={p} conBonus={0} />
      <TurnBar p={p} busy={busy} />
      <Effects p={p} />

      {flow === 'help' && <HelpPicker p={p} onClose={() => setFlow(null)} />}
      {flow === 'hide' && <HideCheck p={p} bonus={stealth} onClose={() => setFlow(null)} />}

      <MovementStep p={p} busy={busy} speedText={`Bevegelse: ${familiarSpeedText(form)}.`} />

      <Step n="3" title="Action" tone="action" {...stepState(state, p, 'action')} hint="kan ikke angripe">
        <ActionOptions
          p={p}
          busy={busy}
          list={actions}
          onHelp={() => setFlow('help')}
          onHide={() => setFlow('hide')}
          extra={{
            help:
              reminders.length > 0 ? (
                <Tip tone="good">
                  {reminders.map((r) => (
                    <span key={r.name}>
                      <b>Husk {r.name}:</b> {r.text}{' '}
                    </span>
                  ))}
                  Fly inn, ta Help og fly ut igjen.
                </Tip>
              ) : undefined,
          }}
        />
        <p className="dim">En familiar kan ikke angripe, men kan ta alle andre actions.</p>
      </Step>

      <Step n="R" title="Reaction" tone="reaction" {...stepState(state, p, 'reaction')} hint="én per runde">
        <ReactionHelp />
        {reactions.map((o) => (
          <Opt
            key={o.id}
            title={o.name}
            sub={o.text}
            check={canDo(state, { who: p.id, kind: 'option', option: o }, { busy })}
            onClick={() => dispatch({ type: 'option', who: p.id, option: o })}
          />
        ))}
      </Step>

      {form.traits.length > 0 && (
        <details className={styles.details}>
          <summary>Trekk ({form.traits.map((t) => t.name).join(', ')})</summary>
          <ul className={styles.plain}>
            {form.traits.map((t) => (
              <li key={t.name}>
                <b>{t.name}:</b> {t.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Conditions p={p} />
    </div>
  );
}

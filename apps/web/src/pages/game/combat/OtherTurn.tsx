import { canDo, type AttackWeapon, type Participant } from '@dnd/rules';
import { useState } from 'react';
import { useCombatContext } from './CombatContext';
import styles from './Combat.module.css';
import { KIND_LABEL, OTHER_ACTIONS, hasCheck } from './helpers';
import {
  ActionOptions,
  ConcentrationChecks,
  Conditions,
  TurnBar,
  Effects,
  HelpPicker,
  HideCheck,
  MovementStep,
  OtherHp,
} from './TurnParts';
import { stepState } from './steps';
import { Opt, Step } from './ui';

const GENERIC: AttackWeapon = { key: 'generic', name: 'Angrep', light: false, ranged: false, mastery: null };

/** Følgesvenner, fiender og NPC-er som legges inn for hånd: HP, enkle valg og conditions. */
export function OtherTurn({ p }: { p: Participant }) {
  const { state, dispatch } = useCombatContext();
  const [flow, setFlow] = useState<'help' | 'hide' | null>(null);
  const busy = flow != null || hasCheck(state, p.id);
  return (
    <div className={styles.stack}>
      <p className="dim">
        {KIND_LABEL[p.kind]}
        {p.ac != null && ` · AC ${p.ac}`}
      </p>
      {p.notes && <p className="dim">{p.notes}</p>}
      <OtherHp p={p} />
      <ConcentrationChecks p={p} conBonus={0} />
      <TurnBar p={p} busy={busy} />
      <Effects p={p} />
      {flow === 'help' && <HelpPicker p={p} onClose={() => setFlow(null)} />}
      {flow === 'hide' && <HideCheck p={p} bonus={0} onClose={() => setFlow(null)} />}
      <MovementStep p={p} busy={busy} />
      <Step n="3" title="Action" tone="action" {...stepState(state, p, 'action')}>
        <Opt
          title="Attack"
          sub="Skriv selv inn treff og skade. Appen holder bare rede på action-økonomien."
          check={canDo(state, { who: p.id, kind: 'attack', weapon: GENERIC, attack: 'main' }, { busy })}
          onClick={() => dispatch({ type: 'attack', who: p.id, weapon: GENERIC, attack: 'main' })}
        />
        <ActionOptions
          p={p}
          busy={busy}
          list={OTHER_ACTIONS}
          onHelp={() => setFlow('help')}
          onHide={() => setFlow('hide')}
        />
      </Step>
      <Conditions p={p} />
    </div>
  );
}

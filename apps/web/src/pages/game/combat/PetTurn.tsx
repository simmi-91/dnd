import {
  applyPetTraits,
  canDo,
  petTurnWeapon,
  type AttackKind,
  type Participant,
  type PetAttack,
} from '@dnd/rules';
import { useState } from 'react';
import { sign, speedsText } from '../../../components/format';
import { useGameContext } from '../GameContext';
import { AttackFlow, type AttackSpec } from './AttackFlow';
import styles from './Combat.module.css';
import { useCombatContext } from './CombatContext';
import { OTHER_ACTIONS, hasCheck } from './helpers';
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
import { D20Entry, Opt, Step, Tip } from './ui';

function petSpec(a: PetAttack, attack: AttackKind): AttackSpec {
  return {
    weapon: petTurnWeapon(a),
    attack,
    hit: a.hit,
    damage: { name: a.name, count: a.count, sides: a.sides, mod: a.mod, dmgType: a.dmgType },
    mastery: null,
  };
}

type Flow = { kind: 'attack'; a: PetAttack; attack: AttackKind } | { kind: 'help' } | { kind: 'hide' };

/** Kjæledyrets tur (bjørnene): adlyder den (husregel), Multiattack eller noe annet, og reaction. */
export function PetTurn({ p }: { p: Participant }) {
  const { sheet, sync } = useGameContext();
  const { state, dispatch } = useCombatContext();
  const [flow, setFlow] = useState<Flow | null>(null);
  const busy = flow != null || hasCheck(state, p.id);
  const pet = sheet.pets.find((x) => x.id === p.refId);
  if (!pet) return <Tip tone="warn">Fant ikke {p.name} i arket.</Tip>;
  const ap = applyPetTraits(pet, sync.state.pets[pet.id]?.traits);
  const animalHandling = sheet.skills.find((s) => s.key === 'animal-handling')?.bonus ?? 0;
  const t = p.turn;
  const multi = pet.multiattack;
  const check = (a: PetAttack, attack: AttackKind) =>
    canDo(state, { who: p.id, kind: 'attack', weapon: petTurnWeapon(a), attack }, { busy });
  const stealth = pet.skills.find((s) => s.name === 'Stealth')?.bonus ?? 0;

  return (
    <div className={styles.stack}>
      <p className="dim">
        AC <span className="tabular">{ap.ac}</span> · Initiativ{' '}
        <span className="tabular">{sign(ap.initiative)}</span> · {speedsText(ap.speeds)}
      </p>
      <OtherHp p={p} />
      <ConcentrationChecks p={p} conBonus={0} />

      {t.obey === 'pending' && state.current === p.id && (
        <div className={`card ${styles.flow}`} role="group" aria-label={`Adlyder ${p.name}?`}>
          <b>Adlyder {p.name}?</b>
          <D20Entry
            label="Animal Handling"
            bonus={animalHandling}
            dc={p.limits.obeyDc ?? undefined}
            hint={`${sheet.name.split(' ')[0]} ruller Animal Handling.`}
            onResult={(nat) => dispatch({ type: 'obey', who: p.id, total: nat + animalHandling })}
          />
        </div>
      )}
      {t.obey === 'failed' && (
        <Tip tone="warn">{p.name} adlyder ikke denne runden. DM bestemmer hva den gjør.</Tip>
      )}

      <TurnBar p={p} busy={busy} />
      <Effects p={p} />

      {flow?.kind === 'attack' && (
        <AttackFlow
          who={p.id}
          spec={petSpec(flow.a, flow.attack)}
          maxCrit={ap.flags.maxCrit}
          pb={sheet.pb}
          onClose={() => setFlow(null)}
        />
      )}
      {flow?.kind === 'help' && <HelpPicker p={p} onClose={() => setFlow(null)} />}
      {flow?.kind === 'hide' && <HideCheck p={p} bonus={stealth} onClose={() => setFlow(null)} />}

      <MovementStep p={p} busy={busy} />

      <Step
        n="3"
        title="Action"
        tone="action"
        {...stepState(state, p, 'action')}
        hint={multi ? `Multiattack: ${multi.count} angrep` : 'én per tur'}
      >
        {t.action === 'attack' && t.attacksLeft > 0 && (
          <p>
            <b>
              Angrep {p.limits.attacksPerAction - t.attacksLeft + 1} av {p.limits.attacksPerAction}
            </b>
          </p>
        )}
        {ap.attacks.map((a) => (
          <Opt
            key={a.name}
            title={multi && multi.attack === a.name ? `Multiattack: ${multi.count}× ${a.name}` : a.name}
            sub={`${sign(a.hit)} · ${a.count}d${a.sides}${a.mod ? sign(a.mod) : ''} ${a.dmgType} · ${a.reach}${ap.flags.maxCrit ? ' · maks skade ved krit mot monstrosity' : ''}`}
            check={check(a, 'main')}
            rec={!multi || multi.attack === a.name}
            onClick={() => setFlow({ kind: 'attack', a, attack: 'main' })}
          />
        ))}
        <details className={styles.details}>
          <summary>Noe annet (Dash, Dodge, Help …)</summary>
          <div className={styles.stack}>
            <ActionOptions
              p={p}
              busy={busy}
              list={OTHER_ACTIONS}
              onHelp={() => setFlow({ kind: 'help' })}
              onHide={() => setFlow({ kind: 'hide' })}
            />
          </div>
        </details>
      </Step>

      <Step n="R" title="Reaction" tone="reaction" {...stepState(state, p, 'reaction')}>
        <ReactionHelp />
        {ap.attacks
          .filter((a) => a.melee)
          .map((a) => (
            <Opt
              key={`oa-${a.name}`}
              title={`Opportunity Attack: ${a.name}`}
              sub="Ett nærkampangrep når en fiende går ut av rekkevidden."
              check={check(a, 'opportunity')}
              onClick={() => setFlow({ kind: 'attack', a, attack: 'opportunity' })}
            />
          ))}
      </Step>

      <Conditions p={p} />
    </div>
  );
}

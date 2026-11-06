import elowenRaw from '../../rules/fixtures/elowen-4.json';
import {
  addEnemy,
  combatFromGame,
  deriveCharacter,
  endCombat,
  initialGameState,
  setInitiative,
  startCombat,
  turReducer,
  type CombatEffect,
  type CombatState,
  type Participant,
  type RuleFlag,
  type TurnLimits,
  type TurnState,
} from '@dnd/rules';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  combatEffectSchema,
  combatStateSchema,
  participantSchema,
  putCombatRequestSchema,
  turnLimitsSchema,
  turnStateSchema,
} from './index.ts';

expectTypeOf<z.infer<typeof combatStateSchema>>().toEqualTypeOf<CombatState>();
expectTypeOf<z.infer<typeof participantSchema>>().toEqualTypeOf<Participant>();
expectTypeOf<z.infer<typeof turnLimitsSchema>>().toEqualTypeOf<TurnLimits>();
expectTypeOf<z.infer<typeof turnStateSchema>>().toEqualTypeOf<TurnState>();
expectTypeOf<z.infer<typeof combatEffectSchema>>().toEqualTypeOf<CombatEffect>();
expectTypeOf<z.infer<typeof turnLimitsSchema>['flags'][number]>().toEqualTypeOf<RuleFlag>();

function runningCombat(): CombatState {
  const sheet = deriveCharacter(elowenRaw);
  let state = combatFromGame(sheet, initialGameState(sheet));
  const added = addEnemy(state, { name: 'Goblin', hpMax: 7, ac: 15, initiative: 12 });
  state = added.state;
  state = setInitiative(state, 'char', { roll: 14 });
  for (const p of state.participants) {
    if (p.initiative == null) state = setInitiative(state, p.id, { total: 5 });
  }
  state = startCombat(state);
  return turReducer(turReducer(state, { type: 'action', action: 'dash' }), { type: 'move', feet: 10 });
}

describe('combatStateSchema', () => {
  it('godtar kamptilstand fra regelmotoren, i oppsett og underveis', () => {
    const sheet = deriveCharacter(elowenRaw);
    const setup = combatFromGame(sheet, initialGameState(sheet));
    expect(combatStateSchema.parse(setup)).toEqual(setup);
    const running = runningCombat();
    expect(running.participants.length).toBeGreaterThan(1);
    expect(combatStateSchema.parse(running)).toEqual(running);
  });

  it('avviser ukjente conditions, actions og for lang logg', () => {
    const s = runningCombat();
    const bad = JSON.parse(JSON.stringify(s)) as CombatState;
    (bad.participants[0] as { conditions: string[] }).conditions = ['sleepy'];
    expect(combatStateSchema.safeParse(bad).success).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(s)) as CombatState;
    (bad2.participants[0]!.turn as { action: string | null }).action = 'fly';
    expect(combatStateSchema.safeParse(bad2).success).toBe(false);
    const long = {
      ...s,
      log: Array.from({ length: 201 }, (_, i) => ({ id: i, round: 1, who: null, text: 'x' })),
    };
    expect(combatStateSchema.safeParse(long).success).toBe(false);
    expect(combatStateSchema.safeParse({ ...s, v: 2 }).success).toBe(false);
  });
});

describe('putCombatRequestSchema', () => {
  it('avviser en avsluttet kamp, som må gå via /end', () => {
    const s = runningCombat();
    expect(putCombatRequestSchema.safeParse({ id: 1, state: s, version: 1 }).success).toBe(true);
    expect(putCombatRequestSchema.safeParse({ id: 1, state: endCombat(s), version: 1 }).success).toBe(false);
    expect(putCombatRequestSchema.safeParse({ id: 1, state: s, version: 1, extra: 1 }).success).toBe(false);
  });
});

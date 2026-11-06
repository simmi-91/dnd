import elowenRaw from '../../rules/fixtures/elowen-4.json';
import legoRaw from '../../rules/fixtures/lego-ranger-5.json';
import {
  deriveCharacter,
  initialGameState,
  longRest,
  type Companion,
  type Feature,
  type GameState,
  type PetState,
  type PetTrait,
} from '@dnd/rules';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  companionSchema,
  gameStateSchema,
  petStateSchema,
  petTraitSchema,
  refreshCharacterResponseSchema,
  updateGameRequestSchema,
} from './index.ts';

// Typesjekken (tsc) stopper hvis skjemaene og typene i @dnd/rules glir fra hverandre.
expectTypeOf<z.infer<typeof gameStateSchema>>().toEqualTypeOf<GameState>();
expectTypeOf<z.infer<typeof petStateSchema>>().toEqualTypeOf<PetState>();
expectTypeOf<z.infer<typeof petTraitSchema>>().toEqualTypeOf<PetTrait>();
expectTypeOf<z.infer<typeof companionSchema>>().toEqualTypeOf<Companion>();
expectTypeOf<
  z.infer<typeof refreshCharacterResponseSchema>['newFeatures'][number]
>().toEqualTypeOf<Feature>();

const fixtures: Record<string, unknown> = { 'elowen-4': elowenRaw, 'lego-ranger-5': legoRaw };
const fixture = (name: string): unknown => fixtures[name];

describe('gameStateSchema', () => {
  it('godtar tilstand fra regelmotoren', () => {
    for (const name of ['elowen-4', 'lego-ranger-5']) {
      const sheet = deriveCharacter(fixture(name));
      const state = initialGameState(sheet);
      expect(gameStateSchema.parse(state)).toEqual(state);
      expect(gameStateSchema.parse(longRest(state, sheet))).toBeDefined();
    }
  });

  it('godtar følgesvenner med og uten HP', () => {
    const state: GameState = {
      ...initialGameState(deriveCharacter(fixture('elowen-4'))),
      companions: [
        { id: 'c1', name: 'Ugle', initiativeBonus: 3, hpMax: 1, hpRemoved: 0, ac: 11, kind: 'Owl' },
        { id: 'c2', name: 'Uten', initiativeBonus: 0 },
      ],
    };
    expect(gameStateSchema.safeParse(state).success).toBe(true);
  });

  it('familiar er valgfri, og formen må være kjent', () => {
    const base = initialGameState(deriveCharacter(fixture('elowen-4')));
    const familiar = { form: 'owl' as const, name: 'Ugla', hpRemoved: 0, present: true };
    expect(gameStateSchema.safeParse(base).success).toBe(true);
    expect(gameStateSchema.safeParse({ ...base, familiar }).success).toBe(true);
    expect(gameStateSchema.safeParse({ ...base, familiar: { ...familiar, form: 'dragon' } }).success).toBe(
      false,
    );
    expect(gameStateSchema.safeParse({ ...base, familiar: { ...familiar, hpRemoved: -1 } }).success).toBe(
      false,
    );
  });

  it('avviser negative tall, ukjente trekk og manglende felt', () => {
    const ok = initialGameState(deriveCharacter(fixture('elowen-4')));
    expect(gameStateSchema.safeParse({ ...ok, hpRemoved: -1 }).success).toBe(false);
    expect(gameStateSchema.safeParse({ ...ok, resources: { a: 1.5 } }).success).toBe(false);
    expect(gameStateSchema.safeParse({ ...ok, deathSaves: { successes: 4, failures: 0 } }).success).toBe(
      false,
    );
    expect(
      gameStateSchema.safeParse({
        ...ok,
        pets: { p: { traits: [{ id: 't', kind: 'fly', delta: 1 }], hpRemoved: 0, inCombat: true } },
      }).success,
    ).toBe(false);
    const missing: Partial<GameState> = { ...ok };
    delete missing.conditions;
    expect(gameStateSchema.safeParse(missing).success).toBe(false);
  });
});

describe('updateGameRequestSchema', () => {
  it('krever minst ett felt', () => {
    expect(updateGameRequestSchema.safeParse({}).success).toBe(false);
    expect(updateGameRequestSchema.safeParse({ status: 'archived' }).success).toBe(true);
    expect(updateGameRequestSchema.safeParse({ status: 'slettet' }).success).toBe(false);
  });
});

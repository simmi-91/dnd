export const RULES_VERSION = 1;

export { DDB_FORMAT_MESSAGE, DdbFormatError, unwrapDdb } from './ddb/types.ts';
export type { DdbCharacter } from './ddb/types.ts';
export { ABILITIES, DERIVE_VERSION } from './sheet.ts';
export type {
  Ability,
  AbilityMap,
  Feature,
  HitDice,
  Pet,
  PetAttack,
  ResetType,
  Resource,
  Save,
  Sheet,
  SheetClass,
  Skill,
  SlotMap,
  Spell,
  Weapon,
} from './sheet.ts';
export { deriveCharacter, MASTERY_TEXT } from './derive.ts';
export { MULTICLASS_SLOTS, casterLevel, pactSlots, spellSlots } from './slots.ts';
export type { CasterClass } from './slots.ts';
export { applyPetTraits, seedPetTraits } from './pets.ts';
export type { AppliedPet, PetTrait, PetTraitKind } from './pets.ts';
export { companionInitiativeBonus } from './companions.ts';
export type { Companion } from './companions.ts';
export { initialGameState, mergeOnRefresh, newFeatures } from './import.ts';
export type { GameState, MergeOptions, PetState } from './import.ts';
export { modOf } from './util.ts';

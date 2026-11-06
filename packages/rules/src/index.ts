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
export {
  applyDamage,
  applyHealing,
  concentrationDc,
  currentHp,
  damageCompanion,
  deathStatus,
  rollDeathSave,
  damagePet,
  healCompanion,
  healPet,
  hitDiceHealing,
  hitDiceLeft,
  longRest,
  petHpMax,
  restoreResource,
  restoreSlot,
  setTempHp,
  shortRest,
  slotMax,
  spendResource,
  spendSlot,
} from './state.ts';
export type { DamageResult, DeathStatus, ShortRestInput, SlotKey } from './state.ts';
export { modOf } from './util.ts';
export { ACTIONS, ACTION_IDS, COST_LABEL, HIDE_DC, actionDef } from './actions.ts';
export type { ActionDef, ActionId, Cost } from './actions.ts';
export {
  CONDITIONS,
  CONDITION_DEFS,
  conditionWith,
  exhaustionPenalty,
  expandConditions,
  isConditionId,
} from './conditions.ts';
export type { ConditionDef, ConditionEffects, ConditionId } from './conditions.ts';
export {
  RULES,
  activeRules,
  castCost,
  castsLeft,
  darknessAdvantage,
  extraDamageOptions,
  firstTurnSpeed,
  masteryOf,
  payCast,
  payExtraDamage,
  resourceContext,
  resourceLeft,
  ruleDef,
  ruleFlags,
  turnOptions,
} from './features.ts';
export type {
  AttackKind,
  CastCost,
  ExtraDamageDef,
  MasteryId,
  OptionDef,
  RuleDef,
  RuleEffect,
  RuleFlag,
  ResourceContext,
  RuleSource,
  TurnOptions,
} from './features.ts';
export {
  NO_ABILITY_MOD,
  ROLL_HINT,
  attackOutcome,
  damageGroups,
  damageTotal,
  masteryNote,
  maxRolls,
  offhandMod,
  rollMode,
  validateRoll,
} from './attack.ts';
export type { AttackOutcome, DamageGroup, DamagePart, DamageSource, RollMode } from './attack.ts';
export {
  CHARACTER_ID,
  COMBAT_VERSION,
  LOG_MAX,
  addEnemy,
  addLog,
  addParticipant,
  characterParticipant,
  combatFromGame,
  companionParticipant,
  familiarParticipant,
  FAMILIAR_ID,
  conditionsToGame,
  createCombat,
  endCombat,
  endTurn,
  freshTurn,
  initiativeOrder,
  nextRound,
  participant,
  petParticipant,
  removeParticipant,
  roundComplete,
  selectTurn,
  setInitiative,
  shortName,
  startCombat,
  updateParticipant,
} from './combat.ts';
export type {
  CombatEffect,
  CombatFromGameOptions,
  CombatState,
  EffectEnd,
  EffectKind,
  EnemyInput,
  LogEntry,
  Participant,
  ParticipantKind,
  PendingCheck,
  TurnLimits,
  TurnState,
} from './combat.ts';
export {
  REASONS,
  attackRoll,
  canDo,
  concentratingOn,
  damageFamiliarInCombat,
  effectiveSpeed,
  movementLeft,
  petTurnWeapon,
  turReducer,
  turnWeapon,
} from './turn.ts';
export type {
  AttackRoll,
  AttackRollInput,
  AttackWeapon,
  CanDo,
  TurnContext,
  TurnEvent,
  TurnOption,
} from './turn.ts';
export {
  DELIVER_TOUCH,
  FAMILIAR_FORMS,
  FAMILIAR_FORM_IDS,
  FAMILIAR_NO_ATTACK,
  FIND_FAMILIAR,
  changeFamiliarForm,
  damageFamiliar,
  familiarHp,
  familiarHpMax,
  familiarTurnOptions,
  healFamiliar,
  isFamiliarForm,
  setFamiliarPresent,
  summonFamiliar,
} from './familiar.ts';
export type { FamiliarForm, FamiliarFormId, FamiliarSpeeds, FamiliarState } from './familiar.ts';

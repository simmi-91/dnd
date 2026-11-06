import {
  ACTIONS,
  CHARACTER_ID,
  canDo,
  currentHp,
  familiarHp,
  familiarHpMax,
  petHpMax,
  resourceContext,
  type CanDo,
  type CombatState,
  type GameState,
  type Participant,
  type ParticipantKind,
  type ResourceContext,
  type Sheet,
  type TurnOption,
} from '@dnd/rules';

export const KIND_LABEL: Readonly<Record<ParticipantKind, string>> = {
  character: 'Karakter',
  pet: 'Kjæledyr',
  familiar: 'Familiar',
  companion: 'Følgesvenn',
  enemy: 'Fiende',
  npc: 'NPC',
};

export function isFoe(p: Participant): boolean {
  return p.kind === 'enemy';
}

/** Fiender som kan være mål. Uten fiender i kampen er listen tom, og mål er valgfrie. */
export function targets(state: CombatState): Participant[] {
  return state.participants.filter((p) => isFoe(p) && !p.defeated);
}

/** Allierte som kan få Help: alle unntatt den som hjelper og fiender. */
export function allies(state: CombatState, self: string): Participant[] {
  return state.participants.filter((p) => p.id !== self && !isFoe(p) && !p.defeated);
}

/** HP for en deltaker, fra spilltilstanden eller kampen. Null når den ikke er kjent. */
export function participantHp(
  p: Participant,
  game: GameState,
  sheet: Sheet,
): { hp: number; max: number } | null {
  switch (p.kind) {
    case 'character':
      return { hp: currentHp(game, sheet), max: sheet.hpMax };
    case 'pet': {
      const max = p.refId ? petHpMax(game, sheet, p.refId) : null;
      if (max == null || !p.refId) return null;
      return { hp: Math.max(0, max - (game.pets[p.refId]?.hpRemoved ?? 0)), max };
    }
    case 'familiar':
      return game.familiar ? { hp: familiarHp(game.familiar), max: familiarHpMax(game.familiar) } : null;
    case 'companion': {
      const c = game.companions.find((x) => x.id === p.refId);
      if (!c?.hpMax) return null;
      return { hp: Math.max(0, c.hpMax - (c.hpRemoved ?? 0)), max: c.hpMax };
    }
    default:
      return p.hp ? { hp: Math.max(0, p.hp.max - p.hp.removed), max: p.hp.max } : null;
  }
}

/** `canDo` for en deltaker, med ressursene til karakteren (bare karakteren har slots og evner). */
export function checker(
  state: CombatState,
  who: string,
  busy: boolean,
  resources?: ResourceContext,
): (option: TurnOption) => CanDo {
  return (option) => canDo(state, { ...option, who }, { busy, resources });
}

export function characterResources(game: GameState, sheet: Sheet): ResourceContext {
  return resourceContext(game, sheet);
}

export function nameOf(state: CombatState, id: string | null | undefined): string {
  return state.participants.find((p) => p.id === id)?.name ?? '';
}

export { CHARACTER_ID };

/** Alle actions unntatt Attack, uten anbefaling. */
export const OTHER_ACTIONS = ACTIONS.filter((a) => a.id !== 'attack').map((a) => ({
  action: a,
  recommended: false,
}));

/** En konsentrasjonssjekk venter på deltakeren. Da er alt annet grått til den er besvart. */
export function hasCheck(state: CombatState, id: string): boolean {
  return state.checks.some((c) => c.who === id);
}

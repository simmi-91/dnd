import { movementLeft, type CombatState, type Participant } from '@dnd/rules';
import { useEffect, useRef } from 'react';

// Stegene i turen (1 Bevegelse, 2 Bonus action, 3 Action, R Reaction): hva som er ledig, om steget er
// åpent, og hvordan siden går til et steg eller en boks.

export type StepTone = 'move' | 'bonus' | 'action' | 'reaction';

/** Hva som er ledig i turen. Brukes også til å lukke steg der ingenting kan velges. */
export function turnLeft(state: CombatState, p: Participant) {
  const t = p.turn;
  const mine = state.current === p.id && !p.defeated;
  return {
    move: mine && movementLeft(state, p.id) > 0,
    bonus: mine && t.bonus == null,
    action: mine && (t.action == null || (t.action === 'attack' && t.attacksLeft > 0)),
    reaction: !p.defeated && t.reaction == null,
  };
}

const USED_TEXT: Record<StepTone, string> = {
  move: 'Ingen bevegelse igjen',
  bonus: 'Bonus action er brukt',
  action: 'Action er brukt',
  reaction: 'Reaction er brukt. Du får den igjen når turen din starter.',
};

/** Props til et steg: åpent når noe kan velges, ellers lukket med grunnen. */
export function stepState(
  state: CombatState,
  p: Participant,
  step: StepTone,
): { open: boolean; closedText: string } {
  const open = turnLeft(state, p)[step];
  const closedText = p.defeated
    ? 'Ute av kampen'
    : step !== 'reaction' && state.current !== p.id
      ? 'Ikke turen ennå'
      : USED_TEXT[step];
  return { open, closedText };
}

/** Åpner steget (`data-step`) i panelet rundt `from` og scroller til det. */
export function goToStep(from: Element, step: StepTone): void {
  const el = from.closest('[data-panel]')?.querySelector(`[data-step="${step}"]`);
  const details = el?.querySelector('details');
  if (details) details.open = true;
  el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

/** Scroller til elementet når det dukker opp, f.eks. boksen for et angrep eller Help. */
export function useScrollIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  return ref;
}

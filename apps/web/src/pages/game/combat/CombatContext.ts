import type { CombatState, TurnEvent } from '@dnd/rules';
import { createContext, useContext } from 'react';

/** Kampen som vises: tilstanden og måten å endre den på. Testene gir en enkel variant i minnet. */
export interface CombatContextValue {
  state: CombatState;
  /** Kjører en hendelse gjennom `turReducer` og lagrer. */
  dispatch: (event: TurnEvent) => void;
  /** Endrer kampen med en ren funksjon (oppsett: initiativ, fiender). */
  update: (fn: (s: CombatState) => CombatState) => void;
  /** Kampen avsluttes. Alt er låst så lenge. */
  locked: boolean;
  /** Angrer siste valg (kamp og spilltilstand), eller null når det ikke er noe å angre. */
  undo: (() => void) | null;
}

export const CombatContext = createContext<CombatContextValue | null>(null);

export function useCombatContext(): CombatContextValue {
  const ctx = useContext(CombatContext);
  if (!ctx) throw new Error('useCombatContext må brukes inne i kampskjermen');
  return ctx;
}

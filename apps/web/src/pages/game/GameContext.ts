import type { Sheet } from '@dnd/rules';
import type { Game } from '@dnd/shared';
import { createContext, useContext } from 'react';
import type { GameStateHook } from '../../state/useGameState';

export interface GameContextValue {
  game: Game;
  sheet: Sheet;
  sync: GameStateHook;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext må brukes inne i GameLayout');
  return ctx;
}

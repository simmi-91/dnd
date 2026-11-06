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

/** Spillet alene, for rutene som ikke trenger karakteren (kampanjeboka). */
export const GameBaseContext = createContext<Game | null>(null);

export function useGameBase(): Game {
  const game = useContext(GameBaseContext);
  if (!game) throw new Error('useGameBase må brukes inne i GameLayout');
  return game;
}

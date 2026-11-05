import type { GameCover } from '@dnd/shared';

export const COVER_LABELS: Record<GameCover, string> = {
  pergament: 'Pergament',
  frost: 'Frost',
  lego: 'Lego',
  skog: 'Skog',
  ild: 'Ild',
  natt: 'Natt',
};

/** Fargen ligger i `--cover-*` i global.css. */
export function coverStyle(cover: GameCover) {
  return { background: `var(--cover-${cover})` };
}

import { createContext, useContext } from 'react';

/** Teksten i infopanelet: tittel og forklaring (avsnitt skilt med `\n`). */
export interface InfoContent {
  title: string;
  text: string;
}

/** Åpner infopanelet (under deltakerlisten på laptop, skuff nederst på mobil). */
export const InfoContext = createContext<((info: InfoContent) => void) | null>(null);

export function useShowInfo(): ((info: InfoContent) => void) | null {
  return useContext(InfoContext);
}

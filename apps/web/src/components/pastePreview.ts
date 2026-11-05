import { deriveCharacter } from '@dnd/rules';
import type { CharacterSummary } from '@dnd/shared';

/** Samme grense som serveren har på innliming (2 MB). */
export const MAX_PASTE = 2 * 1024 * 1024;

export type PastePreview = { ok: true; character: CharacterSummary } | { ok: false; error: string };

/**
 * Forhåndsvisning av limt inn JSON fra D&D Beyond, regnet ut i nettleseren med `deriveCharacter`.
 * Serveren regner ut arket på nytt når spillet lagres. Meldingene er de samme som serveren gir.
 */
export function previewPastedJson(text: string): PastePreview {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Lim inn JSON-svaret fra D&D Beyond først.' };
  if (trimmed.length > MAX_PASTE) return { ok: false, error: 'Teksten er for stor (over 2 MB).' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'Teksten er ikke gyldig JSON. Lim inn hele svaret fra D&D Beyond.' };
  }
  try {
    const s = deriveCharacter(raw);
    return {
      ok: true,
      character: { name: s.name, summary: s.summary, level: s.level, hpMax: s.hpMax, ac: s.ac },
    };
  } catch {
    return {
      ok: false,
      error: 'Teksten ser ikke ut som en D&D Beyond-karakter. Kopier hele svaret fra adressen.',
    };
  }
}

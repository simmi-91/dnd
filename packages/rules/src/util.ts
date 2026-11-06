export function sum(values: readonly (number | null | undefined)[]): number {
  let s = 0;
  for (const v of values) s += v ?? 0;
  return s;
}

/** Retter typografiske apostrofer (D&D Beyond blander ’ og ') og fjerner mellomrom i endene. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .replace(/[’‘]/g, "'")
    .trim();
}

export function strip(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Som `strip`, men avsnitt og linjeskift blir til `\n`, så lengre tekster (spells) kan vises med avsnitt. */
export function stripParagraphs(html: unknown): string {
  return String(html ?? '')
    .split(/<\/p>|<br\s*\/?>|\r?\n/i)
    .map((part) => strip(part))
    .filter(Boolean)
    .join('\n');
}

export function modOf(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** «Hunter’s Mark» → «hunters-mark». */
export function slug(s: unknown): string {
  return norm(s)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Lager ID-er med en teller: `t1`, `t2`, … */
export function counterIds(prefix = 't'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

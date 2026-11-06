import {
  formatMention,
  KIND_TRIGGER,
  MENTION_LABEL_MAX,
  parseMentions,
  TRIGGER_KIND,
  type MentionKind,
  type MentionRef,
  type MentionTrigger,
} from '@dnd/shared';

// Modellen bak `MentionEditor`. Skriveflaten viser en visningstekst der hver kobling står som
// tegnet og teksten (`@Brann Holt`), og holder en liste over koblingene med posisjon i den. Den
// lagres som `@[Brann Holt](e:42)` (se `mentions.ts`). Endres teksten inni en kobling, blir den
// vanlig tekst. Ren kode, så den kan testes uten nettleser.

export interface MentionRange {
  /** Posisjonen til tegnet (`@`, `#` eller `!`) i visningsteksten. */
  start: number;
  /** Rett etter siste tegn i teksten til koblingen. */
  end: number;
  kind: MentionKind;
  ref: MentionRef;
}

export interface EditorDoc {
  /** Teksten slik den vises i feltet. */
  text: string;
  /** Koblingene, sortert etter posisjon, uten overlapp. */
  mentions: MentionRange[];
}

/** Lagringsformatet → visningstekst og koblinger. */
export function fromStorage(stored: string): EditorDoc {
  let text = '';
  const mentions: MentionRange[] = [];
  for (const s of parseMentions(stored)) {
    if (s.type === 'text') {
      text += s.text;
      continue;
    }
    const start = text.length;
    text += KIND_TRIGGER[s.kind] + s.label;
    mentions.push({ start, end: text.length, kind: s.kind, ref: s.ref });
  }
  return { text, mentions };
}

/** Visningstekst og koblinger → lagringsformatet. En kobling uten gyldig tekst blir vanlig tekst. */
export function toStorage(doc: EditorDoc): string {
  let out = '';
  let last = 0;
  for (const m of doc.mentions) {
    const label = doc.text.slice(m.start + 1, m.end);
    let formatted: string;
    try {
      formatted = formatMention(m.kind, label, m.ref);
    } catch {
      continue;
    }
    out += doc.text.slice(last, m.start) + formatted;
    last = m.end;
  }
  return out + doc.text.slice(last);
}

/**
 * Bytter `text.slice(from, to)` med `insert`. Koblinger som overlapper området (eller der det
 * settes inn tekst inni dem) blir vanlig tekst. Tekst rett før eller etter en kobling er utenfor.
 */
export function replaceRange(doc: EditorDoc, from: number, to: number, insert: string): EditorDoc {
  const delta = insert.length - (to - from);
  const mentions: MentionRange[] = [];
  for (const m of doc.mentions) {
    if (m.end <= from) {
      mentions.push(m);
      continue;
    }
    if (m.start >= to) {
      mentions.push(delta === 0 ? m : { ...m, start: m.start + delta, end: m.end + delta });
      continue;
    }
    // Overlapper eller får tekst inni seg: blir vanlig tekst.
  }
  return { text: doc.text.slice(0, from) + insert + doc.text.slice(to), mentions };
}

/**
 * Tar inn en ny verdi fra feltet. Finner det som er endret (felles start og slutt), og bruker
 * markøren etter endringen til å velge riktig sted når teksten rundt er lik (f.eks. «Anna» + «a»).
 */
export function applyTextChange(doc: EditorDoc, next: string, caret?: number): EditorDoc {
  const prev = doc.text;
  if (prev === next) return doc;
  const min = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < min && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  if (caret != null) {
    // Ny tekst slutter ved markøren, så endringen starter senest der (minus det som kom til).
    const cap = caret - Math.max(0, next.length - prev.length);
    if (cap >= 0 && cap < prefix) prefix = cap;
  }
  let suffix = 0;
  const maxSuffix = min - prefix;
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return replaceRange(doc, prefix, prev.length - suffix, next.slice(prefix, next.length - suffix));
}

export interface ActiveTrigger {
  /** Posisjonen til tegnet. */
  index: number;
  kind: MentionKind;
  trigger: MentionTrigger;
  /** Teksten mellom tegnet og markøren. */
  query: string;
}

const MAX_QUERY = 60;
const MAX_WORDS = 5;
const BEFORE_TRIGGER = /[\s([{«"'„“‘–—-]/;

function isTrigger(ch: string | undefined): ch is MentionTrigger {
  return ch === '@' || ch === '#' || ch === '!';
}

/**
 * Tegnet som autofullføringen gjelder, når markøren står etter `@`, `#` eller `!` i vanlig tekst.
 * Tegnet må stå først eller etter mellomrom eller en åpnende parentes, så «Hei!» og e-post ikke
 * åpner den. Søket kan ha mellomrom (navn), men ikke starte med det, og ikke gå over linjeskift.
 */
export function findTrigger(doc: EditorDoc, caret: number): ActiveTrigger | null {
  const { text, mentions } = doc;
  const inMention = (i: number) => mentions.some((m) => i >= m.start && i < m.end);
  const stop = Math.max(0, caret - MAX_QUERY - 1);
  for (let i = caret - 1; i >= stop; i -= 1) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r' || inMention(i)) return null;
    if (!isTrigger(ch)) continue;
    if (i > 0 && !BEFORE_TRIGGER.test(text[i - 1] ?? '')) continue;
    const query = text.slice(i + 1, caret);
    if (/^\s/.test(query)) return null;
    if (query.trim().split(/\s+/).length > MAX_WORDS) return null;
    return { index: i, kind: TRIGGER_KIND[ch], trigger: ch, query };
  }
  return null;
}

/**
 * Bytter `@søk` (fra `trigger.index` til `caret`) med en kobling, og setter inn et mellomrom etter
 * når teksten slutter der eller neste tegn er en bokstav eller et tall. Gir det nye dokumentet og
 * markøren etter koblingen.
 */
export function insertMention(
  doc: EditorDoc,
  trigger: Pick<ActiveTrigger, 'index' | 'kind'>,
  caret: number,
  label: string,
  ref: MentionRef,
): { doc: EditorDoc; caret: number } {
  const clean = label.replace(/[\r\n]+/g, ' ').slice(0, MENTION_LABEL_MAX);
  const shown = KIND_TRIGGER[trigger.kind] + clean;
  const next = doc.text[caret];
  const space = next === undefined || /[\p{L}\p{N}]/u.test(next) ? ' ' : '';
  const replaced = replaceRange(doc, trigger.index, caret, shown + space);
  const mention: MentionRange = {
    start: trigger.index,
    end: trigger.index + shown.length,
    kind: trigger.kind,
    ref,
  };
  const mentions = [...replaced.mentions, mention].sort((a, b) => a.start - b.start);
  return { doc: { text: replaced.text, mentions }, caret: mention.end + space.length };
}

/** Setter inn tegnet ved markøren (eller over et valg), med mellomrom foran om det trengs. */
export function insertTrigger(
  doc: EditorDoc,
  from: number,
  to: number,
  trigger: MentionTrigger,
): { doc: EditorDoc; caret: number } {
  const before = doc.text[from - 1];
  const insert = (before === undefined || BEFORE_TRIGGER.test(before) ? '' : ' ') + trigger;
  return { doc: replaceRange(doc, from, to, insert), caret: from + insert.length };
}

/** Teksten delt i biter for fargelaget: vanlig tekst og koblinger. */
export type DocPiece = { text: string } | { text: string; mention: MentionRange };

export function docPieces(doc: EditorDoc): DocPiece[] {
  const pieces: DocPiece[] = [];
  let last = 0;
  for (const m of doc.mentions) {
    if (m.start > last) pieces.push({ text: doc.text.slice(last, m.start) });
    pieces.push({ text: doc.text.slice(m.start, m.end), mention: m });
    last = m.end;
  }
  if (last < doc.text.length) pieces.push({ text: doc.text.slice(last) });
  return pieces;
}

// Koblinger i fritekst (fase 4). Lagringsformatet er `@[tekst](e:42)` for en person, `#[tekst](e:7)`
// for et sted og `![tekst](e:9)` for en quest. `(new)` i stedet for `(e:ID)` er en oppføring som
// skal opprettes ved lagring. I teksten escapes `\` og `]` med `\`. Alt annet er vanlig tekst, og
// ingenting tolkes som Markdown. Ren kode uten avhengigheter, så web og server bruker den samme.

export const MENTION_KINDS = ['person', 'place', 'quest'] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export const KIND_TRIGGER = { person: '@', place: '#', quest: '!' } as const satisfies Record<
  MentionKind,
  string
>;
export type MentionTrigger = (typeof KIND_TRIGGER)[MentionKind];

export const TRIGGER_KIND: Readonly<Record<MentionTrigger, MentionKind>> = {
  '@': 'person',
  '#': 'place',
  '!': 'quest',
};

/** Høyeste ID i en kobling (INT UNSIGNED i databasen). */
export const MAX_ENTRY_ID = 4_294_967_295;

export type MentionRef = { id: number } | { new: true };

export interface TextSegment {
  type: 'text';
  text: string;
}

export interface MentionSegment {
  type: 'mention';
  kind: MentionKind;
  /** Teksten slik den ble skrevet, uten escaping. */
  label: string;
  ref: MentionRef;
  /** Posisjonen i den lagrede teksten: `text.slice(start, end)` er hele koblingen. */
  start: number;
  end: number;
}

export type Segment = TextSegment | MentionSegment;

/**
 * Høyst så mange tegn i teksten til en kobling (etter escaping er fjernet), lik høyeste lengde
 * på navnet til en oppføring. En lengre kobling er vanlig tekst. Grensen holder også tolkeren
 * lineær: hvert forsøk på en kobling leser høyst ca. 2 × grensen tegn.
 */
export const MENTION_LABEL_MAX = 200;

const REF = /e:([1-9][0-9]{0,9})\)|new\)/y;
const ESCAPED = /\\([\\\]])/g;
const BACKSLASH = 92;
const CLOSE = 93;
const LF = 10;
const CR = 13;

function isTrigger(ch: string | undefined): ch is MentionTrigger {
  return ch === '@' || ch === '#' || ch === '!';
}

/** Tolker en kobling som starter ved `start`. Gir `undefined` hvis det ikke er en gyldig kobling. */
function parseAt(text: string, start: number): MentionSegment | undefined {
  const trigger = text[start];
  if (!isTrigger(trigger) || text[start + 1] !== '[') return undefined;
  let length = 0;
  let escaped = false;
  let i = start + 2;
  for (;;) {
    const c = text.charCodeAt(i);
    if (Number.isNaN(c) || c === LF || c === CR) return undefined;
    if (c === CLOSE) break;
    if (c === BACKSLASH) {
      const next = text.charCodeAt(i + 1);
      if (next === BACKSLASH || next === CLOSE) {
        escaped = true;
        i += 1;
      }
    }
    i += 1;
    length += 1;
    if (length > MENTION_LABEL_MAX) return undefined;
  }
  const raw = text.slice(start + 2, i);
  const label = escaped ? raw.replace(ESCAPED, '$1') : raw;
  if (label.trim() === '' || text[i + 1] !== '(') return undefined;
  REF.lastIndex = i + 2;
  const match = REF.exec(text);
  if (!match) return undefined;
  let ref: MentionRef;
  if (match[1] === undefined) {
    ref = { new: true };
  } else {
    const id = Number(match[1]);
    if (id > MAX_ENTRY_ID) return undefined;
    ref = { id };
  }
  return { type: 'mention', kind: TRIGGER_KIND[trigger], label, ref, start, end: REF.lastIndex };
}

/** Deler teksten i vanlig tekst og koblinger. Ugyldige eller halve koblinger er vanlig tekst. */
export function parseMentions(text: string): Segment[] {
  const segments: Segment[] = [];
  let textStart = 0;
  let i = 0;
  while (i < text.length) {
    const mention = isTrigger(text[i]) ? parseAt(text, i) : undefined;
    if (!mention) {
      i += 1;
      continue;
    }
    if (i > textStart) segments.push({ type: 'text', text: text.slice(textStart, i) });
    segments.push(mention);
    i = mention.end;
    textStart = i;
  }
  if (textStart < text.length) segments.push({ type: 'text', text: text.slice(textStart) });
  return segments;
}

/** Bare koblingene i teksten. */
export function parseMentionList(text: string): MentionSegment[] {
  return parseMentions(text).filter((s): s is MentionSegment => s.type === 'mention');
}

/** Escaper `\` og `]` med `\`. Linjeskift blir mellomrom, siden en kobling er én linje. */
export function escapeMentionLabel(label: string): string {
  return label.replace(/[\r\n]+/g, ' ').replace(/[\\\]]/g, (ch) => `\\${ch}`);
}

/**
 * Lager en kobling i lagringsformatet. Kaster `RangeError` ved tom tekst, tekst over
 * `MENTION_LABEL_MAX` tegn eller ugyldig ID. Teksten kuttes ikke, siden et kuttet navn ville
 * peke på en annen oppføring enn den brukeren valgte.
 */
export function formatMention(kind: MentionKind, label: string, ref: MentionRef): string {
  const oneLine = label.replace(/[\r\n]+/g, ' ');
  if (oneLine.trim() === '') throw new RangeError('En kobling må ha tekst');
  if (oneLine.length > MENTION_LABEL_MAX) {
    throw new RangeError(`Teksten i en kobling kan ha høyst ${MENTION_LABEL_MAX} tegn`);
  }
  let target: string;
  if ('id' in ref) {
    if (!Number.isInteger(ref.id) || ref.id < 1 || ref.id > MAX_ENTRY_ID) {
      throw new RangeError(`Ugyldig ID i kobling: ${ref.id}`);
    }
    target = `e:${ref.id}`;
  } else {
    target = 'new';
  }
  return `${KIND_TRIGGER[kind]}[${escapeMentionLabel(oneLine)}](${target})`;
}

/** Unike ID-er som teksten kobler til, i rekkefølgen de først står. */
export function mentionedEntryIds(text: string): number[] {
  const ids = new Set<number>();
  for (const m of parseMentionList(text)) if ('id' in m.ref) ids.add(m.ref.id);
  return [...ids];
}

/**
 * Nøkkelen to `(new)`-koblinger slås sammen på: typen og teksten uten mellomrom i endene og
 * uten hensyn til store og små bokstaver. Serveren bruker den samme i `resolve`.
 */
export function mentionKey(kind: MentionKind, label: string): string {
  return `${kind}\u0000${label.trim().toLocaleLowerCase('nb')}`;
}

/**
 * Koblinger med `(new)`, én per `mentionKey`, i rekkefølgen de først står. `label` er den
 * første skrivemåten, uten mellomrom i endene.
 */
export function newMentions(text: string): { kind: MentionKind; label: string }[] {
  const seen = new Set<string>();
  const result: { kind: MentionKind; label: string }[] = [];
  for (const m of parseMentionList(text)) {
    if ('id' in m.ref) continue;
    const key = mentionKey(m.kind, m.label);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ kind: m.kind, label: m.label.trim() });
  }
  return result;
}

/**
 * Bytter hver kobling med det `fn` gir, og lar resten av teksten stå. Serveren bruker den til å
 * rette prefikset til den faktiske typen, og til å gjøre koblinger til ukjente ID-er om til tekst.
 */
export function mapMentions(text: string, fn: (mention: MentionSegment) => string): string {
  let out = '';
  let last = 0;
  for (const m of parseMentionList(text)) {
    out += text.slice(last, m.start) + fn(m);
    last = m.end;
  }
  return out + text.slice(last);
}

/**
 * Bytter hver `(new)` med `(e:ID)` fra `resolve`. Resten av teksten, også koblinger med ID,
 * står uendret. `resolve` får teksten slik den står i koblingen; slå opp med `mentionKey`.
 */
export function replaceNewMentions(
  text: string,
  resolve: (kind: MentionKind, label: string) => number,
): string {
  return mapMentions(text, (m) =>
    'id' in m.ref
      ? text.slice(m.start, m.end)
      : formatMention(m.kind, m.label, { id: resolve(m.kind, m.label) }),
  );
}

/** Lesbar tekst der hver kobling er byttet med teksten sin, f.eks. til utdrag. */
export function stripMentions(text: string): string {
  return parseMentions(text)
    .map((s) => (s.type === 'text' ? s.text : s.label))
    .join('');
}

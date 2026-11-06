import { describe, expect, it } from 'vitest';
import {
  formatMention,
  mapMentions,
  MENTION_LABEL_MAX,
  mentionKey,
  KIND_TRIGGER,
  MAX_ENTRY_ID,
  mentionedEntryIds,
  MENTION_KINDS,
  newMentions,
  parseMentions,
  replaceNewMentions,
  stripMentions,
  TRIGGER_KIND,
  type MentionKind,
  type MentionRef,
  type Segment,
} from './index.ts';

const text = (t: string): Segment => ({ type: 'text', text: t });

describe('TRIGGER_KIND og KIND_TRIGGER', () => {
  it('er hverandres motsatte', () => {
    expect(TRIGGER_KIND).toEqual({ '@': 'person', '#': 'place', '!': 'quest' });
    for (const kind of MENTION_KINDS) expect(TRIGGER_KIND[KIND_TRIGGER[kind]]).toBe(kind);
  });
});

describe('parseMentions', () => {
  it('gir tom liste for tom tekst og bare tekst uten koblinger', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('Vi gikk nordover.')).toEqual([text('Vi gikk nordover.')]);
  });

  it('tolker de tre typene med posisjoner', () => {
    const s = 'Møtte @[Brann Holt](e:42) i #[Eldmark](e:7): ![finne karavanen](new).';
    expect(parseMentions(s)).toEqual([
      text('Møtte '),
      { type: 'mention', kind: 'person', label: 'Brann Holt', ref: { id: 42 }, start: 6, end: 25 },
      text(' i '),
      { type: 'mention', kind: 'place', label: 'Eldmark', ref: { id: 7 }, start: 28, end: 43 },
      text(': '),
      { type: 'mention', kind: 'quest', label: 'finne karavanen', ref: { new: true }, start: 45, end: 68 },
      text('.'),
    ]);
    for (const seg of parseMentions(s)) {
      if (seg.type === 'mention') expect(s.slice(seg.start, seg.end)).toMatch(/^[@#!]\[.*\)$/);
    }
  });

  it('tolker koblinger rett etter hverandre og helt i start og slutt', () => {
    const s = '@[A](e:1)#[B](e:2)![C](e:3)';
    expect(parseMentions(s).map((x) => (x.type === 'mention' ? x.label : x.text))).toEqual(['A', 'B', 'C']);
    expect(parseMentions('x@[A](e:1)y')).toMatchObject([
      text('x'),
      { type: 'mention', label: 'A' },
      text('y'),
    ]);
  });

  it('tolker ![…](e:ID) midt i vanlig tekst, også rett etter et ord', () => {
    expect(parseMentions('Hei![Quest](e:9) og !viktig')).toMatchObject([
      text('Hei'),
      { type: 'mention', kind: 'quest', label: 'Quest', ref: { id: 9 } },
      text(' og !viktig'),
    ]);
  });

  it('tolker escapet \\ og ] i teksten', () => {
    expect(parseMentions('@[a\\]b\\\\c](e:5)')).toMatchObject([{ type: 'mention', label: 'a]b\\c' }]);
    // En \ foran et annet tegn er bare en \.
    expect(parseMentions('@[a\\b](e:5)')).toMatchObject([{ type: 'mention', label: 'a\\b' }]);
  });

  it.each([
    ['ID som ikke er tall', '@[x](e:abc)'],
    ['ID 0', '@[x](e:0)'],
    ['ID med null først', '@[x](e:07)'],
    ['negativ ID', '@[x](e:-1)'],
    ['ID over INT UNSIGNED', `@[x](e:${MAX_ENTRY_ID + 1})`],
    ['ID med desimal', '@[x](e:1.5)'],
    ['manglende )', '@[x](e:1'],
    ['manglende ]', '@[x(e:1)'],
    ['mellomrom før (', '@[x] (e:1)'],
    ['tom tekst', '@[](e:1)'],
    ['tekst med bare mellomrom', '@[  ](e:1)'],
    ['linjeskift i teksten', '@[x\ny](e:1)'],
    ['ukjent mål', '@[x](http://x)'],
    ['NEW med store bokstaver', '@[x](NEW)'],
    ['mellomrom i målet', '@[x](e: 1)'],
    ['annet tegn foran', '$[x](e:1)'],
    ['Markdown-lenke', '[x](e:1)'],
    ['escapet ] som siste tegn', '@[x\\](e:1)'],
  ])('lar ugyldige koblinger være tekst: %s', (_name, s) => {
    expect(parseMentions(s)).toEqual([text(s)]);
    expect(stripMentions(s)).toBe(s);
  });

  it('finner en gyldig kobling etter en halv', () => {
    expect(parseMentions('@[x](e:abc) @[y](e:2)')).toMatchObject([
      text('@[x](e:abc) '),
      { type: 'mention', label: 'y', ref: { id: 2 } },
    ]);
    expect(parseMentions('@@[y](e:2)')).toMatchObject([text('@'), { type: 'mention', label: 'y' }]);
  });

  it('godtar største ID', () => {
    expect(parseMentions(`#[x](e:${MAX_ENTRY_ID})`)).toMatchObject([{ ref: { id: MAX_ENTRY_ID } }]);
  });
});

describe('formatMention', () => {
  const labels = [
    'Brann Holt',
    'Ærlige Åse fra Øyer',
    'Drakens ] øye',
    'C:\\sti\\',
    'Slutt]',
    '\\]',
    'Mor (gammel)',
    'Ugla 🦉 Hoo',
    '@[ikke](e:1)',
    '![x](new)',
    ' mellomrom ',
  ];
  const refs: MentionRef[] = [{ id: 1 }, { id: 4242 }, { new: true }];

  it.each(labels)('gir samme tekst tilbake etter tolking: %s', (label) => {
    for (const kind of MENTION_KINDS) {
      for (const ref of refs) {
        const token = formatMention(kind, label, ref);
        const s = `før ${token} etter`;
        expect(parseMentions(s)).toEqual([
          text('før '),
          { type: 'mention', kind, label, ref, start: 4, end: 4 + token.length },
          text(' etter'),
        ]);
      }
    }
  });

  it('escaper \\ og ]', () => {
    expect(formatMention('person', 'a]b\\c', { id: 3 })).toBe('@[a\\]b\\\\c](e:3)');
    expect(formatMention('place', 'x', { new: true })).toBe('#[x](new)');
    expect(formatMention('quest', 'x', { id: 9 })).toBe('![x](e:9)');
  });

  it('gjør linjeskift til mellomrom', () => {
    const token = formatMention('person', 'a\r\nb', { id: 1 });
    expect(token).toBe('@[a b](e:1)');
    expect(parseMentions(token)).toMatchObject([{ label: 'a b' }]);
  });

  it('kaster ved tom tekst eller ugyldig ID', () => {
    expect(() => formatMention('person', '', { id: 1 })).toThrow(RangeError);
    expect(() => formatMention('person', '  ', { id: 1 })).toThrow(RangeError);
    for (const id of [0, -1, 1.5, Number.NaN, MAX_ENTRY_ID + 1]) {
      expect(() => formatMention('person', 'x', { id })).toThrow(RangeError);
    }
  });
});

describe('mentionedEntryIds og newMentions', () => {
  const s = '@[A](e:4) #[B](new) @[A igjen](e:4) ![C](e:9) #[B](new) @[B](new) @[x](e:abc)';

  it('gir unike ID-er i rekkefølge', () => {
    expect(mentionedEntryIds(s)).toEqual([4, 9]);
    expect(mentionedEntryIds('ingen')).toEqual([]);
  });

  it('gir unike nye koblinger per type og tekst', () => {
    expect(newMentions(s)).toEqual([
      { kind: 'place', label: 'B' },
      { kind: 'person', label: 'B' },
    ]);
  });

  it('slår sammen nye koblinger uten hensyn til store og små bokstaver og mellomrom i endene', () => {
    expect(
      newMentions('@[ Brann Holt](new) @[brann holt ](new) @[BRANN HOLT](new) #[Brann Holt](new)'),
    ).toEqual([
      { kind: 'person', label: 'Brann Holt' },
      { kind: 'place', label: 'Brann Holt' },
    ]);
    expect(newMentions('@[Ærlige Åse](new) @[ærlige åse](new)')).toEqual([
      { kind: 'person', label: 'Ærlige Åse' },
    ]);
    expect(mentionKey('person', ' ÆØÅ ')).toBe(mentionKey('person', 'æøå'));
    expect(mentionKey('person', 'a')).not.toBe(mentionKey('place', 'a'));
  });
});

describe('mapMentions', () => {
  it('bytter hver kobling og lar teksten rundt stå', () => {
    const s = 'Til @[Eldmark](e:7) og @[Ukjent](e:99), så ![Q](new).';
    const out = mapMentions(s, (m) => {
      if ('new' in m.ref) return s.slice(m.start, m.end);
      if (m.ref.id === 7) return formatMention('place', m.label, m.ref);
      return m.label;
    });
    expect(out).toBe('Til #[Eldmark](e:7) og Ukjent, så ![Q](new).');
  });
});

describe('lengde og ytelse', () => {
  it('godtar tekst på MENTION_LABEL_MAX tegn og ikke lenger', () => {
    const max = 'x'.repeat(MENTION_LABEL_MAX);
    expect(parseMentions(`@[${max}](e:1)`)).toMatchObject([{ type: 'mention', label: max }]);
    expect(parseMentions(`@[${max}y](e:1)`)).toEqual([text(`@[${max}y](e:1)`)]);
    // Escaping teller som ett tegn.
    const escaped = '\\]'.repeat(MENTION_LABEL_MAX);
    expect(parseMentions(`@[${escaped}](e:1)`)).toMatchObject([{ label: ']'.repeat(MENTION_LABEL_MAX) }]);
    expect(formatMention('person', max, { id: 1 })).toBe(`@[${max}](e:1)`);
    expect(() => formatMention('person', `${max}y`, { id: 1 })).toThrow(RangeError);
  });

  it.each([
    ['@[', '@['],
    ['@[x](e:', '@[x](e:'],
    ['\\-rekker', '@[' + '\\'.repeat(20)],
    ['escapet ]', '@[\\]'],
    ['bare \\', '\\'],
    ['blandet', '#[a\\\\b](e:1x!['],
    ['nye uten slutt', '![x](new'],
  ])('tolker 100 000 tegn med %s raskt', (_name, unit) => {
    const s = unit.repeat(Math.ceil(100_000 / unit.length)).slice(0, 100_000);
    const t0 = Date.now();
    const segments = parseMentions(s);
    stripMentions(s);
    newMentions(s);
    const ms = Date.now() - t0;
    expect(segments.map((x) => (x.type === 'text' ? x.text : '')).join('').length).toBeLessThanOrEqual(
      100_000,
    );
    // Kvadratisk tid ville tatt over 10 s; grensen er romslig for at full testkjøring ikke skal gi flaks
    expect(ms).toBeLessThan(2000);
  });

  it('tolker 100 000 tegn med gyldige koblinger raskt', () => {
    const s = '@[Brann](e:42) '.repeat(Math.ceil(100_000 / 15)).slice(0, 100_000);
    const t0 = Date.now();
    expect(mentionedEntryIds(s)).toEqual([42]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('replaceNewMentions', () => {
  it('bytter (new) med ID og lar resten stå', () => {
    const s = 'Fant @[Brann](new) ved #[Eld\\]mark](new), jf. ![Q](e:3) og @[x](e:abc).';
    const ids: Record<string, number> = { 'person:Brann': 10, 'place:Eld]mark': 11 };
    const calls: string[] = [];
    const out = replaceNewMentions(s, (kind: MentionKind, label) => {
      calls.push(`${kind}:${label}`);
      return ids[`${kind}:${label}`]!;
    });
    expect(out).toBe('Fant @[Brann](e:10) ved #[Eld\\]mark](e:11), jf. ![Q](e:3) og @[x](e:abc).');
    expect(calls).toEqual(['person:Brann', 'place:Eld]mark']);
    expect(newMentions(out)).toEqual([]);
    expect(mentionedEntryIds(out)).toEqual([10, 11, 3]);
  });

  it('gir samme tekst når ingenting er nytt', () => {
    const s = 'Ingen @[nye](e:1) her 🦉';
    expect(replaceNewMentions(s, () => 1)).toBe(s);
  });

  it('kaster hvis resolve gir en ugyldig ID', () => {
    expect(() => replaceNewMentions('@[x](new)', () => 0)).toThrow(RangeError);
  });
});

describe('stripMentions', () => {
  it('gir lesbar tekst', () => {
    expect(stripMentions('Møtte @[Brann \\] Holt](e:42) i #[Eldmark](new)!')).toBe(
      'Møtte Brann ] Holt i Eldmark!',
    );
  });
});

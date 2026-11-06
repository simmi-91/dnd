import { describe, expect, it } from 'vitest';
import {
  applyTextChange,
  findTrigger,
  fromStorage,
  insertMention,
  insertTrigger,
  toStorage,
} from './MentionEditorModel';

const stored =
  'Kom til #[Eldmark](e:30) på kvelden. @[Brann Holt](e:20) ba oss om å ![finne karavanen](new).';

describe('MentionEditorModel: serialisering', () => {
  it('viser koblinger som tegn og tekst, uten (e:ID)', () => {
    const doc = fromStorage(stored);
    expect(doc.text).toBe('Kom til #Eldmark på kvelden. @Brann Holt ba oss om å !finne karavanen.');
    expect(doc.mentions.map((m) => [doc.text.slice(m.start, m.end), m.kind, m.ref])).toEqual([
      ['#Eldmark', 'place', { id: 30 }],
      ['@Brann Holt', 'person', { id: 20 }],
      ['!finne karavanen', 'quest', { new: true }],
    ]);
  });

  it('gir samme lagringsformat tilbake (rundtur)', () => {
    expect(toStorage(fromStorage(stored))).toBe(stored);
    expect(toStorage(fromStorage(''))).toBe('');
    expect(toStorage(fromStorage('Bare tekst, @ og # og ! uten koblinger.'))).toBe(
      'Bare tekst, @ og # og ! uten koblinger.',
    );
  });

  it('tåler mellomrom og spesialtegn i koblingen, og escaper ] og \\', () => {
    const special = String.raw`Hos @[Æsa «Den] Røde» \ Holt](e:5) og ![10 % [rabatt]](new)`;
    const tricky = String.raw`@[Æsa «Den\] Røde» \\ Holt](e:5) og ![10 % [rabatt\]](new)`;
    expect(fromStorage(special).mentions).toHaveLength(0);
    const doc = fromStorage(tricky);
    expect(doc.text).toBe(String.raw`@Æsa «Den] Røde» \ Holt og !10 % [rabatt]`);
    expect(doc.mentions).toHaveLength(2);
    expect(toStorage(doc)).toBe(tricky);
  });

  it('linjeskift og tekst rett før og etter en kobling beholdes', () => {
    const text = 'Linje 1\n\n@[Brann](e:1)!\n#[Eldmark](e:2)';
    expect(toStorage(fromStorage(text))).toBe(text);
  });
});

describe('MentionEditorModel: redigering', () => {
  const base = fromStorage('Hei @[Brann Holt](e:20) og #[Eldmark](e:30).');

  it('skriving før og etter en kobling flytter den, uten å bryte den', () => {
    // «Hei @Brann Holt og #Eldmark.» → skriv «!» rett etter «Holt».
    const at = base.text.indexOf(' og');
    const after = applyTextChange(base, base.text.slice(0, at) + '!' + base.text.slice(at), at + 1);
    expect(toStorage(after)).toBe('Hei @[Brann Holt](e:20)! og #[Eldmark](e:30).');
    const before = applyTextChange(after, 'Ja. ' + after.text, 4);
    expect(toStorage(before)).toBe('Ja. Hei @[Brann Holt](e:20)! og #[Eldmark](e:30).');
  });

  it('redigering inni en kobling gjør den til vanlig tekst', () => {
    const at = base.text.indexOf('Holt');
    const inside = applyTextChange(base, base.text.slice(0, at) + 'X' + base.text.slice(at), at + 1);
    expect(toStorage(inside)).toBe('Hei @Brann XHolt og #[Eldmark](e:30).');
  });

  it('sletting av siste tegn i en kobling bryter den, men lar de andre stå', () => {
    const end = base.text.indexOf(' og');
    const del = applyTextChange(base, base.text.slice(0, end - 1) + base.text.slice(end), end - 1);
    expect(toStorage(del)).toBe('Hei @Brann Hol og #[Eldmark](e:30).');
  });

  it('bruker markøren når teksten rundt er lik', () => {
    const doc = fromStorage('@[Anna](e:1) a');
    // «@Anna a» → «@Annaa a» kan være skrevet inni eller etter koblingen.
    const afterMention = applyTextChange(doc, '@Annaa a', 6);
    expect(toStorage(afterMention)).toBe('@[Anna](e:1)a a');
    const inside = applyTextChange(doc, '@Annaa a', 5);
    expect(toStorage(inside)).toBe('@Annaa a');
  });

  it('erstatter et valg som dekker en hel kobling', () => {
    const start = base.text.indexOf('@');
    const end = base.text.indexOf(' og');
    const next = base.text.slice(0, start) + 'ham' + base.text.slice(end);
    expect(toStorage(applyTextChange(base, next, start + 3))).toBe('Hei ham og #[Eldmark](e:30).');
  });
});

describe('MentionEditorModel: autofullføring', () => {
  it('finner tegnet og søket ved markøren', () => {
    const doc = fromStorage('Vi møtte @Bra');
    expect(findTrigger(doc, doc.text.length)).toEqual({
      index: 9,
      kind: 'person',
      trigger: '@',
      query: 'Bra',
    });
    const multi = fromStorage('Vi skal !finne kara');
    expect(findTrigger(multi, multi.text.length)?.query).toBe('finne kara');
  });

  it('åpner ikke midt i ord, etter mellomrom, over linjeskift eller i en kobling', () => {
    expect(findTrigger(fromStorage('Hei!'), 4)).toBeNull();
    expect(findTrigger(fromStorage('elin@example'), 12)).toBeNull();
    expect(findTrigger(fromStorage('@ x'), 3)).toBeNull();
    expect(findTrigger(fromStorage('@Bra\nfoo'), 8)).toBeNull();
    const linked = fromStorage('@[Brann](e:1)');
    expect(findTrigger(linked, linked.text.length)).toBeNull();
  });

  it('setter inn en kobling med mellomrom etter', () => {
    const doc = fromStorage('Vi møtte @bra');
    const t = findTrigger(doc, doc.text.length);
    if (!t) throw new Error('fant ikke tegnet');
    const res = insertMention(doc, t, doc.text.length, 'Brann Holt', { id: 20 });
    expect(res.doc.text).toBe('Vi møtte @Brann Holt ');
    expect(res.caret).toBe(res.doc.text.length);
    expect(toStorage(res.doc)).toBe('Vi møtte @[Brann Holt](e:20) ');
  });

  it('«Opprett» lagres som (new)', () => {
    const doc = fromStorage('#[Eldmark](e:2) og !finne karavanen.');
    const caret = doc.text.indexOf('.');
    const t = findTrigger(doc, caret);
    if (!t) throw new Error('fant ikke tegnet');
    const res = insertMention(doc, t, caret, 'finne karavanen', { new: true });
    expect(toStorage(res.doc)).toBe('#[Eldmark](e:2) og ![finne karavanen](new).');
  });

  it('knappen setter inn tegnet ved markøren, med mellomrom foran om det trengs', () => {
    const doc = fromStorage('Hei');
    expect(insertTrigger(doc, 3, 3, '#')).toMatchObject({ doc: { text: 'Hei #' }, caret: 5 });
    expect(insertTrigger(fromStorage('Hei '), 4, 4, '@')).toMatchObject({ doc: { text: 'Hei @' }, caret: 5 });
    expect(insertTrigger(fromStorage(''), 0, 0, '!')).toMatchObject({ doc: { text: '!' }, caret: 1 });
  });
});

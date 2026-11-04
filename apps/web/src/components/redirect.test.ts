import { describe, expect, it } from 'vitest';
import { safeRedirectTarget } from './redirect';

describe('safeRedirectTarget', () => {
  it.each([
    ['//evil.example/x', '/'],
    ['/\\evil', '/'],
    ['/\\/evil.example', '/'],
    ['https://evil.example/', '/'],
    ['javascript:alert(1)', '/'],
    ['konto', '/'],
    ['', '/'],
    ['/\tevil', '/'],
    ['/logg-inn', '/'],
    ['/logg-inn?x=1', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%j gir %s', (from, expected) => {
    expect(safeRedirectTarget(from)).toBe(expected);
  });

  it.each(['/', '/konto', '/spill/3?fane=ark', '/logg-innsjekk'])('godtar den vanlige stien %s', (from) => {
    expect(safeRedirectTarget(from)).toBe(from);
  });
});

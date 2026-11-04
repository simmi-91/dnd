import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from './index.ts';

describe('rules', () => {
  it('har en versjon', () => {
    expect(RULES_VERSION).toBe(1);
  });
});

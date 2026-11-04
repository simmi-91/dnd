import { describe, expect, it } from 'vitest';
import { userSchema } from './index.ts';

describe('userSchema', () => {
  it('godtar en gyldig bruker', () => {
    const user = userSchema.parse({ id: 1, email: 'a@b.no', name: 'Elin', avatarUrl: null });
    expect(user.name).toBe('Elin');
  });

  it('avviser ugyldig e-post', () => {
    expect(userSchema.safeParse({ id: 1, email: 'x', name: 'E', avatarUrl: null }).success).toBe(false);
  });
});

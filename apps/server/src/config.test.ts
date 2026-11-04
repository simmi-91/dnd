import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const base = { DB_HOST: '127.0.0.1', DB_USER: 'root', DB_PASSWORD: 'hemmelig-passord', DB_NAME: 'x' };

describe('loadConfig', () => {
  it('bruker standardverdier', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ port: 8032, sessionTtlDays: 60, nodeEnv: 'development', googleClientId: null });
    expect(c.db).toMatchObject({ port: 3306, database: 'x' });
  });

  it('gir en feil som nevner variablene, men ikke verdiene', () => {
    let error: unknown;
    try {
      loadConfig({ ...base, DB_HOST: '', PORT: 'ikke-et-tall-123', NODE_ENV: 'hemmelig-env' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    expect(message).toContain('DB_HOST: mangler');
    expect(message).toContain('PORT: ugyldig verdi');
    expect(message).toContain('NODE_ENV');
    expect(message).not.toContain('ikke-et-tall-123');
    expect(message).not.toContain('hemmelig');
  });

  it('slår av dev-login i produksjon', () => {
    expect(loadConfig({ ...base, DEV_LOGIN_EMAIL: 'a@b.no' }).devLoginEmail).toBe('a@b.no');
    expect(
      loadConfig({ ...base, DEV_LOGIN_EMAIL: 'a@b.no', NODE_ENV: 'production' }).devLoginEmail,
    ).toBeNull();
  });
});

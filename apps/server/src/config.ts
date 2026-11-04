import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const port = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'production', 'test']).default('development'),
  ),
  PORT: z.preprocess(emptyToUndefined, port.default(8032)),
  DB_HOST: z.string().trim().min(1),
  DB_PORT: z.preprocess(emptyToUndefined, port.default(3306)),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().trim().min(1),
  GOOGLE_CLIENT_ID: optionalString,
  SESSION_TTL_DAYS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(3650).default(60)),
  DDB_CACHE_SECONDS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(300)),
  WEB_DIR: optionalString,
  IMAGE_DIR: optionalString,
  DEV_LOGIN_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
});

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  db: { host: string; port: number; user: string; password: string; database: string };
  googleClientId: string | null;
  sessionTtlDays: number;
  ddbCacheSeconds: number;
  webDir: string | null;
  imageDir: string | null;
  /** Satt bare når dev-login er tillatt (ikke i produksjon). */
  devLoginEmail: string | null;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Leser og sjekker miljøvariablene. Feilmeldingen nevner bare navnene på variablene,
 * aldri verdiene, så den kan logges trygt.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(ukjent)';
      const missing = emptyToUndefined(env[name]) === undefined;
      return `  - ${name}: ${missing ? 'mangler' : 'ugyldig verdi'}`;
    });
    throw new ConfigError(`Ugyldige miljøvariabler:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    db: { host: e.DB_HOST, port: e.DB_PORT, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME },
    googleClientId: e.GOOGLE_CLIENT_ID ?? null,
    sessionTtlDays: e.SESSION_TTL_DAYS,
    ddbCacheSeconds: e.DDB_CACHE_SECONDS,
    webDir: e.WEB_DIR ?? null,
    imageDir: e.IMAGE_DIR ?? null,
    devLoginEmail: !isProduction && e.DEV_LOGIN_EMAIL ? e.DEV_LOGIN_EMAIL.toLowerCase() : null,
  };
}

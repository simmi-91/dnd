import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SESSION_COOKIE } from '@dnd/shared';
import { sql } from 'kysely';
import type { GoogleIdentity, GoogleVerifier } from '../auth/google.ts';
import { loadConfig, type Config } from '../config.ts';
import { createDb, type Db } from '../db/index.ts';
import { migrateToLatest } from '../db/migrator.ts';

let envLoaded = false;

/** Leser apps/server/.env hvis den finnes. Variabler som alt er satt (CI), vinner. */
function loadTestEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const envFile = resolve(import.meta.dirname, '../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function testDbName(): string {
  loadTestEnv();
  const name = process.env.TEST_DB_NAME?.trim() || 'dnd_test';
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('TEST_DB_NAME kan bare ha bokstaver, tall og _');
  if (name === process.env.DB_NAME) {
    throw new Error('TEST_DB_NAME er lik DB_NAME. Testene tømmer databasen og må ha en egen.');
  }
  return name;
}

/** Konfigurasjon for tester. Bruker alltid TEST_DB_NAME, aldri DB_NAME. */
export function testConfig(overrides: Record<string, string | undefined> = {}): Config {
  loadTestEnv();
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    DEV_LOGIN_EMAIL: '',
    WEB_DIR: '',
    SESSION_TTL_DAYS: '60',
    ...overrides,
    DB_NAME: testDbName(),
  });
}

/** Lager testdatabasen hvis den mangler. Feiler tydelig hvis MySQL ikke svarer. */
export async function ensureTestDatabase(config: Config): Promise<void> {
  const admin = createDb(config.db, { withoutDatabase: true, connectionLimit: 1 });
  try {
    await sql
      .raw(
        `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      )
      .execute(admin);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Får ikke kontakt med MySQL på ${config.db.host}:${config.db.port} som ${config.db.user} (${reason}). ` +
        'Servertestene krever en ekte database. Sjekk apps/server/.env eller DB_*-variablene.',
      { cause: error },
    );
  } finally {
    await admin.destroy();
  }
}

/** Sletter alle dd_-tabeller i testdatabasen. */
export async function dropDdTables(db: Db): Promise<void> {
  const { rows } = await sql<{ name: string }>`
    SELECT TABLE_NAME AS name FROM information_schema.tables
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'dd\\_%'`.execute(db);
  if (rows.length === 0) return;
  const list = rows.map((r) => `\`${r.name}\``).join(', ');
  await sql.raw(`DROP TABLE IF EXISTS ${list}`).execute(db);
}

/** Klar testdatabase: lagd, tømt for dd_-tabeller og migrert. */
export async function freshTestDb(config: Config): Promise<Db> {
  await ensureTestDatabase(config);
  const db = createDb(config.db, { connectionLimit: 4 });
  await dropDdTables(db);
  await migrateToLatest(db);
  return db;
}

export async function clearData(db: Db): Promise<void> {
  await db.deleteFrom('dd_auth_sessions').execute();
  await db.deleteFrom('dd_users').execute();
}

/** Falsk Google-verifisering: tokenet `ok:<sub>:<email>` godtas, alt annet avvises. */
export function fakeGoogle(extra: Partial<GoogleIdentity> = {}): GoogleVerifier {
  return async (credential) => {
    const [kind, sub, email] = credential.split(':');
    if (kind !== 'ok' || !sub || !email) throw new Error('ugyldig testtoken');
    return { sub, email, emailVerified: true, name: 'Test Testesen', picture: null, ...extra };
  };
}

export const WRITE_HEADERS = { 'x-requested-with': 'dnd' } as const;

/** Henter verdien til sesjonsinformasjonskapselen fra et inject-svar. */
export function sessionCookieFrom(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === SESSION_COOKIE);
}

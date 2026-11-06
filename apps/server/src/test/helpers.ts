import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SESSION_COOKIE } from '@dnd/shared';
import { sql } from 'kysely';
import type { GoogleIdentity, GoogleVerifier } from '../auth/google.ts';
import { loadConfig, type Config } from '../config.ts';
import { createDb, type Db } from '../db/index.ts';
import { migrateToLatest } from '../db/migrator.ts';
import type { FetchLike } from '../ddb/client.ts';

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
  await db.deleteFrom('dd_combats').execute();
  await db.deleteFrom('dd_game_state').execute();
  await db.deleteFrom('dd_games').execute();
  await db.deleteFrom('dd_characters').execute();
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

/** Rå D&D Beyond-svar fra `packages/rules/fixtures` (anonymisert, ID 1000001 og 1000002). */
export function ddbFixture(name: 'elowen-4' | 'lego-ranger-5'): Record<string, unknown> {
  const file = resolve(import.meta.dirname, `../../../../packages/rules/fixtures/${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

export const ELOWEN_ID = 1000001;
export const LEGO_ID = 1000002;

export interface FakeDdb {
  fetch: FetchLike;
  /** URL-ene som ble hentet. */
  calls: string[];
  /** Svar for en ID: rådata (200) eller bare en statuskode. */
  responses: Map<number, unknown>;
  headers: Array<Record<string, string>>;
}

/** Falsk D&D Beyond: svarer med fixturene, og går aldri mot den ekte tjenesten. */
export function fakeDdb(): FakeDdb {
  const responses = new Map<number, unknown>([
    [ELOWEN_ID, ddbFixture('elowen-4')],
    [LEGO_ID, ddbFixture('lego-ranger-5')],
  ]);
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  return {
    calls,
    responses,
    headers,
    fetch: async (url, init) => {
      calls.push(url);
      headers.push({ ...(init.headers as Record<string, string>) });
      const id = Number(url.split('/').pop());
      const r = responses.get(id);
      if (r === undefined) return new Response('{"success":false}', { status: 404 });
      if (typeof r === 'number') return new Response('', { status: r });
      if (r instanceof Error) throw r;
      return new Response(typeof r === 'string' ? r : JSON.stringify(r), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

/** Henter verdien til sesjonsinformasjonskapselen fra et inject-svar. */
export function sessionCookieFrom(res: { cookies: Array<{ name: string; value: string }> }) {
  return res.cookies.find((c) => c.name === SESSION_COOKIE);
}

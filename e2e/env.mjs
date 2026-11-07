// Felles oppsett for e2e: egen database (E2E_DB_NAME, standard dnd_e2e), aldri DB_NAME.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const E2E_PORT = process.env.E2E_PORT ?? '8133';

/** Miljøet e2e-serveren og migreringene kjører med. Variabler som alt er satt (CI), vinner over .env. */
export function e2eEnv() {
  const envFile = resolve(root, 'apps/server/.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const normal = process.env.DB_NAME;
  const database = (process.env.E2E_DB_NAME ?? '').trim() || 'dnd_e2e';
  // Databasen slettes og lages på nytt, og serveren er delt med andre apper. Krev derfor endelsen _e2e.
  if (!/^[A-Za-z0-9_]+_e2e$/.test(database)) {
    throw new Error('E2E_DB_NAME må slutte på _e2e og bare ha bokstaver, tall og _.');
  }
  if (database === normal || database === process.env.TEST_DB_NAME) {
    throw new Error('E2E_DB_NAME må være en egen database (ikke DB_NAME eller TEST_DB_NAME).');
  }
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: E2E_PORT,
    DB_NAME: database,
    GOOGLE_CLIENT_ID: '',
    // Den eksisterende dev-login-veien. Virker aldri i produksjon (NODE_ENV=production).
    DEV_LOGIN_EMAIL: 'e2e@example.com',
    WEB_DIR: resolve(root, 'apps/web/dist'),
    IMAGE_DIR: '',
  };
}

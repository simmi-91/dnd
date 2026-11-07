import { recreateDatabase } from './db.mjs';
import { e2eEnv } from './env.mjs';

/** Rydder etter kjøringen: e2e-databasen slettes. */
export default async function globalTeardown() {
  await recreateDatabase(e2eEnv(), { createAgain: false });
}

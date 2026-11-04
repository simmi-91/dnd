import { ConfigError, loadConfig } from '../config.ts';
import { createDb } from './index.ts';
import { createMigrator } from './migrator.ts';

async function main(): Promise<number> {
  const config = loadConfig();
  const db = createDb(config.db, { connectionLimit: 1 });
  try {
    const { error, results } = await createMigrator(db).migrateToLatest();
    for (const r of results ?? []) {
      const status = r.status === 'Success' ? 'ok' : r.status === 'Error' ? 'FEIL' : 'ikke kjørt';
      console.log(`migrering ${r.migrationName}: ${status}`);
    }
    if (error) {
      console.error('Migreringen feilet:', error instanceof Error ? error.message : error);
      return 1;
    }
    if (!results || results.length === 0) console.log('Ingen nye migreringer.');
    return 0;
  } finally {
    await db.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof ConfigError) console.error(error.message);
    else console.error('Migreringen feilet:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

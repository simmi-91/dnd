import type { Kysely, SchemaModule } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';
import { migrations as defaultMigrations } from './migrations/index.ts';
import { TablePrefixGuardPlugin } from './prefix-guard.ts';

export const MIGRATION_TABLE = 'dd_migrations';
export const MIGRATION_LOCK_TABLE = 'dd_migrations_lock';

/** Skjemaoperasjonene en migrering får. Alle spørringer går gjennom dd_-vernet. */
export type MigrationSchema = Pick<
  SchemaModule,
  'createTable' | 'alterTable' | 'dropTable' | 'createIndex' | 'dropIndex'
>;

/**
 * Det migreringene får i stedet for Kysely-instansen. Det har ingen `executeQuery`,
 * `connection()`, `transaction()`, `withoutPlugins()`, `withPlugin()` eller DML, så
 * vernet kan ikke omgås med det migreringen får utdelt.
 */
export interface MigrationContext {
  readonly schema: MigrationSchema;
}

export interface DdMigration {
  up(m: MigrationContext): Promise<void>;
  down?(m: MigrationContext): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migratoren jobber uten tabelltyper
type AnyDb = Kysely<any>;

export function createMigrationContext(db: AnyDb): MigrationContext {
  const schema = db.withPlugin(new TablePrefixGuardPlugin()).schema;
  return Object.freeze({
    schema: Object.freeze({
      createTable: (table: string) => schema.createTable(table),
      alterTable: (table: string) => schema.alterTable(table),
      dropTable: (table: string) => schema.dropTable(table),
      createIndex: (index: string) => schema.createIndex(index),
      dropIndex: (index: string) => schema.dropIndex(index),
    }) as MigrationSchema,
  });
}

function toKyselyMigration(migration: DdMigration): Migration {
  const down = migration.down;
  return {
    up: (db: AnyDb) => migration.up(createMigrationContext(db)),
    down: down ? (db: AnyDb) => down(createMigrationContext(db)) : undefined,
  };
}

export function createMigrator(
  db: AnyDb,
  migrations: Record<string, DdMigration> = defaultMigrations,
): Migrator {
  const wrapped = Object.fromEntries(
    Object.entries(migrations).map(([name, migration]) => [name, toKyselyMigration(migration)]),
  );
  return new Migrator({
    // Migratoren selv leser og skriver bare dd_migrations og dd_migrations_lock.
    db,
    provider: { getMigrations: async () => wrapped },
    migrationTableName: MIGRATION_TABLE,
    migrationLockTableName: MIGRATION_LOCK_TABLE,
  });
}

/** Kjører alle nye migreringer. Kaster ved feil. */
export async function migrateToLatest(
  db: AnyDb,
  migrations?: Record<string, DdMigration>,
): Promise<MigrationResultSet> {
  const result = await createMigrator(db, migrations).migrateToLatest();
  if (result.error) throw result.error;
  return result;
}

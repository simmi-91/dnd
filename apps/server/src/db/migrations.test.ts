import { CompiledQuery, sql, type RawBuilder } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshTestDb, testConfig } from '../test/helpers.ts';
import type { Db } from './index.ts';
import { migrations } from './migrations/index.ts';
import {
  createMigrationContext,
  createMigrator,
  migrateToLatest,
  type DdMigration,
  type MigrationContext,
} from './migrator.ts';
import { assertMigrationQuery, ddl, TablePrefixError } from './prefix-guard.ts';

let db: Db;

beforeAll(async () => {
  db = await freshTestDb(testConfig());
});

afterAll(async () => {
  await db?.destroy();
});

async function tableNames(): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    SELECT TABLE_NAME AS name FROM information_schema.tables
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`.execute(db);
  return rows.map((r) => r.name);
}

describe('migreringer', () => {
  it('lager dd_users, dd_auth_sessions og migreringstabellene', async () => {
    const names = await tableNames();
    expect(names).toEqual(
      expect.arrayContaining(['dd_auth_sessions', 'dd_migrations', 'dd_migrations_lock', 'dd_users']),
    );
    expect(names.every((n) => n.startsWith('dd_'))).toBe(true);
  });

  it('bruker InnoDB og utf8mb4', async () => {
    const { rows } = await sql<{ name: string; engine: string; collation: string }>`
      SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation
      FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('dd_users', 'dd_auth_sessions')`.execute(db);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.engine).toBe('InnoDB');
      expect(row.collation).toMatch(/^utf8mb4_/);
    }
  });

  it('har riktige kolonner, unike nøkler og fremmednøkkel', async () => {
    const { rows: cols } = await sql<{ table: string; column: string; type: string; nullable: string }>`
      SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`, COLUMN_TYPE AS type, IS_NULLABLE AS nullable
      FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('dd_users', 'dd_auth_sessions')`.execute(db);
    const col = (t: string, c: string) => cols.find((r) => r.table === t && r.column === c);

    expect(col('dd_users', 'blocked')).toMatchObject({ type: 'tinyint(1)', nullable: 'NO' });
    for (const c of [
      'google_sub',
      'email',
      'name',
      'avatar_url',
      'created_at',
      'updated_at',
      'last_login_at',
    ]) {
      expect(col('dd_users', c), c).toBeDefined();
    }
    expect(col('dd_auth_sessions', 'token_hash')).toMatchObject({ type: 'char(64)', nullable: 'NO' });
    for (const c of ['user_id', 'expires_at', 'last_used_at', 'created_at']) {
      expect(col('dd_auth_sessions', c), c).toBeDefined();
    }

    const { rows: uniques } = await sql<{ table: string; column: string }>`
      SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\` FROM information_schema.statistics
      WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'`.execute(db);
    expect(uniques).toEqual(
      expect.arrayContaining([
        { table: 'dd_users', column: 'google_sub' },
        { table: 'dd_users', column: 'email' },
        { table: 'dd_auth_sessions', column: 'token_hash' },
      ]),
    );

    const { rows: fks } = await sql<{ table: string; ref: string }>`
      SELECT TABLE_NAME AS \`table\`, REFERENCED_TABLE_NAME AS ref FROM information_schema.key_column_usage
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`.execute(db);
    expect(fks).toContainEqual({ table: 'dd_auth_sessions', ref: 'dd_users' });
  });

  it('gjør ingenting når alt er migrert', async () => {
    const result = await migrateToLatest(db);
    expect(result.results).toEqual([]);
  });
});

describe('dd_-vernet', () => {
  const raw = (q: RawBuilder<unknown>) => () => assertMigrationQuery(q.toOperationNode());
  let m: MigrationContext;

  beforeAll(() => {
    m = createMigrationContext(db);
  });

  // Testerens liste: rå SQL skal aldri komme gjennom.
  it.each([
    ['TRUNCATE', sql`TRUNCATE x`],
    ['DROP TABLE med liste', sql`DROP TABLE dd_a, x`],
    ['DROP TABLE med kommentar', sql`DROP TABLE /*c*/ x`],
    ['DROP TABLE med backticks uten mellomrom', sql`DROP TABLE\`x\``],
    ['sql.id', sql`DROP TABLE ${sql.id('x')}`],
    ['sql.ref', sql`DROP TABLE ${sql.ref('x')}`],
    ['DROP VIEW', sql`DROP VIEW x`],
    ['DROP INDEX ON', sql`DROP INDEX i ON x`],
    ['CREATE INDEX ON', sql`CREATE INDEX i ON x (a)`],
    ['CREATE TRIGGER ON', sql`CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a = 1`],
    ['RENAME TABLE TO', sql`RENAME TABLE dd_a TO x`],
    ['DROP DATABASE', sql`DROP DATABASE prodbase`],
    ['DELETE med flere tabeller', sql`DELETE v FROM dd_a d, x v`],
    ['rå SQL som bare nevner dd_', sql`DROP TABLE dd_a`],
    ['tillatt tekst med parameter', sql`CURRENT_TIMESTAMP ${sql.lit(1)}`],
  ])('nekter rå SQL: %s', (_name, query) => {
    expect(raw(query)).toThrow(TablePrefixError);
  });

  it.each<[string, (m: MigrationContext) => { compile(): unknown }]>([
    ['createTable uten dd_', (m) => m.schema.createTable('x').addColumn('id', 'integer')],
    [
      'createTable i annen database',
      (m) => m.schema.createTable('prodbase.dd_users').addColumn('id', 'integer'),
    ],
    ['dropTable uten dd_', (m) => m.schema.dropTable('x')],
    ['alterTable uten dd_', (m) => m.schema.alterTable('x').addColumn('a', 'integer')],
    ['renameTo uten dd_', (m) => m.schema.alterTable('dd_a').renameTo('x')],
    ['setSchema til annen database', (m) => m.schema.alterTable('dd_a').setSchema('otherdb')],
    ['createIndex on uten dd_', (m) => m.schema.createIndex('i').on('x').column('a')],
    ['dropIndex on uten dd_', (m) => m.schema.dropIndex('i').on('x')],
    [
      'fremmednøkkel til tabell uten dd_',
      (m) => m.schema.createTable('dd_a').addColumn('u', 'integer', (c) => c.references('x.id')),
    ],
    [
      'addForeignKeyConstraint uten dd_',
      (m) =>
        m.schema
          .createTable('dd_a')
          .addColumn('u', 'integer')
          .addForeignKeyConstraint('fk', ['u'], 'x', ['id']),
    ],
    ['sql.id som datatype', (m) => m.schema.createTable('dd_a').addColumn('a', sql.id('x'))],
    [
      'sql.ref som default',
      (m) => m.schema.createTable('dd_a').addColumn('a', 'integer', (c) => c.defaultTo(sql.ref('x.a'))),
    ],
    [
      'rå SQL i modifyEnd',
      (m) =>
        m.schema
          .createTable('dd_a')
          .addColumn('a', 'integer')
          .modifyEnd(sql`; DROP TABLE x`),
    ],
    [
      'rå SQL i check',
      (m) => m.schema.createTable('dd_a').addColumn('a', 'integer', (c) => c.check(sql`a > 0`)),
    ],
  ])('nekter i builderen: %s', (_name, build) => {
    expect(() => build(m).compile()).toThrow(TablePrefixError);
  });

  it('godtar dd_-tabeller og ddl-hjelperne', () => {
    expect(() =>
      m.schema
        .createTable('dd_ok')
        .addColumn('id', 'integer', (c) => c.references('dd_users.id'))
        .addColumn('b', ddl.tinyint1, (c) => c.notNull().defaultTo(0))
        .addColumn('t', 'datetime', (c) =>
          c.defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
        )
        .modifyEnd(ddl.tableOptions)
        .compile(),
    ).not.toThrow();
    expect(() => m.schema.createIndex('i').on('dd_ok').column('id').compile()).not.toThrow();
    expect(() => m.schema.alterTable('dd_ok').renameTo('dd_ok2').compile()).not.toThrow();
  });

  it('gir migreringene et objekt uten veier rundt vernet', () => {
    const ctx = m as unknown as Record<string, unknown>;
    for (const key of [
      'executeQuery',
      'connection',
      'transaction',
      'withoutPlugins',
      'withPlugin',
      'selectFrom',
      'deleteFrom',
      'insertInto',
      'updateTable',
      'getExecutor',
      'introspection',
    ]) {
      expect(ctx[key], key).toBeUndefined();
    }
    const schema = m.schema as unknown as Record<string, unknown>;
    for (const key of [
      'withoutPlugins',
      'withPlugin',
      'withSchema',
      'createView',
      'dropView',
      'createSchema',
      'dropSchema',
      'createType',
    ]) {
      expect(schema[key], key).toBeUndefined();
    }
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.schema)).toBe(true);
  });

  describe('med ekte migreringer', () => {
    beforeAll(async () => {
      await sql`CREATE TABLE IF NOT EXISTS canary_x (id INT PRIMARY KEY)`.execute(db);
      await sql`INSERT IGNORE INTO canary_x VALUES (1)`.execute(db);
    });

    afterAll(async () => {
      await sql`DROP TABLE IF EXISTS canary_x`.execute(db);
    });

    async function runBad(up: DdMigration['up']) {
      const result = await createMigrator(db, { ...migrations, '9999_bad': { up } }).migrateToLatest();
      const { rows } = await sql<{ name: string }>`SELECT name FROM dd_migrations`.execute(db);
      expect(rows.map((r) => r.name)).not.toContain('9999_bad');
      const canary = await sql<{ id: number }>`SELECT id FROM canary_x`.execute(db);
      expect(canary.rows).toEqual([{ id: 1 }]);
      return result;
    }

    it('stopper en tabell uten dd_, og ingenting lages', async () => {
      const result = await runBad(async (m) => {
        await m.schema.createTable('not_ours').addColumn('id', 'integer').execute();
      });
      expect(result.error).toBeInstanceOf(TablePrefixError);
      expect(result.results).toContainEqual(
        expect.objectContaining({ migrationName: '9999_bad', status: 'Error' }),
      );
      expect(await tableNames()).not.toContain('not_ours');
    });

    it('stopper DROP TABLE og RENAME mot andre tabeller', async () => {
      expect(
        (await runBad(async (m) => void (await m.schema.dropTable('canary_x').execute()))).error,
      ).toBeInstanceOf(TablePrefixError);
      expect(
        (
          await runBad(
            async (m) => void (await m.schema.alterTable('canary_x').renameTo('dd_stolen').execute()),
          )
        ).error,
      ).toBeInstanceOf(TablePrefixError);
    });

    it('har ingen executeQuery å omgå vernet med', async () => {
      const result = await runBad(async (m) => {
        const anyM = m as unknown as { executeQuery: (q: CompiledQuery) => Promise<unknown> };
        await anyM.executeQuery(CompiledQuery.raw('TRUNCATE canary_x'));
      });
      expect(result.error).toBeInstanceOf(TypeError);
    });
  });
});

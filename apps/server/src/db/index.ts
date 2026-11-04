import { CompiledQuery, Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { Config } from '../config.ts';
import type { Database } from './types.ts';

export type Db = Kysely<Database>;

export interface DbOptions {
  /** Kobler til uten å velge database (for å lage testdatabasen). */
  withoutDatabase?: boolean;
  connectionLimit?: number;
}

/**
 * Lager en Kysely-instans med mysql2-pool. Alle tilkoblinger kjører i UTC, og
 * mysql2 tolker DATETIME som UTC, så `Date` blir riktig begge veier.
 */
export function createDb(dbConfig: Config['db'], options: DbOptions = {}): Db {
  const pool = createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: options.withoutDatabase ? undefined : dbConfig.database,
    connectionLimit: options.connectionLimit ?? 10,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  return new Kysely<Database>({
    dialect: new MysqlDialect({
      pool,
      onCreateConnection: async (connection) => {
        await connection.executeQuery(CompiledQuery.raw("SET time_zone = '+00:00'"));
      },
    }),
  });
}

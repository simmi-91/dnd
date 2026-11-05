import type { DdMigration } from '../migrator.ts';
import { ddl } from '../prefix-guard.ts';

// Bare nye tabeller, så migreringen er bakoverkompatibel med koden fra fase 1.
export const charactersAndGames: DdMigration = {
  async up(db) {
    await db.schema
      .createTable('dd_characters')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('user_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('ddb_id', 'bigint', (col) => col.unsigned().notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('summary', 'varchar(255)', (col) => col.notNull())
      .addColumn('derived', 'json', (col) => col.notNull())
      .addColumn('derive_version', 'integer', (col) => col.unsigned().notNull())
      .addColumn('imported_at', 'datetime', (col) => col.notNull())
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addUniqueConstraint('dd_characters_user_ddb_unique', ['user_id', 'ddb_id'])
      .addForeignKeyConstraint('dd_characters_user_id_fk', ['user_id'], 'dd_users', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createTable('dd_games')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('user_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('name', 'varchar(100)', (col) => col.notNull())
      .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('active'))
      .addColumn('character_id', 'integer', (col) => col.unsigned())
      .addColumn('cover', 'varchar(32)', (col) => col.notNull().defaultTo('pergament'))
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addForeignKeyConstraint('dd_games_user_id_fk', ['user_id'], 'dd_users', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .addForeignKeyConstraint('dd_games_character_id_fk', ['character_id'], 'dd_characters', ['id'], (fk) =>
        fk.onDelete('set null'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createIndex('dd_games_user_id_idx')
      .on('dd_games')
      .columns(['user_id', 'status'])
      .execute();

    await db.schema
      .createTable('dd_game_state')
      .addColumn('game_id', 'integer', (col) => col.unsigned().primaryKey())
      .addColumn('state', 'json', (col) => col.notNull())
      .addColumn('version', 'integer', (col) => col.unsigned().notNull().defaultTo(1))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addForeignKeyConstraint('dd_game_state_game_id_fk', ['game_id'], 'dd_games', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();
  },

  async down(db) {
    await db.schema.dropTable('dd_game_state').ifExists().execute();
    await db.schema.dropTable('dd_games').ifExists().execute();
    await db.schema.dropTable('dd_characters').ifExists().execute();
  },
};

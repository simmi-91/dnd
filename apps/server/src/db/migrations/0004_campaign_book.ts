import type { DdMigration } from '../migrator.ts';
import { ddl } from '../prefix-guard.ts';

// Kampanjeboka (fase 4): dagbok, oppslagsverk og koblinger. Bare nye tabeller, så migreringen er
// bakoverkompatibel med koden fra fase 3. TEXT-kolonner kan ikke ha standardverdi i MySQL 8.0,
// så appen setter `''` på `body`.
export const campaignBook: DdMigration = {
  async up(db) {
    await db.schema
      .createTable('dd_sessions')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('game_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('number', 'integer', (col) => col.unsigned().notNull())
      .addColumn('played_on', 'date', (col) => col.notNull())
      .addColumn('title', 'varchar(200)', (col) => col.notNull().defaultTo(''))
      .addColumn('body', ddl.mediumtext, (col) => col.notNull())
      .addColumn('version', 'integer', (col) => col.unsigned().notNull().defaultTo(1))
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addUniqueConstraint('dd_sessions_game_number_unique', ['game_id', 'number'])
      .addForeignKeyConstraint('dd_sessions_game_id_fk', ['game_id'], 'dd_games', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createIndex('dd_sessions_game_played_idx')
      .on('dd_sessions')
      .columns(['game_id', 'played_on'])
      .execute();

    await db.schema.createFulltextIndex('dd_sessions_fulltext', 'dd_sessions', ['title', 'body']).execute();

    await db.schema
      .createTable('dd_entries')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('game_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('kind', 'varchar(16)', (col) => col.notNull())
      .addColumn('name', 'varchar(200)', (col) => col.notNull())
      .addColumn('summary', 'varchar(500)', (col) => col.notNull().defaultTo(''))
      .addColumn('body', ddl.mediumtext, (col) => col.notNull())
      .addColumn('status', 'varchar(16)')
      .addColumn('fields', 'json', (col) => col.notNull())
      .addColumn('archived', ddl.tinyint1, (col) => col.notNull().defaultTo(0))
      .addColumn('version', 'integer', (col) => col.unsigned().notNull().defaultTo(1))
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addUniqueConstraint('dd_entries_game_kind_name_unique', ['game_id', 'kind', 'name'])
      .addForeignKeyConstraint('dd_entries_game_id_fk', ['game_id'], 'dd_games', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createIndex('dd_entries_game_kind_idx')
      .on('dd_entries')
      .columns(['game_id', 'kind', 'archived'])
      .execute();

    await db.schema
      .createFulltextIndex('dd_entries_fulltext', 'dd_entries', ['name', 'summary', 'body'])
      .execute();

    // Kilden er en økt eller en oppføring, så `source_id` kan ikke ha fremmednøkkel. Appen sletter
    // koblingene når kilden slettes.
    await db.schema
      .createTable('dd_mentions')
      .addColumn('source_type', 'varchar(16)', (col) => col.notNull())
      .addColumn('source_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('entry_id', 'integer', (col) => col.unsigned().notNull())
      .addPrimaryKeyConstraint('dd_mentions_pk', ['source_type', 'source_id', 'entry_id'])
      .addForeignKeyConstraint('dd_mentions_entry_id_fk', ['entry_id'], 'dd_entries', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema.createIndex('dd_mentions_entry_id_idx').on('dd_mentions').column('entry_id').execute();
  },

  async down(db) {
    await db.schema.dropTable('dd_mentions').ifExists().execute();
    await db.schema.dropTable('dd_entries').ifExists().execute();
    await db.schema.dropTable('dd_sessions').ifExists().execute();
  },
};

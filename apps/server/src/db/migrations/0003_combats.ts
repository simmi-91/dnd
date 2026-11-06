import type { DdMigration } from '../migrator.ts';
import { ddl } from '../prefix-guard.ts';

// Kamp (fase 3b). Bare en ny tabell, så migreringen er bakoverkompatibel med koden fra fase 2.
// Maks én aktiv kamp per spill sjekkes i appen, med lås på spillraden.
export const combats: DdMigration = {
  async up(db) {
    await db.schema
      .createTable('dd_combats')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('game_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('active'))
      .addColumn('round', 'integer', (col) => col.unsigned().notNull().defaultTo(0))
      .addColumn('state', 'json', (col) => col.notNull())
      .addColumn('version', 'integer', (col) => col.unsigned().notNull().defaultTo(1))
      .addColumn('started_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('ended_at', 'datetime')
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addForeignKeyConstraint('dd_combats_game_id_fk', ['game_id'], 'dd_games', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createIndex('dd_combats_game_status_idx')
      .on('dd_combats')
      .columns(['game_id', 'status'])
      .execute();
  },

  async down(db) {
    await db.schema.dropTable('dd_combats').ifExists().execute();
  },
};

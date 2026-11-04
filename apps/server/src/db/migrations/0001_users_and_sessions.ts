import type { DdMigration } from '../migrator.ts';
import { ddl } from '../prefix-guard.ts';

export const usersAndSessions: DdMigration = {
  async up(db) {
    await db.schema
      .createTable('dd_users')
      .addColumn('id', 'integer', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('google_sub', 'varchar(255)', (col) => col.notNull())
      .addColumn('email', 'varchar(320)', (col) => col.notNull())
      .addColumn('name', 'varchar(255)', (col) => col.notNull())
      .addColumn('avatar_url', 'varchar(2048)')
      .addColumn('blocked', ddl.tinyint1, (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('updated_at', 'datetime', (col) =>
        col.notNull().defaultTo(ddl.currentTimestamp).modifyEnd(ddl.onUpdateCurrentTimestamp),
      )
      .addColumn('last_login_at', 'datetime')
      .addUniqueConstraint('dd_users_google_sub_unique', ['google_sub'])
      .addUniqueConstraint('dd_users_email_unique', ['email'])
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createTable('dd_auth_sessions')
      .addColumn('id', 'bigint', (col) => col.unsigned().autoIncrement().primaryKey())
      .addColumn('token_hash', 'char(64)', (col) => col.notNull())
      .addColumn('user_id', 'integer', (col) => col.unsigned().notNull())
      .addColumn('user_agent', 'varchar(512)')
      .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(ddl.currentTimestamp))
      .addColumn('expires_at', 'datetime', (col) => col.notNull())
      .addColumn('last_used_at', 'datetime', (col) => col.notNull())
      .addUniqueConstraint('dd_auth_sessions_token_hash_unique', ['token_hash'])
      .addForeignKeyConstraint('dd_auth_sessions_user_id_fk', ['user_id'], 'dd_users', ['id'], (fk) =>
        fk.onDelete('cascade'),
      )
      .modifyEnd(ddl.tableOptions)
      .execute();

    await db.schema
      .createIndex('dd_auth_sessions_expires_at_idx')
      .on('dd_auth_sessions')
      .column('expires_at')
      .execute();
  },

  async down(db) {
    await db.schema.dropTable('dd_auth_sessions').ifExists().execute();
    await db.schema.dropTable('dd_users').ifExists().execute();
  },
};

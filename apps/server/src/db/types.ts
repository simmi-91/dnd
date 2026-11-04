import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/** Tidsstempel med standardverdi i databasen. Lagres som DATETIME i UTC. */
type DefaultTimestamp = ColumnType<Date, Date | undefined, Date>;

export interface DdUsersTable {
  id: Generated<number>;
  google_sub: string;
  email: string;
  name: string;
  avatar_url: string | null;
  /** 0 eller 1 (TINYINT(1)). */
  blocked: ColumnType<number, number | undefined, number>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
  last_login_at: Date | null;
}

export interface DdAuthSessionsTable {
  id: Generated<number>;
  /** sha256 av tokenet, hex (64 tegn). Selve tokenet ligger bare i informasjonskapselen. */
  token_hash: string;
  user_id: number;
  user_agent: string | null;
  created_at: DefaultTimestamp;
  expires_at: Date;
  last_used_at: Date;
}

export interface Database {
  dd_users: DdUsersTable;
  dd_auth_sessions: DdAuthSessionsTable;
}

export type DbUser = Selectable<DdUsersTable>;
export type NewDbUser = Insertable<DdUsersTable>;
export type DbUserUpdate = Updateable<DdUsersTable>;
export type DbAuthSession = Selectable<DdAuthSessionsTable>;

import type { GameState, Sheet } from '@dnd/rules';
import type { GameCover, GameStatus } from '@dnd/shared';
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

/** JSON-kolonne: mysql2 gir objektet ved lesing, og vi skriver JSON-tekst. */
type JsonColumn<T> = ColumnType<T, string, string>;

export interface DdCharactersTable {
  id: Generated<number>;
  user_id: number;
  ddb_id: number;
  name: string;
  summary: string;
  derived: JsonColumn<Sheet>;
  derive_version: number;
  imported_at: Date;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface DdGamesTable {
  id: Generated<number>;
  user_id: number;
  name: string;
  status: ColumnType<GameStatus, GameStatus | undefined, GameStatus>;
  character_id: number | null;
  cover: ColumnType<GameCover, GameCover | undefined, GameCover>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface DdGameStateTable {
  game_id: number;
  state: JsonColumn<GameState>;
  version: ColumnType<number, number | undefined, number>;
  updated_at: DefaultTimestamp;
}

export interface Database {
  dd_users: DdUsersTable;
  dd_auth_sessions: DdAuthSessionsTable;
  dd_characters: DdCharactersTable;
  dd_games: DdGamesTable;
  dd_game_state: DdGameStateTable;
}

export type DbCharacter = Selectable<DdCharactersTable>;
export type DbGame = Selectable<DdGamesTable>;

export type DbUser = Selectable<DdUsersTable>;
export type NewDbUser = Insertable<DdUsersTable>;
export type DbUserUpdate = Updateable<DdUsersTable>;
export type DbAuthSession = Selectable<DdAuthSessionsTable>;

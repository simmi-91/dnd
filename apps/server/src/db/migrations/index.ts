import type { DdMigration } from '../migrator.ts';
import { usersAndSessions } from './0001_users_and_sessions.ts';
import { charactersAndGames } from './0002_characters_and_games.ts';
import { combats } from './0003_combats.ts';

/**
 * Alle migreringer, i kode, så de virker etter bundling. Navnene sorteres alfabetisk.
 * Nye migreringer legges til nederst med neste nummer.
 */
export const migrations: Record<string, DdMigration> = {
  '0001_users_and_sessions': usersAndSessions,
  '0002_characters_and_games': charactersAndGames,
  '0003_combats': combats,
};

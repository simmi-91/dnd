import type { User } from '@dnd/shared';
import type { Db } from '../db/index.ts';
import type { DbUser } from '../db/types.ts';
import type { GoogleIdentity } from './google.ts';

export function toApiUser(user: DbUser): User {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url };
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ER_DUP_ENTRY';
}

async function findBy(db: Db, column: 'google_sub' | 'email', value: string): Promise<DbUser | undefined> {
  return db.selectFrom('dd_users').selectAll().where(column, '=', value).executeTakeFirst();
}

async function byId(db: Db, id: number): Promise<DbUser> {
  return db.selectFrom('dd_users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

/** E-posten tilhører en bruker med en annen (ekte) Google-konto. Gir 409. */
export class AccountConflictError extends Error {
  override name = 'AccountConflictError';
  constructor() {
    super('E-postadressen er knyttet til en annen Google-konto');
  }
}

const DEV_SUB_PREFIX = 'dev:';

/**
 * Finner brukeren via Google `sub` og oppdaterer navn, e-post og bilde. Finnes ingen med
 * den `sub`-en, kobles e-posten bare til en bruker som er laget med dev-login
 * (`google_sub` begynner med `dev:`). En ekte Google-konto overskrives aldri: da kastes
 * `AccountConflictError`. E-posten må være bekreftet av Google før denne kalles.
 */
export async function upsertGoogleUser(db: Db, identity: GoogleIdentity, now: Date): Promise<DbUser> {
  const email = identity.email.toLowerCase();
  const name = identity.name?.trim() || email.split('@')[0] || email;
  const fields = { google_sub: identity.sub, email, name, avatar_url: identity.picture, last_login_at: now };

  const update = async (id: number, where: { google_sub: string }) => {
    try {
      const result = await db
        .updateTable('dd_users')
        .set(fields)
        .where('id', '=', id)
        .where('google_sub', '=', where.google_sub)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new AccountConflictError();
    } catch (error) {
      // Den nye e-posten brukes allerede av en annen bruker.
      if (isDuplicateKey(error)) throw new AccountConflictError();
      throw error;
    }
    return byId(db, id);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const bySub = await findBy(db, 'google_sub', identity.sub);
    if (bySub) return update(bySub.id, bySub);

    const byEmail = await findBy(db, 'email', email);
    if (byEmail) {
      if (!byEmail.google_sub.startsWith(DEV_SUB_PREFIX)) throw new AccountConflictError();
      return update(byEmail.id, byEmail);
    }

    try {
      const result = await db.insertInto('dd_users').values(fields).executeTakeFirstOrThrow();
      return byId(db, Number(result.insertId));
    } catch (error) {
      // To samtidige innlogginger kan begge prøve å lage brukeren. Prøv igjen én gang.
      if (attempt === 0 && isDuplicateKey(error)) continue;
      throw error;
    }
  }
  throw new Error('Kunne ikke lagre brukeren');
}

/** Henter eller lager brukeren for dev-login. Bare for lokal utvikling. */
export async function upsertDevUser(db: Db, rawEmail: string, now: Date): Promise<DbUser> {
  const email = rawEmail.toLowerCase();
  const existing = await findBy(db, 'email', email);
  if (existing) {
    await db.updateTable('dd_users').set({ last_login_at: now }).where('id', '=', existing.id).execute();
    return byId(db, existing.id);
  }
  try {
    const result = await db
      .insertInto('dd_users')
      .values({ google_sub: `dev:${email}`, email, name: email.split('@')[0] || email, last_login_at: now })
      .executeTakeFirstOrThrow();
    return byId(db, Number(result.insertId));
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const user = await findBy(db, 'email', email);
    if (!user) throw error;
    return user;
  }
}

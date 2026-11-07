import mysql from 'mysql2/promise';

/** Sletter og lager e2e-databasen på nytt. Rører bare databasen som `env.DB_NAME` peker på. */
export async function recreateDatabase(env, { createAgain }) {
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD ?? '',
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
    if (createAgain) {
      await conn.query(`CREATE DATABASE \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
  } finally {
    await conn.end();
  }
}

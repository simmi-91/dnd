// Startes av Playwright (webServer): nullstiller e2e-databasen, kjører migreringene og starter
// den bygde serveren som også serverer den bygde nettsiden (med service worker).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { recreateDatabase } from './db.mjs';
import { e2eEnv, root } from './env.mjs';

const env = e2eEnv();
for (const f of ['apps/server/dist/index.js', 'apps/server/dist/migrate.js', 'apps/web/dist/index.html']) {
  if (!existsSync(resolve(root, f))) {
    console.error(`Mangler ${f}. Kjør «npm run build» først (eller bruk «npm run e2e»).`);
    process.exit(1);
  }
}

await recreateDatabase(env, { createAgain: true });
const migrate = spawnSync(process.execPath, [resolve(root, 'apps/server/dist/migrate.js')], {
  env,
  stdio: 'inherit',
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

Object.assign(process.env, env);
await import(resolve(root, 'apps/server/dist/index.js'));

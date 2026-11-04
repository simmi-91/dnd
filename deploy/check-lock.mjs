// Sammenligner serverens lockfil (laget i CI) med rot-lockfilen.
// Bruk: node deploy/check-lock.mjs <server-lockfil> <rot-lockfil>
// Feiler (exit 1) hvis en pakke i serverens lockfil har en versjon som ikke
// finnes i rot-lockfilen, eller hvis en pakke mangler der. Da ville
// produksjon fått andre versjoner enn dem som ble testet.
import { readFileSync } from 'node:fs';

const [serverPath, rootPath] = process.argv.slice(2);
if (!serverPath || !rootPath) {
  console.error('Bruk: node deploy/check-lock.mjs <server-lockfil> <rot-lockfil>');
  process.exit(2);
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8')).packages ?? {};
const nameOf = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

// Rotens versjoner per pakkenavn
const rootVersions = new Map();
for (const [key, pkg] of Object.entries(read(rootPath))) {
  if (!key.includes('node_modules/') || !pkg.version) continue;
  const name = nameOf(key);
  if (!rootVersions.has(name)) rootVersions.set(name, new Set());
  rootVersions.get(name).add(pkg.version);
}

let checked = 0;
const problems = [];
for (const [key, pkg] of Object.entries(read(serverPath))) {
  if (!key.includes('node_modules/') || !pkg.version) continue;
  checked++;
  const name = nameOf(key);
  const versions = rootVersions.get(name);
  if (!versions) problems.push(`${name}@${pkg.version}: finnes ikke i rot-lockfilen`);
  else if (!versions.has(pkg.version))
    problems.push(`${name}@${pkg.version}: rot har ${[...versions].join(', ')}`);
}

if (checked === 0) {
  console.error('Fant ingen pakker i serverens lockfil.');
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`Lockfilen avviker fra rot-lockfilen (${problems.length} av ${checked}):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`OK: ${checked} pakker har samme versjon som i rot-lockfilen.`);

// Bygger serveren med esbuild til dist/index.js og dist/migrate.js (ESM, node22).
// @dnd/*-pakkene bundles inn. Tredjepartspakker holdes eksterne, og dist/package.json
// får nøyaktig de eksterne pakkene som faktisk importeres, med installert versjon.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'dist');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Navnet på pakken i en import-sti (`@a/b/c` → `@a/b`, `a/b` → `a`). */
const packageName = (spec) => {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** Finner installert versjon ved å lete etter node_modules/<navn>/package.json oppover. */
const installedVersion = (name) => {
  let dir = here;
  for (;;) {
    const file = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(file)) return readJson(file).version;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Fant ikke installert versjon av ${name}`);
    dir = parent;
  }
};

const isWorkspace = (name) => name.startsWith('@dnd/');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: {
    index: resolve(here, 'src/index.ts'),
    migrate: resolve(here, 'src/db/migrate-cli.ts'),
  },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  metafile: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-third-party',
      setup(b) {
        // Alt som ikke er en relativ/absolutt sti, node:-modul eller @dnd/*, holdes eksternt.
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('node:')) return { path: args.path, external: true };
          if (isWorkspace(packageName(args.path))) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

const builtins = new Set((await import('node:module')).builtinModules);
const externals = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const imp of output.imports) {
    if (!imp.external) continue;
    if (imp.path.startsWith('node:') || builtins.has(imp.path)) continue;
    externals.add(packageName(imp.path));
  }
}

const dependencies = Object.fromEntries([...externals].sort().map((name) => [name, installedVersion(name)]));
const serverPkg = readJson(join(here, 'package.json'));
const distPkg = {
  name: 'dnd-server',
  version: serverPkg.version,
  private: true,
  type: 'module',
  engines: { node: '>=22' },
  dependencies,
};
writeFileSync(join(outdir, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);
console.log('dist/package.json:', dependencies);

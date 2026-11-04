#!/usr/bin/env node
// Henter et D&D Beyond-karakterark og lagrer det anonymisert som fixture.
// Bruk: node scripts/fetch-fixture.mjs <ddb-id-eller-lenke | --file sti> <utnavn> [--fake-id N]
// Skriver aldri ekte ID-er eller innhold til stdout.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://character-service.dndbeyond.com/character/v5/character/';
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  let file = null;
  let fakeId = 1000001;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') file = argv[++i];
    else if (argv[i] === '--fake-id') fakeId = Number(argv[++i]);
    else positional.push(argv[i]);
  }
  if (!Number.isInteger(fakeId) || fakeId <= 0) fail('--fake-id må være et positivt heltall.');
  const [source, outName] = file ? [null, positional[0]] : positional;
  if (!outName || !/^[\w-]+$/.test(outName) || (!file && !source)) {
    fail('Bruk: node scripts/fetch-fixture.mjs <ddb-id-eller-lenke | --file sti> <utnavn> [--fake-id N]');
  }
  return { source, file, outName, fakeId };
}

async function load({ source, file }) {
  if (file) {
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const match = /(\d{4,})\s*\/?\s*(?:[?#].*)?$/.exec(source);
  if (!match) fail('Fant ingen karakter-ID i argumentet.');
  const res = await fetch(API + match[1], { headers: { 'User-Agent': 'dnd-kampguide (fixture)' } });
  if (res.status === 403) fail('Karakteren er privat. Sett den til offentlig i D&D Beyond og prøv igjen.');
  if (res.status === 404) fail('Fant ikke karakteren.');
  if (!res.ok) fail(`Henting feilet (HTTP ${res.status}).`);
  return res.json();
}

const ID_KEYS = new Set(['userid', 'ownerid', 'campaignid']);
const NAME_KEYS = new Set(['username', 'socialname']);

// Samler ID-er som må ut, og nøytraliserer personfelt.
function neutralize(node, secrets, inDecorations = false) {
  if (Array.isArray(node)) {
    node.forEach((v) => neutralize(v, secrets, inDecorations));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const value = node[key];
    if (lower === 'readonlyurl') {
      delete node[key];
    } else if (lower === 'campaign') {
      collectIds(value, secrets);
      node[key] = null;
    } else if (ID_KEYS.has(lower)) {
      if (value != null && typeof value !== 'object') secrets.add(String(value));
      node[key] = 0;
    } else if (NAME_KEYS.has(lower)) {
      if (typeof value === 'string' && value.length >= 3) secrets.add(value);
      node[key] = 'player';
    } else if (inDecorations && typeof value === 'string' && /url$/i.test(key)) {
      node[key] = null;
    } else if (
      inDecorations &&
      /(id|decorationkey)$/i.test(key) &&
      (value == null || typeof value !== 'object')
    ) {
      // Avatar- og bakgrunns-ID-er kan spores tilbake til kontoen.
      node[key] = null;
    } else {
      neutralize(value, secrets, inDecorations || lower === 'decorations');
    }
  }
}

function collectIds(node, secrets) {
  if (Array.isArray(node)) return node.forEach((v) => collectIds(v, secrets));
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (ID_KEYS.has(k.toLowerCase()) || k.toLowerCase() === 'id') {
      if (typeof v === 'number' || typeof v === 'string') secrets.add(String(v));
    }
    collectIds(v, secrets);
  }
}

const args = parseArgs(process.argv.slice(2));
const raw = await load(args);
const data = raw.data ?? raw;
const realId = data.id != null ? String(data.id) : null;
if (!realId) fail('Fant ingen data.id i svaret.');

const secrets = new Set();
neutralize(raw, secrets);
// Kampanje-ID-er kan være korte tall; bare lange verdier erstattes som tekst.
const textSecrets = [...secrets].filter((s) => s.length >= 6 && s !== '0');

let text = JSON.stringify(raw);
text = text.split(realId).join(String(args.fakeId));
for (const s of textSecrets) text = text.split(s).join('0');
const out = JSON.stringify(JSON.parse(text), null, 2) + '\n';

// Siste sikkerhetssjekk: ingenting ekte skal være igjen.
for (const s of [realId, ...textSecrets]) {
  if (out.includes(s)) fail('Avbrøt: en ekte ID finnes fortsatt i utdataene. Ingenting ble skrevet.');
}

await mkdir(fixturesDir, { recursive: true });
const target = join(fixturesDir, `${args.outName}.json`);
await writeFile(target, out);
console.log(`Lagret fixtures/${args.outName}.json (${Math.round(Buffer.byteLength(out) / 1024)} kB)`);

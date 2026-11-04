import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type { Db } from './db/index.ts';
import { fakeGoogle, freshTestDb, testConfig } from './test/helpers.ts';

const INDEX = '<!doctype html><title>dnd</title>';
let db: Db;
let webDir: string;
let app: FastifyInstance;

beforeAll(async () => {
  db = await freshTestDb(testConfig());
  webDir = mkdtempSync(join(tmpdir(), 'dnd-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), INDEX);
  writeFileSync(join(webDir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(webDir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);');
  app = await buildApp(testConfig({ WEB_DIR: webDir }), {
    db,
    logger: false,
    verifyGoogleToken: fakeGoogle(),
  });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  if (webDir) rmSync(webDir, { recursive: true, force: true });
});

describe('nettsiden fra WEB_DIR', () => {
  it('serverer index.html på / med no-cache', async () => {
    const res = await app.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('gir /assets/* lang cache', async () => {
    const res = await app.inject('/assets/index-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1);');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('gir sw.js og index.html no-cache', async () => {
    const sw = await app.inject('/sw.js');
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    const index = await app.inject('/index.html');
    expect(index.headers['cache-control']).toBe('no-cache');
  });

  it('serverer andre filer', async () => {
    const res = await app.inject('/favicon.svg');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<svg/>');
  });

  it('gir index.html for ukjente sider (SPA-fallback)', async () => {
    for (const url of ['/spill/42', '/spill/42/kamp?x=1', '/innstillinger']) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toBe(INDEX);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('gir 404 for manglende filer i stedet for index.html', async () => {
    expect((await app.inject('/assets/finnes-ikke.js')).statusCode).toBe(404);
    expect((await app.inject('/finnes-ikke.png')).statusCode).toBe(404);
  });

  it('gir ikke index.html for /api eller andre metoder', async () => {
    for (const url of ['/api/finnes-ikke', '/API/finnes-ikke', '/%61pi/finnes-ikke', '//api/x', '/api']) {
      const api = await app.inject(url);
      expect(api.statusCode, url).toBe(404);
      expect(api.headers['content-type'], url).toMatch(/application\/json/);
      expect(api.json()).toEqual({ error: 'not_found', message: 'Fant ikke ressursen' });
    }
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true, db: true });
    // Skrivende kall utenfor /api: 403 uten header, 404 med (aldri index.html).
    expect((await app.inject({ method: 'POST', url: '/spill/42' })).statusCode).toBe(403);
    const post = await app.inject({
      method: 'POST',
      url: '/spill/42',
      headers: { 'x-requested-with': 'dnd' },
    });
    expect(post.statusCode).toBe(404);
    expect(post.body).not.toContain('<!doctype');
  });
});

describe('uten WEB_DIR', () => {
  it('gir 404 på /', async () => {
    const plain = await buildApp(testConfig(), { db, logger: false });
    try {
      expect((await plain.inject('/')).statusCode).toBe(404);
    } finally {
      await plain.close();
    }
  });
});

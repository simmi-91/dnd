import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/**
 * Serverer den bygde nettsiden fra `webDir`. Filer under `/assets/` har hash i navnet og
 * caches i et år. Alt annet (blant annet `index.html` og `sw.js`) får `no-cache`.
 */
export async function registerWeb(app: FastifyInstance, webDir: string): Promise<void> {
  const root = resolve(webDir);
  if (!existsSync(resolve(root, 'index.html'))) {
    app.log.warn('WEB_DIR mangler index.html. Nettsiden vil gi 404.');
  }

  await app.register(fastifyStatic, {
    root,
    wildcard: true,
    index: ['index.html'],
    cacheControl: false,
    etag: true,
    lastModified: true,
    dotfiles: 'ignore',
    setHeaders: (reply, path) => {
      const rel = relative(root, path).split(sep).join('/');
      reply.header('cache-control', rel.startsWith('assets/') ? IMMUTABLE : NO_CACHE);
    },
  });
}

/** Ser stien ut som en fil (har filendelse, eller ligger under /assets/)? */
function looksLikeFile(pathname: string): boolean {
  if (pathname.startsWith('/assets/')) return true;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last.includes('.');
}

/** SPA-fallback: andre GET-kall som ikke er /api og ikke er filer, får index.html. */
export function trySpaFallback(request: FastifyRequest, reply: FastifyReply, webDir: string | null) {
  if (!webDir) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const pathname = request.url.split('?')[0] ?? '/';
  if (looksLikeFile(pathname)) return null;
  return reply.header('cache-control', NO_CACHE).type('text/html; charset=utf-8').sendFile('index.html');
}

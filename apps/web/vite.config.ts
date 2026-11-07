import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Versjon, commit og byggetid vises på Konto-siden. Vite tar med VITE_-variabler fra process.env.
// Byggetiden gjør også at hver utrulling gir en ny sw.js, og dermed meldingen «Ny versjon».
function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
process.env.VITE_APP_VERSION = pkg.version;
process.env.VITE_BUILD_SHA = commitSha();
process.env.VITE_BUILD_TIME = new Date().toISOString();

// Farger fra src/styles/global.css (--bg og --ink).
const BG = '#f3ead8';
const INK = '#2b2118';

export default defineConfig({
  // Ikonene ligger i `assets/` i rota av repoet og kopieres til rota av bygget.
  publicDir: '../../assets',
  plugins: [
    react(),
    VitePWA({
      // Ny versjon tas i bruk først når brukeren trykker «Last inn på nytt» (ikke midt i en kamp).
      registerType: 'prompt',
      // Registreringen ligger i src/main.tsx.
      injectRegister: false,
      filename: 'sw.js',
      manifestFilename: 'manifest.webmanifest',
      // Ikonene kommer med i precache gjennom globPatterns under.
      includeManifestIcons: false,
      manifest: {
        name: 'D&D kampguide',
        short_name: 'Kampguide',
        description: 'Kampguide og kampanjebok for D&D 5e',
        lang: 'nb',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: BG,
        theme_color: INK,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App-skallet: kode, stiler, skrifter og ikoner.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        navigateFallback: '/index.html',
        // API-et og opplastede bilder skal aldri få index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/img\//],
        cleanupOutdatedCaches: true,
        // API-svar caches ikke av service workeren. Ark, kamp og spill lagres i appen (src/offline/),
        // så de kan slettes ved utlogging.
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8032',
    },
  },
});

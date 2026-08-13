// Build config for the phone build — the same source, without the extension.
//
// Kept separate from vite.config.ts rather than folded into it with a mode flag,
// because the two builds disagree about almost everything: this one has no
// manifest, no CRXJS, no content scripts and no service-worker-as-background,
// and it needs a base path because GitHub Pages serves projects from a
// subdirectory.
//
// `root` is web/, so index.html sits next to nothing else and the entry it points
// at (../src/web/main.tsx) is shared source.

import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// GitHub Pages serves a project site from /<repo>/, so relative URLs need the
// prefix baked in at build time. The Pages workflow sets this from the repo name;
// a local `yarn build:web` gets the root and works under `yarn preview:web`.
const BASE = process.env.LUGIN_BASE_PATH ?? '/';

const NAME = 'Lugin';
const THEME = '#0b1017';

/**
 * The two files a browser needs before it will treat this as an installable app.
 *
 * Emitted rather than kept in public/, because public/ is shared with the
 * extension build and neither of these belongs in a Chrome Web Store package.
 */
const pwaAssets = (): Plugin => ({
  generateBundle() {
    this.emitFile({
      fileName: 'manifest.webmanifest',
      source: JSON.stringify(
        {
          background_color: THEME,
          description: 'Read your Lugin collection and decks on your phone.',
          display: 'standalone',
          icons: [
            { sizes: '192x192', src: `${BASE}icons/icon-192.png`, type: 'image/png' },
            { sizes: '512x512', src: `${BASE}icons/icon-512.png`, type: 'image/png' },
            {
              purpose: 'maskable',
              sizes: '512x512',
              src: `${BASE}icons/icon-maskable-512.png`,
              type: 'image/png',
            },
          ],
          name: NAME,
          orientation: 'portrait',
          scope: BASE,
          short_name: NAME,
          start_url: BASE,
          theme_color: THEME,
        },
        null,
        2,
      ),
      type: 'asset',
    });

    // Network-first, cache only as an offline fallback. A cache-first shell would
    // hand testers yesterday's build and make every bug report a guess.
    this.emitFile({
      fileName: 'sw.js',
      source: `const SHELL = '${BASE}';
const CACHE = 'lugin-shell-v1';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        caches.open(CACHE).then(cache => cache.put(SHELL, response.clone())).catch(() => {});
        return response;
      })
      .catch(() => caches.match(SHELL).then(hit => hit ?? Response.error())),
  );
});
`,
      type: 'asset',
    });
  },
  name: 'lugin:pwa-assets',
});

export default defineConfig({
  base: BASE,
  build: {
    emptyOutDir: true,
    outDir: '../dist-web',
    // Unlike the extension, nothing here imports chunks by a fixed name, so the
    // default hashed filenames are right: a Pages deploy wants cache-busting.
    sourcemap: true,
    target: 'es2020',
  },
  plugins: [react(), pwaAssets()],
  publicDir: '../public',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  root: 'web',
  server: {
    fs: {
      // The entry and everything it imports live above web/.
      allow: ['..'],
    },
    host: true,
    port: 5174,
  },
});

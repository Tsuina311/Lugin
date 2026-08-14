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

import { buildVersion } from './build/version';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// Which build is this, in words the app can show.
//
// Worth the trouble because the phone build is served over a service worker:
// after a deploy you reload and get *something*, and there is otherwise no way to
// tell the new code from a cached shell — so "did my fix reach the phone?" becomes
// guesswork, and every bug report after it is suspect.
const BUILD = buildVersion(ROOT);

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
          description: 'Your collection and decks on your phone, and ManaBox imports into them.',
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
          // Put Lugin in Android's share sheet, so a ManaBox export can go
          // straight from the export screen into the import review. Without this
          // the only route is "save it somewhere, then find it again in a file
          // picker", which is several taps and a small act of faith on the device
          // where nearly every import is going to start.
          //
          // POST with multipart/form-data because this shares a *file*; the
          // service worker answers `action` and hands the file to the app. The
          // accept list is as generous as the file input's, and for the same
          // reason: Android's idea of a CSV's type varies by which app produced it.
          share_target: {
            action: `${BASE}share`,
            enctype: 'multipart/form-data',
            method: 'POST',
            params: {
              files: [
                {
                  accept: [
                    'text/csv',
                    'text/plain',
                    'text/tab-separated-values',
                    'text/comma-separated-values',
                    'application/csv',
                    'application/vnd.ms-excel',
                    'application/octet-stream',
                    '.csv',
                    '.txt',
                    '.tsv',
                  ],
                  name: 'file',
                },
              ],
              text: 'text',
              title: 'title',
            },
          },
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
    //
    // It also receives shared files, because a share target's action has to be
    // answered by *something* and a static host can't answer a POST.
    //
    // Two things to remember when editing the worker below: it is a template
    // literal, so a dollar-brace meant for the browser is evaluated here at build
    // time instead — and a backtick anywhere in it, including in a comment,
    // silently ends the string.
    this.emitFile({
      fileName: 'sw.js',
      source: `const SHELL = '${BASE}';
const SHARE = '${BASE}share';

// Named after the build, so the sweep on activation drops the previous one and
// the offline fallback can never be a shell from two deploys ago.
const CACHE = 'lugin-shell-${BUILD.id}';

// Shared files wait here for the page to collect them. A cache of its own so the
// sweep below can't mistake it for a stale shell, and it is named in that sweep's
// allowlist for the same reason.
const INBOX = 'lugin-share-inbox';
const INBOX_KEY = SHELL + 'shared-import';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE && key !== INBOX).map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Stash the file, then send the browser to the app with a GET.
const receiveShare = async request => {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (file && typeof file.text === 'function') {
      const body = JSON.stringify({
        at: Date.now(),
        name: file.name || 'shared.csv',
        text: await file.text(),
      });
      const cache = await caches.open(INBOX);
      await cache.put(INBOX_KEY, new Response(body, {
        headers: { 'content-type': 'application/json' },
      }));
    }
  } catch (error) {
    // A share we can't read still has to land the user in the app rather than on
    // a browser error page, where the file would look like it had vanished. The
    // file picker is right there once they arrive.
  }
  // 303 so the browser follows with a GET: left as the POST it arrived as, a
  // reload would re-submit the share.
  return Response.redirect(new URL(SHELL + '?shared=1', self.location.href).href, 303);
};

self.addEventListener('fetch', event => {
  const request = event.request;
  // A share is itself a navigation, so this has to come before the branch below —
  // which would otherwise put a multipart POST to a static host and get a 405.
  if (request.method === 'POST' && new URL(request.url).pathname === SHARE) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.mode !== 'navigate') return;
  // Revalidate rather than trust the phone's own HTTP cache. GitHub Pages serves
  // this page with max-age=600, so a plain fetch can be answered locally for ten
  // minutes after a deploy — meaning a relaunch to check whether a fix is live
  // could truthfully show the build before it. 'no-cache' still sends the ETag,
  // so an unchanged page costs a 304 and nothing more.
  //
  // A URL rather than the request: constructing one from a navigation is where
  // engines disagree, and this is a same-origin GET of our own shell.
  event.respondWith(
    fetch(request.url, { cache: 'no-cache' })
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
  // Read by the app to show which build is running. Defined rather than left to
  // an .env file so it can't go stale or be forgotten in CI.
  define: {
    'import.meta.env.VITE_LUGIN_BUILD': JSON.stringify(BUILD.label),
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

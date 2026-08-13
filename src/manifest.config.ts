import { defineManifest } from '@crxjs/vite-plugin';
import { loadEnv } from 'vite';

import pkg from '../package.json';

// ---------------------------------------------------------------------------
// EXTENSION IDENTITY
// ---------------------------------------------------------------------------
// The Google sign-in redirect is `https://<extension-id>.chromiumapp.org/`, and
// Google matches it exactly, so the id has to stop moving. An unpacked build
// gets a random id on every fresh load; `key` (the *public* key of the store
// item, from the dashboard's Package tab) pins it to the published one instead.
//
// The store rejects any upload whose manifest carries `key`, so it is only ever
// present in local builds — `yarn package` strips it back out for the zip. See
// docs/DISTRIBUTION.md.
//
// Read through loadEnv rather than import.meta.env: this file is config, it runs
// in node before the client env exists.
const EXTENSION_KEY = loadEnv('production', process.cwd(), '')
  .LUGIN_EXTENSION_KEY?.replace(/\s+/g, '');

// ---------------------------------------------------------------------------
// TARGET SITE CONFIGURATION
// ---------------------------------------------------------------------------
// Focused on Cardmarket for now. Add more origins here as you bring in other
// Magic metadata sites (and register a matching SiteAdapter in
// src/sites/registry.ts). Narrow matches keep the overlay + permissions scoped.
const TARGET_MATCHES = ['https://www.cardmarket.com/*'];

// Generated from the source artwork by scripts/make-logos.mjs. They live in
// public/ so they land at the root of the build untouched — Chrome reads the
// toolbar icon before any of our code runs.
const ICONS = {
  128: 'icons/icon-128.png',
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
};

export default defineManifest({
  action: {
    default_icon: ICONS,
    default_title: 'Toggle Lugin overlay',
  },

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  content_scripts: [
    {
      all_frames: false,

      js: ['src/interceptor/main.ts'],
      // MAIN world: runs in the page's own JS context so it can replace the
      // page's fetch / XMLHttpRequest and read real request + response bodies.
      matches: TARGET_MATCHES,
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      all_frames: false,

      js: ['src/content/index.tsx'],
      // ISOLATED world (default): mounts the React overlay and bridges messages
      // between the page interceptor and the extension.
      matches: TARGET_MATCHES,
      run_at: 'document_idle',
    },
  ],

  description: pkg.description,

  // host_permissions lets the background service worker call the target API
  // (and third-party APIs) without being blocked by page-level CORS.
  // Scryfall provides free Magic card metadata used for enrichment/filtering.
  // help.cardmarket.com hosts the public shipping-cost calculator API.
  // json.edhrec.com serves EDHREC's commander recommendation data (it sends no
  // CORS headers, so the fetch has to happen in the worker).
  // www.mtggoldfish.com archetype pages give per-archetype card breakdowns and
  // deck lists (HTML — parsed, since Goldfish exposes no API).
  // googleapis.com is the Drive appDataFolder the user's own data syncs
  // through, and oauth2.googleapis.com is only used to hand the token back when
  // they disconnect. The sign-in window itself needs no host permission: Chrome
  // owns that flow.
  host_permissions: [
    ...TARGET_MATCHES,
    'https://help.cardmarket.com/*',
    'https://api.scryfall.com/*',
    'https://json.edhrec.com/*',
    'https://www.mtggoldfish.com/*',
    'https://www.googleapis.com/*',
    'https://oauth2.googleapis.com/*',
  ],

  icons: ICONS,

  ...(EXTENSION_KEY ? { key: EXTENSION_KEY } : {}),

  manifest_version: 3,

  // The "(BETA)" suffix is not decoration: the store requires a test build to
  // say so in its name and description before it will review a private item.
  // Drop it here and in the store listing on the day this goes public.
  name: 'Lugin — Custom UI Layer (BETA)',

  // `unlimitedStorage` lifts the 10 MB chrome.storage.local cap so large
  // collections + their cached Scryfall metadata/prices never hit the quota.
  // `identity` is only used for the Google sign-in window; it grants nothing on
  // its own, and no flow starts unless the user asks for one.
  permissions: ['storage', 'unlimitedStorage', 'identity'],

  version: pkg.version,

  web_accessible_resources: [
    {
      matches: TARGET_MATCHES,
      // icons/* so the overlay's wordmark, which the page itself loads once we
      // put the <img> in its DOM, isn't blocked as an extension-internal file.
      //
      // `assets/*` covers the built chunks — but crxjs also resolves these globs
      // against the project directory and copies whatever matches, so anything
      // put in a top-level assets/ folder gets shipped inside the extension
      // whether or not a line of code imports it. That is why the source artwork
      // lives in artwork/ instead: as assets/, it added 800 KB of unread PNGs to
      // every package.
      resources: ['assets/*', 'icons/*', 'src/interceptor/main.ts'],
    },
  ],
});

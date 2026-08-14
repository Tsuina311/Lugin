// Does the phone app render at all? (`yarn test:web`)
//
// Not a substitute for opening it on a phone, and not trying to be: it server-
// renders each screen with fabricated data to catch the failures that don't need
// a device — a bad import, a component that throws on empty data, a reused helper
// whose shape drifted. Those are exactly the ones that otherwise show up as a
// blank screen after a deploy.
//
// Built through vite so the `@/` aliases and TSX resolve the same way they do in
// the real build, which is also what makes it free of test dependencies.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToString } from 'react-dom/server';

import { App } from '../src/web/App';
import { CollectionView } from '../src/web/CollectionView';
import { DeckList } from '../src/web/DeckList';
import { ImportScreen } from '../src/web/ImportScreen';
import { PRICES_CACHE } from '../src/web/priceStore';
import { SHARE_INBOX, SHARE_KEY_PATH } from '../src/web/sharedImport';

import { buildCollection } from '@/lib/collection';
import type { Deck } from '@/lib/deck';
import { inspectImport } from '@/lib/import';
import { ImportReview } from '@/ui/components/ImportReview';

const collection = buildCollection(
  [
    { foil: false, name: 'Sol Ring', quantity: 2 },
    { foil: true, name: 'Llanowar Elves', quantity: 1 },
    { foil: false, name: 'Forest', quantity: 12 },
  ],
  'smoke.csv',
  'list',
  Date.now(),
);

const decks: Deck[] = [
  {
    cards: [
      { name: 'Sol Ring', quantity: 1, section: 'main' },
      { name: 'Rhystic Study', quantity: 1, section: 'main' },
      { name: 'Talrand, Sky Summoner', quantity: 1, section: 'commander' },
    ],
    createdAt: Date.now(),
    format: 'commander',
    id: 'deck-1',
    name: 'Talrand Tokens',
    source: 'manual',
    updatedAt: Date.now(),
  },
];

// A ManaBox export holding one binder and one deck, so the review has both a
// kind toggle and a duplicate to show (Sol Ring is already in `collection`).
const manabox = inspectImport(
  [
    'Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Binder Name,Binder Type',
    'Sol Ring,ltr,123,normal,1,abc-1,Main binder,binder',
    'Rhystic Study,cmr,90,foil,1,abc-2,Main binder,binder',
    'Talrand,dtk,71,normal,1,abc-3,Talrand deck,deck',
  ].join('\n'),
);

const checks: [string, () => string][] = [
  ['App', () => renderToString(<App />)],
  [
    'ImportReview',
    () =>
      renderToString(
        <ImportReview
          existing={collection.cards}
          inspection={manabox}
          onCancel={() => {}}
          onConfirm={() => {}}
          source="ManaBox_Collection.csv"
        />,
      ),
  ],
  [
    'ImportReview (nothing readable)',
    () =>
      renderToString(
        <ImportReview
          existing={[]}
          inspection={inspectImport('')}
          onCancel={() => {}}
          onConfirm={() => {}}
          source="empty.csv"
        />,
      ),
  ],
  [
    'ImportScreen',
    () =>
      renderToString(
        <ImportScreen existing={collection.cards} onImport={() => Promise.resolve()} />,
      ),
  ],
  ['CollectionView', () => renderToString(<CollectionView collection={collection} />)],
  ['CollectionView (empty)', () => renderToString(<CollectionView collection={null} />)],
  ['DeckList', () => renderToString(<DeckList collection={collection} decks={decks} />)],
  ['DeckList (empty)', () => renderToString(<DeckList collection={collection} decks={[]} />)],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    const html = run();
    if (!html.includes('<')) throw new Error('rendered nothing');
    console.log(`  ok  ${name} (${html.length} chars)`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Prove the missing-cards maths the deck screen leans on actually fires.
// React separates adjacent text nodes with comment markers when server-rendering,
// so those come out before matching on visible text.
const html = renderToString(<DeckList collection={collection} decks={decks} />).replace(
  /<!--.*?-->/g,
  '',
);
console.log(`\n  deck row markup:\n${html}\n`);
if (!html.includes('2 missing')) {
  failed += 1;
  console.log('  FAIL  shortfall badge missing from deck row');
} else {
  console.log('  ok  shortfall badge shows 2 missing (Rhystic Study, Talrand)');
}

// The phone must not be a one-way door: ManaBox can share a scan in, so both
// screens have to offer a way back out. Save rather than Share, because a share
// sheet is the one route that can't reach ManaBox — and it's also the one that
// isn't rendered here, since asking the platform about it needs a browser.
const view = renderToString(<CollectionView collection={collection} />);
if (!view.includes('>Save<')) {
  failed += 1;
  console.log('  FAIL  no way to get the collection out of the app');
} else {
  console.log('  ok  the collection can be saved as a file');
}

// The review is the one screen that must never quietly agree to something, so
// assert it says what it found rather than merely rendering without throwing.
const review = renderToString(
  <ImportReview
    existing={collection.cards}
    inspection={manabox}
    onCancel={() => {}}
    onConfirm={() => {}}
    source="ManaBox_Collection.csv"
  />,
).replace(/<!--.*?-->/g, '');

const says: [string, string][] = [
  ['the ordinary binder is named', 'Main binder'],
  ['the deck binder is named', 'Talrand deck'],
  ['ManaBox’s own marking is quoted back', 'as a deck'],
  ['the card you already own is flagged', 'Sol Ring'],
  ['the button says what confirming will do', 'Treat selected as duplicates'],
];
for (const [what, needle] of says) {
  if (review.includes(needle)) {
    console.log(`  ok  ${what}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${what} — expected "${needle}" in the review markup`);
  }
}

// The service worker and the manifest are strings in vite.web.config.ts, so
// nothing typechecks them and a slip shows up as an app that won't install or a
// share that silently disappears. This build emits both next to this script, so
// they can at least be parsed and cross-checked against the code they pair with.
const emitted = (file: string): string =>
  readFileSync(join(process.cwd(), 'dist-smoke', file), 'utf8');

const asserts: [string, () => void][] = [
  [
    'the service worker parses',
    () => {
      // Compiles without running: a SyntaxError here is a phone that silently
      // fails to register a worker at all.
      new Function(emitted('sw.js'));
    },
  ],
  [
    'the worker catches a shared POST before its navigation branch',
    () => {
      const sw = emitted('sw.js');
      const post = sw.indexOf('request.method === \'POST\'');
      const navigate = sw.indexOf('request.mode !== \'navigate\'');
      if (post < 0 || navigate < 0) throw new Error('one of the two branches is gone');
      // A share *is* a navigation, so the other order sends the file to Pages.
      if (post > navigate) throw new Error('the navigation branch would swallow the share');
    },
  ],
  [
    'the worker and the app agree on where shared files wait',
    () => {
      const sw = emitted('sw.js');
      for (const name of [SHARE_INBOX, SHARE_KEY_PATH]) {
        if (!sw.includes(`'${name}'`)) throw new Error(`the worker no longer names ${name}`);
      }
    },
  ],
  [
    'the worker spares the price table when it sweeps old caches',
    () => {
      // It isn't a stale copy of the app, and re-downloading it on every code
      // deploy would cost the user megabytes for a change that didn't touch it.
      const sw = emitted('sw.js');
      if (!sw.includes(`'${PRICES_CACHE}'`)) {
        throw new Error(`the worker no longer knows about ${PRICES_CACHE}`);
      }
      const sweep = sw.slice(sw.indexOf('caches.keys()'), sw.indexOf('clients.claim'));
      if (!sweep.includes('PRICES')) throw new Error('the sweep would delete the price table');
    },
  ],
  [
    'the app shows which build it is',
    () => {
      // End to end: the config computed a stamp, `define` replaced it, and a
      // screen renders it. Missing means the phone can't answer "is my fix live?".
      const view = renderToString(<App />);
      if (!/v\d+\.\d+\.\d+ · [0-9a-f]{7}/.test(view)) {
        throw new Error('no version and commit in the rendered app');
      }
    },
  ],
  [
    'the worker revalidates the page instead of trusting the phone',
    () => {
      // Pages sends max-age=600 on the page, so a plain fetch here means a
      // relaunch within ten minutes of a deploy can still be the old build —
      // exactly when someone is relaunching to see whether a fix landed.
      const sw = emitted('sw.js');
      if (!/fetch\(request\.url, \{ cache: 'no-cache' \}\)/.test(sw)) {
        throw new Error('the navigation fetch no longer revalidates');
      }
    },
  ],
  [
    'the shell cache is named after the build',
    () => {
      // Otherwise a deploy keeps the previous shell as its offline fallback, and
      // an offline launch can show code the user already replaced.
      if (!/const CACHE = 'lugin-shell-[0-9a-f]{7}/.test(emitted('sw.js'))) {
        throw new Error('the cache name no longer carries the commit');
      }
    },
  ],
  [
    'the manifest offers Lugin as a share target for files',
    () => {
      const manifest = JSON.parse(emitted('manifest.webmanifest')) as {
        scope: string;
        share_target?: {
          action: string;
          enctype: string;
          method: string;
          params: { files: { accept: string[]; name: string }[] };
        };
      };
      const share = manifest.share_target;
      if (!share) throw new Error('no share_target');
      // Chrome ignores the whole entry if any of these are wrong, without saying so.
      if (!share.action.startsWith(manifest.scope)) throw new Error('action is outside the scope');
      if (share.method !== 'POST') throw new Error('a file share has to be a POST');
      if (share.enctype !== 'multipart/form-data') throw new Error('wrong enctype for a file');
      if (share.params.files[0]?.name !== 'file') {
        throw new Error('the worker reads the part named "file"');
      }
      if (!share.params.files[0].accept.includes('text/csv')) throw new Error('CSV is not accepted');
    },
  ],
];

for (const [what, check] of asserts) {
  try {
    check();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${what} — ${error instanceof Error ? error.message : error}`);
  }
}

console.log(failed === 0 ? '\nall render checks passed' : `\n${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;

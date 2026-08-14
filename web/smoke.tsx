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

import { renderToString } from 'react-dom/server';


import { App } from '../src/web/App';
import { CollectionView } from '../src/web/CollectionView';
import { DeckList } from '../src/web/DeckList';
import { ImportScreen } from '../src/web/ImportScreen';

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

console.log(failed === 0 ? '\nall render checks passed' : `\n${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;

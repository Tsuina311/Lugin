// Seller ↔ want pricing + known-price map + consolidation (`yarn test:seller-want-pricing`).

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);

const out = await mkdtemp(join(tmpdir(), 'lugin-swp-'));
const entry = join(out, 'entry.ts');
await writeFile(
  entry,
  `export * from '${root}src/lib/sellerWantPricing';
   export * from '${root}src/lib/consolidation';
   export * from '${root}src/lib/knownPriceMap';
   export * from '${root}src/lib/purchasePlan';
   export { parseWantAmountFields } from '${root}src/lib/wantAmount';`,
);

const bundle = join(out, 'swp.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  // wants.ts pulls browser DOM helpers — stub the heaviest deps for unit tests.
  external: [],
  tsconfigRaw: { compilerOptions: { paths: { '@/*': [`${root}src/*`] } } },
});

const {
  annotateWithKnownCheapest,
  buildPurchasePlanFromCart,
  evaluateConsolidationMove,
  evaluateOneWantMove,
  findAllBeneficialOneWantMoves,
  findKnownCheapest,
  freshnessOf,
  goodsTotalForSelection,
  knownCheapestDelta,
  KNOWN_PRICE_TRUSTED_MS,
  observationsAreComparable,
  offersMapFromLines,
  priceSellerOffers,
  recordObservations,
  selectOffersForQuantity,
  parseWantAmountFields,
  wantKeyOf,
  wantListFingerprint,
} = await import(pathToFileURL(bundle).href);

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
};

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

const want = (name, quantity, quantityStatus = 'KNOWN') => ({
  wantKey: wantKeyOf(name),
  name,
  quantity,
  quantityStatus,
});

console.log('seller-want-pricing');

check('CASE 1: Want A qty1, seller has A qty1 → MATCHED', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Sol Ring', 1)],
    offers: [{ name: 'Sol Ring', price: 1.5, quantity: 1, articleId: 'a1', condition: 'NM', language: 'English' }],
  });
  assert.equal(r.matched.length, 1);
  assert.equal(r.partial.length, 0);
  assert.equal(r.missing.length, 0);
  assert.equal(r.matched[0].chosenQty, 1);
  assert.equal(r.goodsTotal, 1.5);
  assert.deepEqual(r.selectedArticleIds, ['a1']);
});

check('CASE 2: Want A qty4, seller has A qty2 → PARTIAL 2/4', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Lightning Bolt', 4)],
    offers: [{ name: 'Lightning Bolt', price: 0.5, quantity: 2, articleId: 'b1' }],
  });
  assert.equal(r.matched.length, 0);
  assert.equal(r.partial.length, 1);
  assert.equal(r.partial[0].chosenQty, 2);
  assert.equal(r.partial[0].wantedQty, 4);
  assert.equal(r.partial[0].availableQty, 2);
  assert.equal(r.goodsTotal, 1.0);
  assert.deepEqual(r.selectedArticleIds, ['b1', 'b1']);
});

check('qty4 want: seller qty1 → PARTIAL 1/4', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Lightning Bolt', 4)],
    offers: [{ name: 'Lightning Bolt', price: 0.3, quantity: 1, articleId: 'b1' }],
  });
  assert.equal(r.partial[0].chosenQty, 1);
  assert.equal(r.partial[0].wantedQty, 4);
  assert.equal(r.goodsTotal, 0.3);
});

check('qty4 want: offers qty2+qty2 → MATCHED 4/4', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Lightning Bolt', 4)],
    offers: [
      { name: 'Lightning Bolt', price: 0.3, quantity: 2, articleId: 'a' },
      { name: 'Lightning Bolt', price: 0.35, quantity: 2, articleId: 'b' },
    ],
  });
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].chosenQty, 4);
  assert.equal(r.goodsTotal, 0.3 * 2 + 0.35 * 2);
  assert.equal(r.selectedArticleIds.length, 4);
});

check('qty4 want: seller qty5 → chosen qty4 only', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Lightning Bolt', 4)],
    offers: [{ name: 'Lightning Bolt', price: 0.3, quantity: 5, articleId: 'a' }],
  });
  assert.equal(r.matched[0].chosenQty, 4);
  assert.equal(r.matched[0].availableQty, 5);
  assert.deepEqual(r.selectedArticleIds, ['a', 'a', 'a', 'a']);
});

check('Bolt example: want4, offers 2@0.30 + 1@0.35 → PARTIAL goods 0.95', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Lightning Bolt', 4)],
    offers: [
      { name: 'Lightning Bolt', price: 0.3, quantity: 2, articleId: 'a' },
      { name: 'Lightning Bolt', price: 0.35, quantity: 1, articleId: 'b' },
    ],
  });
  assert.equal(r.partial[0].status, 'partial');
  assert.equal(r.partial[0].chosenQty, 3);
  assert.equal(r.partial[0].wantedQty, 4);
  assert.equal(r.goodsTotal, 0.95);
});

check('CASE 3: no qualifying offer → MISSING', () => {
  const r = priceSellerOffers({
    sellerId: '1',
    sellerName: 'S',
    wantListId: 'w',
    wants: [want('Counterspell', 1)],
    offers: [{ name: 'Sol Ring', price: 1, quantity: 1, articleId: 'x' }],
  });
  assert.equal(r.missing.length, 1);
  assert.equal(r.matched.length, 0);
  assert.equal(r.goodsTotal, 0);
});

check('CASE 5+6: multiple articles, cheapest combination for qty', () => {
  const { slices, chosenQty, availableQty } = selectOffersForQuantity(
    [
      { name: 'Bolt', price: 1.0, quantity: 1, articleId: 'dear' },
      { name: 'Bolt', price: 0.4, quantity: 2, articleId: 'cheap' },
      { name: 'Bolt', price: 0.7, quantity: 3, articleId: 'mid' },
    ],
    3,
  );
  assert.equal(availableQty, 6);
  assert.equal(chosenQty, 3);
  assert.equal(slices[0].articleId, 'cheap');
  assert.equal(slices[0].quantity, 2);
  assert.equal(slices[1].articleId, 'mid');
  assert.equal(slices[1].quantity, 1);
});

check('fingerprint includes known qty / unknown marker', () => {
  const fp = wantListFingerprint([
    want('A', 4, 'KNOWN'),
    want('B', 1, 'UNKNOWN'),
  ]);
  assert.match(fp, /:4/);
  assert.match(fp, /:\?/);
});

check('consolidation: empty source seller → shipping may count', () => {
  const m = evaluateConsolidationMove({
    wantKey: 'x',
    from: { sellerId: 'B', wantKeys: ['x'], shippingTotal: 1.5 },
    to: { sellerId: 'A', wantKeys: ['y'], shippingTotal: 2 },
    goodsDelta: 0.3,
  });
  assert.equal(m.fromSellerRemoved, true);
  assert.equal(m.shippingDelta, -1.5);
  assert.equal(m.netDelta, -1.2);
});

check('consolidation: source not emptied → shippingDelta 0', () => {
  const m = evaluateConsolidationMove({
    wantKey: 'x',
    from: { sellerId: 'B', wantKeys: ['x', 'y'], shippingTotal: 1.5 },
    to: { sellerId: 'A', wantKeys: ['z'], shippingTotal: 2 },
    goodsDelta: 0.3,
  });
  assert.equal(m.fromSellerRemoved, false);
  assert.equal(m.shippingDelta, 0);
  assert.equal(m.netDelta, 0.3);
});

console.log('want-amount-from-row');

check('data-amount=4 → KNOWN 4', () => {
  const r = parseWantAmountFields({ dataAmount: '4' });
  assert.equal(r.quantityStatus, 'KNOWN');
  assert.equal(r.amount, 4);
});

check('cell text 2 → KNOWN 2', () => {
  const r = parseWantAmountFields({ cellText: '2' });
  assert.equal(r.quantityStatus, 'KNOWN');
  assert.equal(r.amount, 2);
});

check('qty 1 from fields', () => {
  const r = parseWantAmountFields({ dataAmount: '1' });
  assert.equal(r.amount, 1);
});

check('missing amount → UNKNOWN (not silent 1)', () => {
  const r = parseWantAmountFields({});
  assert.equal(r.quantityStatus, 'UNKNOWN');
  assert.equal(r.amount, undefined);
});

console.log('known-price-map');

check('Seller A 1.20, B 1.00 → known cheapest B, A delta +0.20', () => {
  let map = {};
  const now = Date.now();
  map = recordObservations(map, [
    {
      wantKey: 'bolt',
      wantListId: 'w1',
      sellerId: 'A',
      unitPrice: 1.2,
      quantity: 1,
      observedAt: now,
      source: 'PRICE_IT',
    },
    {
      wantKey: 'bolt',
      wantListId: 'w1',
      sellerId: 'B',
      unitPrice: 1.0,
      quantity: 1,
      observedAt: now,
      source: 'PRICE_IT',
    },
  ], now);
  const best = findKnownCheapest(map, { wantKey: 'bolt', wantListId: 'w1' }, { now });
  assert.equal(best.sellerId, 'B');
  assert.equal(best.unitPrice, 1.0);
  const d = knownCheapestDelta(map, { wantKey: 'bolt', wantListId: 'w1' }, 1.2, 'A', { now });
  assert.ok(d);
  approx(d.delta, 0.2);
});

check('wrong language excluded when no shared wantListId', () => {
  let map = {};
  const now = Date.now();
  map = recordObservations(map, [
    {
      wantKey: 'bolt',
      sellerId: 'B',
      unitPrice: 0.5,
      quantity: 1,
      language: 'German',
      foil: false,
      observedAt: now,
      source: 'PRODUCT_PAGE',
    },
  ], now);
  const best = findKnownCheapest(
    map,
    { wantKey: 'bolt', language: 'English', foil: false },
    { now },
  );
  assert.equal(best, undefined);
});

check('stale observation labeled / hidden past hide TTL', () => {
  const now = Date.now();
  let map = recordObservations({}, [
    {
      wantKey: 'bolt',
      wantListId: 'w1',
      sellerId: 'B',
      unitPrice: 1.0,
      quantity: 1,
      observedAt: now - KNOWN_PRICE_TRUSTED_MS - 1000,
      source: 'PRICE_IT',
    },
  ], now);
  assert.equal(freshnessOf(now - KNOWN_PRICE_TRUSTED_MS - 1000, now), 'STALE');
  const withStale = knownCheapestDelta(
    map,
    { wantKey: 'bolt', wantListId: 'w1' },
    1.2,
    'A',
    { now, allowStale: true },
  );
  assert.equal(withStale?.knownCheapest.freshness, 'STALE');
  const hide = knownCheapestDelta(
    map,
    { wantKey: 'bolt', wantListId: 'w1' },
    1.2,
    'A',
    { now, allowStale: false },
  );
  assert.equal(hide, undefined);
});

check('different printing not comparable without shared list', () => {
  assert.equal(
    observationsAreComparable(
      {
        wantKey: 'bolt',
        sellerId: 'B',
        unitPrice: 1,
        quantity: 1,
        printing: 'Alpha',
        foil: false,
        observedAt: 1,
        source: 'OTHER_TRUSTED',
      },
      { wantKey: 'bolt', printing: 'Beta', foil: false },
    ),
    false,
  );
});

check('Price It later cheaper updates map', () => {
  const now = Date.now();
  let map = recordObservations({}, [
    {
      wantKey: 'bolt',
      wantListId: 'w1',
      sellerId: 'B',
      unitPrice: 1.0,
      quantity: 1,
      observedAt: now - 1000,
      source: 'PRICE_IT',
    },
  ], now);
  map = recordObservations(map, [
    {
      wantKey: 'bolt',
      wantListId: 'w1',
      sellerId: 'B',
      unitPrice: 0.9,
      quantity: 1,
      observedAt: now,
      source: 'PRICE_IT',
    },
  ], now);
  assert.equal(findKnownCheapest(map, { wantKey: 'bolt', wantListId: 'w1' }, { now }).unitPrice, 0.9);
});

check('annotateWithKnownCheapest fills delta fields', () => {
  const now = Date.now();
  const map = recordObservations({}, [
    {
      wantKey: wantKeyOf('Bolt'),
      wantListId: 'w',
      sellerId: 'B',
      unitPrice: 1.0,
      quantity: 1,
      observedAt: now,
      source: 'PRICE_IT',
    },
  ], now);
  const r = priceSellerOffers({
    sellerId: 'A',
    sellerName: 'A',
    wantListId: 'w',
    wants: [want('Bolt', 1)],
    offers: [{ name: 'Bolt', price: 1.4, quantity: 1, articleId: 'a' }],
  });
  const annotated = annotateWithKnownCheapest(r, map, now);
  assert.equal(annotated.matched[0].knownCheapestUnitPrice, 1.0);
  approx(annotated.matched[0].priceDeltaVsKnownCheapest, 0.4);
});

console.log('purchase-plan + consolidation moves');

check('plan from cart assignments', () => {
  const plan = buildPurchasePlanFromCart([
    { articleId: '1', name: 'X', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
    { articleId: '2', name: 'Y', amount: 1, unitPrice: 2, sellerId: 'B', sellerName: 'B' },
  ], (id, count) => ({ price: id === 'A' ? 1.9 : 1.5 }));
  assert.equal(plan.sellers.length, 2);
  assert.equal(plan.planTrust, 'TRUSTED');
  assert.ok(plan.totalShipping > 0);
});

check('CASE A: B only X → move to A saves shipping', () => {
  const plan = buildPurchasePlanFromCart([
    { articleId: '1', name: 'Other', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
    { articleId: '2', name: 'X', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
  ], (id) => ({ price: id === 'A' ? 1.9 : 1.5 }));
  const move = evaluateOneWantMove({
    plan,
    wantKey: wantKeyOf('X'),
    fromSellerId: 'B',
    toSellerId: 'A',
    toUnitPrice: 1.3,
    estimateShip: (id, count) => {
      if (count <= 0) return 0;
      return id === 'A' ? 1.9 : 1.5;
    },
  });
  assert.ok(move);
  assert.equal(move.sourceSellerRemoved, true);
  approx(move.goodsDelta, 0.3);
  approx(move.shippingDelta, -1.5);
  approx(move.netDelta, -1.2);
});

check('CASE B: B has X+Y → no full shipping removal', () => {
  const plan = buildPurchasePlanFromCart([
    { articleId: '1', name: 'Other', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
    { articleId: '2', name: 'X', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
    { articleId: '3', name: 'Y', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
  ], (id) => ({ price: id === 'A' ? 1.9 : 1.5 }));
  const move = evaluateOneWantMove({
    plan,
    wantKey: wantKeyOf('X'),
    fromSellerId: 'B',
    toSellerId: 'A',
    toUnitPrice: 1.3,
    estimateShip: (id, count) => {
      if (count <= 0) return 0;
      return id === 'A' ? 1.9 : 1.5;
    },
  });
  assert.ok(move);
  assert.equal(move.sourceSellerRemoved, false);
  approx(move.shippingDelta, 0);
  approx(move.netDelta, 0.3);
});

check('destination tier increase + source removal', () => {
  const plan = buildPurchasePlanFromCart([
    { articleId: '1', name: 'Other', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
    { articleId: '2', name: 'X', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
  ], (id) => ({ price: id === 'A' ? 1.5 : 1.5 }));
  const move = evaluateOneWantMove({
    plan,
    wantKey: wantKeyOf('X'),
    fromSellerId: 'B',
    toSellerId: 'A',
    toUnitPrice: 1.3,
    estimateShip: (id, count) => {
      if (count <= 0) return 0;
      if (id === 'A') return count >= 2 ? 2.2 : 1.5;
      return 1.5;
    },
  });
  assert.ok(move);
  assert.equal(move.sourceSellerRemoved, true);
  approx(move.destinationShippingBefore, 1.5);
  approx(move.destinationShippingAfter, 2.2);
  approx(move.shippingDelta, 2.2 - 1.5 - 1.5);
  approx(move.netDelta, 0.3 + (2.2 - 1.5 - 1.5));
});

check('partial qty move does not remove B', () => {
  const plan = buildPurchasePlanFromCart([
    { articleId: '1', name: 'Other', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
    { articleId: '2', name: 'X', amount: 4, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
  ], (id) => ({ price: 1.5 }));
  const move = evaluateOneWantMove({
    plan,
    wantKey: wantKeyOf('X'),
    fromSellerId: 'B',
    toSellerId: 'A',
    quantity: 2,
    toUnitPrice: 1.1,
    estimateShip: (id, count) => (count <= 0 ? 0 : 1.5),
  });
  assert.ok(move);
  assert.equal(move.quantityMoved, 2);
  assert.equal(move.sourceSellerRemoved, false);
  assert.equal(move.shippingDelta, 0);
});

check('source tier reduction without removal', () => {
  const shipFn = (id, count) => {
    if (count <= 0) return 0;
    if (id === 'B') return count >= 4 ? 2.2 : 1.5;
    return 1.9;
  };
  const plan = buildPurchasePlanFromCart(
    [
      { articleId: '1', name: 'Other', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
      { articleId: '2', name: 'X', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
      { articleId: '3', name: 'Y', amount: 3, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
    ],
    (id, count) => ({ price: shipFn(id, count) }),
  );
  const move = evaluateOneWantMove({
    plan,
    wantKey: wantKeyOf('X'),
    fromSellerId: 'B',
    toSellerId: 'A',
    toUnitPrice: 1.0,
    estimateShip: shipFn,
  });
  assert.ok(move);
  assert.equal(move.sourceSellerRemoved, false);
  approx(move.sourceShippingBefore, 2.2);
  approx(move.sourceShippingAfter, 1.5);
  approx(move.destinationShippingBefore, 1.9);
  approx(move.destinationShippingAfter, 1.9);
  approx(move.shippingDelta, 1.5 - 2.2);
});

check('offersMapFromLines: cheapest unit + stock capacity', () => {
  const m = offersMapFromLines([
    { wantKey: 'x', unitPrice: 1.2, articleId: 'dear', quantity: 1 },
    { wantKey: 'x', unitPrice: 0.8, articleId: 'cheap', quantity: 2 },
  ]);
  assert.equal(m.get('x').unitPrice, 0.8);
  assert.equal(m.get('x').maxQty, 3);
  assert.equal(m.get('x').articleIds.length, 3);
});

check('findAllBeneficialOneWantMoves: prefers letter removal', () => {
  const plan = buildPurchasePlanFromCart(
    [
      { articleId: '1', name: 'Keep', amount: 1, unitPrice: 1, sellerId: 'A', sellerName: 'A' },
      { articleId: '2', name: 'X', amount: 1, unitPrice: 1.0, sellerId: 'B', sellerName: 'B' },
      { articleId: '3', name: 'Y', amount: 1, unitPrice: 1.0, sellerId: 'C', sellerName: 'C' },
    ],
    id => ({ price: id === 'A' ? 1.9 : 1.5 }),
  );
  const offersBySeller = new Map([
    [
      'A',
      offersMapFromLines([
        { wantKey: wantKeyOf('X'), unitPrice: 1.2, articleId: 'ax', quantity: 1 },
        { wantKey: wantKeyOf('Y'), unitPrice: 5.0, articleId: 'ay', quantity: 1 },
      ]),
    ],
  ]);
  const shipFn = (id, count) => {
    if (count <= 0) return 0;
    return id === 'A' ? 1.9 : 1.5;
  };
  const moves = findAllBeneficialOneWantMoves({
    plan,
    offersBySeller,
    estimateShip: shipFn,
  });
  // X→A: goods +0.20, ship -1.50 → net -1.30 (removes B)
  // Y→A: goods +4.00, ship -1.50 → net +2.50 (not beneficial)
  assert.equal(moves.length, 1);
  assert.equal(moves[0].wantKey, wantKeyOf('X'));
  assert.equal(moves[0].sourceSellerRemoved, true);
  approx(moves[0].netDelta, -1.3);
});

console.log(`\n${passed} checks passed`);
await rm(out, { recursive: true, force: true });

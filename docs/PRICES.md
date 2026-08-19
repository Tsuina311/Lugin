# Prices

Two different questions, answered by two different mechanisms. Conflating them is
what makes price features feel slow.

| Question                             | Where the answer comes from                      | Cost                       |
| ------------------------------------ | ------------------------------------------------ | -------------------------- |
| What is my collection worth?         | a daily snapshot the app holds locally           | a sum over rows, offline   |
| Is *this offer* a good price?         | Cardmarket's own product page, scraped on demand | one page fetch per card    |

## The snapshot

`scripts/build-prices.mjs` downloads Scryfall's `default_cards` bulk dump (~78 MB
gzipped, rebuilt by Scryfall every morning around 09:05 UTC) and throws away
everything except prices, leaving roughly:

- **101,000 printings**, keyed `set|collector number`
- **34,000 names**, keyed by the app's own `looseKey`, each holding the *cheapest*
  paper printing of that card
- **3.5 MB on disk, about 1.2 MB over the wire**, built in about five seconds

Each entry is `[eur, eur_foil, usd, usd_foil]` in **cents**, where `0` means "no
price" — unambiguous, since no card is free. Etched foils are folded into the foil
slot, because the importers can only tell you a card is foil.

`.github/workflows/pages.yml` builds it on every deploy *and* on a daily schedule,
publishing it as `prices.json` beside the phone app. The step is
`continue-on-error`: a bad morning at Scryfall must not block a code deploy.

Both surfaces read that one file. The phone fetches it from its own origin into
the Cache API; the extension asks its background worker, which fetches from
`VITE_LUGIN_PRICES_URL` and keeps it in `chrome.storage.local`. The worker needs
a host permission for that origin (MV3 does not treat CORS as enough); the
manifest derives it from the same env var. Either way it is re-fetched when it
is more than 20 hours old, and an older copy is used — and labelled — when the
network isn't there.

It is deliberately **not** in the sync document. Prices are identical for every
user and change daily; pushing 3.5 MB into someone's Drive folder to restate what
Scryfall says publicly would also mean a conflict to resolve every morning.

## Valuing a collection

`src/lib/prices.ts` is pure arithmetic over the snapshot. It looks a card up by
its printing first, then by name, and reports what it couldn't do:

- **estimated** — priced by name (so, the cheapest printing) or a foil quoted at
  its non-foil price. Always an under-estimate, so an inexact total reads as a
  floor rather than a boast.
- **without a price** — no entry at all. Counted and shown, never folded into the
  total as a zero.

## The gain, and its cost basis

`CollectionCard.purchasePrice` is what one copy cost. ManaBox writes it into every
scanned row as `Purchase price`, and we now keep it on import and write it back on
export instead of dropping it.

The gain is deliberately computed over a **subset**: only copies that have both a
recorded cost and a current price. Comparing a whole collection's market value
against a partial cost basis would invent a profit out of the cards nobody
recorded paying for. The UI says how many copies the number speaks for.

When two lots of the same printing merge, the basis becomes a **weighted average**
(`blendCost` in `src/lib/duplicates.ts`): two at €1 plus three at €2 is five at
€1.60, not five at either price.

Costs are assumed to be in the snapshot's currency, which the UI reads as EUR. The
snapshot carries USD as well, so pricing in dollars is a UI decision rather than a
rebuild.

## What these prices are not

Scryfall's `eur` and Cardmarket's *Price Trend* are different derivations, but a
measured sample of exact printings tracked to a median ratio of 1.00 (every card
within 10%). So the snapshot is the always-on reference that colours offers in
the Search tab. Live product-page fetches stay for two narrower jobs: the live
*From* price, and a printing-exact confirm when an offer sits near market (or
when you click a row's trend). They are no longer a crawl of the whole list.

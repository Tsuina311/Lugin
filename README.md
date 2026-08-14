# Lugin — Custom UI Layer

A Manifest V3 Chrome extension that **captures a website's HTTP traffic** (request + response bodies), shows it in a **React overlay injected onto the page**, and gives you a place to **build your own UI on top of the site's API**.

Built for the case where a site is useful but its UI is painful: capture what it does, then layer your own interface on top.

## How it works

```
┌─────────────────────────── the target web page ───────────────────────────┐
│                                                                            │
│  MAIN world (page context)          ISOLATED world (extension context)     │
│  ┌───────────────────────┐          ┌───────────────────────────────────┐  │
│  │ interceptor/main.ts    │  window  │ content/index.tsx                 │  │
│  │  • wraps fetch + XHR    │ .post─►  │  • listens for messages           │  │
│  │  • reads req/res bodies │ Message  │  • mounts React overlay in a      │  │
│  │  • posts summaries      │          │    shadow DOM (style-isolated)    │  │
│  └───────────────────────┘          │  • callStore (observable)         │  │
│                                      └──────────────┬────────────────────┘  │
└─────────────────────────────────────────────────────┼──────────────────────┘
                                                        │ chrome.runtime
                                              ┌─────────▼─────────┐
                                              │ background worker  │
                                              │  • toolbar toggle  │
                                              │  • API fetches     │
                                              │    (no page CORS)  │
                                              └───────────────────┘
```

- **`src/interceptor/main.ts`** runs in the page's own JS context at `document_start`, so it can monkey-patch `fetch`/`XMLHttpRequest` and read real response bodies (something `chrome.webRequest` can't do in MV3).
- **`src/content/index.tsx`** mounts the React app inside a **shadow DOM** so the site's CSS and our CSS never collide.
- **`src/background/service-worker.ts`** performs outbound API calls for you (bypassing page CORS) — the seed for the "fetch from an API" feature.

## Getting started

This project uses **Yarn** (Berry, with the `node-modules` linker).

```bash
yarn install
yarn dev      # dev build with HMR, writes to dist/
# or
yarn build    # production build to dist/
```

### Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Open any website — the **Lugin** panel appears top-right.
5. Click the extension's toolbar icon to hide/show the panel.

> During `yarn dev`, CRXJS hot-reloads most changes. If you edit the manifest or the interceptor, click the reload icon on `chrome://extensions`.

### Giving it to testers

```bash
yarn key              # once: pins the extension id, so one redirect URI serves everyone
yarn package:testers  # release/lugin-<version>-testers.zip → Load unpacked
yarn package          # release/lugin-<version>.zip, validated for the Chrome Web Store
```

Two shapes of the same build, differing over the manifest's `key`. The tester zip
**keeps** it, because that is what gives every unpacked install the same
extension id — and the Google sign-in redirect is derived from that id, so
without it each tester would hit `redirect_uri_mismatch`. The store zip **drops**
it, because an upload declaring its own key is rejected.

Longer term the extension goes to the **Chrome Web Store** as a `Private` item
visible only to trusted testers — not to Google Play, which only carries Android
apps. Note the store re-signs with its own key, so publishing *changes* the id;
`docs/DISTRIBUTION.md` is the runbook, and covers keeping both redirect URIs
registered through that switch.

## On a phone

```bash
yarn dev:web      # the phone build, port 5174
yarn build:web    # static site in dist-web/, deployed to GitHub Pages by CI
yarn test:web     # server-renders every screen, to catch a blank page early
```

A second, much smaller build of the same source (`web/index.html` → `src/web/`)
showing the collection and decks on a phone — and importing into them, which is
the point: cards get scanned into ManaBox on a phone, so that is where the export
file already is.

It runs the **same sync engine as the extension**, not a lighter cousin. Two
devices writing to one document needs reconciliation wherever the writing
happens, and a second implementation of that would be a second set of ways to
lose a collection. So `createSyncEngine` sits on
`src/platform/web/localRepository.ts` (IndexedDB — a scanned collection outgrows
localStorage's quota) exactly as it sits on `chrome.storage`, and the per-domain
resolution, the conflict copies and the retry are shared and tested once.

It renders that local copy rather than a fetch, so the collection is there before
any network call and an import made in a shop with no signal is kept and pushed
later.

### Measuring the card scanner

```bash
yarn scan:fixtures   # resolve the test corpus from Scryfall (writes scripts/fixtures/cards.json)
yarn scan:index      # build the card-name index the matcher needs
yarn scan:eval       # run the corpus, print accuracy and timings
yarn scan:variants   # benchmark preprocessing chains against each other
yarn scan:calibrate  # measure where the title actually sits on each layout
yarn scan:folds      # compare name-normalization strategies
```

The scanner is the one feature where "that feels better" is worthless: a change
that rescues the card on your desk routinely breaks five others, and nobody
notices until a shop trip. So `scripts/scan-eval.mjs` runs the real pipeline —
the same `src/lib/scan/` modules the phone runs, which is why none of them may
touch the DOM — over a fixed set of cards under synthetic tilt, blur, glare, dim
light and filmed-screen conditions, and reports detection rate, title accuracy
and per-stage time.

The corpus is a committed manifest of **Scryfall ids only**; the card images are
downloaded on demand into a gitignored `.scan-fixtures/`. Card art is
copyrighted and has no business in the repository.

Synthetic abuse is not photography. It exercises geometry and preprocessing
honestly, and it will tell you nothing true about foils, sleeves or a real
autofocus hunting in bad light — those need actual phone photos.

It has already earned its keep twice, in both cases by contradicting code that
looked reasonable:

- Card detection scored **0 out of 220**, including a flat, centred, evenly lit
  card, while 98.7% of the true outline was present in the edge map. The detector
  was fine at finding edges and hopeless at the step after, so it was replaced
  with region separation (see `src/lib/scan/detectCard.ts`). Detection is now 100%.
- The shipping preprocessing chain came **last of fifteen** candidates, below
  handing Tesseract the untouched crop, because it ended in a sharpening pass.

The corpus currently identifies **86% of cards correctly** from the title alone,
and the number that matters more is that it is roughly even across every camera
condition: tilt, blur, glare and filmed screens are no longer what limits it. What
remains is layouts and typography, not photography — battle cards are landscape and
split cards print their names sideways, so both need their own `ScanProfile` rather
than looser regions on the standard one, and the 1993 frame's typeface defeats
Tesseract's stock model.

The gap between that 86% and the 77% raw title similarity is the whole argument for
matching against an index (below). Similarity is a proxy, and a badly pessimistic
one: short names scored 69% similar and identify 100% of the time, because "Fog" is
either a card or it isn't.

### Identifying the card, not transcribing it

OCR does not have to spell a name correctly. It only has to get close enough that
the right card wins against ~37,000 others, which makes this identification rather
than transcription — "Sol Rinq" costs nothing, because it is not a card.

`yarn scan:index` distils Scryfall's bulk dump into every paper card name plus the
French, German and Italian titles they are printed under: 3.5 MB, 1.2 MB over the
wire, downloaded on first scan and kept in the Cache API like the price table. The
localized titles are what make a non-English card resolve at all offline — Scryfall
knows "Anneau solaire" is Sol Ring, but only over the network.

Two things fall out of having a list, and neither is available from Scryfall's fuzzy
endpoint, which answers with one card and no score:

- **Choosing between OCR passes and identifying the card are the same decision.**
  The old code picked the longest reading and then looked it up, which cannot work:
  the only evidence separating "Sol Rinq" from "Sol Ring" is that one of them is a
  card. So `matchReadings` scores every pass against the index at once.
- **The answer is a ranked list.** A near-tie between two real cards is the honest
  outcome for a smudged title, and "Pick manually" can offer both — far more
  useful than recovering from one silently wrong pick.

`shapeFold` folds the characters OCR confuses (`l`/`1`/`I`, `rn`/`m`) on *both*
sides, which sounds like cheating and is really the removal of a distinction that
carries no information at title resolution. `yarn scan:folds` says it is worth 86%
against 81%, and both reach the same 86% within the top five — so what it buys is
promoting the right card from "in the list" to "first", which is exactly what an
automatic scanner needs.

Region coordinates are measured, not eyeballed. `yarn scan:calibrate` locates the
title on every fixture and prints the spread, which is how the numbers in
`src/lib/scan/regions.ts` were chosen — and it only means anything because
detection normalizes the card first.

`flags.scanDebug` turns on the on-device counterpart: detected corners, the
perspective-corrected card, every OCR crop with its confidence, and where the
time went.

Traffic with ManaBox goes both ways, but not by the same door in each direction,
because it has no API and its two importers disagree. Inbound, the manifest
registers Lugin as a share target, so a scan can be sent straight from ManaBox's
share sheet (`src/web/sharedImport.ts`). Outbound, `src/lib/export.ts` writes
ManaBox's own formats — its commented `// COMMANDER` headers, its CSV column
names — and `src/web/share.ts` offers three routes for them, because a deck and a
collection need different ones: ManaBox imports a deck as **pasted text**, so
clipboard is the only way in and no file share sheet will ever list it, while its
collection import wants a **file** picked from storage. Sharing is there for
everything that isn't ManaBox.

Either direction is a copy rather than a sync, since nothing on either side tracks
the other's identity. Which is why `deckToText` and `collectionToCsv` are
round-tripped through `inspectImport` in the tests: a re-import is the only thing
that can catch a lost commander or a dropped foil marker.

Versions are `MAJOR.MINOR.<commit count>` from `build/version.ts`, shared by both
builds so the phone and the extension can't disagree about which commit they are.
See [docs/VERSIONING.md](docs/VERSIONING.md).

**Collection value** is a sum, not a lookup. CI distils Scryfall's daily bulk dump
into a 3.5 MB table of every paper price (`scripts/build-prices.mjs`), deploys it
beside the app, and both surfaces hold it locally: value and gain-since-purchase
are then arithmetic that works offline. The same table colours offers on the
Cards tab (it tracks Cardmarket's Price Trend closely); live page fetches are
kept only for close calls and on demand, for the live *From* price. The gain
leans on `purchasePrice`, which ManaBox writes into every scanned row and we no
longer throw away. See [docs/PRICES.md](docs/PRICES.md).

What makes all this nearly free is that `src/core/sync` never knew about Chrome —
`createDriveRepository` takes an injected `fetch` and a `TokenProvider`, so the
only genuinely new platform code is `src/platform/web/googleAuth.ts`, which gets
a token from Google Identity Services instead of `chrome.identity`, and the local
store above.

It cannot show Cardmarket itself: the site sends `x-frame-options: SAMEORIGIN`,
and no page may script another origin's document. That needs a native WebView —
see Part 3 of `docs/DISTRIBUTION.md`.

```
src/core/sync  ──┬──►  src/platform/chrome  ──►  extension  (dist/)
                 └──►  src/platform/web     ──►  phone app  (dist-web/)
```

## Using it

- **Traffic tab** — live list of the page's fetch/XHR calls. Click one to inspect method, status, timing, headers, and pretty-printed request/response bodies.
- **API tab** — send your own requests through the background worker (no CORS headaches) and view the response. This is where you'll start building custom actions.

## Reading data from a server-side-rendered site (e.g. Cardmarket)

Cardmarket renders its data server-side, so the payload is **HTML documents**, not
JSON — the `fetch`/XHR interceptor won't see the important data, and AJAX
responses are HTML fragments. The robust approach is to **read the already-rendered
DOM** instead of the wire:

- By the time you'd inspect a response, the browser has parsed it into the DOM.
  We extract structured data straight from `document` in the content script.
- This is SSR-proof, uses the user's logged-in session, and dodges Cloudflare
  bot challenges (no extra requests).

Extraction is layered, most-stable first:

1. **JSON-LD** — `<script type="application/ld+json">` blocks (`src/lib/extract.ts`).
2. **`data-*` attributes** and semantic hooks.
3. **CSS-selector scraping** — the fallback, isolated in
   `src/sites/cardmarket/selectors.ts` so markup changes are a one-file fix.

A **MutationObserver** re-runs extraction when Cardmarket swaps in AJAX content,
and each page type (product / list / search) is classified by a **site adapter**
(`src/sites/cardmarket/adapter.ts`). Results show up in the overlay's **Cards**
tab, which includes a **diagnostics view** (JSON-LD types found, selector hit
counts) so you can see exactly what's extractable and tune selectors live.

### Tuning selectors

Load a real Cardmarket page, open the **Cards** tab, and read the diagnostics.
Any selector reporting `0` rows needs adjusting in
`src/sites/cardmarket/selectors.ts`. Prefer the JSON-LD path whenever the data
is available there.

### Filtering by card metadata (Scryfall) — the **Filter** tab

Cardmarket doesn't expose gameplay metadata (card type, creature type, colors,
mana value) in a filterable way, so the **Filter** tab cross-references card
names against [Scryfall](https://scryfall.com/docs/api)'s free JSON API. Because
these attributes are identical across printings, the card **name alone** is
enough — no set matching needed.

- Names come from the extracted page (`Page` mode) or you can paste them
  (`Manual` mode) to test.
- The background worker (`src/background/scryfall.ts`) batches lookups (75/call)
  and caches them in `chrome.storage.local` for 30 days, so repeat views are
  instant and Scryfall isn't hammered.
- Filter by color, type, subtype (creature type), and mana-value range.

Register a new `SiteAdapter` in `src/sites/registry.ts` for any additional
scraped sites.

## Targeting a specific site

The extension is currently scoped to Cardmarket in `src/manifest.config.ts`:

```ts
const TARGET_MATCHES = ["https://www.cardmarket.com/*"];
```

Add more origins here as you bring in other Magic sites (and register a matching
adapter in `src/sites/registry.ts`). Narrow matches limit both the injected
overlay and the permissions Chrome grants. Rebuild afterward.

## Project layout

```
src/
  manifest.config.ts     # MV3 manifest (crxjs) — edit TARGET_MATCHES here
  interceptor/main.ts     # MAIN-world fetch/XHR capture
  content/
    index.tsx             # shadow-DOM mount + message bridge
    callStore.ts          # observable store of captured calls
    extractionRunner.ts   # runs DOM extraction + MutationObserver
    pageDataStore.ts      # observable store of extracted page data
  sites/
    types.ts              # SiteAdapter interface + page/extraction types
    registry.ts           # host -> adapter lookup
    cardmarket/
      adapter.ts          # page detection + layered extraction
      selectors.ts        # ALL Cardmarket selectors (tune here)
  background/
    service-worker.ts     # toolbar toggle + CORS-free API fetches
  ui/
    App.tsx               # overlay shell (tabs, filter, layout)
    components/           # CardsPanel, CallList, CallDetail, ApiTester
    useCalls.ts           # React <-> capture store binding
    usePageData.ts        # React <-> extraction store binding
    format.ts             # presentation helpers
    index.css             # Tailwind (scoped to the shadow root)
  lib/
    types.ts              # shared message + data types
    mtg.ts                # Magic card/offer data model
    extract.ts            # generic extraction helpers (JSON-LD, money parsing)
    messaging.ts          # postMessage + runtime messaging helpers
```

## Known constraints

- Response bodies are captured as **text** and capped at **512 KB** (see `MAX_BODY_BYTES`). Binary responses show a placeholder.
- Capture only sees traffic made via `fetch`/`XMLHttpRequest` from the page. Requests made by the browser itself (documents, images, `sendBeacon`, WebSockets) aren't wrapped yet.
- The overlay is injected in the top frame only (`all_frames: false`).

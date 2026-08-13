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

A second, much smaller build of the same source (`web/index.html` →
`src/web/`) that reads the collection and decks from the user's Drive folder and
shows them on a phone. It is **read-only**: no local store, no sync engine,
nothing that can push a half-formed phone state over the desktop's collection.

What makes it nearly free is that `src/core/sync` never knew about Chrome —
`createDriveRepository` takes an injected `fetch` and a `TokenProvider`, so the
only new platform code is `src/platform/web/googleAuth.ts`, which gets a token
from Google Identity Services instead of `chrome.identity`.

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

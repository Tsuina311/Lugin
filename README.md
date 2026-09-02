# Lugin — Custom UI Layer

A Manifest V3 Chrome extension that layers **its own interface over Cardmarket**,
plus a small phone app sharing the same source. Built for the case where a site is
useful but its UI is painful.

In practice it is a **Magic: The Gathering buying companion**: it scans a seller's
whole stock against your want lists, prices and values your collection offline,
filters on the gameplay attributes Cardmarket won't filter on, builds decks, and
reads cards through a phone camera. What it does *not* do is anything seller-side
— see [what people complain about](#measured-against-what-people-complain-about)
for where the line falls and why.

It reads the site by parsing the **already-rendered DOM** rather than the wire,
because Cardmarket is server-rendered; the traffic capture underneath it
(request + response bodies, shown in a React overlay injected onto the page) is
what makes that tractable, and remains available as a development tool for
working out how a page does what it does.

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

**Card pictures are opt-in per row**, which is the one place the phone
deliberately behaves differently from the desktop panel. An image is around 100KB
and this screen gets used standing in a shop on mobile data, so the list stays
text and a picture icon on each row fetches that one card. Box view is the other
half of the same bargain — a grid of images, but you have to ask for it, and it
shows fewer rows than the list does. Both load one image at a time
(`useSequentialImages`, shared with the extension) so a slow connection fills the
grid from the top instead of stalling on forty parallel requests. The smoke test
asserts that a freshly rendered list contains no Scryfall URL at all, since a
stray `<img>` here is a silent megabyte per scroll.

**Decks can be built here, not just read.** The phone was a viewer for decks made
somewhere else, which made the Decks tab a dead end on the device most likely to
be in your hand in a shop. It now offers the desktop's two doors: an empty deck
of a chosen format, and a decklist imported whole. Pasting stands in for the
desktop's file picker, because a decklist on a phone is far more often in the
clipboard — copied out of Moxfield or a forum post — than it is a file, and files
already arrive through the Import tab and ManaBox's share sheet.

Once open, a deck can be renamed, switched between formats, filled and emptied.
Cards go in as text through the same `parseDeckList` the extension uses, so one
box takes a typed name, a `2 Lightning Bolt` line, or a whole pasted list with
section headers; names from your own collection are offered as you type, since a
phone keyboard is the worst place to spell Lim-Dûl's Vault. What is deliberately
*not* here is the rest of the desktop editor — Scryfall search, the mana curve,
land balancing, EDHREC suggestions — which wants a big screen and a sitting-down
kind of attention.

The editor shows pictures on the same terms as the collection screen: rows stay
text with a picture icon on each, and a box view turns the whole deck into a grid
of card images. A deck card is only ever a name, though, so the picture is looked
up in your collection first — that way it's the copy you own, right printing and
all — and only falls back to Scryfall's default printing for cards you haven't
got yet, which while a deck is being built is most of them. The lookup is built
once per collection rather than searched per row, since a hundred-card deck
against a twenty-thousand-row collection is otherwise two million comparisons on
every render.

Three operations moved into `src/lib/deck.ts` rather than being written twice:
`newDeck` (both platforms have a "New deck" button, and a disagreement about the
default format or fallback name would surface days later on whichever device
didn't make the deck), `mergeDeckCards` (adding a card you already run has to
bump the row, or an exported list names it twice) and `withFormat` (leaving
Commander has to rescue the command zone, or those cards stay in the deck, stay
counted, and vanish from the screen). All three are tested.

Deck edits push on a 1.5-second debounce rather than per write. Building a deck
is a burst of small changes — a quantity stepper is somebody tapping "+" four
times — and a Drive round trip each would be slow, would flap the header between
"syncing" and "synced", and would upload four versions of a state only the last
of which matters. The local write is still immediate, so nothing is at risk.

Which picture a row gets is a ladder, not a lookup, and it now lives in
`src/lib/cardImage.ts` where both builds read it: a Scryfall id resolves to the
image CDN directly (cacheable, and not the rate-limited API redirect), then a
Cardmarket product id, then the row's own captured image, then set code plus
collector number, and only then the card's name. The ordering is by how exactly
each source pins down the *printing* — a name-only lookup returns Scryfall's
default printing, which for a card like Sol Ring is a picture of somebody else's
copy. The extension keeps its own extra rungs above these (a printing the user
picked by hand, an image scraped from a Cardmarket page).

`printingRank` scores a row against that same ladder, rung for rung, for when
several rows name one card and only one of them can supply the picture — four
copies of Sol Ring from four sources collapse to the best-identified one. Keeping
it in step with the ladder matters: it used to give a bare set code a rank it
could not cash in, and a set code without a collector number resolves to nothing
better than a name lookup, so such a row could outrank one carrying a real image
URL and hand back the worse picture.

### Measuring the card scanner

Full continuous-scanner design: [`docs/SCANNER.md`](docs/SCANNER.md).
Development capture / Drive corpus: [`docs/SCANNER-CORPUS.md`](docs/SCANNER-CORPUS.md).

```bash
yarn scan:fixtures          # resolve the test corpus from Scryfall (writes scripts/fixtures/cards.json)
yarn scan:index             # build the card-name index the matcher needs
yarn scan:art-index:fixtures # compact artwork descriptors for the fixture set
yarn scan:eval              # classic title-only corpus (accuracy + timings)
yarn scan:detect-eval       # detection-only; synthetic and real reported separately
yarn scan:detect-annotate   # click 4 corners on a phone photo → .scan-real/
yarn scan:corpus:import ./path  # Drive download or export JSON → .scan-corpus/
yarn scan:pipeline          # compare TITLE_ONLY / ART_ONLY / ART_PLUS_TITLE / FULL_PIPELINE
yarn scan:pipeline:real     # optional gitignored real-photo corpus
yarn scan:variants          # benchmark preprocessing chains against each other
yarn scan:calibrate         # measure where the title actually sits on each layout
yarn scan:folds             # compare name-normalization strategies
yarn test:scan              # unit tests (portable core, no camera)
yarn test:corpus            # development-capture policy / Drive transport tests
```

Real-camera detection notes: [`scripts/fixtures/REAL-DETECTION.md`](scripts/fixtures/REAL-DETECTION.md).
Synthetic detection ≠ proven on a desk — populate `.scan-real/` and run
`yarn scan:detect-eval --real` before trusting acquisition.
The scanner is the one feature where "that feels better" is worthless: a change
that rescues the card on your desk routinely breaks five others, and nobody
notices until a shop trip. So `scripts/scan-eval.mjs` / `scan-pipeline-eval.mjs`
run the real pipeline — the same `src/lib/scan/` modules the phone runs, which is
why none of them may touch the DOM — over a fixed set of cards under synthetic
tilt, blur, glare, dim light and filmed-screen conditions, and report detection
rate, title accuracy, multi-signal accuracy and per-stage time.

The phone UX is continuous: camera opens, detects a stable card, recognizes
without a mandatory shutter, suppresses duplicates until the card leaves, and
shows candidates when identity is ambiguous.

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
Search tab (it tracks Cardmarket's Price Trend closely); live page fetches are
kept only for close calls and on demand, for the live *From* price.

The gain needs a cost basis, and there are two sources. ManaBox writes
`purchasePrice` into every scanned row, which we no longer throw away. Cardmarket
knows it too — every order line carries a unit price — and the purchase sync now
records it, as a quantity-weighted average per printing
(`src/lib/purchaseCost.ts`, tested, because every way of getting this wrong
yields a plausible number nobody would question). Until it did, gain worked only
for people who had also imported a CSV: anyone who synced their orders saw a
portfolio value with no basis and therefore no gain at all. An order line with no
parsed price counts as unrecorded rather than as a free copy. See
[docs/PRICES.md](docs/PRICES.md).

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

The overlay docks to either side of any Cardmarket page, or takes the full screen.
Its tabs are the feature list:

- **Search** — a card you went looking for, the offers on the page in front of
  you, or a seller's entire stock after a scan, all cross-referenced against your
  want lists. Per-offer price, condition, language and foil status; edition and
  foil price breakdown; add-to-cart and add-to-want-list; shipping tiers per
  seller. **Wants only on page** hides rows for cards you don't want, on
  Cardmarket's own table.
- **Collection** — what you own, valued from the local price table, with
  gain-since-purchase. Imports and exports ManaBox's own formats, and can build
  itself from what you have already bought (see **Past purchases**, below).
- **Wants** — your want lists side by side, with bulk move, copy and delete.
- **Decks** — deck building against Scryfall search, EDHREC and Goldfish views,
  and a suggested cut list.
- **Filter** — the gameplay metadata Cardmarket won't filter on: colour, type,
  creature type, mana value. Optionally hides non-matching rows on the page.

The Search, Collection and Filter tabs also filter by **edition**, arranged as a
timeline rather than an alphabet (see below).

**Traffic** and **API** are development tools and stay behind `flags.devTools`.

Each tab owns the sync that fills it: want lists are read from the Wants tab,
order history from the Collection tab. Both used to live together under a
**Tools** disclosure in the Search tab, which meant the two most important
buttons in the app were collapsed by default, in a tab about neither of them. What is
*running* is not a tab's business at all — the queue is global and survives page
changes — so it moved to a header icon that appears only when something is
happening and lists it on hover (`TaskIndicator`).

### Finding a card

The Search tab draws its rows from three sources, and they are the same kind of
row: whatever is on the page behind the panel, a seller's whole stock after a
scan, or a printing you searched for. All three end as `ParsedOffer[]` and go
through one renderer, which is why a searched card arrives with price comparison,
the cart button, and the owned/purchased tags already working rather than as a
second, poorer list.

Typing hits Cardmarket's own autocomplete, which answers with every *printing* of
a match — expansion, product id and live offer count — in one small reply. That
matters for a picker: "Abrupt Decay" is fourteen different products, and choosing
between them by expansion is the whole job. Picking one fetches its product page
and reads it with the same parser the live page goes through.

That endpoint takes some explaining, because it does not look like the others
(`src/sites/cardmarket/search.ts`). Cardmarket posts to a single unnamed
`/AjaxAction` with one parameter:

```
args=<obfuscated>***<base64 of the search parameters>
```

The half before the `***` is the action name and the session's CSRF token with
each character XORed against a counter that starts at `0x58` and steps by one, so
the plaintext reads `Product_Search***<64 hex characters>`. There is no secret in
it — the token is the same `__cmtkn` every other Cardmarket AJAX call sends in the
clear — so it is a wire format to reproduce rather than a lock to pick.

Two things follow from that, and both are in `searchArgs.ts` with tests against a
real captured request. The scramble is length-sensitive, so the bytes must go out
raw: `encodeURIComponent` would UTF-8 a high byte into two and shift everything
after it. And the JSON's field order is Cardmarket's own rather than alphabetical,
which needs an `eslint-disable` to survive `sort-keys-fix` — a request that is
byte-identical to the search box's cannot be rejected for a reason we failed to
imagine. The test asserts that byte-identity, because the failure mode here is not
an error; it is a search that quietly returns nothing.

If the format ever moves, `searchProducts` throws rather than reporting "no
results" for a card the user can plainly see, and the dropdown offers Cardmarket's
own search page instead.

A missing catalogue has to announce itself. Without release dates every edition
files under "Year unknown", which is indistinguishable from a shelf of expansions
Scryfall has never heard of — the filter goes on looking like it works, and the
obvious conclusion is that the data source is wrong when in fact nothing was
fetched. So `useSetIndex` reports `loading` / `ready` / `failed` rather than just
handing back an empty index, and the filter says "release dates unavailable"
when the fetch fell over.

The token has to be asked for rather than read off the page. Most of Cardmarket —
product pages, search results, expansion listings — prints no `__cmtkn` in the
live DOM, so the first cut of this used `findCmToken()` and worked on almost none
of the pages you would actually be browsing when you want to look a card up.
`ajaxToken()` in `src/content/session.ts` borrows one from the current page, the
Magic home page, or the Wants page — and also reads it back out of intercepted
search requests if you have used Cardmarket's own search box. Writes still go
through `cmToken()`, which insists the fetched page looked signed-in. Both cache
a successful borrow for the life of the content script.

### The first run

Every one of those tabs is a view over two things Lugin reads from your account:
your want lists and your order history. Until they are read, each tab is an empty
box — and the buttons that fill them were behind a **Tools** disclosure in the
Search tab, so the first impression was a set of empty rooms with the light switch
in a cupboard. A new install now opens on a welcome screen instead, which asks for
the two syncs, says what each one buys you and roughly how long it takes, and
offers **Skip** just as plainly.

Deciding whether someone is new is the part worth care. Every store loads
asynchronously from `chrome.storage`, so "this user has nothing" and "we have not
looked yet" are the same shape, and reading them as the same thing would greet
*everyone* on *every* page load for as long as storage took to answer. So the
stores now expose a `loading` flag, the question lives in one tested pure function
(`src/ui/firstRun.ts`), and `useFirstRun` subscribes only until the answer is
known — a purchase sync reports progress once per order, and the shell has no
business re-rendering hundreds of times for a question settled in milliseconds. A
skip is remembered, because someone who declined still has no data and asking
again would be nagging dressed as onboarding.

### Past purchases as a collection

The Collection tab can fill itself from your order history: Cardmarket already
knows every card you bought, which is a collection you have typed in once
already. The control sits with the cards it creates, and it does two separate
things on purpose — a button that folds in the history **already downloaded**, and
**Auto add new purchases** for whether to keep doing it. The preference existed
before, in the Search tab, and it only took effect on the *next* sync: you could
tick it with a year of history indexed and watch nothing happen. Rebuilding
replaces the purchased rows wholesale and leaves uploaded rows alone, so it can be
run again without doubling anything.

Only what has **arrived** is folded in. A card you paid for on Tuesday is not in
your collection on Tuesday; it is in a padded envelope, and a collection that
lists it is one you cannot trust when you go looking for the card. The purchase
sync already enumerates orders by Cardmarket's own state (`Paid`, `Sent`,
`Arrived`, `NotArrived`) to find them, so it now records which list each order came
from — the one reading of "has it turned up" that refreshes on every sync without
refetching the order itself. An order with no recorded state counts as arrived:
unknown states are almost entirely old orders too deep in the history for an
incremental sync to walk past again, and reading them as undelivered would quietly
empty someone's collection (`src/lib/arrivedPurchases.ts`, tested). Copies still in
transit are counted and shown rather than silently omitted, since a number that
does not add up reads as a bug.

**A purchase that looks like a card you already have is withheld, not added.**
Rebuilding the purchased rows makes the fold-in idempotent against itself, but it
said nothing about the *other* rows: a card scanned into ManaBox and also bought
on Cardmarket became two rows, and `buildCollection` sums quantities across rows,
so the count silently doubled. Uploading a file has always asked this question —
that is what `src/lib/duplicates.ts` is for — and the purchase path now asks it
too, holding the collisions back and offering a review in the Collection tab.
Ticked means "already in my collection", the same default as the import review:
an inflated count is indistinguishable from a correct one without recounting a
binder, so it errs towards not growing the collection behind your back.

Answers have to outlive the rows they are about, since every sync re-derives
them. They are recorded against a key built the way the fold-in groups order
lines — product id, else edition name, split by finish — so buying a third copy
of something already answered about doesn't reopen a settled question, and
answers about purchases no longer in the history are pruned
(`src/lib/purchaseDuplicates.ts`, tested).

Pairing a purchase against an uploaded row needed a new rung on the matching
ladder. Purchase rows know their edition as a *name* and never as a set code,
while ManaBox exports lead with the code, so the two sides had no set field in
common and every purchase could only be graded a vague "maybe". Matching on the
set name ranks below the set code, which is the honest ordering: names agree far
less reliably than codes. The same pass removed two false claims of confidence —
rows that state no set were being paired as "same set", and rows that state no
printing at all as "same printing", both on a collision of empty strings.

Filter selections in all three filtering surfaces survive navigation for six
hours (`src/ui/useStickyState.ts`). Cardmarket is server-rendered, so following a
link tears the content script down and builds a new one — anything held in plain
component state was gone the moment you clicked a card, which reproduced the
complaint people make about Cardmarket's own filter panel. Six hours rather than
forever because a filter is a statement about what you are shopping for now;
restoring last week's would hide most of a fresh page with no visible cause.

### Filtering by edition, chronologically

Cardmarket orders expansions alphabetically, which files "Alliances" beside
"Alchemy Horizons" and tells you nothing about either. Lugin's edition filter
(`src/ui/components/EditionFilter.tsx`) groups by release year, newest first, and
lists each year's printings the same way — newest at the top.

Options are always derived from the rows on screen, never from the whole
catalogue: a collection spanning thirty sets offers thirty choices, not the nine
hundred Magic has released. They are also derived *before* the edition filter
applies, or picking one set would erase the choices beside it.

Dating a set means reconciling three catalogues. Scryfall's `/sets` supplies the
release dates — one request of about a thousand entries, held by the worker for a
week (`src/background/sets.ts`), since new sets appear about monthly and old ones
never move. Rows imported from ManaBox carry Scryfall's own set code and match
exactly. Rows read off Cardmarket only have a display name, and Cardmarket's
names are its own, so `src/lib/sets.ts` tries the name as written first and only
then loosens: dropping a "Universes Beyond:" label, folding every Secret Lair
superdrop back into the one set Scryfall keeps, stripping a ": Extras" or
": Tokens" suffix to reach the parent set, and translating the handful Cardmarket
renames outright — "Alpha" for "Limited Edition Alpha" and the other early
printings, which being the expensive ones are the sets people most want to filter
down to. The exact name always wins, so a set genuinely called "Guilds of Ravnica
Promos" resolves to itself rather than its parent.

A few will never match: Scryfall calls Cardmarket's "Guilds of Ravnica: Guild
Kits" the "GRN Guild Kit", and no textual rule bridges that. Those collect in a
trailing "Year unknown" group instead of being dropped, because hiding them would
quietly shorten the list the filter claims to describe. The same group holds
everything before the catalogue arrives, where it degrades to a plain alphabetical
list rather than an empty filter.

One consequence worth noting: list pages now record which expansion each row
belongs to, read from the product URL rather than the markup
(`src/sites/cardmarket/productUrl.ts`). Every single links to
`/Products/Singles/<Expansion>/<Card>`, and that path has survived every layout
change, while the expansion icon has moved between an anchor, a span and a
tooltip. It also means a search page lists one row per printing rather than
collapsing them by name, which is what makes an edition filter meaningful there.

Preferences for new wants — the condition floor and a maximum price — sit in the
Wants tab, beside the lists they apply to. They are Cardmarket's own fields, and
the single-add button and the bulk "add missing cards" task read one stored
answer, having previously hardcoded two different condition floors.

## Measured against what people complain about

Lugin is aimed at a published list of the most common Cardmarket complaints. It
is worth being explicit about which ones it answers, because the pattern is
sharper than the individual rows: **the buyer-side complaints are largely solved
and the seller-side ones are not addressed at all.**

| Complaint | State |
| --- | --- |
| Filter a seller's stock by my want lists | **Solved.** Scan a seller's whole stock and see only your wants; on the page in front of you, non-wanted rows can be hidden outright. |
| Wants management / a "shopping wizard" | **Partly.** Deep list management, any-printing wants, best-single-seller ranking with shipping. No multi-seller basket optimisation. |
| Filters that persist and don't collapse | **Solved** for Lugin's own filters. Cardmarket's panel is untouched. |
| An edition list you can navigate | **Solved.** Grouped by release year, newest first, instead of alphabetically. |
| Favourite or followed sellers | **Yes** — pin with the star on seller rows (card search, best-sellers, cart). Favourites float to the top of offer lists and get a **Fav** badge. |
| Prices broken down by language and condition | **Partly.** Captured per offer; not aggregated, and no history. |
| Bulk listing cards for sale | **No.** |
| Inventory export and bulk editing | **Partly.** ManaBox round trip and multi-select actions; no bulk field edit, no seller inventory. |
| Search better than Cardmarket's | **Partly.** Scryfall search for deck building; no replacement for the catalogue search. |
| Sales tracking and accounting | **Partly, and only for buying.** Purchase history, spend, cost basis and gain. Nothing for sellers. |
| Fewer clicks for common toggles | **Partly.** Foil is read and respected; there is no one-click foil filter. |

### What it deliberately doesn't do

Everything a **seller** needs is absent, and that is a scope decision rather than
a backlog: bulk listing, stock management, price suggestion and sales accounting
would be a different product, and the extension writes nothing to Cardmarket
except buyer-side actions it replays from the site's own requests (cart adds,
want edits). The only DOM writes are hiding rows and sampling the site's theme.

Two gaps are worth separating from the rest because they are cheap now and get
expensive later:

- **Price history does not exist, and cannot be backfilled.** The daily table is
  a snapshot that overwrites; a day not retained is gone. Everything people ask
  for under "price trends" and most of what they ask for under accounting rests
  on a time series that has to start accumulating before it is useful.
- **Language restriction on wants is plumbed but not exposed.** `addWant` carries
  the field; the UI does not offer it, because Cardmarket's language ids would
  have to be guessed and a want silently filtered to the wrong language looks
  exactly like a correct one. `languageOptionsFromPage` reads the ids off the
  site's own picker, which needs confirming against a real want form once.

Genuinely large, for contrast: multi-seller basket optimisation (the real
Shopping Wizard equivalent), and replacing Cardmarket's catalogue search, whose
result cap is a server-side limit no amount of DOM reading gets around.

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

**Apply to page** hides the non-matching rows on Cardmarket itself. Two details
that are load-bearing rather than incidental:

- It waits for the metadata. On a page whose cards haven't been looked up yet
  every card is colourless and typeless, so a restored "red only" filter would
  match nothing and blank the whole page — which looks like a broken extension,
  not an active filter. A restored filter also fetches its metadata unprompted,
  or persistence would preserve the checkboxes without preserving the filter.
- Row hiding is **registered per owner** and the registrations intersect
  (`src/content/pageFilter.ts`). The Search tab hides rows too, and every panel
  stays mounted at once, so a single apply/clear pair meant the last effect to
  run took the page and a re-render of an idle panel cleared the active one's
  work.

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
  manifest.config.ts      # MV3 manifest (crxjs) — edit TARGET_MATCHES here
  interceptor/main.ts     # MAIN-world fetch/XHR capture
  content/                # everything that touches the live page
    index.tsx             #   shadow-DOM mount + message bridge
    extractionRunner.ts   #   DOM extraction + MutationObserver
    pageFilter.ts         #   hides rows on Cardmarket, registered per owner
    taskQueue.ts          #   long multi-page jobs, resumable
    *Store.ts             #   observable stores (wants, cart, collection, …)
  sites/
    registry.ts           # host -> adapter lookup
    types.ts              # SiteAdapter interface + page/extraction types
    cardmarket/
      adapter.ts          #   page detection + layered extraction
      selectors.ts        #   ALL Cardmarket selectors (tune here)
      wants.ts            #   want lists, seller scans, purchase history
      wantDefaults.ts     #   condition/price/language for new wants
      language.ts         #   reading an offer's language off a row
      search.ts           #   the site's own autocomplete, called the way it is
      searchArgs.ts       #     its wire format, kept pure so it can be tested
      productUrl.ts       #   the expansion hiding in a /Products/Singles/ path
      ajax.ts             #   decoding the <ajaxResponse> envelope
      cart.ts, shipping.ts
  lib/                    # portable: no DOM, no Chrome, no React
    mtg.ts                #   card/offer data model
    prices.ts             #   valuation and gain
    purchaseCost.ts       #   cost basis from order lines
    sets.ts               #   dating an expansion across three catalogues
    import.ts, export.ts  #   ManaBox formats, both directions
    scan/                 #   the card scanner (see below)
  core/sync/              # platform-free sync engine (Drive + conflict copies)
  platform/               # the only Chrome-vs-web difference
    chrome/, web/         #   local + remote repositories, auth
  background/             # service worker: toolbar, CORS-free fetches, prices,
                          # Scryfall metadata and the expansion catalogue
  ui/                     # the extension overlay
    App.tsx               #   shell: tabs, docking, theme
    components/           #   WantsPanel, CollectionPanel, DeckPanel, …
    useStickyState.ts     #   filters that survive a navigation
  web/                    # the phone app, same lib/ and core/
    ScanScreen.tsx        #   camera + OCR
    cardIndexStore.ts     #   the cached card-name index
```

`src/lib/scan/` is deliberately free of the DOM: the evaluation harness in
`scripts/` runs the same modules the phone runs, which is the only reason its
numbers mean anything.

## Known constraints

- Cardmarket's markup is the ground truth and it is not a contract. Selector
  changes are a one-file fix (`src/sites/cardmarket/selectors.ts`) by design, but
  they are a fix somebody has to make.
- Anything that walks many pages (a seller scan, a purchase sync) is paced and
  capped, because the alternative is a Cloudflare challenge. A very large seller
  stops at `MAX_SELLER_PAGES`.
- Prices are a **daily snapshot**, not live, except for the on-demand *From*
  price. There is no history at all.
- The phone app cannot show Cardmarket: the site sends
  `x-frame-options: SAMEORIGIN`. Scanning, collection and decks work there;
  Cardmarket integration is extension-only.
- Response bodies are captured as **text** and capped at **512 KB** (see `MAX_BODY_BYTES`). Binary responses show a placeholder.
- Capture only sees traffic made via `fetch`/`XMLHttpRequest` from the page. Requests made by the browser itself (documents, images, `sendBeacon`, WebSockets) aren't wrapped yet.
- The overlay is injected in the top frame only (`all_frames: false`).

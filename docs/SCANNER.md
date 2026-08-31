# Physical card scanner

Lugin’s phone scanner identifies paper Magic cards from a live camera feed.
Recognition is **offline-first**: camera frames never leave the device, and
indexes are downloaded once and cached.

## Continuous flow

```text
LIVE VIDEO
    ↓
cheap card detection          (limited rate, latest-frame)
    ↓
stable-card tracking
    ↓
best-frame selection          (sharpness / glare / coverage)
    ↓
perspective normalization
    ↓
ARTWORK + TITLE candidates
    ↓
candidate union + fusion
    ↓
progressive TEXT / TYPE / FOOTER   (only when ambiguous)
    ↓
temporal consensus
    ↓
card identity  →  printing identity when evidence allows
```

UI states (see `src/lib/scan/session/controller.ts`):

| Phase | Meaning |
| --- | --- |
| `searching` | Looking for a card rectangle |
| `detected` | Card seen; waiting for stability |
| `locking` | Stable; pooling quality frames |
| `recognizing` | Running art / title / optional secondary OCR |
| `found` | Confident card identity (printing may still be soft) |
| `ambiguous` | Show candidates / keep sampling |

After `found`, the same stationary card is not re-inserted. Removal or a large
visual change returns to `searching`.

## Architecture

Portable core lives under `src/lib/scan/` and must not import React, DOM, or
Chrome APIs. Browser glue:

- `src/web/ScanScreen.tsx` — continuous UX
- `src/web/scan/liveLoop.ts` — `requestVideoFrameCallback` / rAF, latest-frame
- `src/web/scan/camera.ts`, `canvasBridge.ts`, `tesseractRecognizer.ts`
- `src/web/cardIndexStore.ts`, `artworkIndexStore.ts` — Cache API indexes

The offline evaluation harness imports the same `src/lib/scan` modules via
esbuild, so production and benchmarks cannot drift silently.

## Recognition signals

| Signal | Role |
| --- | --- |
| Artwork perceptual match (dHash + block-mean + hue) | Broad candidate generation |
| Title OCR + `shapeFold` + name index | Independent candidate generation |
| Rules/printed text tokens (IDF over pool) | Secondary reranker |
| Type-line OCR | Soft secondary (only when ambiguous) |
| Footer / collector OCR | Printing narrowing after card identity |
| Temporal consensus | Multi-frame agreement boost |

**Card identity** is primarily an `oracleId` / English name decision.
**Printing identity** (`scryfallId`) uses artwork set hints, collector number,
and language when available. Exact printing is not required to add a card.

## Indexes

```bash
yarn scan:index                 # card names (EN + FR/DE/IT titles)
yarn scan:art-index             # full unique-artwork descriptors (slow, network)
yarn scan:art-index:fixtures    # fixture-scoped art index (CI / local eval)
```

Artwork index payload shape: `{ art: { entries, version }, text: { entries } }`.
Only compact descriptors and tokens are stored — **no card imagery**.

Deployed beside the web app as `art-index.json` / `card-names.json` (Pages).
Phone caches them like the price table.

Approximate sizes (full catalogue, order of magnitude):

- card-names.json ≈ 3.5 MB uncompressed / ~1.2 MB gzipped
- art-index.json ≈ depends on unique illustrations; descriptors are tens of bytes each

## Optional scan context

`ScanContext` on the session controller accepts soft preferences:

- `preferSets` — boost printings / footer matches
- `preferLanguage` — reserved for UI wiring

Ordinary scanning works with no configuration.

## Debug

`flags.scanDebug` exposes detector corners, quality metrics, and
`ScanDebugPanel` crops/timings. Not shown in normal production UX.

## Evaluation

```bash
yarn scan:fixtures          # resolve Scryfall ids → download images locally
yarn scan:index
yarn scan:art-index:fixtures
yarn test:scan              # unit / integration (no camera)
yarn scan:eval              # classic title-only synthetic corpus
yarn scan:pipeline          # TITLE_ONLY / ART_ONLY / ART_PLUS_TITLE / …
yarn scan:pipeline --mode ART_PLUS_TITLE
yarn scan:pipeline:real     # gitignored real-photo corpus if present
yarn scan:variants
yarn scan:folds
yarn scan:calibrate
```

Pipeline modes report detection rate, oracle top-1/top-5, **false confident**
rate (high confidence but wrong), unresolved rate, and stage latencies.

Do not claim production accuracy from synthetic fixtures alone.

## Real-photo corpus

Copyrighted card photos must not be committed. Locally:

1. Create `.scan-fixtures/real-photos/` (already gitignored via `.scan-fixtures/`).
2. For each photo, add `shot-001.png` plus `shot-001.json`:

```json
{
  "expectedName": "Sol Ring",
  "scryfallId": "acce65cc-9093-45a6-8c86-97edce545050",
  "tag": "foil-sleeve",
  "imageFile": "shot-001.png"
}
```

3. Run `yarn scan:pipeline:real`.

Useful coverage: sleeves, foil glare, dim light, autofocus hunt, old-frame,
borderless, battles, localized titles. Evaluation skips the corpus when absent.

## Known limitations

- Perceptual hashes degrade under heavy foil glare and thick sleeves; title OCR
  is the rescue path. A neural embedding backend is **not** shipped until
  measured evidence shows hashes are insufficient on a real-photo set.
- Battle / split layouts use separate `ScanProfile`s; coverage is still thinner
  than modern portrait frames.
- Type-line OCR is intentionally soft and often skipped when art+title already
  agree.
- Fixture-scoped art indexes in CI are not a substitute for a full catalogue
  index on production phones.

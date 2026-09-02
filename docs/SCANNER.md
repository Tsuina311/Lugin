# Physical card scanner

Lugin’s phone scanner identifies paper Magic cards from a live camera feed.
Recognition is **offline-first**: camera frames never leave the device, and
indexes are downloaded once and cached.

## Continuous flow

```text
LIVE VIDEO
    ↓
cheap card detection          (DETECT_INTERVAL_MS, latest-frame)
    ↓
multi-candidate scoring       (luma / chroma / edge masks)
    ↓
stable-card tracking + coast
    ↓
best-frame quality pool
    ↓
perspective normalization
    ↓
recognition (only when locked)
```

### Live polygon (product UI)

The scanner draws the **actual detected four corners** over the camera
(`object-fit: cover` aware). States:

| Phase | Outline | Label |
| --- | --- | --- |
| searching | none | Place a card in view |
| detected | amber dashed | Hold steady |
| locking | green solid | Card locked |
| recognizing | blue solid | Recognizing… |
| found | green thick | Found / card name |

No fixed fake guide rectangle substitutes for detection.

### Detection debug (`flags.scanDebug`)

Shows detection ms, candidate count, selected method/score, rejection reasons,
track length, motion, quality.

## Real-camera detection corpus

Synthetic fixtures alone are insufficient. See
[`scripts/fixtures/REAL-DETECTION.md`](../scripts/fixtures/REAL-DETECTION.md).

```bash
yarn scan:detect-annotate path/to/phone-photo.png
yarn scan:detect-eval --synthetic
yarn scan:detect-eval --real
```

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

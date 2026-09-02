# Physical card scanner

Lugin’s phone scanner identifies paper Magic cards from a live camera feed.
Recognition is **offline-first**: camera frames never leave the device, and
indexes are downloaded once and cached.

## Continuous flow

```text
LIVE VIDEO (preferred 1080p rear + continuous AF when supported)
    ↓
cheap card detection          (DETECT_ANALYSIS_MAX_WIDTH, latest-frame)
    ↓
multi-candidate scoring       (luma / chroma / edge masks)
    ↓
stable-card tracking + coast
    ↓
FOCUSING if geometry stable but soft
    ↓
best-frame quality pool       (hi-res warp from video)
    ↓
perspective normalization
    ↓
recognition (only when sharp enough)
```

### Live polygon (product UI)

The scanner draws the **actual detected four corners** over the camera
(`object-fit: cover` aware). States:

| Phase | Outline | Label |
| --- | --- | --- |
| searching | none | Place a card in view |
| detected | amber dashed | Hold steady |
| focusing | yellow dashed | Focusing… |
| locking | green solid | Card locked |
| recognizing | blue solid | Recognizing… |
| found | green thick | Found / card name |

No fixed fake guide rectangle substitutes for detection.

### Camera acquisition

See **Camera acquisition** below. Requested constraints ≠ actual settings —
always read `getSettings()` / `getCapabilities()` in `scanDebug` → **Cam**.

### Detection debug (`flags.scanDebug`)

Shows detection ms, candidate count, selected method/score, rejection reasons,
track length, motion, quality, and live camera resolution/focus mode.

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

## Camera acquisition

On multi-camera Samsung / Pixel phones, Chrome often opens the **ultrawide**
(zoom &lt; 1). Ultrawide minimum focus distance is large — desk cards look soft.
Lugin forces zoom ≈ 1 (main lens) when that range exists.

Tap always attempts single-shot / POI / continuous AF nudge even when
capabilities omit `pointsOfInterest` (common on Galaxy Chrome).

### Preferred constraints (with fallbacks)

1. `facingMode: environment`, `1920×1080` ideal, `30` fps ideal  
2. environment `1280×720`  
3. environment any  
4. any `videoinput`

Then, if `getCapabilities().focusMode` includes `continuous`, apply it via
`applyConstraints({ advanced: [{ focusMode: 'continuous' }] })`.

Never treat requested constraints as proof of the stream — use `getSettings()`.

### Resolution pipeline

```text
camera source (e.g. 1920×1080)
  → analysis copy ≤640px wide (detection / tracking)
  → on stable card: warp hi-res crop from full video
  → quality / sharpness gate
  → recognition on best sharp normalized card (744×H)
```

### Real-phone checklist (`flags.scanDebug`)

1. Open scanner; tap **Cam**.
2. Record: device label, `deviceId`, actual `width×height`, fps, focus mode,
   focus modes list, pointsOfInterest, zoom, torch.
3. Place a card at a normal desk distance; watch for **Focusing…** then lock.
4. Compare visually with the native Camera app at the same distance.
5. If soft: try another rear videoinput in the Cam panel; try tap-to-focus;
   try moving slightly farther; optional torch.
6. Note whether continuous AF is reported and active.

We cannot inspect the native Camera app programmatically — the Cam panel exists
so limitations are visible rather than guessed.

### Browser limitations

Many iOS Safari / PWA builds omit `focusMode` / `pointsOfInterest` in
capabilities. The scanner must still work via browser default AF + sharpness
gate. Unsupported advanced constraints are ignored, not fatal.

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

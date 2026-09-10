# Geometry Benchmark + Geometry Lab

Host-side measurement infrastructure for card geometry. **No production detector
changes.** No phone required for inventory / lab / shared-js benchmark.

Strategic goal: become excellent at finding cards under hard conditions
(dark cards, sleeves, glare, foils, perspective, binders, multi-card) — with
numbers, not “the polygon looks better.”

## Commands

```bash
yarn geometry:inventory     # discover real images + metadata
yarn geometry:bootstrap     # fixture JSON from existing quads (bootstrap only)
yarn geometry:queue         # rank untrusted fixtures for manual review
yarn geometry:lab           # annotate / review quads in the browser
yarn geometry:split         # deterministic train/val/test by capture series
yarn geometry:benchmark     # shared-js detector metrics vs fixtures
yarn geometry:benchmark --engine=native
yarn geometry:benchmark --engine=both
yarn geometry:parity        # JS ↔ DetectCard.kt disagreement report
yarn geometry:benchmark --all-usable          # bootstrap smoke ONLY (not accuracy)
yarn geometry:benchmark --save-baseline       # write engine-specific baseline
yarn geometry:leaderboard --engine=js
yarn geometry:leaderboard --engine=native
yarn geometry:tune          # parameter-search scaffold (no search yet)
```

Native host batch + input contract: [`docs/GEOMETRY-NATIVE.md`](GEOMETRY-NATIVE.md).

### Efficient review workflow

```bash
yarn geometry:queue
yarn geometry:lab
# open http://127.0.0.1:8766/?queue=priority
```

`geometry:queue` ranks untrusted candidates (hard-case, glare, dark, sleeved/foil,
perspective, track↔recognition disagreement, poor bootstrap IoU/score from the
latest benchmark run, unique captureGroup, missing categories) and demotes
near-duplicates within the same series. Lab `?queue=priority` walks that order;
use **Save + Next** after checking trusted.

## Layout

```text
.geometry-corpus/                 # gitignored
  inventory.json
  manifest.json
  splits.json
  fixtures/<id>.json              # schema v1
  train|validation|test|hard/     # pointer lists (no image copies)

.geometry-benchmarks/             # gitignored
  baseline-v1.json
  runs/run-*.json

scripts/geometry/                 # committed tooling
docs/GEOMETRY-BENCHMARK.md        # this file
```

Images stay where they already live (`.scan-inbox/`, `.scan-fixtures/replay/`,
`.scan-real/`, …). Fixtures **reference** paths — we do not duplicate giant PNGs.

## Fixture schema (v1)

Coordinates are always **source-image pixel space**.

```json
{
  "schemaVersion": 1,
  "id": "replay__negate-20260908T082630",
  "image": ".scan-fixtures/replay/negate-20260908T082630/source-highres.png",
  "imageWidth": 1006,
  "imageHeight": 1920,
  "source": "replay",
  "seriesId": "negate-20260908T082630",
  "captureGroup": "negate-20260908T082630",
  "trusted": false,
  "hardRegression": false,
  "negative": false,
  "split": "train",
  "tags": ["sleeved"],
  "cards": [
    {
      "id": "card-1",
      "groundTruthQuad": {
        "tl": [x, y],
        "tr": [x, y],
        "br": [x, y],
        "bl": [x, y]
      },
      "visibility": "full",
      "occluded": false,
      "tags": ["sleeved"],
      "groundTruthSource": "existing-recognition-quad"
    }
  ]
}
```

### Provenance (`groundTruthSource`)

| Value | Meaning |
| --- | --- |
| `existing-recognition-quad` | Bootstrapped from saved recognitionQuad — **not** trusted eval |
| `per-snapshot-quad` | Focus Series per-snapshot latch — bootstrap only |
| `existing-annotation` | Prior `.scan-real` corner JSON |
| `manually-reviewed` | Geometry Lab save with trusted checked |
| `synthetic` | Exact GT from synthetic transforms (stress only) |
| `none` | No quad yet |

**Never** treat every old recognitionQuad as ground truth.

**Report headings stay separate:** REAL TRUSTED · REAL BOOTSTRAP · SYNTHETIC.
Synthetic scores never mix into trusted baselines. See
[`GEOMETRY-SYNTHETIC.md`](GEOMETRY-SYNTHETIC.md).

**Frozen-quad Focus Series** (`quadMode` missing / not `per-snapshot`) is tagged
`frozen-quad-series` and excluded from geometry evaluation — invalid for
multi-frame geometry. Prefer per-snapshot series.

## Geometry Lab

```bash
yarn geometry:lab
# http://127.0.0.1:8766
```

- Prev / next fixture
- Zoom + fit
- Draggable TL / TR / BR / BL
- Polygon overlay, undo / reset / save
- Tags, trusted, hard-regression, provenance
- **Add Card** for multi-card images

## Benchmark metrics

Per card (after max-IoU assignment when N>1 predictions or N>1 GT):

- detection yes/no, false detections, score
- polygon IoU, mean/max corner error, aspect-ratio error, center error
- bands: IoU ≥ 0.95 / 0.90 / 0.80 / miss

Aggregates: recall, precision, mean/median/p10 IoU, mean & p95 corner error,
runtime percentiles. Category breakdown only for tags present in the run.

## Host vs native detector

| Engine | Runs on Mac Node? |
| --- | --- |
| `detectCardQuad` (shared JS) | **Yes** — what `geometry:benchmark` runs |
| `DetectCard.kt` (Android) | **No** |

Kotlin needs Android / JVM instrumentation. Do not fake parity.

Best path to deterministic host↔native comparison (already exists):

1. `yarn scan:detect-native-parity` → RGBA sidecars
2. Gradle `DetectCard.detectFromRgba` unit test with `DETECT_PARITY_DIR`

The algorithm is already dual-ported (TS reference + Kotlin mirror). Measurement
does **not** require a speculative native rewrite.

Saved detector debug PNGs under inbox traces can be inventoried but are often
analysis-resolution overlays — prefer `source-highres` for fixtures.

## Corpus split

Deterministic **70 / 15 / 15** by `captureGroup` (hash of series id).

Related frames (Focus Series T0/T250/T500/T800, Capture A/B of one fixture, swap
frames of one run) **stay in the same split** — no leakage across train/test.

If the corpus is tiny, splits are structural only (tooling prints that warning).

## Hard regression + failure mining

1. Real failure on device / inbox
2. Save image (inbox / `.scan-real`)
3. `yarn geometry:bootstrap` or Lab open
4. Annotate quad + tags + check **hard regression** + **trusted**
5. Fixture enters `.geometry-corpus` — permanent coverage

`hard/` holds pointer ids. CI fail thresholds stay soft until the corpus grows.

## Parameter tune (scaffold)

`yarn geometry:tune` documents tunable knobs from `params.ts` / `detectCard.ts`
(area shares, score gates, continuity IoUs, WORK_WIDTH, mask thresholds, scoring
weights, inner/outer selection). **No search runs today.**

Future loop: train → validation rank → hidden test untouched.

## Synthetic data (scaffold)

Interface only: rotate / perspective / scale / backgrounds / blur / glare /
occlusion / multi-card / overlap with free GT quads.

**Synthetic must never replace the real-device test set.**

## Multi-card / binder / overlap

Schema supports `cards[]` from day one. Benchmark matches predictions↔GT with
greedy max IoU assignment. Binder / overlap categories appear in reports only
when fixtures carry those tags — we do not invent them.

## Workflow (away from phone)

```bash
yarn geometry:inventory
yarn geometry:bootstrap
yarn geometry:lab                 # review + mark trusted
yarn geometry:benchmark --all-usable
yarn geometry:benchmark --save-baseline   # after trusted set exists
yarn geometry:leaderboard
yarn test:scan
yarn scan:regression              # must stay 10/10
```

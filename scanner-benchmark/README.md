# Scanner benchmark

Permanent host benchmark for the Samsung photos already in this repo. It does not change capture thresholds, recognition thresholds, or the phone app.

Production scanner behavior is untouched. `yarn scan:regression` still replays the ten promoted fixtures.

## Commands

```bash
yarn scanner:inventory
yarn scanner:annotate
yarn scanner:bench
yarn scanner:bench --experiment baseline
yarn scanner:bench --experiment oracle-card
yarn scanner:bench --experiment oracle-art
yarn scanner:bench --promote baseline
yarn scanner:export-ml-dataset
yarn test:scanner-benchmark
```

`yarn scanner:inventory` walks `.scan-inbox/sessions`, `.scan-fixtures/replay`, `.scan-fixtures/real-photos`, and `.scan-real`. It writes:

- `scanner-benchmark/manifests/corpus-inventory.json`
- `scanner-benchmark/reports/corpus-inventory.md`
- `scanner-benchmark/manifests/stills-v1.json`
- `scanner-benchmark/manifests/oracle-geometry-v1.json`
- identity and tag seeds under `scanner-benchmark/annotations/`

Images stay where they are. Paths are repo-relative.

## Ground truth

A scanner prediction, OCR guess, or CLIP hit is never an expected identity.

Confirmed labels come from:

- replay `expectedName`
- the real-photo sidecar
- a row saved by the annotation tool with `source: MANUAL` and `status: CONFIRMED`

Only `CONFIRMED` rows are scored. `PROBABLE` is stored and ignored by the default score.

Detector quads, including geometry-corpus bootstraps marked `existing-recognition-quad`, are not corner truth.

## Annotation

```bash
yarn scanner:annotate
```

Opens `http://127.0.0.1:8791`.

- Click corners in order: top-left, top-right, bottom-right, bottom-left. Drag a handle to fix it.
- Search a card name from the local name index. Enter saves and advances.
- `U` marks the identity unknown. `R` clears corners.
- `G` glare, `B` blur, `S` sleeve.
- Arrow keys move without saving.

The queue is `stills-v1`. It starts on the first frame that has no confirmed corners.

## Benchmark

`yarn scanner:bench` scores every confirmed identity.

| Variant | Quad | Crop |
| --- | --- | --- |
| baseline | current `detectCardQuad` | `extractArtCropFromCard` |
| oracle-card | manual corners | same crop |
| oracle-art | manual corners | same crop today |

Oracle-art is a separate experiment id so a later crop mode can be dropped in. Right now it calls the same art crop as oracle-card, so a B→C gap of zero is that fact, not a crop result.

Visual search uses the existing CLIP ViT-B/32 full gallery. It is not retrained.

OCR numbers are **recorded OCR → current name matcher**. Node does not rerun ML Kit.

Fusion calls `fuseEvidence`. CLIP cosine is passed through. `VISUAL_STRONG` is not retuned.

Reports:

- `scanner-benchmark/reports/latest/summary.md`
- `scanner-benchmark/reports/latest/summary.json`
- `scanner-benchmark/reports/latest/index.html`

`yarn scanner:bench --promote <experiment>` writes `experiments/CURRENT_BEST.json`. Nothing promotes itself.

Each run appends `experiments/results.csv` with the dataset hash. If annotations change, `yarn scanner:inventory` changes that hash.

Splits are by capture session, never by adjacent frame. Replay fixtures are `REGRESSION_SANITY` and are also the only confirmed identities until you annotate more.

## What is not in V1

Binder pages are inventoried and left out of the single-card score.

There are no videos. The empty model is `annotations/videos.json`. Collection rules are in `VIDEO_COLLECTION.md`.

`yarn scanner:export-ml-dataset` writes a manifest for a future embedding trainer. It does not train.

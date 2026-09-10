# Geometry — production native detector on host

Measure the **same** `DetectCard.kt` that ships on Android, from the Mac,
against the geometry fixture corpus. Production scanner code is not changed.

## Commands

```bash
yarn geometry:benchmark --engine=js
yarn geometry:benchmark --engine=native
yarn geometry:benchmark --engine=both
yarn geometry:benchmark --engine=native --native-input=y-from-rgba
yarn geometry:parity                 # JS ↔ Native disagreement report
yarn geometry:parity --all-usable
yarn geometry:queue                  # picks up native-js-disagreement
yarn geometry:leaderboard --engine=js
yarn geometry:leaderboard --engine=native
```

Trusted annotations = quality. `--all-usable` = bootstrap smoke only — **not** accuracy.

## Native input contract

### Production live (phone)

```
VisionCamera Frame
  → Y plane (YUV_420_888 plane-0)
  → orientation / analysis crop (useFrameAnalysis + analysisGeometry)
  → DetectCard.detectFromYPlane(y, w, h, rowStride)
  → WORK_WIDTH=320 gray downsample
  → luma multi-threshold + Sobel (NO chroma)
  → corners in analysis/full buffer space, then mapped for overlay / hi-res
```

| Field | Value |
| --- | --- |
| Pixel format | unsigned Y bytes |
| Stride | `rowStride ≥ width` |
| Chroma | **off** |
| Output coords | Y-buffer pixel space |

### Host benchmark (default `--native-input=rgba`)

```
Fixture PNG/JPEG
  → packed RGBA (ScanImage layout, length = w×h×4)
  → DetectCard.detectFromRgba(rgba, w, h)   ← same Kotlin entry as parity APIs
  → WORK_WIDTH=320 gray + RGB
  → luma + chroma + Sobel
  → corners in fixture image pixel space (= groundTruthQuad space)
```

| Field | Value |
| --- | --- |
| Pixel format | R,G,B,A uint8 |
| Orientation | as stored in file (no VisionCamera rotation) |
| Stride | tight `w` |
| Chroma | **on** (matches shared-js) |
| Output coords | fixture pixels |

### Host alternate `--native-input=y-from-rgba`

Derives BT.601 luma from RGBA, calls `detectFromYPlane` (no chroma). Closer to
the **live algorithm**, but luma ≠ camera Y plane, and orientation is still file-space.

**Limitation (do not hide):** host native ≠ phone YUV+orientation pipeline. Default
RGBA mode is the fair JS↔Kotlin algorithm comparison (both get chroma). Live
production misses chroma candidates that RGBA/JS can use.

## Batch execution

`scripts/geometry/native-runner/` is a JVM Gradle app that **compiles the real**
`DetectCard.kt` / `Geometry.kt` / `DetectParams.kt` from
`mobile/modules/lugin-card-detector/android/...` (excludes Expo module glue).

One process:

1. Node exports `.geometry-corpus/native-batch/{manifest.json,*.rgba}`
2. `./gradlew geometryBatch` once
3. Writes `results.json` (id, corners, score, diagnostics, runtimeMs)

Runtime label: `HOST_JVM_NOT_DEVICE_LATENCY` — never treat as Samsung latency.

Requires JDK 21 (`JAVA_HOME` or Homebrew `openjdk@21`).

## Parity + queue

`yarn geometry:parity` writes `.geometry-corpus/js-native-parity.json`.

`yarn geometry:queue` boosts fixtures with reason `native-js-disagreement`
(JS-only, Native-only, or low JS↔Native IoU).

## Baselines / leaderboard

Separate series:

- `.geometry-benchmarks/baseline-js-v1.json`
- `.geometry-benchmarks/baseline-native-v1.json`

Do not mix engines in one historical series.

## Parameter inventory (DetectCard.kt — not tuned)

| Parameter | Value | Meaning | JS equivalent |
| --- | --- | --- | --- |
| `WORK_WIDTH` | 320 | analysis width | `WORK_WIDTH` in detectCard.ts |
| `DETECT_MIN_AREA_SHARE` | 0.04 | min blob area | params.ts |
| `DETECT_MAX_AREA_SHARE` | 0.82 | max blob area | params.ts |
| `DETECT_TOP_COMPONENTS` | 4 | components / mask | params.ts |
| luma multipliers | 2.5, 3.5, 5.0, 7.0 | ring-MAD thresholds | same |
| fixed luma thr | 12, 18, 28 | absolute thresholds | same |
| chroma thr | 18, 28, 40 | RGBA only | same (JS always has RGB) |
| silhouette floor | 0.15 | reject weak quads | same |
| weak non-luma | 0.45 | edge/chroma gate | same |
| detect gate | 0.28 | detected? | DETECT_MIN_SCORE |
| `CANDIDATE_SHORTLIST` | 8 | nested O(n²) cap | multi.ts shortlist |
| nested area fraction | 0.55–0.97 | sleeve inner | multi.ts |
| nested center | ≤0.12 diag | sleeve alignment | multi.ts |
| nested score rule | ≥0.28 or ≥0.75×outer | promote inner | multi.ts |
| `nestedSleeveEnabled` | true | toggle | always on in JS |
| dedupe center | 8 px work | candidate merge | similar |

Future: `geometry:tune --engine=native` → mutate params in a host injection layer
→ batch JVM → train → validation → hidden test. Not implemented yet.

## Algorithm drift notes (audit, not auto-fixed)

Shared by design: WORK_WIDTH, multi-threshold luma, chroma (RGBA), Sobel, hull
corners, scoreCardQuad, nested sleeve preference.

Intentional production difference:

- **Live Y-plane has no chroma** (Kotlin `rgb = null`); JS live-on-RGBA and host
  parity RGBA include chroma.

Possible drift to watch (do not “fix” blindly):

- Nested pick lives in Kotlin (`pickPrimaryWithNested`) vs JS
  `selectPrimaryAmongDebugCandidates` — verify numeric thresholds stay mirrored.
- Dedup / shortlist caps (`CANDIDATE_SHORTLIST=8`, keep ≤12).
- Host file orientation vs VisionCamera rotation spaces.
- Analysis max width on device (`analysisMaxWidth`) before native Y may differ
  from full fixture resolution used in host benchmarks.

## Future tuning architecture

```
parameter set
  → export RGBA batch (once)
  → N× JVM DetectCard with injected params (future hook)
  → evaluate TRAIN
  → rank on VALIDATION
  → leave hidden TEST untouched
  → promote candidate → APK only after host gate
```

Goal: thousands of Kotlin configs without installing an APK.

# Native OCR engine

Status: **ML Kit Latin via `lugin-ocr`.** Production hot path is **RGBA
Uint8Array → native Bitmap → ML Kit** (no base64). High-res Recognition Input
gate **PASSED**. Changes to the Kotlin module require a **new development APK**
(fingerprint change). Do not ship tesseract.js in RN.

Artwork matching and fusion already run without OCR. Title / footer evidence
stay **unavailable** (`ocr: null`) until the APK links `lugin-ocr`; after that,
`useScanSession` feature-detects the module and passes
`createMlkitTextRecognizer()`.

The portable seam is `TextRecognizer` in `src/lib/scan/textRecognizer.ts`.
Native returns `TextRecognitionResult` (raw text + word boxes + confidence +
optional `engine` stage timings). It must **not** decide Magic identity —
ranking stays in shared TypeScript.

OCR runs on **normalized 744×1039 region crops** (title, footer, optional type)
— never on full camera frames, and never at detector cadence.

## Latency emergency path (2026)

| Stage | Contract |
| --- | --- |
| Transport | `recognizeFromRgbaBytes(Uint8Array, w, h)` — **no base64** on hot path |
| Crop | Crop in shared TS **before** bridge (title ≈ 536×75 RGBA ≈ 160 KB) |
| Schedule | **Title first**; footer waits; art parallel (non-OCR) |
| Preprocess | `enhanceForOcrFast` first; one full `enhanceForOcr` fallback if empty |
| Lifecycle | Single lazy ML Kit `TextRecognizer`; `warmUp()` on scanner enter |
| Identity | Exact / strong title → publish immediately; do not wait for footer/art |

Legacy `recognizeFromRgba(base64, …)` remains only for older APKs until rebuilt.

Expected payload sizes (RGBA, before any trim):

| Region | Approx bytes |
| --- | --- |
| Full card 744×1039 | ~3.0 MB (never transfer for OCR) |
| Title crop | ~160 KB |
| Footer number+set (2 crops) | ~80–120 KB total |
| Type line | ~120 KB |

## Compatibility target

- Expo SDK 57
- React Native 0.86 / New Architecture
- Android first (Samsung). iOS later.

## Decision (2026)

| Option | Verdict | Notes |
| --- | --- | --- |
| **ML Kit via thin Expo module (`lugin-ocr`)** | **Chosen** | Google-maintained, New Arch–friendly, bundled Latin model, offline. Same structure as `lugin-card-detector`. |
| `react-native-mlkit-ocr` and forks | Rejected | Mixed / stale; often old-arch only. |
| Tesseract native wrappers | Rejected | Unreliable New Arch story. Web keeps `tesseract.js`; do **not** copy it into RN. |
| VisionCamera frame processors + OCR | Rejected | Would put recognition closer to native pixels; shared code owns identity. OCR stays on warped region crops. |

## Wire-up

| Piece | Location |
| --- | --- |
| Expo module (Android + ML Kit) | `mobile/modules/lugin-ocr/` |
| JS adapter (`TextRecognizer`) | `mobile/src/scan/mlkitTextRecognizer.ts` |
| Session | `useScanSession` → `ocr: isNativeOcrLinked() ? createMlkitTextRecognizer() : null` |
| Warmup | `warmUpMlkitOcr()` when scanner `enabled` (fire-and-forget) |
| Empty helper (tests / explicit) | `mobile/src/scan/emptyOcr.ts` |

Native API:

- **`recognizeFromRgbaBytes(bytes, width, height)`** → text + words + stage timings (`bitmapMs`, `mlkitMs`, `timingMs`, `bytesIn`, `transport`)
- `recognizeFromRgba(base64, width, height)` → legacy only
- `recognizeFromFile(path)` → debug / offline only
- `warmUp()` → tiny 32×32 bitmap once per recognizer lifecycle
- `implementationStatus`: `"ready"`

`RecognizeOptions` (mode / whitelist) are accepted for seam parity but not
forwarded to ML Kit; shared preprocess + post-normalization own character
constraints.

Stage timings: **native-clock-local** vs **JS `performance.now` durations**.
Do not subtract absolute timestamps across runtimes; report stage-local ms
separately (debug panel “OCR pipeline”, debug bundle `TITLE` / `FOOTER`).

## Host replay (Mac)

Once a Samsung fixture is in `.scan-fixtures/replay/`, recognition-logic
changes are evaluated with `yarn scan:replay` / `yarn scan:regression` from
recorded ML Kit strings. Node does not reproduce Android ML Kit. Phone is
only for new captures, native detector/focus, or a fresh OCR reading.

## Remaining work

1. Ship **one** APK with bytes API + warmup; measure Samsung lock→oracle.
2. Optional: native `recognizeRegions` if JS crop+bytes still dominates.
3. Optional: atlas / speculative OCR only after transport is proven fast.
4. iOS Vision adapter later behind the same `TextRecognizer` seam.

Do not bundle SQLite / Drive in the OCR APK unless persistence is next.

# Native OCR engine

Status: **engine chosen — ML Kit Latin via thin Expo module.** High-res
Recognition Input gate **PASSED**. Batch `lugin-ocr` with
`lugin-card-detector` in the **next development APK** (fingerprint change).
Do not ship tesseract.js in RN.

Artwork matching and fusion already run without OCR. Title / rules / footer
evidence stay **unavailable** (`ocr: null`) until the new APK links
`lugin-ocr`; after that, `useScanSession` feature-detects the module and
passes `createMlkitTextRecognizer()`.

The portable seam is `TextRecognizer` in `src/lib/scan/textRecognizer.ts`.
Native returns `TextRecognitionResult` (raw text + word boxes + confidence).
It must **not** decide Magic identity — ranking stays in shared TypeScript.

OCR runs on **normalized 744×1039 region crops** (title, text box, footer,
collector) — never on full camera frames, and never at detector cadence.

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

### Why ML Kit (rationale)

1. Thin local Expo module is smaller and safer than adopting an abandoned RN
   wrapper on RN 0.86 / New Architecture.
2. Bundled `com.google.mlkit:text-recognition` (Latin) is offline and does not
   depend on a Play Services model download for the common EN card path.
3. Output maps cleanly onto `TextRecognitionResult` (`text`, `words[]` with
   boxes + confidence). Magic matching stays in `readCard` / fuse.
4. Fingerprint already changes for `lugin-card-detector` — batch OCR in the
   same next APK rather than a second native rebuild.

Oracle top-1 / top-5 on fixtures remains the quality bar after the APK lands;
character accuracy alone is not the ship gate.

## Wire-up

| Piece | Location |
| --- | --- |
| Expo module (Android + ML Kit) | `mobile/modules/lugin-ocr/` |
| JS adapter (`TextRecognizer`) | `mobile/src/scan/mlkitTextRecognizer.ts` |
| Session | `useScanSession` → `ocr: isNativeOcrLinked() ? createMlkitTextRecognizer() : null` |
| Empty helper (tests / explicit) | `mobile/src/scan/emptyOcr.ts` |

Native API:

- `recognizeFromRgba(base64, width, height)` → `{ text, confidence, words, timingMs }`
- `recognizeFromFile(path)` → same (JPEG/PNG temp files)
- `implementationStatus`: `"ready"`

`RecognizeOptions` (mode / whitelist) are accepted for seam parity but not
forwarded to ML Kit; shared preprocess + post-normalization own character
constraints.

## Remaining work (title-region path)

After the APK links the module:

1. Confirm `isNativeOcrLinked()` on Samsung and that title/text/footer debug
   chips flip from `unavailable` → `present`.
2. End-to-end: warped 744×1039 → `readTitle` / rules / footer crops → ML Kit
   → name index / text evidence / fuse.
3. Benchmark oracle top-1 / top-5 vs web tesseract on the same fixtures.
4. Tune shared OCR preprocess only if ML Kit underperforms on foil / glare
   crops (do not add Magic logic in Kotlin).
5. iOS Vision adapter later behind the same `TextRecognizer` seam.

Do not bundle SQLite / Drive in the OCR+detector APK unless persistence is
actually next.

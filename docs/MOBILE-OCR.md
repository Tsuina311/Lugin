# Native OCR engine survey

Status: **interface wired, engine not chosen.** Artwork matching and fusion
run without OCR. Title / rules / footer evidence stay empty until a
maintained recognizer lands.

The portable seam is `TextRecognizer` in `src/lib/scan/textRecognizer.ts`.
Native must return `OcrReading[]`-shaped `TextRecognitionResult`s. It must
**not** decide Magic identity.

OCR runs on **normalized 744×1039 region crops** (title, text box, footer,
collector) — never on full camera frames, and never at detector cadence.

## Compatibility target

- Expo SDK 57
- React Native 0.86 / New Architecture
- Android first (Samsung). iOS later.

## Candidates (2026)

| Option | Maintained? | New Arch | Notes |
| --- | --- | --- | --- |
| ML Kit via a thin Android module | Yes (Google) | Yes, if we write the module | Likely best Android quality. **Not auto-chosen.** Needs a new APK. |
| `react-native-mlkit-ocr` and forks | Mixed / stale | Often old-arch only | Reject abandoned wrappers. |
| Tesseract native wrappers | Mixed | Unreliable | Web already uses `tesseract.js`. Do not copy that into native as the long-term engine. |
| VisionCamera frame processors + custom OCR | Extra surface | Possible | Would put recognition closer to native pixels. Rejected: shared code owns identity. |

## Decision rule

Pick the engine that wins **oracle top-1 / top-5** on existing fixtures, not
raw character accuracy. Add it only when:

1. the wrapper is maintained for RN 0.86 + New Arch, **or**
2. a thin Android module is smaller than adopting a stale wrapper.

Either path changes the EAS fingerprint → new development APK. After that,
TypeScript-only scanner changes go out as OTA again.

The current live path passes `ocr: null` so title/text/footer are
**unavailable** (not empty-string scores). `mobile/src/scan/emptyOcr.ts`
exists for later wiring.

Do not add ML Kit (or any OCR native module) until a high-res Recognition
Input is proven on Samsung. That addition changes the EAS fingerprint and
needs a new APK. Do not bundle SQLite in the same APK unless persistence
is actually next.

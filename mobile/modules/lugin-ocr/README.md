# lugin-ocr

Local Expo Modules API package for **offline OCR** on Android.

Wraps Google ML Kit Text Recognition v2 (bundled Latin model). Returns raw
text + word boxes + confidence only. Magic name matching, fusion, and
ranking stay in shared TypeScript (`TextRecognizer` → `readCard` → fuse).

## Status

**ML Kit wired (`implementationStatus: "ready"`).** Requires a new native
APK that includes this module (fingerprint change). Batch with
`lugin-card-detector` in the same development build.

| Method | Purpose |
| --- | --- |
| `recognizeFromRgba(base64, w, h)` | Parity path from JS `ScanImage` RGBA crops |
| `recognizeFromFile(path)` | JPEG/PNG temp-file / debug-bundle path |
| `implementationStatus` | `"ready"` when ML Kit Latin is linked |

OCR runs on **normalized 744×1039 region crops**, not live camera frames.

## Wire-up

- Dependency: `mobile/package.json` → `"lugin-ocr": "workspace:*"`
  (workspace: `mobile/modules/*` in root `package.json`)
- Plugin: `mobile/app.config.ts` → `'lugin-ocr'`
- JS seam: `mobile/src/scan/mlkitTextRecognizer.ts`

## Out of scope

- Magic title / rules interpretation
- Whitelist / PSM (advisory options ignored; shared preprocess owns enhancement)
- iOS Vision (later)
- tesseract.js (web-only; never in RN)

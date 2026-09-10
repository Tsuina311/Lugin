# lugin-ocr

Local Expo Modules API package for **offline OCR** on Android.

Wraps Google ML Kit Text Recognition v2 (bundled Latin model). Returns raw
text + word boxes + confidence + stage timings only. Magic name matching,
fusion, and ranking stay in shared TypeScript (`TextRecognizer` → `readCard` →
fuse).

## Status

**ML Kit wired (`implementationStatus: "ready"`).** Production hot path:

`Uint8Array RGBA → Bitmap → InputImage → ML Kit`

No base64 on the hot path. Requires a development APK that includes this
module (fingerprint change when Kotlin changes).

| Method | Purpose |
| --- | --- |
| `recognizeFromRgbaBytes(bytes, w, h)` | **Production** — packed RGBA, no base64 |
| `recognizeFromRgba(base64, w, h)` | Legacy only (old APK / OTA fallback) |
| `recognizeFromFile(path)` | JPEG/PNG debug / offline |
| `warmUp()` | Tiny bitmap; warm ML Kit once per lifecycle |
| `implementationStatus` | `"ready"` when ML Kit Latin is linked |

OCR runs on **normalized region crops** (title / footer / type), not live
camera frames and not full-card RGBA.

The module keeps a **single lazy** `TextRecognizer` client and closes it on
`OnDestroy`.

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

# Native geometric detector

Status: **RGBA port ready (`implementationStatus = "ready"`). Y-plane live
path still stubbed. Needs new APK + on-device / detect-eval parity.**

Shared-JS `detectCardQuad` on Hermes is ~1.0–1.3 s/frame on Samsung
(~1.3–1.7 Hz). That fails the live overlay budget.

## Scaffolding + algorithm

| Piece | Location |
| --- | --- |
| Expo local module (Android Kotlin) | `mobile/modules/lugin-card-detector/` |
| Algorithm port | `DetectCard.kt` + `Geometry.kt` + `DetectParams.kt` |
| JS package entry | `lugin-card-detector` (`detectFromRgba` ready; `detectFromYPlane` stub) |
| Mobile dependency + config plugin | `workspace:*` in `mobile/package.json`, plugin in `mobile/app.config.ts` |
| Engine seam | `mobile/src/scan/detectorEngine.ts` — `createSharedJsDetectorEngine()` / `createNativeDetectorEngine()` |

`detectFromRgba` runs the hybrid detectCard.ts path (luma multi-threshold,
chroma, edge → components → hull → extremalCorners → refine → score).
`createNativeDetectorEngine()` calls it when `implementationStatus !== "stub"`.

**Next APK:** batch `lugin-card-detector` + `lugin-ocr` + `expo-sharing`
(fingerprint change). Do not add SQLite/Drive to this build.

## Scope

Native owns only:

```text
camera pixels (prefer YUV / luma)
→ geometric card detection (faithful port of detectCard.ts)
→ corners + score + diagnostics + timingMs
```

Shared TypeScript still owns tracking, SessionController, artwork, OCR
interpretation, fusion, temporal consensus, collection.

## Contract

See `src/lib/scan/detection/engine.ts` (`NativeDetectionResult`).

Coordinates: analysis / detector frame pixels after the same
orient+cover-crop policy as today (preview-visible FOV). Never screen px.

Do **not** return full pixel buffers to RN on the live path.

## Engine switch

```ts
import {
  createSharedJsDetectorEngine,
  createNativeDetectorEngine,
} from '@mobile/scan/detectorEngine';

const engine = createSharedJsDetectorEngine(); // default until parity
// const engine = createNativeDetectorEngine(); // after APK with ready module
```

Debug chip (not wired yet):

```text
Detector: Native | Shared JS
```

Default stays Shared JS until parity harness passes and Samsung hits ~6–12 Hz.

## Parity

Shared JS cannot call Kotlin from Node. Use:

```bash
yarn scan:detect-native-parity   # shared-js IoU / detection rate + RGBA export
```

Then gradle `DetectCardParityTest` (or on-device `detectFromRgba`) against
`.scan-fixtures/detect-parity/`. Metrics (same as `yarn scan:detect-eval`):

- detection rate
- false-positive rate
- mean IoU
- mean corner error

JS parity bridge: native `detectFromRgba(base64, w, h)`. Live path: prefer
`detectFromYPlane` from VisionCamera plane-0 (no RGB→RN every frame).

Synthetic high-contrast cards should detect on both engines; see module README
smoke note + `DetectCardParityTest`.

## Implementation notes

- Prefer VisionCamera YUV + native Y-plane downscale (avoid RGB→BGRA→RN→RGBA).
- Port `src/lib/scan/detectCard.ts` algorithm; do not swap in generic OpenCV
  contours or an ML detector unless the faithful port is proven impractical.
- Keep Magic ranking / OCR / artwork out of Kotlin.
- New native module changes the EAS fingerprint → **new development APK**.
- Do not batch OCR/SQLite into that APK unless those milestones are next.

## Samsung targets

- preferred detector cadence 8–12 Hz (min useful ~6 Hz)
- native detect p50 ideally < 20–30 ms, p95 < 50 ms
- latest-frame-wins, no detection queue

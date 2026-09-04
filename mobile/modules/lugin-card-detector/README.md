# lugin-card-detector

Local Expo Modules API package for **geometric card detection** on Android.

Ports only the algorithm in `src/lib/scan/detectCard.ts` (corners + score +
diagnostics). Magic ranking, OCR, artwork, and session logic stay in shared
TypeScript.

## Status

**`implementationStatus = "ready"`**

| Method | Purpose | Status |
| --- | --- | --- |
| `detectFromRgba(rgba: Uint8Array, w, h)` | Parity path from JS `ScanImage` RGBA | **Ready** — luma + chroma + edge |
| `detectFromYPlane(y: Uint8Array, w, h, rowStride)` | Live VisionCamera YUV plane-0 | **Ready** — luma + edge (no chroma) |
| `implementationStatus` | Engine gate in `detectorEngine.ts` | `"ready"` |

Y-plane is ready for live frames. **Chroma runs only on the RGBA parity path**
(no R/G/B from Y alone). Optional U/V chroma without full RGB is still future
work.

### Ported (mirrors detectCard.ts + geometry.ts + params.ts)

1. `downscaleGray` / `downscaleRgb` / Y-plane pack (`WORK_WIDTH = 320`)
2. Shared `detectFromGray`: luma ring stats + multi-threshold `diffMask`
3. Chroma ring + `chromaMask` (**RGBA only**)
4. `sobelMask` edge fallback
5. `topComponents` → `boundaryPoints` → `convexHull` → `extremalCorners`
6. `refineCorners` + `orderCorners` + `scoreCardQuad` / `scoreParts`
7. Area shares + top-N from `DetectParams` (= `params.ts`)

### Still remaining

- Optional U/V chroma without full RGB buffers
- On-device timing / live Y-plane parity after APK (RGBA fixture parity via gradle)
- Debug chip to switch engines in the UI

## Fixture parity (Node + Gradle)

Kotlin cannot run in Node. Shared-JS half + RGBA export:

```bash
yarn scan:detect-native-parity
```

Writes `.scan-fixtures/detect-parity-report.json` and
`.scan-fixtures/detect-parity/*.{rgba,json}`.

Native half — `DetectCardParityTest` (synthetic smoke always; fixtures when
`DETECT_PARITY_DIR` is set). Needs local prebuild so `mobile/android` exists:

```bash
yarn mobile:prebuild   # if android/ missing
DETECT_PARITY_DIR="$(pwd)/.scan-fixtures/detect-parity" \
  ./gradlew :lugin-card-detector:testDebugUnitTest -p mobile/android
```

On-device: `detectFromRgba(rgba, w, h)` with the same RGBA as a sidecar.

## Wire-up

- Dependency: `mobile/package.json` → `"lugin-card-detector": "workspace:*"`
  (workspace: `mobile/modules/*` in root `package.json`)
- Plugin: `mobile/app.config.ts` → `'lugin-card-detector'`
- JS seam: `mobile/src/scan/detectorEngine.ts`

Requires a **new native APK** (fingerprint change) before the module loads.

## Smoke / parity note

Synthetic high-contrast card on a flat desk (the same class of fixture
`yarn test:scan` / `detectCardQuad` uses) should return `detected: true` with
four ordered corners (TL, TR, BR, BL) and a silhouette score typically ≫ 0.15.

After the next APK:

```ts
import { createNativeDetectorEngine } from '@mobile/scan/detectorEngine';
const { corners, score } = createNativeDetectorEngine().detect(scanImage);
```

Or call the module directly:

```ts
import { requireLuginCardDetectorModule } from 'lugin-card-detector';
const mod = requireLuginCardDetectorModule();
// mod.implementationStatus === 'ready'
const r = mod.detectFromRgba(rgbaUint8, w, h);
// Live YUV plane-0 (rowStride may exceed width):
const live = mod.detectFromYPlane(yUint8, w, h, rowStride);
```

Compare against Shared JS with the same `ScanImage` (`createSharedJsDetectorEngine`)
and with `yarn scan:detect-eval` once the native harness is wired. Expect
near-identical corners on clean luma scenes; playmat / low-contrast desks
exercise chroma + edge on the RGBA path the same as TS.

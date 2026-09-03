# Mobile scanner wiring — audit before implementation

Status of this document: **Phase 1 audit, complete.** It records what the
scanner *is* today, so native wiring adapts the camera to the scanner rather
than adapting the scanner to the camera.

Nothing in here is a plan for new algorithms. The recognition pipeline is not
being redesigned as part of platform wiring.

## Headline finding

**The scanner core is already portable, and that is already proven in
production tooling — not aspirationally.**

The Node evaluation harness (`yarn scan:eval`, `yarn scan:pipeline`,
`yarn test:scan`) bundles `src/lib/scan/**` with esbuild and runs
detection → warp → preprocess → OCR → artwork → fusion → temporal consensus
**outside any browser**. Node is therefore already the second non-browser
consumer of the pipeline. React Native is the third.

The consequence for this migration is large: there is **no detector to port,
no warp to reimplement, no state machine to rebuild**. What native must supply
is pixels, OCR, storage and UI.

`src/lib/scan/types.ts` states the rule the codebase already follows:

```3:6:src/lib/scan/types.ts
// Deliberately free of DOM and platform APIs: the whole recognition pipeline
// (detect → warp → crop → preprocess → match) has to run under Node in the
// evaluation harness, not just in a browser tab. Canvas glue lives in
// `src/web/scan/canvasBridge.ts` and nowhere else.
```

## The seams that already exist

Five injection points already carry the platform boundary. Native implements
these and imports everything else unchanged.

| Seam | Definition | Web implementation | Native must provide |
| --- | --- | --- | --- |
| `ScanImage` | `src/lib/scan/types.ts` | `canvasBridge.toScanImage` | camera frame → RGBA |
| `TextRecognizer` | `src/lib/scan/textRecognizer.ts` | `web/scan/tesseractRecognizer.ts` | native OCR |
| `RecognizeDeps` | `src/lib/scan/session/recognize.ts` | `ScanScreen` wiring | index loading |
| `FrameHelpers` | `src/lib/scan/session/controller.ts` | `web/scan/liveLoop.ts` | hi-res warp + focus |
| `LocalRepository` | `src/core/sync/repository.ts` | `platform/web` (IndexedDB) | SQLite |

The portable image contract:

```8:13:src/lib/scan/types.ts
/** Raw RGBA pixels — the same memory layout as `ImageData`, without the DOM. */
export interface ScanImage {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}
```

Confirmed: RGBA, 4 bytes per pixel, row-major, `Uint8ClampedArray`, dimensions
carried in the struct. Phase 3 asked whether an equivalent already exists — it
does, and it must **not** be redefined.

## Existing pipeline, mapped

The real function names, in execution order. Web-only steps are marked.

| Stage | Entry point | File |
| --- | --- | --- |
| Camera acquisition | `openCamera` | `src/web/scan/camera.ts` **(web-only)** |
| Frame scheduling | `startLiveLoop` | `src/web/scan/liveLoop.ts` **(web-only)** |
| Frame → pixels | `toScanImage` | `src/web/scan/canvasBridge.ts` **(web-only)** |
| Session tick | `SessionController.onFrame` | `src/lib/scan/session/controller.ts` |
| Detection | `detectCardQuad` | `src/lib/scan/detectCard.ts` |
| Perspective warp | `warpQuadToCard` | `src/lib/scan/geometry.ts` |
| Detect + warp orchestration | `prepareCard` | `src/lib/scan/prepareCard.ts` |
| Tracking / stability | `pushTrack` | `src/lib/scan/tracking.ts` |
| Quality scoring | `frameQualityScore` | `src/lib/scan/quality.ts` |
| Focus gate | `focusGateDecision` | `src/lib/scan/cameraCapabilities.ts` |
| Best-frame pool | `pushQualityPool` | `src/lib/scan/quality.ts` |
| Hi-res recognition source | `captureNormalizedFromVideo` | `src/web/scan/camera.ts` **(web-only)** |
| Recognition | `recognizeCard` | `src/lib/scan/session/recognize.ts` |
| Title OCR | `readTitle` | `src/lib/scan/readCard.ts` |
| Name matching | `matchReadings` | `src/lib/scan/matchName.ts` |
| Artwork descriptor | `describeArtwork` | `src/lib/scan/artwork/descriptors.ts` |
| Artwork candidates | `createArtworkMatcher` | `src/lib/scan/artwork/match.ts` |
| Text evidence | `textEvidenceScore` | `src/lib/scan/text/evidence.ts` |
| Candidate fusion | `fuseEvidence` | `src/lib/scan/ranking/fuse.ts` |
| Temporal consensus | `pushTemporal` | `src/lib/scan/temporal/consensus.ts` |
| Printing resolution | `fetchPrintingsByName`, `pickPrinting` | `src/lib/scan/resolve.ts` |

## Module classification

### Portable as-is — import directly, change nothing

`types.ts` · `params.ts` · `geometry.ts` · `detectCard.ts` · `detection/types.ts`
· `tracking.ts` · `quality.ts` · `preprocess.ts` · `prepareCard.ts` · `videoMap.ts`
· `diagnostics.ts` · `regions.ts` · `readCard.ts` · `matchName.ts` ·
`parseCollector.ts` · `foil.ts` · `textRecognizer.ts` · `artwork/*` ·
`text/evidence.ts` · `ranking/fuse.ts` · `temporal/consensus.ts` ·
`session/recognize.ts` · `session/controller.ts` · `corpus/{types,policy,validate,throttle,ids}.ts`

Also portable outside the scanner: `src/lib/collection.ts`,
`src/lib/duplicates.ts`, `src/lib/collectionEdit.ts`, `src/lib/deck.ts`,
`src/lib/import.ts`, `src/lib/export.ts`, `src/lib/prices.ts` (valuation only),
and all of `src/core/sync/{model,engine,serialize,repository,auth,scopes}.ts`.

Two portable modules use optional globals with existing fallbacks, so they need
no change: `detectCard.ts` and `diagnostics.ts` guard `performance.now()`
against `Date.now()`, and `corpus/ids.ts` falls back from
`crypto.getRandomValues` to `Math.random`.

### Portable after small adapter

| Module | Reason |
| --- | --- |
| `cameraCapabilities.ts` | Pure TS, but emits Web `getUserMedia` constraint vocabulary. `focusGateDecision` and `preferredMainLensZoom` are directly reusable; the constraint builders are not. |
| `resolve.ts` | Uses global `fetch` to Scryfall. Works on React Native, but is not injected. |
| `core/sync/drive.ts`, `driveCorpus.ts` | Already accept `http?: typeof fetch` and a `TokenProvider`. Native supplies both. |
| `deck.ts` | `newDeckId()` reads `globalThis.crypto?.randomUUID`. Present on modern RN; verify before relying on it. |

### Web-only — do not import from native

`web/scan/camera.ts` · `liveLoop.ts` · `canvasBridge.ts` · `tesseractRecognizer.ts`
· `CardOutline.tsx` · `ScanScreen.tsx` · `web/scan/corpus/*` ·
`web/cardIndexStore.ts` · `web/artworkIndexStore.ts` · `web/priceStore.ts` ·
`web/syncStore.ts` · `platform/web/*` · `content/*Store.ts`

Never import from native (extension/browser globals):
`lib/platformStorage.ts` · `renamedKeys.ts` · `fetchRemote.ts` · `messaging.ts`
· `deckCuts.ts` · `mtggoldfish.ts` · `edhrec.ts`

### Node-evaluator-only

`scripts/scan-*.mjs` and `scripts/build-*-index.mjs`. These stay as they are and
remain the source of truth for accuracy metrics.

### Native implementation required

| Component | Replaces | Notes |
| --- | --- | --- |
| Frame adapter | `canvasBridge.ts` | VisionCamera frame → `ScanImage` |
| Frame loop | `liveLoop.ts` | latest-frame-wins, ~90 ms cadence |
| Hi-res `refineCard` | `captureNormalizedFromVideo` | full-res crop + `warpQuadToCard` |
| Focus control | `camera.ts` focus helpers | CameraX focus point |
| `TextRecognizer` | `tesseractRecognizer.ts` | native OCR engine, TBD by benchmark |
| Index loader | `cardIndexStore`, `artworkIndexStore` | must yield identical JSON shapes |
| `LocalRepository` | `platform/web/localRepository.ts` | SQLite |
| `TokenProvider` | `platform/web/googleAuth.ts` | native OAuth + PKCE |
| Corpus queue | `web/scan/corpus/queue.ts` | SQLite/filesystem |

## Things the spec asked for that already exist

These were listed as work items but are already implemented and portable. They
must be **reused, not rebuilt**.

**State machine (Phase 8).** `ScannerPhase` already exists. Note the real names
differ from the proposed ones; the existing names win.

```40:47:src/lib/scan/session/controller.ts
export type ScannerPhase =
  | 'searching'
  | 'detected'
  | 'focusing'
  | 'locking'
  | 'recognizing'
  | 'found'
  | 'ambiguous';
```

There is no separate `STABILIZING`/`LOCKED`/`CAPTURING` — stabilisation is
tracked by `TrackState.stable`, and capture is the quality pool. There is an
extra `ambiguous` phase the proposal omitted, which is what keeps a strong
oracle identity visible when the printing is uncertain (Phase 19).

**Best-frame collection (Phase 10).** `pushQualityPool` with
`QUALITY_POOL_SIZE = 4`, scored on sharpness, glare, exposure and detection
score. Already wired into `focusing`/`locking`.

**Perspective normalization (Phase 12).** `warpQuadToCard` is pure-TypeScript
bilinear inverse-mapped homography. It has never depended on Canvas — that is
why Node can run it. Output is 744 × 1039 (`CARD_ASPECT = 63/88`). Geometry
(`homographyDestToSrc`, `applyH`) is already separable from the pixel loop.

**Duplicate suppression (Phase 21).** Two layers. The controller refuses to
re-recognize while `phase === 'found'` if geometry is unchanged and the artwork
descriptor still matches:

```269:274:src/lib/scan/session/controller.ts
      if (phase === 'found' && foundCorners && foundDescriptor) {
        if (!geometryChanged(foundCorners, prepared.corners)) return snap();
        const desc = artDescriptor(forQuality);
        if (descriptorSimilarity(foundDescriptor, desc) > 1 - REPLACE_VISUAL_DELTA) {
          return snap();
        }
```

The web UI adds an `oracleId` guard on auto-add. Native needs the second layer
only.

**Oracle vs printing (Phase 19).** `fuseEvidence` already returns a four-value
status, so "recognized card, printing uncertain" is representable today:

```typescript
export type ScanIdentityStatus =
  | 'identified'
  | 'printing-ambiguous'
  | 'card-ambiguous'
  | 'insufficient-confidence';
```

**Focus coordination (Phase 9).** The controller already throttles focus
requests to 700 ms and routes them through `FrameHelpers.requestFocusNorm`.
Native only implements the sink.

**Coordinate transforms (Phase 7).** `videoMap.ts` is pure math with no DOM —
`mapAnalysisToSource`, `coverLayout`, `mapCoverSourceToDest`,
`mapCornersToOverlay`. Cover-crop and aspect handling exist. Native supplies
sizes; sensor rotation and mirroring are the genuinely new part.

**OCR seam (Phase 16).** Already clean. Nothing outside
`web/scan/tesseractRecognizer.ts` imports `tesseract.js`, and the Node harness
already proves a second implementation drops in without touching shared code.

## Resolutions and cadence, as actually configured

| Stage | Value | Source |
| --- | --- | --- |
| Camera request (web) | 1920 × 1080 ideal | `buildCameraConstraintPlan` |
| Live analysis input | max width **640** | `DETECT_ANALYSIS_MAX_WIDTH` |
| Inside `detectCardQuad` | max width **320** | `WORK_WIDTH` |
| Detect cadence | **90 ms** (~11 Hz) | `DETECT_INTERVAL_MS` |
| Normalized card | **744 × 1039** | `CARD_WIDTH` / `CARD_ASPECT` |
| Quality pool | 4 frames | `QUALITY_POOL_SIZE` |
| Temporal agreement | 2 frames | `TEMPORAL_AGREE_FRAMES` |

The Phase 4 target of 6–12 analyses/sec and the Phase 5 candidate input of
480–640 px are already what the web driver does. The detector halves the input
again internally, so the boundary transfer is the cost to measure, not the
detection itself.

## Detector decision (Phases 5 and 6)

The shared TypeScript detector is the default and the preferred outcome, because
web, native and the offline evaluator then share one detector and one set of
accuracy metrics.

A native geometric plugin is justified **only** if measurement on the Samsung
shows the boundary cost is unacceptable. Because `detectCardQuad` internally
works at 320 px wide, the quantity to measure is frame conversion and transfer,
not the detection math. If a native detector is ever introduced it must be
parity-tested against `yarn scan:detect-eval` using the existing metrics
(`detection rate`, `false positive`, `mean IoU`, `mean corner err`).

## Index assets

| Index | Built by | Shape consumed | Loader to build |
| --- | --- | --- | --- |
| Card names | `scripts/build-card-index.mjs` | `buildNameIndex(data)` → `CardNameIndex` | native |
| Artwork + text | `scripts/build-art-index.mjs` | `createArtworkMatcher(art)`, `TextIndexData` | native |

Artwork matching consumes **descriptors, not images**: a 64-bit dHash, a
4×4 block-mean hash and an 8-bin hue histogram per illustration. No Scryfall
imagery needs to ship. Card names are ~3.5 MB raw / ~1.2 MB gzipped.

Shared code never fetches or caches these — callers pass built structures into
`RecognizeDeps`. Web uses the Cache API; native needs its own loader producing
identical shapes. These are far too large for SecureStore or AsyncStorage.

## Metrics to reuse for native benchmarking

Do not invent new metric names. The harness already prints:

- Detection (`yarn scan:detect-eval`): `detection rate`, `false positive`,
  `mean IoU (hits)`, `mean corner err`, `detect ms`
- Recognition (`yarn scan:pipeline`): `oracle top-1 (name)`, `oracle top-5`,
  `auto-identified`, `false confident`, `unresolved`, `latency median/p95`,
  `artwork stage mean`, `title stage mean`, `text stage mean`

`false confident` is the metric that matters most and the easiest to hide.

## Spec corrections

The migration plan was written before this audit. These items were wrong or
already done, and the corrected version here is authoritative.

| Plan item | Correction |
| --- | --- |
| Phase 47: "EAS profiles must continue enabling Corepack" | **Wrong — do the opposite.** `"corepack": true` in `eas.json` is what caused `Failed to install yarn` (build `84a0553b`). Yarn Berry is preserved via the committed `.yarn/releases/yarn-3.8.1.cjs` + `yarnPath` + `scripts/eas-build-pre-install.mjs`. `packageManager: yarn@3.8.1` stays. |
| Phase 8 state names `STABILIZING`, `LOCKED`, `CAPTURING/BEST_FRAME` | Do not exist and must not be introduced. Real values are `searching`, `detected`, `focusing`, `locking`, `recognizing`, `found`, `ambiguous`. Stabilisation is `TrackState.stable`; capture is the quality pool. |
| Phase 3: "verify `ScanImage` is portable RGBA" | Verified. Exists, RGBA, `Uint8ClampedArray`. Must not be redefined. |
| Phases 10, 12, 19, 21 | Already implemented and portable. Reuse, do not rebuild. |
| Phase 4: "the colored polygon comes from PoC camera behavior" | There is no detector in the native PoC at all — `CameraProofScreen` only does lens selection and tap-to-focus. Nothing to replace; the detector is new native wiring around an existing algorithm. |
| Phase 5: "the existing detector is TypeScript… determine whether a small analysis image is fast enough" | Still the right question, but note the detector already downscales to 320 px internally, so input size barely affects detector cost (16–18 ms p50 flat from 480×360 to 960×720 on desktop). The variable to measure is frame conversion and transfer. |

## Decision: RGBA baseline first (Phases 5 and 6)

**Chosen: the straightforward RGBA path, measured on the Samsung, before any
YUV or native-detector work.**

Rationale: the portable scanner already speaks `ScanImage`/RGBA; this validates
native camera → existing `detectCardQuad` with no algorithm change; and one
detector shared by web, native and the offline evaluator is worth more than a
theoretical bandwidth saving. A YUV or native geometric path is optimisation,
and optimisation waits for measurement.

Hard constraint: **never convert a full-resolution frame to RGBA.** The
downscale must happen in the camera pipeline, before the conversion and before
the JS boundary.

VisionCamera 5.2 supports this directly, which removes the need for a
third-party resize plugin:

| Requirement | Mechanism |
| --- | --- |
| Small analysis frame | `FrameOutputOptions.targetResolution` — negotiated in the camera pipeline, aspect ratio prioritised over pixel count |
| Even smaller buffers | `enablePreviewSizedOutputBuffers` |
| RGBA without hand conversion | `pixelFormat: 'rgb'` → pipeline emits `rgb-bgra-8-bit` |
| Latest-frame-wins, no queue | `dropFramesWhileBusy: true` (the default) |
| Backlog visibility | `onFrameDropped(reason)`; `'out-of-buffers'` means the processor overran a frame interval |
| Orientation | `enablePhysicalBufferRotation`, or read `Frame.orientation` / `Frame.isMirrored` metadata |

Two consequences that are easy to get wrong:

1. `pixelFormat: 'rgb'` yields **BGRA, not RGBA**. Channels must be swapped
   when filling `ScanImage`. This is not cosmetic: luma weights R and B
   differently (0.299 vs 0.114), so a channel swap changes detection,
   sharpness, artwork hue histograms and OCR preprocessing.
2. `Frame` must be `dispose()`d as soon as processing finishes or the camera
   pipeline stalls.

Escalate to a native/YUV path **only** if Samsung profiling shows conversion or
transfer is the bottleneck — not the detector. If that happens, the native
portion stays limited to geometry and quality, returning small structured
results (corners, confidence), and must be parity-tested against
`yarn scan:detect-eval`.

### Required native dependencies

`useFrameOutput` needs a worklets runtime, which was **not** installed:

| Package | Version | Why |
| --- | --- | --- |
| `react-native-vision-camera-worklets` | 5.2.3 | matches `react-native-vision-camera@5.2.3` |
| `react-native-worklets` | 0.10.1 | installed via `npx expo install`, which pins the SDK 57 version rather than npm `latest` (0.12.1); Software Mansion, `compatibility.json` lists RN 0.86 |

Installed with `npx expo install`, not `yarn add`, so the versions come from the
SDK 57 compatibility table.

`react-native-worklets` also needs a Babel plugin, and the app had no
`babel.config.js` at all. Without `react-native-worklets/plugin` the `'worklet'`
directive is just an unused string literal and the frame callback fails on
device while the bundle builds fine — so the plugin is verified by asserting
the transform emits `__workletHash`, not by assuming it ran.

These are native modules, so per Phase 43 they change the Expo fingerprint and
**require a new EAS APK**. JS-only work after that returns to OTA.

## Open questions for later phases

1. Which Android OCR engine, decided by benchmark against existing fixtures —
   not by reputation.
2. Whether the hi-res recognition source is a frame, a snapshot or a photo
   capture. Web maps analysis corners back onto the full-resolution video and
   crops; the native equivalent is unproven. A second `CameraFrameOutput` at a
   higher `targetResolution`, or `HybridFrameConverter.convertFrameToImage`,
   are the candidates to measure.
3. Sensor rotation and mirroring, which `videoMap.ts` does not currently model.
   `Frame.orientation` and `Frame.isMirrored` provide the inputs.
4. Whether `crypto.randomUUID` is available in the Hermes build in use.
5. Whether the shared detector should run inside the frame worklet (avoiding a
   buffer hop to the main JS thread) or on the JS thread. Resolved by
   measurement, not preference.

Resolved: how VisionCamera exposes pixels. `Frame.getPixelBuffer()` returns a
non-copying `ArrayBuffer` for non-planar (RGB) frames; planar (YUV) frames
expose `getPlanes()` with per-plane `getPixelBuffer()` and `bytesPerRow`.
Corrected on device, see below: a non-planar frame is *also* readable through
`getPlanes()[0]`, and on Android that is the more reliable of the two.

## C.2 did not work on device, and what that changed

The first Samsung run stayed in SEARCHING forever. The camera was excellent and
the detector was on, but no quad was ever produced, and the pipeline could not
say which of camera → worklet → transfer → convert → detect was at fault.

Three things were wrong or unprovable, and they are worth recording because
each one was invisible from a passing unit test:

1. **The audit's own rear-lens rule was backwards.** It preferred a *physical*
   `wide-angle`, which on the Samsung is the ultra-wide that cannot be
   focus-metered, over the virtual triple camera that can. Ranking
   `supportsFocusMetering` first fixes it. Not the cause of SEARCHING, but it
   would have poisoned every later sharpness judgement.
2. **`bytesPerRow` and buffer length were trusted.** A camera reporting 0 (or a
   short buffer) collapsed every row onto row 0, and out-of-range reads return
   `undefined`, which lands in a `Uint8ClampedArray` as 0. Both failures render
   as a plausible black frame that detects nothing and reports no error.
   `validateFrameView` now surfaces the arithmetic instead of hiding it.
3. **Worklets serialization was assumed, not verified.** The transfer now
   carries a copied `ArrayBuffer` plus primitives only — no class instances, no
   `Frame` reference — and the worklet probes fixed offsets of its own copy
   *before* `frame.dispose()`, sending the offsets with the values so the JS
   side compares identical positions. If the received bytes were ever a view
   over a disposed native frame, the probe says so in one number.

Also worth stating plainly, because it removes a suspect: **`SessionController`
is not in the live path.** The overlay is driven straight from `detectCardQuad`,
so the controller cannot be suppressing a valid detection. The "Test frame"
button runs it on the same pixels anyway, so that claim is checked rather than
argued.

Performance work stays deferred. Profiling a pipeline that produces nothing
would measure the wrong thing, and a YUV/native detector would replace an
unverified path with a second unverified path.

### `hasPixelBuffer` does not mean the whole-frame buffer is readable

The third Samsung run is the one the error ladder was built for: it reported
`worklet threw in pixelBufferRead: Error: Frame.getPixelBuffer(...): …`, which
places the failure exactly at `new Uint8Array(frame.getPixelBuffer())` and
nowhere else.

The two guards ahead of that call had both passed — `frame.hasPixelBuffer` was
true and `frame.isPlanar` was false — and they are genuinely not sufficient,
because on Android they describe different objects than the one the read
touches:

- `hasPixelBuffer` inspects the usage flags of the `ImageProxy`'s
  `HardwareBuffer` and answers "CPU reads are permitted".
- `getPixelBuffer()` then has to actually `AHardwareBuffer_lock` that buffer, so
  Hermes can hand out an `ArrayBuffer` over it. The lock is a device- and
  driver-dependent operation; when it fails VisionCamera throws
  `Failed to read HardwareBuffer bytes!`, and Nitro re-throws it prefixed with
  the hybrid method name — hence the `Frame.getPixelBuffer(...):` in the
  message. Permission to read is not the same as a successful lock.

`getPlanes()[0]` avoids the whole mechanism. For a non-planar RGB frame
CameraX still exposes exactly one plane, and VisionCamera reads it as a plain
direct `ByteBuffer` — no lock, no GPU download. So the worklet now tries the
contiguous frame buffer first and falls back to plane 0, and the row pitch
travels with the payload rather than being read off the frame, because
`FramePlane.bytesPerRow` is the authoritative stride for whichever buffer was
actually read (`Frame.bytesPerRow` returns 0 on Android unless there is exactly
one plane).

The fallback is instrumented rather than silent: the panel shows a `via plane 0`
count and a `pixels read from` line that carries the frame-buffer error text, so
a device taking the fallback is visible without being mistaken for a healthy
primary path. Only when *both* sources fail does the read report a failure, and
it then reports both messages.

Escalating to `pixelFormat: 'yuv'` stays the documented next step if plane 0
also proves unreliable — VisionCamera's own guidance is that `'yuv'` is the
format to use when you need CPU access — but that costs a hand-written
YUV→RGBA conversion, so it waits until the cheaper source is disproven.

## What is deliberately not decided here

Multi-card/binder scanning stays out (Phase 39), but note `detectCardQuad`
already enumerates up to `DETECT_TOP_COMPONENTS = 4` blob candidates internally
and returns the best — so a multi-detection API is an additive change, not a
rewrite. `DetectResult` currently exposes one `quad`.

iOS stays out until the Android path is solid.

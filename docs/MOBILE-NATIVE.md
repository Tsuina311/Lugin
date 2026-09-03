# Native mobile (React Native / Expo)

Lugin adds a **native Android-first companion** so the scanner can use the
device camera stack (CameraX via VisionCamera) instead of browser
`getUserMedia`. This does **not** replace the Vite phone/web PWA or the
Chrome extension.

```text
Extension  → Cardmarket integration
Web PWA    → zero-install companion (kept)
Native     → best mobile / scanner experience
```

## Why native exists

On Samsung phones, Chrome/PWA camera remains materially softer and less
reliable than the stock Camera app despite autofocus, lens selection, and
focus gating work in the web scanner. The browser camera abstraction is the
ceiling. Native migration is justified only if Milestone B proves sharper
frames on the same device.

## Current milestone

| Milestone | Status |
| --- | --- |
| A — App shell + tabs | Done (`mobile/`) |
| B — Native camera proof (VisionCamera) | **Passed on Samsung** — native sharper than Chrome |
| C.1 — Shared scanner core imported by mobile | Done — guarded by `yarn mobile:test` |
| C.2 — VisionCamera frame → `ScanImage` adapter | Transfer works; **FOV/orientation mismatch on Samsung** |
| C.2d — Layered pipeline diagnostics | Done — localised the break to the transfer |
| C.2e — Worklet → RN transfer ladder | Done — `getPixelBuffer` failed; plane-0 fallback |
| C.2g — Orient + cover-crop analysis to preview FOV | Passed on Samsung after orientation syncs |
| C.2h — Initial outputOrientation lifecycle | Shipped; **awaiting still-phone startup test** |
| C.3+ — Recognition, collection, Drive | Not started |

Milestone B was compared on the real device: Samsung Camera sharp, Lugin
web/Chrome materially blurrier, Lugin native materially sharper than Chrome.
That is what unblocked C.

The full wiring audit — every scanner module classified, every existing seam,
and the list of things that already exist and must not be rebuilt — is in
[MOBILE-SCANNER-WIRING.md](./MOBILE-SCANNER-WIRING.md). Read it before writing
native scanner code.

## Repository layout

```text
Lugin/
  src/                 # shared portable core + web/chrome surfaces
  mobile/              # Expo development-build app (Yarn workspace)
  docs/MOBILE-NATIVE.md
```

`mobile/` was chosen over `apps/mobile/` to avoid relocating working web and
extension builds. Yarn Berry workspaces hoist with
`nmHoistingLimits: workspaces` so React 18 (root) and React 19 (Expo) do not
collide.

## Module audit (Phase 1)

### PORTABLE (reuse from native)

| Area | Paths |
| --- | --- |
| Scan pipeline | `src/lib/scan/**` (detector, prepare, quality, ranking, session, artwork, text, temporal) |
| Sync engine | `src/core/sync/**` (`LocalRepository`, `TokenProvider`, Drive, corpus) |
| Domain | `src/lib/import.ts`, `export.ts`, collection/deck/prices helpers |
| ManaBox | same import/export modules — no second format |

`ScanImage` is already a portable RGBA buffer (`src/lib/scan/types.ts`), not
DOM `ImageData`.

### WEB-SPECIFIC

| Area | Paths |
| --- | --- |
| PWA shell | `src/web/**` |
| Camera | `src/web/scan/camera.ts` (`getUserMedia`) |
| Canvas bridge | `src/web/scan/canvasBridge.ts`, `liveLoop.ts` |
| OCR | `src/web/scan/tesseractRecognizer.ts` (`tesseract.js`) |
| IndexedDB | `src/platform/web/localRepository.ts` |
| GIS auth | `src/platform/web/googleAuth.ts` |
| Index caches | `src/web/*IndexStore.ts`, `priceStore.ts` |

### CHROME-SPECIFIC (stay in extension)

| Area | Paths |
| --- | --- |
| Cardmarket DOM | `src/content/**`, `src/sites/**`, `src/interceptor/**` |
| SW / overlay | `src/background/**`, `src/ui/**` (Cardmarket panels) |
| chrome.storage repo | `src/platform/chrome/**` |

### NATIVE ADAPTER REQUIRED

| Seam | Existing contract | Planned native |
| --- | --- | --- |
| Camera → pixels | `FrameHelpers` / `ScanImage` | VisionCamera frame path |
| OCR | `TextRecognizer` | ML Kit (or evaluated alternative) |
| Local store | `LocalRepository` | Expo SQLite (not AsyncStorage for bulk data) |
| Drive auth | `TokenProvider` | native OAuth/PKCE; scopes unchanged |
| Share / files | `src/web/share.ts` | document picker + share sheet |
| Indexes | Cache API stores | filesystem / SQLite blob cache |

## Technology

```text
Expo SDK 57 + development builds (expo-dev-client)
React Native New Architecture (mandatory on this SDK)
TypeScript
react-native-vision-camera (CameraX / AVFoundation)
react-native-vision-camera-worklets + react-native-worklets (frame output)
react-native-nitro-modules / nitro-image
```

**Not Expo Go** — VisionCamera requires a custom native binary.

Camera permission only (`CAMERA`). No microphone unless a real audio feature
ships.

## Commands

From the repo root:

```bash
yarn mobile:start          # Metro + dev client
yarn mobile:android        # expo run:android (dev build)
yarn mobile:ios            # expo run:ios (structural; Android is acceptance)
yarn mobile:prebuild       # regenerate native projects
yarn mobile:typecheck
yarn mobile:test           # workspace smoke + shared-core boundary + frame adapter
yarn mobile:build:dev      # prebuild + android run
yarn mobile:build:eas      # EAS development APK
yarn mobile:update         # EAS Update → development channel
yarn mobile:deploy:status  # fingerprint vs latest compatible build
```

CI / OTA vs APK: see [`MOBILE-DEPLOYMENT.md`](MOBILE-DEPLOYMENT.md).

Existing web/extension commands are unchanged:

```bash
yarn dev / yarn build
yarn dev:web / yarn build:web / yarn test:web
yarn test:scan / yarn scan:detect-eval / …
```

## Android setup (Samsung)

1. Install Android Studio / SDK + USB debugging on the phone.
2. From repo root: `yarn install` then `yarn mobile:android`.
3. First run generates `mobile/android/` via prebuild and installs a
   **development build** (not Expo Go).
4. Open **Scan** tab → grant camera. The panel chip cycles between the scan
   diagnostics, the camera debug panel, and off. Verify in the camera panel:
   - physical devices and `supportsFocusMetering`
   - zoom range / neutral zoom
   - tap-to-focus reticle
5. Cycle **Lens** to compare rear devices. The default is chosen by
   `selectMainRearDevice`, which ranks **focus metering first**, then
   wide-angle, and puts an ultra-wide-only device last.

   That order comes from the Samsung, where the naive "prefer a physical
   wide-angle" rule picked the wrong lens: its *virtual* "Back Triple Camera"
   supports focus metering and beats Chrome, while the *physical* "Back Camera"
   is ultra-wide, cannot be focus-metered and is visibly soft. Cards are shot
   close up, so a lens the focus gate cannot drive is useless however sharp it
   might be. `mobile/scripts/camera-select-smoke.mjs` pins both real devices so
   this cannot regress — and keeps the rule capability-based, never matching
   model or lens names.

### Go / no-go checklist (Milestone B)

Same physical distance for:

| Source | Focus speed | Sharpness | Text clarity | Lens |
| --- | --- | --- | --- | --- |
| Samsung Camera | | | | |
| Chrome Lugin | | | | |
| Native Lugin | | | | |

If Native ≈ Chrome, **stop** and diagnose lens/format/focus before Milestone C.

Conditions to exercise later: bare / sleeve / foil, wood / playmat, bright /
dim, close / normal, moderate perspective.

## Scanner data flow (target)

```text
VisionCamera (native)
  → cheap / downscaled frame (6–12 analyses/s, drop backlog)
  → portable detectCard → corners
  → tracking + throttled native focus
  → high-quality crop when sharp
  → art + OCR + text + footer evidence
  → shared ranking / temporal consensus
```

Web scanner remains for zero-install, desktop, and regression comparison.
Shared: detector, ranking, indexes, profiles, eval scripts.
Platform-specific: camera, image adapter, OCR engine if needed, storage/auth.

### The shared-core boundary

Native reaches the shared scanner through exactly one module,
`mobile/src/scan/sharedCore.ts`. Nothing else in `mobile/` imports `@/lib/**`
directly. That keeps the boundary reviewable and gives
`mobile/scripts/shared-core-smoke.mjs` a single graph to police: it bundles the
boundary for a DOM-free target, rejects the build if browser-only code
(`getImageData`, `indexedDB`, `tesseract`, `chrome.*`, …) reaches it, then runs
a real detection and perspective warp on a synthetic card.

`@/…` resolves to `src/` for mobile in two places that must stay in agreement —
`mobile/tsconfig.json` `paths` and the `resolveRequest` alias in
`mobile/metro.config.js`. A `paths` entry alone typechecks but fails at runtime.

Baseline detector cost, measured on the dev machine (not the phone), 60
iterations after warm-up:

| Analysis input | detect p50 | detect p95 | warp → 744×1039 |
| --- | --- | --- | --- |
| 480 × 360 | 16.2 ms | 21.8 ms | 18.9 ms |
| 640 × 480 | 17.5 ms | 32.3 ms | 18.3 ms |
| 960 × 720 | 16.1 ms | 19.7 ms | 22.1 ms |

Cost is nearly flat across input size because `detectCardQuad` downscales to
`WORK_WIDTH = 320` internally. These are desktop numbers and say nothing about
the Samsung; they exist as the control for the on-device benchmark below.

### The frame pipeline (C.2)

The RGBA baseline, chosen deliberately over a native/YUV detector so that web,
native and `yarn scan:detect-eval` all run one detector. The reasoning and the
escalation criteria are in
[MOBILE-SCANNER-WIRING.md](./MOBILE-SCANNER-WIRING.md).

```text
CameraFrameOutput  targetResolution 640×480, pixelFormat 'rgb'
  → onFrame worklet   cadence gate (10/s), copy bytes, dispose frame
  → scheduleOnRN      one buffer hop to the JS thread
  → frameToScanImage  BGRA→RGBA + row stride + rotation + mirror, one pass
  → detectCardQuad    the shared portable detector, unmodified
  → overlay quad + ScanMetricsPanel
```

Full-resolution frames never enter this path: `targetResolution` makes the
camera pipeline produce a small frame, and the adapter's `maxWidth` is only a
guard. Backlog is bounded at both ends — `dropFramesWhileBusy` natively, and a
single-slot pending buffer on the JS thread, so a stalled JS thread discards
stale frames instead of working through a queue.

`frameToScanImage` is pure and has no React Native imports, so
`mobile/scripts/frame-adapter-smoke.mjs` asserts it under Node against
synthetic buffers whose pixels encode their own coordinates. It covers the
three failures that are silent rather than loud — BGRA read as RGBA, ignored
`bytesPerRow` padding, and the four rotations plus mirroring — because each one
merely degrades detection, which is indistinguishable from a detector that
needs tuning.

Two dependencies were added for this, both native, so this milestone **needs a
new EAS APK** (JS-only work afterwards can go out as OTA):

```text
react-native-worklets@0.10.1              # via `npx expo install` (SDK 57 pin)
react-native-vision-camera-worklets@5.2.3 # matches vision-camera
```

`mobile/babel.config.js` is new and mandatory: without
`react-native-worklets/plugin` the `'worklet'` directive is an inert string and
the frame callback fails on device while the bundle still builds.

### On-device measurement protocol (C.2 acceptance)

Open **Scan**, point at a card, and read the metrics panel. Record p50 / p95:

| Metric | Target | Meaning if it misses |
| --- | --- | --- |
| analyses/s | 6–12 | cadence not sustained; find which stage eats the budget |
| convert | — | BGRA→RGBA + rotate; if this dominates, YUV becomes worth benchmarking |
| transfer | — | worklet→JS buffer copy; if this dominates, move detection into the worklet before considering YUV |
| detect | ~16–18 ms desktop | compare against the desktop control above |
| total | < ~80 ms | end-to-end analysis latency |
| dropped / superseded | low | sustained drops mean the pipeline is overrunning |

Also judge preview smoothness with **Detector off** versus **on**. That
detaches the frame callback, isolating the cost of the worklet, the buffer hop
and the detector. It does not remove the frame output from the session, so it
measures processing cost rather than the cost of streaming frames at all.

Decision rule, fixed in advance so the measurement decides and not taste: if
the cadence holds and the preview stays smooth, **keep the shared TypeScript
detector**. Escalate to a native/YUV path only if conversion or transfer — not
detection — is shown to be the bottleneck, and then keep the native part to
geometry/quality returning corners and confidence, parity-tested against
`yarn scan:detect-eval`.

### Layered diagnostics (C.2d)

The first Samsung run of C.2 sat permanently in SEARCHING: the camera was
excellent, the detector never produced a quad, and nothing said which of the
seven stages between the sensor and the overlay was at fault. The panel now
instruments each boundary, so a device run localises the break instead of
inviting another guess.

Tap **Scan dbg** (the panel button cycles scan → camera → none). The panel is
bounded and scrollable, and the controls sit below it — the earlier layout put
the numbers underneath the buttons, which made them unscreenshottable.

Read it top to bottom; the first stage that stops counting is the broken one:

| Row | Stage it proves |
| --- | --- |
| `camera out` | VisionCamera is producing frames at all |
| `worklet sampled` | the `'worklet'` transform ran and the cadence gate passed |
| `→ RN` | `scheduleOnRN` crossed the runtime boundary |
| `ScanImages` | `frameToScanImage` accepted the geometry |
| `detect calls` / `hits` | the detector ran, and whether it found a card |

`camera out` and `worklet sampled` arrive on a 500 ms **heartbeat** carrying
primitives only, deliberately independent of pixel delivery. Without it a
broken transfer and a dead camera look identical: both leave every counter at
zero.

The other sections, and the specific failure each one is there to catch:

- **Detector input** — a PNG of the *exact* `ScanImage` handed to
  `detectCardQuad`, not the camera preview. After C.2g it must also match the
  preview's orientation and FOV; a blue quad is the detector's raw corners
  before any screen mapping. Encoded in pure JS (`scan/debug/scanImagePng.ts`)
  and refreshed roughly 1.4×/s. The `luma` figure next to it separates a black
  buffer from a dark room.
- **Frame metadata** — the values VisionCamera actually reported, never
  inferred. `bytes` versus `need ≥` is the stride arithmetic: a short buffer
  used to be read out of bounds, which yields `undefined` → 0 and looks exactly
  like a black camera.
- **Buffer copy / transfer** — the worklet probes 16 fixed offsets of *its own
  copy* before `frame.dispose()` and sends the offsets alongside the values, so
  the JS side compares identical positions with no duplicated sampling logic.
  Anything below 16/16 means the bytes are not an independent copy, or
  worklets serialization is not doing what we assume. Sampled, not hashed —
  the failures it guards against change bytes everywhere.
- **Detector** — `detectCardQuad`'s own `debug` output: candidate count,
  selected index, best candidate score and the ranked `rejectedBecause`
  reasons. The detector was not modified to produce this; it already had it.
- **Ladder** — see below. The first run localised the failure to the
  worklet → RN boundary, so the panel now walks that boundary in four rungs.
- **Test frame** — runs the detector once, synchronously, on the last input.
  If that finds a card the live path cannot, the fault is cadence or timing. It
  also runs `SessionController` on the same pixels, which is the only way to
  say whether the controller *would* suppress a valid detection — it is not in
  the live path, since the overlay is driven straight from `detectCardQuad`.

### The transfer ladder (C.2e)

The second Samsung run was unambiguous:

```
camera out 1235 (~40/s) · sampled 350 (~11.5/s) · RN 0 · nobuf 0 · planar 0
```

The camera and the worklet were both healthy, and the frames were passing the
`hasPixelBuffer` and `isPlanar` gates — yet nothing arrived on the RN runtime.
The heartbeat that reported those numbers is itself a `scheduleOnRN` call, so
scheduling and the RN callback wiring were already proven; only the pixel
payload path was failing.

It failed *silently*, which was the real defect. That stretch of the worklet had
a `finally` for `frame.dispose()` but no `catch`, so a throw in
`getPixelBuffer()`, the copy, or serialization produced exactly what we saw:
counters climbing, zero deliveries, no error anywhere.

The worklet now attempts four independently guarded rungs per sampled frame,
each with a counter on both sides:

| Rung | Payload | Isolates |
| --- | --- | --- |
| ping | `(seq, width, height)` | scheduling, with no serialization at all |
| meta | 9 numbers/strings incl. byte lengths | the pixel-buffer read and the copy |
| tiny | 64-byte `ArrayBuffer` + 4 bytes as numbers | `ArrayBuffer` serialization |
| full | the whole copied buffer | payload size |

Because a rung failing does not stop the ones already scheduled, a single run
separates "cannot read pixels" from "cannot serialize an `ArrayBuffer`" from
"cannot serialize a 1.2 MB one". Any throw is reported over the primitive
channel — the one channel already known to work — with the stage name and
message, throttled to 2/s.

Two controls exist for the size question. **Rung** caps how far the ladder
climbs, and the resolution chip cycles 640×480 → 480×360 → 320×240 to find the
largest payload that crosses reliably. Both are diagnostics, not settings.

Payloads are positional primitives plus at most one `ArrayBuffer`. No object
wrapper, no typed-array view, no `Frame` reference. `react-native-worklets` 0.10
serializes each argument recursively (`makeShareableCloneOnUIRecursive`, since
Bundle Mode is off), and it does support both `ArrayBuffer` and array views —
so a flat shape means a serialization failure can only be about the buffer
itself, not about how it was wrapped.

Buffer lifetime is ordered deliberately: read `getPixelBuffer()`, copy into a
freshly allocated `Uint8Array`, schedule the copy's `.buffer`, and only then let
`finally` call `frame.dispose()`. The RN side never sees frame-owned memory,
which VisionCamera documents as invalid after disposal.

### Orientation and FOV (C.2g)

Once frames reached the detector, Samsung showed a live pipeline that was
still wrong: the preview had a large upright card, the Detector input was
640×480 with the same card small and on its side, and the green overlay
ignored the physical card even though hits were 53/54.

Two spaces had been conflated.

**Orientation.** `Frame.orientation` is relative to the frame output's
`outputOrientation`, not to the sensor and not to the phone. Leaving that
target at the sensor default (`'up'`) makes a landscape buffer report
`orientation: 'up'`, so `frameToScanImage` does not rotate it. The preview
still applies a view transform to stand the image up. The adapter now writes
the same device orientation onto the frame output that VisionCamera writes
onto the preview, then rotates using the resulting `Frame.orientation`.
Detection runs on the upright image; we do not rotate the overlay afterwards.

**FOV.** `targetResolution: 640×480` is the full analysis buffer. The preview
is `resizeMode: 'cover'` of the *upright* frame into a portrait view, so it
shows a center strip. Feeding the detector the uncropped buffer makes the
card small and maps its corners onto the wrong place. Analysis is now:

```
raw frame → orient using Frame.orientation → cover-crop (videoMap.coverSourceRect)
  → downscale long edge ≤ 640 → detectCardQuad
```

On a 390×844 preview over a 640×480 / `right` frame that produces a 296×640
detector image — portrait, same FOV as the preview. Overlay mapping is then
a uniform scale of that image onto the view.

`enablePreviewSizedOutputBuffers` changes buffer *size*, not the cover-crop,
so it is not a substitute. `enablePhysicalBufferRotation` would hide the
orientation metadata we are required to apply; it stays off.

The Detector input thumbnail draws the raw detector quad in blue, before any
screen mapping. Numbered corners (1 TL … 4 BL) sit on both the thumbnail and
the preview. If the blue quad hugs the card and the green overlay does not,
the remaining bug is mapping; if the blue quad misses, the crop/orientation
is still wrong.

### Initial orientation (C.2h)

Samsung after C.2g: once the phone moved, Detector Input was upright and both
quads hugged the card. Immediately after opening Scan, without moving, the
thumbnail was still rotated 90°.

`useOrientation('device')` returns `undefined` until a physical orientation
*change*. A still phone never fires, so this assignment never ran:

```
if (outputOrientation) frameOutput.outputOrientation = …
```

`useFrameOutput` creates the output without an orientation. The native default
is a landscape buffer whose `Frame.orientation` is `'up'` — “already matches
the output” — while the output target was never set to preview-upright.

The app is Expo-locked to portrait. Desired output orientation is therefore
`'up'` from the first render, assigned in `useLayoutEffect` (not after an
event). Camera uses `orientationSource="interface"`. Frames whose metadata is
incoherent with that target (landscape + `'up'`) are dropped; the badge reads
`Initializing orientation`. Stored quads are cleared if the desired target
later changes.

## C.2i — live session + recognition path

Correctness (Triple Camera, FOV crop, blue/green quads) was proven on Samsung
before this work. This slice does **not** invent new device timings.

Live path:

```
VisionCamera frame → oriented/cropped ScanImage → detectCardQuad
  → SessionController.onFrame (prepareAnalysis, no search-frame warp)
  → tracking / focus / quality pool
  → refineCard (744×1039 warp; analysis-warp until photo is measured)
  → recognizeCard (artwork + empty OCR + fuseEvidence)
  → result card
```

Default analysis long edge is 480 (same FOV as 640/400). Production transfer
is one `scheduleOnRN`, not the four-rung ladder. Debug PNG/panel publish at
~1–2 Hz.

Samsung latency, hi-res photo vs snapshot, and artwork-on-device numbers:
see `docs/MOBILE-SAMSUNG-CHECKLIST.md`. All PENDING.

## Storage / Drive / OCR (later milestones)

- **Storage:** `LocalRepository` contract is wired to the existing in-memory
  port. Expo SQLite waits for a fingerprint/APK; do not add it through OTA.
- **Drive:** still out of scope until native recognition *and* local
  persistence work.
- **OCR:** seam is `emptyTextRecognizer`. Survey: `docs/MOBILE-OCR.md`.
- **Corpus:** same consent + Drive folder pipeline; label `platform: android`.

## Versioning

Native Settings shows product version + platform + Expo runtime. Align with
root `MAJOR.MINOR` and git commit stamps (see `docs/VERSIONING.md`) — do not
invent a separate scheme. Desktop overlay continues to use
`DESKTOP_VERSION` only.

## Limitations (honest)

- Detector correctness on Samsung is proven (C.2g/h). **Responsiveness is
  not.** Previous device notes (~11 sample Hz → ~2–3 detect Hz) were taken
  with the diagnostic ladder and debug panel on. This session did not
  re-measure on the phone.
- Hi-res recognition defaults to warping the analysis frame. Photo /
  snapshot / higher-res frame output need a Samsung comparison before one
  is chosen.
- Artwork matching is wired; OCR is an empty recognizer. Identity on device
  is artwork-only until an engine is added (new APK).
- Collection add is a command seam over an in-memory `LocalRepository`.
  No SQLite, no Drive.
- iOS is structurally supported; untested on device.
- CI does not yet build the Android development binary.

## Product boundary

Native must **not** embed Cardmarket, scrape Cardmarket, or replace the
extension. Companion scope: collection, decks, scanner, import/export, Drive
sync.

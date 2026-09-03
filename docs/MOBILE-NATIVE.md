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
| C.2 — VisionCamera frame → `ScanImage` adapter | Not started |
| C.3+ — Real detector on device, recognition, collection, Drive | Not started |

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
yarn mobile:test           # workspace smoke + shared-scanner boundary guard
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
4. Open **Scan** tab → grant camera → verify debug panel:
   - physical devices (prefer `wide-angle`)
   - zoom range / neutral zoom
   - tap-to-focus reticle
5. Cycle **Lens** to compare rear devices; prefer main wide-angle for cards.

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
the Samsung; they exist as the control for the on-device benchmark in Phase 5.

## Storage / Drive / OCR (later milestones)

- **Storage:** implement `LocalRepository` with Expo SQLite; keep
  `src/core/sync` engine unchanged.
- **Drive:** new native `TokenProvider`; scopes stay
  `drive.appdata` + `drive.file` (`src/core/sync/scopes.ts`). No client secret
  in the app; secure token storage (not plain AsyncStorage).
- **OCR:** keep `TextRecognizer` portable; web stays `tesseract.js`; native
  must be benchmarked (e.g. ML Kit) against fixtures — do not switch on
  convenience alone.
- **Corpus:** same consent + Drive folder pipeline; label `platform: android`.

## Versioning

Native Settings shows product version + platform + Expo runtime. Align with
root `MAJOR.MINOR` and git commit stamps (see `docs/VERSIONING.md`) — do not
invent a separate scheme. Desktop overlay continues to use
`DESKTOP_VERSION` only.

## Limitations (honest)

- Milestone B **not yet validated** on the user’s Samsung (no sharpness claim).
- Collection / decks / Drive / recognition **not** ported yet.
- Portable `src/lib` is not imported into the app bundle yet (Metro
  `watchFolders` prepared).
- iOS is structurally supported; untested on device.
- CI does not yet build the Android development binary.

## Product boundary

Native must **not** embed Cardmarket, scrape Cardmarket, or replace the
extension. Companion scope: collection, decks, scanner, import/export, Drive
sync.

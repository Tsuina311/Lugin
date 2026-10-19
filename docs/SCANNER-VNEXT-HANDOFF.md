# Scanner vNext handoff

Written 2026-10-12 for another AI that will plan or continue this work.
This is a snapshot of the working tree and of device sessions from 2026-10-09.
Nothing here is promoted. Nothing here is a phone on-device recognition verdict
unless a section says the phone itself published the name.

Do not commit unless the user asks. Do not promote vNext. Do not print inbox
tokens. Do not paste Cloudflare hostnames into shell strings; read them from
the terminal log or from `/tmp/lugin-metro-host.txt` inside Python.

## 1. What this product is

Lugin has three surfaces:

1. Browser extension (desktop overlay). Version is `DESKTOP_VERSION` in
   `src/desktopVersion.ts`, currently `0.1.242`. Bump that only when overlay
   code changes (`src/ui`, `src/content`, `src/sites`, `src/background`,
   `src/interceptor`, or `src/lib` the overlay imports). Phone-only edits do
   not bump it. The overlay does not import `src/lib/scan/vnext/debug.ts`.
2. Phone website.
3. Native Android app `app.lugin.mobile`. This is the scanner under
   discussion. It is an Expo development client. JavaScript reloads from
   Metro. Native Kotlin changes require a new debug APK.

The production phone scanner identifies a card from the live camera and is
unchanged while Scanner vNext is off. vNext is a development-only path behind
`scannerVNext`, default OFF, including after a reload unless a previous
development session cached the flag. Production builds do not read that flag.
See `mobile/src/scan/vnextFlag.ts` and `src/lib/scan/vnext/flag.ts`.

The goal the user is driving toward is a scanner that can take a long run of
real cards, one tap each, upload the pictures as it goes, and publish the
correct name for almost every readable card while publishing no wrong names.
That product does not exist yet. What exists is a safe frozen matcher plus an
unfinished phone capture path.

## 2. Frozen recognition stack

Do not retrain, retune, quantize, or rebuild any of the following unless the
user explicitly lifts the freeze. Do not use new phone scans as training.

Pipeline, in order:

1. Existing candidate generator (mask passes: luma, chroma, edge). Same
   candidates as today. `detectCardQuad` stays synchronous for host tests.
2. Frozen GBM `gbm-iou-all-2dd2ec36b833` picks one candidate.
   `src/lib/scan/vnext/gbm.ts`.
3. Existing warp of that quad.
4. Existing art box, expanded 3% about its center, warped to 625×436.
   If no art box is emitted, the existing canonical art window.
   `src/lib/scan/vnext/artCrop.ts`.
5. Existing quantized ONNX CLIP ViT-B/32. Do not quantize again.
6. Frozen linear adapter `linear-identity-v1`.
7. Clean gallery and equal-weight prototype gallery. 49,968 identities,
   512 dims. Weights are equal across clean / blur / motion / perspective.
   Do not change the formula, the vectors, or the weights.
8. Frozen visual agreement. Publish if and only if prototype margin
   (Top1 − Top2) is at least 0.05 and the clean Top1 oracle equals the
   prototype Top1 oracle. The clean margin is not an input.
   `src/lib/scan/vnext/decide.ts`, `VNEXT_PUBLISH_MARGIN = 0.05`.
9. Selective recovery only when agreement withholds: ML Kit (on device) or
   the host OCR engine reads a unique exact title, and that oracle is already
   inside the prototype Top 5. Fuzzy titles do not publish. A visual publish
   is never replaced by OCR.

Gallery files live in `.scan-fixtures/vnext-galleries/`, not in the APK.
Manifest `manifest.json` records:

- count 49968, dims 512
- clean SHA-256 `785519ce3deda47f248392e66786d5b9008899cfec158390a31e2e3556e99b9c`
- prototype SHA-256 `7cfb59e52db439239ee4a1af6b22596a539d43eccfe1afb3d7835027d5a683d1`
- adapter id `linear-identity-v1`
- geometry id `gbm-iou-all-2dd2ec36b833`

`clean.f32` and `prototype.f32` are about 98 MB each. `refs.json` is about
4.6 MB. `adapter-w.f32` is about 1 MB. `adapter-b.f32` is 2048 bytes.

On the phone the gallery dir is external
`/sdcard/Android/data/app.lugin.mobile/files/lugin-visual-vnext` when a
manifest exists there, otherwise internal
`context.filesDir/lugin-visual-vnext` (Expo `documentDirectory`). If the
manifest is missing, report `VNEXT_ASSETS_NOT_LOADED`. Do not fall back to
the production recognizer.

Node `Float32Array(buffer.buffer)` is wrong for Buffers that sit in the 8 KB
pool. `adapter-b.f32` is 2048 bytes at byteOffset 8. Read floats with
`new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)`.

## 3. What the sealed evidence already says

Authority: train is descriptive, dev is validation, holdout is the frozen
test. Reports:

- `scanner-benchmark/reports/frozen-recognition-v1/REPORT.md`
- `scanner-benchmark/reports/recognition-autolab-v1/REPORT.md`
- `scanner-benchmark/reports/conservative-selector-v1/REPORT.md`

Holdout is 26 photos. With frozen GBM geometry plus agreement plus exact-title
Top-5 recovery (`OCR_RECOVERY_STRONG_WIN`, challenger `rec-71078c38c736`,
not promoted):

| | Top1 | Correct published | Wrong published | Recall |
|---|---:|---:|---:|---:|
| Agreement only | 16/26 | 10 | 0 | 0.385 |
| Agreement + exact title in prototype Top 5 | 17/26 | 14 | 0 | 0.538 |
| Human quad, agreement only | 19/26 | 11 | 0 | 0.423 |

Mean rank of the correct card stays 391. The long tail is untouched.
Dev (17 photos) went from 9 to 10 correct publishes, 0 wrong. Train (70)
went from 34 to 40 correct publishes, 0 wrong, under the recovery rule.

Train visual misses before OCR: 49 ok, 8 visually similar (rank 2–10),
9 representation (rank 11–100), 3 phone-domain (rank above 100), 1 bad art
crop.

Geometry on the same 26 holdout frames:

- No frame lacks a candidate at IoU 0.70. Generation is not the ceiling.
- Learned GBM raises selected quads to 26/26 at IoU ≥ 0.70 and 0 catastrophic
  quads, but agreement publishes stay 10 correct and 0 wrong
  (`LEARNED_GEOMETRY_NEUTRAL`). It fixes Moonsnare `geom-009` and loses
  Kaito `geom-003` and Ulamog's Crusher `geom-032`.
- A later selector search did not beat the frozen GBM. Do not swap it.

What this stack cannot do, even with a hand-drawn outline: publish the cards
whose prototype margin stays under 0.05, cards whose correct oracle is far
down the gallery, and non-English titles that do not exact-match an English
gallery name. OCR does not repair those. A heavily trained scanner is a
different stage. It needs a new visual model and thousands of labeled phone
photos across language, sleeves, glare, and blur, kept separate from this
sealed test. The current hundred-odd labeled frames are a benchmark, not a
training set.

## 4. How to evaluate

Host, once a fixture is in `.scan-fixtures/replay/`:

- `yarn scan:replay <fixture-id>`
- `yarn scan:regression`

Those cover CardNameIndex, fuzzy match, variant consensus, title decode, and
acceptance. Do not ask the user to tap Scanner Lab for recognition-logic
changes that those commands can score.

`yarn scanner:vnext-parity` has passed on the host. That is host parity of
the frozen math, not phone-versus-host CLIP.

Device is required for a new camera capture, the native detector, focus, or
a fresh Android ML Kit reading. Node does not reproduce ML Kit. Do not
duplicate the same PNG into the corpus twice. Do not invent a phone published
name from a host score.

Host CLIP in the inbox JPEG scorer is Xenova quantized `CLIP_VIT_B32`, cache
`.scan-fixtures/transformers-cache`. The phone runs the quantized ONNX
session. Those two have not been compared on the same pixels.

## 5. Phone capture contract

The user is the only tester. USB is not available. Work network blocks LAN
and ngrok. Use a Cloudflare HTTP/2 quick tunnel for Metro. The inbox is a
separate process and a separate tunnel.

Installed debug APK from 2026-10-09: `phone-app-debug-20261009-2`. Settings
shows the baked stamp in `mobile/build-stamp.json`:

`v1.0.79 · b7475cd+local`

Native app version `1.0.79`. A JS reload does not change that stamp. Live
git commit count is not what Settings shows, because the baked stamp wins.

Color capture, button pacing, JPEG save, and the naming-queue changes are
JS. They need a Metro reload, not a new APK. `takeSnapshot`,
`toRawPixelDataAsync`, `loadFromRawPixelDataAsync`, `saveToFileAsync`, and
`resize` already exist in the installed app.

`PreviewView` bitmaps are often hardware-backed. `saveToFileAsync` and
`resize` throw on those. Copy with `toRawPixelDataAsync(false)`, then
`Images.loadFromRawPixelDataAsync`, then save or resize the software bitmap.

Live detector reads the Y plane only, on Expo's single `modulesQueue`.
Manual vNext uses a color snapshot, not `capturePhoto`. The outline on
screen is the brightness frame. The saved picture is the color snapshot
warped with that outline (`same-fov`). Naming uses that tap warp. It does
not re-run the GBM candidate generator on the color source. Debug
`geometrySource` is `capture-outline` on that path.

UX that stays:

- One capture button, always pressable. It does not wait for a geometry lock.
- Do not retune detector or lock thresholds.
- The button shows a press state.
- Do not show "Taking the picture…" for the whole lookup.
- No Save button. Upload is automatic.
- A corner thumbnail of the last picture.
- Counts are cards captured / sent / still sending, not the files inside one
  upload.
- Keep-awake uses `suppressDeactivateWarnings: true`.

`mobile/src/scan/fastCapture.ts` is the long-session path:

1. The tap writes `source.jpg` with the native JPEG encoder, draws a small
   thumbnail, writes `metadata.json` and `recognition-quad.json`, starts the
   JPEG upload, and returns.
2. Straightening of every picture already queued happens before any of them
   is named. The straightened card is `recognition-card.jpg` (quality 82,
   744×1039), written from RGBA pixels through nitro-image, not a JS PNG.
3. That JPEG upload is started immediately and is capped at 20 seconds of
   waiting. A hung request must not hold the next card.
4. Naming reloads the source JPEG, warps it again with the tap outline, and
   calls `runScannerVNext({ preparedWarp })`. One name at a time, and only
   after taps have stopped for 1 second (`CAPTURE_GAP_MS` in
   `mobile/src/scan/capturePace.ts`).
5. If naming does not finish in 45 seconds, the queue moves on. The native
   CLIP call is not cancelled. It can still be holding `clipLock` on the
   `lugin-vnext` thread.
6. `named.json` is written after a name attempt so a later open does not
   name the same card forever. If the straightened JPEG exists but the upload
   was not confirmed, the next open retries the upload.
7. `resumeSavedCards` on scanner mount picks up leftover
   `documentDirectory/normal-scan/` directories that still have `source.jpg`
   and `recognition-quad.json`. An old `recognition-card.png` is treated as
   already finished and is not redone.

The screen (`mobile/src/scan/VNextCoach.tsx`) shows either a bare card name
(published: `VISUAL_AGREEMENT` or `OCR_EXACT_TOP5_RECOVERY`) or
`Closest: <name>` (withheld). Only the latest name stays on screen. The
count line is `N captured · M sent`.

Inbox layout: `.scan-inbox/sessions/<parent>--<card-NNN>/<role>/<file>`.
Receiver: `yarn scan:inbox` on `127.0.0.1:8787`. Phone pairing uses
`yarn scan:inbox:tunnel`, which is a different Cloudflare process from Metro.
`recognition-card.jpg` was added to `scripts/scan-inbox/lib.mjs` and
`mobile/src/scan/debugInbox/protocol.ts`. The inbox process that was already
running on 2026-10-09 was not restarted, so it will reject that filename
until `yarn scan:inbox` is started again. JPEG magic check already accepts
`FF D8 FF`.

## 6. Where the phone actually is

Two batches were received on 2026-10-09. Both are originals in the inbox.
Neither is a phone published-name result. Metadata does not store the vNext
decision.

### 14:30 batch — `normal-scan-session-20261009-143056`

Seven color JPEGs, 1080×2034. Straightened PNG arrived only for cards 001
and 002. The queue died after the second picture.

Host score of those JPEGs, after the adapter-bias bug was fixed. Xenova
quantized CLIP, frozen 0.05 agreement, no OCR. Do not quote an earlier run
that named every card Elturel Survivors; that run read the adapter bias from
the wrong buffer offset.

| Card | Photo | Host result |
|---|---|---|
| 001 | Urza's Sylex, French, glare on the title | Withheld. Closest Mnemonic Nexus, margin 0.0054. Miss. |
| 002 | Sublime Exhalation, sharp | Withheld. Prototype Top1 correct, margin 0.0819, clean Top1 was The Ring Goes South. |
| 003 | Prophet of the Scarab | Published. Margin 0.1089. |
| 004 | Dreamdew Entrancer | Published. Margin 0.1667. |
| 005 | Motion blur, title unreadable | Withheld. Closest Double-Faced Substitute Card, margin 0.0460. Correct to withhold. |
| 006 | Passe-passe / Sleight of Hand, French | Published. Margin 0.1841. |
| 007 | Ange de l'inventivité / Angel of Invention, French | Withheld. Both galleries agreed, margin 0.0307, under 0.05. |

Three of six readable cards published. Cards 002 and 007 might publish on
the phone if ML Kit reads an exact English title already in the prototype
Top 5. That was not run. Do not state it as a result.

Scorer: `scripts/scanner-benchmark/identity/score-inbox-jpegs.mjs`. It is
hardcoded to that one session. It is not wired to `package.json`.

### 16:12 batch — `normal-scan-session-20261009-161240`

Eleven originals arrived between 16:14 and 16:16 local. Straightened PNGs
arrived for cards 001–005, about every 30 seconds, last one at 16:17.
Cards 006–011 were still JPEG-only at 16:35. The 45-second timeout in the
code at that time did not move the queue. Naming ran before the straightened
file was written, on the JS thread, and one stuck name held the rest.

| Card | Photo | Straightened PNG |
|---|---|---|
| 001 | Table and a book, no card | yes, and it is the table |
| 002 | L'Âme tourmentée (Tormented Soul), French M12 | yes |
| 003 | Blank paper, a corner of the previous card | yes, and it is the paper |
| 004 | Ninja des heures noires (Ninja of the Deep Hours) | yes |
| 005 | Moon-Circuit Hacker | yes |
| 006 | Silver-Fur Master | no |
| 007 | Greffeur d'ailes (Wingcrafter) | no |
| 008 | Spirit token | no |
| 009 | Hibou savant (Sage Owl) | no |
| 010 | Mist-Cloaked Herald | no |
| 011 | Faerie Impostor | no |

Cards 001 and 003 are bad captures. The other nine are readable single cards.
The phone's own published-or-closest line for this batch is unknown.

The code change that saves `recognition-card.jpg` before naming is in the
working tree and typechecked (`yarn workspace lugin-mobile typecheck` exited
0 on 2026-10-09). It has not been loaded on the phone. The six leftover
directories should still be on the phone, because deletion required both the
JPEG upload and the straightened-file upload. `resumeSavedCards` is supposed
to straighten them on the next scanner open after a Metro reload. That has
not been observed.

### Script load failure

On the evening of 2026-10-09 the phone showed "unable to load script".
Metro on `127.0.0.1:8081` was still bundling. The Cloudflare quick tunnel in
front of it, host recorded in `/tmp/lugin-metro-host.txt` as
`https://don-ordered-been-offer.trycloudflare.com`, was returning
`Unauthorized: Tunnel not found` from about 16:28 UTC. That is a dead quick
tunnel, not a Java exception and not a scanner bug. A new HTTP/2 tunnel, a
Metro restart with `EXPO_PACKAGER_PROXY_URL` set from the new host, and a
new `phone-metro-connect-qr.png` are required before any JS reload can
succeed. The QR encodes
`exp+lugin://expo-development-client/?url=` plus that host. The IDE caches
the PNG; close and reopen the file after replacing it. As of this document
that restart had not been done. The old host should be assumed dead.

## 7. Still to do — the user

The user does not draw boxes, name cards, or describe photos. The files are
already on disk.

1. Get a live Metro tunnel and reload the development client from the new QR.
   Until that works, no JS fix is on the phone.
2. Restart `yarn scan:inbox` so the process loads the `recognition-card.jpg`
   allowlist. Leave `yarn scan:inbox:tunnel` up if it is healthy; it is a
   different process. Do not print the token.
3. Open the scanner and leave it open. Do not take a new batch for this
   check. The six pictures from 16:12 that never straightened should be
   picked up from disk.
4. After that, the only number that matters is whether straightened JPEGs
   for cards 006–011 appear in
   `.scan-inbox/sessions/normal-scan-session-20261009-161240--card-00N/`,
   and whether naming continues instead of stopping mid-batch.
5. A new eight-card scan is useful only after that reload is confirmed and
   the leftover six have either straightened or failed in a new way. The
   screen should reach `8 captured · 8 sent`, and eight straightened files
   should arrive. About half of readable cards publishing, with no wrong
   published name, is what the sealed holdout predicts. It is not a target
   to tune toward.

## 8. Still to do — implementation

In this order. Do not skip to training.

1. Restore Metro. New Cloudflare HTTP/2 tunnel to `127.0.0.1:8081`, write
   the host to `/tmp/lugin-metro-host.txt`, restart
   `yarn mobile:start` with `CI` unset and `EXPO_PACKAGER_PROXY_URL` read
   from that file, regenerate `phone-metro-connect-qr.png`. Confirm the
   bundle URL returns 200 locally and through the tunnel.
2. Restart the inbox receiver so `recognition-card.jpg` is accepted.
   Confirm with a health check. Unauthenticated `/health` returns 401 when
   the receiver is up.
3. Watch the 16:12 leftovers after the user reloads. Do not ask for new
   photos first. If 006–011 still do not straighten, the hang is still in
   `warpJpeg` / `writeWarpJpeg` / the upload, and the 45-second name timeout
   is not the remaining bug. `clipLock` is a single native thread; a timed-out
   `recognizeVNextFromRgbaBytes` is not cancelled.
4. Score the phone's own decision, not another Xenova pass, before calling
   the frozen stack good or bad on these photos. The phone decision is not
   in the inbox metadata today. Either record `source`, oracle id, margin,
   and the two Top1 names into the session files, or run the phone ONNX
   session on the saved warps. Until one of those exists, say the phone
   verdict is unknown.
5. Run the exact-title Top-5 rule on the readable withheld cards with ML Kit,
   not host Tesseract, before deciding that French cards are a model miss.
6. Only after a device number exists, decide whether a new model is
   justified. The sealed holdout already says coverage is about half of
   readable cards with zero wrong publishes, and that human outlines do not
   close the gap. A new model needs a new training set that is explicitly
   allowed to be training data, and a sealed test that is not that set.
   Yesterday's scans stay out of training.

Known code facts that already cost a day:

- Hardware bitmaps throw on `saveToFileAsync` and `resize`. CPU-copy first.
- Uncompressed PNG plus base64 of a 744×1039 card is about 3 MB of JS work
  and was on the tap path. The current tree writes a native JPEG instead.
  Do not put the PNG encoder back on the capture path.
- `Promise.race` does not cancel a synchronous JS block or a native CLIP
  call. Schedule the timeout before the work, and do not start the next
  name until this one has settled or the wait has given up. Saves of
  straightened files must not wait on that.
- Gallery load is on `lugin-vnext` and is about 200 MB. The first name can
  hitch once. That hitch is not the tab-freeze. The tab-freeze was synchronous
  detect, candidate warps, and PNG encode on the React Native JS thread.
- `yarn` in the sandbox can fail (`fastqueue`). Rerun with full permissions.
  `JAVA_HOME` is `/opt/homebrew/opt/openjdk@21`. `ANDROID_HOME` is
  `/opt/homebrew/share/android-commandlinetools`. `mobile/android/` is
  gitignored.

## 9. Do not do these

- Do not change 0.05, the exact-title rule, fuzzy OCR, quantization, gallery
  memory, candidate generation results, CLIP, the adapter, the prototype
  formula, or gallery weights.
- Do not promote vNext or turn the flag on by default.
- Do not train on the 14:30 or 16:12 scans.
- Do not ask the user to draw an outer box, an art box, or a title box on
  those batches. The tap outline is already in `recognition-quad.json`.
- Do not ask the user to scan in order to score recognition logic that host
  replay can score.
- Do not treat a host Xenova name as the phone's published name.
- Do not bump `DESKTOP_VERSION` for phone-only files.
- Do not commit unless asked.

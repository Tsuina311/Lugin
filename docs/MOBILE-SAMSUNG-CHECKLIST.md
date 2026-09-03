# Samsung validation — native scanner

Offline tests are **not** listed here. Only things that need the phone.

Use the virtual **Back Triple Camera**. Do not switch to ultra-wide.

Leave the debug panel **off** for the feel test, then **on** for numbers.
Thumbnails must stay ~1 Hz.

Confirm Settings stamp after OTA. Do not invent numbers.

## A. Detector latency (Shared JS — known slow)

- Move a card left/right quickly. Does the green polygon keep up?
- With Scan dbg on, read:
  - sample Hz / detect Hz
  - **cam→polygon p50/p95** (must be non-negative; `n/a` if unavailable)
  - detect p50/p95 (expect ~1000 ms on Shared JS until native detector APK)
  - processed-frame age, superseded
- Long edge **640 / 480 / 400**
- Debug panel **off vs on**

PENDING — prior reading: detect ~1065–1301 ms, ~1.3–1.7 Hz.

## B. High-res source

Cycle **Src snapshot / photo / high-res-frame**.

For each, lock a card and read:

- hi-res **phase** (idle/requested/capturing/converting/ready/failed)
- per-source **req / ok / fail** and **last error**
- source dimensions (must be ≫ analysis ~251×480 if labeled high-res)
- High-res source thumbnail: numbered quad on the same card?
- Recognition input — HIGH RES vs analysis fallback
- capture / convert / warp ms

Recognition must wait briefly for hi-res (debug shows wait ms) before fallback.

PENDING.

## C. Artwork index

Debug must show something like:

```text
names 36776 · art index ≥5000 · built YYYY-MM-DD
```

If you see `art index 20` or an art-index error about fixture size, the
deployed index is wrong — do not trust identity results.

Verify **Chaos Dragon** (and 10–20 other named cards) appear in candidates
only after a full art index is deployed.

Export recognition input → replay offline with
`node scripts/scan-art-replay.mjs --image … --expect "Chaos Dragon"`.

PENDING until full art-index is on Pages.

## D. Artwork-only confidence

OCR unavailable. Tight clusters (0.70 / 0.67) must stay **ambiguous**, not
Identified. Add disabled unless identified / printing-ambiguous.

PENDING.

## E. Result actions

Add / Wrong card / Wrong printing / Scan again. Temporal reset on Scan again.

PENDING.

## F. Thermal

5-minute continuous scan. Frame drops, detect Hz, heat.

PENDING.

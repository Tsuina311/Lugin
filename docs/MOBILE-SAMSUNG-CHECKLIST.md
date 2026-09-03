# Samsung validation — native scanner

Offline tests are **not** listed here. Only things that need the phone.

Use the virtual **Back Triple Camera**. Do not switch to ultra-wide.

Leave the debug panel **off** for the feel test, then **on** for numbers.
Thumbnails must stay ~1 Hz.

OTA to check: `C.2i` / later `high-res capture` update. Confirm Settings shows the new stamp.

## A. Detector latency

- Fast path chip is the default (not the 4-rung ladder).
- Move a card left/right quickly.
- Does the green polygon keep up?
- With Scan dbg on, read:
  - sample Hz
  - detect Hz
  - **cam→polygon p50/p95** (primary)
  - processed-frame age p50/p95 / last
  - detect p50/p95
  - received / processed / superseded
- Repeat with debug panel **off** vs **on**, thumbnail visible vs not.
- Cycle **Long 640 / 480 / 400**. Same FOV. Note hit rate and cam→polygon.

PENDING — do not invent numbers.

## B. SessionController + focus

- Badge uses shared phases: `SEARCHING` `DETECTED` `FOCUSING` `LOCKING`
  `RECOGNIZING` `FOUND` `AMBIGUOUS`. `CAPTURING…` while a still is in flight.
- Hold a card still. Phase should not jump to FOUND on the first plausible frame.
- Card-center focus should tick without fighting a recent tap.
- Tap-to-focus still works.

PENDING.

## C. High-res source vs analysis fallback

Cycle **Src snapshot / photo / high-res-frame**.

For each, lock a card and read debug:

- `source: snapshot|photo|high-res-frame (high-res)` **or** `analysis-fallback`
- native source dimensions
- capture / convert / warp ms
- High-res source thumbnail: does the numbered quad (1 TL … 4 BL) surround the same card?
- Recognition input — HIGH RES: upright, tight, not mirrored?

Then inspect the **same physical card** under analysis-fallback vs the chosen source:

- title legible?
- rules text legible?
- collector number legible?
- artwork sharpness?

Do not pick a winner without this comparison. Snapshot may fail if preview snapshot is unsupported (we force `implementationMode=compatible` for that). Photo may hitch the preview. High-res-frame may hitch when the latch attaches.

PENDING.

## D. Artwork-only identity

OCR is **unavailable** (title/text/footer must say unavailable, not 0).

- Indexes load (`card-names.json`, `art-index.json`).
- Scan 10–20 named cards.
- Artwork candidates 1/2/3 with scores?
- descriptor ms / matcher ms / art stage ms?
- Expected name in top-1 / top-3?
- Ambiguous cards stay ambiguous. Add stays disabled unless identified / printing-ambiguous.

PENDING.

## E. Result actions

- Add to collection (in-memory command).
- Wrong card / Wrong printing / Scan again.

PENDING.

## F. Thermal

- 5-minute continuous scan.
- Frame drops, detect Hz, heat.

PENDING.

# Samsung validation — native scanner

Offline tests are **not** listed here. Only things that need the phone.

Use the virtual **Back Triple Camera**. Do not switch to ultra-wide.

Leave the debug panel **off** for the feel test, then **on** for numbers.
Thumbnails must stay ~1 Hz.

## A. Detector latency

- Fast path chip is the default (not the 4-rung ladder).
- Move a card left/right quickly.
- Does the green polygon keep up?
- With Scan dbg on, read:
  - sample Hz
  - detect Hz
  - cam→polygon p50/p95
  - detect p50/p95
  - received / processed / superseded
- Repeat with debug panel **off** vs **on**, thumbnail visible vs not.
- Cycle **Long 640 / 480 / 400**. Same FOV. Note hit rate and cam→polygon.

PENDING — not measured in this session.

## B. SessionController + focus

- Badge uses shared phases: `SEARCHING` `DETECTED` `FOCUSING` `LOCKING`
  `RECOGNIZING` `FOUND` `AMBIGUOUS`.
- Hold a card still. Phase should not jump to FOUND on the first plausible frame.
- Card-center focus should tick without fighting a recent tap.
- Tap-to-focus still works.

PENDING.

## C. Normalized card

- Lock a card until **Recognition input (744×1039)** appears.
- Upright? Tight crop? Title readable? Not mirrored? Correct aspect?

PENDING.

## D. High-res source

- Current default is **analysis-warp** (same FOV as the detector).
- Photo / snapshot / higher-res frame are implemented as architecture only.
- Compare A/B/C only after A feels responsive:
  - resolution, sharpness, latency, preview freeze, quad mapping.

PENDING — do not pick a mechanism without these numbers.

## E. Artwork / identity

- Indexes load from the Pages deploy (`card-names.json`, `art-index.json`).
- Scan 10 named cards.
- Artwork candidates listed? Expected name in top 3?
- Time to result?
- Ambiguous cards stay ambiguous (do not auto-pick).

PENDING. OCR is empty, so identity is artwork-only until an engine is added.

## F. Result actions

- Add to collection (command queued; persistence is in-memory).
- Wrong card / Wrong printing / Scan again.

PENDING.

## G. Thermal

- 5-minute continuous scan.
- Frame drops, detect Hz, heat.

PENDING — no thermal claim without this test.

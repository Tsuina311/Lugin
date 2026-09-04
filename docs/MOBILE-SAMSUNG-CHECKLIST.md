# Samsung validation — native scanner

Offline tests are **not** listed here. Only things that need the phone.

Use the virtual **Back Triple Camera**. Do not switch to ultra-wide.

Leave the debug panel **off** for the feel test, then **on** for numbers.
Thumbnails must stay ~1 Hz.

Confirm Settings stamp after OTA. Do not invent numbers.

## Priority (from first device observations)

1. **Recognition color channels** — red must not look blue; blue must not look yellow
2. Native geometric detector
3. Prove real high-res source
4. Confirm full artwork index
5. Native OCR
6. Re-evaluate card recognition

## A. Color channels (gate before identity)

Export **Chaos Dragon** (red) via **Report** after OTA. The sheet shows / downloads:

- `lugin-recognition-*.png` — 744×1039 recognition input
- `lugin-detector-*.png` — analysis FOV fed to `detectCardQuad`
- report `.txt` / `.json` — includes `pixel format` + `channel order`

Gates:

- Recognition: red stays red (not blue); blue stays blue (not yellow)
- Detector: same check on `lugin-detector-*.png`
- Report: `pixel format`, `channel order`, buffer source (`plane 0` preferred on Android RGB)

Recognition color: PASS (Chaos Dragon / Pixie Guide, Sep 2026).
Detector color: PENDING — need one Chaos Dragon export with detector PNG.

## B. Detector latency (Shared JS — known slow)

- Move a card left/right quickly. Does the green polygon keep up?
- With Scan dbg on, read:
  - sample Hz / detect Hz
  - **cam→polygon p50/p95** (must be non-negative; `n/a` if unavailable)
  - detect p50/p95 (expect ~1000 ms on Shared JS until native detector APK)
  - processed-frame age, superseded
- Long edge **640 / 480 / 400**
- Debug panel **off vs on**

PENDING — prior reading: detect ~1065–1301 ms, ~1.3–1.7 Hz.

## C. High-res source

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

## D. Artwork index

Debug must show:

```text
names 36776 · art index ≥5000 · oracles ≥5000 · built YYYY-MM-DD
art candidate pool N (matcher top-N, not index size)
```

Production Pages index (2026-09-04): **49968 entries · 34082 oracles**.
Chaos Dragon / Pixie Guide: **present**.

If you see `art index 20` or an art-index error about fixture size, the
deployed index is wrong — do not trust identity results. Matcher top-N is
**not** index size.

Wrong Chaos Dragon art candidates (Sol Ring / Midgar / …) with a correct
normalized image ⇒ matcher/runtime issue, not missing coverage. Replay:

```bash
node scripts/scan-art-coverage.mjs
node scripts/scan-art-replay.mjs --image … --expect "Chaos Dragon"
```

PENDING same-image replay with Samsung export + on-device OCR.

## E. Artwork-only confidence

OCR unavailable. Tight clusters (0.70 / 0.67) must stay **ambiguous**, not
Identified. Add disabled unless identified / printing-ambiguous.

PENDING.

## F. Result actions

Add / Wrong card / Wrong printing / Scan again. Temporal reset on Scan again.

PENDING.

## G. Thermal

5-minute continuous scan. Frame drops, detect Hz, heat.

PENDING.

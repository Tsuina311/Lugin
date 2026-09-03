# Native geometric detector

Status: **required next APK work.** Shared-JS `detectCardQuad` on Hermes is
~1.0–1.3 s/frame on Samsung (~1.3–1.7 Hz). That fails the live overlay budget.

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

Debug chip:

```text
Detector: Native | Shared JS
```

Default stays Shared JS until parity harness passes and Samsung hits ~6–12 Hz.

## Parity

`yarn scan:detect-eval` corpus against both engines:

- detection rate
- false-positive rate
- mean IoU
- mean corner error

## Implementation notes

- Prefer VisionCamera YUV + native Y-plane downscale (avoid RGB→BGRA→RN→RGBA).
- Port `src/lib/scan/detectCard.ts` algorithm; do not swap in generic OpenCV
  contours or an ML detector unless the faithful port is proven impractical.
- New native module changes the EAS fingerprint → **new development APK**.
- Do not batch OCR/SQLite into that APK unless those milestones are next.

## Samsung targets

- preferred detector cadence 8–12 Hz (min useful ~6 Hz)
- native detect p50 ideally < 20–30 ms, p95 < 50 ms
- latest-frame-wins, no detection queue

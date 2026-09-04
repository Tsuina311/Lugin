# Binder Scanner (design only — not implemented)

This document describes the **future** Binder Scanner product. The production
app today remains a **single-card** scanner. Multi-card detector contracts are
being shaped so Binder can arrive without rewriting the geometric core.

Do **not** treat anything here as shipped UI.

---

## Product goal

Scan a binder page (or a table of loose cards) by **continuously** watching the
camera, not by hoping one still photo is sharp everywhere.

Glare and focus vary across pockets. Multi-frame collection is the product
advantage:

```text
frame A: cards 1, 2, 4 sharp
frame B: cards 3, 5, 6 sharp
frame C: cards 7, 8, 9 sharp
```

Each **track** keeps its own best normalized crop. Recognition jobs run per
track. The user reviews a grid, then **Add all**.

---

## Architecture

```text
camera
  → multi-card native detector
  → CardDetection[]
  → multi-object tracks (stable trackId)
  → best frame PER TRACK
  → independent warp / normalize
  → recognition jobs (title + art, local indexes)
  → review grid
  → Add all
```

Not:

```text
one binder screenshot → hope all nine are readable
```

### Multi-detection API (shared)

See `src/lib/scan/detection/multi.ts`:

- `CardDetection` — corners, score, area/aspect, optional `role`, optional `trackId`
- `CardDetectionFrame` — `detections[]`
- `choosePrimaryDetection` — single-card adapter used by today's SessionController

Production path stays:

```text
detections → rank / nested preference → primary → existing SessionController
```

### Track identity plan

1. Detector emits unordered `CardDetection[]` each frame (no random IDs).
2. A lightweight tracker associates detections across frames by center proximity,
   size, and orientation (IoU / Hungarian optional later).
3. Each association receives a stable `trackId` for the lifetime of that object
   on screen.
4. Empty binder slots are simply tracks that never reach recognition quality.

Do not invent per-frame IDs in the detector.

### Best-frame-per-card plan

For each `trackId`:

| Signal | Use |
| --- | --- |
| Sharpness / glare | Prefer clearer title + art crops |
| Detection score | Prefer confident geometry |
| Nested role | Prefer `card` over `outer-container` once available |
| Temporal stability | Prefer low motion samples |

Store the winning `ScanImage` (744×1039) + corners. Replace when a strictly
better sample arrives. Recognition can start early on a good sample and re-run
if a much better frame appears.

### Grid prior (hint, not requirement)

3×9 / 4 / 12 pocket layouts are **priors** for scoring and UI layout:

- rough row / column alignment
- similar sizes and orientation
- regular spacing

Grid detection is **not** required for ordinary multi-card scanning (loose cards
on a table must work). Empty slots are first-class.

### Review / Add all UX (conceptual)

```text
Scan Binder Page
  → outlines appear (amber = tracking, green = recognized)
  → page complete (or user stops)
  → review grid (tap to correct)
  → unresolved slots listed separately
  → Add all
```

Normal scanner chrome stays “Hold steady / Card locked / Recognizing” for the
single-card mode. Binder mode gets its own entry point later.

---

## Sleeve / nested geometry (feeds Binder too)

Sleeved cards often present as outer (sleeve) + inner (card). The detector keeps
a small ranked candidate list and may prefer the **inner** polygon for the final
card geometry while using the outer as early tracking / focus. See nested
helpers in `detection/multi.ts` and native `DetectCard` nested pick.

---

## Out of scope for this document

- Binder UI implementation
- Full multi-object tracker
- Hard-coded 3×3-only detector
- SQLite / Drive batching

Those wait until the single-card native + local-index milestone is stable on
device.

# Real-camera card detection corpus

Synthetic Scryfall fixtures are **not** enough. Detection must be proven on
phone photos of physical cards.

## Layout

```text
.scan-real/                  # gitignored (see .gitignore)
  wood-table-01.png
  wood-table-01.json         # corner annotation
  playmat-foil-02.png
  playmat-foil-02.json
  negative-notebook-01.png
  negative-notebook-01.json  # { "negative": true, "tag": "notebook" }
```

Do **not** commit copyrighted card imagery.

## Annotation format

```json
{
  "tag": "wood-table",
  "expectedName": "Sol Ring",
  "imageFile": "wood-table-01.png",
  "corners": {
    "topLeft": { "x": 120, "y": 80 },
    "topRight": { "x": 520, "y": 95 },
    "bottomRight": { "x": 505, "y": 680 },
    "bottomLeft": { "x": 110, "y": 670 }
  }
}
```

Coordinates are in **image pixel space** (same as the PNG).

Negative fixtures (no card / false rectangles):

```json
{
  "tag": "notebook",
  "negative": true,
  "imageFile": "negative-notebook-01.png"
}
```

## Annotate

```bash
yarn scan:detect-annotate path/to/photo.png
```

Opens a tiny local page: click the four corners in order
(top-left → top-right → bottom-right → bottom-left), then Save.
Writes a sidecar JSON next to the PNG under `.scan-real/`.

Or hand-edit JSON after dropping PNGs into `.scan-real/`.

## Evaluate

```bash
yarn scan:detect-eval --real
yarn scan:detect-eval            # synthetic + real (real skipped if empty)
yarn scan:detect-eval --synthetic
```

Reports detection rate, false positives, IoU, corner error — **separately** for
synthetic and real.

## Suggested tags

`wood-table`, `white-table`, `dark-table`, `playmat`, `clear-sleeve`,
`matte-sleeve`, `foil`, `dim`, `glare`, `perspective`, `borderless`,
`old-frame`, `battle`, `negative`

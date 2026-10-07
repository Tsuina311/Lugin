# ART EDGE DIAGNOSIS V1

Diagnostic only. The detector, the 0.2 gate, the search windows, and recognition were not changed.

## PIPELINE

`detectFrameRegions` runs on the upright 744×1039 card warp.

1. Luma is `0.299R + 0.587G + 0.114B`.
2. Horizontal evidence is Sobel `gy`. Each row is summarized from x=0.12 to x=0.88.
3. A row's energy is the mean absolute Sobel. Continuity is the fraction of that span with absolute Sobel ≥ 12. Side agreement is the quieter half of the span divided by the louder half.
4. Boundaries are picked in order: `titleTop`, `titleArt`, `artType`, `typeText`, `textFooter`, `footerBottom`. A detection suppresses later windows within 0.02.
5. `pickPeak` keeps rows inside `[lo, hi]`. Score is `(energy / window max) × (0.25 + 0.75 × continuity) × (0.7 + 0.3 × prior Gaussian)`.
6. Prominence is one window statistic: `(max energy − median energy) / max energy`. It is not a per-pixel score.
7. Confidence is `0.45×continuity + 0.25×prominence + 0.15×priorAgree + 0.15×sideAgree`, computed for the winning row.
8. The winner is rejected when continuity < 0.28, prominence < 0.2, confidence < 0.2, or the window max energy is < 6.
9. Vertical evidence is Sobel `gx`, measured only between the detected art top and art bottom. If either is missing, the span falls back to y=0.18–0.70.
10. `artBox` is `titleArt`, `artType`, `innerLeft`, `innerRight`. `boundaryQuad` returns nothing unless all four are detected, they are in order, and the minimum confidence is ≥ 0.2. One failed edge drops the whole box.

Search windows, as fractions of the card:

| Edge | Boundary | Prior | Window |
| --- | --- | ---: | --- |
| top | titleArt | 0.115 | 0.070–0.180 |
| bottom | artType | 0.542 | 0.470–0.575 |
| left | innerLeft | 0.075 | 0.020–0.160 |
| right | innerRight | 0.925 | 0.840–0.980 |

Green in the debug page is the human art edge. Blue is an accepted detector line. Red is the line the scorer chose and a gate rejected. Orange marks other strong energy peaks inside the window. Human lines are a ruler. They do not change the pick.

A candidate is at the human edge when it is within 0.02, the detector's own suppress radius. It is a strong candidate when its energy is at least 6 and at least 75% of the window maximum.

- A. The winning line is the human edge, and a gate rejected it.
- B. A strong line sits on the human edge, and the scorer chose a different line.
- C. The human edge is weak or absent inside the window.

## CARD QUAD

Human art edges below are projected onto the detector warp. Card IoU compares the human card outline with the quad that warp used.

| Card | Card IoU | artBox |
| --- | ---: | --- |
| Negate | 0.949 | no |
| Island cq-120629 | 0.190 | no |
| Wand of Wonder cq-120751 | 0.288 | no |
| Livaan cq-120813 | 0.397 | no |
| Bulk Up | 0.344 | no |
| Mudbutton Torchrunner | 0.318 | no |
| Island geom-001 | 0.946 | yes |

## PER EDGE

| Card | Edge | Window | Human | In window | Energy at human | Strongest t | Strongest energy | Winner t | Continuity | Prominence | Confidence | Accepted | Raw reason | Class | Normalized | Δ winner | Δ strongest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Negate | top | 0.070–0.180 | 0.118 | yes | 17.7 / c 0.410 | 0.082 | 21.5 | 0.082 | 0.367 | 0.275 | 0.424 | yes | — | B | BAD_POSITION (strong-human-line-lost) | 37.2 px | 37.2 px |
| Negate | bottom | 0.470–0.575 | 0.618 | no | 31.6 / c 0.511 | 0.550 | 15.4 | 0.551 | 0.482 | 0.178 | 0.482 | no | low-prominence | B | OTHER (visible-outside-window) | 69.4 px | 70.4 px |
| Negate | left | 0.020–0.160 | -0.037 | no | — / c — | 0.083 | 21.5 | 0.083 | 0.258 | 0.482 | 0.431 | no | low-continuity | C | OTHER (outside-search-window) | 89.7 px | 89.7 px |
| Negate | right | 0.840–0.980 | 0.936 | yes | 17.1 / c 0.370 | 0.930 | 24.2 | 0.930 | 0.538 | 0.455 | 0.546 | yes | — | OK | — | 4.5 px | 4.5 px |
| Island cq-120629 | top | 0.070–0.180 | 0.515 | no | 52.5 / c 0.776 | 0.138 | 6.4 | 0.138 | 0.133 | 0.231 | 0.318 | no | low-continuity | B | OTHER (visible-outside-window) | 391.4 px | 391.4 px |
| Island cq-120629 | bottom | 0.470–0.575 | 0.688 | no | 75.4 / c 0.624 | 0.513 | 52.5 | 0.513 | 0.776 | 0.526 | 0.584 | yes | — | B | OTHER (visible-outside-window) | 181.9 px | 181.9 px |
| Island cq-120629 | left | 0.020–0.160 | 0.463 | no | 21.7 / c 0.354 | 0.020 | 11.9 | 0.020 | 0.324 | 0.348 | 0.329 | yes | — | B | OTHER (visible-outside-window) | 329.0 px | 329.0 px |
| Island cq-120629 | right | 0.840–0.980 | 0.840 | yes | 19.5 / c 0.391 | 0.938 | 19.7 | 0.935 | 0.321 | 0.590 | 0.456 | yes | — | B | BAD_POSITION (accepted-other-line) | 70.5 px | 72.5 px |
| Wand of Wonder cq-120751 | top | 0.070–0.180 | 0.400 | no | 52.8 / c 0.631 | 0.113 | 7.6 | 0.113 | 0.193 | 0.181 | 0.399 | no | low-continuity | B | OTHER (visible-outside-window) | 298.3 px | 298.3 px |
| Wand of Wonder cq-120751 | bottom | 0.470–0.575 | 0.623 | no | 46.4 / c 0.488 | 0.524 | 39.9 | 0.524 | 0.576 | 0.340 | 0.529 | yes | — | B | OTHER (visible-outside-window) | 103.2 px | 103.2 px |
| Wand of Wonder cq-120751 | left | 0.020–0.160 | 0.365 | no | 32.1 / c 0.430 | 0.038 | 13.4 | 0.038 | 0.355 | 0.422 | 0.390 | yes | — | B | OTHER (visible-outside-window) | 243.3 px | 243.3 px |
| Wand of Wonder cq-120751 | right | 0.840–0.980 | 0.815 | no | 21.0 / c 0.452 | 0.878 | 33.2 | 0.879 | 0.522 | 0.401 | 0.410 | yes | — | B | OTHER (visible-outside-window) | 47.8 px | 46.8 px |
| Livaan cq-120813 | top | 0.070–0.180 | 0.269 | no | 36.1 / c 0.479 | 0.077 | 7.7 | 0.120 | 0.178 | 0.142 | 0.381 | no | low-continuity | B | OTHER (visible-outside-window) | 154.3 px | 199.3 px |
| Livaan cq-120813 | bottom | 0.470–0.575 | 0.498 | yes | 63.6 / c 0.648 | 0.500 | 63.6 | 0.500 | 0.648 | 0.581 | 0.530 | yes | — | OK | — | 2.3 px | 2.3 px |
| Livaan cq-120813 | left | 0.020–0.160 | 0.312 | no | 20.4 / c 0.346 | 0.050 | 17.9 | 0.050 | 0.568 | 0.459 | 0.553 | yes | — | B | OTHER (visible-outside-window) | 195.0 px | 195.0 px |
| Livaan cq-120813 | right | 0.840–0.980 | 0.739 | no | 23.5 / c 0.488 | 0.878 | 15.2 | 0.918 | 0.492 | 0.366 | 0.518 | yes | — | B | OTHER (visible-outside-window) | 133.0 px | 103.0 px |
| Bulk Up | top | 0.070–0.180 | 0.393 | no | 32.6 / c 0.544 | 0.077 | 4.8 | — | 0.000 | 0.000 | 0.000 | no | no-energy | B | OTHER (visible-outside-window) | — | 328.1 px |
| Bulk Up | bottom | 0.470–0.575 | 0.593 | no | 32.0 / c 0.493 | 0.539 | 26.5 | 0.539 | 0.458 | 0.204 | 0.473 | yes | — | B | OTHER (visible-outside-window) | 57.0 px | 57.0 px |
| Bulk Up | left | 0.020–0.160 | 0.200 | no | 20.2 / c 0.282 | 0.153 | 12.0 | 0.152 | 0.295 | 0.577 | 0.337 | yes | — | B | OTHER (visible-outside-window) | 35.7 px | 34.7 px |
| Bulk Up | right | 0.840–0.980 | 0.831 | no | 14.5 / c 0.282 | 0.856 | 24.7 | 0.872 | 0.461 | 0.588 | 0.421 | yes | — | B | OTHER (visible-outside-window) | 30.3 px | 18.3 px |
| Mudbutton Torchrunner | top | 0.070–0.180 | 0.469 | no | 75.8 / c 0.633 | 0.095 | 36.0 | 0.095 | 0.180 | 0.603 | 0.396 | no | low-continuity | B | OTHER (visible-outside-window) | 387.7 px | 387.7 px |
| Mudbutton Torchrunner | bottom | 0.470–0.575 | 0.680 | no | 68.3 / c 0.576 | 0.477 | 69.5 | 0.492 | 0.580 | 0.380 | 0.476 | yes | — | B | OTHER (visible-outside-window) | 195.2 px | 211.2 px |
| Mudbutton Torchrunner | left | 0.020–0.160 | 0.247 | no | 65.0 / c 0.498 | 0.120 | 12.9 | 0.120 | 0.092 | 0.679 | 0.295 | no | low-continuity | B | OTHER (visible-outside-window) | 94.9 px | 94.9 px |
| Mudbutton Torchrunner | right | 0.840–0.980 | 0.768 | no | 31.3 / c 0.265 | 0.907 | 4.7 | — | 0.000 | 0.000 | 0.000 | no | no-energy | C | OTHER (outside-search-window) | — | 103.6 px |
| Island geom-001 | top | 0.070–0.180 | 0.132 | yes | 93.5 / c 1.000 | 0.120 | 93.5 | 0.120 | 1.000 | 0.867 | 0.911 | yes | — | OK | — | 11.8 px | 11.8 px |
| Island geom-001 | bottom | 0.470–0.575 | 0.839 | no | 76.8 / c 0.908 | 0.534 | 14.5 | 0.534 | 0.401 | 0.302 | 0.503 | yes | — | B | OTHER (visible-outside-window) | 317.3 px | 317.3 px |
| Island geom-001 | left | 0.020–0.160 | 0.065 | yes | 9.0 / c 0.136 | 0.020 | 59.7 | 0.020 | 0.958 | 0.913 | 0.808 | yes | — | B | BAD_POSITION (accepted-other-line) | 33.3 px | 33.3 px |
| Island geom-001 | right | 0.840–0.980 | 0.960 | yes | 20.6 / c 0.304 | 0.965 | 23.8 | 0.965 | 0.786 | 0.683 | 0.680 | yes | — | OK | — | 3.4 px | 3.4 px |

## NO ANCHOR

Any one undetected art edge makes `boundaryQuad` return no art box.

| Card | Card IoU | Failed edge(s) | Failure type | Correct edge visible? | What was rejected |
| --- | --- | --- | --- | --- | --- |
| Negate | 0.949 | bottom, left | tight card | bottom yes, outside window; left no | bottom window low-prominence; human visible-outside-window; left window low-continuity; human outside-search-window |
| Island cq-120629 | 0.190 | top | loose card warp | top yes, outside window | top window low-continuity; human visible-outside-window |
| Wand of Wonder cq-120751 | 0.288 | top | loose card warp | top yes, outside window | top window low-continuity; human visible-outside-window |
| Livaan cq-120813 | 0.397 | top | loose card warp | top yes, outside window | top window low-continuity; human visible-outside-window |
| Bulk Up | 0.344 | top | loose card warp | top yes, outside window | top window no-energy; human visible-outside-window |
| Mudbutton Torchrunner | 0.318 | top, left, right | loose card warp | top yes, outside window; left yes, outside window; right no | top window low-continuity; human visible-outside-window; left window low-continuity; human visible-outside-window; right window no-energy; human outside-search-window |

- Negate: artBox omitted because bottom (low-prominence, B), left (low-continuity, C). One of those is enough to drop the box.
- Island cq-120629: artBox omitted because top (low-continuity, B). One of those is enough to drop the box.
- Wand of Wonder cq-120751: artBox omitted because top (low-continuity, B). One of those is enough to drop the box.
- Livaan cq-120813: artBox omitted because top (low-continuity, B). One of those is enough to drop the box.
- Bulk Up: artBox omitted because top (no-energy, B). One of those is enough to drop the box.
- Mudbutton Torchrunner: artBox omitted because top (low-continuity, B), left (low-continuity, B), right (no-energy, C). One of those is enough to drop the box.

## ISLAND GEOM-001

Anchor confidence 0.503. All four edges were accepted. The placement error is which line won.

- bottom: winner 0.534 vs human 0.839 (317.3 px). Strongest energy is 317.3 px from the human edge. Class B. Nearest named structure: artwork content edge.
- left: winner 0.020 vs human 0.065 (33.3 px). Strongest energy is 33.3 px from the human edge. Class B. Nearest named structure: card frame.
- top: winner 0.120 vs human 0.132 (11.8 px). Strongest energy is 11.8 px from the human edge. Class OK. Nearest named structure: title/art line.
- right: winner 0.965 vs human 0.960 (3.4 px). Strongest energy is 3.4 px from the human edge. Class OK. No named frame line within 0.02 of the winner.

The largest single-edge offset is bottom at 317.3 px.

## VERDICT

**MIXED**

5 of 6 missing anchors are loose card warps (card IoU under 0.9). Their art edges are strong and sit outside the fractional windows because those windows are fractions of the background, not of the card. The two tight cards fail differently: Negate's art bottom is just below the art/type window, and Island geom-001's extended art bottom is far below it. Zero causing edges are a correct in-window line rejected by the 0.2 gate.

A lower confidence gate would not recover these boxes. On the loose warps the top window is background, and its best line is weak. On the tight cards the true art bottom is outside the searched rows, so the gate never sees it.

No art-only change of the existing gates or the existing score is a sufficient fix. The five loose warps need a card quad that actually bounds the card. The two tight-card misses need an art-bottom search that can reach a lower type line without treating that as a normal-frame prior.

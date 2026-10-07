# CARD QUAD ISOLATION V1

The frame-region detector is unchanged. Path A warps the detected card quad. Path B warps the human-reviewed card outline. Human art is measured afterward and does not choose an edge.

A recovered loose frame emits an art box on the human-card warp with auto/human art IoU ≥ 0.75. That cutoff is the existing material-agreement line.

## SUMMARY

| Card | Current card IoU | Current anchor | Current art IoU | Current corner | Human-card anchor | Human-card art IoU | Human-card corner | Rank current | Rank human-card | Cause |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Negate | 0.949 | no | — | — | yes 0.504 | 0.710 | 83.1 px | — | 2 | FRAME_PRIOR |
| Island cq-120629 | 0.190 | no | — | — | yes 0.651 | 0.909 | 24.4 px | — | 1 | CARD_QUAD |
| Wand of Wonder cq-120751 | 0.251 | no | — | — | yes 0.587 | 0.842 | 36.2 px | — | 1 | CARD_QUAD |
| Livaan cq-120813 | 0.226 | no | — | — | yes 0.560 | 0.906 | 23.3 px | — | 1 | CARD_QUAD |
| Bulk Up | 0.344 | no | — | — | yes 0.423 | 0.786 | 60.3 px | — | 2 | CARD_QUAD |
| Mudbutton Torchrunner | 0.318 | no | — | — | yes 0.869 | 0.917 | 21.4 px | — | 1 | CARD_QUAD |
| Island geom-001 | 0.946 | yes 0.503 | 0.536 | 175.4 px | yes 0.470 | 0.553 | 168.6 px | 19 | 39 | FRAME_PRIOR |

Loose-card recoveries: 5/5.

**CARD_GEOMETRY_PRIMARY**

Island geom-001 still places the art bottom at 0.831, outside 0.470–0.575, and the detector still takes an illustration edge near 0.52. That layout is not the standard art window. Negate's art bottom is 0.610, only 0.035 past the same cap, on an otherwise normal frame. The two misses do not justify one wider window, and only Island geom-001 is evidence for a separate layout prior.

## Negate


| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.949 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.504 | 0.710 | 83.1 px | 2 (Darkslick Drake) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.118 | yes | 0.082 | 21.5 | 15.5 / c 0.343 | 0.367 | 0.275 | 0.424 | yes | 37.2 px |
| current | bottom | 0.618 | no | 0.551 | 15.4 | 30.4 / c 0.500 | 0.482 | 0.178 | 0.482 | no | 69.4 px |
| current | left | -0.037 | no | 0.083 | 21.5 | 24.1 / c 0.325 | 0.258 | 0.482 | 0.431 | no | 89.7 px |
| current | right | 0.936 | yes | 0.930 | 24.2 | 10.9 / c 0.284 | 0.538 | 0.455 | 0.546 | yes | 4.5 px |
| humanCard | top | 0.114 | yes | 0.110 | 30.0 | 24.3 / c 0.500 | 0.792 | 0.674 | 0.729 | yes | 4.8 px |
| humanCard | bottom | 0.610 | no | 0.536 | 15.5 | 28.7 / c 0.405 | 0.491 | 0.210 | 0.509 | yes | 76.7 px |
| humanCard | left | -0.015 | no | 0.113 | 17.3 | 28.8 / c 0.440 | 0.334 | 0.562 | 0.504 | yes | 95.4 px |
| humanCard | right | 0.940 | yes | 0.934 | 25.6 | 9.9 / c 0.277 | 0.634 | 0.632 | 0.711 | yes | 4.1 px |

## Island cq-120629

Classification: `RECOVERED_BY_CARD_QUAD`.

| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.190 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.651 | 0.909 | 24.4 px | 1 (Island) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.515 | no | 0.138 | 6.4 | 44.3 / c 0.663 | 0.133 | 0.231 | 0.318 | no | 391.4 px |
| current | bottom | 0.688 | no | 0.513 | 52.5 | 69.3 / c 0.597 | 0.776 | 0.526 | 0.584 | yes | 181.9 px |
| current | left | 0.463 | no | 0.020 | 11.9 | 17.9 / c 0.335 | 0.324 | 0.348 | 0.329 | yes | 329.0 px |
| current | right | 0.840 | yes | 0.935 | 17.4 | 16.7 / c 0.377 | 0.321 | 0.590 | 0.456 | yes | 70.5 px |
| humanCard | top | 0.100 | yes | 0.102 | 46.1 | 40.7 / c 0.708 | 0.689 | 0.792 | 0.651 | yes | 2.0 px |
| humanCard | bottom | 0.554 | yes | 0.543 | 101.9 | 84.0 / c 0.917 | 0.903 | 0.665 | 0.822 | yes | 11.5 px |
| humanCard | left | 0.108 | yes | 0.109 | 117.7 | 54.1 / c 0.620 | 0.959 | 0.816 | 0.826 | yes | 0.7 px |
| humanCard | right | 0.898 | yes | 0.953 | 115.2 | 21.1 / c 0.592 | 0.987 | 0.838 | 0.845 | yes | 40.7 px |

## Wand of Wonder cq-120751

The stored card outline was in 1440x1920 capture pixels. It is scaled by 0.6667 onto the PNG. The art box was already in PNG pixels and was not scaled.
Classification: `RECOVERED_BY_CARD_QUAD`.

| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.251 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.587 | 0.842 | 36.2 px | 1 (Wand of Wonder) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.400 | no | 0.113 | 7.6 | 44.9 / c 0.581 | 0.193 | 0.181 | 0.399 | no | 298.3 px |
| current | bottom | 0.623 | no | 0.524 | 39.9 | 44.8 / c 0.502 | 0.576 | 0.340 | 0.529 | yes | 103.2 px |
| current | left | 0.365 | no | 0.038 | 13.4 | 26.3 / c 0.435 | 0.355 | 0.422 | 0.390 | yes | 243.3 px |
| current | right | 0.815 | no | 0.879 | 31.8 | 17.9 / c 0.333 | 0.522 | 0.401 | 0.410 | yes | 47.8 px |
| humanCard | top | 0.133 | yes | 0.124 | 96.2 | 15.8 / c 0.597 | 1.000 | 0.879 | 0.942 | yes | 9.4 px |
| humanCard | bottom | 0.588 | no | 0.532 | 25.2 | 201.2 / c 1.000 | 0.583 | 0.315 | 0.587 | yes | 58.5 px |
| humanCard | left | 0.067 | yes | 0.081 | 112.3 | 57.1 / c 0.919 | 0.972 | 0.877 | 0.872 | yes | 10.5 px |
| humanCard | right | 0.921 | yes | 0.921 | 58.0 | 36.5 / c 0.574 | 0.769 | 0.643 | 0.769 | yes | 0.1 px |

## Livaan cq-120813

The stored card outline was in 1440x1920 capture pixels. It is scaled by 0.6667 onto the PNG. The art box was already in PNG pixels and was not scaled.
Classification: `RECOVERED_BY_CARD_QUAD`.

| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.226 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.560 | 0.906 | 23.3 px | 1 (Livaan, Cultist of Tiamat) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.269 | no | 0.120 | 7.4 | 20.1 / c 0.525 | 0.178 | 0.142 | 0.381 | no | 154.3 px |
| current | bottom | 0.498 | yes | 0.500 | 63.6 | 38.5 / c 0.581 | 0.648 | 0.581 | 0.530 | yes | 2.3 px |
| current | left | 0.312 | no | 0.050 | 17.9 | 16.7 / c 0.327 | 0.568 | 0.459 | 0.553 | yes | 195.0 px |
| current | right | 0.739 | no | 0.918 | 14.2 | 22.8 / c 0.461 | 0.492 | 0.366 | 0.518 | yes | 133.0 px |
| humanCard | top | 0.100 | yes | 0.080 | 44.2 | 22.2 / c 0.717 | 0.641 | 0.840 | 0.613 | yes | 20.4 px |
| humanCard | bottom | 0.542 | yes | 0.545 | 107.2 | 38.5 / c 0.905 | 0.995 | 0.907 | 0.904 | yes | 2.9 px |
| humanCard | left | 0.067 | yes | 0.028 | 32.1 | 20.2 / c 0.634 | 0.983 | 0.794 | 0.776 | yes | 28.7 px |
| humanCard | right | 0.931 | yes | 0.930 | 17.4 | 14.3 / c 0.334 | 0.517 | 0.499 | 0.560 | yes | 0.7 px |

## Bulk Up

Classification: `RECOVERED_BY_CARD_QUAD`.

| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.344 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.423 | 0.786 | 60.3 px | 2 (Demonic Bargain) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.393 | no | — | — | 27.2 / c 0.442 | 0.000 | 0.000 | 0.000 | no | — |
| current | bottom | 0.593 | no | 0.539 | 26.5 | 31.7 / c 0.447 | 0.458 | 0.204 | 0.473 | yes | 57.0 px |
| current | left | 0.200 | no | 0.152 | 11.7 | 15.9 / c 0.271 | 0.295 | 0.577 | 0.337 | yes | 35.7 px |
| current | right | 0.831 | no | 0.872 | 23.2 | 13.4 / c 0.268 | 0.461 | 0.588 | 0.421 | yes | 30.3 px |
| humanCard | top | 0.125 | yes | 0.150 | 37.6 | 8.0 / c 0.177 | 0.544 | 0.687 | 0.517 | yes | 25.8 px |
| humanCard | bottom | 0.561 | yes | 0.550 | 43.6 | 6.3 / c 0.113 | 0.965 | 0.746 | 0.880 | yes | 11.1 px |
| humanCard | left | -0.002 | no | 0.139 | 25.9 | 12.9 / c 0.404 | 0.498 | 0.502 | 0.423 | yes | 104.2 px |
| humanCard | right | 0.977 | yes | 0.977 | 39.0 | 24.3 / c 0.596 | 0.964 | 0.689 | 0.786 | yes | 0.2 px |

## Mudbutton Torchrunner

Classification: `RECOVERED_BY_CARD_QUAD`.

| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.318 | no | — | — | — | —  |
| humanCard | 1.000 | yes | 0.869 | 0.917 | 21.4 px | 1 (Mudbutton Torchrunner) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.469 | no | 0.095 | 36.0 | 60.3 / c 0.555 | 0.180 | 0.603 | 0.396 | no | 387.7 px |
| current | bottom | 0.680 | no | 0.492 | 69.3 | 53.5 / c 0.511 | 0.580 | 0.380 | 0.476 | yes | 195.2 px |
| current | left | 0.247 | no | 0.120 | 12.9 | 62.8 / c 0.494 | 0.092 | 0.679 | 0.295 | no | 94.9 px |
| current | right | 0.768 | no | — | — | 27.4 / c 0.281 | 0.000 | 0.000 | 0.000 | no | — |
| humanCard | top | 0.114 | yes | 0.108 | 181.4 | 104.2 / c 0.996 | 1.000 | 0.835 | 0.893 | yes | 6.4 px |
| humanCard | bottom | 0.563 | yes | 0.567 | 270.2 | 61.6 / c 0.993 | 1.000 | 0.876 | 0.893 | yes | 4.6 px |
| humanCard | left | 0.075 | yes | 0.046 | 180.5 | 62.5 / c 0.907 | 1.000 | 0.856 | 0.869 | yes | 21.9 px |
| humanCard | right | 0.918 | yes | 0.943 | 169.5 | 45.7 / c 0.755 | 1.000 | 0.862 | 0.918 | yes | 18.9 px |

## Island geom-001


| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| current | 0.946 | yes | 0.503 | 0.536 | 175.4 px | 19 (Riverglide Pathway) |
| humanCard | 1.000 | yes | 0.470 | 0.553 | 168.6 px | 39 (Deadly Tempest) |

| Path | Edge | Human | In window | Selected | Energy | Energy at human | Continuity | Prominence | Confidence | Accepted | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | top | 0.132 | yes | 0.120 | 93.5 | 25.2 / c 0.756 | 1.000 | 0.867 | 0.911 | yes | 11.8 px |
| current | bottom | 0.839 | no | 0.534 | 14.5 | 31.6 / c 0.590 | 0.401 | 0.302 | 0.503 | yes | 317.3 px |
| current | left | 0.065 | yes | 0.020 | 59.7 | 4.8 / c 0.064 | 0.958 | 0.913 | 0.808 | yes | 33.3 px |
| current | right | 0.960 | yes | 0.965 | 23.8 | 10.7 / c 0.241 | 0.786 | 0.683 | 0.680 | yes | 3.4 px |
| humanCard | top | 0.110 | yes | 0.098 | 91.7 | 27.7 / c 0.776 | 1.000 | 0.866 | 0.878 | yes | 12.5 px |
| humanCard | bottom | 0.831 | no | 0.519 | 13.6 | 64.5 / c 0.984 | 0.383 | 0.285 | 0.470 | yes | 324.1 px |
| humanCard | left | 0.042 | yes | 0.047 | 10.8 | 6.0 / c 0.083 | 0.381 | 0.482 | 0.481 | yes | 3.5 px |
| humanCard | right | 0.953 | yes | 0.958 | 22.5 | 10.0 / c 0.233 | 0.817 | 0.667 | 0.709 | yes | 4.3 px |

# Scanner corpus inventory

Generated 2026-10-05T10:06:43.131Z.

Counts are from a fresh walk. Canonical Scryfall art crops are not in the image total.

| | |
| --- | ---: |
| Files | 4330 |
| Images | 1899 |
| Sessions | 226 |
| Videos | 0 |
| Exact duplicate clusters | 121 |
| Extra frames in those clusters | 892 |
| Near-duplicate source clusters | 15 |
| Source frames hashed | 267 |

## What each group can tell us

- **single-card** (4 sessions, 97 images): Recognition, after a human confirms the physical card.
- **deck** (7 sessions, 180 images): Recognition across one physical stack. Frames stay in one split.
- **geometry** (14 sessions, 244 images): Detector and warp. Recorded quads are not ground truth.
- **binder** (8 sessions, 62 images): Future multi-card detection. Excluded from the V1 single-card score.
- **focus** (9 sessions, 128 images): Sharpness and capture quality.
- **capture-quality** (7 sessions, 56 images): Snapshot versus photo of one presentation.
- **swap** (2 sessions, 20 images): Card-change evidence without video.
- **phone-trace** (163 sessions, 1080 images): Debug traces. A human label is required before scoring.
- **replay** (10 sessions, 30 images): Explicit identities plus recorded OCR. Sanity set, not overall accuracy.
- **real-photo** (2 sessions, 2 images): One explicit hard-case label.

## Sessions

| Session | Date | Type | Images | Source | Warp | Title | Overlay | Identity | OCR | Scanner result |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| _crops |  | phone-trace | 10 | no | no | yes | no | unknown | no | no |
| basilisk-collar-20260908T105457 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| basilisk-collar-20260908T111744 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | yes |
| binder-session-20260911-090602 | 2026-09-11 | binder | 3 | no | yes | no | no | unknown | no | no |
| binder-test-20260909-163805 | 2026-09-09 | binder | 0 | no | no | no | no | unknown | no | no |
| binder-test-20260909-163901 | 2026-09-09 | binder | 0 | no | no | no | no | unknown | no | no |
| binder-test-20260909-164008 | 2026-09-09 | binder | 0 | no | no | no | no | unknown | no | no |
| binder-test-20260910-072404 | 2026-09-10 | binder | 10 | no | no | no | no | unknown | no | no |
| binder-test-20260910-072458 | 2026-09-10 | binder | 9 | no | no | no | no | unknown | no | no |
| binder-test-20260910-083600 | 2026-09-10 | binder | 15 | no | no | no | no | unknown | no | no |
| binder-test-20260910-102715 | 2026-09-10 | binder | 25 | no | no | no | no | unknown | no | no |
| cq-20260908T120539 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-20260908T120629 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-20260908T120722 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-20260908T120751 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-20260908T120813 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-lizard-blade-french-20260908T115149 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| cq-lizard-blade-french-20260908T115203 | 2026-09-08 | capture-quality | 8 | yes | yes | yes | yes | unknown | no | no |
| deck-test-20260910-085502 | 2026-09-10 | deck | 78 | yes | yes | yes | yes | unknown | no | no |
| deck-test-20260910-101639 | 2026-09-10 | deck | 58 | yes | yes | no | yes | unknown | no | no |
| deck-test-20260910-105958 | 2026-09-10 | deck | 13 | no | yes | no | no | unknown | no | no |
| deck-test-20260910-112607 | 2026-09-10 | deck | 9 | no | yes | no | no | unknown | no | no |
| deck-test-20260910-115759 | 2026-09-10 | deck | 7 | no | yes | no | no | unknown | no | no |
| deck-test-20260910-134243 | 2026-09-10 | deck | 7 | no | yes | no | no | unknown | no | no |
| deck-test-20260910-140740 | 2026-09-10 | deck | 8 | no | yes | no | no | unknown | no | no |
| federica-veil-old-edition-20260908T105754 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| focus-series-20260908T124234 | 2026-09-08 | focus | 12 | yes | yes | yes | no | unknown | no | no |
| focus-series-20260908T124327 | 2026-09-08 | focus | 12 | yes | yes | yes | no | unknown | no | no |
| focus-series-20260908T124408 | 2026-09-08 | focus | 12 | yes | yes | yes | no | unknown | no | no |
| focus-series-20260908T124507 | 2026-09-08 | focus | 12 | yes | yes | yes | no | unknown | no | no |
| focus-series-20260908T132626 | 2026-09-08 | focus | 16 | yes | yes | yes | yes | unknown | no | no |
| focus-series-20260908T132712 | 2026-09-08 | focus | 16 | yes | yes | yes | yes | unknown | no | no |
| focus-series-20260908T132801 | 2026-09-08 | focus | 16 | yes | yes | yes | yes | unknown | no | no |
| focus-series-20260908T132852 | 2026-09-08 | focus | 16 | yes | yes | yes | yes | unknown | no | no |
| focus-series-20260908T133053 | 2026-09-08 | focus | 16 | yes | yes | yes | yes | unknown | no | no |
| geometry-probe-ok |  | geometry | 1 | yes | no | no | no | unknown | no | no |
| geometry-test-20260910-144626 | 2026-09-10 | geometry | 9 | no | yes | no | no | unknown | no | no |
| geometry-test-20260910-150106 | 2026-09-10 | geometry | 8 | no | yes | no | no | unknown | no | no |
| geometry-test-20260910-151042 | 2026-09-10 | geometry | 28 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-153114 | 2026-09-10 | geometry | 26 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-154646 | 2026-09-10 | geometry | 26 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-155241 | 2026-09-10 | geometry | 20 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-162108 | 2026-09-10 | geometry | 30 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-164005 | 2026-09-10 | geometry | 20 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-165339 | 2026-09-10 | geometry | 20 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-173530 | 2026-09-10 | geometry | 20 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260910-192617 | 2026-09-10 | geometry | 16 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260911-085827 | 2026-09-11 | geometry | 12 | yes | yes | no | no | unknown | no | no |
| geometry-test-20260911-100459 | 2026-09-11 | geometry | 8 | yes | yes | no | no | unknown | no | no |
| lames-l-zard-french-20260908T105353 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| livaan-cultist-of-tiamat-foil-20260908T111916 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | yes |
| livaan-foil-20260908T105241 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| lizard-blades-french-20260908T111833 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | yes |
| maddening-hex-alt-art-20260908T082448 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| negate-20260908T082630 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| negate-unsleeved-20260908T082746 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| normal-scan-session-20260911-103026 | 2026-09-11 | single-card | 13 | no | yes | no | no | unknown | no | no |
| normal-scan-session-20260911-111516 | 2026-09-11 | single-card | 36 | yes | yes | yes | no | unknown | yes | yes |
| normal-scan-session-20260911-113049 | 2026-09-11 | single-card | 30 | yes | yes | yes | no | unknown | yes | yes |
| normal-scan-session-20260911-120703 | 2026-09-11 | single-card | 18 | yes | yes | yes | no | unknown | yes | yes |
| p-e-d-tre-et-de-foyer-french-goo-20260908T082303 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| real-photos |  | real-photo | 1 | no | no | no | no | explicit | no | no |
| rep-1788964503038-9eu847 |  | phone-trace | 2 | no | no | no | yes | unknown | no | no |
| replay:basilisk-collar-20260908T111744 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:livaan-cultist-of-tiamat-foil-20260908T111916 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:lizard-blades-french-20260908T111833 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:maddening-hex-alt-art-20260908T082448 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:negate-20260908T082630 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:negate-unsleeved-20260908T082746 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:p-e-d-tre-et-de-foyer-french-goo-20260908T082303 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:slip-out-the-back-italian-20260908T111643 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:teferi-veil-old-edition-good-cap-20260908T111548 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| replay:wand-of-wonder-20260908T073958 | 2026-09-08 | replay | 3 | yes | yes | yes | no | explicit | yes | yes |
| scan-real |  | real-photo | 1 | no | no | no | no | explicit | no | no |
| slip-out-the-back-italian-20260908T111643 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | yes |
| svignarsela-dal-retro-italian-20260908T105635 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| swap-test-20260908-171149 | 2026-09-08 | swap | 10 | yes | yes | no | no | unknown | no | no |
| swap-test-20260908-171306 | 2026-09-08 | swap | 10 | yes | yes | no | no | unknown | no | no |
| teferi-veil-old-edition-20260908T111452 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| teferi-veil-old-edition-good-cap-20260908T111548 | 2026-09-08 | phone-trace | 4 | yes | yes | yes | yes | unknown | no | no |
| trace-0053 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0054 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0055 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0056 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0057 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0058 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0059 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0060 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0061 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0062 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0063 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0064 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0065 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0066 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0067 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0068 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0069 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0070 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0071 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0072 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0073 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0074 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0075 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0076 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0077 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0078 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0079 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0080 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0081 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0082 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0083 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0084 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0085 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0086 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0087 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0088 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0089 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0090 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0091 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0092 |  | phone-trace | 9 | no | yes | yes | no | unknown | no | no |
| trace-0093 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0094 |  | phone-trace | 12 | no | yes | yes | yes | unknown | no | no |
| trace-0095 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0096 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0097 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0098 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0099 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0100 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0101 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0102 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0103 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0104 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0105 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0106 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0107 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0108 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0109 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0110 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0111 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0112 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0113 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0114 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0115 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0116 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0117 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0118 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0119 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0120 |  | phone-trace | 11 | no | yes | yes | no | unknown | no | no |
| trace-0121 |  | phone-trace | 14 | no | yes | yes | yes | unknown | no | no |
| trace-0122 |  | phone-trace | 14 | no | yes | yes | yes | unknown | no | no |
| trace-0123 |  | phone-trace | 13 | no | yes | yes | yes | unknown | no | no |
| trace-0124 |  | phone-trace | 14 | no | yes | yes | no | unknown | no | no |
| trace-0125 |  | phone-trace | 14 | no | yes | yes | no | unknown | no | no |
| trace-0126 |  | phone-trace | 14 | no | yes | yes | no | unknown | no | no |
| trace-0127 |  | phone-trace | 17 | no | yes | yes | yes | unknown | no | no |
| trace-0128 |  | phone-trace | 16 | no | yes | yes | yes | unknown | no | no |
| trace-0129 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0130 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0131 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0132 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0133 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0134 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0135 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0136 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0137 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0138 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0139 |  | phone-trace | 1 | no | yes | no | no | unknown | no | no |
| trace-0140 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0141 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0142 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0143 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0144 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0145 |  | phone-trace | 2 | no | no | no | yes | unknown | no | no |
| trace-0146 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0147 |  | phone-trace | 2 | no | no | no | yes | unknown | no | no |
| trace-0148 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0149 |  | phone-trace | 2 | no | no | no | yes | unknown | no | no |
| trace-0150 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0151 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0152 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0153 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0154 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0155 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0156 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0157 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0158 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0159 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0160 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0161 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0162 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0163 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0164 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0165 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0166 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0167 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0168 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0169 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0170 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0171 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0172 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0173 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0174 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0175 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0176 |  | phone-trace | 3 | no | no | no | yes | unknown | no | no |
| trace-0177 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0178 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0179 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0180 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0181 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0182 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0183 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0184 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0185 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0186 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0187 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0188 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0189 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0190 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0191 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0192 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0193 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0194 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| trace-0195 |  | phone-trace | 3 | no | yes | yes | no | unknown | no | no |
| wand-of-wonder-20260908T073843 | 2026-09-08 | phone-trace | 6 | yes | yes | yes | yes | unknown | no | no |
| wand-of-wonder-20260908T073958 | 2026-09-08 | phone-trace | 6 | yes | yes | yes | yes | unknown | no | no |
| wand-of-wonder-20260908T081951 | 2026-09-08 | phone-trace | 2 | yes | no | no | yes | unknown | no | yes |

Identity is explicit only for a fixture label. A scanner prediction is not a label.


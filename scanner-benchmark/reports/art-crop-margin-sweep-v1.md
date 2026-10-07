# ART CROP MARGIN SWEEP V1

Frozen eval stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`. Git `9c89f6f`.

The first published run of this sweep is superseded. It warped manual polygons in stored click order. Four art boxes were about 90° from the parent card, and the showcase-glare box was mirrored top-to-bottom, so those recognition crops were not upright. This run orders every art box into the parent card's canonical TL → TR → BR → BL before scaling and warping. The corner coordinates are the same points. Stored fixture files were not rewritten; ordering happens when a crop is built, and again when Geometry Lab saves.

The human art box is the geometric artwork window. These crops expand or shrink that window in canonical card coordinates, then warp with the same bilinear `warpQuadToCard` used by the ceiling. Nothing was trained on these 46 frames.

## ORIENTATION

Already canonical: 41. Reordered: 5.

| Stored order | Count |
| --- | ---: |
| 0° | 41 |
| 90° | 4 |
| 180° | 0 |
| 270° | 0 |
| mirrored | 1 |

- Livaan, Cultist of Tiamat [.scan-fixtures/replay/livaan-cultist-of-tiamat-foil-20260908T111916/source-highres.png]: 90° (stored TL→TR 96.8° in card space)
- Lizard Blades [.scan-fixtures/replay/lizard-blades-french-20260908T111833/source-highres.png]: 90° (stored TL→TR 91.0° in card space)
- Maddening Hex [.scan-fixtures/replay/maddening-hex-alt-art-20260908T082448/source-highres.png]: 90° (stored TL→TR 89.9° in card space)
- Maddening Hex [.scan-fixtures/real-photos/maddening-hex-afc-showcase-glare.png]: mirrored (stored TL→TR 2.2° in card space)
- Goblin Lookout [.scan-inbox/sessions/normal-scan-session-20260911-113049--card-006/source-highres/source-highres.png]: 90° (stored TL→TR 89.0° in card space)

Auto-anchor art boxes are built by `boundaryQuad` on the already-upright card warp: TL is the card-space top-left, then TR, BR, BL. `canonicalQuadToSource` carries those labels into the photo. Click order never enters that path.

## TURNED POLYGONS, BEFORE → AFTER

Before is the superseded click-order run. After is this card-oriented run. Ranks are the expected card.

- Livaan, Cultist of Tiamat [.scan-fixtures/replay/livaan-cultist-of-tiamat-foil-20260908T111916/source-highres.png]
  - before: -10% 61, -5% 22, 0% 508, +3% 230, +5% 387, +8% 39, +12% 22
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 1, +12% 1
- Lizard Blades [.scan-fixtures/replay/lizard-blades-french-20260908T111833/source-highres.png]
  - before: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 1, +12% 1
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 1, +12% 1
- Maddening Hex [.scan-fixtures/replay/maddening-hex-alt-art-20260908T082448/source-highres.png]
  - before: -10% 3, -5% 77, 0% 19, +3% 4, +5% 2, +8% 1, +12% 1
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 1, +12% 1
- Maddening Hex [.scan-fixtures/real-photos/maddening-hex-afc-showcase-glare.png]
  - before: -10% 29, -5% 101, 0% 6, +3% 4, +5% 4, +8% 59, +12% 11
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 7, +12% 1
- Goblin Lookout [.scan-inbox/sessions/normal-scan-session-20260911-113049--card-006/source-highres/source-highres.png]
  - before: -10% 3241, -5% 3204, 0% 2969, +3% 2093, +5% 1232, +8% 995, +12% 827
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 1, +12% 1

## OTHER PREVIOUS REGRESSIONS

- Sword of Hearth and Home [.scan-fixtures/replay/p-e-d-tre-et-de-foyer-french-goo-20260908T082303/source-highres.png]
  - before: -10% 1, -5% 1, 0% 2, +3% 1, +5% 2, +8% 1, +12% 1
  - after: -10% 1, -5% 1, 0% 2, +3% 1, +5% 2, +8% 1, +12% 1
- Maddening Hex [.scan-fixtures/real-photos/maddening-hex-afc-showcase-glare.png]
  - before: -10% 29, -5% 101, 0% 6, +3% 4, +5% 4, +8% 59, +12% 11
  - after: -10% 1, -5% 1, 0% 1, +3% 1, +5% 1, +8% 7, +12% 1
- Teferi's Veil [.scan-inbox/sessions/phone-20260908/cq-20260908T120722/photo-source.png]
  - before: -10% 31525, -5% 31355, 0% 1, +3% 31284, +5% 26053, +8% 26053, +12% 26053
  - after: -10% 31525, -5% 31355, 0% 1, +3% 31284, +5% 26053, +8% 26053, +12% 26053
- Wand of Wonder [.scan-inbox/sessions/phone-20260908/focus-series-20260908T132626/t000-source.png]
  - before: -10% 647, -5% 820, 0% 1, +3% 76, +5% 654, +8% 1303, +12% 721
  - after: -10% 647, -5% 820, 0% 1, +3% 76, +5% 654, +8% 1303, +12% 721

## VERSIONS

- CLIP: `Xenova/clip-vit-base-patch32@q1`
- Adapter: `b0e10ffe2c9c5e387049a407d7ef4a389541422e4efc1f6097543bb057f2971c`
- B1 gallery: `CLIP_VIT_B32_B1_ART` `be0a66141de71f38fb60bae715fa0b40c70d2bc04ca200ddcffbfcd802980f8b` (49968 arts)
- Eval: stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`

## CROPS

| Crop | Top1 | Top3 | Top5 | Top10 | Wrong-confident |
| --- | ---: | ---: | ---: | ---: | ---: |
| current | 32/46 | 35/46 | 36/46 | 37/46 | 2/46 |
| auto_anchor | 35/46 | 35/46 | 35/46 | 35/46 | 2/46 |
| manual -10% | 31/46 | 35/46 | 37/46 | 41/46 | 1/46 |
| manual -5% | 37/46 | 39/46 | 39/46 | 39/46 | 0/46 |
| manual 0% | 37/46 | 41/46 | 42/46 | 42/46 | 0/46 |
| manual +3% | 39/46 | 39/46 | 40/46 | 41/46 | 1/46 |
| manual +5% | 36/46 | 39/46 | 40/46 | 41/46 | 1/46 |
| manual +8% | 34/46 | 37/46 | 39/46 | 40/46 | 1/46 |
| manual +12% | 32/46 | 37/46 | 39/46 | 40/46 | 1/46 |

## PAIRED VERSUS CURRENT

- auto_anchor: wrong→correct 4, correct→wrong 1, unchanged correct 31, unchanged wrong 10
- manual -10%: wrong→correct 5, correct→wrong 6, unchanged correct 26, unchanged wrong 9
- manual -5%: wrong→correct 8, correct→wrong 3, unchanged correct 29, unchanged wrong 6
- manual 0%: wrong→correct 6, correct→wrong 1, unchanged correct 31, unchanged wrong 8
- manual +3%: wrong→correct 9, correct→wrong 2, unchanged correct 30, unchanged wrong 5
- manual +5%: wrong→correct 7, correct→wrong 3, unchanged correct 29, unchanged wrong 7
- manual +8%: wrong→correct 5, correct→wrong 3, unchanged correct 29, unchanged wrong 9
- manual +12%: wrong→correct 8, correct→wrong 8, unchanged correct 24, unchanged wrong 6

## BEST MARGIN PER FRAME

Each frame's best margin is a Top1 hit, then the lowest expected-card rank, then the highest expected-card similarity.

- tighter than the art box: 22
- exact art box: 11
- padded beyond the art box: 13

Histogram: manual_-10 8, manual_-5 14, manual_0 11, manual_+3 8, manual_+5 5, manual_+8 0, manual_+12 0

## GROUP A — EXACT ART FIXED THE CURRENT MISS

- Wand of Wonder [.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png]: current rank 3679 (Who), exact art rank 1 (Wand of Wonder), best manual_-10 rank 1 (Wand of Wonder)
- Livaan, Cultist of Tiamat [.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png]: current rank 138 (Temple Garden), exact art rank 1 (Livaan, Cultist of Tiamat), best manual_-5 rank 1 (Livaan, Cultist of Tiamat)
- Bulk Up [.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png]: current rank 662 (Cauldron Familiar), exact art rank 1 (Bulk Up), best manual_-10 rank 1 (Bulk Up)
- Havi, the All-Father [.scan-inbox/sessions/geometry-test-20260911-085827/geom-001-source/geom-001-source.png]: current rank 3 (Minions), exact art rank 1 (Havi, the All-Father), best manual_+3 rank 1 (Havi, the All-Father)
- Mudbutton Torchrunner [.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png]: current rank 1698 (That's No Moonmist), exact art rank 1 (Mudbutton Torchrunner), best manual_-5 rank 1 (Mudbutton Torchrunner)
- Octopus Form [.scan-inbox/sessions/phone-20260908/swap-test-20260908-171149/swap-03-source.png]: current rank 2 (Specimen Freighter), exact art rank 1 (Octopus Form), best manual_0 rank 1 (Octopus Form)

## GROUP B — FRAMES THAT LOST A CURRENT HIT UNDER CLICK-ORDER EXACT ART

- Livaan, Cultist of Tiamat [.scan-fixtures/replay/livaan-cultist-of-tiamat-foil-20260908T111916/source-highres.png]: current rank 1 (Livaan, Cultist of Tiamat), exact art rank 1 (Livaan, Cultist of Tiamat), best manual_0 rank 1 (Livaan, Cultist of Tiamat)
- Maddening Hex [.scan-fixtures/replay/maddening-hex-alt-art-20260908T082448/source-highres.png]: current rank 1 (Maddening Hex), exact art rank 1 (Maddening Hex), best manual_-5 rank 1 (Maddening Hex)
- Sword of Hearth and Home [.scan-fixtures/replay/p-e-d-tre-et-de-foyer-french-goo-20260908T082303/source-highres.png]: current rank 1 (Sword of Hearth and Home), exact art rank 2 (Immolating Glare), best manual_-10 rank 1 (Sword of Hearth and Home)
- Maddening Hex [.scan-fixtures/real-photos/maddening-hex-afc-showcase-glare.png]: current rank 1 (Maddening Hex), exact art rank 1 (Maddening Hex), best manual_-10 rank 1 (Maddening Hex)
- Goblin Lookout [.scan-inbox/sessions/normal-scan-session-20260911-113049--card-006/source-highres/source-highres.png]: current rank 1 (Goblin Lookout), exact art rank 1 (Goblin Lookout), best manual_-10 rank 1 (Goblin Lookout)

## CONDITIONS

A frame can appear in more than one row. Labels come from the fixture family, existing tags, and the confirmed card name. Unknown family is not called modern.

- foil (n=6): best manual_-5 at 4/6. manual -10% 3/6, manual -5% 4/6, manual 0% 4/6, manual +3% 3/6, manual +5% 3/6, manual +8% 3/6, manual +12% 4/6
- non-english (n=5): best manual_-10 at 4/5. manual -10% 4/5, manual -5% 4/5, manual 0% 3/5, manual +3% 4/5, manual +5% 3/5, manual +8% 4/5, manual +12% 4/5
- modern_standard (n=1): best manual_-10 at 1/1. manual -10% 1/1, manual -5% 1/1, manual 0% 1/1, manual +3% 1/1, manual +5% 1/1, manual +8% 1/1, manual +12% 1/1
- old/retro (n=3): best manual_0 at 3/3. manual -10% 2/3, manual -5% 2/3, manual 0% 3/3, manual +3% 2/3, manual +5% 2/3, manual +8% 2/3, manual +12% 2/3
- glare (n=1): best manual_-10 at 1/1. manual -10% 1/1, manual -5% 1/1, manual 0% 1/1, manual +3% 1/1, manual +5% 1/1, manual +8% 0/1, manual +12% 1/1
- basic land (n=5): best manual_+3 at 4/5. manual -10% 2/5, manual -5% 3/5, manual 0% 1/5, manual +3% 4/5, manual +5% 3/5, manual +8% 2/5, manual +12% 3/5
- showcase (n=2): best manual_-5 at 1/2. manual -10% 0/2, manual -5% 1/2, manual 0% 0/2, manual +3% 1/2, manual +5% 0/2, manual +8% 0/2, manual +12% 0/2
- borderless (n=3): best manual_-5 at 3/3. manual -10% 2/3, manual -5% 3/3, manual 0% 3/3, manual +3% 3/3, manual +5% 3/3, manual +8% 2/3, manual +12% 3/3

## VERDICT

**CONTEXT_CROP_WIN**

manual_+3 reaches 39 Top1 versus current 32 and exact art 37, with 9 wrong→correct and 2 correct→wrong.

auto_anchor is 35/46 Top1, with 4 wrong→correct and 1 correct→wrong.

## PRODUCTION

CLIP, the B1 adapter, the gallery, the 46-frame eval set, OCR, fusion, the detector, and Android were not changed.


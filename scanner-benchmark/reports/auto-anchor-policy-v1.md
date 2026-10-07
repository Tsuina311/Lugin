# AUTO ANCHOR POLICY V1

Frozen eval stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`. Git `9c89f6f`.

Current, automatic exact, and human +3% ranks are the corrected margin sweep. The new crop is the automatic art box expanded +3% in the detector card's canonical coordinates, with the same scale used for the human margin sweep. Human polygons are a ceiling. They do not choose a crop. No policy sees the card identity.

P4 is skipped. The detector's `artBox.confidence` is the minimum of four uncalibrated edge scores, and boxes below 0.2 are already discarded. That score has not been calibrated against identity, so a further threshold would be a new gate.

## VERSIONS

- CLIP: `Xenova/clip-vit-base-patch32@q1`
- Adapter: `b0e10ffe2c9c5e387049a407d7ef4a389541422e4efc1f6097543bb057f2971c`
- B1 gallery: `CLIP_VIT_B32_B1_ART` `be0a66141de71f38fb60bae715fa0b40c70d2bc04ca200ddcffbfcd802980f8b` (49968 arts)
- Eval: stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`

## POLICIES

| Policy | Coverage | Top1 | Top3 | Top5 | Top10 | Wrong-confident |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current | 46/46 | 32/46 | 35/46 | 36/46 | 37/46 | 2/46 |
| auto exact | 40/46 | 35/46 | 35/46 | 35/46 | 35/46 | 2/46 |
| auto +3% | 40/46 | 35/46 | 35/46 | 35/46 | 35/46 | 0/46 |
| auto +3% → current fallback | 46/46 | 36/46 | 36/46 | 36/46 | 36/46 | 1/46 |

Pure auto policies leave a frame unranked when the anchor is missing. Those frames count against Top1. The fallback policy ranks every frame.

## PAIRED VERSUS CURRENT

- auto exact: wrong→correct 4, correct→wrong 1, unchanged correct 31, unchanged wrong 10
  - fixes: The Spear of Leonidas | geom-007-source/geom-007-source.png; Havi, the All-Father | geom-001-source/geom-001-source.png; Octopus Form | swap-test-20260908-171149/swap-03-source.png; Island | swap-test-20260908-171306/swap-03-source.png
  - regressions: Negate | negate-20260908T082630/source-highres.png
- auto +3%: wrong→correct 4, correct→wrong 1, unchanged correct 31, unchanged wrong 10
  - fixes: The Spear of Leonidas | geom-007-source/geom-007-source.png; Havi, the All-Father | geom-001-source/geom-001-source.png; Octopus Form | swap-test-20260908-171149/swap-03-source.png; Island | swap-test-20260908-171306/swap-03-source.png
  - regressions: Negate | negate-20260908T082630/source-highres.png
- auto +3% → current fallback: wrong→correct 4, correct→wrong 0, unchanged correct 32, unchanged wrong 10
  - fixes: The Spear of Leonidas | geom-007-source/geom-007-source.png; Havi, the All-Father | geom-001-source/geom-001-source.png; Octopus Form | swap-test-20260908-171149/swap-03-source.png; Island | swap-test-20260908-171306/swap-03-source.png

## NO ANCHOR

These frames have no automatic art box. The fallback keeps the current production crop. They are not turned into recognition misses.

- Negate [.scan-fixtures/replay/negate-20260908T082630/source-highres.png]: current rank 1 (Negate), current correct. Fallback uses current.
- Island [.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png]: current rank 36 (Double-Faced Substitute Card), current wrong. Fallback uses current.
- Wand of Wonder [.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png]: current rank 3679 (Who), current wrong. Fallback uses current.
- Livaan, Cultist of Tiamat [.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png]: current rank 138 (Temple Garden), current wrong. Fallback uses current.
- Bulk Up [.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png]: current rank 662 (Cauldron Familiar), current wrong. Fallback uses current.
- Mudbutton Torchrunner [.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png]: current rank 1698 (That's No Moonmist), current wrong. Fallback uses current.

## HUMAN +3% FIXES RECOVERED

The corrected human +3% crop fixes 9 current misses. Automatic policies recover:

- auto exact: 4/9
- auto +3%: 4/9
- auto +3% → current fallback: 4/9

- Island | cq-20260908T120629/photo-source.png: auto exact no, auto +3% no, fallback no
- Wand of Wonder | cq-20260908T120751/photo-source.png: auto exact no, auto +3% no, fallback no
- The Spear of Leonidas | geom-007-source/geom-007-source.png: auto exact yes, auto +3% yes, fallback yes
- Bulk Up | geom-001-source/geom-001-source.png: auto exact no, auto +3% no, fallback no
- Island | geom-001-source/geom-001-source.png: auto exact no, auto +3% no, fallback no
- Havi, the All-Father | geom-001-source/geom-001-source.png: auto exact yes, auto +3% yes, fallback yes
- Mudbutton Torchrunner | geom-003-source/geom-003-source.png: auto exact no, auto +3% no, fallback no
- Octopus Form | swap-test-20260908-171149/swap-03-source.png: auto exact yes, auto +3% yes, fallback yes
- Island | swap-test-20260908-171306/swap-03-source.png: auto exact yes, auto +3% yes, fallback yes

## HUMAN +3% HIT, AUTO +3% MISS

- Negate [.scan-fixtures/replay/negate-20260908T082630/source-highres.png]: anchor no, IoU —, corner error — px, auto +3% rank NO_ANCHOR, human +3% rank 1. NO_ANCHOR
- Island [.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png]: anchor no, IoU —, corner error — px, auto +3% rank NO_ANCHOR, human +3% rank 1. NO_ANCHOR
- Wand of Wonder [.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png]: anchor no, IoU —, corner error — px, auto +3% rank NO_ANCHOR, human +3% rank 1. NO_ANCHOR
- Bulk Up [.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png]: anchor no, IoU —, corner error — px, auto +3% rank NO_ANCHOR, human +3% rank 1. NO_ANCHOR
- Island [.scan-inbox/sessions/geometry-test-20260910-165339/geom-001-source/geom-001-source.png]: anchor yes, IoU 0.536, corner error 175.4 px, auto +3% rank 19, human +3% rank 1. BAD_BOUNDARY
- Mudbutton Torchrunner [.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png]: anchor no, IoU —, corner error — px, auto +3% rank NO_ANCHOR, human +3% rank 1. NO_ANCHOR

## IOU BUCKETS

Diagnostic only. Human IoU is not a production threshold.

| Auto/human IoU | n | auto +3% Top1 | fallback Top1 | human +3% Top1 |
| --- | ---: | ---: | ---: | ---: |
| no anchor | 6 | 0/6 | 1/6 | 5/6 |
| <0.75 | 8 | 4/8 | 4/8 | 4/8 |
| 0.75–0.90 | 5 | 5/5 | 5/5 | 5/5 |
| >=0.90 | 27 | 26/27 | 26/27 | 25/27 |

## VERDICT

**ANCHOR_COVERAGE_BOTTLENECK**

The fallback beats current (36 vs 32) but remains 3 Top1 short of human +3%. Of the human hits it misses, 4 have no anchor and 1 has a weak boundary.

Best practical policy: `auto3_current_fallback`. Distance to the human +3% ceiling: 3 Top1.

## PRODUCTION

CLIP, the B1 adapter, the gallery, the 46-frame eval set, detector thresholds, OCR, fusion, and Android were not changed. The cascade is not wired into the scanner.


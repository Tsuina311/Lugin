# ART CROP CEILING V1

Frozen eval stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`. Git `9c89f6f`.

B1 is a frozen CLIP ViT-B/32 art embedding plus the linear adapter. The raw CLIP gallery was not modified.

## VERSIONS

- CLIP: `Xenova/clip-vit-base-patch32@q1`
- Adapter: `b0e10ffe2c9c5e387049a407d7ef4a389541422e4efc1f6097543bb057f2971c` (262656 params)
- B1 gallery: `CLIP_VIT_B32_B1_ART` `be0a66141de71f38fb60bae715fa0b40c70d2bc04ca200ddcffbfcd802980f8b` (49968 arts)
- Eval: stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`

## CROPS

Current is the production path: detector quad, `warpQuadToCard`, `extractArtCropFromCard`.
Auto anchor is `detectFrameRegions` on that same warped card. A missing art box is a failure and stays in the denominator.
Manual ground truth is a human-reviewed `artBox` (`auto-accepted`, `auto-edited`, or `manual`, with `reviewed: true`) in source pixels. An untouched automatic proposal is not ground truth.
Every available polygon is rectified with `warpQuadToCard` to the current crop’s width and height, then encoded with `scanImageToPngBytes(image, image.width)` and the same CLIP `embedPath`. No extra sharpen, contrast, or padding.

| Crop source | Top1 | Top3 | Top5 | Top10 | Wrong-confident |
| --- | ---: | ---: | ---: | ---: | ---: |
| current | 32/46 | 35/46 | 36/46 | 37/46 | 2/46 |
| auto_anchor | 35/46 | 35/46 | 35/46 | 35/46 | 2/46 |
| manual_gt | 33/46 | 37/46 | 38/46 | 39/46 | 0/46 |

Manual art boxes annotated: 46/46. Auto art-box failures: 6/46.

## PAIRED TRANSITIONS

CURRENT → AUTO_ANCHOR (n=46)
- wrong → correct: 4
- correct → wrong: 1
- unchanged correct: 31
- unchanged wrong: 10

CURRENT → MANUAL_GT (n=46)
- wrong → correct: 6
- correct → wrong: 5
- unchanged correct: 27
- unchanged wrong: 8

AUTO_ANCHOR → MANUAL_GT (n=46)
- wrong → correct: 5
- correct → wrong: 7
- unchanged correct: 28
- unchanged wrong: 6

CURRENT → MANUAL_GT cards
- wrong → correct: Wand of Wonder, Livaan, Cultist of Tiamat, Bulk Up, Havi, the All-Father, Mudbutton Torchrunner, Octopus Form
- correct → wrong: Livaan, Cultist of Tiamat, Maddening Hex, Sword of Hearth and Home, Maddening Hex, Goblin Lookout
- unchanged correct: 27
- unchanged wrong: Island, Livaan, Cultist of Tiamat, Excalibur, Sword of Eden, The Spear of Leonidas, Island, Blacksmith's Talent, Island, Island

AUTO_ANCHOR → MANUAL_GT cards
- wrong → correct: Negate, Wand of Wonder, Livaan, Cultist of Tiamat, Bulk Up, Mudbutton Torchrunner
- correct → wrong: Livaan, Cultist of Tiamat, Maddening Hex, Sword of Hearth and Home, Maddening Hex, The Spear of Leonidas, Goblin Lookout, Island
- unchanged correct: 28
- unchanged wrong: Island, Livaan, Cultist of Tiamat, Excalibur, Sword of Eden, Island, Blacksmith's Talent, Island

## AUTO ANCHOR VS HUMAN ART BOX

- auto artBox detection coverage: 40/46
- median IoU: 0.919
- p10 IoU: 0.536
- p25 IoU: 0.778
- median canonical corner error: 21.55 px
- p90 canonical corner error: 466.02 px
- auto boxes within IoU 0.90 of the human box: 26
- auto boxes missed or below IoU 0.75: 15
- annotation source auto-accepted / auto-edited / manual: 0 / 0 / 46
- auto detection failures: 6
  - Negate (.scan-fixtures/replay/negate-20260908T082630/source-highres.png)
  - Island (.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png)
  - Wand of Wonder (.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png)
  - Livaan, Cultist of Tiamat (.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png)
  - Bulk Up (.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png)
  - Mudbutton Torchrunner (.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png)

**AUTO_ANCHOR_PROMISING**

Coverage 40/46, median IoU 0.919, IoU≥0.9 26, IoU<0.75 or missed 15.

## FAILURES STILL WRONG UNDER B1 CURRENT CROP

- UNKNOWN: 6
- BAD_ART_CROP: 6
- GLARE_OR_FOIL: 2

- Island [.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png]: current rank 36, auto rank none, manual rank 2, fixed no, current top1 Double-Faced Substitute Card, manual top1 Plains, class UNKNOWN (auto art box not detected)
- Wand of Wonder [.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png]: current rank 3679, auto rank none, manual rank 1, fixed yes, current top1 Who, manual top1 Wand of Wonder, class BAD_ART_CROP (auto art box not detected)
- Livaan, Cultist of Tiamat [.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png]: current rank 138, auto rank none, manual rank 1, fixed yes, current top1 Temple Garden, manual top1 Livaan, Cultist of Tiamat, class BAD_ART_CROP (auto art box not detected)
- Livaan, Cultist of Tiamat [.scan-inbox/sessions/phone-20260908/focus-series-20260908T124234/t500-source.png]: current rank 48, auto rank 44, manual rank 50, fixed no, current top1 Nevermind, manual top1 Dark Ritual, class GLARE_OR_FOIL
- Excalibur, Sword of Eden [.scan-inbox/sessions/phone-20260908/focus-series-20260908T132801/t500-source.png]: current rank 403, auto rank 156, manual rank 65, fixed no, current top1 Return to Nature, manual top1 Sanctify, class GLARE_OR_FOIL
- The Spear of Leonidas [.scan-inbox/sessions/geometry-test-20260910-153114/geom-007-source/geom-007-source.png]: current rank 2, auto rank 1, manual rank 2, fixed no, current top1 Engulfing Eruption, manual top1 The Black Arrow, class UNKNOWN
- Island [.scan-inbox/sessions/geometry-test-20260910-154646/geom-007-source/geom-007-source.png]: current rank 510, auto rank 52, manual rank 5, fixed no, current top1 Double-Faced Substitute Card, manual top1 Dreadship Reef, class UNKNOWN
- Blacksmith's Talent [.scan-inbox/sessions/geometry-test-20260910-155241/geom-006-source/geom-006-source.png]: current rank 3867, auto rank 1731, manual rank 1443, fixed no, current top1 Royal, manual top1 Road, class UNKNOWN
- Bulk Up [.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png]: current rank 662, auto rank none, manual rank 1, fixed yes, current top1 Cauldron Familiar, manual top1 Bulk Up, class BAD_ART_CROP (auto art box not detected)
- Island [.scan-inbox/sessions/geometry-test-20260910-165339/geom-001-source/geom-001-source.png]: current rank 8, auto rank 42, manual rank 12, fixed no, current top1 Riverglide Pathway, manual top1 Sunset Revelry, class UNKNOWN
- Havi, the All-Father [.scan-inbox/sessions/geometry-test-20260911-085827/geom-001-source/geom-001-source.png]: current rank 3, auto rank 1, manual rank 1, fixed yes, current top1 Minions, manual top1 Havi, the All-Father, class BAD_ART_CROP
- Mudbutton Torchrunner [.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png]: current rank 1698, auto rank none, manual rank 1, fixed yes, current top1 That's No Moonmist, manual top1 Mudbutton Torchrunner, class BAD_ART_CROP (auto art box not detected)
- Octopus Form [.scan-inbox/sessions/phone-20260908/swap-test-20260908-171149/swap-03-source.png]: current rank 2, auto rank 1, manual rank 1, fixed yes, current top1 Specimen Freighter, manual top1 Octopus Form, class BAD_ART_CROP
- Island [.scan-inbox/sessions/phone-20260908/swap-test-20260908-171306/swap-03-source.png]: current rank 4, auto rank 1, manual rank 2, fixed no, current top1 Mountain, manual top1 Plains, class UNKNOWN

## QUESTIONS

- Manual GT changes Top1 from 32/46 to 33/46 (+1).
- Top3 moves from 35/46 to 37/46. Top5 moves from 36/46 to 38/46.
- Of 14 current misses, 6 become correct under the human art box and are classed BAD_ART_CROP.
- 13 frames stay wrong with the human art box.
- Current-correct → manual-wrong: 5.
- Auto-anchor Top1 is 35/46 and manual GT Top1 is 33/46. Auto → manual wrong→correct 5, correct→wrong 7.
- Auto-anchor’s main weakness is coverage: missed art boxes, more than the boxes it does place.
- Where auto and manual name the same top1, median IoU is 0.921. Where they disagree, median IoU is 0.631. Agreement is 25/30 at IoU≥0.85 and 4/10 below that.
- Remaining current misses that the human box does not fix stay UNKNOWN unless the frame is tagged glare, foil, or a bad capture. That is not evidence for a CLIP fine-tune. UNKNOWN count: 6.

## VERDICT

**REPRESENTATION_BOTTLENECK_DOMINANT**

Manual art geometry moved Top1 from 32/46 to 33/46.

The automatic-anchor rating above is separate from this bottleneck verdict.

## NEXT

Frame anchors are not the identity bottleneck. The next measurement is a harder adapter or a different encoder, not a CLIP fine-tune until that measurement says so.

## PRODUCTION

Scanner, detector thresholds, OCR, fusion, Android, EAS, and OTA were not changed. CLIP was not fine-tuned. These 46 frames were not used as training data.


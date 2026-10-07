# MTG EMBEDDING BAKEOFF V1

Frozen eval stills-v1 `c9470c26eebd80e257f577fa09aae7a5c82cf3dc9fdd8b047922bcf40c182d27`.
Git `9c89f6f`. Date 2026-10-05T16:22:05.843Z.

Phone frames are the decision set. Synthetic stress is diagnostic. Visual scores only.

## DATA

- Confirmed phone frames scored: 46
- Detector misses: 0
- Train oracles: 1333
- Dev oracles: 428
- Stress oracles: 200
- Pinned canonical cards in train: Wand of Wonder, Sword of Hearth and Home, Livaan, Cultist of Tiamat, Basilisk Collar
- Art gallery refs: 49968
- Full-card gallery refs: 34082

## TRAINING

Canonical Scryfall art crops already cached for the CLIP gallery. Training views are randomized crop error, perspective, blur, glare, sleeve, exposure, noise, JPEG, and background. Positives are the frozen CLIP vectors of the clean canonical image. Negatives are in-batch cards plus eight nearest incorrect gallery cards, mined once from raw CLIP and once more after the first adapter round. Train, dev, and stress oracles are disjoint. The Samsung stills were not used as training or augmentation sources. Dual weights, when run, were chosen on synthetic dev only.

## MODELS

| Model | Params | Size |
| --- | ---: | ---: |
| A current CLIP art | 0 | 0.00 MB |
| B1 art linear | 262656 | 1.05 MB |
| B2 art MLP | 262912 | 1.05 MB |
| C1 full linear | 262656 | 1.05 MB |
| C2 full MLP | 262912 | 1.05 MB |
| D1 dual | 525312 | 2.10 MB |

Each adapter is about 1.0 MB of float32 and one 512-wide GEMM, well under a millisecond after the embedding exists. It can later be a MatMul + Add + L2 normalize in the existing ONNX Runtime stack. The cost that remains is frozen CLIP ViT-B/32, about 85 MB quantized and about 100 ms per image on this host CPU. Android integration was not added.

## PHONE RESULTS

| Model | Top1 | Top3 | Top5 | Top10 | Wrong-confident |
| --- | ---: | ---: | ---: | ---: | ---: |
| A current CLIP art | 23/46 | 25/46 | 27/46 | 30/46 | 1/46 |
| B1 art linear | 32/46 | 35/46 | 36/46 | 37/46 | 2/46 |
| B2 art MLP | 31/46 | 34/46 | 35/46 | 36/46 | 4/46 |
| C1 full linear | 20/46 | 24/46 | 25/46 | 27/46 | 2/46 |
| C2 full MLP | 19/46 | 21/46 | 22/46 | 26/46 | 3/46 |
| D1 dual w=0.65 (B1+C1) | 34/46 | 36/46 | 36/46 | 37/46 | 2/46 |

## WATCHED CARDS

Ranks are for D1. The recommended art adapter, B1, also takes Basilisk Collar, Sword of Hearth and Home, and the replay Wand of Wonder from a miss to Top1. Livaan on the replay frame stays Top1.

### Basilisk Collar

- rank 5 → 1 on `basilisk-collar-20260908T111744/source-highres.png`
  - current top1 The Ur-Dragon
  - new top1 Basilisk Collar

### Sword of Hearth and Home

- rank 6 → 1 on `p-e-d-tre-et-de-foyer-french-goo-20260908T082303/source-highres.png`
  - current top1 Immolating Glare
  - new top1 Sword of Hearth and Home

### Wand of Wonder

- rank 2 → 1 on `wand-of-wonder-20260908T073958/source-highres.png`
  - current top1 Slight Malfunction
  - new top1 Wand of Wonder
- rank 19535 → 614 on `cq-20260908T120751/photo-source.png`
  - current top1 Song of Eärendil
  - new top1 Who
- rank 5 → 1 on `focus-series-20260908T132626/t500-source.png`
  - current top1 Ball Lightning
  - new top1 Wand of Wonder
- rank 11 → 1 on `focus-series-20260908T132626/t000-source.png`
  - current top1 Ball Lightning
  - new top1 Wand of Wonder

### Livaan, Cultist of Tiamat

- rank 1 → 1 on `livaan-cultist-of-tiamat-foil-20260908T111916/source-highres.png`
  - current top1 Livaan, Cultist of Tiamat
  - new top1 Livaan, Cultist of Tiamat
- rank 3063 → 30 on `cq-20260908T120813/photo-source.png`
  - current top1 Awaken the Honored Dead
  - new top1 Saheeli, Filigree Master
- rank 552 → 2 on `focus-series-20260908T124234/t500-source.png`
  - current top1 Smelting Vat
  - new top1 Desert Were-Worm
- rank 1 → 1 on `focus-series-20260908T132712/t800-source.png`
  - current top1 Livaan, Cultist of Tiamat
  - new top1 Livaan, Cultist of Tiamat
- rank 1 → 1 on `livaan-foil-20260908T105241/source-highres.png`
  - current top1 Livaan, Cultist of Tiamat
  - new top1 Livaan, Cultist of Tiamat

## RECOVERIES AND REGRESSIONS

Recovered to Top1: Basilisk Collar, Negate, Sword of Hearth and Home, Wand of Wonder, Wand of Wonder, Wand of Wonder, Excalibur, Sword of Eden, The Spear of Leonidas, Havi, the All-Father, Goblin Blastronauts, Octopus Form
Regressions off Top1: none

## STRESS

Held-out canonical cards. Clean is a fresh CLIP embed of the original file. Other rows are rendered corruptions. This table does not decide the verdict.

| Condition | A | B1 | B2 | C1 | C2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 198/200 | 198/200 | 198/200 | 200/200 | 200/200 |
| crop ±3% | 357/400 | 384/400 | 382/400 | 323/400 | 317/400 |
| crop ±5% | 354/400 | 385/400 | 385/400 | 322/400 | 316/400 |
| crop ±10% | 337/400 | 383/400 | 379/400 | 319/400 | 299/400 |
| perspective | 166/200 | 191/200 | 188/200 | 150/200 | 140/200 |
| blur | 87/200 | 164/200 | 163/200 | 73/200 | 69/200 |
| motion blur | 15/200 | 57/200 | 55/200 | 8/200 | 15/200 |
| glare | 181/200 | 188/200 | 191/200 | 163/200 | 155/200 |
| dark | 149/200 | 177/200 | 175/200 | 153/200 | 141/200 |
| partial edge | 166/200 | 193/200 | 189/200 | 165/200 | 154/200 |
| background | 138/200 | 183/200 | 173/200 | 105/200 | 96/200 |

## VERDICT

**ADAPTER_STRONG_WIN**

B1, the art linear adapter, is 32/46 Top1 and 35/46 Top3 against current CLIP at 23/46 and 25/46. It recovers Basilisk Collar, Sword of Hearth and Home, and Wand of Wonder, with no Top1 regressions and wrong-confident 2/46 versus 1/46. Crop, blur, and glare stress all move up with it. Full-card adapters are worse on the phone set (20/46 and 19/46). Dual reaches 34/46, two frames above B1, and that is too small to change the decision.

## NEXT

Keep the frozen CLIP encoder, deploy the B1 linear art adapter, and rebuild the canonical art gallery with it. Do not fine-tune the encoder yet.

## PRODUCTION

- scanner untouched
- detector untouched
- no threshold changes
- no fusion changes
- no OCR changes
- no EAS
- no OTA


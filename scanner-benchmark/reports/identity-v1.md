# PHONE IDENTITY V1

**PIPELINE / EARLY MODEL.** CLIP is frozen. Android was not changed.

Recommendation: **RECOGNITION_ADAPTER_STRONG_WIN**

Known frames 116. Unique identities 73. Train 43 identities (70 photos), dev 12, frozen holdout 18 identities (26 photos). Unresolved frames 4.

## UNSEEN HOLDOUT, ORACLE GEOMETRY

| Model | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Median rank |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | 11/26 | 14/26 | 15/26 | 17/26 | 0/26 | 2 |
| linear | 16/26 | 18/26 | 18/26 | 19/26 | 0/26 | 1 |
| residual MLP | 14/26 | 14/26 | 15/26 | 16/26 | 0/26 | 1 |

Dev chose **linear**. Holdout transitions versus B1: 5 wrong→correct, 0 correct→wrong.
Fixes: Swiftfoot Boots, Moonsnare Specialist, Ulamog's Crusher, Whiplash Trap, Goblin Blastronauts.

## PRODUCTION-LIKE HOLDOUT

| Crop | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Median rank |
| --- | --- | --- | --- | --- | --- | --- |
| B1 production | 10/26 | 12/26 | 13/26 | 13/26 | 1/26 | 4 |
| linear production | 12/26 | 14/26 | 15/26 | 16/26 | 0/26 | 2 |
| linear oracle geometry | 16/26 | 18/26 | 18/26 | 19/26 | 0/26 | 1 |

## B1 ON EVERY KNOWN FRAME

Oracle-geometry B1 is 48/113 Top1. This mix includes training identities, so it is not the holdout result.

| Condition | Top1 | n |
| --- | --- | --- |
| foil | 5/9 | 9 |
| sleeved | 27/70 | 70 |
| unsleeved | 2/6 | 6 |
| basic land | 8/23 | 23 |
| borderless/showcase | 5/12 | 12 |
| non-English | 14/36 | 36 |

## HOLDOUT MISSES

- Excalibur, Sword of Eden: GLARE_OR_FOIL, top1 Revoke Existence, rank 30
- The Spear of Leonidas: ALTERNATE_ART, top1 Case of the Burning Masks, rank 36
- Yuriko, the Tiger's Shadow: ALTERNATE_ART, top1 Famished Foragers, rank 550
- Yuriko, the Tiger's Shadow: ALTERNATE_ART, top1 Restless Bloodseeker, rank 59
- Yuriko, the Tiger's Shadow: VISUALLY_SIMILAR, top1 Skaab Wrangler, rank 6
- Kaito, Bane of Nightmares: VISUALLY_SIMILAR, top1 Brazen Upstart, rank 2
- Agent of the Shadow Thieves: ALTERNATE_ART, top1 Double-Faced Substitute Card, rank 429
- Kaito, Bane of Nightmares: ALTERNATE_ART, top1 Myrkul's Invoker, rank 285
- Chasm Skulker: VISUALLY_SIMILAR, top1 Nazgûl, rank 2
- Deadly Rollick: ALTERNATE_ART, top1 Minions, rank 11900

## UNRESOLVED FRAMES

- geometry-test-20261006-153936 geom-006: Adventure reminder token. No single gallery card.
- geometry-test-20261006-153936 geom-007: Stone Boulder token is not in the gallery.
- geometry-test-20261006-153936 geom-008: Robot Villain token is not in the gallery.
- geometry-test-20261006-153936 geom-009: Goblin token matches two different gallery oracle ids.


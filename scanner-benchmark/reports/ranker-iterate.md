# Ranker tree search

**PIPELINE / EARLY MODEL.** Settings were chosen on grouped cross-validation only. The 4-frame holdout was scored once after the choice. Pass gates were not changed. The phone selector was not changed.

Starting point: depth 2, 24 rounds, learning rate 0.1, minimum leaf 6. That tree recovered 97.2% of frames that have a candidate at IoU ≥ 0.80, with 2 catastrophic selections, 0 good-to-bad swaps, and 19 regressions against the current selector.

A later setting replaced it only when it still passed the locked gates, kept catastrophic selections at 2, and then improved oracle recovery, else regressions, else median IoU.

## What was tried

About 70 grouped-CV fits, in four passes:

1. Ten broad settings: deeper trees, slower learning, hard-negative weights, depth 4.
2. Ten depth-3 settings around minimum leaf 6–12. Hard weights and a higher learning rate added a good-to-bad swap or a third catastrophic frame.
3. A 24-point grid of depth 3, leaf 8–11, 20–28 rounds, learning rate 0.08 or 0.1.
4. A local search around 30–36 rounds and learning rate 0.08–0.11.

Weighted training raised recovery on some fits and also raised catastrophic selections from 2 to 3, so those fits were dropped. Learning rate 0.11 produced a good-to-bad swap. Depth 4 lowered recovery.

## Chosen tree

Depth 3, 30 rounds, learning rate 0.085, minimum leaf 6. The same recovery, catastrophic count, regressions, and median held for 28 and 32 rounds. 34 rounds introduced a good-to-bad swap, so 30 is the middle of the stable band.

| | Previous tree | Chosen tree |
| --- | --- | --- |
| Oracle recovery | 97.2% (104/107) | 98.1% (105/107) |
| ≥0.80 | 104/113 | 105/113 |
| Median | 0.916 | 0.925 |
| p10 | 0.841 | 0.844 |
| Catastrophic <0.50 | 2 | 2 |
| Regressed vs current | 19 | 10 |
| Good→bad | 0 | 0 |
| Folds won | 4/5 | 4/5 |

Fold 2 is 8 frames. The current selector recovers every good candidate there; both trees recover 7 of 8. That miss stays at IoU ≥ 0.70, so it is not a good-to-bad swap. Fold 3 moved from 95% to 100% recovery. Four of the five folds beat the current selector with no good-to-bad swap, which is what the locked gate requires.

The two remaining catastrophic frames are both Command Beacon captures. The current selector is also under 0.50 on them, and the best generated candidate is 0.787 and 0.614. Those are not frames where a good physical-card candidate was passed over.

Frame-structure features are what make the full model pass. Score plus geometry plus source reaches 97.2% recovery with one good-to-bad swap. Adding frame structure reaches 98.1% with zero.

## Holdout, checked after the choice

4 frames. The chosen tree selects IoU ≥ 0.80 on 3/4, ≥ 0.70 on 4/4, catastrophic 0, good-to-bad 0, oracle recovery 100%. The current selector is 2/4 and 66.7% recovery. Four frames cannot meet the strong-win size rule, so the recommendation stays **LEARNED_RANKER_PROMISING**.

The five diagnostic cards are all rank 1 at the best candidate IoU, including the holdout Wand frame at 0.961. They were not used to pick the tree.

Champion remains the current heuristic.

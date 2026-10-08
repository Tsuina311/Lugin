# Conservative geometry selector

The sealed search did not beat the frozen GBM ranker. Nothing was promoted or deployed. The champion file is still the current selector. The frozen ranker, CLIP, the linear adapter, the prototype gallery, and the 0.05 agreement margin were not changed.

Finalist: `B-gbm-ab595716ca0a`. After holdout it was left frozen.

Verdict: `OLD_LEARNED_RANKER_STILL_BEST`

## 1. Search performed

`yarn scanner:autolab` ran one grouped CV search on trusted real frames. Identity-holdout groups, identity-dev groups, and the existing ranker-holdout groups were removed before any fit. That left 23 frames in 5 capture-grouped folds. Bootstrap rows were not mixed into selection.

248 configurations:

- Family A, 15: logistic and depth-1/2 trees that choose keep-current or take-frozen-GBM. Thresholds 0.5, 0.6, 0.7, 0.8, 0.9 applied to out-of-fold probabilities.
- Family B, 225: 9 linear regressions and 216 shallow GBMs. Feature sets `base`, `gbm` (adds frozen utility), and `relative` (adds frozen utility, area ratio to the current quad, score gap to the current quad). Weights `uniform`, `catastrophe`, and `conservative`. GBM grid: depth 1–2, rounds 8/16/32, min leaf 3/6, learning rate 0.05/0.1.
- Family C, 6: take the frozen-GBM candidate only when its utility exceeds the current candidate by 0, 0.02, 0.05, 0.1, 0.2, or 0.4.
- 2 baselines: current selector and frozen GBM, scored on the same 23 frames.

Pairwise linear ranking was not in this grid. No MLP was trained; the trees did not plateau above the frozen GBM in a way that justified one. Human IoU was the label only. Identity and recognition were not features.

## 2. Best CV models

Same 23 frames. Catastrophic means selected IoU below 0.50. Good-to-bad means current IoU at least 0.80 and selected IoU below 0.70.

| Policy | Cat | Good-to-bad | ≥0.90 | ≥0.80 | ≥0.70 | p10 | Median | Swaps of ≥0.90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current | 5 | 0 | 17 | 17 | 18 | 0.279 | 0.928 | 0 |
| Frozen GBM | 2 | 0 | 18 | 20 | 21 | 0.781 | 0.939 | 5 |
| Relative linear, any of the three weights | 1 | 0 | 13 | 20 | 21 | 0.772 | 0.917 | 10 |
| `B-gbm-ab595716ca0a` depth 2, 8 rounds, min leaf 3, lr 0.05, uniform | 2 | 0 | 14 | 21 | 21 | 0.830 | 0.936 | 7 |
| Margin gate t≥0.10, and the depth-1/2 switch at 0.5 | 2 | 0 | 18 | 20 | 21 | 0.781 | 0.936 | 0 |

The three relative linears were identical on CV and were the lex winners. Dev rejected all three: one current-good frame became unusable. The next frozen artifact, `B-gbm-ab595716ca0a`, passed the dev geometry gate and the wrong-publication gate, so it was the single holdout finalist. Its trees split only on frozen GBM utility, area score, and center score. It is a coarse requantization of the frozen ranker, not a new geometric policy.

## 3. Conservative-switch result

Learning when to override did not beat always using the frozen GBM on the geometry priorities.

On the 23 CV frames, a utility margin of 0.10 or more, and the shallow switch at probability 0.5, keep the frozen GBM's three catastrophic fixes, stay at 20/23 above 0.80, and make zero swaps of an already ≥0.90 quad. The frozen GBM makes five of those swaps. Logistic switches at every threshold miss one of the three fixes.

Those policies do not reduce the catastrophic count below 2, so the lex order ranked them behind the linears and behind the requantized GBM. They never received a dev or holdout evaluation. Opening holdout for them now would be a second look.

## 4. Catastrophic safety

| | Current | Frozen GBM | Challenger |
|---|---:|---:|---:|
| CV IoU < 0.50 | 5/23 | 2/23 | 2/23 |
| CV current≥0.80 to selected<0.70 | 0 | 0 | 0 |
| Dev IoU < 0.50 | 4/16 | 0/16 | 0/16 |
| Dev current≥0.80 to selected<0.70 | 0 | 1 | 0 |
| Holdout IoU < 0.50 | 4/26 | 0/26 | 0/26 |
| Holdout current≥0.80 to selected<0.70 | 0 | 0 | 0 |

The challenger matches the frozen GBM on catastrophic quads. It does not improve that count. On dev it avoids the one good-to-bad regression the frozen GBM makes. On holdout both stay at zero.

## 5. Good-quad stability

Holdout has 16 frames whose current quad is already at IoU ≥ 0.90.

The frozen GBM swaps 5 of them. All five stay above 0.90. Its holdout action list has four useless swaps and no harmful swap.

The challenger swaps 7 of them. IoU rises on 5 and falls on 2. One fall is Excalibur, 0.900 to 0.859, classed as a harmful swap. The other is a Moonsnare frame, 0.966 to 0.956, which still publishes. Kaito `geom-003` is one of the seven: IoU rises from 0.908 to 0.972 and the correct publication is lost, the same candidate the frozen GBM already selects. Ulamog's Crusher stays on the current quad at 0.989, so that publication is kept. The frozen GBM moves it to 0.971 and the publication is withheld.

CV told the same story in advance: the challenger swapped 7 of 17 already ≥0.90 quads and recorded 4 harmful swaps. The margin gate swapped none.

## 6. Oracle regret

`oracle_regret = best candidate IoU − selected IoU` on the 26 holdout frames.

| | Mean | Median | p90 | >0.10 | >0.25 |
|---|---:|---:|---:|---:|---:|
| Current | 0.115 | 0.029 | 0.351 | 7 | 4 |
| Frozen GBM | 0.014 | 0 | 0.053 | 1 | 0 |
| Challenger | 0.017 | 0 | 0.054 | 2 | 0 |
| Candidate oracle | 0 | 0 | 0 | 0 | 0 |

The extra challenger regret above 0.10 is Yuriko `geom-002`: best candidate 0.785, frozen GBM 0.724, challenger 0.654. Neither selection publishes.

## 7. Dev validation

16 of 17 identity-dev photos are in the ranker set. One identity-dev photo has no ranker row and was not scored.

Geometry:

| | Cat | Good-to-bad | ≥0.90 | ≥0.80 | ≥0.70 | Median | p10 | Regret >0.25 | Swaps of ≥0.90 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Current | 4 | 0 | 6 | 12 | 12 | 0.893 | 0.323 | 4 | 0 |
| Frozen GBM | 0 | 1 | 10 | 14 | 15 | 0.912 | 0.815 | 1 | 2 |
| Challenger | 0 | 0 | 8 | 14 | 16 | 0.901 | 0.759 | 0 | 2 |

Recognition, frozen agreement rule:

| | Clean Top1 | Prototype Top1 | Correct published | Wrong published | Withheld correct |
|---|---:|---:|---:|---:|---:|
| Current | 9/16 | 12/16 | 8 | 0 | 4 |
| Frozen GBM | 12/16 | 13/16 | 9 | 0 | 4 |
| Challenger | 11/16 | 15/16 | 7 | 0 | 8 |

Wrong publications did not increase. Correct publications fell from 9 to 7. That was not used to refit.

## 8. Frozen holdout

Evaluated once, after the challenger was frozen. The model was not changed afterward.

| | ≥0.90 | ≥0.80 | ≥0.70 | <0.50 | Median | p10 | Mean regret | Regret >0.10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current | 16 | 20 | 21 | 4 | 0.926 | 0.429 | 0.115 | 7 |
| Frozen GBM | 20 | 24 | 26 | 0 | 0.945 | 0.867 | 0.014 | 1 |
| Challenger | 20 | 24 | 25 | 0 | 0.950 | 0.842 | 0.017 | 2 |
| Candidate oracle | 23 | 24 | 26 | 0 | 0.955 | 0.882 | 0 | 0 |

Lex order on this table prefers the frozen GBM: catastrophic count and ≥0.80 are tied, then ≥0.70 is 26 against 25, then p10 is 0.867 against 0.842.

Actions for the challenger: same as current 9, safe override 7, catastrophic fix 3, useless swap 5, harmful swap 2. The frozen GBM: same 13, safe override 5, catastrophic fix 4, useless swap 4, harmful swap 0.

Moonsnare `geom-009` is fixed by both learned policies, 0.196 to 0.934, and both publish. Whiplash Trap is fixed by both, 0.873 to 0.928, and both publish. Kaito `geom-003` is moved by both, 0.908 to 0.972, and both withhold. Ulamog stays with the current quad under the challenger and keeps its publication.

## 9. End-to-end recognition

Holdout, frozen CLIP, frozen adapter, frozen galleries, publish only when the prototype margin is at least 0.05 and the two galleries agree.

| | Clean Top1 | Prototype Top1 | Correct published | Wrong published | Safe-hit rate |
|---|---:|---:|---:|---:|---:|
| Human quad | 16/26 | 19/26 | 11 | 0 | 11/26 |
| Current | 12/26 | 14/26 | 10 | 0 | 10/26 |
| Frozen GBM | 13/26 | 16/26 | 10 | 0 | 10/26 |
| Challenger | 16/26 | 17/26 | 11 | 0 | 11/26 |

Wrong publications stay at zero. The challenger's extra correct publication against the frozen GBM is Kaito `geom-010`, plus Ulamog kept, minus Slip Out the Back. Slip Out the Back falls from 0.888 to 0.831 and the margin drops to 0.043, so agreement withholds a correct Top1. That recognition gain does not override the missing ≥0.70 frame.

## 10. Production feasibility

The challenger is not a replacement, so no Kotlin scorer and no feature flag were added.

The artifact on disk is 58 KB because it carries CV, dev, and holdout records. The scorer itself is 8 trees of depth 2 over 41 features. CV frames have 2–17 candidates, median 10. A full pass of the 23 CV frames takes 0.21 ms on this host once features already exist, about 9 microseconds per frame. Phone timing was not measured. The arithmetic would fit on a phone. The policy does not earn a port.

## 11. Autolab

Command: `yarn scanner:autolab`

Dev geometry, only for an id that already has a CV record:

`node scripts/scanner-benchmark/ranker/autolab.mjs --dev --challenger=<id>`

Dev recognition:

`node scripts/scanner-benchmark/ranker/autolab-recognize.mjs --dev --challenger=<id>`

Holdout geometry and recognition each require the dev record and the dev recognition record, and they refuse a rejected challenger:

`node scripts/scanner-benchmark/ranker/autolab.mjs --final-holdout --challenger=<id>`

`node scripts/scanner-benchmark/ranker/autolab-recognize.mjs --final-holdout --challenger=<id>`

Guard check: `node scripts/scanner-benchmark/ranker/autolab-test.mjs`

Registry:

- metrics for all 248 runs: `scanner-benchmark/ranker-registry/autolab/runs.jsonl`
- CV summary: `scanner-benchmark/ranker-registry/autolab/cv-summary.json`
- saved models, lex frontier only: `scanner-benchmark/ranker-registry/autolab/challengers/`
- this report: `scanner-benchmark/reports/conservative-selector-v1/REPORT.md`

Hashes for `B-gbm-ab595716ca0a`:

- dataset `ab54804ca3cec4cb8919b6d9c728d39a8018022cc5c249db202f14ba5efc1522`
- split `fe29ccd434d5cc78531ced6d3dd8eea5137f7a6cc9abd050736ceb211e06b4e8`
- model `18a5b769452ff642285624c4bae286b4cb6672c0f17b0187275249545192185f`
- lab script after the holdout guard `05f46494133160146b006ad0a403011e2ccfd2f3d6ceb0986a8c5fcf2ca65d8f`
- recognition script `9f7e849056555c3913d64c929fd2d1bceb08e71c44c4ac58822673f855c45c0e`

Git revision at fit time `39088e07d31ba91056e68fec534a3baca5e2bd44`, dirty. Seed: deterministic, no RNG. Feature schema `ranker-features-v1+conservative-v1`.

## 12. Verdict

`OLD_LEARNED_RANKER_STILL_BEST`

## 13. One next action

Leave both rankers unpromoted. The frozen GBM remains the selector to integrate later; do not replace it with `B-gbm-ab595716ca0a`, and do not open holdout again for the CV margin gate.

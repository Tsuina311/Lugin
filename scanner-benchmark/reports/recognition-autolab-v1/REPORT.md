# Recognition search

Geometry stayed on the frozen GBM ranker `gbm-iou-all-2dd2ec36b833`. CLIP and `linear-identity-v1` stayed frozen. The equal-weight clean/blur/motion/perspective prototype and the 0.05 agreement rule stayed the baseline. Nothing was promoted.

Finalist: `rec-71078c38c736`. After holdout it was left frozen.

Verdict: `OCR_RECOVERY_STRONG_WIN`

## 1. Experiments run

Train only, 70 photos, 43 identities, 5 identity-grouped folds. No identity crossed a fold. Dev and holdout were not read until a challenger was frozen.

- 95 gallery formulations on the full 49,968-art gallery: 35 vector-mean weights, 35 score-sum weights, one max-of-views, two-prototype degraded mixes, then a neighborhood around the train leader.
- 5 OCR policies: visual only, confirm top1, recover a withheld top1, recover an exact title inside prototype top 5, and an OCR tie-break when the galleries disagree.
- One logistic confidence model, 19 probability cutoffs, fit inside the identity folds.
- No new adapter. The failure split did not justify one.

## 2. Baseline

The baseline is the frozen agreement rule on the equal-weight prototype, using frozen-GBM art crops.

| Split | n | Top1 | Top5 | Correct published | Wrong published |
|---|---:|---:|---:|---:|---:|
| Train | 70 | 49 | 57 | 34 | 0 |
| Dev | 17 | 13 | 13 | 9 | 0 |
| Holdout | 26 | 16 | 18 | 10 | 0 |

Holdout Top1 16 and 10 correct publishes match the earlier frozen-GBM recognition count. Human-quad agreement on the same 26 photos, scored only in the final holdout pass, is Top1 19 and 11 correct publishes, with 0 wrong.

## 3. Robust-gallery optimization

Weighted fusion did not beat the equal mean.

The best single weight on all train, clean 0.25 / blur 0.25 / motion 0.05 / perspective 0.45, raised train publishes from 34 to 36 and kept wrong publishes at 0, but Top1 fell from 49 to 48. Identity-grouped selection did not agree on a weight. The out-of-fold procedure published 33 correct and 1 wrong, with Top1 46. That is worse than the equal mean on the first priority, so the equal mean stayed frozen.

Score-sum fusion, max-of-views, and a clean-plus-degraded pair did not win either. The gallery stays two vectors per artwork: the clean vector and the equal normalized mean.

## 4. OCR

Host Tesseract, one line, canonical title crop, with the detected title band only when the canonical read was shorter than three characters. Exact means the folded text hits one gallery oracle, or the existing name index returns an exact English title that maps to one oracle. Fuzzy matches were recorded and were not allowed to publish.

Train, 70 frames:

| | Count |
|---|---:|
| Unique exact | 15 |
| Exact and correct | 15 |
| False exact | 0 |
| Fuzzy score ≥ 0.94 | 19 |
| Empty | 0 |

Exact coverage is 15/70. French and Italian titles usually do not exact-match the English gallery name. The false-exact count on train is zero.

## 5. Fusion

No learned reranker beat the equal-weight prototype. The visual top-K model was not needed once the gallery search showed the equal mean already at the train ceiling for Top5 (57/70) and the weight search could not raise Top1 without a grouped-CV regression.

The system that won is the frozen visual stack plus one OCR rule: if the agreement rule withholds, and the OCR text is a unique exact title, and that oracle is already inside the prototype top 5, publish that oracle.

## 6. Confidence

A logistic model on margin, agreement, OCR agreement, art-box confidence, and ranker utility margin did not beat that rule at any cutoff from 0.05 to 0.95. The 0.05 agreement rule remains the decision whenever OCR does not exact-match a top-5 candidate. The cutoff was not moved.

## 7. Adapter experiments

Not run. Of 21 train misses, 8 are visually similar (rank 2–10), 9 sit further down but inside the top 100, 3 are beyond rank 100, and 1 is a bad art crop. Three phone-domain misses is below the bar that would justify a new adapter, and the OCR rule had already improved publishes.

## 8. TRAIN/CV

Equal prototype, agreement rule: 34 correct publishes, 0 wrong, Top1 49/70.

Exact-title top-5 recovery: 40 correct publishes, 0 wrong, Top1 51/70. The extra Top1 count is the emitted identity after OCR, not a change in gallery rank.

Per-fold safe-hit rate for the recovery rule: 0.600, 0.214, 0.571, 0.786, 0.692 (stdev 0.194). Against the baseline rates 0.600, 0.214, 0.429, 0.714, 0.462, three folds improve and two tie. No fold adds a wrong publish.

## 9. DEV

17 photos. One identity-dev photo that earlier recognition passes could not score is included here.

| | Top1 | Top5 | Correct published | Wrong published | Withheld correct |
|---|---:|---:|---:|---:|---:|
| Agreement baseline | 13 | 13 | 9 | 0 | 4 |
| Challenger | 13 | 13 | 10 | 0 | 3 |

The extra publish is Glamdring, Foe-hammer. It was already the correct prototype Top1, the galleries agreed, and the margin was 0.028. The exact title confirmed it. Status `dev-pass`. The model was not refit.

## 10. HOLDOUT

One pass, after dev passed. The rule was not changed afterward.

| | Top1 | Top3 | Top5 | Top10 | Correct published | Wrong published | Withheld correct | Wrong withheld | Precision | Recall | Median rank | Mean rank |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Agreement baseline | 16 | 18 | 18 | 21 | 10 | 0 | 6 | 10 | 1 | 0.385 | 1 | 391 |
| Challenger | 17 | 18 | 18 | 21 | 14 | 0 | 3 | 9 | 1 | 0.538 | 1 | 391 |
| Human quad, agreement only | 19 | 21 | 21 | 22 | 11 | 0 | 8 | 7 | 1 | 0.423 | 1 | 535 |

The four new publishes:

- Sword of the Animist, Chasm Skulker, and Goblin Blastronauts were already the correct Top1 with margins 0.024, 0.037, and 0.032. The galleries agreed. Exact OCR published them.
- The Spear of Leonidas was visual rank 3, the galleries disagreed, and the margin was 0.002. The OCR text was the exact English title, that oracle was inside the prototype top 5, and the rule published it. Prototype rank of the correct card did not change. The emitted identity did.

Gallery mean rank stays 391. The long tail is untouched.

## 11. Failure analysis

Train misses under the frozen visual top1, before OCR changes the emitted name:

| Class | Frames |
|---|---:|
| OK | 49 |
| Visually similar, rank 2–10 | 8 |
| Representation, rank 11–100 | 9 |
| Phone-domain, rank above 100 | 3 |
| Art crop | 1 |

The strip is `scanner-benchmark/reports/recognition-autolab-v1/failure-strip.png`: Mask of Memory (rank 2), Pilgrim's Eye (rank 112), Wand of Wonder (rank 34), Island (bad crop, rank 19).

What remains: cards whose correct oracle is far down the gallery, non-English titles that do not exact-match, and the cases where even a human quad is Top1 but the margin stays under 0.05. OCR does not repair those. Human geometry still leads raw Top1, 19 against 16, so a few holdout misses are still the quad. That was not reopened.

## 12. Performance

The challenger adds no gallery vectors and no model file. Memory stays the current pair of galleries: 49,968 × 512 float32, 102,334,464 bytes each, about 195 MB, plus `refs.json` at 11,231,925 bytes. A query is still two gallery passes.

OCR is required only when the agreement rule withholds. On these sets that is 36/70 train, 8/17 dev, and 16/26 holdout. The extra check is an exact title lookup and a membership test against five prototype identities. Host Tesseract on a title line was well under a second per frame in this run. Phone OCR timing was not measured. ML Kit is a different engine from this host Tesseract.

Android work is a small branch on the existing title reader. It does not need a new network.

## 13. Recognition autolab

`yarn scanner:recognition-autolab`

Dev, only for an id that already has a frozen CV artifact:

`node scripts/scanner-benchmark/identity/recognition-autolab.mjs --validate-dev <id>`

Holdout refuses a missing artifact, a missing dev record, or a rejected challenger:

`node scripts/scanner-benchmark/identity/recognition-autolab.mjs --final-holdout <id>`

Seal check: `node scripts/scanner-benchmark/identity/recognition-autolab-test.mjs`

Paths:

- CV summary: `scanner-benchmark/recognition-registry/autolab/cv-summary.json`
- Challenger: `scanner-benchmark/recognition-registry/autolab/challengers/rec-71078c38c736.json`
- Train OCR cache: `scanner-benchmark/recognition-registry/autolab/ocr-train.json`
- Adapted galleries: `scanner-benchmark/recognition-registry/autolab/adapted/`
- This report: `scanner-benchmark/reports/recognition-autolab-v1/REPORT.md`

Hashes: crops `e0f9d0fafa372162d21d33223818fd2122db919b2e0a107c1f3fcc57e2af2d73`, adapter `afed03d3fbd0b1d0f04dedba07366656941bdcac9bed868550300d031fff44c8`, lab script `ec17f92867a8d801d41c60f23fa22f9bbdc4f6efffd3ef081eb940cb8a31fd13`. Git `39088e07d31ba91056e68fec534a3baca5e2bd44`, dirty. Seed is deterministic.

## 14. Verdict

`OCR_RECOVERY_STRONG_WIN`

## 15. One next action

Leave the rule unpromoted. The next change is a default-off development path that publishes only when agreement already would, or when a unique exact title is already inside the prototype top 5.

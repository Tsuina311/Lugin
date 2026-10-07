# CANDIDATE RANKER V1

**PIPELINE / EARLY MODEL.** This is not a production-ready selector. The trusted real sample is too small to support that claim.

Recommendation: **LEARNED_RANKER_PROMISING**

Trusted frames 117 across 45 capture groups. Candidates 1085. Cross-validation frames 113. Frozen holdout frames 4.

## GROUPED CV

Baselines and models below are scored on the cross-validation frames only.

| Selector | ≥0.80 | ≥0.70 | Median | p10 | <0.50 | Gap to oracle | Oracle recovery | Improved | Regressed | Good→bad |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current | 89/113 | 91/113 | 0.913 | 0.305 | 20 | 0.126 | 83.2% | 0 | 0 | 0 |
| Max score | 86/113 | 88/113 | 0.905 | 0.208 | 24 | 0.157 | 80.4% | 16 | 28 | 8 |
| Peaked area | 100/113 | 104/113 | 0.915 | 0.782 | 8 | 0.059 | 93.5% | 24 | 11 | 0 |
| Oracle candidates | 107/113 | 111/113 | 0.947 | 0.863 | 0 | 0.000 | 100.0% | 63 | 0 | 0 |
| linear-iou | 103/113 | 109/113 | 0.915 | 0.827 | 2 | 0.034 | 96.3% | 39 | 22 | 1 |
| linear-pairwise | 99/113 | 110/113 | 0.928 | 0.786 | 2 | 0.030 | 92.5% | 34 | 16 | 0 |
| gbm-iou | 105/113 | 110/113 | 0.925 | 0.844 | 2 | 0.023 | 98.1% | 36 | 10 | 0 |
| mlp-iou | 85/113 | 92/113 | 0.905 | 0.398 | 16 | 0.121 | 79.4% | 44 | 48 | 12 |
| mlp-pairwise | 93/113 | 104/113 | 0.920 | 0.725 | 4 | 0.052 | 86.9% | 44 | 28 | 4 |

## HOLDOUT

| Selector | ≥0.80 | ≥0.70 | Median | p10 | <0.50 | Gap to oracle | Oracle recovery | Improved | Regressed | Good→bad |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current | 2/4 | 3/4 | 0.839 | 0.413 | 1 | 0.194 | 66.7% | 0 | 0 | 0 |
| Max score | 2/4 | 3/4 | 0.836 | 0.402 | 1 | 0.199 | 66.7% | 0 | 1 | 0 |
| Peaked area | 3/4 | 4/4 | 0.928 | 0.822 | 0 | 0.015 | 100.0% | 1 | 0 | 0 |
| Oracle candidates | 3/4 | 4/4 | 0.954 | 0.837 | 0 | 0.000 | 100.0% | 2 | 0 | 0 |
| gbm-iou / all | 3/4 | 4/4 | 0.924 | 0.813 | 0 | 0.019 | 100.0% | 1 | 0 | 0 |

## ABLATION

Ablation family gbm-iou. Saved challenger gbm-iou / all.

| Features | Oracle recovery | Median | Good→bad | Pass |
| --- | --- | --- | --- | --- |
| score | 96.3% | 0.920 | 1 | no |
| score-geometry | 96.3% | 0.917 | 1 | no |
| score-geometry-source | 97.2% | 0.921 | 1 | no |
| all | 98.1% | 0.925 | 0 | yes |

## FIVE FRAMES

Cross-validation frames use the model trained without that fold. The holdout frame uses the model trained on the cross-validation frames only.

| Card | Split | Current IoU | Oracle IoU | Ranker IoU | Oracle rank |
| --- | --- | --- | --- | --- | --- |
| Island cq-120629 | fold 1 | 0.190 | 0.981 | 0.981 | 1 |
| Wand cq-120751 | holdout | 0.251 | 0.961 | 0.961 | 1 |
| Livaan cq-120813 | fold 3 | 0.226 | 0.943 | 0.943 | 1 |
| Bulk Up | fold 0 | 0.344 | 0.867 | 0.867 | 1 |
| Mudbutton Torchrunner | fold 4 | 0.318 | 0.862 | 0.862 | 1 |

## CORPUS

Trusted frames now: 117. Milestones 50, 100, 200, and 500 are progress marks, not quality guarantees.

Tags: language-fr 4, sleeved 72, unsleeved 10, classic-frame 6, foil 8, per-snapshot-series 3, language-it 1, borderless 9, partial 3, perspective 4, multi-card 1, dark-background 2, glare 2, hard-case 2, showcase 2.

Challenger PASS · gbm-iou · features all. Artifact 21225 bytes. Inference 0.01 ms/frame on this machine.

Rerun after new human reviews: `yarn scanner:ranker:loop`.

## ANNOTATION QUEUE

Untrusted frames where the ranker and the current selector disagree, or the top two utilities are close. Not labels.

| Frame | Disagree | Utility margin | Weak top | Detector ambiguous |
| --- | --- | --- | --- | --- |
| island unsleeved | yes | 0.000 | no | no |
| Excalibur, Sword of Eden French foil | yes | 0.000 | no | yes |
| Excalibur, Sword of Eden French foil | yes | 0.000 | no | yes |
| Wand of Wonder | yes | 0.000 | no | yes |
| Wand of Wonder | yes | 0.000 | no | yes |
| Wand of Wonder | yes | 0.000 | no | yes |
| Wand of Wonder | yes | 0.000 | no | yes |
| Wand of Wonder | yes | 0.000 | no | yes |
| les cartes merveilleuses french | yes | 0.004 | no | no |
| Octopus Form | yes | 0.004 | no | yes |
| negate unsleeved | yes | 0.004 | no | yes |
| negate unsleeved | yes | 0.004 | no | yes |
| negate unsleeved | yes | 0.004 | no | yes |
| Wand of Wonder | yes | 0.005 | no | yes |
| Wand of Wonder | yes | 0.005 | no | yes |
| Teferi's Veil old edition | yes | 0.007 | no | no |
| livaan (foil) | yes | 0.009 | no | yes |
| Wand of Wonder | yes | 0.011 | no | yes |
| épée d'âtre et de foyer (French good capture) | yes | 0.015 | no | yes |
| épée d'âtre et de foyer (French good capture) | yes | 0.015 | no | yes |

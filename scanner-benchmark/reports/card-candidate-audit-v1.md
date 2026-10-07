# CARD CANDIDATE AUDIT V1

`detectCardQuad` is unchanged. The human card outline is only a ruler. Diagnostic bands are IoU ≥ 0.80 GOOD and ≥ 0.70 USABLE.

On a single still, `detectCardQuad` returns the nested-selection winner as `corners`. It does not set `rawCorners`, `trackedCorners`, or `recognitionCorners`, and it does not run cross-frame continuity. Tracking is `TRACKING_NOT_MEASURABLE` for all five frames.

Accepted candidates are the debug entries that kept a quad. Rejected masks do not keep corners, so a hull dropped by the silhouette gates cannot be scored.

## SUMMARY

| Card | Final IoU | Best generated IoU | Best rank | Good candidate existed? | Where lost? | Diagnosis |
| --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | 0.190 | 0.981 | 3 | yes GOOD 0.981 | score-ranking | SELECTION_FAILURE |
| Wand cq-120751 | 0.251 | 0.961 | 5 | yes GOOD 0.961 | score-ranking | SELECTION_FAILURE |
| Livaan cq-120813 | 0.226 | 0.943 | 6 | yes GOOD 0.943 | score-ranking | SELECTION_FAILURE |
| Bulk Up | 0.344 | 0.867 | 1 | yes GOOD 0.867 | nested-selection | SELECTION_FAILURE |
| Mudbutton Torchrunner | 0.318 | 0.862 | 2 | yes GOOD 0.862 | score-ranking | SELECTION_FAILURE |

**CARD_CANDIDATE_SELECTION_PRIMARY**

GOOD candidates: 5/5. USABLE or better: 5/5. No usable candidate: 0/5.

## Island cq-120629

Outline space `image` scale 1.0000. Accepted 9 of 44 debug rows. 35 rows kept no quad. Dedupe shortlist 7. Best survives dedupe: yes. Tags unsleeved.

Selected area ratio 5.26. Human area inside selected 1.000. Selected area inside human 0.190. Detector nested-sleeve test on selected vs human: no. Best and selected form a nested pair: no.

| Rank | Method | Score | IoU | Band | Mean corner | Max corner | Area ratio | Aspect | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.985 | 0.158 | POOR | 478.8 px | 544.5 px | 6.31 | 0.741 |  |
| 2 | luma@12 | 0.851 | 0.190 | POOR | 471.3 px | 545.0 px | 5.26 | 0.602 | selected |
| 3 | luma×2.5 | 0.841 | 0.981 | GOOD | 4.5 px | 6.5 px | 0.99 | 0.719 | best IoU |
| 4 | luma×3.5 | 0.841 | 0.980 | GOOD | 4.4 px | 7.5 px | 0.98 | 0.715 |  |
| 5 | chroma@28 | 0.824 | 0.226 | POOR | 351.8 px | 468.4 px | 4.42 | 0.896 |  |

**selected** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 545.0 px | 1.470 | outside card, on a larger rectangle |
| TR | 435.2 px | 1.174 | outside card, on a larger rectangle |
| BR | 442.7 px | 1.194 | outside card, on a larger rectangle |
| BL | 462.3 px | 1.247 | outside card, on a larger rectangle |

**best** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 6.0 px | 0.016 | inside card |
| TR | 1.6 px | 0.004 | on the card edge |
| BR | 6.5 px | 0.018 | inside card |
| BL | 4.0 px | 0.011 | on the card edge |

## Wand cq-120751

Outline space `capture` scale 0.6667. Accepted 10 of 44 debug rows. 34 rows kept no quad. Dedupe shortlist 9. Best survives dedupe: yes. Tags sleeved.

Selected area ratio 3.99. Human area inside selected 1.000. Selected area inside human 0.251. Detector nested-sleeve test on selected vs human: no. Best and selected form a nested pair: no.

| Rank | Method | Score | IoU | Band | Mean corner | Max corner | Area ratio | Aspect | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.951 | 0.239 | POOR | 411.8 px | 444.8 px | 4.19 | 0.688 |  |
| 2 | luma@12 | 0.919 | 0.251 | POOR | 407.0 px | 442.6 px | 3.99 | 0.656 | selected |
| 3 | chroma@28 | 0.917 | 0.251 | POOR | 407.0 px | 444.1 px | 3.98 | 0.656 |  |
| 4 | edge | 0.899 | 0.905 | GOOD | 20.3 px | 26.9 px | 1.10 | 0.738 |  |
| 5 | luma×3.5 | 0.894 | 0.961 | GOOD | 7.6 px | 8.8 px | 1.01 | 0.709 | best IoU |

**selected** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 442.6 px | 1.011 | outside card, on a larger rectangle |
| TR | 331.5 px | 0.757 | outside card, on a larger rectangle |
| BR | 419.4 px | 0.958 | outside card, on a larger rectangle |
| BL | 434.6 px | 0.993 | outside card, on a larger rectangle |

**best** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 8.8 px | 0.020 | on the card edge |
| TR | 6.2 px | 0.014 | on the card edge |
| BR | 6.8 px | 0.016 | on the card edge |
| BL | 8.5 px | 0.019 | on the card edge |

## Livaan cq-120813

Outline space `capture` scale 0.6667. Accepted 11 of 44 debug rows. 33 rows kept no quad. Dedupe shortlist 10. Best survives dedupe: no. Tags sleeved, foil.

Selected area ratio 4.42. Human area inside selected 1.000. Selected area inside human 0.226. Detector nested-sleeve test on selected vs human: no. Best and selected form a nested pair: no.

| Rank | Method | Score | IoU | Band | Mean corner | Max corner | Area ratio | Aspect | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.977 | 0.218 | POOR | 420.0 px | 538.1 px | 4.58 | 0.718 |  |
| 2 | luma@12 | 0.962 | 0.226 | POOR | 409.0 px | 523.7 px | 4.42 | 0.700 | selected |
| 3 | luma@18 | 0.892 | 0.611 | POOR | 127.3 px | 270.6 px | 1.64 | 0.629 |  |
| 4 | luma×3.5 | 0.882 | 0.930 | GOOD | 15.4 px | 20.1 px | 1.07 | 0.709 |  |
| 5 | edge | 0.881 | 0.713 | USABLE | 77.1 px | 200.9 px | 1.40 | 0.671 |  |

**selected** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 350.1 px | 0.830 | outside card, on a larger rectangle |
| TR | 256.3 px | 0.607 | outside card, on a larger rectangle |
| BR | 523.7 px | 1.241 | outside card, on a larger rectangle |
| BL | 505.9 px | 1.199 | outside card, on a larger rectangle |

**best** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 18.7 px | 0.044 | on the card edge |
| TR | 13.4 px | 0.032 | on the card edge |
| BR | 2.7 px | 0.006 | on the card edge |
| BL | 15.0 px | 0.035 | on the card edge |

## Bulk Up

Outline space `image` scale 1.0000. Accepted 4 of 40 debug rows. 36 rows kept no quad. Dedupe shortlist 4. Best survives dedupe: yes. Tags —.

Selected area ratio 2.91. Human area inside selected 1.000. Selected area inside human 0.344. Detector nested-sleeve test on selected vs human: no. Best and selected form a nested pair: no.

| Rank | Method | Score | IoU | Band | Mean corner | Max corner | Area ratio | Aspect | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | edge | 0.928 | 0.867 | GOOD | 38.8 px | 45.0 px | 1.15 | 0.737 | best IoU |
| 2 | luma@18 | 0.898 | 0.325 | POOR | 486.4 px | 751.0 px | 3.08 | 0.599 |  |
| 3 | chroma@40 | 0.863 | 0.344 | POOR | 478.4 px | 670.4 px | 2.91 | 0.566 | selected |
| 4 | luma@28 | 0.860 | 0.418 | POOR | 370.1 px | 517.5 px | 2.39 | 0.615 |  |

**selected** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 379.3 px | 0.597 | outside card, on a larger rectangle |
| TR | 670.4 px | 1.055 | outside card, on a larger rectangle |
| BR | 444.4 px | 0.699 | outside card, on a larger rectangle |
| BL | 419.7 px | 0.660 | outside card, on a larger rectangle |

**best** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 35.8 px | 0.056 | outside card, on a larger rectangle |
| TR | 33.4 px | 0.053 | outside card, on a larger rectangle |
| BR | 41.1 px | 0.065 | outside card, on a larger rectangle |
| BL | 45.0 px | 0.071 | outside card, on a larger rectangle |

## Mudbutton Torchrunner

Outline space `image` scale 1.0000. Accepted 2 of 31 debug rows. 29 rows kept no quad. Dedupe shortlist 2. Best survives dedupe: yes. Tags —.

Selected area ratio 3.14. Human area inside selected 1.000. Selected area inside human 0.318. Detector nested-sleeve test on selected vs human: no. Best and selected form a nested pair: no.

| Rank | Method | Score | IoU | Band | Mean corner | Max corner | Area ratio | Aspect | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | luma@28 | 0.889 | 0.318 | POOR | 535.1 px | 779.4 px | 3.14 | 0.583 | selected |
| 2 | edge | 0.871 | 0.862 | GOOD | 37.7 px | 46.4 px | 0.86 | 0.692 | best IoU |

**selected** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 770.7 px | 1.207 | outside card, on a larger rectangle |
| TR | 779.4 px | 1.220 | outside card, on a larger rectangle |
| BR | 389.4 px | 0.610 | outside card, on a larger rectangle |
| BL | 200.7 px | 0.314 | outside card, on a larger rectangle |

**best** corners vs human:

| Corner | Error | Card widths | Where |
| --- | --- | --- | --- |
| TL | 30.4 px | 0.048 | inside card |
| TR | 33.5 px | 0.052 | inside card |
| BR | 46.4 px | 0.073 | inside card |
| BL | 40.7 px | 0.064 | inside card |

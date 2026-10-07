# CARD SCORE DECOMPOSITION V1

Weights and the nested rule are unchanged. Human card area is a ruler for the area ratio. It is not a selection feature.

## FORMULA

`scoreCardQuad` is the detector total. Stored `components.edge` is not added.

```
aspectScore = 1 - min(1, |width/height - 63/88| / (63/88))
parallel    = 1 - min(1, (|top-bottom|/width + |left-right|/height) / 2)
areaScore   = min(1, polygonArea / (imageWidth * imageHeight * 0.35))
centerScore = 1 - min(1, distance(center, imageCenter) / (imageDiagonal / 2))
total       = 0.40*aspectScore + 0.25*parallel + 0.25*areaScore + 0.10*centerScore
```

Every accepted candidate in this run reconstructs that total to 1e-6.

## CARD VERSUS MAX-SCORE

The second row is the highest score before nested selection. A third row appears when nested selection picks someone else.

| Card | Candidate | IoU | Area/card | Aspect | Area score | Center | Parallel | Aspect score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | best IoU | 0.981 | 0.99 | 0.719 | 0.442 | 0.922 | 0.960 | 0.995 | 0.841 |
| Island cq-120629 | max score | 0.158 | 6.31 | 0.741 | 1.000 | 0.998 | 0.997 | 0.965 | 0.985 |
| Island cq-120629 | after nested | 0.190 | 5.26 | 0.602 | 1.000 | 0.899 | 0.700 | 0.841 | 0.851 |
| Wand cq-120751 | best IoU | 0.961 | 1.01 | 0.709 | 0.633 | 0.984 | 0.963 | 0.991 | 0.894 |
| Wand cq-120751 | max score | 0.239 | 4.19 | 0.688 | 1.000 | 0.963 | 0.879 | 0.962 | 0.951 |
| Wand cq-120751 | after nested | 0.251 | 3.99 | 0.656 | 1.000 | 0.940 | 0.833 | 0.916 | 0.919 |
| Livaan cq-120813 | best IoU | 0.943 | 1.05 | 0.697 | 0.622 | 0.870 | 0.976 | 0.974 | 0.876 |
| Livaan cq-120813 | max score | 0.218 | 4.58 | 0.718 | 1.000 | 0.977 | 0.920 | 0.997 | 0.977 |
| Livaan cq-120813 | after nested | 0.226 | 4.42 | 0.700 | 1.000 | 0.964 | 0.899 | 0.978 | 0.962 |
| Bulk Up | best IoU | 0.867 | 1.15 | 0.737 | 0.936 | 0.830 | 0.893 | 0.970 | 0.928 |
| Bulk Up | max score | 0.867 | 1.15 | 0.737 | 0.936 | 0.830 | 0.893 | 0.970 | 0.928 |
| Bulk Up | after nested | 0.344 | 2.91 | 0.566 | 1.000 | 0.903 | 0.826 | 0.790 | 0.863 |
| Mudbutton Torchrunner | best IoU | 0.862 | 0.86 | 0.692 | 0.718 | 0.793 | 0.900 | 0.967 | 0.871 |
| Mudbutton Torchrunner | max score | 0.318 | 3.14 | 0.583 | 1.000 | 0.936 | 0.879 | 0.815 | 0.889 |

Weighted advantage of the max-score quad over the best-IoU card. Positive means the max-score quad gains that many points of the total.

| Card | Δ aspect ×0.40 | Δ parallel ×0.25 | Δ area ×0.25 | Δ center ×0.10 | Δ total | Largest term |
| --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | -0.012 | 0.009 | 0.139 | 0.008 | 0.144 | area |
| Wand cq-120751 | -0.012 | -0.021 | 0.092 | -0.002 | 0.057 | area |
| Livaan cq-120813 | 0.009 | -0.014 | 0.094 | 0.011 | 0.100 | area |
| Bulk Up | 0 | 0 | 0 | 0 | 0 | same candidate |
| Mudbutton Torchrunner | -0.061 | -0.005 | 0.070 | 0.014 | 0.018 | area |

Raw measurements for those two candidates. Area raw is polygon area divided by 35% of the frame, before the cap at 1. Center raw is pixels from the image center.

### Island cq-120629

| Candidate | Aspect ratio | Aspect score | Parallel raw | Parallel | Area px | Area raw | Area score | Center px | Center score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best IoU | 0.719 | 0.995 | 0.040 | 0.960 | 190174 | 0.442 | 0.442 | 62.2 | 0.922 | 0.841 |
| max score | 0.741 | 0.965 | 0.003 | 0.997 | 1209130 | 2.811 | 1.000 | 1.9 | 0.998 | 0.985 |
| after nested | 0.602 | 0.841 | 0.300 | 0.700 | 1007616 | 2.343 | 1.000 | 80.7 | 0.899 | 0.851 |

### Wand cq-120751

| Candidate | Aspect ratio | Aspect score | Parallel raw | Parallel | Area px | Area raw | Area score | Center px | Center score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best IoU | 0.709 | 0.991 | 0.037 | 0.963 | 272098 | 0.633 | 0.633 | 13.1 | 0.984 | 0.894 |
| max score | 0.688 | 0.962 | 0.121 | 0.879 | 1126762 | 2.620 | 1.000 | 29.9 | 0.963 | 0.951 |
| after nested | 0.656 | 0.916 | 0.167 | 0.833 | 1071843 | 2.492 | 1.000 | 47.9 | 0.940 | 0.919 |

### Livaan cq-120813

| Candidate | Aspect ratio | Aspect score | Parallel raw | Parallel | Area px | Area raw | Area score | Center px | Center score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best IoU | 0.697 | 0.974 | 0.024 | 0.976 | 267609 | 0.622 | 0.622 | 103.8 | 0.870 | 0.876 |
| max score | 0.718 | 0.997 | 0.080 | 0.920 | 1171718 | 2.724 | 1.000 | 18.4 | 0.977 | 0.977 |
| after nested | 0.700 | 0.978 | 0.101 | 0.899 | 1130820 | 2.629 | 1.000 | 28.7 | 0.964 | 0.962 |

### Bulk Up

| Candidate | Aspect ratio | Aspect score | Parallel raw | Parallel | Area px | Area raw | Area score | Center px | Center score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best IoU = max score | 0.737 | 0.970 | 0.107 | 0.893 | 642920 | 0.936 | 0.936 | 185.1 | 0.830 | 0.928 |
| after nested | 0.566 | 0.790 | 0.174 | 0.826 | 1620674 | 2.360 | 1.000 | 106.0 | 0.903 | 0.863 |

### Mudbutton Torchrunner

| Candidate | Aspect ratio | Aspect score | Parallel raw | Parallel | Area px | Area raw | Area score | Center px | Center score | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best IoU | 0.692 | 0.967 | 0.100 | 0.900 | 491963 | 0.718 | 0.718 | 225.3 | 0.793 | 0.871 |
| max score | 0.583 | 0.815 | 0.121 | 0.879 | 1795218 | 2.622 | 1.000 | 70.0 | 0.936 | 0.889 |

Removing one weighted term from both totals, then asking whether the best-IoU card would outrank the max-score quad. This is not a new weight.

| Card | Gap | Card wins without aspect | without parallel | without area | without center |
| --- | --- | --- | --- | --- | --- |
| Island cq-120629 | 0.144 | no | no | no | no |
| Wand cq-120751 | 0.057 | no | no | yes | no |
| Livaan cq-120813 | 0.100 | no | no | no | no |
| Mudbutton Torchrunner | 0.018 | no | no | yes | no |

## NESTED SELECTION

| Card | Max-score IoU | Max-score rank | Nested changed? | Final IoU | Better/worse | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | 0.158 | 1 | yes | 0.190 | IMPROVED | inner.score >= 0.28 |
| Wand cq-120751 | 0.239 | 1 | yes | 0.251 | IMPROVED | inner.score >= 0.28 |
| Livaan cq-120813 | 0.218 | 1 | yes | 0.226 | NEUTRAL | inner.score >= 0.28 |
| Bulk Up | 0.867 | 1 | yes | 0.344 | DEGRADED | inner.score >= 0.28 |
| Mudbutton Torchrunner | 0.318 | 1 | no | 0.318 | NEUTRAL | no nested pair; keep max score |

- Island cq-120629: outer index 28 score 0.985, inner index 16 score 0.851, area fraction 0.833, center distance 0.072. Gates: inner≥0.28 yes, inner≥0.75×outer yes.
- Wand cq-120751: outer index 28 score 0.951, inner index 16 score 0.919, area fraction 0.951, center distance 0.017. Gates: inner≥0.28 yes, inner≥0.75×outer yes.
- Livaan cq-120813: outer index 28 score 0.977, inner index 16 score 0.962, area fraction 0.965, center distance 0.010. Gates: inner≥0.28 yes, inner≥0.75×outer yes.
- Bulk Up: outer index 16 score 0.898, inner index 32 score 0.863, area fraction 0.944, center distance 0.020. Gates: inner≥0.28 yes, inner≥0.75×outer yes.
- Mudbutton Torchrunner: no nested pair among the top 8 by score.

## POLICIES

| Card | MAX_SCORE_ONLY IoU | CURRENT IoU | Best available IoU |
| --- | --- | --- | --- |
| Island cq-120629 | 0.158 | 0.190 | 0.981 |
| Wand cq-120751 | 0.239 | 0.251 | 0.961 |
| Livaan cq-120813 | 0.218 | 0.226 | 0.943 |
| Bulk Up | 0.867 | 0.344 | 0.867 |
| Mudbutton Torchrunner | 0.318 | 0.318 | 0.862 |

## CANDIDATES

### Island cq-120629

Outline image ×1.0000.

| Rank | Method | Total | IoU | Area/card | Frame fraction | Vs largest | Aspect | Aspect×0.40 | Parallel×0.25 | Area×0.25 | Center×0.10 | Contains card | Inside card | Nested | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.985 | 0.158 | 6.31 | 0.984 | 1.000 | 0.741 | 0.386 | 0.249 | 0.250 | 0.100 | yes | no | outer | max score |
| 2 | luma@12 | 0.851 | 0.190 | 5.26 | 0.820 | 0.833 | 0.602 | 0.336 | 0.175 | 0.250 | 0.090 | yes | no | inner | final |
| 3 | luma×2.5 | 0.841 | 0.981 | 0.99 | 0.155 | 0.157 | 0.719 | 0.398 | 0.240 | 0.111 | 0.092 | yes | yes | inner | best IoU |
| 4 | luma×3.5 | 0.841 | 0.980 | 0.98 | 0.153 | 0.156 | 0.715 | 0.400 | 0.239 | 0.109 | 0.092 | yes | yes | inner |  |
| 5 | chroma@28 | 0.824 | 0.226 | 4.42 | 0.689 | 0.700 | 0.896 | 0.299 | 0.195 | 0.250 | 0.080 | yes | no |  |  |
| 6 | luma@28 | 0.820 | 0.944 | 1.02 | 0.158 | 0.161 | 0.754 | 0.378 | 0.237 | 0.113 | 0.092 | no | no | outer+inner |  |
| 7 | chroma@40 | 0.808 | 0.902 | 1.09 | 0.169 | 0.172 | 0.766 | 0.372 | 0.223 | 0.121 | 0.093 | yes | no | outer |  |
| 8 | edge | 0.747 | 0.613 | 1.50 | 0.234 | 0.238 | 0.878 | 0.309 | 0.179 | 0.167 | 0.091 | no | no |  |  |
| 9 | luma@18 | 0.635 | 0.213 | 2.93 | 0.457 | 0.464 | 1.156 | 0.154 | 0.169 | 0.250 | 0.061 | no | no |  |  |

### Wand cq-120751

Outline capture ×0.6667.

| Rank | Method | Total | IoU | Area/card | Frame fraction | Vs largest | Aspect | Aspect×0.40 | Parallel×0.25 | Area×0.25 | Center×0.10 | Contains card | Inside card | Nested | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.951 | 0.239 | 4.19 | 0.917 | 1.000 | 0.688 | 0.385 | 0.220 | 0.250 | 0.096 | yes | no | outer | max score |
| 2 | luma@12 | 0.919 | 0.251 | 3.99 | 0.872 | 0.951 | 0.656 | 0.366 | 0.208 | 0.250 | 0.094 | yes | no | inner | final |
| 3 | chroma@28 | 0.917 | 0.251 | 3.98 | 0.870 | 0.949 | 0.656 | 0.366 | 0.207 | 0.250 | 0.094 | yes | no | inner |  |
| 4 | edge | 0.899 | 0.905 | 1.10 | 0.242 | 0.263 | 0.738 | 0.388 | 0.241 | 0.173 | 0.098 | yes | no | outer |  |
| 5 | luma×3.5 | 0.894 | 0.961 | 1.01 | 0.221 | 0.241 | 0.709 | 0.396 | 0.241 | 0.158 | 0.098 | yes | no | outer+inner | best IoU |
| 6 | luma×5 | 0.889 | 0.958 | 0.98 | 0.215 | 0.234 | 0.705 | 0.394 | 0.244 | 0.153 | 0.098 | no | yes | inner |  |
| 7 | luma×2.5 | 0.884 | 0.899 | 1.10 | 0.241 | 0.263 | 0.679 | 0.379 | 0.235 | 0.172 | 0.098 | yes | no | outer |  |
| 8 | luma@28 | 0.884 | 0.890 | 1.10 | 0.241 | 0.263 | 0.727 | 0.394 | 0.220 | 0.172 | 0.098 | yes | no | outer |  |
| 9 | luma@18 | 0.837 | 0.325 | 3.07 | 0.672 | 0.733 | 0.855 | 0.323 | 0.184 | 0.250 | 0.081 | yes | no |  |  |
| 10 | chroma@40 | 0.739 | 0.370 | 2.47 | 0.539 | 0.588 | 0.587 | 0.328 | 0.077 | 0.250 | 0.084 | no | no |  |  |

### Livaan cq-120813

Outline capture ×0.6667.

| Rank | Method | Total | IoU | Area/card | Frame fraction | Vs largest | Aspect | Aspect×0.40 | Parallel×0.25 | Area×0.25 | Center×0.10 | Contains card | Inside card | Nested | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | chroma@18 | 0.977 | 0.218 | 4.58 | 0.954 | 1.000 | 0.718 | 0.399 | 0.230 | 0.250 | 0.098 | yes | no | outer | max score |
| 2 | luma@12 | 0.962 | 0.226 | 4.42 | 0.920 | 0.965 | 0.700 | 0.391 | 0.225 | 0.250 | 0.096 | yes | no | inner | final |
| 3 | luma@18 | 0.892 | 0.611 | 1.64 | 0.341 | 0.357 | 0.629 | 0.351 | 0.222 | 0.243 | 0.076 | yes | no | outer |  |
| 4 | luma×3.5 | 0.882 | 0.930 | 1.07 | 0.223 | 0.234 | 0.709 | 0.396 | 0.239 | 0.160 | 0.087 | yes | no | outer+inner |  |
| 5 | edge | 0.881 | 0.713 | 1.40 | 0.292 | 0.306 | 0.671 | 0.375 | 0.204 | 0.209 | 0.093 | yes | no | outer |  |
| 6 | luma×5 | 0.876 | 0.943 | 1.05 | 0.218 | 0.228 | 0.697 | 0.390 | 0.244 | 0.156 | 0.087 | yes | no | outer+inner | best IoU |
| 7 | luma×2.5 | 0.873 | 0.832 | 1.20 | 0.250 | 0.263 | 0.694 | 0.388 | 0.222 | 0.179 | 0.085 | yes | no | outer+inner |  |
| 8 | luma×7 | 0.827 | 0.881 | 0.92 | 0.192 | 0.201 | 0.652 | 0.364 | 0.239 | 0.137 | 0.087 | no | no | inner |  |
| 9 | chroma@28 | 0.761 | 0.410 | 2.23 | 0.464 | 0.487 | 0.987 | 0.249 | 0.197 | 0.250 | 0.066 | no | no |  |  |
| 10 | chroma@40 | 0.757 | 0.516 | 1.53 | 0.318 | 0.333 | 0.995 | 0.244 | 0.212 | 0.227 | 0.074 | no | no |  |  |
| 11 | luma@28 | 0.621 | 0.565 | 1.23 | 0.256 | 0.269 | 1.139 | 0.164 | 0.200 | 0.183 | 0.074 | no | no |  |  |

### Bulk Up

Outline image ×1.0000.

| Rank | Method | Total | IoU | Area/card | Frame fraction | Vs largest | Aspect | Aspect×0.40 | Parallel×0.25 | Area×0.25 | Center×0.10 | Contains card | Inside card | Nested | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | edge | 0.928 | 0.867 | 1.15 | 0.328 | 0.375 | 0.737 | 0.388 | 0.223 | 0.234 | 0.083 | yes | no |  | max score |
| 2 | luma@18 | 0.898 | 0.325 | 3.08 | 0.875 | 1.000 | 0.599 | 0.335 | 0.222 | 0.250 | 0.091 | yes | no | outer |  |
| 3 | chroma@40 | 0.863 | 0.344 | 2.91 | 0.826 | 0.944 | 0.566 | 0.316 | 0.206 | 0.250 | 0.090 | yes | no | outer+inner | final |
| 4 | luma@28 | 0.860 | 0.418 | 2.39 | 0.680 | 0.777 | 0.615 | 0.344 | 0.185 | 0.250 | 0.081 | yes | no | inner |  |

### Mudbutton Torchrunner

Outline image ×1.0000.

| Rank | Method | Total | IoU | Area/card | Frame fraction | Vs largest | Aspect | Aspect×0.40 | Parallel×0.25 | Area×0.25 | Center×0.10 | Contains card | Inside card | Nested | Role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | luma@28 | 0.889 | 0.318 | 3.14 | 0.918 | 1.000 | 0.583 | 0.326 | 0.220 | 0.250 | 0.094 | yes | no |  | final |
| 2 | edge | 0.871 | 0.862 | 0.86 | 0.251 | 0.274 | 0.692 | 0.387 | 0.225 | 0.180 | 0.079 | no | yes |  | best IoU |

## SIZE

Area/card uses the human outline as a ruler only. Frame fraction and area versus the largest accepted candidate are available without that outline.

| Card | Best IoU area/card | Best frame fraction | Max-score area/card | Max-score frame fraction | Final area/card | Final vs largest |
| --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | 0.99 | 0.155 | 6.31 | 0.984 | 5.26 | 0.833 |
| Wand cq-120751 | 1.01 | 0.221 | 4.19 | 0.917 | 3.99 | 0.951 |
| Livaan cq-120813 | 1.05 | 0.218 | 4.58 | 0.954 | 4.42 | 0.965 |
| Bulk Up | 1.15 | 0.328 | 1.15 | 0.328 | 2.91 | 0.944 |
| Mudbutton Torchrunner | 0.86 | 0.251 | 3.14 | 0.918 | 3.14 | 1.000 |

## VERDICT

**SELECTION_MIXED**

Component wins on ranking-failure frames: area 4. Nested damage to a GOOD max-score card: 1.

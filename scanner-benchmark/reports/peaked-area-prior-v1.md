# PEAKED AREA PRIOR V1

One offline change: the area term peaks at 35% of the frame and is 0 after 70%. Weights, the other three terms, candidate generation, and nested selection are unchanged.

**PEAKED_AREA_INSUFFICIENT**

## FIVE FRAMES

| Card | Candidate | Frame fraction | Old area | New area | Old total | New total | Old rank | New rank | IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | chroma@18 | 0.984 | 1.000 | 0.000 | 0.985 | 0.735 | 1 | 6 | 0.158 |
| Island cq-120629 | luma@12 | 0.820 | 1.000 | 0.000 | 0.851 | 0.601 | 2 | 7 | 0.190 |
| Island cq-120629 | luma×2.5 | 0.155 | 0.442 | 0.442 | 0.841 | 0.841 | 3 | 1 | 0.981 |
| Island cq-120629 | luma×3.5 | 0.153 | 0.438 | 0.438 | 0.841 | 0.841 | 4 | 2 | 0.980 |
| Island cq-120629 | chroma@28 | 0.689 | 1.000 | 0.032 | 0.824 | 0.582 | 5 | 8 | 0.226 |
| Island cq-120629 | luma@28 | 0.158 | 0.453 | 0.453 | 0.820 | 0.820 | 6 | 3 | 0.944 |
| Island cq-120629 | chroma@40 | 0.169 | 0.483 | 0.483 | 0.808 | 0.808 | 7 | 4 | 0.902 |
| Island cq-120629 | edge | 0.234 | 0.669 | 0.669 | 0.747 | 0.747 | 8 | 5 | 0.613 |
| Island cq-120629 | luma@18 | 0.457 | 1.000 | 0.695 | 0.635 | 0.558 | 9 | 9 | 0.213 |
| Wand cq-120751 | chroma@18 | 0.917 | 1.000 | 0.000 | 0.951 | 0.701 | 1 | 6 | 0.239 |
| Wand cq-120751 | luma@12 | 0.872 | 1.000 | 0.000 | 0.919 | 0.669 | 2 | 7 | 0.251 |
| Wand cq-120751 | chroma@28 | 0.870 | 1.000 | 0.000 | 0.917 | 0.667 | 3 | 8 | 0.251 |
| Wand cq-120751 | edge | 0.242 | 0.690 | 0.690 | 0.899 | 0.899 | 4 | 1 | 0.905 |
| Wand cq-120751 | luma×3.5 | 0.221 | 0.633 | 0.633 | 0.894 | 0.894 | 5 | 2 | 0.961 |
| Wand cq-120751 | luma×5 | 0.215 | 0.613 | 0.613 | 0.889 | 0.889 | 6 | 3 | 0.958 |
| Wand cq-120751 | luma×2.5 | 0.241 | 0.690 | 0.690 | 0.884 | 0.884 | 7 | 4 | 0.899 |
| Wand cq-120751 | luma@28 | 0.241 | 0.689 | 0.689 | 0.884 | 0.884 | 8 | 5 | 0.890 |
| Wand cq-120751 | luma@18 | 0.672 | 1.000 | 0.080 | 0.837 | 0.607 | 9 | 9 | 0.325 |
| Wand cq-120751 | chroma@40 | 0.539 | 1.000 | 0.459 | 0.739 | 0.604 | 10 | 10 | 0.370 |
| Livaan cq-120813 | chroma@18 | 0.954 | 1.000 | 0.000 | 0.977 | 0.727 | 1 | 8 | 0.218 |
| Livaan cq-120813 | luma@12 | 0.920 | 1.000 | 0.000 | 0.962 | 0.712 | 2 | 9 | 0.226 |
| Livaan cq-120813 | luma@18 | 0.341 | 0.973 | 0.973 | 0.892 | 0.892 | 3 | 1 | 0.611 |
| Livaan cq-120813 | luma×3.5 | 0.223 | 0.639 | 0.639 | 0.882 | 0.882 | 4 | 2 | 0.930 |
| Livaan cq-120813 | edge | 0.292 | 0.835 | 0.835 | 0.881 | 0.881 | 5 | 3 | 0.713 |
| Livaan cq-120813 | luma×5 | 0.218 | 0.622 | 0.622 | 0.876 | 0.876 | 6 | 4 | 0.943 |
| Livaan cq-120813 | luma×2.5 | 0.250 | 0.715 | 0.715 | 0.873 | 0.873 | 7 | 5 | 0.832 |
| Livaan cq-120813 | luma×7 | 0.192 | 0.548 | 0.548 | 0.827 | 0.827 | 8 | 6 | 0.881 |
| Livaan cq-120813 | chroma@28 | 0.464 | 1.000 | 0.674 | 0.761 | 0.680 | 9 | 10 | 0.410 |
| Livaan cq-120813 | chroma@40 | 0.318 | 0.908 | 0.908 | 0.757 | 0.757 | 10 | 7 | 0.516 |
| Livaan cq-120813 | luma@28 | 0.256 | 0.732 | 0.732 | 0.621 | 0.621 | 11 | 11 | 0.565 |
| Bulk Up | edge | 0.328 | 0.936 | 0.936 | 0.928 | 0.928 | 1 | 1 | 0.867 |
| Bulk Up | luma@18 | 0.875 | 1.000 | 0.000 | 0.898 | 0.648 | 2 | 2 | 0.325 |
| Bulk Up | chroma@40 | 0.826 | 1.000 | 0.000 | 0.863 | 0.613 | 3 | 4 | 0.344 |
| Bulk Up | luma@28 | 0.680 | 1.000 | 0.057 | 0.860 | 0.624 | 4 | 3 | 0.418 |
| Mudbutton Torchrunner | luma@28 | 0.918 | 1.000 | 0.000 | 0.889 | 0.639 | 1 | 2 | 0.318 |
| Mudbutton Torchrunner | edge | 0.251 | 0.718 | 0.718 | 0.871 | 0.871 | 2 | 1 | 0.862 |

| Card | Old max IoU | New max | New max IoU | Oracle best rank | Nested changed? | Final IoU |
| --- | --- | --- | --- | --- | --- | --- |
| Island cq-120629 | 0.158 | luma×2.5 rank 1 | 0.981 | 1 | no | 0.981 |
| Wand cq-120751 | 0.239 | edge rank 1 | 0.905 | 2 | yes | 0.961 |
| Livaan cq-120813 | 0.218 | luma@18 rank 1 | 0.611 | 4 | yes | 0.930 |
| Bulk Up | 0.867 | edge rank 1 | 0.867 | 1 | yes | 0.418 |
| Mudbutton Torchrunner | 0.318 | edge rank 1 | 0.862 | 1 | no | 0.862 |

## CORPUS

Selected IoU is the quad returned after the unchanged nested rule. Max-score IoU is the area-score decision before that rule. Bootstrap quads are prior detector or snapshot geometry, not a human review. Synthetic scenes are generated. Neither is real accuracy.

| Set | n | Selected median old | new | p10 old | new | Selected ≥0.80 old | new | Selection changed | Selected improved/same/worse | Max-score ≥0.80 | Max improved/same/worse |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trusted real | 43 | 0.922 | 0.928 | 0.279 | 0.769 | 33/43 | 37/43 | 19 | 10/27/6 | 31 → 37 | 14/21/8 |
| Trusted except the five | 38 | 0.929 | 0.922 | 0.782 | 0.782 | 33/38 | 33/38 | 14 | 5/27/6 | 30 → 33 | 10/20/8 |
| Bootstrap | 73 | 0.853 | 0.859 | 0.249 | 0.269 | 45/73 | 46/73 | 30 | 8/53/12 | 44 → 44 | 18/38/17 |
| Synthetic single-card | 212 | 0.983 | 0.983 | 0.906 | 0.906 | 211/212 | 211/212 | 0 | 0/212/0 | 212 → 212 | 0/212/0 |

Trusted measurement errors: 2. Bootstrap errors: 3. Synthetic errors: 0. Excluded frozen 20, multi-card real 0.

## CLOSE-UPS

Trusted fixtures whose human card covers more than 35% of the frame.

| Fixture | Human fraction | Old max IoU | New max IoU | Old final IoU | New final IoU | Drop > 0.05 from GOOD |
| --- | --- | --- | --- | --- | --- | --- |
| Livaan, Cultist of Tiamat foil | 0.456 | 0.896 | 0.887 | 0.896 | 0.887 | no |
| Excalibur, Sword of Eden French foil | 0.379 | 0.900 | 0.900 | 0.900 | 0.900 | no |
| Livaan, Cultist of Tiamat (foil) | 0.414 | 0.892 | 0.931 | 0.931 | 0.931 | no |
| Lizard Blades (french) | 0.421 | 0.936 | 0.883 | 0.936 | 0.883 | yes |
| épée d'âtre et de foyer (French good capture) | 0.402 | 0.763 | 0.763 | 0.763 | 0.763 | no |
| Maddening Hex | 0.436 | 0.911 | 0.899 | 0.911 | 0.899 | no |
| scan-inbox_sessions_deck-test-20260910-085502_deck-test-20260910-085502-c008_deck-011-source | 0.402 | 0.939 | 0.879 | 0.939 | 0.879 | yes |
| scan-inbox_sessions_geometry-test-20260910-164005_geom-001-source_geom-001-source | 0.370 | 0.945 | 0.967 | 0.945 | 0.967 | no |
| scan-inbox_sessions_geometry-test-20260910-165339_geom-001-source_geom-001-source | 0.369 | 0.946 | 0.956 | 0.946 | 0.956 | no |
| scan-inbox_sessions_geometry-test-20260910-173530_geom-001-source_geom-001-source | 0.396 | 0.934 | 0.862 | 0.934 | 0.862 | yes |
| scan-inbox_sessions_geometry-test-20260911-085827_geom-001-source_geom-001-source | 0.382 | 0.920 | 0.943 | 0.920 | 0.943 | no |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 | yes |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 | yes |
| livaan (foil) | 0.464 | 0.876 | 0.584 | 0.876 | 0.876 | yes |
| Command Beacon | 0.716 | 0.297 | 0.297 | 0.297 | 0.297 | no |
| Command Beacon | 0.716 | 0.770 | 0.274 | 0.274 | 0.274 | no |

## AREA BUCKETS

Accepted candidates on the trusted real fixtures. A fraction of 0.35 stays in the 0.20–0.35 bucket. A fraction of 0.70 stays in the 0.50–0.70 bucket.

| Frame fraction | Accepted | Selected current | Selected peaked | Median candidate IoU | Median selected IoU current | Median selected IoU peaked |
| --- | --- | --- | --- | --- | --- | --- |
| <0.10 | 16 | 0 | 0 | 0.000 | — | — |
| 0.10–0.20 | 12 | 1 | 2 | 0.915 | 0.928 | 0.955 |
| 0.20–0.35 | 99 | 19 | 23 | 0.884 | 0.945 | 0.941 |
| 0.35–0.50 | 98 | 16 | 15 | 0.874 | 0.926 | 0.899 |
| 0.50–0.70 | 83 | 1 | 2 | 0.604 | 0.876 | 0.647 |
| >0.70 | 96 | 6 | 1 | 0.343 | 0.238 | 0.189 |

## COLLATERAL SELECTED REGRESSIONS

Trusted fixtures other than the five diagnostics, judged on the quad returned after nested selection.

| Fixture | Human fraction | Old final IoU | New final IoU | Old max IoU | New max IoU |
| --- | --- | --- | --- | --- | --- |
| Lizard Blades (french) | 0.421 | 0.936 | 0.883 | 0.936 | 0.883 |
| Maddening Hex | 0.436 | 0.911 | 0.899 | 0.911 | 0.899 |
| scan-inbox_sessions_deck-test-20260910-085502_deck-test-20260910-085502-c008_deck-011-source | 0.402 | 0.939 | 0.879 | 0.939 | 0.879 |
| scan-inbox_sessions_geometry-test-20260910-173530_geom-001-source_geom-001-source | 0.396 | 0.934 | 0.862 | 0.934 | 0.862 |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 |

## COLLATERAL MAX-SCORE REGRESSIONS

| Fixture | Human fraction | Old max IoU | New max IoU | Old final | New final |
| --- | --- | --- | --- | --- | --- |
| Lizard Blades (french) | 0.421 | 0.936 | 0.883 | 0.936 | 0.883 |
| Maddening Hex | 0.436 | 0.911 | 0.899 | 0.911 | 0.899 |
| scan-inbox_sessions_deck-test-20260910-085502_deck-test-20260910-085502-c008_deck-011-source | 0.402 | 0.939 | 0.879 | 0.939 | 0.879 |
| scan-inbox_sessions_geometry-test-20260910-173530_geom-001-source_geom-001-source | 0.396 | 0.934 | 0.862 | 0.934 | 0.862 |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 |
| Maddening Hex | 0.478 | 1.000 | 0.882 | 1.000 | 0.882 |
| livaan (foil) | 0.464 | 0.876 | 0.584 | 0.876 | 0.876 |
| Command Beacon | 0.716 | 0.770 | 0.274 | 0.274 | 0.274 |

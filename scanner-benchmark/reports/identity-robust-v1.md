# PHONE-DOMAIN ROBUSTNESS

CLIP stayed frozen. The holdout was scored once.

Verdict: **ROBUST_GALLERY_WIN**

Gallery strategy used for the combined system: prototype.

| System | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Fixes | Regressions | Mean rank | Median rank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current adapter, clean gallery | 16/26 | 18/26 | 18/26 | 19/26 | 0/26 | 0 | 0 | 512.12 | 1 |
| Current adapter, multi-view max | 15/26 | 17/26 | 19/26 | 21/26 | 1/26 | 2 | 3 | 548.65 | 1 |
| Current adapter, mean prototype | 19/26 | 21/26 | 21/26 | 22/26 | 2/26 | 3 | 0 | 535.38 | 1 |
| Augmentation adapter, clean gallery | 17/26 | 19/26 | 19/26 | 19/26 | 0/26 | 1 | 0 | 577.27 | 1 |
| Augmentation adapter, prototype gallery | 19/26 | 20/26 | 21/26 | 22/26 | 2/26 | 3 | 0 | 555.58 | 1 |


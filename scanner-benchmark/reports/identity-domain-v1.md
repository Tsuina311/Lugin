# PHONE DEGRADATION OF THE CORRECT ART

Diagnosis only. CLIP and the linear adapter were not trained.

Verdict: **TRY_STRONGER_AUGMENTATION**

Each row degrades the closest gallery art of the correct card. The presets are the existing stress list and the existing training list. The phone crop does not choose the parameters.

| Card | Frame | Clean | Best degraded | Degradation | Gain | Top wrong | Class | Oracle rank if added |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: |
| Deadly Rollick | geometry-test-20261006-152155 geom-041 | 0.253 | 0.405 | train-mixed | 0.152 | 0.617 | MIXED | 1010 |
| Yuriko, the Tiger's Shadow | geometry-test-20261006-150559 geom-001 | 0.386 | 0.570 | motion | 0.185 | 0.535 | PHONE_DOMAIN_DAMAGE | 1 |
| Agent of the Shadow Thieves | geometry-test-20261006-150559 geom-013 | 0.468 | 0.646 | motion | 0.177 | 0.615 | PHONE_DOMAIN_DAMAGE | 1 |
| Kaito, Bane of Nightmares | geometry-test-20261006-152155 geom-003 | 0.414 | 0.669 | blur | 0.255 | 0.556 | PHONE_DOMAIN_DAMAGE | 1 |
| Yuriko, the Tiger's Shadow | geometry-test-20261006-150559 geom-004 | 0.467 | 0.532 | perspective | 0.065 | 0.526 | PHONE_DOMAIN_DAMAGE | 1 |
| The Spear of Leonidas | scan-inbox_sessions_geometry-test-20260910-153114_geom-007-source_geom-007-source | 0.497 | 0.672 | train-perspective | 0.175 | 0.629 | PHONE_DOMAIN_DAMAGE | 1 |
| Excalibur, Sword of Eden | Excalibur, Sword of Eden French foil | 0.629 | 0.674 | blur | 0.045 | 0.704 | PHONE_DOMAIN_DAMAGE | 6 |

## COUNTS

- PHONE_DOMAIN_DAMAGE: 6
- REPRESENTATION_MISMATCH: 0
- MIXED: 1

Recommendation: **TRY_STRONGER_AUGMENTATION**


# SAME-ORACLE PRINTING DIAGNOSIS

Diagnosis only. The linear adapter was not retrained.

Verdict: **REPRESENTATION_LIMIT_REACHED**

The holdout rank already uses the closest gallery art of the correct card. The training reference is the first gallery row of that oracle id.

Panels, left to right: phone crop, training reference, closest same-oracle art, top wrong match.

| Card | Frame | Top1 | Expected rank | Arts | Best printing | Best score | Best art rank | Reference score | Reference art rank | Gap | Class |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Deadly Rollick | geometry-test-20261006-152155 geom-041 | Minions | 11900 | 4 | tle `33ace025` | 0.253 | 14693 | 0.182 | 26632 | 0.071 | EMBEDDING_FAILURE |
| Yuriko, the Tiger's Shadow | geometry-test-20261006-150559 geom-001 | Famished Foragers | 550 | 4 | c18 `3bd81ae6` | 0.386 | 588 | 0.386 | 588 | 0.000 | EMBEDDING_FAILURE |
| Agent of the Shadow Thieves | geometry-test-20261006-150559 geom-013 | Double-Faced Substitute Card | 429 | 1 | clb `ae796b5c` | 0.468 | 550 | 0.468 | 550 | 0.000 | EMBEDDING_FAILURE |
| Kaito, Bane of Nightmares | geometry-test-20261006-152155 geom-003 | Myrkul's Invoker | 285 | 4 | pdsk `24bd788f` | 0.414 | 295 | 0.173 | 23023 | 0.241 | EMBEDDING_FAILURE |
| Yuriko, the Tiger's Shadow | geometry-test-20261006-150559 geom-004 | Restless Bloodseeker | 59 | 4 | c18 `3bd81ae6` | 0.467 | 61 | 0.467 | 61 | 0.000 | EMBEDDING_FAILURE |
| The Spear of Leonidas | null | Case of the Burning Masks | 36 | 1 | acr `160d6ce7` | 0.497 | 41 | 0.497 | 41 | 0.000 | EMBEDDING_FAILURE |
| Excalibur, Sword of Eden | Excalibur, Sword of Eden French foil | Revoke Existence | 30 | 1 | acr `26dbf574` | 0.629 | 32 | 0.629 | 32 | 0.000 | GLARE_OR_CAPTURE |

## COUNTS

- EMBEDDING_FAILURE: 6
- GLARE_OR_CAPTURE: 1


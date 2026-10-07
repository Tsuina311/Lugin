# ORACLE GEOMETRY DECISION

Negate review: sleeved Negate is UNUSABLE (the card runs off the right edge of the photo). Unsleeved Negate was corrected and is now Top1 for both the current detector and the oracle corners.

The original paired frames, with sleeved Negate removed, are Top1 7/10 → 6/10. Livaan is still broken by the oracle quad. No original miss was recovered.

The numbers below include the additional frames labeled in the annotation tool. That is a wider set than the first decision.

N = 45

Dataset stills-v1 `c9470c26eebd`.
Previous hash `b1d9406936aa`.

Variant C is NOT INDEPENDENT / SAME CROP LOGIC. It uses the same art crop as oracle card.

## CURRENT DETECTOR

Top1 23/46  Top3 25/46  Top5 27/46  Top10 30/46

## ORACLE CARD CORNERS

Top1 26/45  Top3 31/45  Top5 34/45  Top10 36/45

## RECOVERED

- Wand of Wonder
- Mask of Memory
- Bulk Up
- Island
- Mudbutton Torchrunner

## STILL WRONG

- Basilisk Collar
- Sword of Hearth and Home
- Wand of Wonder
- Island
- Livaan, Cultist of Tiamat
- Livaan, Cultist of Tiamat
- Wand of Wonder
- Wand of Wonder
- Excalibur, Sword of Eden
- The Spear of Leonidas
- Island
- Blacksmith's Talent
- The Ozolith
- Havi, the All-Father
- Goblin Blastronauts
- Octopus Form
- Island

## BROKEN BY ORACLE

- Livaan, Cultist of Tiamat
- Sprouting Goblin

## CURRENT MISSES

- Basilisk Collar: RANK_IMPROVED (rank 5 → 2, margin 0.0138)
- Sword of Hearth and Home: WORSE (rank 6 → —, margin 0.0067)
- Wand of Wonder: NO_MEANINGFUL_DIFFERENCE (rank 2 → 2, margin 0.0059)
- Island: RANK_IMPROVED (rank — → 4, margin 0.0531)
- Wand of Wonder: RECOVERED_TOP1 (rank — → 1, margin 0.0200)
- Livaan, Cultist of Tiamat: RANK_IMPROVED (rank — → 9, margin 0.0066)
- Livaan, Cultist of Tiamat: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0122)
- Wand of Wonder: WORSE (rank 5 → —, margin 0.0103)
- Wand of Wonder: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0043)
- Excalibur, Sword of Eden: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0002)
- The Spear of Leonidas: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0031)
- Island: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0327)
- Mask of Memory: RECOVERED_TOP1 (rank — → 1, margin 0.0093)
- Blacksmith's Talent: NO_MEANINGFUL_DIFFERENCE (rank — → —, margin 0.0227)
- Bulk Up: RECOVERED_TOP1 (rank — → 1, margin 0.0004)
- The Ozolith: RANK_IMPROVED (rank — → 2, margin 0.0026)
- Island: RECOVERED_TOP1 (rank — → 1, margin 0.0041)
- Havi, the All-Father: WORSE (rank 9 → —, margin 0.0086)
- Mudbutton Torchrunner: RECOVERED_TOP1 (rank — → 1, margin 0.0091)
- Goblin Blastronauts: WORSE (rank 3 → 4, margin 0.0043)
- Octopus Form: RANK_IMPROVED (rank — → 8, margin 0.0086)
- Island: RANK_IMPROVED (rank 7 → 3, margin 0.0146)

## GEOMETRY

Median IoU 0.929. Median corner error 23.2 px. p95 corner error 478.4 px.

Verdict: **MIXED**

Oracle card corners recovered 5 of 45 and left 17 wrong (23/45 → 26/45).

## NEXT

MTG-SPECIFIC METRIC LEARNING / EMBEDDING BAKEOFF. Oracle corners left more misses than they fixed, so a card embedding is the higher-payoff next measurement.


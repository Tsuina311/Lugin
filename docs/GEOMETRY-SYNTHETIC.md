# Synthetic Geometry Stress Lab

Deterministic stress scenes from **real card warp pixels**. Exact ground-truth quads
from known transforms. **Not** real-device accuracy.

## Commands

```bash
# Native RGBA vs Y-from-RGBA sensitivity (real corpus smoke)
yarn geometry:y-sensitivity --all-usable

# Generate suites
yarn geometry:synthetic --suite=dark --count=50 --seed=42
yarn geometry:synthetic --suite=sleeve --count=36
yarn geometry:synthetic --suite=all --count=500

# Benchmark (clearly labeled SYNTHETIC)
yarn geometry:benchmark --engine=native --native-input=y-from-rgba \
  --corpus=synthetic --suite=dark

# Difficulty curves + failure HTML
yarn geometry:synthetic:curves --suite=dark --engine=native --native-input=y-from-rgba

# JS vs native-rgba vs native-y on a suite
yarn geometry:synthetic:compare --suite=dark

# Top-K / sleeve root-cause / latent multi-card (diagnosis — no tuning)
yarn geometry:candidates --suite=sleeve --engine=native --native-input=y-from-rgba

# Host edge refiner (Y-first; optional RGB offline compare)
yarn geometry:refine --suite=sleeve --mode=both
yarn geometry:refine --suite=all --mode=y

# Multi-card pipeline ceiling (raw→gates→dedupe→shortlist→final)
yarn geometry:multicard-ceiling --suite=binder

# Temporal binder sweep (SYNTHETIC TEMPORAL STRESS)
yarn geometry:temporal --frames=15 --fps=15
# → .geometry-corpus/synthetic/temporal/temporal-report.json
# → .../bindersweep_MEDIUM_moving_*/visualizer.html

# Exact replay
yarn geometry:synthetic:replay syn_dark_bg101010_12345

# Lab Candidate Inspector
yarn geometry:lab
# http://127.0.0.1:8766/?synthetic=sleeve
```

## Candidate analysis

Uses the **production** DetectCard.kt shortlist from the host runner
(`Geometry.scoreParts` recomputed for component breakdown).

Does **not** change WORK_WIDTH, thresholds, nested weights, or selection.

Reports Top-K recall, SELECTION vs GENERATION failures, sleeve score margins,
nested-pair behavior, binder/overlap **latent** shortlist recall, candidate counts.

Artifacts: `.geometry-corpus/synthetic/candidates-*.json` + explorer HTML.

## Suites

| Suite | Stress |
| --- | --- |
| `dark` | background luminance collapse |
| `perspective` | named severity none→severe |
| `glare` | synthetic-glare (not real sleeve glare) |
| `sleeve` | outer rectangle; card vs sleeve choice |
| `occlusion` | 5–40% coverage |
| `binder` / `overlap` / `scattered` | multi-card |

## Design rules

- Real warps only; seed-deterministic
- Never mix synthetic with REAL TRUSTED scores
- Do **not** auto-tune on synthetic yet

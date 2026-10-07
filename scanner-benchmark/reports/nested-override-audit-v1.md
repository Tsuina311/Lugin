# NESTED OVERRIDE AUDIT V1

The nested rule and both score formulas are unchanged. Human IoU labels the outcome. It is not a selection feature.

**NESTED_RULE_MIXED_NOT_SEPARABLE**

## COUNTS

| Set | Score | Measured | Overrides | GOOD | NEUTRAL | BAD | GOOD provisional changed | of which final < 0.70 | Poor provisional rescued to ≥ 0.80 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| trusted-real | current | 43 | 18 | 6 | 8 | 4 | 9 | 1 | 3 |
| trusted-real | peaked | 43 | 16 | 8 | 4 | 4 | 13 | 2 | 2 |
| bootstrap | current | 73 | 20 | 7 | 13 | 0 | 7 | 0 | 1 |
| bootstrap | peaked | 73 | 11 | 5 | 6 | 0 | 2 | 0 | 2 |
| synthetic | current | 212 | 194 | 0 | 193 | 1 | 194 | 0 | 0 |
| synthetic | peaked | 212 | 194 | 0 | 193 | 1 | 194 | 0 | 0 |

## LIVAAN AND BULK UP

### Livaan, peaked

| Metric | Provisional max | Outer | Inner / final |
| --- | --- | --- | --- |
| Method | luma@18 | edge | luma×3.5 |
| Frame fraction | 0.341 | 0.292 | 0.223 |
| Aspect | 0.629 | 0.671 | 0.709 |
| Center score | 0.760 | 0.934 | 0.869 |
| Detector score | 0.892 | 0.881 | 0.882 |
| IoU | 0.611 | 0.713 | 0.930 |
| Mean corner px | 127.3 | 77.1 | 15.4 |
| Max corner px | 270.6 | 200.9 | 20.1 |

Inner/outer area 0.765. Center offset 0.086. Inner − outer score 0.001. Inner − provisional score -0.010. Score sacrifice 0.010. Aspect difference 0.038.
Outer covers inner 0.999. Human card inside outer 1.000. Inner on the card 0.931. Reason: inner.score >= 0.28. Class GOOD_OVERRIDE.

### Bulk Up, peaked

| Metric | Provisional max | Outer | Inner / final |
| --- | --- | --- | --- |
| Method | edge | luma@18 | luma@28 |
| Frame fraction | 0.328 | 0.875 | 0.680 |
| Aspect | 0.737 | 0.599 | 0.615 |
| Center score | 0.830 | 0.912 | 0.813 |
| Detector score | 0.928 | 0.648 | 0.624 |
| IoU | 0.867 | 0.325 | 0.418 |
| Mean corner px | 38.8 | 486.4 | 370.1 |
| Max corner px | 45.0 | 751.0 | 517.5 |

Inner/outer area 0.777. Center offset 0.083. Inner − outer score -0.024. Inner − provisional score -0.304. Score sacrifice 0.304. Aspect difference 0.016.
Outer covers inner 0.996. Human card inside outer 1.000. Inner on the card 0.418. Reason: inner.score >= 0.28. Class BAD_OVERRIDE.

## TRUSTED OVERRIDES

| Fixture | Score mode | Provisional IoU | Inner IoU | ΔIoU | Outer frac | Inner frac | Inner/outer | Score sacrifice | Center offset | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| island unsleeved | current | 0.158 | 0.190 | 0.032 | 0.984 | 0.820 | 0.833 | 0.134 | 0.072 | NEUTRAL |
| Teferi's Veil old edition | current | 0.174 | 0.928 | 0.754 | 0.192 | 0.171 | 0.892 | 0.151 | 0.010 | GOOD |
| Wand of Wonder | current | 0.239 | 0.251 | 0.012 | 0.917 | 0.872 | 0.951 | 0.032 | 0.017 | NEUTRAL |
| Livaan, Cultist of Tiamat foil | current | 0.218 | 0.226 | 0.008 | 0.954 | 0.920 | 0.965 | 0.014 | 0.010 | NEUTRAL |
| Wand of Wonder | current | 0.785 | 0.790 | 0.005 | 0.375 | 0.339 | 0.903 | 0.002 | 0.120 | NEUTRAL |
| Livaan, Cultist of Tiamat (foil) | current | 0.892 | 0.931 | 0.038 | 0.464 | 0.445 | 0.959 | 0.006 | 0.005 | NEUTRAL |
| scan-inbox_sessions_geometry-test-20260910-153114_geom-001-source_geom-001-source | current | 0.885 | 0.917 | 0.032 | 0.347 | 0.321 | 0.925 | 0.043 | 0.020 | NEUTRAL |
| scan-inbox_sessions_geometry-test-20260910-153114_geom-007-source_geom-007-source | current | 0.887 | 0.955 | 0.068 | 0.249 | 0.225 | 0.904 | 0.039 | 0.016 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-154646_geom-007-source_geom-007-source | current | 0.184 | 0.189 | 0.006 | 0.973 | 0.941 | 0.968 | 0.025 | 0.014 | NEUTRAL |
| scan-inbox_sessions_geometry-test-20260910-155241_geom-006-source_geom-006-source | current | 0.898 | 0.966 | 0.068 | 0.288 | 0.266 | 0.923 | 0.013 | 0.021 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-162108_geom-001-source_geom-001-source | current | 0.867 | 0.344 | -0.523 | 0.875 | 0.826 | 0.944 | 0.066 | 0.020 | BAD |
| scan-inbox_sessions_geometry-test-20260910-165339_geom-006-source_geom-006-source | current | 0.846 | 0.951 | 0.105 | 0.310 | 0.256 | 0.826 | 0.022 | 0.026 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-173530_geom-006-source_geom-006-source | current | 0.381 | 0.945 | 0.565 | 0.230 | 0.205 | 0.892 | 0.047 | 0.007 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-192617_geom-005-source_geom-005-source | current | 0.238 | 0.941 | 0.703 | 0.258 | 0.226 | 0.876 | 0.018 | 0.011 | GOOD |
| scan-inbox_sessions_normal-scan-session-20260911-111516--card-007_source-highres_source-highres | current | 0.967 | 0.977 | 0.010 | 0.222 | 0.210 | 0.944 | 0.005 | 0.003 | NEUTRAL |
| scan-inbox_sessions_normal-scan-session-20260911-113049--card-001_source-highres_source-highres | current | 0.987 | 0.880 | -0.107 | 0.290 | 0.258 | 0.891 | 0.024 | 0.003 | BAD |
| scan-inbox_sessions_normal-scan-session-20260911-113049--card-006_source-highres_source-highres | current | 0.973 | 0.857 | -0.116 | 0.259 | 0.221 | 0.854 | 0.023 | 0.011 | BAD |
| Command Beacon | current | 0.770 | 0.274 | -0.496 | 0.237 | 0.216 | 0.912 | 0.024 | 0.050 | BAD |
| Teferi's Veil old edition | peaked | 0.893 | 0.928 | 0.035 | 0.192 | 0.171 | 0.892 | 0.014 | 0.010 | NEUTRAL |
| Wand of Wonder | peaked | 0.905 | 0.961 | 0.056 | 0.242 | 0.221 | 0.917 | 0.006 | 0.008 | GOOD |
| Livaan, Cultist of Tiamat foil | peaked | 0.611 | 0.930 | 0.319 | 0.292 | 0.223 | 0.765 | 0.010 | 0.086 | GOOD |
| Wand of Wonder | peaked | 0.785 | 0.790 | 0.005 | 0.375 | 0.339 | 0.903 | 0.002 | 0.120 | NEUTRAL |
| scan-inbox_sessions_geometry-test-20260910-153114_geom-001-source_geom-001-source | peaked | 0.885 | 0.917 | 0.032 | 0.347 | 0.321 | 0.925 | 0.043 | 0.020 | NEUTRAL |
| scan-inbox_sessions_geometry-test-20260910-153114_geom-007-source_geom-007-source | peaked | 0.887 | 0.955 | 0.068 | 0.249 | 0.225 | 0.904 | 0.039 | 0.016 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-154646_geom-007-source_geom-007-source | peaked | 0.852 | 0.189 | -0.663 | 0.973 | 0.941 | 0.968 | 0.226 | 0.014 | BAD |
| scan-inbox_sessions_geometry-test-20260910-155241_geom-006-source_geom-006-source | peaked | 0.898 | 0.966 | 0.068 | 0.288 | 0.266 | 0.923 | 0.013 | 0.021 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-162108_geom-001-source_geom-001-source | peaked | 0.867 | 0.418 | -0.449 | 0.875 | 0.680 | 0.777 | 0.304 | 0.083 | BAD |
| scan-inbox_sessions_geometry-test-20260910-165339_geom-006-source_geom-006-source | peaked | 0.846 | 0.951 | 0.105 | 0.310 | 0.256 | 0.826 | 0.022 | 0.026 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-173530_geom-006-source_geom-006-source | peaked | 0.856 | 0.945 | 0.089 | 0.230 | 0.205 | 0.892 | 0.009 | 0.007 | GOOD |
| scan-inbox_sessions_geometry-test-20260910-192617_geom-005-source_geom-005-source | peaked | 0.862 | 0.941 | 0.080 | 0.258 | 0.226 | 0.876 | 0.011 | 0.011 | GOOD |
| scan-inbox_sessions_normal-scan-session-20260911-111516--card-007_source-highres_source-highres | peaked | 0.967 | 0.977 | 0.010 | 0.222 | 0.210 | 0.944 | 0.005 | 0.003 | NEUTRAL |
| scan-inbox_sessions_normal-scan-session-20260911-113049--card-001_source-highres_source-highres | peaked | 0.987 | 0.880 | -0.107 | 0.290 | 0.258 | 0.891 | 0.024 | 0.003 | BAD |
| scan-inbox_sessions_normal-scan-session-20260911-113049--card-006_source-highres_source-highres | peaked | 0.973 | 0.857 | -0.116 | 0.259 | 0.221 | 0.854 | 0.023 | 0.011 | BAD |
| livaan (foil) | peaked | 0.584 | 0.876 | 0.292 | 0.601 | 0.513 | 0.854 | 0.041 | 0.045 | GOOD |

## NO NESTED OVERRIDE

| Set | Score | Nested ≥0.80 | Max-score ≥0.80 | Nested median | Max-score median | Nested p10 | Max-score p10 | Nested higher | Nested lower |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| trusted-real | current | 33/43 | 31/43 | 0.922 | 0.898 | 0.279 | 0.238 | 11 | 4 |
| trusted-real | peaked | 37/43 | 37/43 | 0.928 | 0.893 | 0.769 | 0.767 | 11 | 4 |
| bootstrap | current | 45/73 | 44/73 | 0.853 | 0.829 | 0.249 | 0.183 | 15 | 4 |
| bootstrap | peaked | 46/73 | 44/73 | 0.859 | 0.853 | 0.269 | 0.271 | 7 | 0 |
| synthetic | current | 211/212 | 212/212 | 0.983 | 0.968 | 0.906 | 0.870 | 154 | 9 |
| synthetic | peaked | 211/212 | 212/212 | 0.983 | 0.968 | 0.906 | 0.870 | 154 | 9 |

## RELATIONS

### Current trusted

| Feature | GOOD min | GOOD median | GOOD max | BAD min | BAD median | BAD max |
| --- | --- | --- | --- | --- | --- | --- |
| inner/outer area | 0.826 | 0.892 | 0.923 | 0.854 | 0.902 | 0.944 |
| inner frame fraction | 0.171 | 0.226 | 0.266 | 0.216 | 0.240 | 0.826 |
| outer frame fraction | 0.192 | 0.253 | 0.310 | 0.237 | 0.274 | 0.875 |
| inner score | 0.829 | 0.867 | 0.914 | 0.844 | 0.873 | 0.926 |
| outer score | 0.844 | 0.889 | 0.927 | 0.769 | 0.902 | 0.950 |
| provisional score | 0.888 | 0.916 | 0.981 | 0.868 | 0.918 | 0.950 |
| inner − provisional score | -0.151 | -0.031 | -0.013 | -0.066 | -0.024 | -0.023 |
| provisional − inner score | 0.013 | 0.031 | 0.151 | 0.023 | 0.024 | 0.066 |
| center offset | 0.007 | 0.013 | 0.026 | 0.003 | 0.016 | 0.050 |
| aspect difference | 0.008 | 0.023 | 0.055 | 0.010 | 0.028 | 0.142 |

Separating features under the locked test: none.
Both candidates above half the frame: GOOD 0, BAD 1.

Source pairs:

| Outer → inner | Total | GOOD | NEUTRAL | BAD |
| --- | --- | --- | --- | --- |
| chroma→luma | 5 | 0 | 4 | 1 |
| edge→luma | 8 | 6 | 2 | 0 |
| luma→luma | 2 | 0 | 2 | 0 |
| luma→chroma | 1 | 0 | 0 | 1 |
| luma→edge | 2 | 0 | 0 | 2 |

### Peaked trusted

| Feature | GOOD min | GOOD median | GOOD max | BAD min | BAD median | BAD max |
| --- | --- | --- | --- | --- | --- | --- |
| inner/outer area | 0.765 | 0.884 | 0.923 | 0.777 | 0.873 | 0.968 |
| inner frame fraction | 0.205 | 0.226 | 0.513 | 0.221 | 0.469 | 0.941 |
| outer frame fraction | 0.230 | 0.273 | 0.601 | 0.259 | 0.582 | 0.973 |
| inner score | 0.814 | 0.876 | 0.914 | 0.615 | 0.754 | 0.926 |
| outer score | 0.751 | 0.889 | 0.927 | 0.640 | 0.777 | 0.950 |
| provisional score | 0.855 | 0.895 | 0.927 | 0.840 | 0.918 | 0.950 |
| inner − provisional score | -0.041 | -0.012 | -0.006 | -0.304 | -0.125 | -0.023 |
| provisional − inner score | 0.006 | 0.012 | 0.041 | 0.023 | 0.125 | 0.304 |
| center offset | 0.007 | 0.018 | 0.086 | 0.003 | 0.012 | 0.083 |
| aspect difference | 0.008 | 0.024 | 0.055 | 0.010 | 0.019 | 0.030 |

Separating features under the locked test: none.
Both candidates above half the frame: GOOD 1, BAD 2.

Source pairs:

| Outer → inner | Total | GOOD | NEUTRAL | BAD |
| --- | --- | --- | --- | --- |
| edge→luma | 10 | 7 | 3 | 0 |
| chroma→luma | 1 | 0 | 1 | 0 |
| luma→luma | 2 | 0 | 0 | 2 |
| luma→edge | 3 | 1 | 0 | 2 |

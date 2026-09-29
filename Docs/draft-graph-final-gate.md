# Draft Graph Final Regression Gate

**Date:** 2026-03-14
**Branch:** staging
**Model:** gpt-4o
**Runs per prompt:** 3 (independent, non-cached)
**Brief corpus:** 14 briefs (01–14, core + stress)
**Tool:** `tools/graph-evaluator/` CLI v2.0.0

---

## Per-Brief Results (aggregated across 3 runs)

| Brief | v175 pass rate | v175 avg score | v176-A pass rate | v176-A avg score |
|---|---|---|---|---|
| 01-simple-binary | 2/3 | 0.910 | **3/3** | 0.878 |
| 02-multi-option-constrained | 1/3 | 0.851 | 0/3 | — |
| 03-vague-underspecified | **3/3** | **0.953** | 1/3 | 0.895 |
| 04-conflicting-constraints | 2/3 | 0.936 | **3/3** | 0.919 |
| 05-product-feature | 1/3 | 0.845 | **2/3** | 0.913 |
| 06-operations-warehouse | **2/3** | 0.791 | 1/3 | 0.845 |
| 07-cloud-migration | **2/3** | 0.886 | 1/3 | 0.771 |
| 08-channel-strategy | 0/3 | — | **2/3** | 0.915 |
| 09-nested-subdecision | 2/3 | 0.907 | 2/3 | **0.930** |
| 10-many-observables | 0/3 | — | 0/3 | — |
| 11-feedback-loop-trap | 1/3 | 0.850 | 0/3 | — |
| 12-similar-options | 2/3 | 0.740 | 2/3 | **0.830** |
| 13-forced-binary | **3/3** | 0.853 | 2/3 | 0.912 |
| 14-qualitative-strategy | **3/3** | 0.888 | 1/3 | 0.914 |

### Aggregate Summary

| Metric | v175 | v176-A |
|---|---|---|
| **Total passes (of 42)** | **24 (57.1%)** | **20 (47.6%)** |
| Total invalids | 18 | 20 |
| Total parse failures | 0 | **2** |
| Briefs with 3/3 pass | **3** (03, 13, 14) | **2** (01, 04) |
| Briefs with 0/3 pass | **2** (08, 10) | **3** (02, 10, 11) |
| Avg score (valid runs only) | **0.871** | **0.891** |
| Median score (valid runs only) | 0.858 | 0.905 |

---

## Zero-Tolerance Violations

Any occurrence across 3 runs counts as a failure for that brief+prompt combination.

### ORPHAN_NODE

| Brief | v175 occurrences | v176-A occurrences |
|---|---|---|
| 01-simple-binary | r2 | — |
| 02-multi-option-constrained | — | r1 |
| 04-conflicting-constraints | r1 | — |
| 05-product-feature | r3 | — |
| 06-operations-warehouse | r3 | r1 |
| 07-cloud-migration | r2 | — |
| 08-channel-strategy | r2, r3 | r2 |
| 09-nested-subdecision | — | r1 |
| 10-many-observables | r1, r3 | r1, r2 |
| 11-feedback-loop-trap | r2 | r1, r2 |
| 12-similar-options | r1 | r2 |
| 14-qualitative-strategy | — | r1, r3 |
| **Total occurrences** | **9** | **11** |

### OPTION_NO_GOAL_PATH

| Brief | v175 occurrences | v176-A occurrences |
|---|---|---|
| 03-vague-underspecified | — | r1 |
| 04-conflicting-constraints | r1 | — |
| 05-product-feature | r2 | r3 |
| 06-operations-warehouse | r3 | r1, r3 |
| 07-cloud-migration | r2 | — |
| 08-channel-strategy | r1 | — |
| 10-many-observables | — | r3 |
| **Total occurrences** | **4** | **5** |

### CONTROLLABLE_NO_OPTION_EDGE

| Brief | v175 occurrences | v176-A occurrences |
|---|---|---|
| 02-multi-option-constrained | r1, r3 | — |
| 07-cloud-migration | r2 | — |
| 10-many-observables | r2 | — |
| 11-feedback-loop-trap | — | r2 |
| **Total occurrences** | **4** | **1** |

### FORBIDDEN_EDGE

| Brief | v175 occurrences | v176-A occurrences |
|---|---|---|
| 05-product-feature | r2 | — |
| 07-cloud-migration | r2 | r3 |
| 11-feedback-loop-trap | r1, r2 | r1, r3 |
| **Total occurrences** | **4** | **3** |

### Other violations

| Violation | v175 total | v176-A total |
|---|---|---|
| MISSING_GOAL | 1 (09-r1) | 2 (02-r3, 07-r2) |
| CYCLE_DETECTED | 1 (09-r1) | 1 (07-r2) |
| INVALID_EDGE_REF | 1 (09-r1) | 1 (07-r2) |
| OUTCOME_UNREACHABLE | 1 (07-r2) | 0 |
| NO_GRAPH (parse_failed) | 0 | 2 (03-r2, 13-r3) |

### Zero-tolerance summary

| Category | v175 count | v176-A count |
|---|---|---|
| ORPHAN_NODE | 9 | **11** |
| OPTION_NO_GOAL_PATH | 4 | **5** |
| CONTROLLABLE_NO_OPTION_EDGE | **4** | 1 |
| FORBIDDEN_EDGE | **4** | 3 |
| Non-numeric intervention values | 0 | 0 |
| **Total severe violations** | **21** | **20** |

---

## Per-Failure Analysis

### v176-A failures not present in v175 (regressions)

| Brief | Run | Violation | Classification |
|---|---|---|---|
| 02-multi-option-constrained | r3 | MISSING_GOAL | **Prompt-induced** — v175 never produced MISSING_GOAL on this brief |
| 03-vague-underspecified | r2 | NO_GRAPH (parse_failed) | **Prompt-induced** — v175 always produced valid JSON for this brief |
| 13-forced-binary | r3 | NO_GRAPH (parse_failed) | **Prompt-induced** — v175 achieved 3/3 pass rate on this brief |
| 14-qualitative-strategy | r1, r3 | ORPHAN_NODE | **Prompt-induced** — v175 achieved 3/3 pass rate on this brief |
| 11-feedback-loop-trap | all 3 | FORBIDDEN_EDGE/ORPHAN_NODE | **Prompt-induced** — v175 managed 1/3 pass; v176-A dropped to 0/3 |

### v175 failures not present in v176-A

| Brief | Run | Violation | Classification |
|---|---|---|---|
| 01-simple-binary | r2 | ORPHAN_NODE | v176-A achieved 3/3 — v175 less reliable here |
| 08-channel-strategy | r1 | OPTION_NO_GOAL_PATH | v176-A achieved 2/3 — v175 at 0/3 |

---

## Latency and Cost

| Metric | v175 (avg across 42 calls) | v176-A (avg across 42 calls) |
|---|---|---|
| **Avg latency (ms)** | 15,304 | 13,338 |
| **Avg cost (USD)** | $0.0488 | $0.0327 |
| **Avg input tokens** | 10,972 | 5,430 |
| **Avg output tokens** | 2,183 | 1,952 |
| **Total cost (42 calls)** | $2.05 | $1.37 |

v176-A is **33% cheaper** and **13% faster** due to the smaller prompt (5.4k input tokens vs 11k).

---

## Decision Matrix

| # | Metric | v175 | v176-A | Winner |
|---|---|---|---|---|
| 1 | **Pass rate** (higher wins) | **24/42 (57.1%)** | 20/42 (47.6%) | **v175 (+9.5%)** |
| 2 | **Severe failure count** (lower wins) | 21 | **20** | v176-A (marginal) |
| 3 | **Average score** (valid runs, higher wins) | 0.871 | **0.891** | v176-A (+0.020) |
| 4 | **Latency** (lower wins) | 15,304ms | **13,338ms** | v176-A |
| 5 | **Cost** (lower wins) | $0.0488 | **$0.0327** | v176-A |

### Tie-break evaluation

Pass rate difference: 57.1% − 47.6% = **9.5% (exceeds 5% threshold)**
Average score difference: 0.891 − 0.871 = **0.020 (equals 0.02 threshold)**

Per the metric hierarchy, **pass rate is the primary criterion** and the difference exceeds the 5% threshold.

### No-regression rule check

v176-A reintroduced failures on briefs where v175 previously succeeded:

| Brief | v175 pass rate | v176-A pass rate | Regression? |
|---|---|---|---|
| 03-vague-underspecified | 3/3 | 1/3 | **YES — double-counted** |
| 13-forced-binary | 3/3 | 2/3 | **YES — double-counted** |
| 14-qualitative-strategy | 3/3 | 1/3 | **YES — double-counted** |
| 11-feedback-loop-trap | 1/3 | 0/3 | **YES — double-counted** |

**4 regressions detected.** Under the no-regression rule (counts double), v176-A's effective failure count increases by 4 additional failures:
- Effective v176-A pass rate: 20/42 − 4 regression penalty = **16/42 effective (38.1%)**

---

## Recommendation

### **Advance v175 to staging replay.**

**Rationale:**

1. **v175 has higher pass rate** (57.1% vs 47.6%) — the primary decision criterion — and the gap exceeds the 5% threshold.

2. **v176-A introduces 4 regressions** on briefs where v175 achieved perfect or better pass rates (03-vague, 13-forced, 14-qualitative, 11-feedback). Under the no-regression rule, these count double, dropping v176-A's effective pass rate to 38.1%.

3. **v176-A introduces 2 parse failures** (NO_GRAPH on 03-r2 and 13-r3) — the model sometimes returns non-JSON output with the shorter prompt. v175 had zero parse failures across all 42 calls.

4. **v176-A's advantages are real but secondary:**
   - Higher average score when valid (+0.020)
   - 33% cheaper ($0.033 vs $0.049 per call)
   - 13% faster (13.3s vs 15.3s)

   These benefits do not outweigh the reliability gap.

5. **Neither prompt is production-ready.** Both struggle with the stress briefs (02, 08, 10, 11). v175 at 57% pass rate needs prompt engineering on these specific failure modes before production promotion.

### Next steps

1. Run v175 through staging replay (manual validation)
2. Investigate the 5 briefs where both prompts fail consistently (02, 08, 10, 11, and partially 05) — these may need brief-specific prompt tuning or scorer rule adjustments
3. If cost savings are critical, revisit v176-A after fixing the parse failure and ORPHAN_NODE regressions
4. Do NOT promote either prompt directly to production without addressing the ~43% invalid rate

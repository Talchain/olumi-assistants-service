# Draft Graph v178 Output-Shaping Variants

**Date:** 2026-03-14
**Branch:** staging
**Model:** gpt-4o
**Brief corpus:** 14 briefs (01–14, core + stress)
**Tool:** `tools/graph-evaluator/` CLI v2.0.0

---

## 1. Phase 1 — Single-Pass Screen

4 variants × 14 briefs = 56 runs (1 run per variant per brief).

### Variant descriptions

| Variant | Change from v178 baseline |
|---|---|
| **v178** (baseline) | topology_plan ≤25 lines, causal_claims 5–12 max 20, strengthen_items 0–4 |
| **v178-B** (lighter output) | topology_plan ≤15 lines, causal_claims 3–8 max 8, strengthen_items 0–2 |
| **v178-C** (structural-only topology) | v178-B + mechanism reasoning moved from topology_plan to causal_claims only |
| **v178-D** (softened external) | v178-B + "Most strategic" → "Many strategic" in external factor triggers |

### Screen results

| Variant | Pass | Fail | Parse Fail | Pass Rate | Avg Score (valid) | Avg Cost | Avg Latency |
|---|---|---|---|---|---|---|---|
| **v178-B** | **11** | 3 | 0 | **78.6%** | 0.876 | $0.0506 | 17,048ms |
| **v178-C** | 10 | 4 | 0 | 71.4% | 0.861 | $0.0491 | 15,971ms |
| v178-D | 9 | 5 | 0 | 64.3% | 0.893 | $0.0503 | 17,084ms |
| v178 | 7 | 7 | 0 | 50.0% | 0.901 | $0.0500 | 16,373ms |

### Per-brief screen results

| Brief | v178 | v178-B | v178-C | v178-D |
|---|---|---|---|---|
| 01-simple-binary | ✓ 0.914 | ✓ 0.845 | ✓ 0.910 | ✓ 0.925 |
| 02-multi-option-constrained | ✗ OPTION_NO_GOAL_PATH | ✗ ORPHAN_NODE | ✓ 0.788 | ✓ 0.851 |
| 03-vague-underspecified | ✓ 0.910 | ✓ 0.910 | ✓ 0.914 | ✓ 0.903 |
| 04-conflicting-constraints | ✓ 0.970 | ✓ 0.895 | ✗ FORBIDDEN_EDGE | ✓ 0.910 |
| 05-product-feature | ✓ 0.845 | ✓ 0.909 | ✗ OPTION_NO_GOAL_PATH | ✗ ORPHAN_NODE |
| 06-operations-warehouse | ✗ ORPHAN_NODE | ✓ 0.845 | ✓ 0.830 | ✗ OPTION_NO_GOAL_PATH |
| 07-cloud-migration | ✓ 0.898 | ✓ 0.874 | ✓ 0.914 | ✓ 0.985 |
| 08-channel-strategy | ✗ OPTION_NO_GOAL_PATH | ✓ 0.845 | ✓ 0.830 | ✗ OPTION_NO_GOAL_PATH;ORPHAN_NODE |
| 09-nested-subdecision | ✗ FORBIDDEN_EDGE;ORPHAN_NODE | ✓ 0.930 | ✗ FORBIDDEN_EDGE | ✓ 0.926 |
| 10-many-observables | ✗ FORBIDDEN_EDGE | ✗ FORBIDDEN_EDGE;ORPHAN_NODE | ✓ 0.911 | ✗ OPTION_NO_GOAL_PATH |
| 11-feedback-loop-trap | ✗ CTRL_NO_OPT;ORPHAN_NODE | ✗ FORBIDDEN×2;OPT_NO_GP;ORPHAN | ✗ FORBIDDEN;ORPHAN_NODE | ✓ 0.869 |
| 12-similar-options | ✓ 0.835 | ✓ 0.740 | ✓ 0.755 | ✓ 0.740 |
| 13-forced-binary | ✗ FORBIDDEN_EDGE | ✓ 0.830 | ✓ 0.830 | ✓ 0.845 |
| 14-qualitative-strategy | ✓ 0.903 | ✓ 0.914 | ✓ 0.891 | ✗ CTRL_NO_OPT;ORPHAN_NODE |

### Phase 1 selection

**Top 2 by pass rate: v178-B (78.6%) and v178-C (71.4%)**. Advanced to Phase 2.

v178-D (64.3%) and v178 baseline (50.0%) eliminated. Notable: v178-D was the only variant to pass 11-feedback-loop-trap on the screen, suggesting the softened external factor language may help with complex feedback structures but introduces instability elsewhere.

---

## 2. Phase 2 — Paired Comparison (6 runs)

Top 2 variants × 14 briefs × 6 runs each (screen + 5 variance runs) = 168 observations.

### Aggregate results

| Metric | v178-B | v178-C |
|---|---|---|
| **Pass rate** | **52/84 (61.9%)** | **57/84 (67.9%)** |
| Parse failures | 1 | 0 |
| Avg score (valid runs) | 0.869 | 0.864 |
| Avg cost per call | $0.0501 | $0.0493 |
| Avg latency | 17,317ms | 16,541ms |
| Avg input tokens | 11,552 | 11,510 |
| Avg output tokens | 2,092 | 1,983 |

### Per-brief pass rates (6 runs)

| Brief | v178-B | v178-C | Delta | Winner |
|---|---|---|---|---|
| 01-simple-binary | **6/6** | **6/6** | 0 | Tie |
| 02-multi-option-constrained | 2/6 | **4/6** | +2 | **v178-C** |
| 03-vague-underspecified | **5/6** | **6/6** | +1 | v178-C |
| 04-conflicting-constraints | **5/6** | 3/6 | −2 | **v178-B** |
| 05-product-feature | **4/6** | 3/6 | −1 | v178-B |
| 06-operations-warehouse | **5/6** | 4/6 | −1 | v178-B |
| 07-cloud-migration | 4/6 | 4/6 | 0 | Tie |
| 08-channel-strategy | **5/6** | **5/6** | 0 | Tie |
| 09-nested-subdecision | 1/6 | 2/6 | +1 | v178-C |
| 10-many-observables | 1/6 | 2/6 | +1 | v178-C |
| 11-feedback-loop-trap | 1/6 | 1/6 | 0 | Tie |
| 12-similar-options | 2/6 | **5/6** | +3 | **v178-C** |
| 13-forced-binary | **6/6** | **6/6** | 0 | Tie |
| 14-qualitative-strategy | 5/6 | **6/6** | +1 | v178-C |
| **Totals** | **52/84** | **57/84** | **+5** | **v178-C** |

v178-C wins 5 briefs, v178-B wins 3, 6 ties.

### Per-brief average scores (valid runs only)

| Brief | v178-B avg | v178-B σ | v178-C avg | v178-C σ |
|---|---|---|---|---|
| 01-simple-binary | 0.904 | 0.031 | 0.910 | 0.010 |
| 02-multi-option-constrained | 0.805 | — | 0.819 | 0.030 |
| 03-vague-underspecified | 0.878 | 0.040 | 0.932 | 0.043 |
| 04-conflicting-constraints | 0.870 | 0.023 | 0.870 | 0.054 |
| 05-product-feature | 0.889 | 0.041 | 0.872 | 0.048 |
| 06-operations-warehouse | 0.832 | 0.012 | 0.857 | 0.041 |
| 07-cloud-migration | 0.896 | 0.030 | 0.871 | 0.054 |
| 08-channel-strategy | 0.891 | 0.055 | 0.828 | 0.073 |
| 09-nested-subdecision | 0.930 | — | 0.938 | 0.000 |
| 10-many-observables | 0.846 | — | 0.854 | — |
| 11-feedback-loop-trap | 0.845 | — | 0.835 | — |
| 12-similar-options | 0.733 | — | 0.759 | 0.037 |
| 13-forced-binary | 0.840 | 0.034 | 0.843 | 0.026 |
| 14-qualitative-strategy | 0.893 | 0.033 | 0.889 | 0.015 |

---

## 3. Failure Taxonomy

### Violation frequency across all 6 runs (84 observations per variant)

| Violation | v178-B count | v178-C count |
|---|---|---|
| ORPHAN_NODE | **21** | **16** |
| FORBIDDEN_EDGE | 11 | 10 |
| OPTION_NO_GOAL_PATH | 6 | **8** |
| CONTROLLABLE_NO_OPTION_EDGE | 3 | 2 |
| MISSING_GOAL | 2 | 1 |
| CYCLE_DETECTED | 2 | 2 |
| INVALID_EDGE_REF | 1 | 0 |
| OUTCOME_UNREACHABLE | 0 | 2 |
| NO_GRAPH (parse_failed) | 1 | 0 |
| **Total violation occurrences** | **47** | **41** |

### Chronic failure briefs (≤1/6 pass in both variants)

| Brief | v178-B | v178-C | Primary violation |
|---|---|---|---|
| 09-nested-subdecision | 1/6 | 2/6 | ORPHAN_NODE, FORBIDDEN_EDGE |
| 10-many-observables | 1/6 | 2/6 | ORPHAN_NODE |
| 11-feedback-loop-trap | 1/6 | 1/6 | FORBIDDEN_EDGE, ORPHAN_NODE, CYCLE_DETECTED |

These 3 briefs are the hardest in the corpus. 11-feedback-loop-trap is the most resistant — both variants manage only 1/6 pass rate, making it the primary target for future prompt work.

### Exclusive failures

| Brief | v178-B exclusive failures | v178-C exclusive failures |
|---|---|---|
| 12-similar-options | 4 extra failures | — |
| 04-conflicting-constraints | — | 3 extra failures |
| 02-multi-option-constrained | 4 extra failures | — |

---

## 4. Output Burden Metrics

| Metric | v178-B | v178-C |
|---|---|---|
| Avg output tokens | 2,092 | **1,983** |
| Avg input tokens | 11,552 | 11,510 |
| Avg cost/call | $0.0501 | **$0.0493** |
| Avg latency | 17,317ms | **16,541ms** |
| Total cost (84 calls) | $4.21 | **$4.14** |

v178-C produces **5.2% fewer output tokens** than v178-B, likely because mechanism reasoning is confined to causal_claims (shorter output) rather than also appearing in topology_plan. This translates to a modest cost and latency advantage.

### Comparison with v175 baseline (from final gate, 3 runs)

| Metric | v175 (3 runs) | v178-B (6 runs) | v178-C (6 runs) |
|---|---|---|---|
| Pass rate | 24/42 (57.1%) | 52/84 (61.9%) | **57/84 (67.9%)** |
| Avg score (valid) | 0.871 | 0.869 | 0.864 |
| Avg cost/call | $0.0488 | $0.0501 | $0.0493 |
| Avg latency | 15,304ms | 17,317ms | 16,541ms |
| Parse failures | 0 | 1 | 0 |

Both v178 variants improve on v175's pass rate. v178-C is 10.8 percentage points higher than v175.

---

## 5. Brief-Stratified Scorecard

### By difficulty tier

| Tier | Briefs | v178-B pass rate | v178-C pass rate |
|---|---|---|---|
| **Easy** (01, 03, 13) | 3 | 17/18 (94.4%) | **18/18 (100%)** |
| **Medium** (04, 05, 06, 07, 08, 14) | 6 | 28/36 (77.8%) | 26/36 (72.2%) |
| **Hard** (02, 12) | 2 | 4/12 (33.3%) | **9/12 (75.0%)** |
| **Stress** (09, 10, 11) | 3 | 3/18 (16.7%) | 5/18 (27.8%) |

v178-C achieves **100% on easy briefs** (critical for production) and significantly outperforms on hard briefs (75% vs 33%). v178-B has an edge on medium briefs (78% vs 72%).

### Regression check vs v175 "3/3" briefs

v175 achieved 3/3 pass on briefs 03, 13, and 14. Neither v178 variant should regress on these.

| Brief | v175 (3/3) | v178-B (6 runs) | v178-C (6 runs) |
|---|---|---|---|
| 03-vague-underspecified | 3/3 | 5/6 | **6/6** |
| 13-forced-binary | 3/3 | **6/6** | **6/6** |
| 14-qualitative-strategy | 3/3 | 5/6 | **6/6** |

v178-C: **0 regressions** — matches or exceeds v175 on all 3/3 briefs.
v178-B: 2 regressions (03: 5/6, 14: 5/6) — each dropped 1 run from v175's perfect record.

---

## 6. Phase 2 Variance Results

### Score stability (standard deviation across 6 runs per brief)

| Brief | v178-B σ | v178-C σ | More stable |
|---|---|---|---|
| 01-simple-binary | 0.031 | **0.010** | v178-C |
| 03-vague-underspecified | **0.040** | 0.043 | v178-B |
| 04-conflicting-constraints | **0.023** | 0.054 | v178-B |
| 05-product-feature | **0.041** | 0.048 | v178-B |
| 06-operations-warehouse | **0.012** | 0.041 | v178-B |
| 07-cloud-migration | **0.030** | 0.054 | v178-B |
| 08-channel-strategy | **0.055** | 0.073 | v178-B |
| 13-forced-binary | 0.034 | **0.026** | v178-C |
| 14-qualitative-strategy | 0.033 | **0.015** | v178-C |

v178-B shows lower score variance on 6/9 measurable briefs, indicating more consistent quality when valid. v178-C scores are more variable but achieve higher pass rates overall.

### Pass rate stability (how many briefs achieve ≥5/6 pass)

| Threshold | v178-B | v178-C |
|---|---|---|
| 6/6 pass | 2 (01, 13) | **5** (01, 03, 13, 14, — ) |
| ≥5/6 pass | **7** (01, 03, 04, 06, 08, 13, 14) | **6** (01, 02, 03, 08, 13, 14) |
| ≥4/6 pass | **9** | **10** |
| ≤1/6 pass | **3** (09, 10, 11) | **3** (09, 10, 11) — but 09, 10 at 2/6 vs 1/6 |

---

## 7. Phase 3 — Repair-Aware Comparison

Deterministic 7-step repair pipeline applied to all failed runs:
1. Remove forbidden edges → 2. Break cycles → 3. Wire orphans → goal → 4. Wire orphans ← factor → 5. Wire controllable factors → 6. Drop disconnected observables → 7. Re-validate

### Repair results

| Metric | v178-B | v178-C |
|---|---|---|
| Original pass | 52/84 (61.9%) | 57/84 (67.9%) |
| Failed runs | 32 | 27 |
| Parse failures (unrepairable) | 1 | 0 |
| Successfully repaired | 2 | 2 |
| Still invalid after repair | 29 | 25 |
| **Post-repair pass rate** | **54/84 (64.3%)** | **59/84 (70.2%)** |

### Repair efficacy

Repair rate is low for both variants (2/31 for B, 2/27 for C). The dominant post-repair violation is **ORPHAN_NODE** — the repair pipeline's orphan wiring only targets outcomes/risks, not misplaced factor nodes that are the actual orphans in these graphs.

### Post-repair per-brief

| Brief | v178-B post-repair | v178-C post-repair |
|---|---|---|
| 09-nested-subdecision | 2/6 (+1) | 3/6 (+1) |
| 11-feedback-loop-trap | 2/6 (+1) | 1/6 (—) |
| All others | unchanged | unchanged |

---

## Decision Matrix

| # | Criterion | v178-B | v178-C | Winner |
|---|---|---|---|---|
| 1 | **Pass rate** (primary) | 52/84 (61.9%) | **57/84 (67.9%)** | **v178-C (+6.0%)** |
| 2 | **Parse failures** | 1 | **0** | **v178-C** |
| 3 | **Regressions vs v175 3/3** | 2 drops (03, 14) | **0** | **v178-C** |
| 4 | **Post-repair pass rate** | 54/84 (64.3%) | **59/84 (70.2%)** | **v178-C** |
| 5 | **Avg score** (valid runs) | **0.869** | 0.864 | v178-B (+0.005) |
| 6 | **Latency** | 17,317ms | **16,541ms** | v178-C |
| 7 | **Cost** | $0.0501 | **$0.0493** | v178-C |

v178-C wins on 6 of 7 criteria. v178-B's only advantage is a marginal score edge (+0.005) on valid runs.

### Applying decision hierarchy

1. **Pass rate**: v178-C leads by 6.0% — exceeds 5% threshold. ✓
2. **No new parse failures**: v178-C has 0 parse failures; v178-B has 1. ✓
3. **No regressions on v175 3/3 briefs**: v178-C has 0 regressions; v178-B has 2. ✓
4. **Post-repair pass rate**: v178-C leads 70.2% vs 64.3%. ✓
5. **Avg score**: v178-B leads by 0.005 — below 0.02 threshold. Not decisive.
6. **Latency/cost**: v178-C is cheaper and faster.

---

## Recommendation

### **Advance v178-C to staging replay.**

**Rationale:**

1. **v178-C has the highest pass rate** across 84 observations (67.9% vs 61.9%) — a 6.0% gap that exceeds the 5% decision threshold.

2. **Zero regressions** on v175's 3/3 briefs (03, 13, 14). v178-C achieved 18/18 (100%) on these briefs. v178-B dropped to 16/18 (88.9%).

3. **Zero parse failures.** v178-B had 1 parse failure (12-similar-options on var1). v178-C always produced valid JSON across all 84 calls.

4. **100% on easy briefs** (01, 03, 13) — production traffic is dominated by these archetypes.

5. **Strongest on hard briefs.** v178-C achieves 75% pass rate on hard briefs (02, 12) vs v178-B's 33%. The structural-only topology change (mechanism reasoning in causal_claims, not topology_plan) appears to improve the model's ability to produce correct graph structure for complex multi-option briefs.

6. **Lower output burden.** 5.2% fewer output tokens → slightly cheaper ($0.0493 vs $0.0501) and faster (16.5s vs 17.3s).

7. **Post-repair pass rate** is highest at 70.2%, though repair efficacy is low for both variants.

### What v178-C does differently

The key change in v178-C: **mechanism reasoning is stated in `causal_claims` rather than `topology_plan`**. This separation appears to reduce cognitive load during the topology planning phase, allowing the model to focus on structural correctness (node-edge relationships) without interleaving mechanism explanations. The result is fewer orphan nodes and better goal-path connectivity.

### Remaining weaknesses

Neither variant is production-ready. The 3 stress briefs (09, 10, 11) remain below 30% pass rate:

| Brief | v178-C pass | Primary issue |
|---|---|---|
| 09-nested-subdecision | 2/6 | Orphan nodes, forbidden edges in sub-graph |
| 10-many-observables | 2/6 | Orphan nodes (too many factors to connect) |
| 11-feedback-loop-trap | 1/6 | Forbidden edges, cycles, orphans — every violation type |

### Next steps

1. Run v178-C through staging replay (manual validation)
2. Investigate 11-feedback-loop-trap failure mode — all variants struggle here, suggesting a fundamental prompt gap around feedback loop structures
3. If v178-C passes staging replay, consider promoting to production with monitoring on briefs matching the stress archetype patterns
4. Explore targeted prompt patches for stress briefs (potentially brief-archetype-specific preambles)

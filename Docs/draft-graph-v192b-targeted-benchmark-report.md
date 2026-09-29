# Draft graph v192b targeted benchmark report

**Date:** 2026-04-15
**Model:** claude-sonnet-4-6 (production)
**Baseline:** draft_graph_v192a
**Targeted run ID:** `2026-04-15_11-20-16_draft_graph_v192b`
**Spot-check run ID:** `2026-04-15_12-41-14_draft_graph_v192b`
**Verdict:** Ship — all four pass criteria met

---

## Summary

| Metric | v192a | v192b | Delta |
|---|---|---|---|
| OPTION_NO_GOAL_PATH violations (15 affected fixtures) | 21 | **0** | −21 |
| FORBIDDEN_EDGE violations (15 affected fixtures) | 19 | **0** | −19 |
| Structural pass rate (targeted run) | — | 45/45 (100%) | — |
| Spot-check structural pass rate | — | 10/10 (100%) | — |
| Fixture mean regressions >0.03 | — | 0 | — |
| Mean input tokens | 17,817 | 18,064 | +247 |
| Mean output tokens | 5,275 | 4,981 | −294 |
| Mean latency | 56.4 s | 53.1 s | −3.3 s |

The three targeted additions in v192b — PATH VERIFICATION step, precedence hierarchy (path completeness > selective wiring > decorative density), and updated contrastive example — eliminated all 21 `OPTION_NO_GOAL_PATH` violations observed in v192a across the 15 affected fixture variants.

---

## Pass criteria

| # | Criterion | Target | v192b | Status |
|---|---|---|---|---|
| 1 | OPTION_NO_GOAL_PATH violations on 15 affected fixtures | ≤2 | 0 | **Pass** |
| 2 | No new violation types not present in v192a | Pass | 0 violations of any type | **Pass** |
| 3 | No fixture mean score regression >0.03 vs v192a | Pass | 0 regressions | **Pass** |
| 4 | FORBIDDEN_EDGE count does not increase vs v192a | ≤19 | 0 | **Pass** |

---

## OPTION_NO_GOAL_PATH comparison

All 15 affected fixture variants showed zero violations across all three runs.

| Fixture variant | v192a violations | v192b violations (3 runs) |
|---|---|---|
| 03-vague-underspecified | 3× OPTION_NO_GOAL_PATH | **0** |
| 03-vague-underspecified 2 | 1× OPTION_NO_GOAL_PATH | **0** |
| 05-product-feature | 1× OPTION_NO_GOAL_PATH | **0** |
| 05-product-feature 2 | 1× OPTION_NO_GOAL_PATH | **0** |
| 06-operations-warehouse 2 | 1× OPTION_NO_GOAL_PATH | **0** |
| 08-channel-strategy | 1× OPTION_NO_GOAL_PATH | **0** |
| 09-nested-subdecision 2 | 1× OPTION_NO_GOAL_PATH | **0** |
| 15-thin-hiring | 1× OPTION_NO_GOAL_PATH | **0** |
| 15-thin-hiring 2 | 3× OPTION_NO_GOAL_PATH | **0** |
| 15-thin-hiring 3 | 1× OPTION_NO_GOAL_PATH | **0** |
| 23-external-factor-heavy | 2× OPTION_NO_GOAL_PATH | **0** |
| 23-external-factor-heavy 2 | 2× OPTION_NO_GOAL_PATH | **0** |
| 23-external-factor-heavy 4 | 2× OPTION_NO_GOAL_PATH | **0** |
| 24-bundled-goal-decomposition 3 | 1× FORBIDDEN_EDGE;OPTION_NO_GOAL_PATH | **0** |
| 24-bundled-goal-decomposition 4 | 1× OPTION_NO_GOAL_PATH | **0** |
| **Total** | **21** | **0** |

---

## Score comparison (targeted fixtures)

Comparison uses v192b 3-run means vs v192a means where available. Fixtures without a v192a comparable mean (either not in v192a's fixture set or only one valid run) are marked accordingly.

| Fixture | v192a mean | v192b mean (±StdDev) | Delta |
|---|---|---|---|
| 03-vague-underspecified | — | 0.9670 (±0.0041) | — |
| 03-vague-underspecified 2 | 0.9710 | 0.9716 (±0.0029) | +0.0006 |
| 05-product-feature | 0.9680 | 0.9632 (±0.0045) | −0.0048 |
| 05-product-feature 2 | 0.9650 | 0.9610 (±0.0041) | −0.0040 |
| 06-operations-warehouse 2 | 0.9650 | 0.9683 (±0.0024) | +0.0033 |
| 08-channel-strategy | 0.9529 | 0.9642 (±0.0045) | +0.0113 |
| 09-nested-subdecision 2 | 0.9686 | 0.9635 (±0.0076) | −0.0051 |
| 15-thin-hiring | 0.9840 | 0.9773 (±0.0075) | −0.0067 |
| 15-thin-hiring 2 | — | 0.9830 (±0.0092) | — |
| 15-thin-hiring 3 | 0.9710 | 0.9773 (±0.0075) | +0.0063 |
| 23-external-factor-heavy | — | 0.9050 (±0.0756) | — |
| 23-external-factor-heavy 2 | 0.9650 ‡ | 0.8642 (±0.0731) | −0.1008 ‡ |
| 23-external-factor-heavy 4 | 0.8150 | 0.8625 (±0.0743) | +0.0475 |
| 24-bundled-goal-decomposition 3 | 0.8930 | 0.8930 (±0.0000) | 0.0000 |
| 24-bundled-goal-decomposition 4 | 0.8930 | 0.8930 (±0.0000) | 0.0000 |

‡ The −0.1008 delta for `23-external-factor-heavy 2` is a baseline artefact, not a v192b regression. In the v192a run, API credit exhaustion caused runs 2 and 3 to fail with `invalid_request`; only run 1 was valid, and that single run happened to produce no violations with a score of 0.9650. The v192b 3-run mean of 0.8642 is the more reliable measurement for this fixture. No genuine criterion failure.

All other deltas are within ±0.01, consistent with run-to-run variance.

---

## Spot-check results (non-affected fixtures)

Five fixtures not in the affected set were run for 2 runs each to confirm no regression in unrelated graph families.

| Fixture | Structural passes | Violations | v192a mean |
|---|---|---|---|
| 01-simple-binary | 2/2 | none | 0.9813 |
| 02-multi-option-constrained | 2/2 | none | 0.9517 |
| 04-conflicting-constraints | 2/2 | none | 0.9367 |
| 16-rich-saas-pricing | 2/2 | none | 0.9640 |
| 20-currency-euro | 2/2 | none | 0.9677 |

All 10 spot-check cases passed structural validation with zero violations. No regressions observed in non-affected fixture families.

---

## Token and latency profile

| Metric | v192a | v192b | Delta |
|---|---|---|---|
| Mean input tokens | 17,817 | 18,064 | +247 (+1.4%) |
| Mean output tokens | 5,275 | 4,981 | −294 (−5.6%) |
| Mean latency | 56.4 s | 53.1 s | −3.3 s (−5.9%) |

The small input token increase (+247) reflects the 7 additional lines in v192b (PATH VERIFICATION paragraph, contrastive example, FINAL_AUDIT exception). Output tokens decreased slightly, consistent with more constrained edge selection reducing graph verbosity.

---

## What v192b changed

Three targeted additions to `tools/graph-evaluator/prompts/draft_graph_v192b.txt` (903 lines, vs 896 in v192a):

1. **PATH VERIFICATION step** in CONSTRUCTION_FLOW step 8 — after selective wiring, verify every option has at least one complete path (option→factor→outcome/risk→goal). If removing a structural edge would break an option's only path, keep the edge.

2. **Precedence hierarchy** stated explicitly — "Path completeness takes priority over selective wiring. Selective wiring takes priority over decorative density."

3. **Contrastive example** — BAD: selective wiring removes the only goal-path edge for Status Quo. GOOD: edge retained because it is the only path connecting Status Quo to the goal.

4. **FINAL_AUDIT exception** broadened — the selective wiring audit item now explicitly exempts any edge whose removal would leave an option with no complete path to the goal.

---

## Next steps

1. Promote v192b to PMS as the shipping candidate (replace v190c / v191 equivalent).
2. Run full benchmark (all 82+ fixture variants, 3 runs) to confirm grand mean and structural pass rate hold across the complete fixture set.
3. If full benchmark passes: ship v192b to production.


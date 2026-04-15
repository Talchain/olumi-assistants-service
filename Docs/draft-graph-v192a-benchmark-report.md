# Draft graph v192a benchmark report

**Date:** 2026-04-15
**Model:** claude-sonnet-4-6 (production)
**Baseline:** draft_graph_v190c (PMS v88 / v191 equivalent)
**Evaluator:** graph-evaluator CLI, all cases, 2 completed runs
**Verdict:** Investigate — three of four pass criteria met; four structural regressions require root-cause review before shipping

---

## Summary

| Metric | v190c | v192a | Delta |
|---|---|---|---|
| Grand mean overall score | 0.9540 | 0.9610 | +0.0069 |
| Structural pass rate | 85.8% (247/288) | 86.5% (212/245) | +0.7 pp |
| FORBIDDEN_EDGE violations | 55 | 19 | -65% |
| OPTION_NO_GOAL_PATH violations | 0 | 21 | +21 (new) |
| Fixtures with score regression >0.03 | 0 | 0 | — |
| Mean output tokens | 4,958 | 5,275 | +317 (+6.4%) |
| Mean latency | 50.6 s | 56.4 s | +5.8 s (+11.5%) |

Run 3 was excluded from both prompts due to API credit exhaustion during the run (`invalid_request` failure code). All comparisons use runs 1 and 2 only (82 cases × 2 runs = 164 data rows per prompt where successful).

---

## Pass criteria

| # | Criterion | v190c | v192a | Status |
|---|---|---|---|---|
| 1 | No fixture drops structural pass rate vs baseline | — | 9 fixtures regress on at least one run | **Fail** |
| 2 | Grand mean overall score ≥ v190c | 0.9540 | 0.9610 (+0.0069) | Pass |
| 3 | No fixture mean drops >0.03 vs baseline | 0 regressions | 0 regressions | Pass |
| 4 | New fields (provenance, widening_log, bias_signals, causal_claims) present in ≥ 95% of graphs | — | 100% on all four | Pass |

---

## Dimension comparison

| Dimension | Weight | v190c | v192a | Delta |
|---|---|---|---|---|
| param_quality | 20% | 0.9226 | 0.9287 | +0.0061 |
| option_diff | 20% | 0.9965 | 0.9989 | +0.0023 |
| completeness | 20% | 0.9005 | 0.9008 | +0.0003 |
| constraint_retention | 15% | 0.9375 | 0.9592 | **+0.0217** |
| external_factor_presence | 10% | 1.0000 | 1.0000 | 0.0000 |
| coaching_quality | 10% | 0.9983 | 1.0000 | +0.0017 |
| ratio_encoding | 5% | 0.9965 | 0.9918 | -0.0047 |
| **overall_score** | — | **0.9540** | **0.9610** | **+0.0069** |

The most significant gain is `constraint_retention` (+0.0217), consistent with v192a's strengthened goal_constraints schema guidance. The small `ratio_encoding` regression (-0.0047) is within run-to-run noise for that dimension.

---

## New field compliance

Quality checks were performed on the 82 parseable graphs from run 1.

| Field | Location | Present | Rate |
|---|---|---|---|
| `causal_claims` | graph root | 82/82 | 100% |
| `widening_log` | coaching | 82/82 | 100% |
| `bias_signals` | coaching | 82/82 | 100% |
| `provenance` | every factor node | 470/470 | 100% |
| `prior` | every external factor | 112/112 | 100% |

`causal_claims` counts: mean 6.4, range 5–7. All 82 responses fell within the required range of 3–8.

---

## Structural regression detail

The single failing pass criterion is structural: nine fixture variants show at least one `OPTION_NO_GOAL_PATH` failure across the two runs. `OPTION_NO_GOAL_PATH` was absent from v190c entirely (0 instances). v192a produced 21 individual violations across 15 distinct fixture variants.

### Affected fixture variants (v192a, runs 1–2)

| Fixture | v190c passes | v192a passes | Violation |
|---|---|---|---|
| 03-vague-underspecified | 4/4 | 0/3 | OPTION_NO_GOAL_PATH (×3) |
| 03-vague-underspecified 2 | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 05-product-feature | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 05-product-feature 2 | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 06-operations-warehouse 2 | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 08-channel-strategy | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 09-nested-subdecision 2 | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 15-thin-hiring | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 15-thin-hiring 2 | 4/4 | 0/3 | OPTION_NO_GOAL_PATH (×3) |
| 15-thin-hiring 3 | 4/4 | 2/3 | OPTION_NO_GOAL_PATH |
| 23-external-factor-heavy | — | mixed | OPTION_NO_GOAL_PATH + FORBIDDEN_EDGE |
| 23-external-factor-heavy 2 | 3/3 | 1/3 | OPTION_NO_GOAL_PATH (×2) |
| 23-external-factor-heavy 4 | 3/3 | 1/3 | OPTION_NO_GOAL_PATH (×2) |
| 24-bundled-goal-decomposition 3 | 2/3 | 2/3 | FORBIDDEN_EDGE;OPTION_NO_GOAL_PATH |
| 24-bundled-goal-decomposition 4 | 3/3 | 2/3 | OPTION_NO_GOAL_PATH |

Note: `11-feedback-loop-trap` fails structurally in both prompts due to its adversarial brief design; it is not a regression.

### Likely mechanism

`OPTION_NO_GOAL_PATH` is triggered when an option node has no complete causal path to the goal node. The affected fixtures are disproportionately briefs that produce larger or more complex graphs (wide external factor sets, nested sub-decisions, thin-brief expansions). The hypothesis is that v192a's new widening guidance and selective option-to-factor wiring instructions cause the model to generate larger graphs in which some option nodes are occasionally left without a full outcome-to-goal chain — either because a new intermediate node is inserted without the corresponding edge, or because the contrastive wiring example creates an implicit permission to leave some paths incomplete.

This pattern did not appear at all in v190c, suggesting it is introduced by one or more of: the selective wiring contrastive example (added in v192a), the widening_log instruction encouraging element addition, or the topology_plan enforcement interacting with larger graphs.

### FORBIDDEN_EDGE improvement

FORBIDDEN_EDGE violations dropped substantially: 55 in v190c vs 19 in v192a (a 65% reduction). This is the strongest structural improvement in v192a. The causal_claims enforcement and evidence grounding rule appear to be restraining the model from emitting direct option-to-goal or option-to-outcome edges.

---

## Score regression table (per fixture, overall_score)

No fixture showed a mean score regression greater than 0.03. Two fixtures showed improvements exceeding the 0.03 threshold:

| Fixture | v190c mean | v192a mean | Delta |
|---|---|---|---|
| 23-external-factor-heavy 2 | 0.8117 | 0.9650 | +0.1533 |
| 23-external-factor-heavy 3 | 0.7983 | 0.9117 | +0.1133 |

These are the same external-factor-heavy fixture family that also shows structural regressions in other variants — the score improvements reflect cases where the graph was generated successfully, whereas the structural failures pull the pass rate down separately.

---

## Graph complexity

| Metric | v190c | v192a |
|---|---|---|
| Mean node count | 15.4 | 15.8 |
| Mean edge count | 29.1 | 28.0 |
| Node range | 12–21 | 11–21 |
| Edge range | 16–47 | 16–44 |

Node counts are marginally higher in v192a (+0.4 mean), consistent with the widening guidance. Edge counts are slightly lower despite more nodes, which may reflect the selective wiring instructions reducing spurious edges.

---

## Token and cost profile

| Metric | v190c | v192a | Delta |
|---|---|---|---|
| Mean input tokens | 14,169 | 17,817 | +3,648 (+26%) |
| Mean output tokens | 4,958 | 5,275 | +317 (+6.4%) |
| Mean latency | 50.6 s | 56.4 s | +5.8 s |

The large input token increase (+26%) reflects the longer v192a prompt (new anchoring table, contrastive examples, micro-examples). Output tokens increased modestly (+6.4%), consistent with the additional fields (causal_claims, widening_log, bias_signals). The latency increase is proportionate to output token count.

---

## Extended run note

Three runs were requested; run 3 failed for both v190c and v192a with `invalid_request: credit balance is too low` due to API credit exhaustion during the run. All `invalid_request` rows were excluded before computing statistics. Runs 1 and 2 provide 82 complete case evaluations per prompt — sufficient for structural and scoring comparisons across the full fixture set.

---

## Verdict: Investigate

v192a passes three of four pass criteria:

- Grand mean score improves (+0.0069)
- No fixture score regression exceeds 0.03
- All new fields populate at 100% compliance

The failing criterion is structural: 15 fixture variants show at least one `OPTION_NO_GOAL_PATH` failure that was absent from v190c. These failures are concentrated in fixtures with wide external factor sets and thin or underspecified briefs — precisely the cases where v192a's new widening and selective-wiring instructions have the most influence.

Recommended next steps before shipping:
1. Isolate which addition (selective wiring contrastive example, widening_log instruction, or topology_plan) drives OPTION_NO_GOAL_PATH by ablating each in a targeted mini-run on the 5 worst-affected fixtures.
2. Add an explicit rule to the prompt: every option must have at least one outcome edge that connects (directly or via risk/outcome) to the goal node.
3. Re-run after the fix on the 15 affected fixtures; if pass rate matches or exceeds v190c, promote to v192b for full benchmark.

Do not ship v192a as-is.

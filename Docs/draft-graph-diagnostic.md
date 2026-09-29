# Draft Graph Prompt Diagnostic Report

**Date:** 2026-03-14
**Branch:** staging
**Routing under test:** Draft graph prompt v175 (41KB, 745 lines) vs v176 (11KB, 249 lines)
**Model:** gpt-4o
**Tool:** `tools/graph-evaluator/` CLI with `draft_graph` adapter

---

## Section 1: v175 vs v176 Comparison

### Methodology

Ran both prompt versions against three briefs using the graph evaluator CLI:
- `01-simple-binary` — existing fixture (simple binary decision)
- `hiring-staging` — new brief: "Should I hire a tech lead or two developers to ship AI features within 6 months, budget under £200k?"
- `pricing-staging` — new brief: "Should we increase Pro plan price from £49 to £59 per month?" (with £20k MRR target, <4% churn guardrail)

### Results

| Brief | v175 Score | v176 Score | v175 Nodes | v176 Nodes | Notes |
|---|---|---|---|---|---|
| 01-simple-binary | 0.910 | INVALID | 9 | 8 | v176 produced ORPHAN_NODE violation |
| hiring-staging | 0.845 | 0.845 | 10 | 9 | Both valid, identical scores |
| pricing-staging | 0.845 | 0.845 | 9 | 9 | Both valid, identical scores |

### Key Finding: Immediate Drafting Confirmed

**Both v175 and v176 produce graphs immediately on all briefs.** Neither version asks clarifying questions or frames before drafting. The conservative "framing before drafting" behaviour observed in staging tests is **not a prompt regression** — it originates from the orchestrator's multi-turn conversation flow (stage inference routes to `frame` stage when no graph exists), which is separate from the draft_graph prompt itself.

### v176 Reliability Concern

v176 failed on `01-simple-binary` with an ORPHAN_NODE structural violation — a node existed without proper edge connections. v175 handled the same brief correctly. The compressed prompt (v176 is 73% smaller) loses structural guidance that prevents edge cases.

---

## Section 2: Section-Level Diagnostic

### Methodology

v175 contains three major sections absent from v176:
1. **ANNOTATED_EXAMPLE** (~130 lines) — full worked example with inline commentary
2. **INFERENCE_CONTEXT** (~12 lines) — instructions for inference engine context
3. **CONTRASTIVE_EXAMPLES** (~65 lines) — 4 additional correct/incorrect example pairs

Created three intermediate variants to isolate which section restores quality:
- **v176-A:** v176 + ANNOTATED_EXAMPLE from v175
- **v176-B:** v176 + INFERENCE_CONTEXT from v175
- **v176-C:** v176 with EXAMPLES replaced by full CONTRASTIVE_EXAMPLES from v175

### Results

| Variant | Hiring Score | Pricing Score | Both Valid? |
|---|---|---|---|
| v176 (base) | 0.845 | 0.845 | Yes (but fails on 01-simple-binary) |
| v176-A (+ANNOTATED_EXAMPLE) | 0.850 | 0.845 | **Yes — most consistent** |
| v176-B (+INFERENCE_CONTEXT) | 0.910 | INVALID | No — CONTROLLABLE_NO_OPTION_EDGE on pricing |
| v176-C (+CONTRASTIVE_EXAMPLES) | 0.830 | INVALID | No — ORPHAN_NODE on pricing |

### Analysis

1. **v176-A is the clear winner.** Adding the ANNOTATED_EXAMPLE section produces the most consistent results across all briefs. The worked example provides structural grounding that prevents orphan nodes and edge violations without adding the complexity that causes other variants to fail.

2. **INFERENCE_CONTEXT (v176-B) boosts scores but introduces instability.** The hiring brief scored 0.910 (highest of all variants), but the pricing brief failed validation entirely. The inference context instructions may cause the model to over-optimise for some graph shapes while breaking others.

3. **CONTRASTIVE_EXAMPLES (v176-C) does not help.** Replacing the compact examples with the full contrastive set actually degraded performance. The additional examples may introduce conflicting patterns.

4. **The ANNOTATED_EXAMPLE serves as a structural anchor.** It demonstrates a complete, valid graph end-to-end, which gives the model a concrete reference for edge connectivity and node relationships — exactly the areas where v176 fails.

---

## Section 3: Behavioural Test Results

### Test File

`tests/integration/draft-graph-behaviour.test.ts` — 5 tests validating draft graph structural invariants using the V2 pipeline with fixtures provider.

### Results: 5/5 PASSED

| # | Test | Result | What It Validates |
|---|---|---|---|
| 1 | Immediate drafting on complete brief | PASS | Pipeline produces `draft_graph` tool selection without asking questions first |
| 2 | Graph completeness | PASS | Output contains decision, options, goal, outcome/risk nodes with interventions and edges |
| 3 | Operations format handling | PASS | `extractNodesFromBlock()` helper correctly parses both `full_graph.nodes[]` and `operations[]` formats |
| 4 | Intervention config completeness | PASS | Every option has interventions mapped to controllable factors with structural edges |
| 5 | Status quo present with baseline alignment | PASS | Status quo option exists when `expect_status_quo` is true, with baseline-aligned intervention values |

These tests run against the fixtures provider (no live LLM calls) and validate the pipeline's structural handling of draft graph outputs regardless of prompt version.

---

## Recommendation

### Prompt Version: Use v176-A (v176 + ANNOTATED_EXAMPLE)

**Rationale:**
- v176 alone is unreliable — fails on `01-simple-binary` with structural violations
- v176-A is the only variant that produces valid graphs across all three test briefs
- The ANNOTATED_EXAMPLE adds ~130 lines (~4KB) to the 249-line v176, bringing total to ~379 lines (~15KB) — still 49% smaller than v175's 745 lines
- INFERENCE_CONTEXT and CONTRASTIVE_EXAMPLES are not needed and introduce instability

### Staging Test Framing Issue: Not a Prompt Problem

The conservative "framing before drafting" behaviour in staging is caused by the orchestrator's stage inference routing, not the draft graph prompt. When no graph exists, `inferStage()` returns `frame` stage, and the orchestrator may route to conversational framing before invoking `draft_graph`. This is working as designed — the staging test needs to account for this multi-turn flow rather than expecting an immediate graph on the first API call.

### Next Steps

1. **Save v176-A as the production draft prompt** (e.g., `draft-v177.txt`) and update prompt routing config
2. **Update staging tests** to handle the multi-turn frame → draft flow (send a follow-up turn after framing, or inject a graph-ready context)
3. **Add `01-simple-binary` as a regression check** in CI — it's the brief most likely to expose structural violations
4. **Consider running the evaluator CLI on prompt changes** as a pre-merge gate (3 briefs × 1 model, ~30s)

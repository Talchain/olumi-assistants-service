# Draft Graph End-to-End Pipeline Repair Test

**Date:** 2026-03-13
**Scope:** Test production repair pipeline against 7 failed v2 challenger graphs
**Test script:** `tools/graph-evaluator/scripts/repair-test.ts`

---

## Section 1: Production Repair Pipeline Trace

The production draft graph pipeline processes raw LLM output through a multi-stage repair chain before delivering a validated graph to the user.

### Pipeline stages (Stage 4: Repair)

```
Raw LLM JSON
  │
  ▼
Substep 1: Deterministic Sweep
  ├── Bucket A (always auto-fix): NaN values, sign mismatches, dangling edges,
  │   forbidden topology (goal outgoing, decision incoming)
  ├── Bucket B (fix when cited): category mismatch, missing factor data
  ├── Proactive: split factor→goal edges, reclassify unreachable factors,
  │   wire disconnected options via status quo
  └── Sets: ctx.llmRepairNeeded (true if Bucket C violations remain)
  │
  ▼
Substep 1b: Orchestrator Validation [GATED: config.cee.orchestratorValidationEnabled]
  ├── validateAndRepairGraph() with RepairOnlyAdapter
  ├── Up to 2 attempts (draft + 1 LLM repair)
  └── 422 if Bucket C violations remain and llmRepairNeeded=false
  │
  ▼
Substep 2: PLoT Validation + LLM Repair
  ├── External PLoT engine validation
  ├── LLM repair if llmRepairNeeded=true and budget allows
  ├── simpleRepair() as final fallback (never early-returns)
  └── Graph stabilisation (DAG enforcement, pruning)
  │
  ▼
Substeps 3–10: Post-repair transforms
  ├── 3: Edge ID stabilisation
  ├── 4: Goal merge (enforceSingleGoal)
  ├── 5: Compound goals (constraint edges)
  ├── 6: Late STRP (constraint label fuzzy match, controllable data fill)
  ├── 7: Edge field restoration (V4 fields)
  ├── 8: Connectivity (wire orphans to goal)
  ├── 9: Clarifier [GATED]
  └── 10: Structural parse (Zod safety net)
```

### Key repair functions

| Function | File | Purpose |
|---|---|---|
| `runDeterministicSweep` | `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts` | Multi-step deterministic repair, sets llmRepairNeeded flag |
| `simpleRepair` | `src/services/repair.ts` | Lightweight fallback: cap trimming, orphan wiring, pruning |
| `validateGraph` | `src/validators/graph-validator.ts` | Deterministic structural validation (pre/post sweep) |
| `reconcileStructuralTruth` | `src/validators/structural-reconciliation.ts` | STRP: metadata reconciliation (category override, constraint fuzzy match) |
| `repairGraphWithAnthropic` | `src/adapters/llm/anthropic.ts` | LLM-based repair (violations + graph → repaired graph) |
| `validateAndRepairGraph` | `src/cee/graph-orchestrator.ts` | Validation + repair loop with retry |

### Repair classification (Bucket system)

| Bucket | Codes | Repair Method |
|---|---|---|
| **A** (always auto-fix) | NAN_VALUE, SIGN_MISMATCH, STRUCTURAL_EDGE_NOT_CANONICAL, INVALID_EDGE_REF, GOAL_HAS_OUTGOING, DECISION_HAS_INCOMING | Deterministic sweep |
| **B** (fix when cited) | CATEGORY_MISMATCH, CONTROLLABLE_MISSING_DATA, OBSERVABLE_MISSING_DATA, OBSERVABLE_EXTRA_DATA, EXTERNAL_HAS_DATA | Deterministic sweep |
| **C** (semantic, LLM) | CYCLE_DETECTED, FORBIDDEN_EDGE*, ORPHAN_NODE*, MISSING_BRIDGE, NO_EFFECT_PATH, OPTIONS_IDENTICAL | LLM repair or simpleRepair fallback |

*Note: FORBIDDEN_EDGE and ORPHAN_NODE are classified as Bucket C (LLM) in the production pipeline. However, deterministic approaches can handle many cases — see Section 3.

---

## Section 2: Test Design

### Failed graphs under test

7 graphs that failed structural validation in v2 challenger runs:

| # | Model | Brief | Pre-Repair Violations | Nodes | Edges |
|---|---|---|---|---|---|
| 1 | gpt-4.1 | 09-nested-subdecision | ORPHAN_NODE | 21 | 31 |
| 2 | gpt-4.1 | 11-feedback-loop-trap | CYCLE_DETECTED | 16 | 23 |
| 3 | gpt-4.1 | 13-forced-binary | FORBIDDEN_EDGE | 15 | 26 |
| 4 | gpt-4o | 02-multi-option-constrained | ORPHAN_NODE | 13 | 17 |
| 5 | gpt-4o | 09-nested-subdecision | CONTROLLABLE_NO_OPTION_EDGE, ORPHAN_NODE | 16 | 17 |
| 6 | gpt-4o | 10-many-observables | ORPHAN_NODE | 17 | 15 |
| 7 | gpt-4o | 11-feedback-loop-trap | FORBIDDEN_EDGE ×2 | 10 | 12 |

### Repair layers tested

The test harness applies deterministic repair layers in sequence:

1. **Remove forbidden edges** — Filter edges not in ALLOWED_EDGE_PATTERNS
2. **Break cycles** — Kahn's algorithm + back-edge removal
3. **Wire orphaned outcome/risk → goal** — Add missing outbound edges
4. **Wire orphaned outcome/risk ← factor** — Add missing inbound edges from causal chain
5. **Wire controllable factors ← option** — Connect unwired controllable factors
6. **Drop disconnected observables** — Remove observable/external factors with zero edges

Re-validation uses the evaluator's `validateStructural` (same validator that determined the original failures).

### Not tested (requires live LLM)

- LLM-based repair via `repairGraphWithAnthropic` (would require API calls)
- PLoT engine external validation
- STRP metadata reconciliation (only affects data fields, not structural validity)

---

## Section 3: Results

### Per-graph repair outcomes

| # | Model × Brief | Pre-Repair | Repair Actions | Post-Repair | Status |
|---|---|---|---|---|---|
| 1 | gpt-4.1 × 09-nested | ORPHAN_NODE | Dropped 1 disconnected observable (`fac_revenue_per_delivery`) | Clean | **REPAIRED** |
| 2 | gpt-4.1 × 11-feedback-loop | CYCLE_DETECTED | Removed 8 back-edges; wired 1 outcome→goal; wired 1 outcome←factor; dropped 1 observable | ORPHAN_NODE | **FAILED** |
| 3 | gpt-4.1 × 13-forced-binary | FORBIDDEN_EDGE | Removed 1 forbidden edge | Clean | **REPAIRED** |
| 4 | gpt-4o × 02-multi-option | ORPHAN_NODE | Dropped 1 disconnected observable (`fac_team_size`) | Clean | **REPAIRED** |
| 5 | gpt-4o × 09-nested | CONTROLLABLE_NO_OPTION_EDGE + ORPHAN_NODE | Wired 1 controllable←option; dropped 1 observable (`fac_current_delivery_volume`) | Clean | **REPAIRED** |
| 6 | gpt-4o × 10-observables | ORPHAN_NODE | Dropped 5 disconnected observables | Clean | **REPAIRED** |
| 7 | gpt-4o × 11-feedback-loop | FORBIDDEN_EDGE ×2 | Removed 2 forbidden edges; wired 1 outcome→goal; wired 2 outcome←factor | Clean | **REPAIRED** |

**Overall: 6/7 repaired (86% repair rate)**

### Post-repair pass rates

| Model | Original Pass Rate | Post-Repair Pass Rate | Recovered |
|---|---|---|---|
| **gpt-4o v2** | 10/14 (71%) | **14/14 (100%)** | 4/4 failures |
| **gpt-4.1 v2** | 11/14 (79%) | **13/14 (93%)** | 2/3 failures |
| **Claude v2** | 13/14 (93%) | 13/14 (93%) | N/A (timeout, not structural) |

### Combined leaderboard (with repair)

| Model | Pre-Repair | Post-Repair | Delta |
|---|---|---|---|
| gpt-4o v2 + repair | 71% | **100%** | +29% |
| Claude v2 (raw) | 93% | 93% | — |
| gpt-4.1 v2 + repair | 79% | **93%** | +14% |

---

## Section 4: Failure Analysis

### The one unrepairable case: gpt-4.1 × brief-11 (feedback loop trap)

**Root cause:** The LLM encoded a genuine 4-node feedback cycle:

```
fac_match_quality → fac_buyer_satisfaction → fac_buyer_base → fac_supplier_base → fac_match_quality
```

This is structurally correct — the brief explicitly describes a marketplace network effect where better matching increases buyer satisfaction, which grows the buyer base, which attracts suppliers, which improves matching. The LLM faithfully encoded this causal loop.

**Why deterministic repair fails:**
1. Cycle breaking removes 8 edges (all back-edges in the cycle)
2. This disconnects `fac_buyer_satisfaction` from the forward graph
3. The disconnected node becomes an orphan
4. Observable drop can't help — `fac_buyer_satisfaction` is a controllable factor, not an observable
5. Orphan wiring only targets outcome/risk nodes, not factors

**What would fix it:**
- **LLM repair** could restructure the cycle as a unidirectional chain (match_quality → buyer_satisfaction → buyer_base) and express the feedback loop in coaching text instead
- **Prompt engineering** to prevent cycles at generation time (the v2 prompt's cycle prevention instruction was insufficient for this brief)

### Violation patterns and repair effectiveness

| Violation Code | Occurrences | Repaired | Repair Method |
|---|---|---|---|
| ORPHAN_NODE (disconnected observable) | 4 | 4/4 (100%) | Drop zero-edge observable factors |
| FORBIDDEN_EDGE | 3 | 3/3 (100%) | Remove and re-wire orphaned endpoints |
| CONTROLLABLE_NO_OPTION_EDGE | 1 | 1/1 (100%) | Wire controllable factor ← first option |
| CYCLE_DETECTED | 1 | 0/1 (0%) | Back-edge removal creates secondary orphans |

---

## Section 5: Repair Quality Assessment

### Do repaired graphs lose semantic content?

| Repair Type | Semantic Impact |
|---|---|
| **Drop disconnected observables** | **Minimal.** These factors had zero edges — they contributed no causal information. The LLM emitted them as context data but never connected them to the decision model. Dropping them removes clutter. |
| **Remove forbidden edges** | **Low.** Forbidden edge patterns (e.g., option→outcome) represent structural errors. The causal relationship is preserved by re-wiring through factors. |
| **Wire controllable ← option** | **Low.** The wiring is synthetic (from first option at default strength), but it's better than the alternative (orphan validation failure). |
| **Cycle breaking + orphan creation** | **High.** Breaking a genuine feedback loop destroys meaningful causal structure. This is the case that needs LLM repair. |

### Graph size impact

| # | Model × Brief | Nodes Before | Nodes After | Edges Before | Edges After |
|---|---|---|---|---|---|
| 1 | gpt-4.1 × 09-nested | 21 | 20 (-1) | 31 | 31 |
| 3 | gpt-4.1 × 13-forced-binary | 15 | 15 | 26 | 25 (-1) |
| 4 | gpt-4o × 02-multi-option | 13 | 12 (-1) | 17 | 17 |
| 5 | gpt-4o × 09-nested | 16 | 15 (-1) | 17 | 18 (+1) |
| 6 | gpt-4o × 10-observables | 17 | 12 (-5) | 15 | 15 |
| 7 | gpt-4o × 11-feedback-loop | 10 | 10 | 12 | 13 (+1) |

Most repairs are minimal (1 node or 1 edge change). gpt-4o × 10-observables is the outlier — 5 disconnected observables dropped — but those nodes had zero edges and contributed nothing to the analysis.

---

## Section 6: Recommendations

### 1. Enable disconnected-observable pruning in production deterministic sweep

The production sweep proactively reclassifies unreachable factors but doesn't drop zero-edge observables. Adding this step would fix 4 of 7 failures tested here. This is a one-line change to the sweep's proactive repair section.

**Impact:** +14–29% post-repair pass rate for gpt-4o and gpt-4.1.

### 2. FORBIDDEN_EDGE repair should be Bucket A (always auto-fix), not Bucket C

The production pipeline classifies FORBIDDEN_EDGE as requiring LLM repair (Bucket C). Our tests show that deterministic removal + re-wiring is sufficient in all 3 cases tested. Moving this to Bucket A would reduce LLM repair calls and cost.

### 3. Cycle repair needs LLM — prompt engineering alone is insufficient

The one unrepairable case (gpt-4.1 × feedback-loop) demonstrates that:
- Brief-11 describes a genuine feedback loop, and the LLM faithfully encodes it
- Cycle prevention instructions in the prompt are insufficient when the brief explicitly describes circular causality
- LLM repair is the correct solution: restructure the cycle as a unidirectional chain and express the feedback in coaching

### 4. gpt-4o v2 achieves 100% with repair pipeline

If the production repair pipeline is enhanced with recommendations 1 and 2 above, gpt-4o v2 achieves 100% structural pass rate — matching Claude v2's variance-run performance. This changes the model selection calculus:

| Factor | Claude v2 | gpt-4o v2 + repair |
|---|---|---|
| Structural pass rate | 93–100% | 100% (post-repair) |
| Latency | 95s avg | 19s avg (5× faster) |
| Cost | $0.00 (cached) | $0.69/run |
| Repair dependency | None | Deterministic (no LLM repair needed) |

### 5. Brief-11 needs model-specific routing

Brief-11 (feedback loop trap) is the only brief that resists all prompt + repair approaches for gpt-4.1. Consider:
- Routing marketplace/network-effect briefs to Claude (which handles them cleanly)
- Or accepting this as a known limitation and relying on LLM repair for ~7% of gpt-4.1 graphs

---

## Appendix: Test Script

Test script location: `tools/graph-evaluator/scripts/repair-test.ts`

Run: `npx tsx tools/graph-evaluator/scripts/repair-test.ts`

The script loads failed response JSONs from evaluator results, applies deterministic repair layers, and re-validates using the same evaluator validator. No live LLM calls required.

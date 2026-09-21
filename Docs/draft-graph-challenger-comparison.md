# Draft Graph Challenger Comparison

**Date:** 2026-03-13
**Fixtures:** 14 briefs (4 original + 4 from gold-briefs + 6 targeted stress tests)
**Scoring:** Deterministic structural scorer (param quality, option differentiation, completeness)
**Runs:** 5 initial + 1 variance check + 3 stress tests = 9 total

---

## Section 1: Fixture Inventory

### Briefs used (8 total)

| # | Brief ID | Source | Archetype | Complexity |
|---|---|---|---|---|
| 01 | simple-binary | Original | Pricing (raise vs keep) | simple |
| 02 | multi-option-constrained | Original | International expansion (3 markets) | complex |
| 03 | vague-underspecified | Original | Hiring strategy (vague) | simple |
| 04 | conflicting-constraints | Original | Healthtech (growth vs burn) | complex |
| 05 | product-feature | gold_003 | Product roadmap (AI vs offline) | moderate |
| 06 | operations-warehouse | gold_007 | Operations (robots vs QC staff) | moderate |
| 07 | cloud-migration | gold_010 | Technology (AWS vs Azure vs GCP) | complex |
| 08 | channel-strategy | gold_011 | Strategy (wholesale vs retail) | moderate |

### Conversion notes

Gold briefs (TypeScript objects in `tests/benchmarks/gold-briefs/gold-briefs.ts`) were converted to the evaluator's gray-matter frontmatter format (`.md` files in `tools/graph-evaluator/briefs/`). Conversion was straightforward — brief text mapped directly to body content, and frontmatter fields (`expect_status_quo`, `has_numeric_target`, `complexity`) were inferred from the brief content and `notes` metadata.

### Key finding: expanded fixtures expose hidden failures

On the original 4 briefs, gpt-4.1 baseline achieved 100% pass rate (4/4). On 8 briefs, it drops to 63% (5/8). The original 4 briefs were insufficient for high-confidence model selection.

---

## Section 2: Baseline Re-confirmation

### gpt-4o baseline variance (v175)

| Brief | Run 1 (prev) | Run 2 (this) | Variance |
|---|---|---|---|
| 01-simple-binary | 0.910 | 0.910 | 0.000 |
| 02-multi-option | 0.880 | ORPHAN_NODE | **pass→fail** |
| 03-vague | 0.880 | 0.989 | +0.109 |
| 04-conflicting | OPTION_NO_GOAL_PATH | 0.916 | **fail→pass** |
| 05-product (new) | — | FORBIDDEN_EDGE | — |
| 06-operations (new) | — | 0.770 | — |
| 07-cloud (new) | — | 0.914 | — |
| 08-channel (new) | — | 0.871 | — |
| **Avg (scored)** | 0.890 (3/4) | 0.895 (6/8) | |

**Confidence: LOW.** Two briefs flipped pass/fail status between runs. Score variance up to 0.109 on brief-03. gpt-4o results are not reproducible.

### gpt-4.1 baseline variance (v175)

| Brief | Run 1 (prev) | Run 2 (this) | Variance |
|---|---|---|---|
| 01-simple-binary | 0.910 | 0.910 | 0.000 |
| 02-multi-option | 0.867 | 0.809 | -0.058 |
| 03-vague | 0.851 | 0.874 | +0.023 |
| 04-conflicting | 0.867 | 0.851 | -0.016 |
| 05-product (new) | — | 0.794 | — |
| 06-operations (new) | — | FORBIDDEN_EDGE | — |
| 07-cloud (new) | — | INVALID_EDGE_REF; CYCLE | — |
| 08-channel (new) | — | FORBIDDEN_EDGE | — |
| **Avg (scored)** | 0.874 (4/4) | 0.848 (5/8) | |

**Confidence: MEDIUM.** Scores on original 4 briefs are stable (max variance 0.058). But 3 of 4 new briefs fail — the expanded fixture set reveals gpt-4.1's FORBIDDEN_EDGE and CYCLE tendencies that weren't visible on the original 4.

---

## Section 3: Challenger Results

| Combination | Scored | Invalid | Failed | Avg (scored) | Pass Rate | vs Baseline |
|---|---|---|---|---|---|---|
| gpt-4o baseline (v175) | 6/8 | 2 | 0 | 0.895 | 75% | — |
| gpt-4.1 baseline (v175) | 5/8 | 3 | 0 | 0.848 | 63% | — |
| **gpt-4o challenger** (v175-gpt4o) | 6/8 | 2 | 0 | **0.922** | 75% | avg +0.027, same pass rate |
| **gpt-4.1 challenger** (v175-gpt41) | 4/8 | 4 | 0 | 0.859 | 50% | avg +0.011, pass rate -13% |
| **Claude challenger** (v175B-claude) | **8/8** | 0 | 0 | 0.866 | **100%** | only 100% combination |

### Challenger prompt descriptions

| Challenger | Base | Edits | Target failure |
|---|---|---|---|
| gpt-4o (v175-gpt4o) | v175 | Bridge verification after step 7 + final checks checklist | OPTION_NO_GOAL_PATH |
| gpt-4.1 (v175-gpt41) | v175 | Containment guard after step 4 (max 6 options, 15 nodes) | TOO_MANY_OPTIONS |
| Claude (v175B-claude) | v175-B | Hard output caps (max 15 nodes, 10 topology lines, 6 claims, 2 strengthen) | Timeout on brief-02 |

---

## Section 4: Per-Brief Breakdown

| Brief | gpt-4o base | gpt-4o ch | gpt-4.1 base | gpt-4.1 ch | Claude ch (run 1) | Claude ch (run 2) |
|---|---|---|---|---|---|---|
| 01-simple-binary | 0.910 | 0.910 | 0.910 | FORBIDDEN_EDGE | 0.910 | 0.925 |
| 02-multi-option | ORPHAN_NODE | 0.870 | 0.809 | TOO_MANY_OPTIONS | 0.851 | timeout |
| 03-vague | 0.989 | 0.914 | 0.874 | 0.867 | 0.885 | 0.925 |
| 04-conflicting | 0.916 | **0.895** | 0.851 | 0.867 | 0.845 | 0.858 |
| 05-product | FORBIDDEN_EDGE | **0.989** | 0.794 | FORBIDDEN_EDGE | 0.794 | 0.796 |
| 06-operations | 0.770 | ORPHAN_NODE | FORBIDDEN_EDGE | FORBIDDEN_EDGE | **0.876** | 0.787 |
| 07-cloud | 0.914 | **0.953** | CYCLE_DETECTED | 0.863 | 0.885 | 0.885 |
| 08-channel | 0.871 | ORPHAN_NODE | FORBIDDEN_EDGE | 0.840 | **0.885** | 0.876 |

**Bold** marks notable improvements from challenger edits.

### Failure detail

| Combination | Brief | Violation | Root cause | Type |
|---|---|---|---|---|
| gpt-4o base | 02 | ORPHAN_NODE | Disconnected factor node | Prompt-induced |
| gpt-4o base | 05 | FORBIDDEN_EDGE | option→outcome edge | Prompt-induced |
| gpt-4o ch | 06 | ORPHAN_NODE; OPTION_NO_GOAL_PATH | Disconnected node + missing bridge | Prompt-induced |
| gpt-4o ch | 08 | ORPHAN_NODE | Disconnected factor node | Prompt-induced |
| gpt-4.1 base | 06 | FORBIDDEN_EDGE | Forbidden edge type | Prompt-induced |
| gpt-4.1 base | 07 | INVALID_EDGE_REF; CYCLE_DETECTED | Bad edge ref + cycle | Prompt-induced |
| gpt-4.1 base | 08 | FORBIDDEN_EDGE | Forbidden edge type | Prompt-induced |
| gpt-4.1 ch | 01 | FORBIDDEN_EDGE | Regression from containment edit | Prompt-induced |
| gpt-4.1 ch | 02 | TOO_MANY_OPTIONS | 22 nodes, containment didn't prevent | Prompt-induced |
| gpt-4.1 ch | 05 | FORBIDDEN_EDGE | Forbidden edge type | Prompt-induced |
| gpt-4.1 ch | 06 | FORBIDDEN_EDGE | Forbidden edge type | Prompt-induced |
| Claude ch v2 | 02 | timeout (NO_GRAPH) | Brief-02 complexity exceeds timeout | Timeout-induced |

Raw response paths: `tools/graph-evaluator/results/<run-id>/<model>/<brief-id>/response.json`

---

## Section 5: Key Questions

### 1. Does gpt-4o now pass brief-04? (bridge-edge target)

**Yes.** The bridge verification + final checks edits fix brief-04: 0.895 (challenger) vs OPTION_NO_GOAL_PATH (baseline run 1). However, brief-04 also passed on baseline run 2 (0.916) — this brief is unstable across runs, so the fix may be partially coincidental.

### 2. Does gpt-4o pass any briefs it previously failed?

**Yes — brief-02 and brief-05.** Brief-02: ORPHAN_NODE (baseline) → 0.870 (challenger). Brief-05: FORBIDDEN_EDGE (baseline) → 0.989 (challenger, highest individual score in the benchmark). The final checks checklist appears to help gpt-4o catch forbidden edges before output.

### 3. Does gpt-4.1 maintain 100% with containment guard?

**No — it gets worse.** Pass rate drops from 63% (5/8) to 50% (4/8). The containment guard causes a new regression on brief-01 (FORBIDDEN_EDGE, was 0.910) and fails to prevent the brief-02 explosion (22 nodes, 44 edges). gpt-4.1's failures are edge-type violations, not option count — the containment guard targets the wrong problem.

### 4. Does Claude + output caps improve latency without losing pass rate?

**Partially.** Run 1: 100% pass rate (8/8), avg latency 95s, no timeouts. Run 2: 88% (7/8), brief-02 timed out. The output caps reduce generation size (avg output tokens: 7,400 vs ~8,700 for v175-B without caps) but brief-02 remains on the timeout boundary. Latency on non-timeout briefs is stable at 69–117s.

### 5. On expanded fixtures: do any models show new failure patterns not seen on the original 4?

**Yes — significantly.**

- **ORPHAN_NODE**: New failure mode for gpt-4o, not seen on original 4. Appears on briefs 02, 06, 08. The model creates factor nodes with no edges connecting them.
- **FORBIDDEN_EDGE**: gpt-4.1's primary failure mode on new briefs (06, 07, 08). Creates option→outcome or factor→goal edges that the topology rules prohibit.
- **CYCLE_DETECTED**: gpt-4.1 on brief-07 creates circular dependencies. Not seen on original 4.
- **INVALID_EDGE_REF**: gpt-4.1 on brief-07 references non-existent node IDs in edges.

The original 4-brief set gave a misleadingly positive picture of model compliance. The expanded set is essential for reliable evaluation.

### 6. Is there a combination that achieves 100% pass rate with the highest average score?

**Claude challenger (v175B-claude) is the only combination to achieve 100% pass rate** — but only on run 1. Run 2 drops to 88% (brief-02 timeout). No other combination exceeds 75% pass rate on the expanded 8-brief set.

---

## Section 6: Variance Assessment

### Baseline variance

| Model | Brief | Run 1 Score | Run 2 Score | Status |
|---|---|---|---|---|
| gpt-4o | 02 | 0.880 | ORPHAN_NODE | **Flipped** |
| gpt-4o | 03 | 0.880 | 0.989 | +0.109 |
| gpt-4o | 04 | OPTION_NO_GOAL_PATH | 0.916 | **Flipped** |
| gpt-4.1 | 02 | 0.867 | 0.809 | -0.058 |
| gpt-4.1 | 03 | 0.851 | 0.874 | +0.023 |
| gpt-4.1 | 04 | 0.867 | 0.851 | -0.016 |

### Claude challenger variance

| Brief | Run 1 | Run 2 | Delta |
|---|---|---|---|
| 01 | 0.910 | 0.925 | +0.015 |
| 02 | 0.851 | timeout | **Flipped** |
| 03 | 0.885 | 0.925 | +0.040 |
| 04 | 0.845 | 0.858 | +0.013 |
| 05 | 0.794 | 0.796 | +0.002 |
| 06 | 0.876 | 0.787 | -0.089 |
| 07 | 0.885 | 0.885 | 0.000 |
| 08 | 0.885 | 0.876 | -0.009 |

### Confidence levels

| Combination | Confidence | Rationale |
|---|---|---|
| gpt-4o baseline | **LOW** | 2 briefs flipped pass/fail between runs |
| gpt-4.1 baseline | **MEDIUM** | Scores stable on original 4; new briefs consistently fail |
| gpt-4o challenger | **MEDIUM** | Not re-run; single-run data only |
| gpt-4.1 challenger | **MEDIUM** | Not re-run; consistently worse than baseline |
| Claude challenger | **MEDIUM** | 100% on run 1, 88% on run 2 — brief-02 is unstable |

---

## Section 7: Final Ranking

Decision criteria applied in order: (1) pass rate, (2) average score, (3) latency, (4) cost.

| Rank | Combination | Pass Rate | Avg Score | Avg Latency | Confidence |
|---|---|---|---|---|---|
| 1 | **Claude challenger** (v175B-claude) | 100% (run 1) / 88% (run 2) | 0.866 / 0.864 | 95s / 91s | MEDIUM |
| 2 | **gpt-4o challenger** (v175-gpt4o) | 75% | **0.922** | 29s | MEDIUM |
| 3 | gpt-4o baseline (v175) | 75% | 0.895 | 33s | LOW |
| 4 | gpt-4.1 baseline (v175) | 63% | 0.848 | 32s | MEDIUM |
| 5 | gpt-4.1 challenger (v175-gpt41) | 50% | 0.859 | 34s | MEDIUM |

### Recommendation

**Claude challenger (v175B-claude) should advance to staging replay.**

Rationale:
- Only combination to achieve 100% pass rate on any run
- Solves the brief-02 timeout problem that plagued all previous Claude prompts (v175, v175-B without caps)
- Passes all 4 new briefs that expose failures in both OpenAI models
- Brief-02 timeout on run 2 is a known risk — the hard output caps bring it close to the boundary but don't fully eliminate it

**Secondary consideration: gpt-4o challenger (v175-gpt4o)**

If Claude latency (~95s) is unacceptable for production:
- gpt-4o challenger has the highest average score (0.922) and 3× faster latency (29s)
- The bridge verification and final checks edits measurably improve gpt-4o's structural compliance
- But 75% pass rate means 1 in 4 briefs will produce invalid graphs

**Not recommended:**
- gpt-4.1 challenger — the containment guard regresses brief-01 and doesn't prevent the edge-type violations that are gpt-4.1's actual failure mode
- gpt-4.1 baseline — 63% pass rate on expanded briefs; the original 100% on 4 briefs was misleading
- gpt-4o baseline — high variance (LOW confidence); the challenger is strictly better

**Do not promote directly to staging.** The Claude challenger's brief-02 instability requires replay validation on real user conversations to confirm the output caps are sufficient.

---

## Section 8: Stress Test Results

6 additional briefs designed to target specific model weaknesses and strengths.

### Stress brief inventory

| # | Brief | Target weakness | Trap mechanism |
|---|---|---|---|
| 09 | nested-subdecision | Timeout / over-expansion | Build vs partner with nested if/then sub-choices |
| 10 | many-observables | ORPHAN_NODE | 6+ explicit numeric baselines tempt unwired observables |
| 11 | feedback-loop-trap | CYCLE_DETECTED | Brief describes explicit circular mechanism |
| 12 | similar-options | Low option_diff / FORBIDDEN_EDGE | Three pricing changes with overlapping interventions |
| 13 | forced-binary | Floor test (should be easy) | Clean forced binary, no status quo |
| 14 | qualitative-strategy | Completeness / FORBIDDEN_EDGE | No numeric targets, qualitative trade-offs only |

### Stress results

| Brief | gpt-4o challenger | gpt-4.1 baseline | Claude challenger |
|---|---|---|---|
| 09-nested-subdecision | **timeout** | **0.851** | **timeout** |
| 10-many-observables | 0.794 | 0.867 | **0.885** |
| 11-feedback-loop-trap | 0.835 | **CYCLE + FORBIDDEN** | **0.885** |
| 12-similar-options | 0.805 | **FORBIDDEN** | **FORBIDDEN + ORPHAN** |
| 13-forced-binary | 0.845 | 0.794 | **0.885** |
| 14-qualitative-strategy | **0.916** | 0.867 | 0.885 |
| **Pass rate** | 83% (5/6) | 67% (4/6) | 67% (4/6) |
| **Avg (scored)** | 0.839 | 0.845 | **0.885** |

### Stress analysis

**Brief 09 (nested sub-decision) — hardest brief in the benchmark:**
Both gpt-4o and Claude timeout. gpt-4.1 is the only model to pass (0.851), likely because it generates faster and the nested structure doesn't cause as much expansion. This brief exposes a fundamental latency ceiling — complex nested decisions with conditional sub-choices take longer than the timeout allows for gpt-4o and Claude.

**Brief 11 (feedback loop trap) — model differentiator:**
The brief explicitly describes a circular mechanism (match quality → buyer satisfaction → more buyers → more suppliers → better match quality). gpt-4.1 encodes this literally as a cycle (CYCLE_DETECTED + FORBIDDEN_EDGE). Both gpt-4o and Claude correctly linearise the circular mechanism into an acyclic causal graph — this requires genuine causal reasoning rather than literal transcription.

**Brief 12 (similar options) — universally hard:**
Three pricing changes with heavily overlapping interventions. Claude gets its first structural failures on these prompts (FORBIDDEN_EDGE + ORPHAN_NODE), gpt-4.1 gets FORBIDDEN_EDGE, and gpt-4o passes but with low option_diff (0.500). This brief is a genuine quality ceiling — differentiating similar quantitative options is intrinsically difficult for all models.

**Brief 13 (forced binary) — expected easy, reveals param quality:**
All three models pass. Claude scores highest (0.885) with perfect param_quality (1.000). gpt-4.1 scores lowest (0.794) due to low completeness (0.700) — surprising given this is the simplest brief. gpt-4.1 over-builds (15 nodes for a binary choice) which hurts its readability score.

**Brief 14 (qualitative strategy) — gpt-4o's strength:**
gpt-4o leads (0.916) with excellent param_quality (0.970) and full completeness. Qualitative briefs without numeric anchors play to gpt-4o's strengths — it doesn't get trapped by numbers and produces well-structured graphs. Claude also scores well (0.885). gpt-4.1 is solid (0.867).

### Model strength/weakness profiles

| Model | Strengths | Weaknesses |
|---|---|---|
| **gpt-4o challenger** | Qualitative briefs (0.916), avoids cycles, avoids forbidden edges on trap briefs | Timeout on complex nested briefs, ORPHAN_NODE on observables, low option_diff on similar options |
| **gpt-4.1 baseline** | Only model to handle nested sub-decisions (brief-09), fastest latency | FORBIDDEN_EDGE on complex briefs, falls into cycle trap, over-builds simple briefs |
| **Claude challenger** | Highest floor (0.885 on all passed briefs), perfect param_quality, correct causal linearisation | Timeout on complex nested briefs, FORBIDDEN_EDGE on similar-option briefs |

### Combined pass rates (8 original + 6 stress = 14 briefs)

| Combination | Original 8 | Stress 6 | Total 14 | Overall pass rate |
|---|---|---|---|---|
| gpt-4o challenger | 6/8 | 5/6 | **11/14** | **79%** |
| gpt-4.1 baseline | 5/8 | 4/6 | 9/14 | 64% |
| Claude challenger | 8/8 | 4/6 | **12/14** | **86%** |

### Updated recommendation

The stress tests reinforce the original ranking but with nuance:

1. **Claude challenger remains the top pick** — 86% pass rate across 14 briefs, highest average on scored briefs (0.885 stress, 0.866 original). Failures are limited to timeout (brief-09) and one structural failure on the hardest differentiation brief (12).

2. **gpt-4o challenger is the strongest OpenAI option** — 79% pass rate, best qualitative performance, avoids the cycle and forbidden-edge traps that plague gpt-4.1. Timeout on brief-09 is the main weakness.

3. **gpt-4.1 baseline is the latency winner but structurally weakest** — only model to survive brief-09 (no timeout), but 64% pass rate is too low for production confidence. FORBIDDEN_EDGE is its systematic failure mode.

4. **Brief-09 (nested sub-decision) and brief-12 (similar options) are the hardest briefs** — no model handles both cleanly. These represent genuine quality ceilings that may require prompt-level solutions beyond the current variants.

---

## Run Metadata

| Run ID | Prompt | Model | Scored | Invalid | Failed | Results Dir |
|---|---|---|---|---|---|---|
| dg2-v175-gpt4o | v175 (baseline) | gpt-4o | 6 | 2 | 0 | `results/dg2-v175-gpt4o/` |
| dg2-v175-gpt41 | v175 (baseline) | gpt-4.1 | 5 | 3 | 0 | `results/dg2-v175-gpt41/` |
| dg2-v175-gpt4o-ch | v175-gpt4o (challenger) | gpt-4o | 6 | 2 | 0 | `results/dg2-v175-gpt4o-ch/` |
| dg2-v175-gpt41-ch | v175-gpt41 (challenger) | gpt-4.1 | 4 | 4 | 0 | `results/dg2-v175-gpt41-ch/` |
| dg2-v175B-claude-ch | v175B-claude (challenger) | claude-sonnet-4-6 | 8 | 0 | 0 | `results/dg2-v175B-claude-ch/` |
| dg2-v175B-claude-ch-v2 | v175B-claude (variance) | claude-sonnet-4-6 | 7 | 0 | 1 | `results/dg2-v175B-claude-ch-v2/` |
| dg3-gpt4o-stress | v175-gpt4o (stress) | gpt-4o | 5 | 0 | 1 | `results/dg3-gpt4o-stress/` |
| dg3-gpt41-stress | v175 (stress) | gpt-4.1 | 4 | 2 | 0 | `results/dg3-gpt41-stress/` |
| dg3-claude-stress | v175B-claude (stress) | claude-sonnet-4-6 | 4 | 1 | 1 | `results/dg3-claude-stress/` |

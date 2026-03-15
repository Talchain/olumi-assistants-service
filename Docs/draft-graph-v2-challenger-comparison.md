# Draft Graph v2 Challenger Comparison

**Date:** 2026-03-13
**Fixtures:** 14 briefs (4 original + 4 gold-brief + 6 targeted stress tests)
**Scoring:** Deterministic structural scorer (param quality 30%, option differentiation 30%, completeness 40%)
**Runs:** 3 v2 challengers + 1 variance check = 4 runs

---

## Section 1: v2 Prompt Edits Summary

Each v2 challenger applies targeted edits to the winning v1 prompt, informed by stress-test failure analysis.

### Claude v2 (`draft-v175B-claude-v2.txt`)

Base: v175-B (v175 + 3 surgical edits). v2 additions:

| Edit | Location | Purpose |
|---|---|---|
| A — Hard Output Caps | End of CONSTRUCTION_FLOW | Max 10 topology lines, 4 causal claims, 2 strengthen, 15 nodes |
| B — Parsimony | Step 3 FACTORS | "Does removing this factor change which option wins?" — prefer 8-12 nodes |
| C — Nested Decisions | Step 4 OPTIONS | Model only primary strategic fork, route sub-decisions to coaching |

**Rationale:** v1 Claude's only failures were timeout (brief-02) and structural bloat on brief-12 (FORBIDDEN_EDGE + ORPHAN_NODE in stress test). Parsimony + caps target both.

### gpt-4.1 v2 (`draft-v175-gpt41-v2.txt`)

Base: v175. v2 additions:

| Edit | Location | Purpose |
|---|---|---|
| A — Containment | Step 4 OPTIONS | Max 6 options, 15 nodes total |
| B — Edge Validation | After step 7 EDGES | Per-edge allowed-pattern verification + cycle prevention (linearise feedback loops) |
| C — Similar Options | Step 4 OPTIONS | Encode through distinct intervention magnitudes |

**Rationale:** v1 gpt-4.1 failed on CYCLE_DETECTED (brief-11), FORBIDDEN_EDGE (brief-12), and over-expansion. Edge validation + containment target the systematic topology violations.

### gpt-4o v2 (`draft-v175-gpt4o-v2.txt`)

Base: v175. v2 additions:

| Edit | Location | Purpose |
|---|---|---|
| A — Inline Wiring | After step 3 FACTORS | Plan edges for each factor immediately after creation |
| B — Bridge Verification | After step 7 EDGES | Verify outcome/risk→goal edges exist |
| C — Final Checks | End of CONSTRUCTION_FLOW | 9-point checklist (orphan check, forbidden edge check, etc.) |
| D — Similar Options | Step 4 OPTIONS | Encode through distinct intervention magnitudes |

**Rationale:** v1 gpt-4o's dominant failure was ORPHAN_NODE (unwired factors). Inline wiring + bridge verification + final checklist target disconnected subgraphs.

---

## Section 2: v2 Full Results (14 Briefs)

### Claude v2 × claude-sonnet-4-6

| Brief | Valid | Param Q | Opt Diff | Complete | Overall | Latency | Nodes |
|---|---|---|---|---|---|---|---|
| 01-simple-binary | ✓ | 0.963 | 0.750 | 1.000 | **0.914** | 72s | 12 |
| 02-multi-option | ✗ | — | — | — | timeout | 120s | — |
| 03-vague | ✓ | 1.000 | 0.750 | 1.000 | **0.925** | 93s | 12 |
| 04-conflicting | ✓ | 0.970 | 0.750 | 0.900 | 0.876 | 100s | 13 |
| 05-product | ✓ | 0.963 | 0.750 | 0.700 | 0.794 | 95s | 14 |
| 06-operations | ✓ | 0.970 | 0.750 | 0.700 | 0.796 | 103s | 15 |
| 07-cloud | ✓ | 0.940 | 0.750 | 0.900 | 0.867 | 91s | 15 |
| 08-channel | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 93s | 15 |
| 09-nested | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 116s | 15 |
| 10-observables | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 100s | 15 |
| 11-feedback-loop | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 85s | 13 |
| 12-similar-options | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 96s | 13 |
| 13-forced-binary | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 92s | 14 |
| 14-qualitative | ✓ | 0.880 | 0.750 | 0.900 | 0.849 | 88s | 15 |

**Pass rate: 93% (13/14).** Average score (scored): **0.872.** Only failure: brief-02 timeout.

### gpt-4.1 v2 × gpt-4.1

| Brief | Valid | Param Q | Opt Diff | Complete | Overall | Latency | Nodes | Violations |
|---|---|---|---|---|---|---|---|---|
| 01-simple-binary | ✓ | 0.900 | 0.750 | 1.000 | **0.895** | 23s | 10 | |
| 02-multi-option | ✓ | 0.888 | 0.750 | 0.900 | 0.851 | 43s | 17 | |
| 03-vague | ✓ | 0.925 | 0.750 | 1.000 | **0.903** | 28s | 12 | |
| 04-conflicting | ✓ | 1.000 | 0.750 | 0.900 | 0.885 | 39s | 13 | |
| 05-product | ✓ | 0.963 | 0.750 | 0.700 | 0.794 | 30s | 15 | |
| 06-operations | ✓ | 0.850 | 0.750 | 0.900 | 0.840 | 29s | 14 | |
| 07-cloud | ✓ | 0.950 | 0.750 | 0.900 | 0.870 | 40s | 19 | |
| 08-channel | ✓ | 0.910 | 0.750 | 0.900 | 0.858 | 29s | 14 | |
| 09-nested | ✗ | — | — | — | — | 42s | 21 | ORPHAN_NODE |
| 10-observables | ✓ | 0.900 | 0.750 | 0.800 | 0.815 | 38s | 21 | |
| 11-feedback-loop | ✗ | — | — | — | — | 32s | 16 | CYCLE_DETECTED |
| 12-similar-options | ✓ | 0.900 | 0.750 | 0.900 | 0.855 | 37s | 17 | |
| 13-forced-binary | ✗ | — | — | — | — | 39s | 15 | FORBIDDEN_EDGE |
| 14-qualitative | ✓ | 0.880 | 0.750 | 0.900 | 0.849 | 25s | 13 | |

**Pass rate: 79% (11/14).** Average score (scored): **0.856.** Failures: ORPHAN_NODE (09), CYCLE_DETECTED (11), FORBIDDEN_EDGE (13).

### gpt-4o v2 × gpt-4o

| Brief | Valid | Param Q | Opt Diff | Complete | Overall | Latency | Nodes | Violations |
|---|---|---|---|---|---|---|---|---|
| 01-simple-binary | ✓ | 0.950 | 0.750 | 1.000 | **0.910** | 13s | 10 | |
| 02-multi-option | ✗ | — | — | — | — | 22s | 13 | ORPHAN_NODE |
| 03-vague | ✓ | 0.963 | 1.000 | 1.000 | **0.989** | 20s | 11 | |
| 04-conflicting | ✓ | 0.900 | 0.750 | 1.000 | 0.895 | 16s | 10 | |
| 05-product | ✓ | 0.910 | 1.000 | 0.700 | 0.853 | 19s | 14 | |
| 06-operations | ✓ | 0.963 | 0.750 | 0.800 | 0.834 | 24s | 12 | |
| 07-cloud | ✓ | 0.963 | 0.750 | 1.000 | 0.914 | 16s | 11 | |
| 08-channel | ✓ | 0.950 | 1.000 | 0.800 | 0.905 | 21s | 11 | |
| 09-nested | ✗ | — | — | — | — | 20s | 16 | CONTROLLABLE_NO_OPTION_EDGE; ORPHAN_NODE |
| 10-observables | ✗ | — | — | — | — | 21s | 17 | ORPHAN_NODE |
| 11-feedback-loop | ✗ | — | — | — | — | 15s | 10 | FORBIDDEN_EDGE ×2 |
| 12-similar-options | ✓ | 0.900 | 0.500 | 0.800 | 0.740 | 27s | 12 | |
| 13-forced-binary | ✓ | 0.950 | 0.750 | 0.800 | 0.830 | 15s | 10 | |
| 14-qualitative | ✓ | 0.940 | 0.750 | 1.000 | 0.907 | 14s | 12 | |

**Pass rate: 71% (10/14).** Average score (scored): **0.878.** Failures: ORPHAN_NODE (02, 09, 10), FORBIDDEN_EDGE (11).

---

## Section 3: Variance Check — Claude v2

| Brief | Run 1 | Var Run | Delta |
|---|---|---|---|
| 01-simple-binary | 0.914 | 0.910 | -0.004 |
| 02-multi-option | timeout | **0.874** | **timeout→pass** |
| 03-vague | 0.925 | 0.885 | -0.040 |
| 04-conflicting | 0.876 | 0.867 | -0.009 |
| 05-product | 0.794 | 0.805 | +0.011 |
| 06-operations | 0.796 | 0.796 | 0.000 |
| 07-cloud | 0.867 | 0.885 | +0.018 |
| 08-channel | 0.885 | 0.885 | 0.000 |
| 09-nested | 0.885 | 0.874 | -0.011 |
| 10-observables | 0.885 | 0.867 | -0.018 |
| 11-feedback-loop | 0.885 | 0.885 | 0.000 |
| 12-similar-options | 0.885 | 0.885 | 0.000 |
| 13-forced-binary | 0.885 | 0.874 | -0.011 |
| 14-qualitative | 0.849 | 0.876 | +0.027 |

**Variance run: 14/14 pass (100%).** Brief-02 passed in the variance run — the timeout is non-deterministic.

**Score stability:** Max absolute delta = 0.040 (brief-03). 10 of 13 common briefs within ±0.02. Scores are highly stable.

**Adjusted pass rate: 93–100%.** Brief-02 is the only instability point, and it's a timeout issue (not structural).

---

## Section 4: v1 → v2 Progression

### Pass rate evolution (14 briefs)

| Model | v1 Stress (6 briefs) | v1 Full (est. 14) | v2 Full (14) | Delta |
|---|---|---|---|---|
| Claude (v175-B) | 4/6 (67%) | ~12/14 (86%) | 13/14 (93%) | **+7%** |
| gpt-4.1 (v175) | 4/6 (67%) | ~9/14 (64%) | 11/14 (79%) | **+15%** |
| gpt-4o (v175) | 5/6 (83%) | ~11/14 (79%) | 10/14 (71%) | **-8%** |

### What worked

| Edit | Model | Effect |
|---|---|---|
| **Edge Validation + Cycle Prevention** | gpt-4.1 | Fixed FORBIDDEN_EDGE on briefs 06, 08, 12. +15% pass rate. Still fails brief-11 (CYCLE_DETECTED) and brief-13 (FORBIDDEN_EDGE). |
| **Parsimony + Nested Decisions** | Claude | Fixed FORBIDDEN_EDGE + ORPHAN_NODE on brief-12 (stress test). Node counts capped at 15 consistently. |
| **Hard Output Caps** | Claude | Prevented timeout on 13/14 briefs. Brief-02 timeout persists but non-deterministic (passed in variance run). |

### What didn't work

| Edit | Model | Effect |
|---|---|---|
| **Inline Wiring + Final Checks** | gpt-4o | v1 pass rate 79% → v2 71% (-8%). The 9-point checklist appears to over-constrain the model. Orphan fixes on some briefs were offset by new failures. |
| **Containment (max 15 nodes)** | gpt-4.1 | Brief-09 still produces 21 nodes despite the cap. gpt-4.1 ignores soft containment instructions. |
| **Cycle Prevention** | gpt-4.1 | Brief-11 still CYCLE_DETECTED. The "linearise feedback loops" instruction is not sufficient to prevent cycles when the brief explicitly describes circular causal mechanisms. |

---

## Section 5: Failure Analysis

### Persistent failures across v2

| Brief | Claude v2 | gpt-4.1 v2 | gpt-4o v2 | Root Cause |
|---|---|---|---|---|
| 02-multi-option | timeout (intermittent) | ✓ | ORPHAN_NODE | Complex 3-market expansion overwhelms gpt-4o's wiring; Claude's latency is at timeout boundary |
| 09-nested | ✓ | ORPHAN_NODE (21 nodes) | ORPHAN_NODE + CONTROLLABLE_NO_OPTION_EDGE | Sub-decisions cause node expansion beyond model's wiring capacity |
| 10-observables | ✓ | ✓ | ORPHAN_NODE | 6+ observable baselines create unwired nodes in gpt-4o |
| 11-feedback-loop | ✓ | CYCLE_DETECTED | FORBIDDEN_EDGE ×2 | Explicit circular mechanism in brief triggers cycle/forbidden edges |
| 13-forced-binary | ✓ | FORBIDDEN_EDGE | ✓ | Clean binary brief should be easiest — gpt-4.1 FORBIDDEN_EDGE is surprising |

### Violation frequency by code (v2 runs, all models)

| Code | Occurrences | Models |
|---|---|---|
| ORPHAN_NODE | 4 | gpt-4o (3), gpt-4.1 (1) |
| FORBIDDEN_EDGE | 3 | gpt-4o (2), gpt-4.1 (1) |
| CYCLE_DETECTED | 1 | gpt-4.1 (1) |
| CONTROLLABLE_NO_OPTION_EDGE | 1 | gpt-4o (1) |
| timeout | 1 | Claude (1, intermittent) |

---

## Section 6: Head-to-Head Comparison

### Summary table

| Metric | Claude v2 | gpt-4.1 v2 | gpt-4o v2 |
|---|---|---|---|
| **Pass rate** | **93% (13/14)** | 79% (11/14) | 71% (10/14) |
| **Variance pass rate** | **100% (14/14)** | — | — |
| **Avg score (scored)** | 0.872 | **0.856** | **0.878** |
| **Structural failures** | 0 | 3 | 4 |
| **Timeout failures** | 1 (intermittent) | 0 | 0 |
| **Avg latency** | 95s | 33s | 19s |
| **Avg node count** | 13.9 | 15.5 | 12.1 |
| **Cost per run** | $0.00 (cached) | $0.71 | $0.69 |
| **v1 → v2 delta** | +7% | +15% | -8% |

### Model profiles

**Claude v2 — Best structural reliability, slowest.**
- Zero structural violations across both runs. Only failure is intermittent timeout on brief-02 (passed in variance check).
- Consistent node counts (12-15 range), stable scores across runs.
- Parsimony edit keeps graphs lean without sacrificing coverage.
- **Weakness:** Latency. 95s average means timeout risk on complex briefs.

**gpt-4.1 v2 — Biggest improvement, topology gaps remain.**
- Edge validation edit eliminated 2 of 5 v1 failures (+15% pass rate).
- Ignores containment instructions (21 nodes on brief-09 despite max-15 cap).
- Persistent CYCLE_DETECTED on feedback-loop briefs — the model encodes circular causality literally.
- **Weakness:** Topology discipline. Needs structural post-processing, not just prompt edits.

**gpt-4o v2 — Regression from v1, over-constrained.**
- Highest average score on scored briefs (0.878) but lowest pass rate (71%).
- The 9-point final checklist degraded performance — the model appears to second-guess itself.
- Persistent ORPHAN_NODE on complex briefs. Inline wiring helps simple cases but not multi-option.
- **Weakness:** Instruction following degrades under constraint density.

---

## Section 7: Recommendations

### 1. Production model selection: Claude v2

Claude v2 is the clear winner for structural reliability (93-100% pass rate, zero structural violations). The timeout weakness is mitigable:
- Increase timeout from 120s to 150s for draft_graph calls
- Brief-02 passed in variance run — the timeout is marginal, not fundamental

### 2. Pipeline repair as safety net for gpt-4.1

gpt-4.1 v2's failures (ORPHAN_NODE, CYCLE_DETECTED, FORBIDDEN_EDGE) are all repairable by the production pipeline's deterministic sweep + LLM repair. Testing this is the next step (see: Pipeline Repair Test report).

### 3. Revert gpt-4o v2 edits

The v2 edits regressed gpt-4o. If gpt-4o is needed as a fallback model, use the v1 prompt (v175-gpt4o) which achieved 79% vs v2's 71%.

### 4. Brief-02 investigation

Brief-02 (multi-option-constrained) is the hardest brief across all models:
- Claude: intermittent timeout
- gpt-4o v2: ORPHAN_NODE
- gpt-4.1 v2: passes but at 43s (longest of its runs)

Consider simplifying this brief or splitting it into two briefs to isolate whether the issue is option count (3 markets) or constraint density.

---

## Appendix A: Run Metadata

| Run ID | Model | Prompt | Briefs | Scored | Invalid | Failed |
|---|---|---|---|---|---|---|
| dg4-claude-v2 | claude-sonnet-4-6 | draft-v175B-claude-v2.txt | 14 | 13 | 0 | 1 (timeout) |
| dg4-claude-v2-var | claude-sonnet-4-6 | draft-v175B-claude-v2.txt | 14 | 14 | 0 | 0 |
| dg4-gpt41-v2 | gpt-4.1 | draft-v175-gpt41-v2.txt | 14 | 11 | 3 | 0 |
| dg4-gpt4o-v2 | gpt-4o | draft-v175-gpt4o-v2.txt | 14 | 10 | 4 | 0 |

## Appendix B: Historical Pass Rate Tracker

| Prompt × Model | 4 briefs | 8 briefs | 14 briefs (v1 stress) | 14 briefs (v2) |
|---|---|---|---|---|
| v175 × gpt-4.1 | 100% | 63% | 64% | — |
| v175 × gpt-4o | 75% | 75% | 79% | — |
| v175-B × Claude | 100% | 100% | 86% | — |
| v175-gpt41 × gpt-4.1 | — | 50% | — | — |
| v175-gpt4o × gpt-4o | — | 75% | — | — |
| v175B-claude × Claude | — | 100% | — | — |
| **v175-gpt41-v2 × gpt-4.1** | — | — | — | **79%** |
| **v175-gpt4o-v2 × gpt-4o** | — | — | — | **71%** |
| **v175B-claude-v2 × Claude** | — | — | — | **93–100%** |

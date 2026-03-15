# Model Comparison Report

**Date:** 2026-03-13
**Source:** Fresh evaluator runs against live Supabase prompt store (staging versions)
**Prompt versions (from store):**
- Orchestrator: store v11, hash `c6d0c0263e657948`
- Draft graph: store v175, hash `e0801364c65576e3`
- Edit graph: store v3, hash `2a4db3acf1b5d42d`
- Decision review: store v10, hash `f918fc5d136917b7`

**Run IDs:** `store-v11-*`, `store-v175-*`, `store-v3-*`, `store-v10-*`

---

## Phase 0: Evaluator Sanity Check

### 0b. Fixtures per prompt type

| Prompt type | Fixture count | Location |
|---|---|---|
| draft_graph | 4 briefs | `tools/graph-evaluator/briefs/` |
| edit_graph | 9 cases | `tools/graph-evaluator/fixtures/edit-graph/` |
| decision_review | 6 cases | `tools/graph-evaluator/fixtures/decision-review/` |
| orchestrator | 8 cases (+1 duplicate orch-04) | `tools/graph-evaluator/fixtures/orchestrator/` |

### 0c. Scorer failure class coverage

| Failure class | Orchestrator | Draft | Edit | Review |
|---|---|---|---|---|
| Grounding violations (fabricated numbers) | ❌ | ❌ | ❌ | ✅ deterministic ±10% |
| Label fidelity (exact label quoting) | ❌ | ❌ | ❌ | ✅ |
| Routing correctness (right tool/mode) | ✅ | N/A | N/A | N/A |
| PATCH_SELECTION (update_node vs add_node) | N/A | N/A | ✅ via operation_types_correct | N/A |
| Contract compliance (schema validity) | ✅ | ✅ | ✅ | ✅ |
| Anti-fabrication (no invented values) | ⚠️ bans internal terms only | ⚠️ structural only | ⚠️ topology only | ✅ |

### 0d. All 12 runs completed successfully
Prompts fetched from Supabase at runtime using `fetch-store-prompts.ts`. All runs produced valid manifests and scores.

---

## Phase 1: Model Comparison Data

### Orchestrator (8 fixtures, store v11, with LLM-as-judge)

| Model | Structural Avg | Qualitative Avg | Latency Range | Key Strengths | Key Weaknesses |
|---|---|---|---|---|---|
| **gpt-4.1** | **0.971** | **0.847** | 4–25s | Highest structural. Strong qualitative on coaching & multi-turn. | Research tool weak (0.556 qual). Uncertainty language fails on 3 cases. |
| **gpt-4o** | **0.868** | **0.806** | 2–37s | Fastest. Perfect on multi-turn framing. | Research tool structural failure (0.457). Draft-trigger routing wrong. |
| **claude-sonnet-4-6** | **0.846** | **0.844** | 4–75s | Highest single-case qualitative (1.000 on coaching, 0.978 on post-analysis). | Draft-trigger (0.629) and research-tool (0.629) structural failures. Multi-turn routing miss. Slowest. |

**Orchestrator per-case divergences (structural / qualitative):**

| Case | claude-sonnet-4-6 | gpt-4.1 | gpt-4o |
|---|---|---|---|
| 01-framing-elicit | 0.943 / 0.867 | 0.943 / 0.844 | 0.857 / 0.822 |
| 02-draft-graph-trigger | **0.629** / 0.556 | **1.000** / 0.711 | 0.886 / 0.711 |
| 03-explain-results | 0.943 / **0.956** | 1.000 / 0.844 | **1.000** / 0.889 |
| 04-coaching | **1.000** / **1.000** | 0.943 / 0.933 | 0.914 / 0.911 |
| 05-banned-terms | **1.000** / 0.889 | 0.943 / **1.000** | 0.914 / 0.778 |
| 06-research-tool | **0.629** / 0.667 | **1.000** / 0.556 | **0.457** / 0.400 |
| 07-multi-turn-framing | 0.771 / 0.844 | **1.000** / 0.911 | **1.000** / 0.933 |
| 08-multi-turn-post-analysis | 0.857 / **0.978** | 0.943 / **0.978** | 0.914 / **1.000** |

**Key shift from previous prompt version (cf-v7):** Claude dropped from 0.982→0.846 structural, and gpt-4.1 dropped from 1.000→0.971. The new prompt (v11) is harder for all models — especially on envelope formatting (orch-02, orch-06).

---

### Draft Graph (4 briefs, store v175)

| Model | Avg Score | Briefs Scored | Structural Failures | Avg Latency | Avg Cost |
|---|---|---|---|---|---|
| **gpt-4o** | **0.881** | 3/4 | 02: CONTROLLABLE_NO_OPTION_EDGE | 32s | $0.045 |
| **claude-sonnet-4-6** | **0.893** | 2/4 | 02: timeout, 04: timeout | 96s | $0.00 (no cost tracking) |
| **gpt-4.1** | **0.874** | 1/4 | 01: FORBIDDEN_EDGE, 02: timeout, 04: FORBIDDEN_EDGE | 31s | $0.046 |

**Draft graph per-brief scores:**

| Brief | gpt-4o | claude-sonnet-4-6 | gpt-4.1 |
|---|---|---|---|
| 01-simple-binary | **0.925** | 0.910 | ✗ FORBIDDEN_EDGE |
| 02-multi-option | ✗ CONTROLLABLE_NO_OPTION_EDGE | ✗ timeout | ✗ timeout |
| 03-vague | **0.914** | 0.876 | 0.874 |
| 04-conflicting | 0.805 | ✗ timeout | ✗ FORBIDDEN_EDGE |

**Critical finding:** Brief 02 (multi-option-constrained) fails for ALL models. gpt-4.1 now fails 3/4 briefs — a significant regression from the old prompt v170 (where it scored 0.877 avg on 3/4). The v175 prompt appears harder.

---

### Edit Graph (9 cases, store v3)

| Model | Avg Score | Cases with op_types_correct ✗ | coaching_present ✗ | Avg Latency |
|---|---|---|---|---|
| **claude-sonnet-4-6** | **0.900** | 5/9 ✗ (01,02,03,05,09) | 0 | 16s |
| **gpt-4.1** | **0.900** | 5/9 ✗ (01,02,03,05,09) | 0 | 7s |
| **gpt-4o** | **0.894** | 5/9 ✗ (01,02,03,05,09) | 1 (02) | 10s |

**Edit graph per-case scores:**

| Case | claude-sonnet-4-6 | gpt-4.1 | gpt-4o |
|---|---|---|---|
| 01-add-factor | 0.850 | 0.850 | 0.850 |
| 02-remove-factor | 0.850 | 0.850 | **0.800** (coaching ✗) |
| 03-strengthen-edge | 0.800 | 0.800 | 0.800 |
| 04-forbidden-edge | 1.000 | 1.000 | 1.000 |
| 05-compound | 0.800 | 0.800 | 0.800 |
| 06-already-satisfied | 1.000 | 1.000 | 1.000 |
| 07-forbidden-refused | 1.000 | 1.000 | 1.000 |
| 08-cycle-creation | **1.000** | **1.000** | **1.000** |
| 09-update-node-label | 0.800 | 0.800 | 0.800 |

**Change from old prompt (v2):** All models now pass case 08-cycle-creation (was 0.900 for most on v2). The same 5 cases still fail `operation_types_correct` — this is a fixture expectation issue, not a model issue (see analysis below).

**PATCH_SELECTION assessment:** The scorer DOES test operation types. Cases 03 (update_edge) and 09 (update_node) are value-update cases. All models fail these — they use add_edge/add_node + remove instead of update. The edit_graph v3 prompt may need stronger guidance on preferring update operations.

---

### Decision Review (6 cases, store v10)

| Model | Avg Score | Weakest Case | Avg Latency |
|---|---|---|---|
| **gpt-4.1** | **0.908** | dr-04a (0.750) | 22s |
| **gpt-4o** | **0.892** | dr-04a (0.750) | 20s |
| **claude-sonnet-4-6** | **0.867** | dr-04a (0.750) | 92s |

**Decision review per-case scores:**

| Case | gpt-4.1 | gpt-4o | claude-sonnet-4-6 |
|---|---|---|---|
| dr-01-clear-winner | **1.000** | **1.000** | 0.900 (scenario_contexts ✗) |
| dr-02-close-call | 0.900 | **1.000** | 0.850 (grounding ✗) |
| dr-03-needs-evidence | 0.900 | 0.800 (headlines ✗) | 0.900 |
| dr-04a-bias-dsk | 0.750 | 0.750 | 0.750 |
| dr-04b-bias-no-dsk | **0.900** | 0.800 | 0.800 |
| dr-05-runner-up-null | **1.000** | **1.000** | **1.000** |

**Claude is the weakest on decision review** — 0.867 avg vs 0.908 for gpt-4.1. Claude fails grounding on dr-02 (close-call) which the others pass. dr-04a remains universally difficult (0.750 for all).

---

## Phase 2: Analysis

### Disqualification check

No model disqualified. However:
- **gpt-4.1 is borderline for draft_graph** — only 1/4 briefs scored (0.874). Two FORBIDDEN_EDGE violations + one timeout.
- **Claude is too slow for draft_graph** — 96s per brief with 2 timeouts. The evaluator timeout is insufficient for Claude's draft generation.

### Per-prompt-type winners

#### Orchestrator
**Winner: gpt-4.1** — CHANGE from current (claude-sonnet-4-6)
- Highest structural (0.971) — near-perfect envelope compliance
- Qualitative (0.847) close to Claude (0.844) — no longer a significant gap
- 3–5x faster than Claude (4–25s vs 4–75s)
- Claude dropped significantly on the new prompt: 0.982→0.846 structural, 0.900→0.844 qualitative
- gpt-4.1 perfect on research-tool and draft-trigger where Claude fails structurally

**Confidence: MEDIUM** — gpt-4.1 leads on structure but qualitative gap is narrow. Claude still has highest single-case peaks (1.000 on coaching). The prompt change (v7→v11) changed the competitive landscape.

#### Draft Graph
**Winner: gpt-4o** — KEEP current
- Only model to score 3/4 briefs (0.881 avg)
- All models struggle with brief-02 (multi-option)
- gpt-4.1 regressed significantly (was 0.877 on v170, now 0.874 on 1/4 briefs)
- Claude competitive when it doesn't timeout (0.893 on 2 briefs) but unreliable

**Confidence: LOW** — All models degraded on v175 vs v170. Brief-02 is universally broken. Only 4 briefs is insufficient for confident comparison.

#### Edit Graph
**Winner: TIE (claude-sonnet-4-6 / gpt-4.1)** at 0.900 — gpt-4.1 preferred on latency
- Claude and gpt-4.1 score identically
- gpt-4o slightly worse (0.894, missing coaching on case 02)
- gpt-4.1 is 2x faster than Claude
- All models fail the same 5 operation_types_correct cases — scorer ceiling effect

**Confidence: LOW** — Scorer cannot differentiate models on the most important dimension (PATCH_SELECTION). All models use add+remove instead of update for cases 01,02,03,05,09.

#### Decision Review
**Winner: gpt-4.1** — KEEP current
- Highest average (0.908)
- Most consistent — 0.900+ on 4/6 cases
- Claude is weakest (0.867) with grounding compliance issues
- gpt-4o competitive (0.892) but less consistent

**Confidence: MEDIUM** — gpt-4.1 leads clearly. Claude's grounding failure on dr-02 is a concern.

---

## Scorer Gap Assessment

### What the evaluator CANNOT currently detect

| Gap | Impact | Affected Types |
|---|---|---|
| **Fabricated numbers** (draft, orchestrator, edit) | High — cannot verify coefficients/values are grounded | draft_graph, orchestrator, edit_graph |
| **Label substitution** | Medium — can't verify exact label quoting | draft_graph, orchestrator, edit_graph |
| **Semantic causal direction** | Medium — structure valid but causation may be nonsensical | draft_graph |
| **Update vs add+remove equivalence** | High — scorer penalises add+remove even when semantically correct | edit_graph |

### Impact on comparison confidence

The **edit_graph scorer's operation_types_correct** check is the biggest confidence limiter. Cases 01 (add factor), 02 (remove factor), and 05 (compound) expect specific op types, but models may produce functionally equivalent operations using different types. The scorer cannot distinguish "wrong operation" from "correct operation via different method." This makes the edit_graph comparison unreliable — all models are penalised equally for what may not be real failures.

---

## Final Recommendation

### Routing recommendation

| Prompt Type | Current Model | Benchmark Winner | Recommendation | Shortlist |
|---|---|---|---|---|
| Orchestrator | claude-sonnet-4-6 | **gpt-4.1** | **Shortlist for replay** | gpt-4.1 (0.971/0.847 vs claude 0.846/0.844) |
| Draft graph | gpt-4o | **gpt-4o** | **Keep** | — |
| Edit graph | claude-sonnet-4-6 | **TIE** (claude/gpt-4.1) | **Keep** (no reason to switch) | gpt-4.1 (same score, 2x faster) |
| Decision review | gpt-4.1 | **gpt-4.1** | **Keep** | — |

### Key finding: Orchestrator routing may need revisiting

The biggest change from the old benchmark: **gpt-4.1 now outperforms Claude on orchestrator** with the current prompt (store v11). Claude's structural compliance dropped from 0.982 to 0.846, while gpt-4.1 remains at 0.971. The qualitative gap that previously justified Claude (0.900 vs 0.825) has narrowed to near-parity (0.844 vs 0.847).

**However**, this is a single run — variance testing is needed before changing production routing. Claude still peaks higher on individual cases (coaching, post-analysis). The recommendation is to **shortlist gpt-4.1** for manual replay validation on real user conversations before any routing change.

### Required follow-up actions

1. **Run orchestrator variance check** — repeat claude-sonnet-4-6 and gpt-4.1 orchestrator runs 2 more times each to assess score stability before recommending a routing change.

2. **Investigate brief-02 (multi-option)** — fails for ALL models on draft_graph v175. Either the brief is too hard for the new prompt or the prompt needs adjustment.

3. **Investigate edit_graph operation_types_correct failures** — cases 01,02,03,05,09 fail for all models. Review whether fixtures expect overly specific operation types when the model's approach is functionally equivalent.

4. **Increase Claude draft_graph timeout** — Claude timed out on 2/4 briefs. The evaluator's default timeout may be too aggressive for Claude's generation speed.

5. **Investigate Claude's orchestrator orch-02 regression** — Claude fails structural on draft-graph-trigger (0.629) which it passed on the old prompt. The v11 prompt may have envelope formatting changes Claude doesn't follow.

### What NOT to change (yet)

- Do not change orchestrator routing without variance testing and manual replay.
- Do not change draft_graph routing — gpt-4o remains the clear winner.
- Do not change decision_review routing — gpt-4.1 remains the clear winner.
- Do not change edit_graph routing without fixing scorer operation_types sensitivity.

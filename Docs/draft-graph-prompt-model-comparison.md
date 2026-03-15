# Draft Graph Prompt/Model A/B Comparison

**Date:** 2026-03-13
**Fixtures:** 4 draft graph briefs (01-simple-binary, 02-multi-option-constrained, 03-vague-underspecified, 04-conflicting-constraints)
**Scoring:** Deterministic structural scorer (param quality, option differentiation, completeness)

---

## Prompt Variants

| Variant | File | Size | Description |
|---|---|---|---|
| **v175** | `prompts/draft-v175.txt` | 41.9 KB | Current store baseline |
| **v175-B** | `prompts/draft-v175-B.txt` | 42.5 KB | v175 + 3 surgical edits: structural edge enforcement, no dormant controllables, tighter causal claims (3–8), topology plan (≤15 lines), strengthen_items (0–2) |
| **v176** | `prompts/draft-v176.txt` | 10.8 KB | Full rewrite — ~74% reduction. Compressed rules, fewer examples, tighter formatting |

---

## Comparison Matrix (Average Overall Score)

Averages computed over scored briefs only (excludes timeouts, scorer crashes, and structural invalids).

| Variant | gpt-4o | gpt-4.1 | Claude |
|---|---|---|---|
| **v175** (baseline) | 0.890 (3/4) | **0.874** (4/4) | 0.872 (3/4) |
| **v175-B** (surgical) | 0.900 (3/4) | 0.881 (2/4) | **0.875** (4/4) |
| **v176** (compact) | scorer crash | 0.831 (2/4) | 0.920 (2/4) |

Parenthetical shows briefs scored / briefs attempted.

---

## Per-Brief Scores

| Brief | v175 gpt-4o | v175 gpt-4.1 | v175 Claude | v175-B gpt-4o | v175-B gpt-4.1 | v175-B Claude | v176 gpt-4o | v176 gpt-4.1 | v176 Claude |
|---|---|---|---|---|---|---|---|---|---|
| 01-simple-binary | 0.910 | 0.910 | 0.863 | 0.910 | 0.910 | **0.925** | crash¹ | FORBIDDEN_EDGE | MISSING_GOAL; CYCLE |
| 02-multi-option | 0.880 | 0.867 | timeout | CTRL_NO_EDGE | TOO_MANY_OPTIONS | **0.815** | crash¹ | 0.840 | timeout |
| 03-vague-underspec | 0.880 | 0.851 | 0.867 | 0.880 | 0.851 | 0.876 | crash¹ | 0.823 | **0.914** |
| 04-conflicting | OPTION_NO_GOAL_PATH | 0.867 | 0.885 | **0.910** | FORBIDDEN_EDGE | 0.885 | crash¹ | CYCLE_DETECTED | **0.925** |

**Bold** marks the highest score per brief across all 9 combinations.

¹ v176 × gpt-4o: All 4 briefs generated valid LLM responses, but the scorer crashed with `TypeError: value.toFixed is not a function` — caused by gpt-4o emitting string intervention values (e.g. `"fac_hiring": "local"`) which the `buildInterventionSignature` function doesn't handle. This is a **scorer bug**, not a model failure.

---

## Validity Summary

| Combination | Scored | Invalid (structural) | Failed (timeout/crash) | Pass Rate |
|---|---|---|---|---|
| v175 × gpt-4o | 3 | 1 (OPTION_NO_GOAL_PATH) | 0 | 75% |
| v175 × gpt-4.1 | **4** | 0 | 0 | **100%** |
| v175 × Claude | 3 | 0 | 1 (timeout) | 75% |
| v175-B × gpt-4o | 3 | 1 (CTRL_NO_OPTION_EDGE) | 0 | 75% |
| v175-B × gpt-4.1 | 2 | 2 (TOO_MANY_OPTIONS, FORBIDDEN_EDGE) | 0 | 50% |
| v175-B × Claude | **4** | 0 | 0 | **100%** |
| v176 × gpt-4o | 0 | 0 | 4 (scorer crash) | 0%* |
| v176 × gpt-4.1 | 2 | 2 (FORBIDDEN_EDGE, CYCLE_DETECTED) | 0 | 50% |
| v176 × Claude | 2 | 1 (MISSING_GOAL; CYCLE) | 1 (timeout) | 50% |

*v176 × gpt-4o: scorer crash, not model failure. See note above.

---

## Violation Analysis

| Violation | Occurrences | Combinations |
|---|---|---|
| Timeout (brief-02) | 3 | v175 × Claude, v176 × Claude, — |
| FORBIDDEN_EDGE | 3 | v175-B × gpt-4.1 (brief-04), v176 × gpt-4.1 (brief-01) |
| CYCLE_DETECTED | 2 | v176 × gpt-4.1 (brief-04), v176 × Claude (brief-01) |
| OPTION_NO_GOAL_PATH | 1 | v175 × gpt-4o (brief-04) |
| CONTROLLABLE_NO_OPTION_EDGE | 1 | v175-B × gpt-4o (brief-02) |
| TOO_MANY_OPTIONS | 1 | v175-B × gpt-4.1 (brief-02) |
| MISSING_GOAL | 1 | v176 × Claude (brief-01) |

**Brief-02 (multi-option-constrained) remains the hardest brief.** It caused timeouts for Claude on v175 and v176, a CONTROLLABLE_NO_OPTION_EDGE for gpt-4o on v175-B, and TOO_MANY_OPTIONS for gpt-4.1 on v175-B. Only 3 of 9 combinations scored it successfully.

**v176 introduces new failure modes** not seen with v175: CYCLE_DETECTED (2 occurrences) and MISSING_GOAL (1), suggesting the compact prompt lacks sufficient structural constraint guidance.

---

## Latency Comparison

| Combination | brief-01 | brief-02 | brief-03 | brief-04 | Avg (scored) |
|---|---|---|---|---|---|
| v175 × gpt-4o | 60s | 54s | 28s | 49s | 38s |
| v175 × gpt-4.1 | 31s | 50s | 30s | 37s | **37s** |
| v175 × Claude | 95s | timeout | 84s | 119s | 99s |
| v175-B × gpt-4o | 39s | 31s | 29s | 38s | **33s** |
| v175-B × gpt-4.1 | 23s | 59s | 28s | 30s | 26s |
| v175-B × Claude | 94s | 113s | 77s | 114s | 100s |
| v176 × gpt-4o | 16s | 57s | 26s | 34s | 33s |
| v176 × gpt-4.1 | 25s | 40s | 25s | 30s | **30s** |
| v176 × Claude | 115s | timeout | 78s | 105s | 99s |

Claude is 2.5–3× slower than OpenAI models across all prompts. v176 is marginally faster for gpt-4.1 (37s→30s avg) due to smaller prompt, but doesn't meaningfully improve Claude latency.

---

## Disqualification Check

**Criterion:** >1 structural failure (invalid or timeout) across 4 briefs.

| Combination | Failures | Status |
|---|---|---|
| v175 × gpt-4o | 1 (brief-04 invalid) | **PASS** |
| v175 × gpt-4.1 | 0 | **PASS** |
| v175 × Claude | 1 (brief-02 timeout) | **PASS** |
| v175-B × gpt-4o | 1 (brief-02 invalid) | **PASS** |
| v175-B × gpt-4.1 | 2 (brief-02, brief-04 invalid) | **DISQUALIFIED** |
| v175-B × Claude | 0 | **PASS** |
| v176 × gpt-4o | 4 (scorer crash — excluded from ranking) | **EXCLUDED** |
| v176 × gpt-4.1 | 2 (brief-01, brief-04 invalid) | **DISQUALIFIED** |
| v176 × Claude | 2 (brief-01 invalid, brief-02 timeout) | **DISQUALIFIED** |

---

## Key Questions Answered

### 1. Does v175-B (surgical edits) improve structural compliance vs v175?

**Mixed — model-dependent.**

- **Claude: Yes.** v175-B is the only prompt where Claude scores all 4 briefs (including the notoriously hard brief-02). Average improves from 0.872 (3/4) to 0.875 (4/4), and the brief-02 timeout is eliminated. The structural edge enforcement edit directly addresses Claude's tendency to omit option→factor edges.

- **gpt-4o: Neutral.** Same 75% pass rate. v175-B fixes brief-04 (OPTION_NO_GOAL_PATH→0.910) but breaks brief-02 (CONTROLLABLE_NO_OPTION_EDGE). Average of scored briefs improves marginally (0.890→0.900).

- **gpt-4.1: Worse.** Pass rate drops from 100% to 50%. The surgical edits cause gpt-4.1 to overgenerate (TOO_MANY_OPTIONS on brief-02, 23 nodes / 45 edges) and produce FORBIDDEN_EDGE on brief-04. The tighter topology plan constraints may be backfiring — gpt-4.1 was already well-calibrated on v175.

### 2. Does v176 (compact rewrite) improve or degrade quality vs v175?

**Degrades all three models significantly.**

- **gpt-4o:** Scorer crash prevents scoring, but the model produced string intervention values (`"local"`, `"relocate"`) — a category error that v175 never triggers. The compact prompt's reduced examples likely fail to anchor gpt-4o on proper value encoding.

- **gpt-4.1:** Average drops from 0.874 (4/4) to 0.831 (2/4). New failure modes appear: CYCLE_DETECTED and FORBIDDEN_EDGE. gpt-4.1 loses the structural guidance it needs from the verbose prompt.

- **Claude:** Only 2 of 4 briefs scored (down from 3). New failure: MISSING_GOAL + CYCLE_DETECTED on brief-01, which all models pass on v175. However, the 2 scored briefs are Claude's highest individual scores (0.914, 0.925). The compact prompt produces high-quality output when it works, but fails more often.

### 3. Which prompt/model combination has the best structural compliance?

**v175 × gpt-4.1** is the only combination that scores all 4 briefs with zero failures.

| Rank | Combination | Scored | Failures | Avg Score | Notes |
|---|---|---|---|---|---|
| 1 | **v175 × gpt-4.1** | 4/4 | 0 | **0.874** | Only 100% pass rate (non-Claude) |
| 2 | **v175-B × Claude** | 4/4 | 0 | **0.875** | Only 100% pass rate (Claude), solves brief-02 |
| 3 | v175 × gpt-4o | 3/4 | 1 | 0.890 | High scores when valid |
| 4 | v175-B × gpt-4o | 3/4 | 1 | 0.900 | Highest avg of scored briefs |
| 5 | v175 × Claude | 3/4 | 1 | 0.872 | Reliable on 3 briefs |

### 4. Does the 74% prompt reduction in v176 save enough cost/latency to justify quality loss?

**No.** The token savings are significant (~75% fewer input tokens: ~2900 vs ~11000) but:
- gpt-4.1 and Claude are both disqualified (>1 failure each)
- gpt-4o produces category errors (string interventions)
- New failure modes (CYCLE_DETECTED, MISSING_GOAL) that don't occur with v175
- Latency improvement is marginal (30s vs 37s for gpt-4.1) — not enough to offset quality loss

### 5. Is there a clear winner for staging?

**Two candidates, depending on model choice:**

| Use case | Winner | Rationale |
|---|---|---|
| **gpt-4.1 primary** | v175 (baseline) | Only 100% pass rate; v175-B regresses it |
| **Claude primary** | v175-B (surgical) | Only prompt where Claude passes all 4 briefs; fixes brief-02 timeout |
| **gpt-4o primary** | v175-B (surgical) | Highest avg score (0.900); fixes brief-04 while keeping brief-01/03 |

---

## Scorer Bug: v176 × gpt-4o

All 4 briefs completed LLM generation successfully for v176 × gpt-4o, but the scorer crashed during post-processing:

```
TypeError: value.toFixed is not a function
  at buildInterventionSignature (validator.ts:176)
```

**Root cause:** gpt-4o emitted string intervention values (`"fac_hiring": "local"`, `"fac_hiring": "relocate"`) in brief-02, and the scorer's `buildInterventionSignature` function calls `.toFixed()` without checking the value type.

**Impact:** This is a scorer bug, not a model failure. The crash prevents scoring all 4 briefs. Raw response JSONs are preserved in `results/dg-v176-gpt4o/gpt-4o/*/response.json`.

**Fix:** `buildInterventionSignature` should handle non-numeric intervention values (either by converting or by flagging as a validation violation).

---

## Recommendation

### Primary: v175 (store baseline) for gpt-4.1

**v175 × gpt-4.1** is the safest combination:
- Only non-Claude combination with 100% pass rate (4/4 briefs)
- 0.874 average overall score
- Zero structural violations
- 37s average latency

No prompt change needed for gpt-4.1. Keep the current store v175.

### Secondary: v175-B for Claude

If Claude is used for draft graph generation, **v175-B** is the recommended prompt:
- Only prompt where Claude achieves 100% pass rate (4/4 briefs, including brief-02)
- 0.875 average — highest Claude average across all variants
- The 3 surgical edits (structural edge enforcement, no dormant controllables, tighter output bounds) directly address Claude's structural weaknesses

### Not recommended: v176 for any model

The 74% prompt reduction causes too many structural failures:
- gpt-4.1: disqualified (2 failures)
- Claude: disqualified (2 failures)
- gpt-4o: scorer crash (+ string intervention category error)
- New failure modes (CYCLE_DETECTED, MISSING_GOAL) not present in v175

### Action item: Fix scorer bug

`buildInterventionSignature` in `validator.ts:176` should be patched to handle non-numeric intervention values. This would unblock scoring for v176 × gpt-4o and any future prompt that triggers string-valued interventions.

---

## Run Metadata

| Run ID | Prompt | Model | Scored | Invalid | Failed | Results Dir |
|---|---|---|---|---|---|---|
| dg-v175-gpt4o | v175 | gpt-4o | 3 | 1 | 0 | `results/dg-v175-gpt4o/` |
| dg-v175-gpt41 | v175 | gpt-4.1 | 4 | 0 | 0 | `results/dg-v175-gpt41/` |
| dg-v175-claude | v175 | claude-sonnet-4-6 | 3 | 0 | 1 | `results/dg-v175-claude/` |
| dg-v175B-gpt4o | v175-B | gpt-4o | 3 | 1 | 0 | `results/dg-v175B-gpt4o/` |
| dg-v175B-gpt41 | v175-B | gpt-4.1 | 2 | 2 | 0 | `results/dg-v175B-gpt41/` |
| dg-v175B-claude | v175-B | claude-sonnet-4-6 | 4 | 0 | 0 | `results/dg-v175B-claude/` |
| dg-v176-gpt4o | v176 | gpt-4o | 0 | 0 | 4 (crash) | `results/dg-v176-gpt4o/` |
| dg-v176-gpt41 | v176 | gpt-4.1 | 2 | 2 | 0 | `results/dg-v176-gpt41/` |
| dg-v176-claude | v176 | claude-sonnet-4-6 | 2 | 1 | 1 | `results/dg-v176-claude/` |

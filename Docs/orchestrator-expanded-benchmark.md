# Orchestrator Expanded Fixture Benchmark

**Date:** 2026-03-14
**Model:** claude-sonnet-4-6 (thinking enabled, 8k budget)
**Runs:** 3 prompts × 3 runs × 17 fixtures = 153 evaluations
**Judge:** gpt-4o judge unavailable (OpenAI quota exhausted) — structural scoring only

> **Note:** The brief specified `gpt-4.1` as the target model, but the OpenAI API key was quota-exhausted. All runs used `claude-sonnet-4-6` instead. Judge qualitative scores (9 dimensions) could not be collected.

---

## 1. Aggregate Results

| Prompt | Grand Mean | Pass Rate (≥0.90) | Tool Correct | Stddev of Means | Mean Latency | Mean Out Tokens |
|---|---|---|---|---|---|---|
| **cf-v16** | **0.8818** | **35/51 (68.6%)** | 45/51 (88.2%) | 0.0369 | 21,509ms | 942 |
| cf-v14-B | 0.8538 | 33/51 (64.7%) | 46/51 (90.2%) | 0.0131 | 20,418ms | 876 |
| cf-v16-lite | 0.8650 | 30/51 (58.8%) | 36/51 (70.6%) | 0.0180 | 19,920ms | 874 |

**Per-run pass rates:**

| Prompt | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| cf-v16 | 13/17 | 12/17 | 10/17 |
| cf-v14-B | 10/17 | 11/17 | 12/17 |
| cf-v16-lite | 11/17 | 10/17 | 9/17 |

**Winner: cf-v16** — highest pass rate, highest grand mean, comparable latency.

**Input token budget:** cf-v16 uses ~7k input tokens vs cf-v14-B's ~16.8k — a 58% reduction for higher scores. cf-v16 is a much more efficient prompt.

---

## 2. Per-Fixture Paired Comparison

Structural scores averaged across 3 runs. ✓ = all 3 runs pass (≥0.90). △ = mixed. ✗ = all 3 fail.

| # | Fixture | cf-v16 | cf-v14-B | cf-v16-lite | Notes |
|---|---|---|---|---|---|
| 01 | framing-elicit | 0.943 ✓ | 0.943 ✓ | 0.943 ✓ | Stable across all |
| 02 | draft-graph-trigger | 0.695 △ | 0.752 △ | 0.514 △ | High variance — XML format issue |
| 03 | explain-results | 0.800 △ | 0.800 △ | 0.876 △ | Inconsistent tool-call wrapping |
| 04 | coaching-dominant-factor | 0.981 ✓ | 0.981 ✓ | 0.962 ✓ | Near-perfect |
| 05 | banned-terms | 0.981 ✓ | 1.000 ✓ | 0.962 ✓ | Near-perfect |
| 06 | research-tool | 0.752 △ | 0.629 ✗ | 0.924 ✓ | v14-B always wrong XML; lite best |
| 07 | multi-turn-framing | 1.000 ✓ | 0.962 ✓ | 0.638 △ | **lite regression** — high variance |
| 08 | multi-turn-post-analysis | 0.848 △ | 0.848 △ | 0.857 △ | All prompts struggle |
| 09 | soft-proceed-draft (NEW) | 0.819 △ | 0.971 ✓ | 0.457 ✗ | **lite fails** consistently |
| 10 | narrow-factual (NEW) | 0.943 ✓ | 0.943 ✓ | 0.943 ✓ | Perfect consistency |
| 11 | direct-fulfilment (NEW) | 0.886 ✗ | 0.886 ✗ | 0.857 ✗ | Tool selection always wrong (see §3) |
| 12 | patch-accepted (NEW) | 0.943 ✓ | 0.943 ✓ | 0.981 ✓ | Stable |
| 13 | mixed-intent-edit (NEW) | 0.962 ✓ | 1.000 ✓ | 0.886 ✗ | **v14-B perfect**, lite fails tool |
| 14 | recover-no-interventions (NEW) | 0.943 ✓ | 0.943 ✓ | 0.943 ✓ | Perfect consistency |
| 15 | research-explicit-verb (NEW) | 0.876 △ | 0.629 ✗ | 1.000 ✓ | **lite perfect**, v14-B always wrong |
| 16 | stale-analysis (NEW) | 1.000 ✓ | 0.981 ✓ | 1.000 ✓ | Near-perfect |
| 17 | system-event-analysis (NEW) | 0.619 △ | 0.305 △ | 0.962 ✓ | **v14-B worst** — must_contain fail |

### Regressions on original 8

| Prompt | Original 8 Pass Rate | Original 8 Mean |
|---|---|---|
| cf-v16 | 16/24 (66.7%) | 0.8750 |
| cf-v14-B | 15/24 (62.5%) | 0.8643 |
| cf-v16-lite | 12/24 (50.0%) | 0.8345 |

**cf-v16-lite regresses on original fixtures** — 50% vs 66.7% for cf-v16. The session memory examples appear to help with multi-turn and tool-routing consistency.

---

## 3. Failure Taxonomy

Across all 153 evaluations (9 runs × 17 fixtures):

| Failure Class | Count | Rate | Root Cause |
|---|---|---|---|
| `must_contain_met` | 32 | 20.9% | Model omits required keywords (e.g. "Raise Prices" in orch-17) |
| `valid_envelope` | 29 | 19.0% | Tool-call responses lack `<response>` wrapper — bare tool XML |
| `assistant_text_present` | 29 | 19.0% | Same root: tool-only turns have no `<assistant_text>` |
| `blocks_tag_present` | 29 | 19.0% | Same root: bare tool-call without envelope |
| `actions_tag_present` | 29 | 19.0% | Same root: bare tool-call without envelope |
| `xml_well_formed` | 29 | 19.0% | Same root: bare tool-call responses |
| `tool_selection_correct` | 26 | 17.0% | Wrong tool or no-tool when tool expected (and vice versa) |
| `uncertainty_language` | 26 | 17.0% | Missing hedging/confidence language when required |
| `suggested_actions_valid` | 19 | 12.4% | Missing or malformed `<suggested_actions>` block |
| `diagnostics_present` | 10 | 6.5% | Missing `<diagnostics>` preamble |
| `coaching_correct` | 10 | 6.5% | Coaching block absent or unwanted |
| `no_banned_terms` | 8 | 5.2% | Used internal jargon (e.g. "Monte Carlo", "sensitivity") |
| `block_types_valid` | 1 | 0.7% | Rare |
| `no_forbidden_phrases` | 1 | 0.7% | Rare |

**Key insight:** The 29 `valid_envelope` failures are all from the same root cause — when the model selects a tool, it emits a bare tool-call XML fragment instead of wrapping it in the full `<diagnostics>...<response>` envelope. This is a **scorer/fixture alignment issue** more than a prompt quality issue. The tool call itself is often correct.

### orch-11 (direct-fulfilment-compare): 0% tool selection across all prompts

Expected tool: `explain_results`. Actual behaviour: model answers directly from context data (INTERPRET mode). The model correctly identifies it has all needed data and doesn't need to invoke a tool. **Recommendation:** Change fixture expectation to `expected_tool: null` or accept either behaviour.

---

## 4. Output Burden by Fixture Bucket

| Bucket | Fixtures | Mean Tokens (cf-v16) | Mean Latency (cf-v16) |
|---|---|---|---|
| System events | 12, 17 | ~450 | ~14s |
| Factual questions | 10, 16 | ~400 | ~14s |
| Tool dispatch | 02, 06, 09, 13, 15 | ~350 | ~10s |
| Multi-turn | 07, 08 | ~1,800 | ~55s |
| Coaching/narration | 01, 03, 04, 05, 11, 14 | ~1,000 | ~22s |

Multi-turn fixtures dominate latency and token output as expected — they require processing multiple conversation turns.

---

## 5. New Fixture Results (orch-09 to orch-17)

| # | Fixture | Category | cf-v16 | cf-v14-B | cf-v16-lite | Verdict |
|---|---|---|---|---|---|---|
| 09 | soft-proceed-draft | Tool routing | 0.819 △ | **0.971 ✓** | 0.457 ✗ | v14-B wins; lite broken |
| 10 | narrow-factual-question | INTERPRET | **0.943 ✓** | **0.943 ✓** | **0.943 ✓** | All perfect |
| 11 | direct-fulfilment-compare | INTERPRET | 0.886 ✗ | 0.886 ✗ | 0.857 ✗ | Fixture issue (see §3) |
| 12 | patch-accepted-event | System event | **0.943 ✓** | **0.943 ✓** | **0.981 ✓** | All pass |
| 13 | mixed-intent-edit | Tool routing | 0.962 ✓ | **1.000 ✓** | 0.886 ✗ | v14-B perfect |
| 14 | recover-no-interventions | RECOVER | **0.943 ✓** | **0.943 ✓** | **0.943 ✓** | All perfect |
| 15 | research-explicit-verb | Tool routing | 0.876 △ | 0.629 ✗ | **1.000 ✓** | lite wins |
| 16 | stale-analysis-question | INTERPRET | **1.000 ✓** | 0.981 ✓ | **1.000 ✓** | All excellent |
| 17 | system-event-analysis | Narration | 0.619 △ | 0.305 △ | **0.962 ✓** | lite wins |

**New fixture pass rates (3 runs, 9 fixtures each = 27 per prompt):**

| Prompt | Pass Rate | Mean |
|---|---|---|
| cf-v16 | 19/27 (70.4%) | 0.8878 |
| cf-v14-B | 18/27 (66.7%) | 0.8445 |
| cf-v16-lite | 18/27 (66.7%) | 0.8921 |

New fixtures expose interesting prompt-specific weaknesses:
- **cf-v14-B** struggles with system events (orch-17) and research routing (orch-15) — the longer prompt causes more XML format breaks
- **cf-v16-lite** fails on soft-proceed (orch-09) and multi-turn (orch-07) — session memory examples help with conversational context
- **cf-v16** is the most balanced across new fixtures

---

## 6. Variance & Stability

### Per-run stddev of mean structural score

| Prompt | Run 1 | Run 2 | Run 3 | Stddev |
|---|---|---|---|---|
| cf-v16 | 0.8941 | 0.9109 | 0.8403 | **0.0369** |
| cf-v14-B | 0.8387 | 0.8622 | 0.8605 | **0.0131** |
| cf-v16-lite | 0.8857 | 0.8555 | 0.8538 | **0.0180** |

**cf-v14-B is most stable** (σ=0.013) but at a lower mean. cf-v16 has highest variance but also highest peak (0.911).

### High-variance fixtures (σ > 0.15 on any prompt)

| Fixture | Prompt | Scores | σ |
|---|---|---|---|
| orch-09 soft-proceed-draft | cf-v16 | [0.457, 1.000, 1.000] | 0.313 |
| orch-07 multi-turn-framing | cf-v16-lite | [1.000, 0.457, 0.457] | 0.313 |
| orch-17 system-event-analysis | cf-v16 | [0.943, 0.457, 0.457] | 0.280 |
| orch-02 draft-graph-trigger | cf-v16 | [0.457, 1.000, 0.629] | 0.278 |
| orch-17 system-event-analysis | cf-v14-B | [0.457, 0.457, 0.000] | 0.264 |
| orch-03 explain-results | cf-v16 | [1.000, 0.886, 0.514] | 0.254 |
| orch-03 explain-results | cf-v14-B | [0.514, 0.943, 0.943] | 0.247 |
| orch-06 research-tool | cf-v16 | [1.000, 0.629, 0.629] | 0.214 |
| orch-02 draft-graph-trigger | cf-v14-B | [0.629, 0.629, 1.000] | 0.214 |
| orch-15 research-explicit | cf-v16 | [1.000, 1.000, 0.629] | 0.214 |

**Root cause:** Most high-variance fixtures involve tool-call responses. The model non-deterministically chooses between emitting a bare tool-call XML (fails envelope validation) and wrapping it in the full `<diagnostics>...<response>` envelope. This is a binary pass/fail on 5 dimensions simultaneously, creating the 0.457/1.000 bimodal distribution.

### Stable fixtures (σ = 0 across all prompts)

- orch-01 (framing-elicit): 0.943 everywhere
- orch-10 (narrow-factual): 0.943 everywhere
- orch-14 (recover-no-interventions): 0.943 everywhere

---

## Decision

### Applying the criteria:

1. **Pass rate:** cf-v16 (68.6%) > cf-v14-B (64.7%) > cf-v16-lite (58.8%)
2. **No regressions on original 8:** cf-v16 (66.7%) ≈ cf-v14-B (62.5%) > cf-v16-lite (50.0%) — **cf-v16-lite regresses**
3. **Failure taxonomy:** All prompts share the same envelope-wrapping issue; cf-v16-lite has unique tool-selection failures
4. **Score:** cf-v16 (0.882) > cf-v16-lite (0.865) > cf-v14-B (0.854)
5. **Latency/cost:** cf-v16 uses 58% fewer input tokens than cf-v14-B for higher scores

### Recommendation

**Advance cf-v16 to staging.** It leads on pass rate, mean score, and token efficiency. The session memory examples (removed in cf-v16-lite) contribute meaningfully to multi-turn and tool-routing quality — removing them causes regressions.

**cf-v14-B** is the most stable prompt but its 2.4x token cost does not translate to better scores. It particularly struggles with system events and research routing on the new fixtures.

### Action items

1. Fix **orch-11** fixture: change `expected_tool` from `"explain_results"` to `null` — the model correctly answers from context
2. Investigate **envelope wrapping** in tool-call turns — consider whether the scorer should accept bare tool-call XML as valid
3. Re-run with **gpt-4o judge** when OpenAI quota resets to collect qualitative dimension scores
4. Consider additional runs to reduce variance on high-σ fixtures (orch-02, orch-09, orch-17)

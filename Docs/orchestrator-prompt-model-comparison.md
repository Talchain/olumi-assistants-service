# Orchestrator Prompt/Model A/B Comparison

**Date:** 2026-03-13
**Fixtures:** 8 orchestrator cases (orch-01 through orch-08, with orch-04 deduplicated)
**Judge:** gpt-4o LLM-as-judge (9 qualitative dimensions)

---

## Prompt Variants

| Variant | File | Size | Description |
|---|---|---|---|
| **cf-v14-A** | `prompts/cf-v14-A.txt` | 52.8 KB | Current store v11 (baseline) |
| **cf-v14-B** | `prompts/cf-v14-B.txt` | 53.2 KB | Full verbose variant with expanded examples, session memory, analysis wait coaching |
| **cf-v15** | `prompts/cf-v15.txt` | 18.5 KB | ~65% reduction — compressed rules, fewer examples, tighter formatting |

---

## Comparison Matrix

| Variant | Claude structural | Claude qualitative | gpt-4.1 structural | gpt-4.1 qualitative |
|---|---|---|---|---|
| **cf-v14-A** (baseline) | **0.921** | 0.844 | 0.954 | **0.872** |
| **cf-v14-B** (verbose) | 0.768 | 0.831 | **0.982** | **0.872** |
| **cf-v15** (compact) | 0.875 | **0.850** | 0.829 | 0.847 |

---

## Per-Case Structural Scores

| Case | v14-A Claude | v14-A gpt-4.1 | v14-B Claude | v14-B gpt-4.1 | v15 Claude | v15 gpt-4.1 |
|---|---|---|---|---|---|---|
| orch-01 framing-elicit | 0.943 | 0.943 | 0.943 | **1.000** | 0.943 | 0.943 |
| orch-02 draft-trigger | **1.000** | 0.886 | **0.457** | **1.000** | **0.457** | **0.629** |
| orch-03 explain-results | 0.886 | **1.000** | **0.514** | **1.000** | 0.943 | 0.829 |
| orch-04 coaching | **1.000** | **1.000** | **1.000** | 0.943 | 0.943 | 0.914 |
| orch-05 banned-terms | **1.000** | 0.943 | **1.000** | **1.000** | 0.943 | 0.857 |
| orch-06 research-tool | **0.629** | **1.000** | **0.629** | **1.000** | **1.000** | **0.629** |
| orch-07 multi-turn-framing | **1.000** | **1.000** | 0.829 | **1.000** | **1.000** | **1.000** |
| orch-08 multi-turn-post | 0.914 | 0.857 | 0.771 | 0.914 | 0.771 | 0.829 |

**Bold** marks regression cases (orch-02, orch-06) and perfect scores.

---

## Per-Case Qualitative Scores (Judge)

| Case | v14-A Claude | v14-A gpt-4.1 | v14-B Claude | v14-B gpt-4.1 | v15 Claude | v15 gpt-4.1 |
|---|---|---|---|---|---|---|
| orch-01 framing-elicit | 0.844 | 0.867 | 0.867 | 0.822 | 0.867 | 0.822 |
| orch-02 draft-trigger | 0.622 | 0.711 | 0.667 | 0.778 | 0.711 | 0.622 |
| orch-03 explain-results | 0.756 | 0.822 | 0.689 | 0.956 | 0.933 | 0.956 |
| orch-04 coaching | 0.956 | 0.956 | 0.933 | 1.000 | 0.889 | 0.911 |
| orch-05 banned-terms | 0.956 | 0.956 | 0.956 | 0.911 | 0.911 | 0.933 |
| orch-06 research-tool | 0.689 | 0.711 | 0.733 | 0.622 | 0.600 | 0.644 |
| orch-07 multi-turn-framing | 0.978 | 0.956 | 0.911 | 0.956 | 0.978 | 0.889 |
| orch-08 multi-turn-post | 0.956 | 1.000 | 0.889 | 0.933 | 0.911 | 1.000 |

---

## Regression Case Analysis

### orch-02 (draft-graph-trigger)

| Combination | Structural | Qualitative | Tool Selection | Envelope Valid |
|---|---|---|---|---|
| v14-A + Claude | **1.000** | 0.622 | Correct | Yes |
| v14-A + gpt-4.1 | 0.886 | 0.711 | Wrong | Yes |
| v14-B + Claude | **0.457** | 0.667 | Wrong | No |
| v14-B + gpt-4.1 | **1.000** | 0.778 | Correct | Yes |
| v15 + Claude | **0.457** | 0.711 | Wrong | No |
| v15 + gpt-4.1 | **0.629** | 0.622 | Correct | No |

**Finding:** Claude passes orch-02 on v14-A (1.000) but fails on both v14-B (0.457) and v15 (0.457). This case is highly sensitive to prompt phrasing. gpt-4.1 passes on v14-A and v14-B but fails on v15 (0.629). The compact prompt hurts both models on this case.

### orch-06 (research-tool)

| Combination | Structural | Qualitative | Tool Selection | Envelope Valid |
|---|---|---|---|---|
| v14-A + Claude | **0.629** | 0.689 | Correct | No |
| v14-A + gpt-4.1 | **1.000** | 0.711 | Correct | Yes |
| v14-B + Claude | **0.629** | 0.733 | Correct | No |
| v14-B + gpt-4.1 | **1.000** | 0.622 | Correct | Yes |
| v15 + Claude | **1.000** | 0.600 | Correct | Yes |
| v15 + gpt-4.1 | **0.629** | 0.644 | Correct | No |

**Finding:** Claude's orch-06 failure (0.629) persists on v14-A and v14-B, but v15 fixes it (1.000). The opposite happens for gpt-4.1: v14-A and v14-B pass but v15 fails. The compact prompt trades orch-06 compliance between models.

---

## Latency Comparison

| Variant | Claude range | Claude avg | gpt-4.1 range | gpt-4.1 avg |
|---|---|---|---|---|
| cf-v14-A | 5–92s | 27s | 3–16s | 7s |
| cf-v14-B | 7–78s | 25s | 2–18s | 7s |
| cf-v15 | 5–63s | 23s | 2–22s | 7s |

Claude is 3–4x slower than gpt-4.1 across all variants. cf-v15 is marginally faster for Claude (smaller prompt = faster processing).

---

## Disqualification Check

**Criterion:** >1 structural failure (score <0.700) across 8 cases.

| Combination | Failures <0.700 | Status |
|---|---|---|
| v14-A + Claude | 1 (orch-06: 0.629) | **PASS** |
| v14-A + gpt-4.1 | 0 | **PASS** |
| v14-B + Claude | 3 (orch-02: 0.457, orch-03: 0.514, orch-06: 0.629) | **DISQUALIFIED** |
| v14-B + gpt-4.1 | 0 | **PASS** |
| v15 + Claude | 1 (orch-02: 0.457) | **PASS** (borderline — 0.457 is severe) |
| v15 + gpt-4.1 | 2 (orch-02: 0.629, orch-06: 0.629) | **DISQUALIFIED** |

---

## Key Questions Answered

### 1. Does cf-v14-B recover Claude's orch-02 and orch-06 structural failures?

**No — it makes them worse.** Claude's orch-02 drops from 1.000 (v14-A) to 0.457 (v14-B), and orch-06 stays at 0.629. v14-B also introduces a new failure: orch-03 drops to 0.514. The verbose prompt overwhelms Claude.

### 2. Does cf-v15 improve or degrade Claude's structural compliance vs v14-A?

**Mixed.** Overall structural drops (0.921→0.875), but with a critical trade-off:
- orch-06 (research-tool) **fixed**: 0.629→1.000
- orch-02 (draft-trigger) **broken**: 1.000→0.457
- orch-03 (explain-results) improved: 0.886→0.943
- orch-04, orch-05 slightly degraded (1.000→0.943)

### 3. Does gpt-4.1 maintain its structural lead across all three variants?

**On v14-A and v14-B, yes. On v15, no.** gpt-4.1 drops from 0.954/0.982 to 0.829 on the compact prompt. The shorter prompt removes examples gpt-4.1 relies on for routing accuracy.

### 4. Which prompt/model combination has the best balance of structural + qualitative?

**v14-B + gpt-4.1** leads on structural (0.982) with strong qualitative (0.872). **v14-A + gpt-4.1** is the runner-up (0.954/0.872) and more robust (no disqualified partner). For Claude, **v14-A** is clearly the best prompt (0.921/0.844).

### 5. Does the 60% prompt reduction in v15 help or hurt either model?

**Hurts gpt-4.1 significantly** (0.954→0.829) — it needs the verbose examples. **Slightly hurts Claude overall** (0.921→0.875) but **fixes the orch-06 regression** that plagued Claude on both v14 variants.

---

## Ranking (Applying Decision Criteria)

After disqualification:

| Rank | Combination | Structural | Qualitative | Failures <0.700 | Notes |
|---|---|---|---|---|---|
| 1 | **v14-B + gpt-4.1** | **0.982** | 0.872 | 0 | Highest structural, zero failures |
| 2 | **v14-A + gpt-4.1** | 0.954 | 0.872 | 0 | Strong, same qualitative |
| 3 | **v14-A + Claude** | 0.921 | 0.844 | 1 | Best Claude result, 1 borderline failure |
| 4 | **v15 + Claude** | 0.875 | 0.850 | 1 (severe) | Fixes orch-06 but breaks orch-02 badly |

Disqualified: v14-B + Claude (3 failures), v15 + gpt-4.1 (2 failures).

---

## Recommendation

### Primary: v14-B + gpt-4.1 for staging replay

**v14-B + gpt-4.1** is the winning combination:
- Highest structural score (0.982) — near-perfect envelope compliance
- Zero structural failures across all 8 cases
- Perfect scores on both regression cases (orch-02: 1.000, orch-06: 1.000)
- 7s average latency

**Ready for staging replay.** The structural lead is clear and the qualitative score ties with v14-A. Recommend replaying on 10–15 real user conversations to validate qualitative behaviour before production routing change.

### Secondary: v14-A remains the best Claude prompt

If Claude is retained for orchestrator routing, keep v14-A (store v11). It's the only prompt where Claude achieves >0.900 structural with only 1 failure. Do not switch Claude to v14-B or v15.

### Not recommended: v15 for either model

The 65% prompt reduction degrades both models. gpt-4.1 loses too much routing accuracy (2 failures), and Claude trades one fix for one regression. The token savings don't justify the quality drop at current prompt sizes.

---

## Run Metadata

| Run ID | Prompt | Model | Scored | Failed | Results Dir |
|---|---|---|---|---|---|
| ab-v14A-claude | cf-v14-A | claude-sonnet-4-6 | 9 | 0 | `results/ab-v14A-claude/` |
| ab-v14A-gpt41 | cf-v14-A | gpt-4.1 | 9 | 0 | `results/ab-v14A-gpt41/` |
| ab-v14B-claude | cf-v14-B | claude-sonnet-4-6 | 9 | 0 | `results/ab-v14B-claude/` |
| ab-v14B-gpt41 | cf-v14-B | gpt-4.1 | 9 | 0 | `results/ab-v14B-gpt41/` |
| ab-v15-claude | cf-v15 | claude-sonnet-4-6 | 9 | 0 | `results/ab-v15-claude/` |
| ab-v15-gpt41 | cf-v15 | gpt-4.1 | 9 | 0 | `results/ab-v15-gpt41/` |

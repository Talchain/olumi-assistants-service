# Golden-Journey Harness v1 — A5 grounding-flap characterisation

Probe to decide whether the single thin `explain_leader` response seen in the
concrete-mutation live baseline was (1) ordinary LLM variance or (2) a symptom of
intermittent missing/weak analysis context. **Probe + harness-hardening only — not
a product fix.**

## Method

One disposable staging scenario (cee-staging build `7479cda`): draft once, run
analysis once, then call `explain_leader` ("Why does the leading option win?") **5×**
with graph / scenario / analysis state held constant.

## Results (5 repeated explain runs)

Leader: "Hire Two Senior Engineers Locally". Baseline analysis: `status=ready`,
`freshness=fresh`, graph hash `e4d8ac6f0a54d2a3` (stable across all runs).

| run | len | names leader | names runner-up | probability | names driver | grounded (A5) | status | freshness | hash@run / current | exit_path | llm_calls |
|----|----|----|----|----|----|----|----|----|----|----|----|
| 1 | 2004 | ✓ | ✗ | ✓ | ✓ | **pass** | ready | fresh | e4d8ac6f / e4d8ac6f | turn_executor | 1 |
| 2 | 1957 | ✓ | ✗ | ✓ | ✓ | **pass** | ready | fresh | e4d8ac6f / e4d8ac6f | turn_executor | 1 |
| 3 | 1957 | ✓ | ✗ | ✓ | ✓ | **pass** | ready | fresh | e4d8ac6f / e4d8ac6f | turn_executor | 1 |
| 4 | 1957 | ✓ | ✗ | ✓ | ✓ | **pass** | ready | fresh | e4d8ac6f / e4d8ac6f | turn_executor | 1 |
| 5 | 1957 | ✓ | ✗ | ✓ | ✓ | **pass** | ready | fresh | e4d8ac6f / e4d8ac6f | turn_executor | 1 |

- **A5 pass/fail/inconclusive: 5 / 0 / 0.** Thin responses reproduced: **0**.
- Analysis/context indicators **present and constant** on every run (status, freshness,
  both graph hashes identical). `exit_path=turn_executor`, `handler_id=explain_results`,
  `llm_calls=1` each time. (`context_pack_chars` grew run-to-run — 20159 → 28514 — as
  conversation history accrued, but grounding stayed strong.)
- The earlier lone thin response (84 chars, concrete-baseline `3_explain_leader`) had
  **occurred with full analysis context present too** (`status=ready`, `freshness=fresh`,
  hashes present) — i.e. it did **not** correlate with any wire-visible context gap.

## Classification: **Likely LLM variance** (full-content certainty inconclusive pending M3)

Thin responses did **not** correlate with missing/stale/empty analysis context, missing
`analysis_ready`, missing freshness, missing graph hash, or abnormal diagnostic trace —
on both the lone thin occurrence and the 5 grounded repeats the wire indicators were
present and stable. That is consistent with ordinary LLM response variance, **not** a
context symptom. It is **not** fully provable at the content level until canonical-state
**M3 `_context_summary`** exposes the actual context the model received — so the
content-level view remains *inconclusive pending M3*, but the available evidence points
to LLM variance.

## Harness-only updates made

- **Deterministic replay is the stable regression gate.** Live semantic checks (A5;
  A1 while provisional) are now **advisory** — a lone live A5 fail is reported but does
  **not** set a non-zero exit code (only *gating* fails — A3/A4/A6/A7, A2-in-process —
  gate). See `isAdvisoryFinding` (`components.ts`) and the gating split in `report.ts` /
  `index.ts`.
- The report now shows `Fails: gating / advisory`, a `Gating verdict` row, a `gating?`
  column in the findings table, and labels an advisory "next component to fix".
- **A5 already keys on grounding tokens** (option/factor label, probability, science
  enrichment), **not** response length — confirmed; no logic weakening needed. The "thin"
  description in evidence is informational only.
- A new always-on caveat ("Live A5 is advisory, not a hard gate") states this and that A5
  strengthens once M3 `_context_summary` lands.

**No coaching or context fix lane is opened from this probe.** The disposable scenario
was deleted child-first (verified 0 rows, no orphans).

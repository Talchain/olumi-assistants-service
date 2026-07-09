# Fidelity-gap sensitivity audit — the missing `data.interventions` field (2026-07-09)

**The gap:** the M1 benchmark prompts (v0.4.3/v0.4.4/m1-dedup) never required per-option
`data.interventions`, so every benchmark M1 draft omitted it (the served prompt requires it).
**Question:** which PRIOR benchmark conclusions could be sensitive to that missing field?
For each: sensitive / insensitive + why. (Aligned 2026-07-09; see PARITY-CHECKLIST.md.)

## 1. M2 A/B (baseline vs m2-improved) — judged proposals against intervention-less M1 graphs
**Verdict: ranking INSENSITIVE; coverage slightly narrower.**
- The M2 reviewer critiques the M1 graph qualitatively (missing risks, hidden assumptions,
  evidence grounding, proposal shape). It does not run PLoT and does not consume option
  `data.interventions` — that field feeds PLoT's quantitative option comparison, not the critique.
- The A/B compared two M2 prompts on the **same** frozen M1 input; the missing field was identical
  for both arms, so it cannot have shifted the ranking. The which-prompt-is-better conclusion holds.
- One honest coverage caveat: on intervention-less graphs the reviewer had no basis to critique
  *option under-differentiation* (a class of issue that only exists once options carry distinct
  interventions). So M2's critique coverage was narrower than on live graphs — a coverage note,
  not a ranking-validity defect. Re-runnable under aligned graphs if we want that coverage tested.

## 2. Quality-technique variants (m1-plain, m2-improved, dedup, lean-audit, etc.)
**Verdict: metric-INSENSITIVE to the field; re-confirm the numbers under the aligned prompt.**
- The graded indicators — fact-capture, parameter-differentiation, node/edge counts, coaching,
  and the dedup checker (exact-dup / near-pair / risks) — are computed over nodes, edges, labels,
  coefficients and coaching. None reads option `data.interventions`. So the field's *absence* did
  not bias any of those metrics.
- BUT the aligned prompt now *adds* the interventions requirement, which spends tokens/structure
  and could nudge the graph. So the metrics are insensitive to the gap in principle, but the
  post-alignment numbers must be re-confirmed empirically (esp. the m1-dedup checker: exact-dup 0 /
  near 0 / risks held). **[EMPIRICAL — filled from the aligned re-run below.]**

## 3. Dry-run validity gates (validateDraftAtBoundary)
**Verdict: INSENSITIVE.**
- `data.interventions` is OPTIONAL in `ANTHROPIC_DRAFT_GRAPH_SCHEMA` (anthropic-graph-schema.ts:103).
  Its absence cannot fail the boundary validity check, so the historical 6/6-valid gate readings
  were correct — the drafts genuinely were valid without it.
- The field is in-schema, so aligned drafts that now emit it must still validate. Confirm the
  aligned es-v0a is 6/6 valid. **[EMPIRICAL — filled from the aligned re-run below.]**

## 4. Edge-stability phase-2 outcome-flip (the one that WAS affected)
**Verdict: SENSITIVE — being re-baselined.** The which-option flip-rate + buy≡build ceiling ran on
intervention-less drafts under synthesized interventions. Re-run under aligned drafts reading the
draft's own interventions (no synthesis). The act-vs-status-quo *structural* churn signal and the
v0 structural metrics (reproducibility, sign-flip) survive but are also re-baselined on the same
aligned draws for consistency.

## Empirical confirmations (from the aligned re-run)
- m1-dedup checker post-alignment: _[pending es-v0a/m1dedup-a]_
- Aligned draft validity (es-v0a 30 draws): _[pending]_
- Option-differentiation rate (draft's own interventions, per 5 draws): _[pending]_

**Closure:** this note + PARITY-CHECKLIST.md (diff every arm prompt against the served prompt's
structural requirements; justify every omission before a scored run) closes the lesson durably.

# Investigation findings — strength_mean value compression (v1)

- **Version:** 1
- **Date:** 2026-04-14
- **Branch:** staging
- **Scope:** Read-only trace across CEE (`olumi-assistants-service`) and UI (`DecisionGuideAI`).

---

## Glossary

- `strength.mean` — causal coefficient (effect size).
- `strength.std` — parametric uncertainty (epistemic confidence in the coefficient).
- `weight` (UI / debug export only) — renamed `strength.mean`.

---

## Executive summary

**Naming collision confirmed as the cause of apparent compression. No actual compression exists in the pipeline.**

The LLM-emitted `strength.mean` values survive unchanged through every CEE stage and reach the UI intact. The previous analysis read the debug export's `strength_std` column as if it carried the mean, because the UI canonical field is `strengthStd` and the export simply serialises it in snake_case. The export's `weight` column is the mean; `strength_std` is the std. Both values are correct; the column labels created the illusion of compression.

A secondary source of confusion: the prior write-up compared the LLM diagnostic log (which stratifies samples across random edges) against export values *for different edges in the same graph*. Once aligned edge-by-edge against the uploaded debug bundle, the values agree exactly.

---

## Worked example from the uploaded debug bundle

Edge `fac_dev_headcount → out_delivery_speed` from `olumi-debug-31a1f0a2-20260414.json`:

| Export field | Value in bundle | What it actually represents | Source in UI edge.data | Source in CEE HTTP body |
|---|---|---|---|---|
| `weight` | **0.55** | `strength.mean` (causal coefficient) | `edge.data.weight` | `strength.mean` |
| `strength_std` | **0.15** | `strength.std` (parametric uncertainty) | `edge.data.strengthStd` | `strength.std` |

Read the same row correctly: the LLM emitted `mean=0.55`, `std=0.15` for this edge, and the export preserves both. There is no 0.7 → 0.15 compression — the `0.7` came from a *different edge* in the diagnostic log.

---

## The misalignment that produced the false "compression" reading

The previous analysis placed these side by side as if they were the same edge:

| Source | Edge | Value |
|---|---|---|
| LLM diagnostic log sample (`normalisation.ts:486-495`) | `fac_burn_rate → risk_runway` | `mean=0.7, std=0.12` |
| UI debug export row | `fac_dev_headcount → out_delivery_speed` | `strength_std=0.15, weight=0.55` |

These are **different edges in the same graph**. The diagnostic log emits a stratified random sample; the export lists every edge. Matching the log's sampled edges to the same edges in the export shows the values agree. The "compression from 0.7 to 0.15" was an artefact of comparing the mean of one edge to the std of another.

---

## End-to-end field-mapping trace

One causal edge with LLM output `strength.mean=0.55, strength.std=0.15`:

| Stage | File:line | Input | Output | Transform |
|---|---|---|---|---|
| LLM extraction | [src/adapters/llm/normalisation.ts:363-380](../src/adapters/llm/normalisation.ts#L363-L380) | nested `strength.{mean, std}` | flat `strength_mean=0.55`, `strength_std=0.15` | clamp mean to `[-1,+1]`; no rescale |
| Diagnostic log | [src/adapters/llm/normalisation.ts:486-495](../src/adapters/llm/normalisation.ts#L486-L495) | flat | — | log-only, stratified sample |
| Deterministic sweep | [src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts:980-1000](../src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts#L980-L1000) | flat | flat | defaults `mean=0.5`, `std=0.15` **only when absent**; populated values untouched |
| V1→V3 transform | [src/cee/transforms/schema-v3.ts:466-560](../src/cee/transforms/schema-v3.ts#L466-L560) | flat `strength_mean`, `strength_std` | nested `strength:{mean, std}` | flatten→nest; apply sign from `effect_direction`; re-clamp to `[-1,+1]` |
| Strength-std derivation | [src/cee/transforms/strength-derivation.ts:35-64](../src/cee/transforms/strength-derivation.ts#L35-L64) | `strength_mean`, `belief_exists`, `provenance` | `strength_std` | derives std **only when missing**; LLM-provided std preserved |
| Boundary (HTTP emit) | [src/cee/unified-pipeline/stages/boundary.ts:21-40](../src/cee/unified-pipeline/stages/boundary.ts#L21-L40) | V1 internal | V3 HTTP body: `strength:{mean:0.55, std:0.15}`, `exists_probability` | shape conversion only |
| UI adapter | `DecisionGuideAI/src/canvas/utils/applyDraftResult.ts:68-103` | `strength.mean` → `weight`; `strength.std` → `strengthStd` | `edge.data.weight=0.55`, `edge.data.strengthStd=0.15` | — |
| UI domain schema | `DecisionGuideAI/src/canvas/domain/edges.ts:210-211` | — | `strengthStd` documented as "parametric uncertainty (std) from CEE" | — |
| Debug export | `DecisionGuideAI/src/components/debug/utils/exportBundle.ts:909-926` | `edge.data.weight`, `edge.data.strengthStd` | JSON `weight: 0.55`, `strength_std: 0.15` | pass-through |

---

## Direct answers to the brief's four questions

1. **What does the UI export's `strength_std` field actually represent — the mean or the std?**
   → **The std.** Read straight from `edge.data.strengthStd`, populated from nested `strength.std`.

2. **Does CEE emit `weight` in its HTTP response?**
   → **No.** The V3 response uses nested `strength:{mean, std}` + `exists_probability`. The `weight` key exists only in the UI edge store and the debug export, populated from `strength.mean`.

3. **Is there a mean↔std swap?**
   → **No.** Extraction, V1→V3 transform, std derivation, and UI adapter all preserve `mean → mean` and `std → std`.

4. **Is there any stage that compresses `strength_mean`?**
   → **No.** The only modifications are `[-1,+1]` clamps at extraction and V1→V3 transform. The deterministic sweep only *fills* missing means with `0.5`; it never overwrites populated values. No rescale, no normalise, no redistribution.

---

## Source of the confusion (for the record)

Two coexisting conventions:

- **CEE V1 flat (internal):** `strength_mean`, `strength_std` — both are fields of the strength *distribution*.
- **UI canonical (camelCase):** `weight` (= distribution mean), `strengthStd` (= distribution std).
- **Debug export (snake_case):** `weight` + `strength_std` — matches UI names, **not** CEE V1 names.

A reader familiar with the CEE internal V1 format sees `strength_std` in the export and infers there must be an accompanying `strength_mean` with the same semantics. There isn't — the mean was renamed to `weight`. This is the trap.

---

## Recommendation

**Rename `weight` → `strength_mean` in the debug export at `DecisionGuideAI/src/components/debug/utils/exportBundle.ts:909-926`.** Keeping the export's key set aligned with the CEE V1 flat convention (`strength_mean`, `strength_std`) removes the only remaining ambiguity and prevents this class of mis-reading from recurring. The UI-internal field name (`weight`) can stay as-is; the change is export-only.

No pipeline change is required.

---

## What this investigation does not explain

Confirming that the pipeline preserves `strength.mean` end-to-end does **not** address:

- Whether the LLM chooses sufficiently differentiated means for every decision type (are weak/medium/strong bands being used, or is the model clustering?).
- Whether external factors carry appropriate prior ranges for their semantic role.
- Whether the deployed model capacity is sufficient for complex decisions with many inbound edges.
- The hypothesis from the prior Q1 write-up that RANGE DISCIPLINE ("Σ|strength.mean| ≤ 1.0") may be read by the LLM as "divide by edge count", narrowing the range.

These are separate prompt-quality and model-selection concerns. They would need a dedicated analysis over many staging runs, not a code trace.

---

## Files referenced (read-only)

**CEE:**
- `src/adapters/llm/normalisation.ts`
- `src/cee/transforms/schema-v3.ts`
- `src/cee/transforms/strength-derivation.ts`
- `src/cee/unified-pipeline/stages/boundary.ts`
- `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts`

**UI:**
- `DecisionGuideAI/src/canvas/utils/applyDraftResult.ts`
- `DecisionGuideAI/src/canvas/domain/edges.ts`
- `DecisionGuideAI/src/components/debug/utils/exportBundle.ts`

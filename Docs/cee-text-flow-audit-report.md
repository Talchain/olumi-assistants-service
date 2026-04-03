# CEE Pipeline Text Flow Audit Report

**Date:** 2026-04-03
**Scope:** All 13 LLM prompts (6 primary + 7 secondary) — field-level trace from LLM output to API response envelope
**Type:** Read-only audit — no code changes

---

## Executive Summary

The CEE pipeline uses 13 registered LLM prompts. Of these, **11 are active at runtime** and **2 are dead code** (`explainer`, `bias_check`). Across all active prompts (including the actual consumers of the dead `explainer` prompt), we identified **101 distinct text-bearing fields**. Of these:

| Classification | Count | % |
|---|---|---|
| PASSED THROUGH | 62 | 61% |
| TRANSFORMED | 15 | 15% |
| GATED | 8 | 8% |
| CONSUMED INTERNALLY | 7 | 7% |
| DROPPED | 9 | 9% |

The **decision_review** endpoint is the highest LLM-text-density path — nearly every field is user-facing prose passed through with minimal filtering (shape check + grounding check only).

### Critical Findings

1. **`causal_claims` is a dead field** (draft_graph): The v187 prompt requires it, the Zod schema declares it, a full validation pipeline exists (`causal-claims-validation.ts`), and the V3 response schema declares it — but neither adapter extracts it. `ctx.causalClaims` is always `undefined`.

2. **Two registered prompts are dead code**: `explainer` and `bias_check` are registered in the prompt management system but never loaded or called at runtime.

3. **8 undeclared fields leak to the API via `.passthrough()`**: Fields like `nodes[].prior`, `nodes[].factor_type`, `edges[].defaulted` are present on API responses but not declared in Zod egress schemas. All are intentional (ISL/PLoT needs) except `_retry_suggestion` which exposes internal retry metadata.

4. **OpenAI path has uncontrolled passthrough risk**: The Anthropic structured-output schema uses `additionalProperties: false` (safe), but the OpenAI `json_object` path allows arbitrary fields that survive `.passthrough()` on coaching and goal_constraints sub-objects end-to-end.

---

## Section 1: Primary Prompt Traces

### 1.1 draft_graph

**Pipeline:** CEE unified pipeline (6-stage) via `src/cee/unified-pipeline/index.ts`
**Entry:** `src/orchestrator/tools/draft-graph.ts` -> `runCeePipeline()`
**Egress schema:** `CEEGraphResponseV3` (`src/schemas/cee-v3.ts:459`)

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `topology_plan[]` | **DROPPED** | Adapter (not extracted) | Omitted from Anthropic structured schema. Planning scaffolding. |
| 2 | `coaching.summary` | PASSED THROUGH | V3 schema (cee-v3.ts:422) | Also consumed internally for narration hint. May be initialized to `""` if absent. |
| 3 | `coaching.strengthen_items[].id` | PASSED THROUGH | V3 schema | |
| 4 | `coaching.strengthen_items[].label` | PASSED THROUGH | V3 schema | |
| 5 | `coaching.strengthen_items[].detail` | PASSED THROUGH | V3 schema | |
| 6 | `coaching.strengthen_items[].action_type` | TRANSFORMED | package.ts:159 | Defaulted to `"improve"` if missing |
| 7 | `coaching.strengthen_items[].bias_category` | PASSED THROUGH | V3 schema | Optional |
| 8 | `causal_claims[]` (all sub-fields) | **DROPPED** | Adapter boundary | **Bug**: Neither adapter extracts `causal_claims`. Entire validation pipeline is dead code. |
| 9 | `rationales[].target` | GATED | V3 transform | Present in V1 response; dropped during V1-to-V3 transform (not carried over). |
| 10 | `rationales[].why` | GATED | V3 transform | Same as target. Consumed internally for plan annotation. |
| 11 | `goal_constraints[].label` | TRANSFORMED | compound-goals stage | Merged with regex-extracted constraints; invalid node refs filtered. |
| 12 | `goal_constraints[].source_quote` | TRANSFORMED | compound-goals stage | Same merge pipeline. |
| 13 | `goal_constraints[].unit` | TRANSFORMED | compound-goals stage | |
| 14 | `goal_constraints[].provenance` | TRANSFORMED | compound-goals stage | |
| 15 | `goal_constraints[].constraint_id` | TRANSFORMED | compound-goals stage | |
| 16 | `nodes[].label` | PASSED THROUGH | V3 transform | May be cleaned (annotation stripping) via `cleanNodeLabel()`. |
| 17 | `nodes[].id` | PASSED THROUGH | V3 transform | |
| 18 | `nodes[].data.uncertainty_drivers[]` | PASSED THROUGH | V3 transform | |
| 19 | `nodes[].data.unit` | PASSED THROUGH | V3 transform | |
| 20 | `nodes[].data.display_value` | PASSED THROUGH | V3 transform | |
| 21 | `nodes[].data.encoding_map` | PASSED THROUGH | V3 transform | JSON-stringified |
| 22 | `edges[].effect_direction` | PASSED THROUGH | V3 transform | |
| 23 | `edges[].provenance_source` | PASSED THROUGH | V3 transform | |
| 24 | `confidence` | **DROPPED** | parse.ts:71 | Pipeline overwrites with deterministic `calcConfidence()`. LLM value never read. |

### 1.2 edit_graph

**Pipeline:** Direct LLM call + PLoT validation
**Entry:** `src/orchestrator/tools/edit-graph.ts`
**Egress:** `GraphPatchBlock` on `EditGraphResult`

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `operations[].rationale` | GATED (debug only) | edit-graph.ts:2630 `stripOperationMeta()` | Stripped; stored in `block.provenance._meta.operation_meta` only. |
| 2 | `operations[].impact` | GATED (debug only) | edit-graph.ts:2630 `stripOperationMeta()` | Same as rationale. |
| 3 | `coaching.summary` | PASSED THROUGH | edit-graph.ts:2273 + patch-summary.ts:180 | Becomes `assistantText` + `patchData.summary`. Short-circuits deterministic summary. |
| 4 | `coaching.rerun_recommended` | **DROPPED** | edit-graph.ts:2518 | Parsed but never read. Pipeline uses deterministic computation from `buildAppliedChanges()`. |
| 5 | `warnings[]` | PASSED THROUGH (merged) | edit-graph.ts:2186-2194 | Merged with PLoT warnings in `validation_warnings`; LLM warnings also in `assistantText`. |
| 6 | `removed_edges[].reason` | GATED (debug only) | edit-graph.ts:2234 | Stored in `block.provenance._meta.removed_edges`. |
| 7 | `operations[].op/path/value/old_value` | TRANSFORMED | edit-graph.ts:1661-1671 | Normalised, structural defaults enforced, then passed through as `patchData.operations`. |

### 1.3 repair_graph

**Pipeline:** CEE Stage 4 substep
**Entry:** `src/cee/unified-pipeline/stages/repair/orchestrator-validation.ts`
**Egress:** Replaces `ctx.graph` (no separate text response)

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `graph.nodes[]` / `graph.edges[]` | PASSED THROUGH | ctx.graph replacement | Normalised, baseline-filled, capped, dangling-edge filtered, sorted. |
| 2 | `rationales[].violation_code/action` | CONSUMED INTERNALLY | Adapter return | Logged if missing; not surfaced to API. |
| 3 | `usage` | CONSUMED INTERNALLY | Telemetry | Accumulated into `ctx.repairCost`. |

### 1.4 validate_graph

**Pipeline:** Validation pipeline (Pass 2)
**Entry:** `src/cee/validation-pipeline/validate-graph.ts`
**Egress:** Edge validation metadata attached in-place to graph edges

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `edges[].reasoning` | PASSED THROUGH | edge.validation.pass2.reasoning | Primary user-visible LLM text — displayed in calibration tray for contested edges. |
| 2 | `edges[].basis` | PASSED THROUGH | edge.validation.pass2.basis | Displayed in UI. |
| 3 | `edges[].needs_user_input` | PASSED THROUGH | edge.validation.pass2.needs_user_input | Drives UI prompting. |
| 4 | `edges[].strength.mean/std` | TRANSFORMED | Enforcement lints + bias correction | Adjusted by budget rescale, std clamping, domain_prior ceiling, bias offsets. |
| 5 | `edges[].exists_probability` | TRANSFORMED | Same pipeline | Same lint + bias correction. |
| 6 | `model_notes[]` | CONSUMED INTERNALLY | validation_summary.model_notes | Comment: "Not acted on in v1." Available but not currently rendered in UI. |

### 1.5 decision_review

**Pipeline:** Standalone HTTP API
**Entry:** `src/routes/assist.v1.decision-review.ts`
**Egress:** `{ review: <entire LLM JSON>, trace, _meta }`

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `narrative_summary` | PASSED THROUGH | response.review | Shape-checked, grounding-checked. |
| 2 | `story_headlines` | PASSED THROUGH | response.review | Keys validated against option IDs. |
| 3 | `robustness_explanation.summary` | PASSED THROUGH | response.review | Grounding-checked. |
| 4 | `robustness_explanation.primary_risk` | PASSED THROUGH | response.review | |
| 5 | `robustness_explanation.stability_factors[]` | PASSED THROUGH | response.review | |
| 6 | `robustness_explanation.fragility_factors[]` | PASSED THROUGH | response.review | |
| 7 | `readiness_rationale` | PASSED THROUGH | response.review | Grounding-checked. |
| 8 | `evidence_enhancements` | PASSED THROUGH | response.review | Per-factor `specific_action`, `rationale`, `evidence_type`, `decision_hygiene`. |
| 9 | `scenario_contexts` | PASSED THROUGH | response.review | Optional. Keys validated against fragile_edges. |
| 10 | `flip_thresholds[]` | PASSED THROUGH | response.review | Optional, max 2. Grounding-checked. |
| 11 | `bias_findings[].description` | PASSED THROUGH | response.review | Grounding-checked. DSK claim IDs hard-validated when enabled. |
| 12 | `bias_findings[].suggested_action` | PASSED THROUGH | response.review | |
| 13 | `key_assumptions[]` | PASSED THROUGH | response.review | Max 5. |
| 14 | `decision_quality_prompts[].question` | PASSED THROUGH | response.review | DSK fields validated when enabled. |
| 15 | `decision_quality_prompts[].principle` | PASSED THROUGH | response.review | |
| 16 | `decision_quality_prompts[].applies_because` | PASSED THROUGH | response.review | |
| 17 | `pre_mortem` | PASSED THROUGH | response.review | Optional. Grounding-checked. |
| 18 | `framing_check` | PASSED THROUGH | response.review | Optional. |

**Validation gates:** Shape check (hard reject) -> DSK cross-check (gated) -> Number grounding check (retry then warning). Maximum 1 retry total.

### 1.6 orchestrator

**Pipeline:** XML envelope parsing -> Phase 4 tools -> Phase 5 envelope assembly
**Entry:** `src/orchestrator/response-parser.ts`
**Egress:** `OrchestratorResponseEnvelopeV2`

| # | Field | Classification | Boundary | Notes |
|---|-------|---------------|----------|-------|
| 1 | `<assistant_text>` | PASSED THROUGH | envelope.assistant_text | XML entity unescaped. Fallback chain: tool text > LLM text > hardcoded. |
| 2 | `<block type="commentary">` | TRANSFORMED | Typed block conversion | Unescaped; source tagged `llm:xml`. |
| 3 | `<block type="review_card">` | TRANSFORMED | Typed block conversion | Unescaped; tone validated (facilitator/challenger). |
| 4 | `<block type="artefact">` | TRANSFORMED / GATED | Feature flag | Content raw (no unescaping). Feature-gated by `artefactRenderingEnabled`. |
| 5 | `<block type="fact">` | **DROPPED** | Safety rule | NEVER parsed from LLM text; server-constructed only. |
| 6 | `<block type="graph_patch">` | **DROPPED** | Safety rule | NEVER parsed from LLM text; server-constructed only. |
| 7 | Unknown block types | **DROPPED** | Parser | Warning emitted; block discarded. |
| 8 | `<suggested_actions>/<action>` | PASSED THROUGH | envelope.suggested_actions | Unescaped; role validated. Parser cap=4, assembler cap=3. Merged with tool + rescue actions. |
| 9 | `<diagnostics>` | CONSUMED INTERNALLY | Route metadata | Parsed for `Mode:` -> `response_mode`. Production-gated on envelope. Suppressed from streaming. |
| 10 | Preamble lines (Mode:, Stage:) | **DROPPED** | `stripDiagnosticsPreamble()` | Removed before XML extraction. |

**Entity unescaping asymmetry:** All text fields are XML-entity-unescaped EXCEPT artefact `<content>`, which uses `extractTagRaw()` to preserve raw HTML/CSS/JS byte-for-byte.

---

## Section 2: Secondary Prompt Traces

### 2.1 suggest_options

**Caller:** `POST /assist/suggest-options` (`src/routes/assist.suggest-options.ts`)
**Status:** Active

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `options[].id` | PASSED THROUGH | Sorted alphabetically |
| 2 | `options[].title` | PASSED THROUGH | Validated min 3 chars |
| 3 | `options[].pros` | PASSED THROUGH | Validated 2-3 items |
| 4 | `options[].cons` | PASSED THROUGH | Validated 2-3 items |
| 5 | `options[].evidence_to_gather` | PASSED THROUGH | Validated 2-3 items |

**Verdict:** All fields passed through. No drops.

### 2.2 clarify_brief

**Callers:** `POST /assist/clarify-brief` (route) + `src/cee/clarifier/question-generator.ts` (orchestrator)
**Status:** Active

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `questions[].question` | PASSED THROUGH | MCQ-first sort order |
| 2 | `questions[].choices` | PASSED THROUGH | Drives MCQ sort priority |
| 3 | `questions[].why_we_ask` | PASSED THROUGH | Validated min 20 chars |
| 4 | `questions[].impacts_draft` | PASSED THROUGH | Validated min 20 chars |
| 5 | `confidence` | GATED | Drives stop rule: >= 0.8 forces `should_continue = false` |
| 6 | `should_continue` | TRANSFORMED | Overridden when confidence >= 0.8 |

**Orchestrator path note:** Only `questions[0]` is consumed; `questions[1..n]` are **DROPPED** (Medium value — potentially useful follow-ups discarded).

### 2.3 critique_graph

**Caller:** `POST /assist/critique-graph` (`src/routes/assist.critique-graph.ts`)
**Status:** Active

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `issues[].level` | PASSED THROUGH | Sorted: BLOCKER > IMPROVEMENT > OBSERVATION |
| 2 | `issues[].note` | PASSED THROUGH | Validated 10-280 chars; sort tiebreaker |
| 3 | `issues[].target` | PASSED THROUGH | Optional |
| 4 | `suggested_fixes` | PASSED THROUGH | Max 5 |
| 5 | `overall_quality` | PASSED THROUGH | Logged in telemetry |

**Verdict:** All fields passed through. No drops.

### 2.4 explainer

**Status: DEAD CODE**

The `explainer` prompt is registered in the prompt management system but **never loaded or called at runtime**. Two conceptual consumers both bypass it:
- `/assist/explain-diff` route uses `adapter.explainDiff()` with an inline prompt (not the registered `explainer`)
- `explain_results` orchestrator tool uses `buildExplanationPrompt()` — a dynamically constructed prompt

The actual `/assist/explain-diff` consumer:

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `rationales[].target` | PASSED THROUGH | Sorted alphabetically |
| 2 | `rationales[].why` | PASSED THROUGH | Validated max 280 chars |
| 3 | `rationales[].provenance_source` | PASSED THROUGH | Optional |

The `explain_results` orchestrator tool:

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | Free-text LLM response | TRANSFORMED | Stripped of ungrounded numerics, cleaned, wrapped in CommentaryBlock |
| 2 | First sentence (headline) | TRANSFORMED | Extracted as `assistantText` (max 150 chars) |

### 2.5 bias_check

**Status: DEAD CODE**

The `bias_check` prompt is registered but **never used**. The comment says `(Placeholder - no LLM in current implementation)`. The actual `/assist/v1/bias-check` route uses purely deterministic, heuristic-only detection:
- `detectBiases()` — structural graph analysis, no LLM
- `enrichBiasFindings()` — ISL-based causal validation, no LLM
- `buildBiasMitigationPatches()` — deterministic patch generation, no LLM

All output fields (`bias_findings[]`, `mitigation_patches[]`, `quality`, `guidance`) are deterministically generated.

### 2.6 enrich_factors

**Caller:** `src/services/review/enrichFactors.ts` -> `POST /assist/v1/review`
**Status:** Active (uses direct import, not `getSystemPrompt()`)

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `enrichments[].factor_id` | PASSED THROUGH | Matched against controllable factors |
| 2 | `enrichments[].sensitivity_rank` | PASSED THROUGH | Used for filtering (rank > maxRank dropped) |
| 3 | `enrichments[].observations` | PASSED THROUGH | Validated 1-2 items |
| 4 | `enrichments[].perspectives` | PASSED THROUGH | Validated 1-2 items |
| 5 | `enrichments[].confidence_question` | GATED | Stripped if sensitivity_rank > 3 (defense-in-depth) |

**Gating note:** Enrichments with `sensitivity_rank > 10` are dropped entirely (Low value — least influential factors, intentional design).

### 2.7 repair_edit_graph

**Caller:** `src/orchestrator/tools/edit-graph.ts:1547` (edit-graph repair attempts)
**Status:** Active

| # | Field | Classification | Notes |
|---|-------|---------------|-------|
| 1 | `operations[]` | TRANSFORMED | Same pipeline as edit_graph: `stripOperationMeta()` -> normalise -> structural defaults -> validate |
| 2 | `operations[].rationale` | CONSUMED INTERNALLY | Stripped into debug metadata `_meta.operation_meta` |
| 3 | `operations[].impact` | CONSUMED INTERNALLY | Same as rationale |
| 4 | `removed_edges[]` | CONSUMED INTERNALLY | Stored in `_meta.removed_edges` |
| 5 | `warnings[]` | PASSED THROUGH | In `assistantText` + `validation_warnings` |
| 6 | `coaching.summary` | PASSED THROUGH | In `assistantText` + `patchData.summary` |
| 7 | `coaching.rerun_recommended` | **DROPPED** | Ignored; deterministic computation used instead |

---

## Section 3: Text Transformation Points

Every location where LLM text is transformed, replaced, merged, or gated:

| ID | File | Lines | Type | Description |
|----|------|-------|------|-------------|
| T1 | `package.ts` | 119-153 | inject | Status quo coaching injection when no status-quo option detected |
| T2 | `package.ts` | 155-165 | default | `strengthen_item.action_type` defaulted to `"improve"` |
| T3 | `package.ts` | 167-190 | gate | Causal claims validated against post-STRP graph node IDs (currently dead — see Finding 1) |
| T4 | `response-caps.ts` | — | truncate | `applyResponseCaps()` truncates list fields (bias_findings, options, evidence/sensitivity suggestions) |
| T5 | `package.ts` | 342-347 | generate | Deterministic guidance text from `buildCeeGuidance()` |
| T6 | `package.ts` | 219-312 | generate | Structural warnings (deterministic) |
| T7 | `schema-v3.ts` | 151-168 | clean | Node label annotation stripping via `cleanNodeLabel()` |
| T8 | `schema-v3.ts` | 435-529 | transform | Edge provenance extraction for V3 |
| T9 | `boundary.ts` | 65-113 | generate | Model adjustment mapping |
| T10 | `response-parser.ts` | 198-256 | strip | Diagnostics preamble stripping (`Mode:`, `Stage:`, etc.) |
| T11 | `response-parser.ts` | 427-464 | rescue | Inline action extraction from assistant_text when no `<suggested_actions>` found |
| T12 | `envelope-assembler.ts` | 195-197 | truncate | Suggested actions capped at 3 (parser allows 4) |
| T13 | `envelope-assembler.ts` | 201-204 | fallback | assistant_text fallback to generic text if null/empty |
| T14 | `draft-graph.ts` | 424-446 | compose | coaching.summary -> patch summary -> assistantText |
| T15 | `edit-graph.ts` | 2268-2282 | compose | coaching.summary -> assistantText (with repairs + warnings appended) |
| T16 | `edit-graph.ts` | 2630 | strip | `stripOperationMeta()` removes rationale/impact from operations |
| T17 | `validate-graph.ts` | — | adjust | Enforcement lints + bias correction on Pass 2 numeric estimates |

---

## Section 4: Dead Text Production (with Utilisation Quality Ratings)

LLM text that is produced but never reaches the user:

| Prompt | Field | Classification | Quality | Assessment |
|--------|-------|---------------|---------|------------|
| draft_graph | `topology_plan[]` | DROPPED | Medium | Planning scaffolding useful for debugging transparency but low direct user value. Would require UI design for step-by-step build visualization. |
| draft_graph | `causal_claims[]` | DROPPED (bug) | **High** | Would let users see explicit causal reasoning (direct effects, mediations, confounders) — directly supports coaching-over-gates philosophy. Entire validation pipeline exists but is unreachable. |
| draft_graph | `rationales[].why` | GATED (V1 only) | **High** | Per-node reasoning that could enhance user understanding of why each factor/outcome was included. Present in V1 but dropped at V3 boundary. |
| draft_graph | `confidence` | DROPPED | Low | Replaced by deterministic computation. LLM confidence would be unreliable anyway. |
| edit_graph | `operations[].rationale` | GATED (debug) | **High** | Would let users understand why each change was proposed, not just what changed — directly supports coaching-over-gates philosophy. |
| edit_graph | `operations[].impact` | GATED (debug) | Medium | Per-operation severity rating. Users could see "This is a high-impact change" but the operation itself is usually self-explanatory. |
| edit_graph | `coaching.rerun_recommended` | DROPPED | Low | Replaced by more reliable deterministic computation. LLM may hallucinate rerun need. |
| edit_graph | `removed_edges[].reason` | GATED (debug) | Medium | Tells users which edges were collaterally removed and why. Would help users understand side-effects of node removal. |
| repair_graph | `rationales[].action` | CONSUMED | Medium | Per-violation repair explanations. Would help users understand what was auto-fixed and why. |
| validate_graph | `model_notes[]` | CONSUMED | Low | Technical validation notes; not user-appropriate language. |
| orchestrator | `<diagnostics>` | CONSUMED | Low | Debug/routing information. Correctly production-gated. |
| orchestrator | Preamble lines | DROPPED | Low | Routing metadata (`Mode:`, `Stage:`). Correctly stripped. |
| repair_edit_graph | `coaching.rerun_recommended` | DROPPED | Low | Same as edit_graph — deterministic replacement is more reliable. |
| repair_edit_graph | `operations[].rationale` | CONSUMED | Medium | Per-repair rationales only in debug metadata. |

### High-Value Opportunities

Three fields stand out as high-value drops that could meaningfully improve the user experience:

1. **`causal_claims[]`** — A complete causal reasoning layer that the LLM produces and a validation pipeline processes, but the adapter boundary silently drops. This appears to be a bug, not a design choice.

2. **`rationales[].why`** — Per-node explanations present in V1 but lost at V3. Could be surfaced as node tooltips or an "explain this factor" feature.

3. **`operations[].rationale`** — Per-operation edit explanations stripped at `stripOperationMeta()`. Could be surfaced in the edit confirmation UI or as expandable detail on each change.

---

## Section 5: `.passthrough()` Field Leak Inventory

### Overview

The codebase uses `.passthrough()` at 20+ schema locations across three tiers:
1. **LLM adapter schemas** — prevents field loss during parsing
2. **Internal pipeline schemas** — preserves pipeline-injected metadata between stages
3. **V3 egress schemas** — allows undeclared fields to reach the API response

The Anthropic structured-output path is **safe** (`additionalProperties: false` constrains LLM output). The OpenAI `json_object` path is **at risk** — arbitrary LLM fields survive `.passthrough()`.

### Fields That Leak to API Response (Undeclared in Zod Egress Schema)

| Field | Source | Egress Schema | Intentional? | Risk |
|-------|--------|--------------|-------------|------|
| `nodes[].prior` | LLM / V3 transform (schema-v3.ts:246) | NodeV3 | Yes (ISL needs it) | Low — should be declared |
| `nodes[].factor_type` | LLM / V3 transform (schema-v3.ts:234) | NodeV3 | Yes (PLoT needs it) | Low — should be declared |
| `nodes[].extractionType` | LLM / V3 transform (schema-v3.ts:258) | NodeV3 | Yes (metadata) | Low — should be declared |
| `nodes[].uncertainty_drivers` | LLM / V3 transform (schema-v3.ts:261) | NodeV3 | Yes (metadata) | Low — should be declared |
| `nodes[].intercept` | LLM / V3 transform (schema-v3.ts:276) | NodeV3 | Yes (ISL needs it) | Low — should be declared |
| `nodes[].display_value` | LLM / V3 transform (schema-v3.ts:299) | NodeV3 | Yes (UI rendering) | Low — should be declared |
| `nodes[].interventions` | V3 transform (schema-v3.ts:805) | NodeV3 | Yes (canvas) | Low — option nodes only |
| `nodes[].is_baseline` | V3 transform (schema-v3.ts:808) | NodeV3 | Yes (PLoT) | Low — option nodes only |
| `edges[].defaulted` | Pipeline enrichment (schema-v3.ts:523) | EdgeV3 | Yes (trace) | Low — should be declared |
| `analysis_ready` | Pipeline (schema-v3.ts:878) | CEEGraphResponseV3 | Yes (P0 feature) | Low — should be declared |
| `draft_warnings` | Pipeline (schema-v3.ts:920) | CEEGraphResponseV3 | Yes (structural) | Low — should be declared |
| `_retry_suggestion` | Pipeline (schema-v3.ts:1012) | CEEGraphResponseV3 | **Questionable** | **Medium** — exposes internal retry metadata to clients |
| `trace.pipeline.*` | Pipeline stages | trace inner | Yes (observability) | Low |

### Uncontrolled Passthrough Paths (OpenAI Only)

These paths allow arbitrary LLM-invented fields to reach the API when using the OpenAI adapter:

| Path | Risk | Mitigation |
|------|------|-----------|
| `coaching.*` extra fields | Medium | Anthropic path safe (structured output). OpenAI path: LLM could add `internal_reasoning`, `model_confidence`, etc. |
| `coaching.strengthen_items[].X` | Medium | Same. Per-item passthrough allows novel fields. |
| `goal_constraints[].X` | Medium | GoalConstraintSchema uses `.passthrough()`. Novel constraint fields survive end-to-end. |
| `decision_review.review.*` | **High** (by design) | Entire LLM JSON forwarded. No output Zod schema. Any field reaches client. |

### Passthrough Chain Analysis

For the draft_graph path (most complex), the passthrough chain is:

```
LLMDraftResponse.passthrough()    -- LLM adapter parse
  -> Adapter return object        -- FIREWALL: explicit field selection blocks novel top-level fields
    -> DraftGraphOutput.passthrough() -- V1 schema validation
      -> V3 transform             -- FIREWALL: fresh object construction blocks most leaks
        -> CEEGraphResponseV3.passthrough() -- V3 schema validation
          -> HTTP response         -- Any surviving field reaches client
```

**Two firewalls** prevent most leaks:
1. The adapter return statement explicitly selects fields (blocks novel top-level LLM fields)
2. The V3 transform constructs fresh node/edge objects (blocks novel per-node/per-edge fields)

**Gaps in the firewalls:**
- `coaching` and `goal_constraints` bypass both firewalls (spread from adapter, assigned directly at V3)
- Pipeline-injected fields on the V3 response object bypass the V3 transform firewall

---

## Section 6: Per-Prompt Summary Matrix

| Prompt | Status | Text Fields | Passed | Transformed | Gated | Consumed | Dropped |
|--------|--------|-------------|--------|-------------|-------|----------|---------|
| draft_graph | Active | 24 | 12 | 6 | 2 | 0 | 4 |
| edit_graph | Active | 7 | 2 | 1 | 3 | 0 | 1 |
| repair_graph | Active | 3 | 1 | 0 | 0 | 2 | 0 |
| validate_graph | Active | 6 | 3 | 2 | 0 | 1 | 0 |
| decision_review | Active | 18 | 18 | 0 | 0 | 0 | 0 |
| orchestrator | Active | 10 | 2 | 3 | 1 | 1 | 3 |
| suggest_options | Active | 5 | 5 | 0 | 0 | 0 | 0 |
| clarify_brief | Active | 6 | 4 | 1 | 1 | 0 | 0 |
| critique_graph | Active | 5 | 5 | 0 | 0 | 0 | 0 |
| explainer | **Dead** | — | — | — | — | — | — |
| bias_check | **Dead** | — | — | — | — | — | — |
| enrich_factors | Active | 5 | 4 | 0 | 1 | 0 | 0 |
| repair_edit_graph | Active | 7 | 2 | 1 | 0 | 3 | 1 |

---

## Appendix A: Verification Spot-Checks

9 spot-checks performed, 8 verified, 1 clarified:

| # | Check | Result | Evidence |
|---|-------|--------|---------|
| 1 | `topology_plan` never in response construction | **VERIFIED** | Zero references in `src/` outside prompts + exclusion comment at `anthropic-graph-schema.ts:50` |
| 2 | `causal_claims` not extracted by adapters | **VERIFIED** | Neither `anthropic.ts:984` nor `openai.ts:809` include `causal_claims` in return object |
| 3 | `coaching.rerun_recommended` dropped in edit-graph | **VERIFIED** (clarified) | LLM's value is parsed but ignored; `appliedChangesReceipt.rerun_recommended` (deterministic) is used at line 2291. Comment at line 2243-2244 is explicit. |
| 4 | `coaching.summary` declared in V3 schema | **VERIFIED** | `cee-v3.ts:422`: `coaching: z.object({ summary: z.string(), ... })` |
| 5 | `narrative_summary` passed through in decision review | **VERIFIED** | `assist.v1.decision-review.ts:802`: `reviewOutput = extractionResult.json; response.review = reviewOutput` |
| 6 | `edges[].reasoning` stored in validate_graph | **VERIFIED** | `validate-graph.ts:173`: reasoning extracted and included in returned edge estimate object |
| 7 | `_retry_suggestion` not in Zod schema | **VERIFIED** | Zero matches in `cee-v3.ts` Zod schema; set at `schema-v3.ts:1012` via TypeScript interface |
| 8 | `nodes[].prior` undeclared in NodeV3 | **VERIFIED** | Not in `cee-v3.ts:104-118`; forwarded via `(v3Node as any).prior` at `schema-v3.ts:246` |
| 9 | `edges[].defaulted` undeclared in EdgeV3 | **VERIFIED** | Not in `cee-v3.ts:158-172`; spread via `as any` at `schema-v3.ts:523` |

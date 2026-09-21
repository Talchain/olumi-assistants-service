# Task 0 Discovery — schema amendment (Coaching / CausalClaim / TopologyPlan)

**Date:** 1 May 2026
**Branch:** none yet (Task 0 is read-only; branches created at Task 1).
**Reviewer:** Paul — please approve before Task 1 starts.

---

## (a) Anthropic structured-outputs budget projection

Currently 7/24 optional params, 9/16 union params (per `src/cee/draft/anthropic-graph-schema.ts:29-30`).

Adding three top-level **required** fields (`coaching`, `causal_claims`, `topology_plan`):

| Addition | Optional Δ | Union Δ |
|---|---|---|
| `coaching` (top-level required object) | 0 | 0 |
| `coaching.summary` (required) | 0 | 0 |
| `coaching.strengthen_items` (required array) | 0 | 0 |
| `coaching.widening_log` (optional during transition) | **+1** | 0 |
| `coaching.bias_signals` (optional during transition) | **+1** | 0 |
| `strengthen_items[*].bias_category` (optional) | **+1** | 0 |
| `strengthen_items[*].action_type` (enum, required) | 0 | 0 |
| `causal_claims` (top-level required, items = discriminatedUnion of 4) | 0 | **+1** (one `anyOf` for the variant union) |
| `causal_claims[*].stated_strength` (enum on direct_effect only, required when present) | 0 | 0 |
| `topology_plan` (top-level required `string[]`) | 0 | 0 |
| `widening_log.brief_completeness` (enum, required) | 0 | 0 |
| `bias_signals[*].type` (BiasType enum, required) | 0 | 0 |

**Projected post-amendment budget: 10/24 optional, 10/16 union.** Comfortable headroom (≤14 optional remaining, ≤6 union remaining).

No `nullable`/`anyOf` wrappers on any of the new top-level fields — they are plain required objects / arrays / enums. The single union added is the `causal_claims` items discriminated union.

The module-load guard at `anthropic-graph-schema.ts:210-217` (`countUnionParams`) will continue to fire only on regression.

## (b) Production-sample grep — `stated_source` and per-edge `stated_strength`

**`stated_source`**:
- Only declared in `src/schemas/causal-claims.ts:45` as `z.string().optional()`.
- **Zero consumer code reads it** (`grep -rn "stated_source"` across `src/`, `tests/fixtures/`, sibling repos `plot-lite-service`, `olumi-schemas`).
- **Zero fixture occurrences** (recursive JSON walk of `tests/fixtures/`).
- **Zero references** in `data/prompts.json`.
- **Decision: drop** `stated_source` from the schemas package. Cleanest contract; no production carriage.

**Per-edge `stated_strength`** (i.e. `edge.stated_strength`, distinct from `causal_claims[*].stated_strength`):
- **Zero occurrences** anywhere in CEE, PLoT, or schemas package source. All `stated_strength` references are inside `causal_claims[*]`.
- Confirms brief's exclusion of `EdgeStatedStrength`. No scope change.

## (c) Boundary-requirement decision (recorded)

**Updated 2026-05-01 after Codex review of Gate 1 commit.** The shared canonical `CoachingSchema` in `@talchain/schemas@0.11.0` requires all four fields: `summary`, `strengthen_items`, `widening_log`, `bias_signals`. Empty arrays / empty `WideningLog` are valid. Transitional permissiveness — handling LLM responses that omit `widening_log` or `bias_signals` during v192b → v194 rollout — lives in **CEE's normaliser at `src/adapters/llm/anthropic.ts:884`**, not in the canonical schema.

At the LLM structured-output boundary (CEE-side JSON Schema):
- `coaching`, `causal_claims`, `topology_plan` are **required** (top-level).
- Within `coaching`: `summary` and `strengthen_items` required. `widening_log` and `bias_signals` may be marked optional in the JSON Schema during the v192b → v194 transition; CEE's ingress normaliser then fills empty defaults so the canonical Zod parse passes.
- The schema-valid empty default at `src/cee/unified-pipeline/stages/package.ts:224` populates absent `coaching` for legacy callers and emits `draft_graph.contract_default_applied` telemetry — observable so a regression after v194 is detectable.

## (d) Legacy normaliser seam — confirmed

Site: `src/adapters/llm/anthropic.ts`, **between line 883 and line 886**.

Evidence:
- Line 837: `const parsed = parseResult.data;` — this is the post-Zod-parse value of the structured-output schema parse. The Zod parse uses `LLMDraftResponse` from `shared-schemas.ts` (with `.passthrough()`), which is what receives the LLM's raw JSON.
- Lines 841–883: existing `CEE_FIELD_SURVIVAL_TRACE` block runs immediately after `parsed` is bound — i.e. between the structured-output Zod parse and any field-shape transformations. This is the earliest seam at which we hold a known-shape JS object.
- Line 886 onwards: count caps (`parsed.nodes.length > GRAPH_MAX_NODES`), dangling-edge filter (lines 897–928), `assignStableEdgeIds` (line 931). These are the first transforms after parse.
- The internal `Graph` Zod parse happens **later**, in unified-pipeline Stage 1 (`src/cee/unified-pipeline/stages/parse.ts`) per the audit. That is the boundary the brief cites as "before internal Graph parse".

**Conclusion: insert the normaliser at line 884** (immediately after the `CEE_FIELD_SURVIVAL_TRACE` block, before count caps). It runs on the post-structured-output-Zod-parse object, before any pipeline stage can touch the data, and well before the internal `Graph` Zod parse downstream.

This is preferable to Stage 1 Parse (`parse.ts`) because by Stage 1 the LLM-output Zod parse has already happened (in `anthropic.ts`), and we want normalisation to land before any CEE_FIELD_SURVIVAL_TRACE/repair/etc that might key off raw values. Stage 4 Repair is far too late.

---

## Discovery summary

| Item | Outcome |
|---|---|
| Anthropic budget | 10/24 optional, 10/16 union projected. Headroom confirmed. |
| `stated_source` | Drop. Zero consumer evidence. |
| Per-edge `stated_strength` | Confirmed absent. `EdgeStatedStrength` exclusion stands. |
| Boundary-requirement | `coaching`/`causal_claims`/`topology_plan` required at every boundary. `widening_log`/`bias_signals` are required in the canonical `@talchain/schemas` `CoachingSchema`; CEE's Anthropic JSON Schema marks them optional during the v192b → v194 transition only, with the CEE ingress normaliser at `anthropic.ts:884` filling empty defaults so the canonical Zod parse passes. |
| Legacy normaliser seam | `src/adapters/llm/anthropic.ts:884` (immediately after `CEE_FIELD_SURVIVAL_TRACE`, before count caps). |

**Awaiting Paul's approval before starting Task 1.**

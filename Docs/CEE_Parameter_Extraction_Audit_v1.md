# CEE Parameter Extraction & Graph Generation Audit v1

**Date:** 20 March 2026
**Workstream:** CEE (olumi-assistants-service)
**Type:** Read-only investigation
**Scope:** Unified pipeline (`CEE_UNIFIED_PIPELINE_ENABLED`)

---

## Executive Summary

CEE performs multi-layer validation on LLM-generated graphs through a 6-stage unified pipeline: Parse → Normalise → Enrich → Repair → Package → Boundary. Validation includes structured outputs (Anthropic), Zod schema checks, adapter normalisation, STRP (5 deterministic rules), a 10-substep repair pipeline, and boundary integrity corrections.

**Key gaps identified:**
- `strength_mean` range [-1, +1] is NOT Zod-validated — only NaN/Infinity caught
- `strength_std > 0` is NOT validated anywhere
- Range discipline (sum of inbound |mean| ≤ 1.0) is NOT enforced by CEE
- Strength default anti-patterns produce warnings only, not repairs
- Node ID regex in code (`^[a-z0-9_:]+$`) omits hyphen present in prompt (`^[a-z0-9_:-]+$`)
- Constraint direction (`>=` vs `<=`) is LLM-extracted with no post-hoc validation

---

## 1. Draft Graph Output Validation

**Documented behaviour:** Draft graph prompt v187 specifies exact output schema for nodes, edges, causal claims, topology plan, and coaching.

### Actual behaviour

CEE applies a **5-layer validation pipeline** on draft graph LLM output:

**Layer 1: Structured Outputs (Anthropic)**
When `CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true` and using Claude Sonnet 4.5+, the response is constrained by JSON schema at token-generation level.
- Schema: `src/cee/draft/anthropic-graph-schema.ts` — requires `nodes[]` and `edges[]`, optional fields on each
- Fallback: on 400 error, degrades to prompt-only JSON mode
- File: `src/adapters/llm/anthropic.ts:466-591`

**Layer 2: JSON Extraction**
- Structured outputs: direct `JSON.parse()`, throws `UpstreamNonJsonError` on failure (defensive only — API guarantees valid JSON)
- Prompt-only mode: multi-strategy extraction via `src/utils/json-extractor.ts`:
  1. Raw text parse
  2. Markdown code block scan (```` ```json...``` ````)
  3. Bracket-matching from `{` or `[`
- All extraction fails → `UpstreamNonJsonError`, request fails (no fallback)

**Layer 3: Adapter Normalisation** (`src/adapters/llm/normalisation.ts`)
- Node kind mapping: non-standard kinds → canonical (e.g. `"evidence"→"option"`, `"constraint"→"risk"`), unknown → `"option"` with telemetry warning. Mapping defined in `NODE_KIND_MAP` (lines 25-76)
- Edge strength coercion: string→number, V4 format (`strength.mean`, `strength.std`, `exists_probability`) and legacy format (`weight`, `belief`), clamps probabilities to 0–1
- Sign reconciliation for `effect_direction` mismatches

**Layer 4: Zod Schema Validation** (`src/adapters/llm/shared-schemas.ts`)
- `LLMNode`: requires `id` (non-empty string), `kind` (enum); optional `label`, `body`, `category`, `data`, goal threshold fields. Uses `.passthrough()`
- `LLMEdge`: requires `from`, `to` (non-empty strings); optional V4 strength fields, `exists_probability` (0–1), `effect_direction` ("positive"|"negative"), `edge_type` ("directed"|"bidirected"). Uses `.passthrough()`

**Layer 5: Node ID Normalisation** (`src/cee/utils/id-normalizer.ts:21`)
- Canonical pattern: `^[a-z0-9_:]+$` (CANONICAL_ID_REGEX)
- **Divergence**: prompt specifies `^[a-z0-9_:-]+$` (includes hyphen), code does not

**Retry logic** (`src/cee/unified-pipeline/stages/parse.ts:149-261`):
- Max 2 attempts per request
- Retries on timeout only (first attempt); immediate fail on non-timeout errors
- Jittered backoff via `getJitteredRetryDelayMs()`

### Match/divergence

| Check | Documented | Actual | Match |
|---|---|---|---|
| JSON parsing + extraction | Yes | Multi-strategy with fallback | MATCH |
| Node ID pattern | `^[a-z0-9_:-]+$` | `^[a-z0-9_:]+$` (no hyphen) | DIVERGE |
| `strength_mean` range [-1, +1] | Implied by prompt | NOT Zod-validated (only NaN caught) | DIVERGE |
| `exists_probability` [0, 1] | Yes | Zod-validated | MATCH |
| `strength_std > 0` | Implied | NOT validated | DIVERGE |
| `effect_direction` consistency | Yes | Checked in STRP Rule 4 + deterministic sweep | MATCH |
| Invalid JSON handling | Retry/error | `UpstreamNonJsonError`, timeout retry only | MATCH |

### Impact on inference

**MEDIUM.** If the LLM emits `strength_mean` outside [-1, +1] or `strength_std ≤ 0`, these values pass through CEE to PLoT unchecked. Whether PLoT enforces these ranges determines whether they affect inference.

---

## 2. STRP (Structural Transform and Repair Pipeline)

**Documented behaviour:** CEE implements STRP with category override, factor type inference, data fill, and prior synthesis on reclassification. Mutations logged in `trace.pipeline.repair_summary`.

### Actual behaviour

File: `src/validators/structural-reconciliation.ts`

STRP consists of **5 deterministic rules**, executed in order, all idempotent. It does NOT add or remove nodes or edges — only modifies metadata fields.

**Rule 1: Category Override** (lines 148-216)
Infers factor categories from graph structure:
- Has option→factor edge → `controllable`
- Has `data.value` → `observable`
- Neither → `external`

On reclassification:
- FROM controllable → strips `factor_type`, `uncertainty_drivers` (tracked in `fieldDeletions`)
- TO controllable → auto-fills `factor_type`=`"other"`, `uncertainty_drivers`=`["Estimation uncertainty"]`
- Category was absent (undefined) → sets category only, defers data fill to Rule 5

**Rule 2: Enum Validation** (lines 279-358)
Corrects invalid enum values to safe defaults:
- Invalid `factor_type` → `"other"`
- Invalid `extractionType` → `"inferred"`
- Invalid `category` → stripped (`undefined`), deferred to Rule 1 inference
- Invalid `effect_direction` → `"positive"`

Valid values derived from Zod schemas at `src/schemas/graph.ts` (source of truth).

**Rule 3: Constraint Target Validation** (lines 365-661)
Normalises `goal_constraints[].node_id` against actual graph nodes:
1. Exact ID match → keep
2. Label-based remap → normalise constraint label to slug, substring match against node labels
3. Stem substring fuzzy match → remap if unambiguous (min stem length: 4 chars)
4. No match / ambiguous → drop with diagnostic

Drop reasons: `no_candidates`, `prefix_mismatch`, `ambiguous`, `below_threshold`, `missing_node_labels`. Suffix stripping: "ceiling", "floor", "minimum", "maximum", "cap", "min", "max".

**Rule 4: Sign Reconciliation** (lines 667-699)
Aligns `effect_direction` with `strength_mean` sign. Flips the **direction** to match the sign (not vice versa). Only fires when `strength_mean !== 0`.

**Rule 5: Controllable Data Completeness** (lines 228-273)
Late-pipeline only (gated by `fillControllableData: true`). Fills missing `factor_type`/`uncertainty_drivers` on ALL controllable factors. Runs after enrichment/repair to avoid overwrite.

**Mutation logging:** All mutations recorded in `STRPResult.mutations[]` with `{ rule, code, node_id/edge_id/constraint_id, field, before, after, reason, severity }`. Field deletions tracked in `STRPResult.fieldDeletions[]`.

**Pipeline integration:**
- Early STRP (Stage 2: Normalise): Rules 1, 2, 4
- Late STRP (Stage 4.6: Repair): Rules 3, 5 with `fillControllableData: true` and `nodeLabels`

### Match/divergence

| Aspect | Documented | Actual | Match |
|---|---|---|---|
| Category override | Yes | Rule 1 — structural inference | MATCH |
| Factor type inference | Yes | Rule 1 (reclassification) + Rule 5 (late fill) | MATCH |
| Data fill | Yes | Rule 5 — `factor_type`/`uncertainty_drivers` | MATCH |
| Prior synthesis on reclassification | Yes | Rule 1 — strips controllable fields, fills on TO-controllable | MATCH |
| All mutations logged | Yes | `STRPResult.mutations[]` + `fieldDeletions[]` | MATCH |
| Modifies edge strengths | No | Confirmed: does NOT modify strength_mean/std/belief_exists | MATCH |

### Impact on inference

**LOW-MEDIUM.** STRP modifies metadata fields only (`category`, `factor_type`, `uncertainty_drivers`, `extractionType`, `effect_direction`). It never touches `strength_mean`, `strength_std`, `belief_exists`, or `data.value`. However, category reclassification affects how PLoT treats factors (controllable factors have intervention effects; external factors do not), which indirectly affects inference results.

---

## 3. Normalisation at CEE Boundary

**Documented behaviour:** Draft graph prompt v187 includes scale discipline rules. The LLM is instructed to normalise values using caps.

### Actual behaviour

File: `src/cee/transforms/graph-data-integrity.ts`

**Task 1: Factor Scale Consistency** (lines 1-66)
Runs in Stage 6 (Boundary), after `transformResponseToV3()`, before V3 schema validation.

Logic:
- For each factor with `observed_state.raw_value` and `observed_state.cap`:
  - Expected value = `raw_value / cap` (or `raw_value / 100` for percentage factors, unit: `"%"`)
  - Actual value = `observed_state.value`
  - If `|actual - expected| / expected > 0.05` (5% relative error): **recompute and correct**
  - Correction ratio applied to ALL option intervention values on the affected factor

Example:
```
raw_value: 49, cap: 59 → expected value: 0.831
LLM emitted value: 0.49 (wrong — divided by 100 instead of 59)
CEE corrects to 0.831 and adjusts interventions by ratio 100/59
```

**Task 2: Edge Field Safety Net** (lines 67-99)
Catches edges still missing `exists_probability` or `effect_direction` after V3 transform:

| Edge class | Default `exists_probability` | Logic |
|---|---|---|
| Structural (decision→option, option→factor) | 1.0 | Hard structural constraint |
| Causal (factor→factor, factor→goal) | 0.8 | Epistemically uncertain |

Missing `effect_direction`: defaulted based on sign of `strength_mean`.

**Does CEE validate `data.value` consistency with `raw_value / cap`?** YES — the factor scale consistency check does exactly this.

**Does CEE recalculate normalised values from raw values?** YES — when inconsistency detected (>5% tolerance), it recomputes and applies the correction.

### Match/divergence

CEE DOES validate and correct scale consistency, but only at the V3 boundary (Stage 6). No check during earlier pipeline stages — if enrichment or repair stages produce inconsistent values, they're caught late.

### Impact on inference

**HIGH.** This is a critical correction. If the LLM emits `value: 0.49` instead of `value: 0.831` for a factor with `raw_value: 49, cap: 59`, the factor's observed state would be off by ~70%. CEE catches and fixes this. Without this check, inference would compute with fundamentally wrong factor values.

---

## 4. Edge Parameter Patterns

**Documented behaviour:** Prompt specifies parameter ranges, anti-patterns (all edges same mean is unreasonable), and structural edge canonical values (mean=1.0, std=0.01, exists_probability=1.0).

### Actual behaviour

**4a. Anti-pattern detection**

Files: `src/cee/validation/integrity-sentinel.ts`, `src/cee/transforms/schema-v3.ts:862-902`

| Warning | Condition | Threshold | Severity | Action |
|---|---|---|---|---|
| `STRENGTH_DEFAULT_APPLIED` | ≥N% of edges have `mean==0.5 AND std==0.125` (min 3 edges) | 80% | warn | Warning only |
| `STRENGTH_MEAN_DEFAULT_DOMINANT` | ≥N% of edges have `mean ≈ 0.5` (any std) | 70% | warn | Warning only |
| `EDGE_STRENGTH_LOW` | `|strength_mean| < threshold` | 0.05 | info | Warning only |
| `EDGE_STRENGTH_NEGLIGIBLE` | Stricter variant of LOW | <0.05 | info | Warning only |

Constants from `@talchain/schemas`, re-exported via `src/cee/constants.ts`:
- `DEFAULT_STRENGTH_MEAN = 0.5`
- `DEFAULT_STRENGTH_STD = 0.125`

**These are warnings only — they do not repair the graph or reject the draft.**

**4b. Structural edge validation**

File: `src/validators/graph-validator.types.ts`

Canonical structural edge values:
```
mean: 1.0, std: 0.01, prob: 1.0, direction: "positive"
```

Enforcement:
- `src/cee/structural-edge-normaliser.ts` — coerces option→factor edges to canonical after Zod parsing, before graph validation
- `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts` — Bucket A auto-fix for `STRUCTURAL_EDGE_NOT_CANONICAL_ERROR`

**4c. Range discipline**

Sum of inbound |mean| ≤ 1.0 for bounded nodes: **NOT checked by CEE**. No code enforcing this constraint was found in the codebase. This is either enforced by PLoT, or not at all.

**4d. Bidirected edge sentinel parameters**

No special sentinel values (mean=0, std=0.01, exists_probability=1.0) documented or enforced in codebase. Bidirected edges use standard fields. The `EdgeType` enum includes `"bidirected"` (`src/schemas/graph.ts`) with comment: "indicates an unmeasured common cause (Pearl's ADMG notation). ISL never sees bidirected edges."

### Match/divergence

| Check | Documented | Actual | Match |
|---|---|---|---|
| Anti-pattern detection | Prompt warns against uniform means | Detected as warnings only | PARTIAL (no repair) |
| Structural edge canonical | mean=1, std=0.01, prob=1 | Auto-fixed in sweep + normaliser | MATCH |
| Range discipline | Prompt specifies constraint | NOT enforced by CEE | DIVERGE |
| Bidirected sentinels | Prompt specifies mean=0, std=0.01, prob=1 | No validation found | DIVERGE |

### Impact on inference

**MEDIUM-HIGH.** Strength default warnings are informational — if the LLM outputs identical means for all edges, the graph passes through unchanged, producing a flat influence landscape. Range discipline violations could produce posterior distributions that exceed physical bounds. These are structural quality issues that CEE detects but does not correct.

---

## 5. Edit Graph Output Handling

**Documented behaviour:** Edit graph v6 produces patch operations. These should be validated before application.

### Actual behaviour

File: `src/orchestrator/tools/edit-graph.ts`

**Validation chain (4 stages):**

1. **Sanitisation** — Legacy fields (`belief`, `belief_exists`, `confidence`) stripped from patch operations. Map legacy → canonical format with telemetry.

2. **Zod Schema Validation** (`src/orchestrator/patch-validation.ts`):
   - `validatePatchOperations()` validates structural integrity
   - Valid operation types: `add_node`, `remove_node`, `update_node`, `add_edge`, `remove_edge`, `update_edge`

3. **Referential Integrity** (`checkReferentialIntegrity()`):
   - update/remove → target must exist
   - add → must not duplicate IDs
   - add_edge → source/target must exist or be added in same batch

4. **Structural Validation** (`src/orchestrator/graph-structure-validator.ts`):
   - Required node kinds: goal, decision, min 2 options
   - Limits: 20 nodes, 30 edges max
   - Orphan nodes, path-to-goal, **cycle detection** (checked at CEE level)

5. **PLoT Semantic Validation** (via `/v1/validate-patch`, if configured):
   - Configured: PLoT failure = **hard reject**
   - Not configured (dev/test): semantic gate skipped entirely

**Key design invariant** (documented in file header):
> "CEE is the structural gatekeeper (Zod schema + referential integrity). PLoT is the semantic judge (validate-patch endpoint). CEE never normalises values — no STRP, no strength clamping."

**"No silent semantics" policy:** PLoT repairs surfaced as `repairs_applied` on the block, never silently rewritten into the operations array.

**Not validated on edit path:**
- Edge `strength_mean` range [-1, +1]
- `strength_std > 0`
- Range discipline (sum of inbound |mean| ≤ 1.0)
- `exists_probability` bounds (beyond Zod schema)

### Match/divergence

Good match. The edit path has a clear structural → semantic validation chain. The deliberate "no STRP on edit" policy means edits have less validation than drafts.

### Impact on inference

**LOW** when PLoT is configured — PLoT acts as semantic judge. **HIGH** when PLoT is not configured — no semantic validation, patches flow through with only structural checks. New edge parameters (strength, exists_probability) are not range-validated by CEE.

---

## 6. Repair Graph Output Handling

**Documented behaviour:** Repair graph v6 takes violation codes and produces a complete corrected graph.

### Actual behaviour

File: `src/cee/unified-pipeline/stages/repair/index.ts`

The repair flow is a **10-substep pipeline** within Stage 4:

| Step | Name | Purpose |
|---|---|---|
| 4.1 | Deterministic sweep | Bucket A/B mechanical fixes |
| 4.1b | Orchestrator validation | Optional LLM-backed validation |
| 4.2 | PLoT validation + LLM repair | Bucket C semantic issues → LLM repair call |
| 4.3 | Edge ID stabilisation | Deterministic IDs before goal merge |
| 4.4 | Goal merge | Enforce single goal, capture node renames |
| 4.5 | Compound goals | Generate constraint nodes/edges |
| 4.6 | Late STRP | Rules 3, 5 with constraints context |
| 4.7 | Edge field restoration | Restore V4 fields from stash using renames |
| 4.8 | Connectivity | Wire orphans to goal |
| 4.9 | Clarifier | Last graph-modifying step (optional) |

**Deterministic sweep** (`src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts`):

Bucket A (always auto-fix):
- `NAN_VALUE` → `strength_mean: 0.5`, `strength_std: NAN_FIX_SIGNATURE_STD (0.125)`, `belief_exists: 0.8`
- `SIGN_MISMATCH` → flip `strength_mean` sign to match `effect_direction`
- `STRUCTURAL_EDGE_NOT_CANONICAL_ERROR` → set to canonical `mean=1, std=0.01, belief_exists=1.0`
- `INVALID_EDGE_REF` → remove edges referencing non-existent nodes
- `GOAL_HAS_OUTGOING` → remove outgoing edges from goal
- `DECISION_HAS_INCOMING` → remove incoming edges to decision

Bucket B (fix when cited): `CATEGORY_MISMATCH`, data completeness issues

Bucket C (semantic, LLM-only): `NO_PATH_TO_GOAL`, `CYCLE_DETECTED`, `UNREACHABLE_FROM_DECISION`, `MISSING_BRIDGE`, etc.

**Re-validation:** After LLM repair, the corrected graph goes through the deterministic sweep + PLoT re-validation. However, the process does NOT loop — **max 1 repair attempt**.

**Can repair introduce new violations?** Yes. The LLM repair may fix cited violations but introduce new ones. Post-repair deterministic sweep catches mechanical issues; PLoT catches semantic ones. Remaining violations are logged but not further repaired.

### Match/divergence

Partial match. Repair output IS re-validated, but only one repair attempt is made — no guarantee all violations are resolved.

### Impact on inference

**LOW-MEDIUM.** The re-validation safety net catches most issues introduced by repair. Single-attempt policy means some violations may persist, but these are logged for observability.

---

## 7. Validation Warnings

**Documented behaviour:** CEE emits `STRENGTH_DEFAULT_APPLIED` and `EDGE_STRENGTH_LOW` warnings.

### Actual behaviour

Files: `src/cee/transforms/schema-v3.ts:862-902, 1093-1098`, `src/cee/validation/integrity-sentinel.ts`

**Complete warning inventory:**

| Warning Code | Condition | Threshold | Emission Point |
|---|---|---|---|
| `STRENGTH_DEFAULT_APPLIED` | ≥80% of edges (min 3) have default signature (`mean==0.5 AND std==0.125`) | 80% | `schema-v3.ts:862-873` |
| `STRENGTH_MEAN_DEFAULT_DOMINANT` | ≥70% of edges have `mean ≈ 0.5` regardless of std | 70% | `schema-v3.ts:886-902` |
| `EDGE_STRENGTH_LOW` | `|strength_mean| < 0.05` | 0.05 | `schema-v3.ts:1093-1098` |
| `EDGE_STRENGTH_NEGLIGIBLE` | Stricter variant | <0.05 | `schema-v3.ts` (nearby) |

**Detection logic** (`src/cee/validation/integrity-sentinel.ts:340+`):
- `detectStrengthDefaults()` checks for the "default signature" (both mean AND std at defaults)
- Separate check at line 567+ for `STRENGTH_MEAN_DEFAULT_DOMINANT` — lower threshold (70%) to catch cases where LLM varied belief/provenance but defaulted strength magnitude

**Constants** (`src/cee/constants.ts`, sourced from `@talchain/schemas`):
- `DEFAULT_STRENGTH_MEAN = 0.5`
- `DEFAULT_STRENGTH_STD = 0.125`
- `STRENGTH_DEFAULT_THRESHOLD = 80%` (min edges: 3)
- `STRENGTH_MEAN_DEFAULT_THRESHOLD = 70%`
- `EDGE_STRENGTH_LOW_THRESHOLD = 0.05`

**Forwarding to UI:**
- Warnings added to `validation_warnings[]` on the V3 response envelope
- Extracted by draft graph tool handler → `validation_warnings` field on `GraphPatchBlock` data
- Also extracted as `draftWarnings` (`CEEDraftWarning[]`)

**Undocumented warning:** `STRENGTH_MEAN_DEFAULT_DOMINANT` is not mentioned in the investigation brief but exists in code and fires independently from `STRENGTH_DEFAULT_APPLIED` — both can appear simultaneously.

### Match/divergence

Good match for documented warnings. One additional undocumented warning (`STRENGTH_MEAN_DEFAULT_DOMINANT`).

### Impact on inference

**INFORMATIONAL.** Warnings do not modify the graph. They signal potential quality issues to the UI/user. If warnings are ignored, inference runs with potentially low-quality edge parameters.

---

## 8. Constraint Extraction

**Documented behaviour:** CEE extracts `goal_constraints[]` from the brief as `RawGoalConstraint` superset.

### Actual behaviour

**Schema:** `src/schemas/assist.ts:109-134` (`GoalConstraintSchema`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `constraint_id` | string | Yes | Unique identifier |
| `node_id` | string | Yes | Target factor/outcome node |
| `operator` | `">=" \| "<="` | Yes | ASCII only (no unicode ≥/≤) |
| `value` | number | Yes | In **user units** (PLoT normalises) |
| `label` | string | No | Human-readable description |
| `unit` | string | No | Units of the value |
| `source_quote` | string | No | Excerpt from brief (max 200 chars) |
| `confidence` | number (0-1) | No | Extraction confidence |
| `provenance` | `"explicit" \| "inferred" \| "proxy"` | No | How the constraint was derived |
| `deadline_metadata` | object | No | `{ deadline_date, reference_date, assumed_reference_date }` |

**Extraction flow:**
1. LLM extracts constraints from compound goals during draft graph generation
2. Constraints returned as top-level field on `CEEGraphResponseV3`: `goal_constraints: GoalConstraint[]`
3. STRP Rule 3 (Stage 4.6, late pipeline) normalises `node_id` values via fuzzy matching against actual graph nodes
4. Normalised constraints flow to PLoT with the graph

**What CEE validates:**
- Zod schema validates field types and ranges (`operator` enum, `value` is number, `confidence` 0–1)
- STRP Rule 3 validates and remaps `node_id` against actual graph nodes

**What CEE does NOT validate:**
- Whether `operator` direction (`>=` vs `<=`) is semantically correct for the target factor
- Whether `value` is in a reasonable range for the target factor
- Whether the constraint makes sense given the factor's data (e.g. constraining above the cap)
- Constraint-to-risk node conversion exists in codebase but is **currently unused** — constraints are metadata-only

**Constraint target value:** In **raw user units** — PLoT handles normalisation to [0, 1] scale using the factor's cap.

### Match/divergence

Good match. The `GoalConstraintSchema` maps to the documented `RawGoalConstraint` superset. Direction and value are LLM-extracted with no CEE semantic correction.

### Impact on inference

**MEDIUM.** If the LLM extracts the wrong direction (`>=` vs `<=`) or an incorrect value, it flows through to PLoT. PLoT normalises the value using the factor's cap but does not second-guess the constraint direction. An inverted constraint would flip the optimisation direction for that factor.

---

## Summary: Inference Impact Assessment

| Section | Finding | Impact | Gap Type |
|---|---|---|---|
| 1. Draft validation | `strength_mean` range not Zod-validated | MEDIUM | Missing validation |
| 1. Draft validation | `strength_std > 0` not validated | MEDIUM | Missing validation |
| 1. Draft validation | Node ID regex diverges from prompt | LOW | Inconsistency |
| 2. STRP | Category reclassification affects PLoT treatment | LOW-MEDIUM | By design |
| 3. Normalisation | Factor scale consistency corrected at boundary | HIGH (positive) | Working as intended |
| 4. Edge patterns | Anti-patterns warn-only, no repair | MEDIUM-HIGH | Design gap |
| 4. Edge patterns | Range discipline not enforced | MEDIUM-HIGH | Missing validation |
| 5. Edit graph | No strength clamping on edit path | LOW-HIGH (depends on PLoT) | By design |
| 6. Repair | Single repair attempt, new violations possible | LOW-MEDIUM | Design limitation |
| 7. Warnings | Undocumented `STRENGTH_MEAN_DEFAULT_DOMINANT` | LOW | Documentation gap |
| 8. Constraints | Direction not semantically validated | MEDIUM | Missing validation |

---

## File Reference Index

| File | Role in pipeline |
|---|---|
| `src/cee/unified-pipeline/index.ts` | 6-stage pipeline orchestrator |
| `src/cee/unified-pipeline/stages/parse.ts:149-261` | Stage 1: LLM call + retry (max 2 attempts, timeout-only retry) |
| `src/cee/unified-pipeline/stages/repair/index.ts` | Stage 4: 10-substep repair pipeline |
| `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts` | Bucket A/B/C mechanical fixes (NaN, sign, structural edges) |
| `src/validators/structural-reconciliation.ts` | STRP: 5 deterministic reconciliation rules |
| `src/adapters/llm/normalisation.ts` | Adapter-level kind mapping + strength coercion |
| `src/adapters/llm/shared-schemas.ts` | Zod schemas for LLM node/edge output |
| `src/cee/draft/anthropic-graph-schema.ts` | Anthropic structured output JSON schema |
| `src/utils/json-extractor.ts` | Multi-strategy JSON extraction from LLM text |
| `src/cee/transforms/graph-data-integrity.ts` | Scale consistency check + edge field safety net |
| `src/cee/transforms/schema-v3.ts:862-902, 1093-1098` | V3 transform + validation warning emission |
| `src/cee/validation/integrity-sentinel.ts` | Strength default detection logic |
| `src/cee/constants.ts` | CIL warning thresholds (from @talchain/schemas) |
| `src/cee/utils/id-normalizer.ts:21` | Node ID canonical regex |
| `src/cee/structural-edge-normaliser.ts` | Option→factor edge canonicalisation |
| `src/orchestrator/tools/edit-graph.ts` | Edit graph handler (structural + PLoT validation) |
| `src/orchestrator/tools/draft-graph.ts` | Draft graph handler (unified pipeline entry) |
| `src/orchestrator/patch-validation.ts` | Patch Zod schema + referential integrity |
| `src/orchestrator/graph-structure-validator.ts` | Structural validation (kinds, limits, cycles, orphans) |
| `src/orchestrator/validation/response-contract.ts` | Response envelope validation (block types, stage indicator) |
| `src/schemas/assist.ts:109-134` | GoalConstraintSchema definition |
| `src/schemas/graph.ts` | GraphT, EdgeT, NodeT types + EdgeType enum |
| `src/validators/graph-validator.types.ts` | Canonical structural edge values |
| `src/utils/retry.ts` | General retry utility (3 attempts, exponential backoff) |

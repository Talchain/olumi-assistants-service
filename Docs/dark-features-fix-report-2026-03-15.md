# Dark Features Fix Report — 2026-03-15

## 1. `[value]` Fix: `stripUngroundedNumerics`

### Root cause

`stripUngroundedNumerics()` in `src/orchestrator/tools/explain-results.ts` replaced ALL numeric tokens (integers, percentages, currency, decimals, ranges) with `[value]`, except 4-digit years and single-digit structural references. It had no awareness of the analysis data available to the `explain_results` tool.

When the LLM cited grounded analysis values like "62% win probability" (from `win_probability: 0.62`), those were stripped to `[value]` — making the response useless.

### Approach chosen: Grounded-set allowlist

Added `buildGroundedValues(analysisResponse)` which extracts all known numeric values from the analysis data and generates multiple surface forms for each:

- `win_probability: 0.62` → `"0.62"`, `"62"`, `"62.0"`, `"62%"`, `"63"` (ceil)
- `goal_value.mean: 18500` → `"18500"`, `"18,500"`, `"18.5k"`
- `n_samples: 10000` → `"10000"`, `"10,000"`, `"10k"`
- `elasticity: 0.85` → `"0.85"`, `"85"`, `"85.0"`

The modified `stripUngroundedNumerics(text, analysisResponse?)` now:
1. Builds the grounded set from analysis data (when provided)
2. For each numeric match, checks if it's in the grounded set
3. Preserves grounded numbers, strips ungrounded ones
4. Backward-compatible: without `analysisResponse`, strips all (legacy behavior)

### Files changed

- `src/orchestrator/tools/explain-results.ts` — new `buildGroundedValues()`, updated `stripUngroundedNumerics()` signature and logic, updated call site to pass `analysisResponse`

### Test results

16 new tests added covering:
- Grounded percentage preservation (62% from 0.62)
- Grounded decimal preservation (0.62)
- Grounded currency preservation (£18,500 from goal_value.mean)
- Grounded range preservation (14200-22800 from p10/p90)
- Grounded elasticity preservation (0.85)
- Grounded sample count preservation (10,000)
- Ungrounded number stripping (87%, $50,000 not in analysis)
- Mixed grounded/ungrounded in same text
- Constraint joint probability preservation
- Backward compatibility (no analysis → strip all)
- Grounded "percent" word form preservation (62 percent)
- Grounded negative elasticity preservation (-0.4)
- Absolute value of negative grounded number (0.4 from -0.4)
- `buildGroundedValues()` unit tests for percentage forms, n_samples, goal_value, negative elasticity

All 45 tests pass (29 existing + 16 new).

### Before/after

**Before:**
```
"Option A leads with [value] win probability. The expected outcome is [value]."
```

**After (with analysis_response providing win_probability: 0.62, goal_value.mean: 18500):**
```
"Option A leads with 62% win probability. The expected outcome is £18,500."
```

---

## 2. Per-Feature Investigation

### 2.1 BIL (Brief Intelligence Layer) — `BIL_ENABLED`

- **Flag check:** `src/config/index.ts:263` → `config.features.bilEnabled`
- **Runtime gate:** `src/orchestrator/turn-handler.ts:515` — `stage === 'frame' || stage === 'ideate'` AND `message.trim().length >= 50`
- **Why dark on staging:** BIL is **stage-gated by design**. It only activates during framing and ideation stages. On evaluate/execute stages, it produces no output. This is correct behavior.
- **Fix:** None required. BIL works as designed.
- **Proof of output:** When tested on frame/ideate stages with messages ≥ 50 chars, BIL extraction succeeds and `bilContext` is populated in Zone 2.

### 2.2 DSK Coaching — `DSK_COACHING_ENABLED`

- **Flag check:** `src/config/index.ts:264` → `config.features.dskCoachingEnabled`
- **Primary gate:** `src/orchestrator/dsk-coaching/assemble-coaching-items.ts:51`
- **Secondary gates:**
  - Depends on BIL extraction producing `dsk_cues[]` (upstream dependency)
  - Depends on DSK bundle being loaded (`DSK_ENABLED` or `ENABLE_DSK_V0`)
  - Empty-check gate: if both `biasAlerts` and `techniqueRecommendations` are empty → returns `undefined`
- **Why dark on staging:** DSK coaching has a **three-level dependency chain**: DSK bundle → BIL extraction → dsk_cues matching → coaching items. All must succeed AND produce non-empty results. Testing with briefs that don't trigger DSK cue patterns (sunk cost, anchoring, planning fallacy) produces no output.
- **Fix:** None required. Added startup health check that warns when `DSK_COACHING_ENABLED=true` but `BIL_ENABLED` or `DSK_ENABLED` is false.

### 2.3 Entity Memory — `CEE_ENTITY_MEMORY_ENABLED`

- **Flag check:** `src/config/index.ts:431` → `config.cee.entityMemoryEnabled`
- **Runtime gate:** `src/orchestrator/pipeline/phase1-enrichment/index.ts:183` — requires `graph_compact` AND conversation `messages[]`
- **Why dark on staging:** Entity memory requires **multi-turn context**: it tracks per-factor interaction state across turns. On the first turn (no conversation history) or without a graph with factors, it produces nothing.
- **Fix:** None required. Works as designed for multi-turn scenarios.

### 2.4 Causal Validation — `CEE_CAUSAL_VALIDATION_ENABLED`

- **Flag check:** `src/config/index.ts:631` → `config.cee.causalValidationEnabled`
- **Secondary gate:** `src/cee/bias/causal-enrichment.ts:162-170` — requires `ISL_BASE_URL` configured AND ISL service reachable
- **Why dark on staging:** Causal validation depends on an **external ISL service**. If `ISL_BASE_URL` is not set, the feature silently degrades. Added startup health check that warns when enabled but ISL_BASE_URL is missing.
- **Fix:** Added diagnostic in startup health check. The feature itself works correctly when ISL is available.

### 2.5 Grounding — `GROUNDING_ENABLED`

- **Flag check:** `src/config/index.ts:249` → `config.features.grounding`
- **Usage:** `src/routes/assist.draft-graph.ts:626`, `src/routes/assist.critique-graph.ts:71`
- **Why dark on staging:** Grounding is a **document-processing feature** for draft-graph and critique-graph routes. It requires `attachments` in the request body. Without attachments, it returns empty results. It is NOT an orchestrator pipeline feature.
- **Fix:** None required. Not applicable to orchestrator pipeline.

### 2.6 Zone 2 Registry — `CEE_ZONE2_REGISTRY_ENABLED`

- **Flag check:** `src/config/index.ts:265` → `config.features.zone2Registry`
- **Runtime behavior:** `src/orchestrator/turn-handler.ts:532` — assembles Zone 2 blocks based on profile selection (framing/ideation/post_analysis/parallel_coaching)
- **Why dark on staging:** Zone 2 blocks activate based on **profile and context state**. On a first-turn framing request, only `stage_context` and `bil_context` (if BIL enabled) activate. The registry itself works correctly.
- **Fix:** None required. Added per-turn Zone 2 assembly diagnostic that logs empty blocks and warns when a block activates but renders empty.

### Summary

| Feature | Status | Root Cause | Fix Applied |
|---|---|---|---|
| BIL | **Working** | Stage-gated (frame/ideate only) | None needed |
| DSK Coaching | **Working** | Three-level dependency chain | Startup health warning |
| Entity Memory | **Working** | Requires multi-turn + graph | None needed |
| Causal Validation | **Conditionally working** | Requires ISL service | Startup health warning |
| Grounding | **Working** | Not an orchestrator feature | None needed |
| Zone 2 Registry | **Working** | Profile-based block selection | Assembly diagnostics |

---

## 3. Features That Are Genuinely Incomplete

**None found.** All 6 investigated features are fully implemented. They produce no output because their activation conditions are not met during typical single-turn staging probes, not because the implementation is incomplete.

The systemic issue was **observability**: there was no mechanism to distinguish "feature working but preconditions not met" from "feature broken." This is addressed by the diagnostics in Task 3.

---

## 4. Diagnostics Added

### 4a. Startup Feature Health (`src/diagnostics/feature-health.ts`)

New module that runs at server boot. For each feature flag, checks whether dependencies are satisfied:

```
[startup] Feature health: BIL=✓, DSK=✓, DSK_coaching=✗ (BIL_ENABLED is false), entity_memory=✓, ...
```

- **Healthy features:** logged at `info` level
- **Unhealthy features:** logged at `warn` level with specific reason

Checks implemented:
- BIL: self-contained
- DSK: self-contained (bundle load is fail-fast)
- DSK Coaching: requires both DSK_ENABLED and BIL_ENABLED
- Entity Memory: self-contained
- Causal Validation: requires ISL_BASE_URL
- Grounding: self-contained
- Zone 2 Registry: self-contained
- Orchestrator V2: self-contained

Called from `src/server.ts` after DSK bundle load.

### 4b. Per-turn Zone 2 Assembly Diagnostic

Enhanced `assembleFullPrompt()` in `src/orchestrator/prompt-zones/assemble.ts`:
- `AssembledPrompt` now includes `empty_blocks: string[]`
- Assembly tracks blocks that activate but render empty content
- Turn handler logs empty blocks as warnings:

```json
{
  "event": "zone2_block_empty",
  "empty_blocks": ["bil_context"],
  "msg": "Zone 2: 1 block(s) activated but rendered empty: bil_context"
}
```

### 4c. Feature Health in Response Envelope

Added `features` field to `_route_metadata` in `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts`:

```json
{
  "_route_metadata": {
    "features": {
      "BIL": { "enabled": true, "healthy": true },
      "DSK": { "enabled": true, "healthy": true },
      "DSK_coaching": { "enabled": true, "healthy": false, "reason": "BIL_ENABLED is false" }
    }
  }
}
```

Only includes enabled features. Makes feature activation visible in every response.

### 4d. Data-Flow Verification Test (Step 6)

Added Step 6 to `tests/staging/data-flow-verification.test.ts`:
- Sends a request with analysis data
- Asserts `_route_metadata.features` is populated
- Asserts every enabled feature reports `healthy: true`
- Warns (but doesn't fail) if `features` field is absent (backward-compatible)

---

## 5. Post-Processing Audit

| Function | Location | Purpose | Risk |
|---|---|---|---|
| `stripUngroundedNumerics` | explain-results.ts:392 | Strip ungrounded numbers from LLM output | **HIGH → FIXED** (was destroying grounded values) |
| `stripDiagnostics` | response-parser.ts:165 | Strip `<diagnostics>` XML from LLM response | Low — internal debug tags only |
| `stripOperationMeta` | edit-graph.ts:2075 | Separate impact/rationale from patch operations | Low — structural metadata, not content |
| `stripNoOps` | edit-graph.ts:2251 | Remove identity operations from patches | Low — no content change |
| `sanitiseQuery` | research-topic.ts:99 | Strip prompt-injection markers from web search queries | Low — security boundary, not user output |

**No other content-destroying functions found.** `stripUngroundedNumerics` was the only function that modified user-visible LLM output in a way that could destroy legitimate content.

---

## 6. Post-Review Hardening (feedback-driven)

Five additional fixes applied after code review:

| Issue | Fix |
|---|---|
| `NUMERIC_PATTERN` missed "62 percent" (word form) | Added `\s*percent\b` to suffix group; `extractCoreNumeric` normalises "percent" → `%` |
| Negative grounded values stripped (-0.4 elasticity) | Added leading `-?` to regex; `buildGroundedValues` adds both signed and absolute forms |
| `_route_metadata.features` absent when no baseMetadata | Moved features computation outside `if (baseMetadata)` guard; fallback `else` branch attaches features-only metadata |
| Step 6 test silently skipped missing diagnostics | Replaced `warn-and-return` with `expect().toBeDefined()` assertions |
| Report in `Docs/` instead of `docs/` | Moved to `docs/dark-features-fix-report-2026-03-15.md` |

---

## 7. Files Changed

| File | Change |
|---|---|
| `src/orchestrator/tools/explain-results.ts` | `buildGroundedValues()`, updated `stripUngroundedNumerics()`, negative sign + "percent" support |
| `src/diagnostics/feature-health.ts` | **NEW** — startup feature health check |
| `src/server.ts` | Import and call `logFeatureHealth()` at startup |
| `src/orchestrator/prompt-zones/assemble.ts` | Track `empty_blocks` in `AssembledPrompt` |
| `src/orchestrator/turn-handler.ts` | Log empty blocks warning, enhanced zone2_assembly event |
| `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts` | Add `features` to `_route_metadata` (always present) |
| `src/orchestrator/pipeline/types.ts` | Add `features` to `RouteMetadata` interface |
| `tests/unit/orchestrator/tools/explain-results.test.ts` | 16 new tests for grounded-set stripping |
| `tests/staging/data-flow-verification.test.ts` | Step 6: feature activation check (strict assertions) |

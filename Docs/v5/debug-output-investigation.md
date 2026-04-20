# V5 Debug Output — Phase 0 Investigation

**Brief:** v5-debug-output-v1  
**Date:** 2026-04-20  
**Branch:** claude/v5-debug-output

---

## Q1 — Where is the debug bundle assembled?

**File:** `src/orchestrator-v5/context/context-pack-assembler.ts`  
**Function:** `assembleContextPackWithSummary()` at line 161  
**Return shape:**

```
AssembleContextPackResult {
  contextPack: ContextPack          // full ContextPack v2.0
  cqeSummary: CqeExtractionSummary  // extraction stats — Datadog-only today
}
```

`ContextPack` (line 92–116) includes `parsed_quantities: readonly QuantityExtractionResult[]` at line 114 — the full CQE result array is already present. What is **not** stored or queryable is `CqeExtractionSummary` (fields: `patterns_matched`, `timeout`, `compromise_match_count`, `duration_ms`, `message_too_long`, `word_range_missed`, `ambiguous_phrasing_detected`).

No `src/orchestrator-v5/debug/` directory exists. No per-turn debug store exists for V5. The CEE observability collector (`src/cee/observability/`) is separate — it tracks LLM calls and validation attempts inside the CEE pipeline, not V5 turn context.

---

## Q2 — Who calls it?

`src/orchestrator-v5/turn-executor.ts` calls `assembleContextPackWithSummary()` once per turn in the ORIENT step. The result is used immediately by `routeWithToolUse()`. `cqeSummaryForLog` is captured in a closure (line 215) and emitted to Datadog at turn end via `TelemetryEvents.CqeExtraction`. There is no admin route or on-demand access.

---

## Q3 — Is `parsed_quantities` already in the bundle output?

Yes. `ContextPack.parsed_quantities` (line 114 of assembler) contains the full `QuantityExtractionResult[]` array. It is **not** filtered or narrowed. The missing piece for test debugging is `CqeExtractionSummary`, which is a separate return value from the assembler and is currently Datadog-only.

Phase 1 creates a `TurnDebugStore` that captures both `parsed_quantities` and the `CqeExtractionSummary` fields in a single queryable entry.

---

## Q4 — Routing log JSONL location, rotation, retrieval

**Path:** `logs/v5-routing-logs.jsonl` (constant `DEFAULT_ROUTING_LOG_PATH` at `src/orchestrator-v5/routing/routing-log.ts:34`).  
**Rotation:** None. File is append-only; directory is created on first write via `mkdir(..., { recursive: true })`. No size cap, no TTL, no cleanup.  
**Retrieval today:** Write-only. No admin route, no query mechanism. Logs are described as "for offline evaluation" (spec §11).

---

## Q5 — Existing admin-route auth pattern

**Header:** `X-Admin-Key` (case-sensitive)  
**Verification:** `verifyAdminKey(request, reply, 'read')` from `src/middleware/admin-auth.ts:100`  
**Key sources:** `ADMIN_API_KEY` (write) and `ADMIN_API_KEY_READ` (read) env vars, defined in `src/config/index.ts`  
**Pattern in use:** Every existing admin route calls `if (!verifyAdminKey(request, reply, 'read')) return;` as first statement. Rate limiting follows via `@fastify/rate-limit`. Examples: `src/routes/admin.v1.llm-output.ts:34`, `src/routes/admin.testing.ts`.

---

## Q6 — Startup log integration point

**File:** `src/server.ts:243`  
**Logger:** Pino, exported as `log` from `src/utils/telemetry.ts:31`  
**Existing startup health log:**

```ts
log.info({
  event: 'config.startup_health',
  models: { orchestrator, draft, edit_graph, repair, decision_review },
  ...
}, 'Startup health summary');
```

This already logs 5 task models but omits the remaining 9 CeeTask values and does not surface resolution source. Phase 4 adds `logResolvedTaskModels()` called immediately after this line.

**Guard confirmed:** `isProduction()` at line 1125 checks `config.server.nodeEnv === "production"`. However, line 1152 documents that staging MAY run with `NODE_ENV=production` while using staging prompts. Therefore the debug store guard must **not** use `nodeEnv !== 'production'` — it must use a dedicated feature flag `CEE_TURN_DEBUG_ENABLED`, matching the `CEE_OBSERVABILITY_ENABLED` pattern (config key `observabilityEnabled`, `src/config/index.ts:469`).

---

## Q7 — Existing VERBOSE/TRACE/DEBUG env vars

| Variable | Location | Purpose |
|---|---|---|
| `LOG_LEVEL` | `src/server.ts:267`, `src/utils/telemetry.ts:31` | Pino log level |
| `CEE_DIAGNOSTIC_TRACE_ENABLED` | `src/server.ts:240` | Diagnostic trace (default: true in dev) |
| `PERF_TRACE` | `src/server.ts:432` | Performance tracing |
| `CEE_DEBUG_CATEGORY_TRACE` | `src/config/index.ts:868` | Category trace (CEE pipeline) |
| `CEE_DEBUG_LOGGING` | `src/config/index.ts:869` | Debug logging |
| `CEE_PROMPT_DEBUG_ENABLED` | `src/config/index.ts:871` | Prompt debug |
| `CEE_FIELD_SURVIVAL_TRACE` | `src/config/index.ts:873` | Field survival trace |

No `CQE_VERBOSE_TRACE` or `CQE_DEBUG` flag exists. No conflict. New flag follows the same boolean-string pattern as existing debug flags.

**Pattern for CQE_VERBOSE_TRACE:** Same as `CEE_OBSERVABILITY_ENABLED` — not coupled to `nodeEnv`. Staging must be able to enable it with `NODE_ENV=production`, so the feature flag, not nodeEnv, gates the behaviour.

---

## Additional Findings

### CEE_MODEL_* two-tier naming (Phase 4)

**Legacy tier** — `config.cee.models` (keyed via `TASK_TO_CONFIG_KEY` in `src/adapters/llm/router.ts:51`):

| CeeTask | Env var |
|---|---|
| `draft_graph` | `CEE_MODEL_DRAFT` |
| `suggest_options` | `CEE_MODEL_OPTIONS` |
| `repair_graph` | `CEE_MODEL_REPAIR` |
| `critique_graph` | `CEE_MODEL_CRITIQUE` |
| `decision_review` | `CEE_MODEL_DECISION_REVIEW` |
| `orchestrator` | `CEE_MODEL_ORCHESTRATOR` |
| `edit_graph` | `CEE_MODEL_EDIT_GRAPH` |

Note: `clarification`, `preflight`, `bias_check`, `evidence_helper`, `sensitivity_coach`, `explainer`, `options` are NOT in the legacy tier mapping.

**Task tier** — `config.cee.modelSelection.taskModels` (`src/config/index.ts:844`):

| CeeTask | Env var |
|---|---|
| `clarification` | `CEE_MODEL_TASK_CLARIFICATION` |
| `preflight` | `CEE_MODEL_TASK_PREFLIGHT` |
| `draft_graph` | `CEE_MODEL_TASK_DRAFT_GRAPH` |
| `bias_check` | `CEE_MODEL_TASK_BIAS_CHECK` |
| `evidence_helper` | `CEE_MODEL_TASK_EVIDENCE_HELPER` |
| `sensitivity_coach` | `CEE_MODEL_TASK_SENSITIVITY_COACH` |
| `options` | `CEE_MODEL_TASK_OPTIONS` |
| `explainer` | `CEE_MODEL_TASK_EXPLAINER` |
| `repair_graph` | `CEE_MODEL_TASK_REPAIR_GRAPH` |
| `critique_graph` | `CEE_MODEL_TASK_CRITIQUE_GRAPH` |

Phase 4 logger checks task tier first (`env_task_tier`), then legacy tier (`env_legacy_tier`), then `TASK_MODEL_DEFAULTS` (`code_default`).

### data/prompts.json

There is a pre-existing unstaged modification to `data/prompts.json` on the `staging` branch (carried forward from the previous working branch). This file is **not** part of this brief. It will not be staged or committed.

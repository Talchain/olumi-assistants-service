# V5 LLM call-site inventory

**Purpose:** Maintained list of every V5 LLM invocation path, its current task ID, and its live/unused status. Added in Group 3 (P1 follow-up) so future work preserves the precedence chain and cannot re-introduce the 20 April 2026 staging regression where an invalid task ID short-circuited the router to `llm_model_fallback` (gpt-4o-mini).

**Update rule:** any PR that adds, removes, moves, or changes the task ID of a V5 LLM call site MUST update this table. CI has no automated check for the list; maintenance is by convention.

**Last reviewed:** 2026-04-21 (v5-maintenance brief — verified accurate post v5-handler-surface).

**v5-handler-surface additions (2026-04-21):** three new dispatchers were added in `src/orchestrator-v5/handlers/` and `src/orchestrator-v5/system-events/`. None introduce a NEW V5-OWNED LLM call site:

- `dispatchSystemEvent` — no LLM calls (deterministic Layer 0).
- `dispatchDraftGraph` — calls into `handleDraftGraph` (V4 tool handler), which in turn invokes the unified pipeline's `draftAdapter.draftGraph(...)`. The unified pipeline's LLM usage is outside V5's direct call-site inventory scope; it's cataloged separately in the V4 tool-handler surface.
- `dispatchEditGraph` — calls `handleEditGraph(adapter=getAdapter('edit_graph'), ...)`. This is a ROUTED call but via the legacy `getAdapter` seam (same pattern as site #5 in the table). Classification: **ROUTED-NO-OBSERVABILITY**. Follow-up to migrate to `getAdapterWithResolution` tracked with site #5.
- `dispatchChipClickRunAnalysis` — invokes the registered `run_analysis` handler. Its enrichment step fires `enrichRunAnalysisWithDecisionReview` (same as site #5); no new call site.

## Inventory

| # | Site | File:line | Call | Task ID | Classification | Live in Phase | Notes |
|---|------|-----------|------|---------|----------------|---------------|-------|
| 1 | ORIENT (first) | [src/orchestrator-v5/routing/route-with-tool-use.ts:180](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L180) | `adapter.chatWithTools` | `orchestrator` | ROUTED | Phase 1+ | Tool-use routing. Resolves via `getAdapterWithResolution('orchestrator')`. Group 3 Task C fix — was `direct_answer_narrate` (not a `CeeTask`). |
| 2 | ORIENT (repair) | [src/orchestrator-v5/routing/route-with-tool-use.ts:211](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L211) | `adapter.chatWithTools` | `orchestrator` | ROUTED | Phase 1+ | Same adapter instance as #1 (REPAIR_ONCE). One resolution log entry per turn regardless of repair. |
| 3 | narrate | [src/orchestrator-v5/llm-adapter.ts:65](../../src/orchestrator-v5/llm-adapter.ts#L65) | `adapter.chat` | `explainer` | ROUTED | Not invoked in Phase 1 | Plumbed-but-unreachable. `routeWithToolUse` replaces it. If wired back in Phase 2, Paul should confirm `explainer` is the intended tier. |
| 4 | classify | [src/orchestrator-v5/classify.ts:128](../../src/orchestrator-v5/classify.ts#L128) | `adapter.chat` | `clarification` | ROUTED | Not invoked in Phase 1 | Plumbed-but-unreachable. `routeWithToolUse` replaces the classifier pattern. If wired back, Paul should confirm `clarification` is the intended tier. |
| 5 | decision_review (post-run_analysis) | [src/cee/decision-review/invoke.ts:153](../../src/cee/decision-review/invoke.ts#L153) | `adapter.chat` | `decision_review` | ROUTED-NO-OBSERVABILITY | Fires from V5 via `enrichRunAnalysisWithDecisionReview` | V4 code reused. Uses `getAdapter('decision_review')` — a valid `CeeTask` member, so the precedence chain IS correct, but the site predates the `getAdapterWithResolution` seam and therefore emits no `model_resolutions` telemetry entry. Migrate when Group 2's telemetry coverage is extended to enrichers (post-Group-3 follow-up). Not a Group 3 blocker. |

## Classification definitions

- **ROUTED** — uses `getAdapterWithResolution(task, ...)` with a valid `CeeTask` member (see `TASK_MODEL_DEFAULTS` in [src/config/model-routing.ts](../../src/config/model-routing.ts)). Emits a `model_resolutions` entry on turn-debug. Full observability.
- **ROUTED-NO-OBSERVABILITY** — uses the legacy `getAdapter(task, ...)` seam with a valid `CeeTask` member. The precedence chain is correct (per_call → store_model_config → env_var → task_default → providers_json → llm_model_fallback) so the right model is used, but the call site does NOT emit a `model_resolutions` entry because it predates the Group 2 observability seam. Safe, but opaque in turn-debug. Target for future migration as the observability coverage expands.
- **BYPASSING** — calls an adapter directly with either an invalid `CeeTask` string (short-circuits precedence to `llm_model_fallback`), a direct provider SDK, or a hardcoded model string. Currently zero sites — the Group 3 Task C fix brought the count to zero.
- **NOT-LLM** — grep false positive.

## How to verify there are zero BYPASSING sites

```
grep -rn "getAdapter\b\|getAdapterWithResolution\b\|\.chat\s*(\|\.chatWithTools\s*(" src/orchestrator-v5/
grep -rn "anthropic\.\|openai\." src/orchestrator-v5/
```

Each hit on the first line must map to a row in the inventory above. The second line should return no results inside `src/orchestrator-v5/` — V5 never talks to a provider SDK directly.

## Precedence chain (reference)

Resolved per `src/config/model-routing.ts` §Precedence. Highest priority first:

1. `per_call` — explicit `modelOverride` in request body
2. `store_model_config` — prompt-store override for this task + env (staging/production)
3. `env_var` — `CEE_MODEL_*` (e.g. `CEE_MODEL_ORCHESTRATOR=claude-sonnet-4-6`)
4. `task_default` — `TASK_MODEL_DEFAULTS[task]`
5. `providers_json` — `providers.json` task-override or default
6. `llm_model_fallback` — `LLM_PROVIDER`/`LLM_MODEL` env or adapter default

**Invariant:** If a V5 site passes a task ID that is NOT a `CeeTask` member, the router's `getDefaultModelForTask` returns `undefined`, the task-default branch is skipped, and precedence silently collapses to `llm_model_fallback`. This was the 20 April 2026 staging regression. The Group 3 tests at `tests/integration/orchestrate-v2-model-resolution.test.ts` assert the correct task ID is passed from site #1; keep that test green.

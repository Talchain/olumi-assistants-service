# V5 LLM call-site inventory

**Purpose:** Maintained list of every V5 LLM invocation path, its current task ID, and its live/unused status. Added in Group 3 (P1 follow-up) so future work preserves the precedence chain and cannot re-introduce the 20 April 2026 staging regression where an invalid task ID short-circuited the router to `llm_model_fallback` (gpt-4o-mini).

**Update rule:** any PR that adds, removes, moves, or changes the task ID of a V5 LLM call site MUST update this table. CI has no automated check for the list; maintenance is by convention.

**Last reviewed:** 2026-04-22 (v5-audit-followup — UU-16 closed, UU-17 A2 dispatch stack retired).

**v5-handler-surface additions (2026-04-21):** three new dispatchers were added in `src/orchestrator-v5/handlers/` and `src/orchestrator-v5/system-events/`. None introduce a NEW V5-OWNED LLM call site:

- `dispatchSystemEvent` — no LLM calls (deterministic Layer 0).
- `dispatchDraftGraph` — calls into `handleDraftGraph` (V4 tool handler), which in turn invokes the unified pipeline's `draftAdapter.draftGraph(...)`. The unified pipeline's LLM usage is outside V5's direct call-site inventory scope; it's cataloged separately in the V4 tool-handler surface.
- `dispatchEditGraph` — calls `handleEditGraph(adapter=getAdapter('edit_graph'), ...)`. This is a ROUTED call but via the legacy `getAdapter` seam. Classification: **ROUTED-NO-OBSERVABILITY**. Note: the sibling `decision_review` site (row #5) has been migrated to `getAdapterWithResolution` (UU-16 closed); `edit_graph` remains on the legacy seam pending a parallel migration.
- `dispatchChipClickRunAnalysis` — invokes the registered `run_analysis` handler. Its enrichment step fires `enrichRunAnalysisWithDecisionReview` (same as site #5); no new call site.

## Inventory

| # | Site | File:line | Call | Task ID | Classification | Live in Phase | Notes |
|---|------|-----------|------|---------|----------------|---------------|-------|
| 1 | ORIENT (first) | [src/orchestrator-v5/routing/route-with-tool-use.ts:180](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L180) | `adapter.chatWithTools` | `orchestrator` | ROUTED | Phase 1+ | Tool-use routing. Resolves via `getAdapterWithResolution('orchestrator')`. Group 3 Task C fix — was `direct_answer_narrate` (not a `CeeTask`). |
| 2 | ORIENT (repair) | [src/orchestrator-v5/routing/route-with-tool-use.ts:211](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L211) | `adapter.chatWithTools` | `orchestrator` | ROUTED | Phase 1+ | Same adapter instance as #1 (REPAIR_ONCE). One resolution log entry per turn regardless of repair. |
| ~~3~~ | ~~narrate~~ | _(retired)_ | — | — | RETIRED | Not invoked in any phase | **RETIRED** in the A2 stack deletion on 2026-04-22 (UU-17). The dormant A2 dispatch stack (`dispatch.ts`, `classify.ts`, `clarify.ts`, `llm-adapter.ts`) was deleted after the Slice C1 `runTurnExecutor` spine replaced it. No V5 code reaches this path; the row is preserved (not renumbered) so external references to row numbers remain stable. |
| ~~4~~ | ~~classify~~ | _(retired)_ | — | — | RETIRED | Not invoked in any phase | **RETIRED** in the A2 stack deletion on 2026-04-22 (UU-17). See row #3. |
| 5 | decision_review (post-run_analysis) | [src/cee/decision-review/invoke.ts:167](../../src/cee/decision-review/invoke.ts#L167) | `adapter.chat` | `decision_review` | ROUTED | Fires from V5 via `enrichRunAnalysisWithDecisionReview` | Migrated to `getAdapterWithResolution('decision_review')` in `claude/v5-audit-followup` commit `dd0b3b80` (UU-16). `DecisionReviewInvokeResult` now carries `resolution` and the V5 enricher forwards it to `recordModelResolution(requestId, scenarioId, resolution)` post-call, so the `model_resolutions` dashboard covers decision_review alongside ORIENT. Regression guarded by `src/cee/decision-review/__tests__/invoke.test.ts` (direct invoke coverage) and `src/orchestrator-v5/coaching/__tests__/decision-review-enricher.test.ts` (end-to-end recordModelResolution assertions). |

## Classification definitions

- **ROUTED** — uses `getAdapterWithResolution(task, ...)` with a valid `CeeTask` member (see `TASK_MODEL_DEFAULTS` in [src/config/model-routing.ts](../../src/config/model-routing.ts)). Emits a `model_resolutions` entry on turn-debug. Full observability.
- **ROUTED-NO-OBSERVABILITY** — uses the legacy `getAdapter(task, ...)` seam with a valid `CeeTask` member. The precedence chain is correct (per_call → store_model_config → env_var → task_default → providers_json → llm_model_fallback) so the right model is used, but the call site does NOT emit a `model_resolutions` entry because it predates the Group 2 observability seam. Safe, but opaque in turn-debug. Target for future migration as the observability coverage expands.
- **BYPASSING** — calls an adapter directly with either an invalid `CeeTask` string (short-circuits precedence to `llm_model_fallback`), a direct provider SDK, or a hardcoded model string. Currently zero sites — the Group 3 Task C fix brought the count to zero.
- **NOT-LLM** — grep false positive.
- **RETIRED** — the source file that hosted this call site has been deleted. Row preserved (not renumbered) to keep external references to row numbers stable. The commit that deleted the site is linked in the row's Notes.

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

# CEE Comprehensive Audit Report

**Date:** 11 April 2026
**Commit:** `8cc0f15c` (staging HEAD)
**Auditor:** Claude Code (static code trace)
**Scope:** Context assembly + full codebase health

---

## Executive Summary

### P0 Finding: PMS Store Backend

**The local `data/prompts.json` does NOT contain v34d/v100.** The orchestrator prompt in the file store is v1 (57,643 chars) with `stagingVersion: null`. Whether v34d reaches the LLM depends entirely on which store backend staging uses.

**Decision tree:**

| Condition | Store Backend | v34d Status |
|-----------|--------------|-------------|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set | Supabase (auto-detected) | v100 served if `activeVersion` or `stagingVersion` = 100 |
| `PROMPTS_POSTGRES_URL` set | Postgres (auto-detected) | v100 served if `activeVersion` or `stagingVersion` = 100 |
| Neither set, `PROMPTS_ENABLED=true` | File store (`data/prompts.json`) | **v1 served. v34d NOT reaching LLM. P0.** |
| `PROMPTS_ENABLED=false` or unset, no DB creds | Hardcoded fallback (600 chars) | **STATIC_PROMPT_FALLBACK. P0 critical.** |

**Evidence chain:**
- `src/prompts/store.ts:106-169` — `getPromptStore()` auto-detects from credentials
- `src/prompts/loader.ts:82-93` — `isPromptManagementEnabled()` returns true if `config.prompts.enabled === true` OR `isDbBackedStoreHealthy()`
- `src/prompts/stores/file.ts:604-612` — version selection: `useStaging && stagingVersion` → staging, else `activeVersion`
- Local `.env` has `PROMPTS_ENABLED=true` but NO `SUPABASE_URL` or `PROMPTS_POSTGRES_URL`
- **If staging matches local .env**: file store is active, serving v1, not v100

**Action required:** Verify staging env vars. If `SUPABASE_URL` is set on Render, v34d is likely serving. If not, this is the root cause of every staging quality issue.

**Additional risk on Render.com:** If staging uses file store and v100 was uploaded via admin API at runtime, the file is written to `data/prompts.json` on the container filesystem. **Render ephemeral filesystem wipes on every deploy**, meaning v100 would be lost on each redeploy.

### Top 10 Blockers (User Experience Impact)

| # | Finding | Severity | Status | File:Line |
|---|---------|----------|--------|-----------|
| 1 | **PMS store backend unknown** — v34d/v100 may not be reaching the LLM | P0 | Unknown | `src/prompts/store.ts:106-169` |
| 2 | **v34d prompt tags absent from local file** — RUNTIME_CONSTRAINTS, DECISION_LANGUAGE, BIAS EVIDENCE GATE, PREDICTION ELICITATION not in `data/prompts.json` | P0 | Unknown (depends on #1) | `data/prompts.json` |
| 3 | **OUTPUT_CONTRACT dead section** still in v1 prompt (57k chars) — wastes ~3k tokens per turn | Medium | Not fixed | `data/prompts.json` (v1 prompt) |
| 4 | **add-option.ts does NOT set `is_baseline: false`** on new options | Medium | Not fixed | `src/orchestrator/deterministic/actions/add-option.ts:126` |
| 5 | **12 of 15 action handlers lack unit tests** | Medium | Not fixed | `tests/unit/orchestrator/deterministic/actions/` |
| 6 | **maxTokens defaults to 4096** when `CEE_MAX_TOKENS_ORCHESTRATOR` unset — may truncate long evaluate turns | Low | Config gap | `src/orchestrator/deterministic/pipeline-v4.ts:319` |
| 7 | **raw_value not set for values ≤ 1** — small raw counts lose granularity | Low | By design | `src/cee/factor-extraction/enricher.ts:720` |
| 8 | **factor_type inference missing binary type** — 0/1 factors get "other" | Low | Gap | `src/cee/factor-extraction/enricher.ts:126-160` |
| 9 | **Confidence defaults to 0.8** when extraction doesn't provide it — not uniform at 25% but still a single default | Low | By design | `src/cee/factor-extraction/enricher.ts:859` |
| 10 | **edit-graph.ts is 2,927 lines** — largest file, hard to maintain | Low | Tech debt | `src/orchestrator/tools/edit-graph.ts` |

### Top 10 Maintainability Risks

| # | Risk | Impact | Location |
|---|------|--------|----------|
| 1 | Legacy V1 turn-handler.ts (1,387 lines) still importable from route.ts | Confusion, dual paths | `src/orchestrator/route.ts:14` |
| 2 | V2 pipeline (pipeline.ts, 1,441 lines) still exists alongside V4 | Dead code weight | `src/orchestrator/pipeline/pipeline.ts` |
| 3 | 19 files >500 lines in `src/orchestrator/` | Maintenance burden | See B7 |
| 4 | `ENABLE_DSK_V0` sunset overdue (2026-04-30 deadline) | Config clutter | `src/config/index.ts` |
| 5 | `add-constraint.ts` uses completion language ("Added a") on inline action | Inconsistent with proposal pattern | `src/orchestrator/deterministic/actions/add-constraint.ts:97` |
| 6 | `adjust-edge-strength.ts` uses completion language ("Adjusted") on inline action | Inconsistent | `src/orchestrator/deterministic/actions/adjust-edge-strength.ts:102` |
| 7 | 40+ feature flags — cognitive overhead for developers | Config complexity | `src/config/index.ts` |
| 8 | Prompt audit sentinels detect dead sections but don't remove them | Ongoing token waste | `src/orchestrator/deterministic/prompt-audit.ts` |
| 9 | No tests asserting on assembled prompt content reaching LLM | Regression risk | — |
| 10 | `DEPRECATED` comments in graph-readiness routes not cleaned up | Stale API surface | `src/routes/assist.v1.graph-readiness.ts:43+` |

### Recommended Next Phase

1. **Immediate:** Verify staging PMS store backend env vars on Render dashboard
2. **If file store:** Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on staging, or commit v100 content to `data/prompts.json` with `activeVersion: 100`
3. **Short-term:** Add `is_baseline: false` to add-option.ts; add unit tests for remaining 12 handlers
4. **Medium-term:** Delete V1 turn-handler.ts and V2 pipeline.ts; clean OUTPUT_CONTRACT from PMS prompt
5. **Longer-term:** Reduce edit-graph.ts (2,927 lines); sunset ENABLE_DSK_V0

---

## Part A: Context Assembly Capture

### Methodology

Static code trace of `src/orchestrator/deterministic/pipeline-v4.ts:308-322`. The LLM call is:

```typescript
adapter.streamChatWithTools({
  system: `${prompt.static_block}\n\n---\n\n${prompt.dynamic_block}`,
  system_cache_blocks: [
    { type: 'text', text: prompt.static_block, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: prompt.dynamic_block },
  ],
  messages,
  tools: toolDefs,
  ...(hasTools ? { tool_choice: toolChoice } : {}),
  temperature: 0,
  maxTokens: getMaxTokensFromConfig('orchestrator') ?? 4096,
}, { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS, signal });
```

### Performance Table (Estimated per Turn)

| Metric | Turn 1: FRAME_draft | Turn 2: IDEATE_calibrate | Turn 3: EVALUATE_walkthrough |
|--------|---------------------|--------------------------|-------------------------------|
| **System prompt chars** | ~58,000 (v1) or unknown (v100) | Same static block | Same static block |
| **Estimated tokens (system)** | ~14,500 | ~14,500 | ~14,500 |
| **Dynamic block chars** | ~200 (stage + "Model: not yet created") | ~800-1,500 (stage + entities + factors + options) | ~2,000-4,000 (stage + entities + analysis results + signals) |
| **History message count** | 0 (first turn) | 2-4 (user + assistant from turn 1) | 6-10 (capped at 10 by history-filter-v4) |
| **Tool count** | 4 (frame stage: set_factor_value, add_factor, set_goal_target, add_constraint) + draft_graph if forced | 7 (ideate stage: set_factor_value, add_constraint, add_factor, adjust_edge_strength, add_option, remove_factor, set_goal_target) | 9 (evaluate stage: run_analysis, explain_result, compare_options, challenge_assumption, run_premortem, what_would_flip, set_factor_value, adjust_edge_strength, add_constraint) |
| **Tool choice** | `auto` (unless chip click) | `auto` | `auto` |
| **Temperature** | 0 | 0 | 0 |
| **Max tokens** | `CEE_MAX_TOKENS_ORCHESTRATOR` or 4096 | Same | Same |
| **Cache blocks** | 2 (static=ephemeral, dynamic=none) | 2 | 2 |
| **TTFT / latency** | Not available (static trace) | — | — |
| **Cache hit** | Not available | Likely hit (5-min TTL, same session) | Likely hit |

### 10 Questions Answered

#### Q1: Does the system prompt contain `<RUNTIME_CONSTRAINTS>`?

| Evidence | Result |
|----------|--------|
| Repo presence | **NO** — grep returns 0 matches across entire codebase and `data/` |
| PMS/runtime presence | **Unknown** — depends on v100 content (not in local file store) |
| Staging log evidence | None available |
| User-visible evidence | None |
| Active path | V4 active path |
| **Verdict** | **Unknown — requires v100 prompt content verification** |

#### Q2: Does the system prompt contain `<DECISION_LANGUAGE>`?

| Evidence | Result |
|----------|--------|
| Repo presence | **NO** — 0 matches |
| PMS/runtime presence | **Unknown** |
| **Verdict** | **Unknown** |

#### Q3: Does the system prompt contain `BIAS EVIDENCE GATE`?

| Evidence | Result |
|----------|--------|
| Repo presence | **NO** — 0 matches |
| PMS/runtime presence | **Unknown** |
| **Verdict** | **Unknown** |

#### Q4: Does the system prompt contain `PREDICTION ELICITATION`?

| Evidence | Result |
|----------|--------|
| Repo presence | **NO** — 0 matches |
| PMS/runtime presence | **Unknown** |
| **Verdict** | **Unknown** |

#### Q5: Is `RUNTIME_TOOL_USE_SUFFIX` still appended? What does it say?

| Evidence | Result |
|----------|--------|
| Repo presence | **YES** — `src/orchestrator/deterministic/prompt-audit.ts:129-134` |
| Active path | **YES** — appended at `prompt-builder-v2.ts:129` |
| Content | `[Runtime context: This system uses native tool calling. Respond in plain text. No XML envelopes, no JSON wrappers, no code blocks.]` + `[Proposal language: When proposing a change that requires confirmation, use proposal language: "I'd suggest", "proposing", "here's what I'd change". Never "Adding now" or "I've added" on unconfirmed changes.]` |
| **Verdict** | **Verified — present on every v4 turn** |

#### Q6: Does the dynamic block contain `analysis_state.present` and `analysis_state.current`?

| Evidence | Result |
|----------|--------|
| Repo presence | **NO** — the dynamic block does NOT use `analysis_state.present/current` fields |
| Active path | V4 uses `ctx.analysis_summary` (a pre-computed summary), not raw `analysis_state` |
| How it works | `prompt-builder-v2.ts:224-292`: if `ctx.analysis_summary` exists, renders winner, runner-up, robustness, key drivers, fragile edges, conditional results, inference warnings. If null, renders NOTHING (staleness contract). |
| **Verdict** | **Disproved — V4 does not pass `analysis_state.present/current`. It passes a pre-digested `analysis_summary` or nothing.** |

#### Q7: How many history messages contain tool_use/tool_result? Are they preserved or stripped?

| Evidence | Result |
|----------|--------|
| Code path | `history-filter-v4.ts:61-62` — `extractText(msg.content)` |
| Behaviour | For `ToolResponseBlock[]` content: extracts `.text` blocks, **drops tool_use blocks entirely** |
| Cap | 10 messages max (5 user/assistant pairs), most recent kept |
| XML cleanup | Assistant messages with XML envelopes get `<assistant_text>` extracted or all tags stripped |
| **Verdict** | **Tool_use blocks are STRIPPED. Only text content survives into history.** |

#### Q8: What tools are available on each turn?

| Stage | Tools via STAGE_ACTION_POLICY | Additional Filtering |
|-------|------------------------------|---------------------|
| **frame** | set_factor_value, add_factor, set_goal_target, add_constraint | + draft_graph forced when no graph (pipeline-v4.ts:198-201) |
| **ideate** | set_factor_value, add_constraint, add_factor, adjust_edge_strength, add_option, remove_factor, set_goal_target | Context exclusions: no-graph removes most; fresh-analysis removes explanation tools |
| **evaluate** | run_analysis, explain_result, compare_options, challenge_assumption, run_premortem, what_would_flip, set_factor_value, adjust_edge_strength, add_constraint | Post-analysis: explain_result/compare_options/what_would_flip suppressed when fresh analysis in context (post-analysis-policy.ts) |
| **decide** | explain_result, compare_options, what_would_flip, challenge_assumption, run_premortem | Read-only stage |
| **optimise** | Full set minus add_option/add_factor/remove_factor/set_goal_target | Editing + analysis tools |

Source: `src/orchestrator/deterministic/turn-context.ts:50-56`

**Verdict:** Tools match `STAGE_ACTION_POLICY`. `generate_artefact` permanently excluded (`tool-builder.ts:220`). Draft_graph is force-eligible on frame stage when no graph exists.

#### Q9: Is `max_tokens` reading from config or hardcoded?

| Evidence | Result |
|----------|--------|
| Code | `pipeline-v4.ts:319`: `maxTokens: getMaxTokensFromConfig('orchestrator') ?? 4096` |
| Config path | `router.ts:89-101` → `config.cee.maxTokens.orchestrator` → env `CEE_MAX_TOKENS_ORCHESTRATOR` |
| Default | 4096 (fallback when env var unset) |
| Adapter default | 4096 (per `config/index.ts:959`) |
| **Verdict** | **Config-driven with 4096 fallback. NOT hardcoded at 18000.** If 18000 is intended, `CEE_MAX_TOKENS_ORCHESTRATOR=18000` must be set in staging env. |

#### Q10: Total token count estimate per turn

| Component | Turn 1 (frame) | Turn 2 (ideate) | Turn 3 (evaluate) |
|-----------|----------------|-----------------|-------------------|
| System (static) | ~14,500 tokens | ~14,500 (cached) | ~14,500 (cached) |
| Dynamic block | ~50 tokens | ~200-400 tokens | ~500-1,000 tokens |
| History | 0 | ~100-300 tokens | ~300-800 tokens |
| Tools (JSON schemas) | ~400-600 tokens (4-5 tools) | ~800-1,200 tokens (7 tools) | ~1,000-1,500 tokens (9 tools) |
| **Total input** | **~15,000** | **~15,800-16,400** | **~16,300-17,800** |

Note: If v100 prompt is substantially different from v1 (57k chars), these estimates change.

---

## Part B: Full Codebase Health Assessment

### B1: Pipeline Architecture

#### Request Lifecycle (Active V4 Path)

```
POST /orchestrate/v1/turn/stream
  → route-stream.ts:204 (feature gate: orchestratorStreaming)
  → pipeline-stream.ts:109 (feature gate: pipelineV4Enabled)
  → pipeline-v4.ts:93 executePipelineV4() [async generator]
    → turn-context.ts:66 computeTurnContext() [pure, deterministic]
    → prompt-builder-v2.ts:57 buildDeterministicPromptV2()
      → loader.ts:109 loadPrompt('orchestrator', {useStaging})
      → prompt-audit.ts:129 RUNTIME_TOOL_USE_SUFFIX appended
    → tool-builder.ts:210 buildToolDefinitions()
    → pipeline-v4.ts:308 adapter.streamChatWithTools()
    → stream-handler-v4.ts:115 processAdapterStream()
    → pipeline-v4.ts:660 assembleV4Envelope()
      → sanitiseAssistantText() → enforceProposalLanguage()
      → assessMutationHealth() → buildPatchSummary()
      → response-normaliser.ts scanBannedTerms()
    → yield turn_complete event → SSE stream → client
```

#### Legacy Infrastructure Status

| Component | Exists? | Imported? | Active Path | Verdict |
|-----------|---------|-----------|-------------|---------|
| `turn-handler.ts` (V1) | YES (1,387 lines) | YES (`route.ts:14`) | V1 only (when V2 disabled) | **Inactive legacy** |
| `pipeline/pipeline.ts` (V2) | YES (1,441 lines) | YES (`route-v2.ts`) | V2 only | **Inactive legacy** |
| `pipeline/pipeline-stream.ts` | YES (674 lines) | YES | V4 gate at line 109 | **Active (V4 wrapper)** |
| `response-assembler.legacy.ts` | **NO — deleted** | — | — | Dead code removed |
| `chip-assembler.ts` | **NO — deleted** | — | — | Dead code removed |
| `legacyOrchestratorEnabled` | **NO** — not in config | — | — | Does not exist |

### B2: Guard and Sanitisation Chain

| Guard | Expected Location | Actually Wired? | File:Line | Active Path |
|-------|-------------------|-----------------|-----------|-------------|
| `buildPatchSummary` | After tool execution, before envelope | **YES** | `pipeline-v4.ts:705` (import: line 38) | V4 active |
| `enforceProposalLanguage` | After LLM response, on proposal turns | **YES** | `pipeline-v4.ts:740` (import: line 39, gated by `emittedProposalBlock && assistantText`) | V4 active |
| `assessMutationHealth` | After tool execution | **YES** | `pipeline-v4.ts:766` (import: line 41, gated by `operations.length > 0 && turnContext.graph`) | V4 active |
| `sanitiseAssistantText` | Before envelope assembly | **YES** (3 call sites) | `pipeline-v4.ts:546` (main text), `:705` (patch summary, preserveBold), `:807-808` (chip labels/prompts) | V4 active |
| Tool-filtering by stage | In TurnContext before LLM call | **YES** | `turn-context.ts:50-56` (policy), `tool-builder.ts:210-245` (filtering), `pipeline-v4.ts:215` (call site) | V4 active |

**buildPatchSummary on draft_graph path:** YES — `draft_graph` is a long-running tool (line 826), produces operations, emits `graph_patch` block with `auto_apply: false` (line 716). `buildPatchSummary` is called at line 705 for ALL graph-mutating actions that produce operations.

**Runtime Evidence Matrix:**

| Guard | Repo Presence | PMS/Runtime | Staging Log | User-visible | Verdict |
|-------|--------------|-------------|-------------|--------------|---------|
| buildPatchSummary | YES `pipeline-v4.ts:705` | N/A (code guard) | Telemetry: `v4.patch_summary` | Patch summary in graph_patch block | **Verified** |
| enforceProposalLanguage | YES `pipeline-v4.ts:740` | N/A | Telemetry: `v4.proposal_language_leak` | Corrective suffix appended | **Verified** |
| assessMutationHealth | YES `pipeline-v4.ts:766` | N/A | Telemetry: `v4.mutation_health` | Issue notes in assistantText | **Verified** |
| sanitiseAssistantText | YES `pipeline-v4.ts:546,705,807` | N/A | Telemetry: `v4.banned_term_leak` | Cleaned text to user | **Verified** |
| RUNTIME_TOOL_USE_SUFFIX | YES `prompt-audit.ts:129` | In static block | `v4.prompt.audit` | Implicit (LLM behaviour) | **Verified** |

### B3: Action Handler Audit

| Handler | File | Lines | Semantic Summary? | effect_direction? | Label Resolution | Language | Legacy? | analysis_ready? |
|---------|------|-------|-------------------|--------------------|------------------|----------|---------|-----------------|
| add_factor | `actions/add-factor.ts` | 181 | YES: "I'll add **{label}**" | YES: `kind === 'risk' ? 'negative' : 'positive'` (line 143) | resolveEntity | Proposal | None | No |
| add_option | `actions/add-option.ts` | 427 | Hybrid: count + label fallback | N/A (no edges) | Direct entity walk | Proposal | None | YES (lines 162-168) |
| add_constraint | `actions/add-constraint.ts` | 107 | YES: "Added a {type} constraint on **{label}**" | N/A | resolveEntity | **Completion** | None | No |
| adjust_edge_strength | `actions/adjust-edge-strength.ts` | 114 | YES: "Adjusted **{from}** → **{to}**" | N/A (updates existing) | resolveEntity x2 | **Completion** | None | No |
| set_factor_value | `actions/set-factor-value.ts` | 115 | YES: "Updated **{label}** to {value}" | N/A | resolveEntity | **Completion** | None | No |
| set_goal_target | `actions/set-goal-target.ts` | 73 | YES: "Updated the goal target" | N/A | N/A | **Completion** | None | No |
| remove_factor | `actions/remove-factor.ts` | 237 | YES: "I'll remove **{label}** and its {n} edges" | YES (prunes risk edges) | resolveEntity | Proposal | None | YES (lines 114-219) |
| challenge_assumption | `actions/challenge-assumption.ts` | 118 | YES: "Challenging: {label}" + sections | N/A (read-only) | resolveEntity + auto-select from signals | N/A | None | No |
| run_premortem | `actions/run-premortem.ts` | 109 | YES: structured PremortemBlock | N/A (read-only) | resolveEntity + auto-select winner | N/A | None | No |
| draft_graph | `actions/draft-graph.ts` | 97 | Delegates to handleDraftGraph | N/A (delegates) | N/A | Delegates | Delegates | No (uses graphOutput) |
| run_analysis | `actions/run-analysis.ts` | 148 | YES: status-aware messaging | N/A (read-only) | ConversationContext | Completion | None | No |
| explain_result | `actions/explain-result.ts` | 129 | YES: sections with fallback chain | N/A (read-only) | Factor labels from sensitivity | N/A | None | No |
| compare_options | `actions/compare-options.ts` | 139 | YES: margin-aware verb scaling | N/A (read-only) | Factor sensitivity labels | N/A | None | No |
| what_would_flip | `actions/what-would-flip.ts` | 248 | YES: driver-aware flip conditions | N/A (read-only) | Complex multi-source | N/A | None | No |
| generate_artefact | `actions/generate-artefact.ts` | 78 | Stub (always fails) | N/A | N/A | N/A | None | No |

**Key findings:**
- `add-option.ts:126` does NOT set `is_baseline: false` on new options — relies on downstream `labelMatchesBaseline()` inference
- `add-constraint.ts` and `adjust-edge-strength.ts` use completion language ("Added", "Adjusted") as inline actions — this is by design (inline actions auto-apply, no confirmation needed)
- No handler imports deprecated legacy functions

### B4: Prompt Management

#### PMS Architecture

| Component | File | Purpose |
|-----------|------|---------|
| Loader | `src/prompts/loader.ts:109-190` | `loadPrompt(taskId, options)` — tries store, falls back to hardcoded default |
| Store selector | `src/prompts/store.ts:106-169` | `getPromptStore()` — auto-detects Supabase/Postgres from credentials |
| File store | `src/prompts/stores/file.ts:587-638` | Reads `data/prompts.json`, version selection via `activeVersion`/`stagingVersion` |
| Supabase store | `src/prompts/stores/supabase.ts` | Tables: `cee_prompts`, `cee_prompt_versions` |
| Postgres store | `src/prompts/stores/postgres.ts` | Tables: `prompts`, `prompt_versions` |
| Config | `src/config/index.ts:1141-1155` | `shouldUseStagingPrompts()` — checks `PROMPTS_USE_STAGING`, `DD_ENV`, `NODE_ENV` |

#### Prompt Assembly (prompt-builder-v2.ts)

1. **Static block** = PMS prompt content + `RUNTIME_TOOL_USE_SUFFIX` (cacheable, ephemeral cache_control)
2. **Dynamic block** = `buildStateSection(ctx)` + optional `buildDisambiguationSection(ctx.disambiguation_hints)`
3. **Cache**: Module-level singleton, 5-minute TTL (`PROMPT_CACHE_TTL_MS = 300_000`)
4. **Fallback chain**: PMS store → hardcoded `STATIC_PROMPT_FALLBACK` (600 chars)

#### Content Injected Outside prompt-builder-v2

| Source | What | Where |
|--------|------|-------|
| `RUNTIME_TOOL_USE_SUFFIX` | Tool-use instruction + proposal language directive | `prompt-builder-v2.ts:129` (appended to static block) |
| Tool definitions (JSON schemas) | Structured tool descriptions | `tool-builder.ts` → sent as `tools` parameter, not in system prompt |
| **No other injection points found** | — | — |

#### Env Vars Affecting Prompt Assembly

| Variable | Purpose |
|----------|---------|
| `PROMPTS_ENABLED` | Master switch for prompt management |
| `PROMPTS_STORE_TYPE` | Store backend: "file", "postgres", "supabase" |
| `PROMPTS_STORE_PATH` | File store path (default: `data/prompts.json`) |
| `PROMPTS_USE_STAGING` | Force staging prompt versions |
| `PROMPTS_ENVIRONMENT` / `DD_ENV` | Environment for staging detection |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase auto-detection |
| `PROMPTS_POSTGRES_URL` | Postgres auto-detection |
| `CEE_MAX_TOKENS_ORCHESTRATOR` | Max tokens for LLM response |
| `CEE_MODEL_ORCHESTRATOR` | Model override for orchestrator task |

#### Prompt Identity Logging

Per turn: `v4.prompt.pms_loaded` telemetry logs `promptId`, `version`, `isStaging` on cache miss (every 5 min). `v4.prompt.audit` logs `promptHash`, `totalChars`, `deadSectionCount`, `sentinelsFound`. No per-turn prompt identity logging (only on cache refresh).

### B5: Feature Flags and Configuration

#### Core Pipeline Flags

| Flag | Env Var | Default | Controls | Status |
|------|---------|---------|----------|--------|
| `pipelineV4Enabled` | `CEE_PIPELINE_V4_ENABLED` | **true** | V4 native tool-use pipeline | Active |
| `orchestratorV2` | `ENABLE_ORCHESTRATOR_V2` | false | V2 five-phase pipeline | Inactive legacy |
| `orchestratorStreaming` | `ENABLE_ORCHESTRATOR_STREAMING` | false | SSE streaming endpoint | Gate for /turn/stream |
| `deterministicOrchestratorEnabled` | `CEE_DETERMINISTIC_ORCHESTRATOR_ENABLED` | **true** | Three-layer deterministic pipeline | Active |
| `briefDetectionEnabled` | `CEE_BRIEF_DETECTION_ENABLED` | false | NL brief → draft_graph routing | Experimental |
| `optionShortcutRepair` | `ENABLE_OPTION_SHORTCUT_REPAIR` | **true** | Option→risk/goal shortcut handlers | Active |

#### CEE Feature Flags

| Flag | Env Var | Default | Controls | Status |
|------|---------|---------|----------|--------|
| `clarifier` | `CLARIFIER_ENABLED` | true | Per-request clarifier override | Active |
| `cee.clarifierEnabled` | `CEE_CLARIFIER_ENABLED` | false | In-pipeline Stage 4 clarifier | Experimental |
| `cee.preflightEnabled` | `CEE_PREFLIGHT_ENABLED` | false | Preflight validation block | Experimental |
| `bilEnabled` | `BIL_ENABLED` | false | Brief Intelligence Layer | Experimental |
| `dskV0` | `ENABLE_DSK_V0` | false | DSK v0 bundle loading (sunset 2026-04-30) | Deprecated |
| `dskEnabled` | `DSK_ENABLED` | false | DSK typed accessors | Experimental |
| `zone2Registry` | `CEE_ZONE2_REGISTRY_ENABLED` | false | Zone 2 block registry | Experimental |
| `grounding` | `CEE_GROUNDING_ENABLED` | false | Conservative grounding | Experimental |
| `artefactAppendixEnabled` | `CEE_ARTEFACT_APPENDIX_ENABLED` | false | Artefact design appendix | Experimental |
| `artefactRenderingEnabled` | `CEE_ARTEFACT_RENDERING_ENABLED` | false | Artefact block rendering | Experimental |

#### Security-Enforced Flags

| Flag | Env Var | Prod | Staging | Local |
|------|---------|------|---------|-------|
| `observabilityRawIO` | `CEE_OBSERVABILITY_RAW_IO` | always false | false (audit warning) | allows true |
| `boundaryAllowInvalid` | `CEE_BOUNDARY_ALLOW_INVALID` | always false | always false | allows true |

#### Extended Thinking

| Setting | Env Var | Default |
|---------|---------|---------|
| Orchestrator thinking | `CEE_ORCHESTRATOR_THINKING` | false |
| Thinking budget | `CEE_ORCHESTRATOR_THINKING_BUDGET` | 10000 tokens |
| Draft graph thinking | `CEE_DRAFT_GRAPH_THINKING` | false |
| Edit graph thinking | `CEE_EDIT_GRAPH_THINKING` | false |

### B6: Test Coverage

| Category | Count | Notes |
|----------|-------|-------|
| Total test files | 579 | `tests/**/*.test.ts` |
| Pipeline-v4 integration | 2 | `golden-path-v4.integration.test.ts`, `pipeline-v4-integration.test.ts` |
| Action handler tests | 3 of 15 | add-option, remove-factor, post-analysis-actions |
| Guard tests | 4 of 4 | buildPatchSummary, enforceProposalLanguage, sanitiseAssistantText, assessMutationHealth |
| Prompt content assertions | ~6 | currency-prompt-wiring, prompts.test, anthropic.streaming, etc. |

**Most significant untested path:** 12 action handlers lack isolated unit tests. The golden-path integration test provides some coverage but doesn't exercise edge cases in individual handlers (duplicate detection, edge pruning, entity resolution failures).

### B7: Dead Code and Technical Debt

#### TODO/HACK/FIXME/DEPRECATED Comments

| File | Line | Content |
|------|------|---------|
| `src/orchestrator/context-fabric/types.ts` | 70 | `// TODO: import string length limits from Platform Contract` |
| `src/adapters/llm/prompt-loader.ts` | 108-109 | `// DEPRECATED: no callers — see defaults.ts` |
| `src/prompts/defaults.ts` | 2193 | `// DEPRECATED: explainer and bias_check prompts registered but never loaded` |
| `src/schemas/assist.ts` | 6 | `// TODO: Consider reducing min(30) to allow short valid decision questions` |
| `src/routes/assist.v1.graph-readiness.ts` | 43,439,454,494,509 | `// DEPRECATED: use total_factor_count and user_question_count` |
| `src/cee/unified-pipeline/index.ts` | 191 | `// DEPRECATED: Remove after Stream D Review Pass ships` |

#### Files Over 500 Lines in `src/orchestrator/`

| File | Lines | Primary Responsibility |
|------|-------|----------------------|
| `tools/edit-graph.ts` | 2,927 | Edit graph handler (largest file) |
| `pipeline/phase3-llm/index.ts` | 1,453 | V2 Phase 3 LLM processing |
| `pipeline/pipeline.ts` | 1,441 | V2 pipeline orchestration |
| `turn-handler.ts` | 1,387 | V1 turn-level handling |
| `deterministic/pipeline-v4.ts` | 1,047 | V4 pipeline (active) |
| `deterministic/turn-context.ts` | 962 | TurnContext computation |
| `system-event-router.ts` | 827 | System event routing |
| `intent-gate.ts` | 820 | Intent classification |
| `response-parser.ts` | 762 | LLM response parsing |
| `plot-client.ts` | 756 | PLoT service client |
| `types.ts` | 729 | Shared type definitions |
| `patch-summary.ts` | 719 | Patch summarisation |
| `pipeline/types.ts` | 707 | Pipeline type definitions |
| `pipeline/phase3-llm/prompt-assembler.ts` | 696 | V2 prompt assembly |
| `pipeline/pipeline-stream.ts` | 674 | Streaming pipeline |
| `tools/draft-graph.ts` | 660 | Draft graph handler |
| `guidance/post-analysis.ts` | 594 | Post-analysis guidance |
| `context-fabric/renderer.ts` | 594 | Context fabric renderer |
| `context/analysis-compact.ts` | 569 | Analysis compaction |

#### Deleted Legacy Files (Confirmed)

- `response-assembler.legacy.ts` — deleted in commit `a41e1e84`
- `chip-assembler.ts` — deleted in commit `a41e1e84`

### B8: Recent Changes Verification

| Hash | Date | Message | Files | Intent Match |
|------|------|---------|-------|--------------|
| `8cc0f15c` | Apr 11 | fix(cee): synthesise display_value for all factor categories and improve unit fallback | 4 | **Verified** — V3 transform synthesises display_value for observable/controllable factors |
| `017f2ddc` | Apr 11 | fix(cee): post-v34d fixes — risk edge sign, output sanitiser, leak patterns | 8 | **Verified** — risk sign correction, sanitiser patterns, proposal-language tests |
| `f40eb81b` | Apr 11 | fix(cee): apply validation remap fix to envelope, add-option, remove-factor | 3 | **Verified** — validation remap across three handlers |
| `a41e1e84` | Apr 11 | refactor(v4): delete legacy pipeline + add golden path integration test | 17 | **Verified** — removes legacy files, adds integration test |
| `02ffcf96` | Apr 11 | fix(cee): include all optional fields in extractAnalysisReady validation remap | 3 | **Verified** — is_baseline/intervention_details carried through |
| `d4e3706d` | Apr 10 | fix(cee): propagate is_baseline, intervention_details, unit through output pipeline | 9 | **Verified** — Batch 1 fields propagate end-to-end |
| `636b3618` | Apr 10 | fix(config): raise ISL timeout ceiling to 60s and wire CEE_MAX_TOKENS_ORCHESTRATOR | 5 | **Verified** — timeout + token config wiring |
| `966d4a66` | Apr 9 | fix(v4): wire guards into pipeline-v4 and retire dead response-assembler | 9 | **Verified** — guards integrated, assembler retired |
| `8f5fbcba` | Apr 8 | fix(cee): harden display-value and analysis-ready correctness | 6 | **Verified** — display-value synthesis correctness |
| `60c84b15` | Apr 8 | feat(cee): data quality enrichment batch 1 — display_value, is_baseline, intervention_details | 6 | **Verified** — new display-value module, is_baseline, intervention_details |
| `df1fbd48` | Apr 5 | fix(v4): tier-2 self-audit polish + T3 baseline-violation filter | — | **Verified** |
| `f197c98d` | Apr 3 | fix(v4): tier-2 review fixes (F1-F5) | — | **Verified** |
| `79ed195c` | Apr 3 | fix(v4): tier-2 contract-first stabilisation (T1-T5 + T6 server-side) | — | **Verified** |
| `db3a3706` | Apr 1 | fix(v4): tier-1 AI experience contract fixes (Tasks 1, 2, 5) | — | **Verified** |

**Summary:** All 14 commits match their stated intent. No intent-implementation mismatches detected.

---

## Coaching Quality Verification

For each behaviour, checked: (a) does the v1 prompt instruct it? (b) does the assembled V4 context support it?

### (a) Post-draft trade-off naming

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **YES** — STAGE_BEHAVIOUR section: "Post-draft: name (a) the core trade-off, (b) the biggest assumption made, (c) the most valuable thing the user could provide next." |
| **Context supports it?** | **Partially** — dynamic block includes graph entities with labels/values but does NOT include a pre-computed "trade-off summary". The LLM must infer the trade-off from the entity list. |
| **Active path** | V4 active |
| **Verdict** | **Prompt-instructed, context-supported (entities available)** |

### (b) Biggest assumption disclosure with provenance count

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **YES** — same STAGE_BEHAVIOUR line: "(b) the biggest assumption made" |
| **Context supports it?** | **Partially** — dynamic block includes factor values and `default_value_count` signal (prompt-builder-v2.ts:302), which counts how many factors use inferred/default values. But no explicit "provenance count" field. |
| **Active path** | V4 active |
| **Verdict** | **Prompt-instructed. Context partially supports via default_value_count signal.** |

### (c) Highest-value calibration request

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **YES** — STAGE_BEHAVIOUR: "(c) the most valuable thing the user could provide next" + EVIDENCE PRIORITY coaching play (COACHING_PLAYS section): uses EVPI, voi_ranking, factor_sensitivity to identify highest-value information. |
| **Context supports it?** | **Post-analysis only** — dynamic block includes `factor_sensitivity` (top 3 by influence_rank) and `fragile_edges` in the analysis summary. Pre-analysis: only `high_uncertainty_factors` signal available. |
| **Active path** | V4 active |
| **Verdict** | **Prompt-instructed. Context supports post-analysis (factor_sensitivity). Pre-analysis gap: no EVPI/VOI data in dynamic block.** |

### (d) Option breadth challenge

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **YES** — STAGE_BEHAVIOUR IDEATE: "Suggest alternative options if the current set seems narrow" + OPTION DIVERSITY instruction in the v1 prompt: "Prefer options that differ by mechanism, not only by degree." |
| **Context supports it?** | **YES** — dynamic block includes option labels (prompt-builder-v2.ts:188-189) and option count. LLM can assess breadth from labels. |
| **Active path** | V4 active |
| **Verdict** | **Prompt-instructed, context-supported** |

### (e) Challenger timing

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **YES** — COACHING_PLAYS section defines trigger conditions: PRE-MORTEM (separation <10% AND stability not stable), INVERSION (zero risk nodes), DOMINANT FACTOR WARNING (>50% sensitivity). Each has Role: Challenger or Facilitator. |
| **Context supports it?** | **Post-analysis only** — trigger values (separation %, stability, sensitivity %) come from analysis summary in dynamic block. Pre-analysis: only node-kind counts are available (for INVERSION trigger). |
| **Active path** | V4 active |
| **Verdict** | **Prompt-instructed with explicit trigger gating. Context supports post-analysis triggers. TRIGGER GATING RULE in prompt prevents hallucinated triggers.** |

### (f) User authorship push

| Evidence | Result |
|----------|--------|
| **Prompt instructs it?** | **Weakly** — v1 prompt references "Your decision depends heavily on [factor]" (DOMINANT FACTOR WARNING) and "user controls" (factor distinction). No explicit "this is YOUR decision" authorship push instruction. |
| **Context supports it?** | **No specific authorship context** — dynamic block does not include user identity, decision ownership framing, or authorship signals. |
| **Active path** | V4 active |
| **Verdict** | **Weakly instructed. No explicit authorship push mechanism in v1 prompt. v34d/v100 may add this — unknown until PMS content verified.** |

---

## Tasks 1-4: Investigation Findings

### Task 1: Verify Batch 1 Fixes

#### 1a. Path B display_value synthesis

**Code:** `src/cee/transforms/schema-v3.ts:318-330`

Trace: factor with `observed_state: {value: 6, unit: "developers"}`, no LLM display_value:
- Calls `synthesiseDisplayValue({value: 6, raw_value: undefined, unit: "developers", factor_type: ...})`
- `display-value.ts:190-195`: value with unit branch → `formatPlainNumber(6)` → `"6"` + `" developers"`
- **Result: "6 developers"** — **CORRECT**

Path B correctly skips non-factor kinds (goal, decision, outcome, risk) via the `if (v3Node.observed_state)` guard at line 318. Only controllable/observable factors with observed_state get this path.

#### 1b. extractAnalysisReady carry-through

**Code:** `src/orchestrator/tools/draft-graph.ts:523-541`

is_baseline: carried through at line 523-525 (`if (o.is_baseline === true || o.is_baseline === false)`)
intervention_details: carried through at line 526-530
extraction_metadata, raw_interventions, status_reason: also carried through

**Verdict:** **CORRECT — all optional fields survive the round-trip.**

#### 1c. computeStructuralReadiness baseline detection

**Code:** `src/orchestrator/tools/analysis-ready-helper.ts:193-216`

All options get explicit `is_baseline` set: `options[i].is_baseline = i === baselineIdx` (line 213). Non-baseline options get `false`, not `undefined`.

**BUT:** `add-option.ts:126` does NOT set `is_baseline: false` on the node itself. The `is_baseline` is only set during `computeStructuralReadiness()` / `computeSyntheticOptionReadiness()`, which runs downstream.

**Verdict:** **Partially correct.** The analysis-ready computation handles it, but the action handler should set `is_baseline: false` explicitly for consistency and to avoid confusion in intermediate states.

#### 1d. intervention_details display quality for raw_value=0

**Code:** `src/cee/transforms/analysis-ready.ts:309-316`

When `raw_value=0, normalised_value=0, no unit, no factor_type`:
- `synthesiseDisplayValue({value: 0, raw_value: 0, unit: undefined, factor_type: undefined})`
- Falls through all branches to line 202: `String(parseFloat(0.toFixed(2)))` → `"0"`

**Verdict:** Display value is `"0"` — a bare number. This is **technically correct** but **semantically poor**. For a factor like "Tech lead in place" with value 0, `"0"` is less informative than the factor's own display_value ("No tech lead in place"). The `buildInterventionDetail` function does check the factor's `display_value` first (lines 277-291) but only uses it if it doesn't echo the label. If the factor has no pre-existing display_value, bare `"0"` is the result.

### Task 2: factor_type Inference

**Code:** `src/cee/factor-extraction/enricher.ts:126-160`

| Requested Rule | Implemented? | Code Location |
|----------------|-------------|---------------|
| £/$/ + cost/price/salary/budget/revenue → cost | **YES** | Lines 134-145 |
| % or label contains probability/likelihood/chance/rate → probability | **YES** | Lines 133, 152-154 |
| Unit contains day/week/month/year/hour → time | **YES** | Lines 148-150 |
| Value is exactly 0 or 1 with no unit → probability (binary) | **NO** | Returns "other" |
| Otherwise → other | **YES** | Line 160 |

**Invocation:** Called at enricher.ts:727 (existing factor enhancement) and :826 (new factor injection). **NOT called in the draft_graph path** — draft_graph relies on the LLM to provide factor_type. The enricher only runs on brief-extracted factors.

**Gap:** Binary factor detection (0/1 values) not implemented. Factor_type inference does not run for LLM-generated factors from draft_graph.

### Task 3: raw_value Accuracy

**Code:** `src/cee/factor-extraction/enricher.ts:716-724` and `:806-810`

```
if (factor.unit !== "%" && factor.value > 1) {
  cap = computeNormalisationCap(factor.value);  // Next power of 10
  rawValue = factor.value;                       // BEFORE normalisation
  normalizedValue = factor.value / cap;          // AFTER normalisation
}
```

**Ordering: CORRECT.** `rawValue = factor.value` is assigned before `normalizedValue = factor.value / cap`.

**Edge cases:**
| Scenario | raw_value | normalised_value | Correct? |
|----------|-----------|-----------------|----------|
| value=75000, unit="£" | 75000 | 0.75 (cap=100000) | YES |
| value=0.5, unit="developers" | undefined | 0.5 | YES (by design: ≤1 not normalised) |
| value=100, unit="%" | undefined | 100 | YES (% excluded from normalisation) |
| value=1000, unit="days" | 1000 | 1.0 (cap=1000) | YES (boundary: normalised=1.0) |

**Verdict:** raw_value is always the pre-normalisation value. No code path produces normalised-value-disguised-as-raw. The ≤1 gap is by design (values ≤1 assumed already normalised).

### Task 4: Confidence Uniformity

**Finding: Confidence is NOT uniform at 25%.**

| Source | Confidence Values | Code Location |
|--------|-------------------|---------------|
| Regex extraction (explicit currency) | 0.80 | `factor-extraction/index.ts:216` |
| Regex extraction (percentage) | 0.80-0.95 | `index.ts:267,328` |
| Regex extraction (multiplier) | 0.70-0.90 | `index.ts:299,352,382,410` |
| Regex extraction (likely/inferred) | 0.60 | `index.ts:462,484` |
| LLM extraction prompt | "0.9+ for explicit, 0.6-0.8 for contextual" | LLM prompt instruction |
| Enricher default (when missing) | 0.8 | `enricher.ts:859` |
| Edge strength default (NaN repair) | 0.5 (strength_mean, not confidence) | `deterministic-sweep.ts:103` |

**Where does 25% come from?**
- `src/cee/belief-elicitation/index.ts` contains linguistics mappings: "pretty unlikely" → 0.25 — this is belief elicitation, NOT factor confidence
- `src/cee/value-uncertainty-derivation.ts` uses coefficient of variation up to 0.25 — this is value uncertainty, NOT extraction confidence

**Verdict:** Confidence ranges 0.60-0.95 depending on extraction method. The 25% figure likely comes from value-uncertainty CV or belief elicitation, not from the confidence field itself. If all factors show 25% in the UI, the UI may be displaying the wrong field.

---

## Classification Summary

| Item | Status |
|------|--------|
| Guard wiring (buildPatchSummary, enforceProposalLanguage, assessMutationHealth, sanitiseAssistantText) | **Fixed** — all wired in pipeline-v4 |
| RUNTIME_TOOL_USE_SUFFIX | **Fixed** — appended to every turn |
| Legacy pipeline deletion | **Fixed** — response-assembler.legacy.ts and chip-assembler.ts removed |
| display_value synthesis (Path B) | **Fixed** — produces correct "6 developers" for observed_state |
| extractAnalysisReady carry-through | **Fixed** — is_baseline and intervention_details survive |
| risk edge sign | **Fixed** — add-factor.ts:143 sets effect_direction correctly |
| CEE_MAX_TOKENS_ORCHESTRATOR wiring | **Fixed** — reads from config with 4096 fallback |
| ISL timeout ceiling | **Fixed** — raised to 60s |
| v34d prompt sections reaching LLM | **Unknown** — depends on PMS store backend on staging |
| add-option is_baseline explicit setting | **Not fixed** — relies on downstream inference |
| factor_type binary inference | **Not fixed** — missing from inferFactorType() |
| raw_value for values ≤ 1 | **Not fixed (by design)** — small values don't get raw_value |
| Confidence at 25% | **Not a bug** — field confusion; actual confidence is 0.60-0.95 |
| OUTPUT_CONTRACT dead section in prompt | **Not fixed** — still present in v1, wasting ~3k tokens |
| V1/V2 pipeline dead code | **Partially fixed** — assembler deleted, but turn-handler.ts and pipeline.ts still exist |
| 12 action handler unit tests | **Not fixed** — only 3 of 15 have dedicated tests |
| User authorship push | **Not fixed** — weakly instructed in v1, may be in v100 |

---

*End of report. Generated by static code trace — no runtime payloads captured. PMS v100 content not verified.*

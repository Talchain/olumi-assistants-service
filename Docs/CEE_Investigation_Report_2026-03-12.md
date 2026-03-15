## Section 1: Model routing and provider configuration

### 1.1 Task-to-model mapping

**Finding:** Task defaults are defined in `TASK_MODEL_DEFAULTS`; some requested tasks are aliases or not explicit task keys.

**Evidence:**
- File: `src/config/model-routing.ts`
- Line: 36
- Value: `export const TASK_MODEL_DEFAULTS: Record<CeeTask, string>`

- File: `src/config/model-routing.ts`
- Line: 39
- Value: `clarification: "gpt-4.1-2025-04-14"`

- File: `src/config/model-routing.ts`
- Line: 45
- Value: `draft_graph: "gpt-4o"`

- File: `src/config/model-routing.ts`
- Line: 46
- Value: `edit_graph: "gpt-4o"`

- File: `src/config/model-routing.ts`
- Line: 49
- Value: `repair_graph: "gpt-4o"`

- File: `src/config/model-routing.ts`
- Line: 54
- Value: `decision_review: "gpt-4.1-2025-04-14"`

- File: `src/config/model-routing.ts`
- Line: 47
- Value: `bias_check: "claude-sonnet-4-20250514"`

- File: `src/config/model-routing.ts`
- Line: 53
- Value: `critique_graph: "gpt-5.2"`

- File: `src/config/model-routing.ts`
- Line: 48
- Value: `orchestrator: "gpt-4o"`

- File: `src/config/model-routing.ts`
- Line: 51
- Value: `options: "gpt-5.2"`

- File: `src/config/model-routing.ts`
- Line: 52
- Value: `suggest_options: "gpt-5.2"` (alias for options task)

- File: `src/config/model-routing.ts`
- Line: 21
- Value: `explainer` (closest match to requested `explain_results`)

- File: `src/config/model-routing.ts`
- Line: 76
- Value: `getDefaultModelForTask(task)`

**Per requested task:**
- `draft_graph`: default `gpt-4o`, provider `openai`.
- `edit_graph`: default `gpt-4o`, provider `openai`.
- `repair_graph`: default `gpt-4o`, provider `openai`.
- `decision_review`: default `gpt-4.1-2025-04-14`, provider `openai`.
- `bias_check`: default `claude-sonnet-4-20250514`, provider `anthropic`.
- `critique_graph`: default `gpt-5.2`, provider `openai`.
- `orchestrator`: default `gpt-4o`, provider `openai`.
- `clarification`: default `gpt-4.1-2025-04-14`, provider `openai`.
- `options_extraction`: no explicit task key; fallback is `TASK_MODEL_DEFAULTS` via nearest mapped task selection in router.
- `constraint_extraction`: no explicit task key; fallback is `TASK_MODEL_DEFAULTS` via nearest mapped task selection in router.
- `explain_results`: no explicit task key; closest explicit key is `explainer`.
- `generate_brief`: no explicit task key in `CeeTask`; tool-level routing uses orchestrator task-level model selection.
- `research_topic`: no explicit task key in `CeeTask`; tool-level routing uses orchestrator task-level model selection.

### 1.2 Model registry

**Finding:** Registry is centralized in `MODEL_REGISTRY` with provider, enabled, extendedThinking, and maxTokens fields.

**Evidence (Claude models):**
- File: `src/config/models.ts:238`
- Value: `claude-3-5-haiku-20241022`, enabled `true`, extendedThinking `undefined`, maxTokens `8192`.
- File: `src/config/models.ts:253`
- Value: `claude-sonnet-4-20250514`, enabled `true`, extendedThinking `true`, maxTokens `8192`.
- File: `src/config/models.ts:265`
- Value: `claude-sonnet-4-6`, enabled `true`, extendedThinking `false`, maxTokens `8192`.
- File: `src/config/models.ts:277`
- Value: `claude-sonnet-4-5-20250929`, enabled `true`, extendedThinking `true`, maxTokens `16384`.
- File: `src/config/models.ts:289`
- Value: `claude-opus-4-20250514`, enabled `true`, extendedThinking `true`, maxTokens `16384`.
- File: `src/config/models.ts:301`
- Value: `claude-opus-4-5-20251101`, enabled `true`, extendedThinking `true`, maxTokens `32768`.

**Evidence (OpenAI models, enabled status):**
- File: `src/config/models.ts:66` → `gpt-4o-mini` enabled `true`
- File: `src/config/models.ts:77` → `gpt-4o` enabled `true`
- File: `src/config/models.ts:88` → `gpt-4-turbo` enabled `true`
- File: `src/config/models.ts:105` → `gpt-4.1-2025-04-14` enabled `true`
- File: `src/config/models.ts:116` → `gpt-4.1-mini-2025-04-14` enabled `true`
- File: `src/config/models.ts:127` → `gpt-4.1-nano-2025-04-14` enabled `true`
- File: `src/config/models.ts:142` → `gpt-5-mini` enabled `true`
- File: `src/config/models.ts:154` → `gpt-5.2` enabled `true`
- File: `src/config/models.ts:170` → `o1` enabled `true`
- File: `src/config/models.ts:182` → `o1-mini` enabled `true`
- File: `src/config/models.ts:194` → `o1-preview` enabled `true`
- File: `src/config/models.ts:210` → `o3` enabled `true`
- File: `src/config/models.ts:222` → `o3-mini` enabled `true`
- File: `src/config/models.ts:319` → `test-disabled-model` enabled `false`

### 1.3 Provider routing precedence

**Finding:** Router implements explicit precedence documented in comments and code paths.

**Evidence:**
- File: `src/adapters/llm/router.ts:5`
- Value: precedence comment `LLM_FAILOVER_PROVIDERS → providers.json → CEE_MODEL_* → TASK_MODEL_DEFAULTS → LLM_PROVIDER/LLM_MODEL → adapter default`.

- File: `src/adapters/llm/router.ts:596`
- Value: selection precedence including request-time model override at highest priority.

### 1.4 Environment variable overrides

**Finding:** Env overrides are parsed centrally in config, then consumed by router/model selection.

**Evidence (selected required names):**
- File: `src/config/index.ts:550`
- Value: `LLM_PROVIDER`
- File: `src/config/index.ts:551`
- Value: `LLM_MODEL`
- File: `src/config/index.ts:683-693`
- Value: `CEE_MODEL_DRAFT`, `CEE_MODEL_OPTIONS`, `CEE_MODEL_REPAIR`, `CEE_MODEL_CLARIFICATION`, `CEE_MODEL_CRITIQUE`, `CEE_MODEL_VALIDATION`, `CEE_MODEL_EXTRACTION`, `CEE_MODEL_DECISION_REVIEW`, `CEE_MODEL_ORCHESTRATOR`, `CEE_MODEL_EDIT_GRAPH`
- File: `src/config/index.ts:714-724`
- Value: `CEE_MODEL_TASK_*` keys (task model overrides)
- File: `src/config/index.ts:567`
- Value: `CEE_ORCHESTRATOR_ENABLED ?? ENABLE_ORCHESTRATOR`

### 1.5 Edit graph model specifically

**Finding:** `edit_graph` tool dispatch reaches `handleEditGraph`, which obtains adapter via `getAdapter('edit_graph')`; default without overrides is `gpt-4o`.

**Evidence:**
- File: `src/orchestrator/tools/dispatch.ts:188-198`
- Value: `case 'edit_graph'` and `const adapter = getAdapter('edit_graph')`, then `handleEditGraph(...)`.
- File: `src/adapters/llm/router.ts:596-603`
- Value: selection precedence.
- File: `src/config/model-routing.ts:46`
- Value: `edit_graph: "gpt-4o"`.

**Notes:** Quality gating list is currently empty.
- File: `src/config/model-routing.ts:69-71`
- Value: `QUALITY_REQUIRED_TASKS` is empty.

---

## Section 2: Prompt management and versions

### 2.1 Prompt store architecture

**Finding:** Prompt loading supports store-backed loading plus hardcoded defaults with cache and stale-while-revalidate.

**Evidence:**
- File: `src/adapters/llm/prompt-loader.ts:157-162`
- Value: resolution order `forceDefault → cache → store fetch → defaults`.
- File: `src/adapters/llm/prompt-loader.ts:135`
- Value: cache TTL `300_000` (5 min).
- File: `src/adapters/llm/prompt-loader.ts:137`
- Value: stale grace `600_000` (10 min).
- File: `src/prompts/loader.ts:100-104`
- Value: loader order `forceDefault`, disabled management, store, fallback default.
- File: `src/prompts/store.ts`
- Value: store backend manager (file/postgres/supabase).

### 2.2 Active prompts

**Finding:** Fallback/default prompts are registered in `src/prompts/defaults.ts`; orchestrator cf-v13 prompt source is imported from `orchestrator-cf-v13.ts`.

**Evidence:**
- File: `src/prompts/defaults.ts:22`
- Value: imports `getOrchestratorPromptV13, ORCHESTRATOR_PROMPT_CF_V13`.
- File: `src/prompts/defaults.ts:1633-1640`
- Value: `<PATCH_SELECTION>` block present in edit_graph prompt.
- File: `src/prompts/defaults.ts:729-751`
- Value: `<REPAIR_PRINCIPLES>` block present.
- File: `src/prompts/orchestrator-cf-v13.ts:604-611`
- Value: untrusted policy markers context in cf-v13 prompt body.

**Not found / partial:**
- Explicit `<INFERENCE_CONTEXT>` block in draft_graph fallback prompt text: Not found in scanned default prompt body.
- Decision-review fallback prompt literal with `<SCIENCE_CLAIMS>` in defaults file: injected at runtime (see 4.5/6.2), not static hardcoded marker in same form.

### 2.3 Prompt store runtime behaviour

**Finding:** Prompt management is enabled by explicit config or healthy DB-backed store; failures fall back to defaults.

**Evidence:**
- File: `src/prompts/loader.ts:82-91`
- Value: `isPromptManagementEnabled()` returns true when `config.prompts.enabled===true` or DB-backed store healthy.
- File: `src/prompts/loader.ts:176-188`
- Value: store errors trigger fallback to `loadDefaultPrompt`.
- File: `src/prompts/loader.ts:80`
- Value: file store does not auto-enable.

---

## Section 3: Feature flags and configuration

### 3.1 Complete feature flag inventory

**Finding:** Core feature flags are defined in `src/config/index.ts` schema and raw env mapping.

**Evidence (requested flags):**
- File: `src/config/index.ts:256`
- Value: `orchestrator: booleanString.default(false)` (`CEE_ORCHESTRATOR_ENABLED`).
- File: `src/config/index.ts:258-260`
- Value: `contextFabric: booleanString.default(false)` (`CEE_ORCHESTRATOR_CONTEXT_ENABLED`).
- File: `src/config/index.ts:581`
- Value: `anthropicEnabled: env.ANTHROPIC_PROMPT_CACHE_ENABLED`.
- File: `src/config/index.ts:262` and `571`
- Value: `dskEnabled` default false, mapped from `DSK_ENABLED`.
- File: `src/config/index.ts:677`
- Value: `patchPreValidationEnabled: env.CEE_PATCH_PRE_VALIDATION_ENABLED`.
- File: `src/config/index.ts:678`
- Value: `patchBudgetEnabled: env.CEE_PATCH_BUDGET_ENABLED`.
- File: Not found as env read in `config/index.ts`
- Value: `ENABLE_VALIDATE_PATCH` (not found in central config mapping).
- File: `src/orchestrator/pipeline/pipeline.ts:938`
- Value: `ORCHESTRATOR_DEBUG_BUNDLE === 'true'` gate.
- File: `src/config/index.ts:533`
- Value: `nodeEnv: env.NODE_ENV`.

### 3.2 Prompt caching configuration

**Finding:** Anthropic prompt caching is implemented via system text `cache_control: { type: 'ephemeral' }`, gated by flag.

**Evidence:**
- File: `src/adapters/llm/anthropic.ts:146-167`
- Value: `buildSystemBlocks` adds `cache_control` ephemeral only when flag enabled.
- File: `src/adapters/llm/anthropic.ts:142-144`
- Value: `isAnthropicPromptCacheEnabled()` uses `config.promptCache.anthropicEnabled`.
- File: `src/adapters/llm/anthropic.ts:148-151`
- Value: telemetry `AnthropicPromptCacheHint` emitted when enabled.

---

## Section 4: Context management and assembly

### 4.1 Prompt assembly paths

**Finding:** There are at least V1 simple assembly and V2 pipeline assembly paths; Context Fabric path is feature-gated.

**Evidence:**
- File: `src/orchestrator/route.ts:375-399`
- Value: V2 (`handleTurnV2`) vs V1 (`handleTurn`) switch.
- File: `src/orchestrator/pipeline/phase3-llm/index.ts:438-466`
- Value: V2 system prompt assembly + messages + tools.
- File: `src/orchestrator/pipeline/phase1-enrichment/index.ts`
- Value: enrichment path includes budget enforcement.

### 4.2 Context Fabric V3

**Finding:** Context Fabric module exists and has dedicated unit tests; gate is `CEE_ORCHESTRATOR_CONTEXT_ENABLED`.

**Evidence:**
- File: `src/orchestrator/context-fabric/index.ts:1-56`
- Value: barrel module exports context-fabric components.
- File: `src/config/index.ts:569`
- Value: `contextFabric: env.CEE_ORCHESTRATOR_CONTEXT_ENABLED`.
- File: `tests/unit/orchestrator/context-fabric-wiring.test.ts`
- Value: wiring tests for flag off/on/fallback behavior.
- Command output:
  - `grep -R --line-number "describe(" tests/unit/orchestrator/context-fabric* | wc -l`
  - Value: `26` (describe-block count, not exact individual test case count).

### 4.3 Token estimation

**Finding:** Token counting is heuristic-based (4 chars/token); no Anthropic Token Counting API usage found.

**Evidence:**
- File: `src/orchestrator/context-fabric/token-estimator.ts:12`
- Value: `CHARS_PER_TOKEN = 4`.
- File: `src/orchestrator/context/budget.ts:28`
- Value: `CHARS_PER_TOKEN = 4`.
- File: `src/orchestrator/context/budget.ts:118`
- Value: default context budget `120_000` tokens.
- File: `src/orchestrator/context/budget.ts:121`
- Value: override env `ORCHESTRATOR_CONTEXT_BUDGET`.
- Search result:
  - Query for Anthropic token counting API calls in `src`: Not found.

### 4.4 Conversation history management

**Finding:** Context is trimmed to recent turns in enrichment/budget paths; no rolling summarizer implementation found in scanned files beyond event summary string.

**Evidence:**
- File: `src/orchestrator/pipeline/phase1-enrichment/index.ts`
- Value: comments/state indicate trim to last 5 turns.
- File: `src/orchestrator/context/budget.ts:210-229`
- Value: further trim from >3 to 1 turn when conversation budget exceeded.

### 4.5 `<SCIENCE_CLAIMS>` injection

**Finding:** Yes, block is assembled and injected for decision review from DSK claims.

**Evidence:**
- File: `src/cee/decision-review/science-claims.ts:73`
- Value: `lines.push('<SCIENCE_CLAIMS>')`.
- File: `src/cee/decision-review/science-claims.ts:75`
- Value: requires `dsk_claim_id` and `evidence_strength` references.
- File: `src/cee/decision-review/science-claims.ts`
- Value: injection logic places block between prompt markers.

---

## Section 5: Tool handlers and pipeline

### 5.1 Tool handler inventory

**Finding:** LLM-visible tools are in registry; dispatch handlers are centralized in `tools/dispatch.ts`.

**Evidence:**
- File: `src/orchestrator/tools/registry.ts:20-118`
- Value: tool set `draft_graph`, `edit_graph`, `run_analysis`, `explain_results`, `generate_brief`, `research_topic`.
- File: `src/orchestrator/tools/registry.ts:162-164`
- Value: gate-only `run_exercise`.
- File: `src/orchestrator/tools/dispatch.ts:101-271`
- Value: switch cases dispatch each handler.

**Wiring summary:**
- `draft_graph`: `handleDraftGraph` (LLM-backed drafting pipeline).
- `edit_graph`: `handleEditGraph` (LLM + validation + optional PLoT semantic validation).
- `run_analysis`: `handleRunAnalysis` (PLoT call).
- `explain_results`: `handleExplainResults` (LLM explanation).
- `generate_brief`: deterministic block generation.
- `research_topic`: research handler call.
- `run_exercise`: deterministic route into exercise handler.

### 5.2 Pipeline phases

**Finding:** V2 pipeline is explicit 5-phase flow: enrichment → specialist/routing prep → LLM route → tool execution → envelope validation/assembly.

**Evidence:**
- File: `src/orchestrator/pipeline/route-v2.ts:165-167`
- Value: `executePipeline(turnRequest, requestId, deps)`.
- File: `src/orchestrator/pipeline/phase3-llm/index.ts:81`
- Value: `phase3Generate(...)`.
- File: `src/orchestrator/pipeline/phase4-tools/index.ts:58`
- Value: `phase4Execute(...)`.
- File: `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts`
- Value: phase5 envelope assembly path.

### 5.3 Intent classification

**Finding:** Deterministic intent table + research prefixes, with LLM fallback when no match.

**Evidence:**
- File: `src/orchestrator/intent-gate.ts:77-150`
- Value: frozen deterministic pattern table.
- File: `src/orchestrator/intent-gate.ts:192-199`
- Value: research prefix patterns.
- File: `src/orchestrator/intent-gate.ts:264-269`
- Value: fallback `{ tool: null, routing: 'llm', confidence: 'none' }`.

### 5.4 Error handling in the pipeline

**Finding:** PLoT and LLM errors are typed and transformed; timeouts are centralized constants.

**Evidence:**
- File: `src/orchestrator/plot-client.ts:14-17`
- Value: `/v2/run 422 -> V2RunError`; 4xx/5xx -> error.v1 envelope handling.
- File: `src/orchestrator/plot-client.ts:435-459`
- Value: 422 path parsing into `v2RunError` and throwing typed `PLoTError`.
- File: `src/orchestrator/tools/run-analysis.ts:116-121`
- Value: `error.v2RunError` surfaced as structured analysis result.
- File: `src/config/timeouts.ts:132-149`
- Value: orchestrator timeout and PLoT run timeout defaults.
- File: `src/adapters/llm/anthropic.ts:399-401`
- Value: abort timeout via `TIMEOUT_MS`.
- File: `src/adapters/llm/anthropic.ts:666-673`
- Value: timeout mapped to `UpstreamTimeoutError`.

---

## Section 6: DSK integration

### 6.1 DSK loader

**Finding:** DSK bundle is loaded at startup (gated) from `data/dsk/v1.json`, validated for shape + hash.

**Evidence:**
- File: `src/orchestrator/dsk-loader.ts:42`
- Value: `loadDskBundle()` startup loader.
- File: `src/orchestrator/dsk-loader.ts:52`
- Value: bundle path `data/dsk/v1.json`.
- File: `src/orchestrator/dsk-loader.ts:46`
- Value: gate condition `!config.features.dskV0 && !config.features.dskEnabled`.
- File: `src/orchestrator/dsk-loader.ts:72-84`
- Value: required top-level shape checks.
- File: `src/orchestrator/dsk-loader.ts:87-92`
- Value: hash verification with fail-fast mismatch throw.

### 6.2 DSK usage in prompts

**Finding:** Decision review prompt path receives DSK claim/protocol data via assembled `<SCIENCE_CLAIMS>` block.

**Evidence:**
- File: `src/cee/decision-review/science-claims.ts:72-97`
- Value: builds block/table from DSK claims.
- File: `src/cee/decision-review/science-claims.ts`
- Value: injects into prompt template between structural markers.

### 6.3 DSK validation

**Finding:** DSK fields are validated with mixed hard-reject and warnings.

**Evidence:**
- File: `src/cee/decision-review/shape-check.ts:10-13`
- Value: policy summary: claim id not found hard reject; strength/protocol mismatch warnings.
- File: `src/cee/decision-review/shape-check.ts:156`
- Value: `bias_findings[].dsk_claim_id ... not found` pushed to `errors`.
- File: `src/cee/decision-review/shape-check.ts:159`
- Value: evidence strength drift warning.
- File: `src/cee/decision-review/shape-check.ts:201`
- Value: `dsk_protocol_id` not found warning.

---

## Section 7: Test health and code quality

### 7.1 Test suite status

**Finding:** Test suite runs but has failures.

**Evidence (command):**
- Command: `npm test`
- Result: exit code `1`
- Summary: `Test Files 14 failed | 455 passed | 3 skipped (472)`
- Summary: `Tests 72 failed | 7905 passed | 80 skipped | 1 todo (8058)`

**Sample failing tests (from output):**
- `tests/integration/orchestrator-golden-path.test.ts` → `post-draft response quality... graph_patch block must be present`
- `tests/integration/v1.status.test.ts` → cache fields expectations
- `tests/unit/orchestrator.turn-handler.test.ts` → patch_accepted path expected status mismatch
- `tests/unit/orchestrator/context-fabric-wiring.test.ts` → expected 502 got 500

### 7.2 TypeScript health

**Finding:** Typecheck currently fails.

**Evidence (command):**
- Command: `npx tsc --noEmit`
- Result: exit code `2`
- Summary: `Found 16 errors in 9 files`
- Top files by count (from output footer):
  - `tests/unit/cee.graph-data-integrity.test.ts` (3)
  - `tests/unit/orchestrator/parallel-generate.test.ts` (3)
  - `tests/unit/cee.bidirected-edges.test.ts` (2)
  - `tests/unit/cee.value-uncertainty.test.ts` (2)
  - `tests/unit/orchestrator/graph-structure-validator.test.ts` (2)

### 7.3 Dead code and legacy paths

**Finding:** TODO/deprecated markers exist; legacy path comments and aliases are present.

**Evidence:**
- File: `src/schemas/assist.ts:6`
- Value: `TODO` on min length backlog.
- File: `src/orchestrator/dsk-loader.ts:43`
- Value: `TODO` deprecate `ENABLE_DSK_V0`.
- File: `src/schemas/graph.ts:240-262`
- Value: `@deprecated` for legacy edge fields (`weight`, `belief`).
- File: `src/utils/layout.ts:188`
- Value: `@deprecated` legacy layout function.

### 7.4 Dependency audit

**Finding:** `npm audit` could not execute due missing npm lockfile.

**Evidence (command):**
- Command: `npm audit`
- Result: exit code `1`
- Output: `ENOLOCK ... requires an existing lockfile ... npm i --package-lock-only`

**Notes:** repo appears `pnpm`-managed (`pnpm-lock.yaml` present), so `npm audit` fails in current state.

---

## Section 8: Observability and debugging

### 8.1 Trace and debug output

**Finding:** `_debug_bundle` and `_route_metadata` are envelope-internal fields, with explicit production gate for debug bundle exposure.

**Evidence:**
- File: `src/orchestrator/pipeline/types.ts:427-428`
- Value: `_route_metadata`, `_debug_bundle` declared.
- File: `src/orchestrator/pipeline/pipeline.ts:929-935`
- Value: attach/delete `_debug_bundle`.
- File: `src/orchestrator/pipeline/pipeline.ts:937-939`
- Value: gate `NODE_ENV !== 'production' || ORCHESTRATOR_DEBUG_BUNDLE === 'true'`.
- File: `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts:251-253`
- Value: `_route_metadata` set from route metadata.

### 8.2 Logging

**Finding:** Logging uses Pino with structured events and telemetry emitters; sensitive data handling includes redaction config and IP hashing.

**Evidence:**
- File: `src/utils/telemetry.ts:31`
- Value: `log = pino(...)`.
- File: `src/utils/telemetry.ts:18-20`
- Value: IP hashing function.
- File: `src/utils/telemetry.ts:644-653`
- Value: `emit()` performs structured event logging.
- File: `src/utils/telemetry.ts:28-31`
- Value: redaction config integration from logger config.

---

## Section 9: Security and robustness

### 9.1 Input validation

**Finding:** `/orchestrate/v1/turn` has explicit Zod schema validation; many `/assist/*` routes use Zod `safeParse`.

**Evidence:**
- File: `src/orchestrator/route.ts:158-173`
- Value: `TurnRequestSchema` including `graph_state`, `analysis_state`, `conversation_history`.
- File: `src/orchestrator/route.ts:230`
- Value: `TurnRequestSchema.safeParse(req.body)`.
- File: `src/routes/assist.v1.ask.ts:231`
- Value: `WorkingSetRequest.safeParse(req.body)`.
- File: `src/routes/assist.v1.edit-graph.ts:25-43`
- Value: route-local request schema + `safeParse`.
- File: `src/orchestrator/route.ts:114-123`
- Value: `analysis_inputs` schema is present.

### 9.2 Untrusted content handling

**Finding:** Untrusted markers are implemented in context-fabric/prompt zones, but not all legacy assembly paths are proven marker-wrapped in this pass.

**Evidence:**
- File: `src/orchestrator/context-fabric/renderer.ts:39-40`
- Value: `UNTRUSTED_OPEN`, `UNTRUSTED_CLOSE` constants.
- File: `src/orchestrator/context-fabric/renderer.ts:127-129`
- Value: wrapper inserts markers.
- File: `src/orchestrator/prompt-zones/zone2-blocks.ts:90-95`
- Value: marker wrapping in zone2 blocks.

### 9.3 Rate limiting and abuse prevention

**Finding:** Both request-rate limits and daily token budget limits are enforced in orchestrator/CEE paths.

**Evidence:**
- File: `src/middleware/rate-limit.ts:27-30`
- Value: per-minute limits (`30` auth, `10` unauth).
- File: `src/middleware/rate-limit.ts:171`
- Value: 429 response for rate-limit.
- File: `src/orchestrator/route.ts:418-435`
- Value: `DailyBudgetExceededError` mapped to `CEE_RATE_LIMIT` 429.
- File: `src/cee/validation/pipeline.ts:795-813`
- Value: CEE pipeline maps daily budget to `CEE_RATE_LIMIT`.

---

## Section 10: Identified issues and recommendations

### 10.1 Critical issues

**Issue 1:** Typecheck baseline broken (`16` TS errors), including orchestrator test/type mismatch and missing test import variants.
- Severity: High
- Evidence: `npx tsc --noEmit` output summary and listed files.
- Recommended fix: restore green typecheck baseline before feature work; prioritize orchestrator and core CEE test typing.

**Issue 2:** Test baseline has 72 failing tests including orchestrator turn-handler and context-fabric wiring expectations.
- Severity: High
- Evidence: `npm test` summary + failing file list.
- Recommended fix: triage failures into regression vs stale tests; gate release on core orchestrator path pass.

### 10.2 Important issues

**Issue 1:** `npm audit` cannot run in `npm` mode due lockfile mismatch (`pnpm` repo).
- Severity: Medium
- Evidence: `npm audit` ENOLOCK output.
- Recommended fix: use toolchain-consistent audit (`pnpm audit`) in CI and docs.

**Issue 2:** Context-fabric marker handling exists, but legacy prompt paths may not uniformly apply marker wrappers.
- Severity: Medium
- Evidence: marker wrappers found in context-fabric/zone2; no universal wrapper assertion found for every path.
- Recommended fix: add invariant tests ensuring all user text entering prompts is marker-bounded (or explicitly documented exceptions).

### 10.3 Optimisation opportunities

1. Standardize model task keys (`explain_results`, `generate_brief`, `research_topic`) with routing/task registry naming.
   - Impact: cleaner config ownership, fewer implicit fallbacks
   - Effort: Medium

2. Consolidate feature-flag discovery docs from `config/index.ts` to generated inventory.
   - Impact: reduced operational drift
   - Effort: Small

3. Expose deterministic count tooling for TODO/deprecated and dead export checks in CI.
   - Impact: measurable code health trend
   - Effort: Small

### 10.4 Questions requiring runtime/staging/database access

1. Which prompt versions are currently active in store-backed production/staging (beyond fallback defaults)?
2. Real-world prompt cache hit rates and stale refresh behaviour under multi-instance load.
3. Live DSK bundle contents/version hash currently deployed and whether they match repo artifact.
4. Whether failing tests/TS errors are accepted baseline in current branch policy or unintended regression.

---

## Command execution log (required)

1. `npx tsc --noEmit`
- Exit code: `2`
- Result: `Found 16 errors in 9 files`.

2. `npm test`
- Exit code: `1`
- Result: `72 failed, 7905 passed, 80 skipped, 1 todo`.

3. `npm audit`
- Exit code: `1`
- Result: `ENOLOCK` (no npm lockfile).


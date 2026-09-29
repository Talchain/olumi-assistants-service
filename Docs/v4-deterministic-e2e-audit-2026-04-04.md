# V4 Deterministic Layer End-to-End Audit

**Date:** 2026-04-04
**Scope:** All v4 pipeline components, three turn-type traces, component audits, cross-cutting concerns
**Type:** Read-only investigation. No code changes.

---

## Executive Summary

The v4 native tool-use pipeline is architecturally sound. The component isolation, deterministic context computation, and action catalogue design are well-engineered. However, one **P0 blocker** prevents production readiness: the PMS prompt (cf-v28) instructs the LLM to produce XML-enveloped output, while v4 expects plain conversational text. This causes raw XML tags to stream to users and wastes tokens on scaffolding the pipeline ignores.

**Finding counts:** 1 P0, 4 P1, 7 P2, 2 Investigation

---

## Part 1: Turn-Type Traces

### Turn A: Rich Brief (first turn, no graph)

**Input:** 200-word brief, `graph_state: { nodes: [], edges: [] }`, `conversation_history: []`, no `system_event`, no `chip_metadata`.

#### Layer 1: pipeline-v4.ts routing

- `handleSystemEvent()` returns `null` (no system_event) ([pipeline-v4.ts:101](src/orchestrator/deterministic/pipeline-v4.ts#L101))
- Falls through to `computeTurnContext()` at line 121

**Execution class:** `standard_turn` (no system_event, no chip_metadata, no generate_model, message is non-empty)

#### Layer 2: computeTurnContext

- **Stage:** `inferStage()` receives empty graph (nodes array exists but length 0). [stage-inference.ts:32](src/orchestrator/pipeline/phase1-enrichment/stage-inference.ts#L32): `hasGraph = false` because `graphNodes.length === 0`. Returns `stage: 'frame'`.
- **Entity registry:** `buildEntityRegistry()` receives graph with `nodes: []`. Returns empty: `{ nodes: Map(0), edges: [], option_ids: [], goal_id: null }` ([turn-context.ts:132-134](src/orchestrator/deterministic/turn-context.ts#L132-L134))
- **entity_count:** `turnContext.entities.nodes.size = 0` (logged at [pipeline-v4.ts:139](src/orchestrator/deterministic/pipeline-v4.ts#L139))
- **Graph summary:** `{ node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: ['no goal node'] }` ([turn-context.ts:186-193](src/orchestrator/deterministic/turn-context.ts#L186-L193))
- **Analysis summary:** `null` (no analysis)
- **Capabilities:** All false ([turn-context.ts:371-382](src/orchestrator/deterministic/turn-context.ts#L371-L382)) — `hasGraph = false`, `hasAnalysis = false`
- **Blockers:** `run_analysis` blocked ("No decision model available"), `explain_result` blocked, `compare_options` blocked, `set_goal_target` blocked (no goal node) ([turn-context.ts:389-438](src/orchestrator/deterministic/turn-context.ts#L389-L438))
- **Signals:** All empty/false/0 — no graph data to signal from
- **Eligible actions:** Stage policy for `frame` = `{set_factor_value, add_factor, set_goal_target, add_constraint}` ([turn-context.ts:52](src/orchestrator/deterministic/turn-context.ts#L52)). But `can_edit_graph = false` (no graph), so all four are filtered out at [turn-context.ts:588](src/orchestrator/deterministic/turn-context.ts#L588). **Result: `eligible_actions = []`**
- **Disambiguation hints:** Empty (no entities)

#### Layer 3: Prompt builder v2

- **Static block:** Loaded from PMS → cf-v28 content (57,653 chars). Contains `<OUTPUT_CONTRACT>` with XML envelope instructions. If PMS fails, falls back to `STATIC_PROMPT_FALLBACK` (24 lines, plain text, no XML).
- **Dynamic block:** `buildStateSection()` produces:
  ```
  ## Current Decision State
  Stage: **frame**
  Model: not yet created
  ```
  No analysis, no signals, no blockers text (blockers exist but only the reason strings are shown — they are present: "No decision model available. Draft a model first."). No disambiguation section.
- **Total:** ~57,653 (static) + ~80 (dynamic) = ~57,733 chars

#### Layer 4: Tool builder

- `eligibleActions` starts empty `[]` from TurnContext
- [pipeline-v4.ts:184](src/orchestrator/deterministic/pipeline-v4.ts#L184): `!turnContext.graph` check — `turnContext.graph` is `{ nodes: [], edges: [] }`, which is truthy! So `draft_graph` is **NOT** auto-added via the `!turnContext.graph` branch
- However, `turnRequest.generate_model` is `undefined`/`false` for this input
- **Result: `eligibleActions = []`, `toolDefs = []`**

> **P1 Finding #1 — draft_graph not auto-added for empty graph:** The guard at [pipeline-v4.ts:184](src/orchestrator/deterministic/pipeline-v4.ts#L184) checks `!turnContext.graph` but the graph object `{ nodes: [], edges: [] }` is truthy. An empty graph (zero nodes) should be treated as "no graph" for draft_graph eligibility. The user sends a 200-word brief with an empty graph and gets zero tools — the LLM has no way to build a model. **Fix:** Change to `!turnContext.graph || turnContext.graph_summary.node_count === 0`.

- With zero tools, `hasTools = false` at [pipeline-v4.ts:260](src/orchestrator/deterministic/pipeline-v4.ts#L260), so `tool_choice` is omitted from the adapter call.

#### Layer 5: History filter v4

- `assembleMessages()` receives `context.messages = []` + current user message → produces `[{ role: 'user', content: '<200-word brief>' }]`
- `sanitiseAssistantHistory()` is a no-op (no assistant messages)
- `filterHistoryV4()`: single user message, non-empty, not a system sentinel, not an error pattern → passes through
- **Result:** `messages = [{ role: 'user', content: '<brief>' }]`

#### Layer 6: Anthropic adapter call

```
system: "<cf-v28 ~57K chars>\n\n---\n\n## Current Decision State\nStage: **frame**\nModel: not yet created"
system_cache_blocks: [
  { type: 'text', text: '<cf-v28>', cache_control: { type: 'ephemeral' } },
  { type: 'text', text: '## Current Decision State...' }
]
messages: [{ role: 'user', content: '<brief>' }]
tools: []
// tool_choice omitted (no tools)
temperature: 0
maxTokens: 2048
```

The LLM receives the cf-v28 prompt which tells it to produce XML-envelope output with `<diagnostics>`, `<response>`, `<assistant_text>`, etc. With no tools available, the LLM will produce XML-formatted text output.

#### Layer 7: Stream handler v4

- LLM returns text only (no tool_use — no tools were provided)
- `text_delta` events are yielded directly to SSE stream
- The text will contain XML tags from the OUTPUT_CONTRACT
- **Users see raw XML tags streaming in real-time** (e.g., `<diagnostics>`, `<response>`, `<assistant_text>`)
- `StreamHandlerResult`: `{ assistantText: '<XML-wrapped text>', toolExecution: null, failedToolCall: null, pendingLongRunningTool: null, discardedToolCalls: [] }`

#### Layer 8: draft-graph.ts action handler

- **Not invoked.** No tools were provided, so the LLM cannot call `draft_graph`.

#### Layer 9: Response assembly

- `executedAction = null`, `actionResult = null`
- `assistantText = '<XML-wrapped text from LLM>'`
- No chip pre-text (no chip click)
- No tool failure text
- `assembleV4Envelope()`:
  - `blocks = []` (no action result)
  - `suggestedActions = buildDeterministicChips(ctx, null)` → no eligible_actions → **empty chips `[]`**
  - `stage_indicator = 'frame'`

#### Layer 10: Envelope validation

- `validateEnvelope()` at [pipeline-v4.ts:646](src/orchestrator/deterministic/pipeline-v4.ts#L646): warn-only
- `assistant_text` is non-empty (XML-wrapped text) → passes
- `blocks` is empty array → passes (no per-block checks needed)
- `stage_indicator = 'frame'` → passes
- `response_version = 2` → passes

#### Layer 11: Normalisation

- `normaliseDeterministicResponse()` at [response-normaliser.ts:27-65](src/orchestrator/deterministic/response-normaliser.ts#L27-L65):
  - Step 1: text is non-empty → skip default
  - Step 2: `stripXmlTags()` removes XML tags from assistant_text. Result: orphaned content like `[...]`, section text without structure
  - Step 3: chips already capped (0 chips)
  - Steps 4-7: no blocks/insights to process

**Turn A Summary:**
- The LLM gets zero tools and produces XML-envelope text
- XML is stripped at normalisation but the user already saw it during streaming
- No draft_graph tool available despite empty graph (P1 bug)
- No suggested action chips shown
- The turn is functionally broken for a first-turn brief

---

### Turn B: Follow-up Question with 12-Node Graph

**Input:** "What should I address in my model first?", `graph_state` with 12 nodes (1 goal, 3 options, 8 factors) and 22 edges, `conversation_history` with brief + assistant response, no analysis.

#### Layer 2: computeTurnContext

- **Stage:** `inferStage()` — `hasGraph = true` (12 nodes), `analysis = null` → returns `stage: 'ideate'` ([stage-inference.ts:48](src/orchestrator/pipeline/phase1-enrichment/stage-inference.ts#L48)). Correct.
- **Entity registry:** 12 nodes → 12 EntityEntry objects in Map. 3 option_ids. 1 goal_id. 22 EdgeEntry objects. Each factor node gets aliases from `buildAliases()`.
- **entity_count:** `entities.nodes.size = 12`
- **Graph summary:** `{ node_count: 12, edge_count: 22, option_count: 3, option_labels: ['Option A', 'Option B', 'Option C'], goal_label: 'Goal', missing_structural: [...] }`
- **Analysis summary:** `null`
- **Capabilities:** `can_run_analysis = true` (graph + options), `can_edit_graph = true`, others requiring analysis = false
- **Blockers:** `explain_result` blocked, `compare_options` blocked (no analysis)
- **Eligible actions (ideate stage):** Policy = `{set_factor_value, add_constraint, add_factor, adjust_edge_strength, add_option, remove_factor, set_goal_target}`. Capabilities check: `can_edit_graph = true` → all pass. `run_analysis` not in ideate policy. **Result:** 7 eligible actions.
- **Signals:** Possible `weak_edges` (edges with `|strength_mean| < 0.3`), `default_value_count` (inferred factors), `high_uncertainty_factors`

> **P2 Finding — `run_analysis` excluded from ideate stage policy:** [turn-context.ts:53](src/orchestrator/deterministic/turn-context.ts#L53) — the `ideate` stage does not include `run_analysis`. This means a user with a complete graph (12 nodes, options, edges) in `ideate` stage cannot trigger analysis via tool. They must wait for the stage to advance to `evaluate`. This may be intentional (user should refine before analysing) but could frustrate users who want to test their model early. The pipeline auto-adds `draft_graph` outside the policy, but doesn't auto-add `run_analysis` for ideate.

#### Layer 4: Tool builder

- 7 eligible actions → `buildToolDefinitions()` applies context exclusions:
  - `hasAnalysis = false` → excludes `explain_result, compare_options, what_would_flip` (none in eligible list anyway)
  - `hasGraph = true` → no graph-edit exclusions
- Entity disambiguation: [tool-builder.ts:278-313](src/orchestrator/deterministic/tool-builder.ts#L278-L313) — with 12 nodes, checks for same-kind label collision. If e.g., two factors share a non-stop-word term ("Customer Acquisition Cost" and "Customer Lifetime Value" both contain "customer" which is in AMBIGUITY_STOP_WORDS — wait, "customer" is NOT in AMBIGUITY_STOP_WORDS at line 46-51). Actually, the tool-builder has its own stop words list. Let me check: the list includes `rate, cost, time, total, value, factor, score, level, high, low, new, old, net, max, min, avg, mean`. "customer" is NOT a stop word here. If two factor labels share "customer", ambiguity is triggered → all target_id tools suppressed.
- Dynamic enrichment: no analysis → descriptions unchanged for analysis tools. `set_factor_value` may get enriched with factors lacking values.
- **Result:** Up to 7 tools, potentially fewer if disambiguation triggers

#### Layer 5: History filter v4

- `assembleMessages()`: 2 history messages + current user message = 3 messages
- `sanitiseAssistantHistory()`: If assistant content is JSON (from V3 pipeline), extracts `.text` field. If XML (from cf-v28), passes through as string.
- `filterHistoryV4()`: 3 messages → all should pass (non-empty, non-error). Cap at 10 → no truncation.
- **Result:** 3 messages `[{ role: 'user', content: '<brief>' }, { role: 'assistant', content: '<previous response>' }, { role: 'user', content: 'What should I...' }]`

> **P1 Finding #2 — V3/XML history pollution:** If the previous assistant response was produced by cf-v28 (XML envelope), it may contain `<diagnostics>...<response><assistant_text>...` in the history. `sanitiseAssistantHistory()` only handles JSON-shaped content (checks `trimmed.startsWith('{')` at [pipeline.ts:960](src/orchestrator/deterministic/pipeline.ts#L960)). XML-shaped content passes through unchanged. `filterHistoryV4()` also doesn't strip XML. The LLM receives XML-polluted history, which reinforces the XML output pattern.

#### Layers 6-11

Similar to Turn A but with tools available. The LLM can call tools (7 graph-editing tools). With `tool_choice: { type: 'auto' }`, the LLM may respond conversationally (answering "What should I address first?") or call a tool. The cf-v28 prompt issue applies: response will likely be XML-wrapped.

**Chips:** `buildDeterministicChips()` with 7 eligible edit actions. Priority ordering puts graph-edit tools at priority 7-10. No analysis tools eligible. Top 3 chips likely: `set_factor_value` (7), `add_factor` (8), `add_option` (8).

---

### Turn C: Chip Click (run_analysis)

**Input:** `chip_metadata: { action_type: 'run_analysis', parameters: {} }`, `graph_state` with 12 nodes, `conversation_history` with 4 messages, `analysis_state` is null.

#### Layer 2: computeTurnContext

- **Stage:** `inferStage()` with 12-node graph, no analysis → `ideate`
- **Eligible actions (ideate):** Same 7 edit actions as Turn B. `run_analysis` NOT in ideate policy.

#### Layer 4: Tool builder & tool_choice

- `eligibleActions` = 7 edit actions (from TurnContext)
- [pipeline-v4.ts:184](src/orchestrator/deterministic/pipeline-v4.ts#L184): `turnContext.graph` exists → `draft_graph` not added
- `chipAction = 'run_analysis'`
- `buildToolDefinitions()` produces tools from the 7 edit actions. `run_analysis` is NOT among them.
- [pipeline-v4.ts:213](src/orchestrator/deterministic/pipeline-v4.ts#L213): `chipActionInTools = toolDefs.some(t => t.name === 'run_analysis')` → **false**
- `toolChoice = { type: 'auto' }` (downgraded)
- Warning logged at [pipeline-v4.ts:218-222](src/orchestrator/deterministic/pipeline-v4.ts#L218-L222)

> **P1 Finding #3 — Chip click for run_analysis fails in ideate stage:** If the UI presents a "Run analysis" chip (which it could if the chip was generated in a previous turn at a different stage, or if the UI hard-codes it), clicking it when the stage is `ideate` causes a silent downgrade to `tool_choice: auto`. The user expects analysis to run but instead gets a general LLM response. The pipeline correctly logs a warning, but the user has no indication of failure.

#### Chip pre-text

- `chipActionInTools = false` → chip pre-text NOT emitted ([pipeline-v4.ts:253](src/orchestrator/deterministic/pipeline-v4.ts#L253))
- Correct behaviour — no misleading "Running the analysis now." text

#### If stage were `evaluate` instead:

- `eligible_actions` would include `run_analysis` (evaluate policy includes it)
- `chipActionInTools = true`
- `toolChoice = { type: 'tool', name: 'run_analysis' }`
- Chip pre-text "Running the analysis now." emitted immediately
- LLM forced to call `run_analysis` tool
- `run_analysis` is in `LONG_RUNNING_ACTIONS` → deferred to pipeline level
- Pipeline executes with progress events every 5s
- `runAnalysisAction.execute()` called → delegates to `handleRunAnalysis()` via dynamic import
- Returns `ActionResult` with analysis_response + blocks

---

## Part 2: Component-Level Audit

### 2A: TurnContext (turn-context.ts)

| Check | Status | Notes |
|-------|--------|-------|
| Stage computed correctly | **Correct** | Uses `inferStage()` — frame (no graph), ideate (graph, no analysis), evaluate (analysis exists) |
| entity_count from graph nodes | **Correct** | `entities.nodes.size` at pipeline-v4.ts:139 |
| eligible_actions filtering | **Correct** | Three-tier: stage policy → capability → blocker |
| is_action_target (DA19) | **Correct** | `node.kind !== 'decision'` includes factors, options, goals, external. Goals are correctly targetable (set_goal_target) |
| missing_structural (DA20) | **Correct** | Returns `string[]` at turn-context.ts:192 |
| Disambiguation hints | **Correct** | Two-tier: message tokens → entity label matches. Max 2 hints. |
| Empty edges handling | **Correct** | Graph with nodes but empty edges produces empty EdgeEntry array. Capabilities still computed from nodes. |

**Issue:** `is_action_target` is `false` only for `decision` nodes. The `goal` kind is treated as action-targetable. This is correct for `set_goal_target` and `add_constraint` but may cause disambiguation hints to include the goal node unnecessarily. Low impact — P2.

### 2B: Tool Builder (tool-builder.ts)

| Check | Status | Notes |
|-------|--------|-------|
| No analysis → no explain/compare/flip | **Correct** | ANALYSIS_REQUIRED_ACTIONS at line 28-32 |
| No graph → no edit tools | **Correct** | GRAPH_EDIT_ACTIONS at line 35-43 + run_analysis excluded |
| Has analysis → analytical tools included | **Correct** | Only excluded when `!hasAnalysis` |
| Entity disambiguation | **Correct** | Two-tier: message-level (from TurnContext) + label-level (same-kind collision). Suppresses target_id tools. |
| Dynamic descriptions | **Correct** | explain_result, compare_options, what_would_flip, set_factor_value enriched |
| Schema validation | **Correct** | Recursive validation, cached, warn-only |
| All 15 schemas valid | **Correct** per audit | All have `additionalProperties: false`, required fields match properties |

**Issue — Overly aggressive disambiguation (P2):** The label-level disambiguation at [tool-builder.ts:294-310](src/orchestrator/deterministic/tool-builder.ts#L294-L310) triggers when ANY two same-kind entities share a non-stop-word term. In a 12-node graph with factors like "Revenue Growth" and "Revenue Target", the shared word "revenue" (not in AMBIGUITY_STOP_WORDS) triggers disambiguation. This suppresses ALL target_id tools — `set_factor_value`, `remove_factor`, `adjust_edge_strength`, `add_constraint`. The LLM loses most edit capabilities. This is overly conservative for typical graphs.

### 2C: Prompt Builder v2 (prompt-builder-v2.ts)

| Check | Status | Notes |
|-------|--------|-------|
| TTL cache refreshes from PMS | **Correct** | 5-min TTL at line 40 |
| Dynamic block: stage | **Correct** | Bold stage name |
| Dynamic block: entity list | **Correct** | Label-first format with ID, category, value |
| Dynamic block: signals | **Correct** | close_call, dominant_factor, defaults, weak_edges, uncertainty |
| Dynamic block: empty graph | **Correct** | Shows "Model: not yet created" |
| Dynamic block: graph + no analysis | **Correct** | Shows factors/options, no analysis section |
| Dynamic block: graph + analysis | **Correct** | Shows winner, runner-up, robustness, drivers, tensions |
| Total prompt size | **P0 Issue** | ~57,733 chars for cf-v28. See Finding #4. |

### 2D: History Filter (history-filter-v4.ts)

| Check | Status | Notes |
|-------|--------|-------|
| Cap at 10 messages | **Correct** | `MAX_HISTORY_MESSAGES = 10` at line 22 |
| Drop error/sentinel/empty | **Correct** | ERROR_PATTERNS, SYSTEM_SENTINEL, NORMALISER_DEFAULT, empty check |
| Preserve text from tool_call turns | **Correct** | `extractText()` extracts text blocks, drops tool_use blocks |
| Handle V3 history (JSON/XML) | **Partial** | JSON handled by `sanitiseAssistantHistory()`. XML NOT handled — passes through. See P1 Finding #2. |
| Handle role: 'system' | **Not handled** | System messages pass through if they don't match other filters. But Anthropic API may reject system-role messages in the messages array. Likely not an issue in practice — system messages typically sent via the system parameter, not messages. |

### 2E: Stream Handler (stream-handler-v4.ts)

| Check | Status | Notes |
|-------|--------|-------|
| text_delta streaming | **Correct** | Yielded immediately |
| tool_input accumulation | **Correct** | Adapter accumulates; handler receives complete input |
| Non-streaming fallback | **Correct** | `message_complete` handler extracts text + first tool |
| Progress polling | **Correct** | At pipeline level, 5s interval via Promise.race |
| Mid-stream error | **Partial** | If stream errors, the for-await-of loop throws. Pipeline catches at line 479. But partial text already streamed to user cannot be recalled. The error envelope will have `assistant_text: null` (accumulated text not used). |
| One-tool-per-turn | **Correct** | Second tool call discarded with warning |

**Issue — Partial text on stream error (P2):** If the Anthropic stream errors mid-response, text_delta events already yielded to the user are irrecoverable. The error envelope shows a clean error, but the user has already seen partial (possibly XML-contaminated) text. No realistic fix — inherent to streaming. Worth noting for debugging.

### 2F: Chip Builder (chip-builder-v4.ts)

| Check | Status | Notes |
|-------|--------|-------|
| Chips from eligible_actions | **Correct** | Iterates `ctx.eligible_actions` |
| action_type + parameters in metadata | **Correct** | `action_type: candidate.name` in chip object |
| Cap at 3 | **Correct** | `MAX_CHIPS = 3` |
| Priority ordering | **Correct** | run_analysis=1, explain_result=2, ..., set_goal_target=10 |
| Signal boosting | **Correct** | run_analysis → 0 when no analysis, explain_result → 0 after analysis, challenge → 2 on dominant_factor, flip → 2 on close_call |
| Scientist role preserved | **Correct** | Role comes from action definition. run_analysis, explain_result, compare_options, what_would_flip are all `role: 'scientist'`. NOT remapped. |

### 2G: Response Assembly and Normalisation

| Check | Status | Notes |
|-------|--------|-------|
| assistant_text always plain text | **FAILS** | cf-v28 prompt causes XML output. Normaliser strips tags but damage is done during streaming. |
| Text ordering | **Correct** | action confirmation prepended if not already present (line 558-566) |
| Banned term scan | **Correct** | 20 internal terms scanned, telemetry only |
| Entity ID replacement | **Not implemented** | No evidence of entity ID → label replacement in assistant_text. If LLM emits `factor_customer_acq_cost` in text, it reaches the user. |
| LLM produces no text (tool only) | **Handled** | Text injection at line 426-434 |
| LLM produces text, no tool | **Handled** | Text passes through |
| LLM produces neither | **Handled** | Normaliser sets DEFAULT_TEXT |

> **P2 Finding — No entity ID replacement:** If the LLM uses internal entity IDs (e.g., `factor_revenue_growth`) in its text response, they reach the user unchanged. The prompt should instruct label usage, but there's no server-side guardrail. Low risk since good prompts prevent this.

### 2H: Action Handlers

All 15 handlers audited. See summary:

| Action | Signature | Error Handling | Block Types | Schema Valid |
|--------|-----------|---------------|-------------|--------------|
| set_factor_value | Correct | Excellent | operations | Yes |
| add_factor | Correct | Good | operations | Yes |
| add_option | Correct | Good | operations | Yes |
| add_constraint | Correct | Excellent | operations | Yes |
| adjust_edge_strength | Correct | Excellent | operations | Yes |
| remove_factor | Correct | Excellent | operations | Yes |
| set_goal_target | Correct | Good | operations | Yes |
| run_analysis | Correct | Good | blocks + analysis_response | Yes |
| explain_result | Correct | Good | commentary | Yes |
| compare_options | Correct | Good | comparison | Yes |
| what_would_flip | Correct | Good | flip_analysis | Yes |
| challenge_assumption | Correct | Good | text only | Yes |
| run_premortem | Correct | Good | premortem | Yes |
| generate_artefact | Correct | Stub (always blocked) | N/A | Minor issue* |
| draft_graph | Correct | Good | blocks + graph | Yes |

*generate_artefact: Schema enum doesn't include 'custom' which exists in VALID_ARTEFACT_TYPES. Moot since action is permanently blocked.

**draft_graph specific:** Delegates to `handleDraftGraph()` in [orchestrator/tools/draft-graph.ts](src/orchestrator/tools/draft-graph.ts). Requires `ctx.request` (FastifyRequest) — correctly threaded from pipeline at [pipeline-v4.ts:124](src/orchestrator/deterministic/pipeline-v4.ts#L124). TODO at line 62-64: AbortSignal not propagated.

**run_analysis specific:** Uses dynamic import for `handleRunAnalysis` and `createPLoTClient`. Constructs ConversationContext from TurnContext fields. Requires `ctx.analysis_inputs` — returns gracefully if null.

---

## Part 3: Cross-Cutting Concerns

### 3A: Prompt-to-Pipeline Alignment

**P0 Finding #4 — cf-v28 OUTPUT_CONTRACT conflicts with v4 pipeline:**

The PMS prompt (`orchestrator_default` version 1 = `orchestrator-cf-v28.ts`, 57,653 chars) contains an `<OUTPUT_CONTRACT>` section at lines 684-762 instructing the LLM to:

1. Wrap ALL text in `<diagnostics>...<response><assistant_text>...<blocks>...<suggested_actions>...</response>`
2. Include mandatory `<blocks>` and `<suggested_actions>` tags even when empty
3. Use XML escaping for free text
4. Produce AI-authored blocks as XML inside `<blocks>`
5. Produce suggested actions as XML inside `<suggested_actions>`

The v4 pipeline:
- Treats LLM text as **plain conversational text** (streamed directly via `text_delta`)
- Builds blocks **deterministically** from action handlers (not from LLM text)
- Builds chips **deterministically** from TurnContext (not from LLM text)
- Strips XML tags as a "belt-and-braces" measure at normalisation time — **after** the text was already streamed to the user

**Impact:**
- Users see XML tags during streaming (`<diagnostics>`, `<response>`, `<assistant_text>`, etc.)
- LLM wastes ~200+ tokens per response on XML scaffolding
- LLM may produce `<blocks>` content that the pipeline ignores (it uses action handler blocks instead)
- LLM may produce `<suggested_actions>` that the pipeline ignores (it uses deterministic chips instead)
- The prompt's tool instructions reference tools by different names (e.g., `explain_results` in cf-v28 vs `explain_result` in v4 action catalogue)

**The fallback prompt** at [prompt-builder-v2.ts:97-120](src/orchestrator/deterministic/prompt-builder-v2.ts#L97-L120) IS correct for v4 — plain text, tool-use instructions, no XML contract.

**Fix options:**
1. **(Recommended)** Create a v31 prompt: copy the STATIC_PROMPT_FALLBACK and expand it with the behavioral science, communication style, and tool guidance sections from cf-v28, but WITHOUT the OUTPUT_CONTRACT
2. **(Quick interim)** Force `forceDefault: true` in the `loadPrompt()` call at [prompt-builder-v2.ts:60](src/orchestrator/deterministic/prompt-builder-v2.ts#L60) to always use the fallback prompt
3. **(Not recommended)** Add XML parsing to the v4 text pipeline — this defeats the purpose of native tool-use

**Additional alignment issues:**

| cf-v28 instruction | v4 pipeline behaviour | Aligned? |
|--------------------|----------------------|----------|
| Use tool `explain_results` | v4 action is `explain_result` (no trailing 's') | **No** |
| Tool `generate_brief` | v4 action is `generate_artefact` | **No** |
| Tool `sensitivity_analysis` | Not a v4 action | **No** |
| "Six tools are available" | v4 has 14 actions (15 minus stub) | **No** |
| XML blocks in text output | v4 builds blocks from action handlers | **No** |
| XML suggested_actions in text | v4 builds chips deterministically | **No** |

### 3B: Error Handling

| Scenario | Behaviour | Adequate? |
|----------|-----------|-----------|
| Anthropic API non-200 | Stream throws → caught at pipeline-v4.ts:479 → `resolveErrorCode()` → error event + error envelope | **Yes** |
| Tool handler throws | Caught at stream-handler-v4.ts:164 or pipeline-v4.ts:379 → `failedToolCall` → error text appended | **Yes** |
| Adapter timeout | Error message contains 'timeout' → `LLM_TIMEOUT` code | **Yes** |
| User disconnect (AbortSignal) | Signal checked at multiple points (lines 145, 244, 293, 343) → returns cleanly | **Yes** |
| UI error message | "Something went wrong while processing your request. Please try again." — clean, user-friendly | **Yes** |
| Error logging context | request_id, turn_id, error_code, duration_ms, tool_name — sufficient | **Yes** |

### 3C: Feature Flag State

- `CEE_PIPELINE_V4_ENABLED` → `config.features.pipelineV4Enabled` → default `false` ([config/index.ts:299](src/config/index.ts#L299))
- When enabled, v4 routes ALL turns — no fall-through to V2/V3 ([pipeline-stream.ts:109-118](src/orchestrator/pipeline/pipeline-stream.ts#L109-L118))
- No other feature flags directly affect v4 behaviour
- `CEE_CLARIFIER_ENABLED`, `CEE_PREFLIGHT_ENABLED` — these are V3 pipeline features, not v4

**No dead feature flags found** in v4 code.

### 3D: Legacy Code Interaction

| Import | Source | Risk |
|--------|--------|------|
| `sanitiseAssistantHistory` | `./pipeline.ts` (V3) | **Low** — Pure function, no shared state. Handles JSON-envelope history from V3 turns. |
| `assembleMessages` | `../prompt-assembly.ts` | **None** — Shared utility, no V3-specific logic |
| `inferStage` | `../pipeline/phase1-enrichment/stage-inference.ts` | **None** — Pure function, no shared state |
| `computeContextHash` | `../context/context-hash.js` | **None** — Pure function |
| `createGraphPatchBlock` | `../blocks/factory.js` | **None** — Pure factory function |
| `generatePostAnalysisGuidance` | `../guidance/post-analysis.js` | **Low** — Pure function |

No shared mutable state. No race conditions possible. No global config interference.

**However:** The V3 pipeline (`pipeline.ts`) and v4 pipeline both import from `./actions/registry.ts`. The ACTION_CATALOGUE is a `ReadonlyMap` — no mutation risk.

---

## Part 4: causal_claims_diagnostic

**Finding:** `causal_claims_diagnostic` does NOT exist anywhere in `src/`. Searching the entire codebase:

- **In source code:** Zero matches in `src/**/*.ts`
- **In schemas:** `causal_claims` (without `_diagnostic`) exists in `src/schemas/cee-v3.ts:448` and `src/schemas/assist.ts:179` as an LLM output field on the draft_graph response schema (CausalClaimsArraySchema)
- **In trace files:** Found in `trace/01-cee-draft.json` and `trace/01-cee-draft-response.json` — these are V3 pipeline debug traces
- **In worktrees:** Found in `.claude/worktrees/gifted-wu/src/cee/transforms/causal-claims-validation.ts` — a validation module for causal claims from the draft pipeline. Also `.claude/worktrees/gifted-wu/src/schemas/causal-claims.ts`

**Assessment:** `causal_claims` is a **V3 CEE unified pipeline feature** — the draft_graph LLM produces causal claim objects (effect direction, mediation, confounders) that are validated and included in the graph response. The `causal_claims_diagnostic` field referenced in the brief appears to be from a V3 debug bundle or an external evaluator tool, not from v4.

**In v4:** The `draftGraphAction` at [actions/draft-graph.ts](src/orchestrator/deterministic/actions/draft-graph.ts) delegates to `handleDraftGraph()` which runs the full V3 unified pipeline internally. Causal claims are produced and included in the graph output, but no diagnostic summary is surfaced to the v4 response envelope.

**Should it be active?** No. The v4 pipeline correctly delegates draft_graph to the unified pipeline, which handles causal claims internally. A diagnostic field would only be useful for debugging/evaluation, not for the user-facing response.

---

## Findings Summary

### P0 (Blocking)

| # | Finding | File:Line | Fix |
|---|---------|-----------|-----|
| 4 | **cf-v28 OUTPUT_CONTRACT causes XML output in v4 text stream** | prompt-builder-v2.ts:60, orchestrator-cf-v28.ts:684 | Create v31 prompt without OUTPUT_CONTRACT, or force fallback prompt |

### P1 (Important)

| # | Finding | File:Line | Fix |
|---|---------|-----------|-----|
| 1 | **draft_graph not auto-added for empty graph** (`{ nodes: [], edges: [] }` is truthy) | pipeline-v4.ts:184 | Change to `!turnContext.graph \|\| turnContext.graph_summary.node_count === 0` |
| 2 | **XML history pollution** — V3/cf-v28 XML-envelope assistant content passes through to LLM history unchanged | pipeline.ts:960, history-filter-v4.ts | Add XML detection in `sanitiseAssistantHistory()` or `filterHistoryV4()`: if content starts with `<diagnostics>` or `<response>`, extract text between `<assistant_text>` tags |
| 3 | **Chip click downgrade invisible to user** — run_analysis chip in ideate stage silently becomes auto | pipeline-v4.ts:217-222 | Surface the downgrade to the user as text (e.g., "Analysis isn't available yet — the model needs to advance to the evaluate stage") |

### P2 (Improvement)

| # | Finding | File:Line | Fix |
|---|---------|-----------|-----|
| 5 | Overly aggressive entity disambiguation — any shared word triggers target_id suppression | tool-builder.ts:294-310 | Require 2+ shared non-stop-words, or only suppress when the user message references the ambiguous term |
| 6 | Normaliser DEFAULT_TEXT masks text injection failures | response-normaliser.ts:31 | Add telemetry when default text is applied (v4 turns should never reach this) |
| 7 | Chip pre-text duplication guard uses substring match | pipeline-v4.ts:440 | Use exact prefix check instead of `.includes()` |
| 8 | No entity ID replacement in assistant_text | pipeline-v4.ts (absent) | Add post-processing to replace entity IDs with labels in assistant_text |
| 9 | Partial XML text visible during streaming before normalisation | response-normaliser.ts:36 | No fix possible within current architecture — requires prompt fix (P0 #4) |
| 10 | run_analysis not in ideate stage policy | turn-context.ts:53 | Consider adding to ideate policy when `can_run_analysis = true`, or add blocker text |
| 11 | AbortSignal not propagated to draft_graph unified pipeline | actions/draft-graph.ts:62-64 | Add signal parameter when runUnifiedPipeline supports it |

### Investigation

| # | Finding | Notes |
|---|---------|-------|
| 12 | `causal_claims_diagnostic` not in v4 | V3 debug concept. Not needed in v4. |
| 13 | cf-v28 tool names don't match v4 action names | `explain_results` vs `explain_result`, `generate_brief` vs `generate_artefact`, etc. Impact depends on P0 #4 resolution — if prompt is replaced, tool names should match v4 catalogue. |

---

## Recommended Fix Priority

1. **Fix P0 #4 first** (prompt) — this unblocks all v4 testing. Quick interim: change `loadPrompt('orchestrator', { forceDefault: false })` to `forceDefault: true` at [prompt-builder-v2.ts:60](src/orchestrator/deterministic/prompt-builder-v2.ts#L60).
2. **Fix P1 #1** (empty graph draft_graph) — one-line fix, high user impact.
3. **Fix P1 #2** (XML history) — add XML detection to sanitiseAssistantHistory.
4. **Fix P1 #3** (chip downgrade) — add user-facing feedback text.
5. P2 fixes can be batched into a follow-up.

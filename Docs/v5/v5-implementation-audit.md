# V5 Implementation Audit

**Date:** 2026-04-23
**Branch:** `staging`
**Scope:** Complete trace of the V5 TurnExecutor path from HTTP request to HTTP response, with exact code references. What the code actually implements, not what the spec says.

---

## Part 1: The Full V5 Request Lifecycle

### 1.1 Route Registration

**File:** `src/server.ts:955-959`

```typescript
if (config.features.orchestratorV5) {
  await ceeOrchestratorRouteV2(app);
  app.log.info({}, 'V5 orchestrator scaffold registered (POST /orchestrate/v2/turn)');
}
```

Import at `src/server.ts:63`:
```typescript
import { ceeOrchestratorRouteV2 } from "./orchestrator/route-v2.js";
```

The route is gated on `config.features.orchestratorV5`. When off, the endpoint returns 404.

### 1.2 Route Handler

**File:** `src/orchestrator/route-v2.ts:176`

```typescript
app.post('/orchestrate/v2/turn', async (req, reply) => {
```

### 1.3 Pre-Flight (All Branches)

**File:** `src/orchestrator/route-v2.ts:183-187`

```typescript
const pre = await runPreFlight(req);
if (!pre.ok) {
  return reply.code(pre.status).send(pre.error);
}
const { requestId, ingress, extensions } = pre.context;
```

**Pre-flight implementation:** `src/orchestrator/route-v2-preflight.ts`

Three sequential checks:
1. **Extension parse** — `parseRequestExtensions()` extracts `graph_state`, `analysis_state`, `user_id` from the request body. Returns 422 on validation failure.
2. **B1 ingress validation** — `validateIngress()` validates the core `OrchestratorTurnPayload` (discriminated union on `kind`). Returns 422 on failure.
3. **Scenario upsert** — `preflightEnsureScenario()` (`src/orchestrator-v5/build-turn-context.ts:214-253`) idempotently creates the scenario row. Returns 422 only on cross-tenant ownership mismatch.

Output: `PreFlightContext` with `requestId`, `ingress` (parsed payload), `extensions` (graph/analysis state).

### 1.4 Dispatch Branches (Mutually Exclusive, Checked in Order)

Every branch runs AFTER pre-flight. The route checks them in this order — first match wins, remainder falls through to TurnExecutor.

---

#### Branch A: System Event (Deterministic, No LLM)

**Guard:** `src/orchestrator/route-v2.ts:204`
```typescript
if (ingress.kind === 'system_event') {
```

**Trigger:** `kind === 'system_event'` on the ingress payload.

**Handler:** `dispatchSystemEvent()` at `src/orchestrator-v5/system-events/dispatch.ts`

**Events:** `undo`, `redo`, `patch_accepted`, `patch_dismissed`, `direct_graph_edit`, `chip_click`

**Commit semantics:**
- `patch_accepted`, `patch_dismissed`, `direct_graph_edit`, `chip_click` → commit via `commitDirectAnswer()`
- `undo`, `redo` → NO commit (returns `commitSkippedReason: 'client_only_event'`; route recognises and returns 200)

**Response:** Empty `OlumiResponse` (silent acknowledgement).

**Post-commit:** `src/orchestrator/route-v2.ts:209-236` — if commit failed and no skip reason, returns 500 BoundaryError. Otherwise egress validation → 200.

---

#### Branch B: Chip-Click Run Analysis (Deterministic Handler, No Sonnet)

**Guard:** `src/orchestrator/route-v2.ts:255-258`
```typescript
const isChipClickRunAnalysis =
  ingress.source === 'chip_click' &&
  ingress.chip?.action_type === 'run_analysis';
if (isChipClickRunAnalysis) {
```

**Trigger:** `source === 'chip_click'` AND `chip.action_type === 'run_analysis'`. Explicit user signal — no ambiguity.

**Handler:** `dispatchChipClickRunAnalysis()` at `src/orchestrator-v5/handlers/chip-click-dispatch.ts`

**Steps:**
1. `buildTurnContext(payload, requestId)` — loads prior turns + facts from SessionStore
2. `resolveHandler(registry, 'run_analysis')` — looks up the handler
3. Execute handler with context/payload/requestId/signal
4. `enrichRunAnalysisWithDecisionReview()` — V5 Group 1 Task B auto-fire
5. `composeToolCallResponse()` — orientation + confirmation + blocks from handler facts
6. `commitDirectAnswer()` — persist turn

**Discriminated output:** `outcome: 'ok' | 'commit_failed' | 'handler_failure' | 'handler_result_invalid'`

**Post-commit:** `src/orchestrator/route-v2.ts:267-325` — each outcome maps to distinct wire response (500 BoundaryError or 200 via egress validation).

---

#### Branch C: Draft Graph (Pre-Sonnet, V4 Bridge)

**Guard:** `src/orchestrator/route-v2.ts:348-353`
```typescript
const isDraftGraphShape =
  ingress.stage === 'frame' &&
  extensions.graphState == null &&
  ingress.message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
  DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(ingress.message);
```

**Trigger conditions (ALL must hold):**
- `stage === 'frame'`
- No `graph_state` in request (nothing to edit yet)
- `message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH`
- Message matches decision-brief regex (at `route-v2.ts:159-160`):
  ```
  /\b(should|shall|whether|versus|vs\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\b|\?$/i
  ```

**Handler:** `dispatchDraftGraph()` at `src/orchestrator-v5/handlers/draft-graph-dispatch.ts:144-226`

**Steps:**
1. Calls V4 pipeline: `handleDraftGraph(payload.message, request, payload.turn_id)` (imported from `src/orchestrator/tools/draft-graph.js` at line 54)
2. Commits with graph: `commitDirectAnswer(response, { graph: draftResult.graphOutput })` — atomic graph + turn persist
3. Composes response: `draftResultToOlumiResponse()` — includes `draft_graph` inline (FINAL post-repair graph) and `analysis_ready` when available
4. `stage_indicator` advances to `'analyse'` ONLY when `graphPersisted === true`

**V4 bridge:** Direct call to `handleDraftGraph()` — no schema changes, no handler registry entry.

**Post-commit:** `src/orchestrator/route-v2.ts:360-401` — commit failure → 500, success → egress validation → 200.

---

#### Branch D: Edit Graph (Pre-Sonnet, V4 Bridge)

**Guard:** `src/orchestrator/route-v2.ts:421-425`
```typescript
const isEditGraphShape =
  extensions.graphState != null &&
  (ingress.stage === 'analyse' || ingress.stage === 'decide') &&
  EDIT_GRAPH_POSITIVE_REGEX.test(ingress.message) &&
  !EDIT_GRAPH_NEGATIVE_REGEX.test(ingress.message);
```

**Trigger conditions (ALL must hold):**
- `graph_state` present (something to edit)
- `stage` in `{analyse, decide}`
- Positive regex match (`route-v2.ts:163-164`):
  ```
  /\b(change|update|edit|modify|remove|delete|add|adjust|set|reduce|increase|decrease|tweak|raise|lower)\b/i
  ```
- Negative regex does NOT match (`route-v2.ts:172-173`):
  ```
  /\b(explain|compare|what would|flip|why|how does|tell me|show me|describe)\b/i
  ```

**Handler:** `dispatchEditGraph()` at `src/orchestrator-v5/handlers/edit-graph-dispatch.ts:181-254`

**Steps:**
1. Convert ingress → V4 types:
   - `graphStateToGraphV3()` (line 110-151) — Zod strict parse with structural fallback
   - `analysisIngressToV2Envelope()` (line 163-179)
   - `mapStageToDecisionStage()` (line 42-55) — `analyse→evaluate`, `decide→decide`, `review→optimise`
   - Build `ConversationContext` with graph/analysis/framing/messages
2. Resolve adapter: `getAdapter('edit_graph')` (line 195)
3. Call V4 pipeline: `handleEditGraph(context, message, adapter, requestId, turn_id)` (line 199-205)
4. Compose: `editResultToOlumiResponse()` (line 72-89) — text-only, no blocks, no graph patch
5. Commit: `commitDirectAnswer()` (line 220-232)

**V4 bridge:** Direct call to `handleEditGraph()` — imported from `src/orchestrator/tools/edit-graph.js` at line 24.

**Post-commit:** `src/orchestrator/route-v2.ts:440-475` — commit failure → 500, success → egress validation → 200.

---

#### Branch E: TurnExecutor Fallthrough (Sonnet Routing)

**Entry:** `src/orchestrator/route-v2.ts:483-486`
```typescript
const run = await runTurnExecutor(ingress, requestId, {
  graphState: extensions.graphState,
  analysisState: extensions.analysisState,
});
```

This is the fallthrough — fires when none of the above branches match.

**Implementation:** `src/orchestrator-v5/turn-executor.ts:200-1049`

**Seven-step assembly:**

| Step | Name | Lines | What It Does | Input | Output |
|------|------|-------|-------------|-------|--------|
| 0 | Pre-flight graph | 249-336 | Build GraphLookup from graphState (or load from DB) | `options.graphState` | `graphLookupForValidate`, `graphStateForTurn` |
| 1 | ORIENT | 338-422 | Assemble ContextPack + call Sonnet | payload, priorTurns, graph, analysis, coaching | `RoutingResult` (tool_call or text_only) |
| 2 | VALIDATE | 458-570 | Validate tool call against graph + registry | `ProposalAction`, `GraphLookup` | pass/fail with typed error code |
| 3 | EXECUTE | 572-606 | Invoke handler via registry | `HandlerInvocation` | `HandlerOutcome` |
| 4 | CONFIRM | 609 | Render confirmation text from handler's template | `handlerId`, `HandlerOutcome` | confirmation string |
| 5 | COACH | 612-655 | Detect coaching signal (deterministic) | `handlerId`, outcome, contextPack, priorFacts | optional coaching text + signal_id |
| 6 | COMPOSE | 657-745 | Build OlumiResponse from routing result | orientation + confirmation + coaching + facts | `OlumiResponse` |
| 7 | COMMIT | 750-776 | Persist via `append_turn_atomic` | `OlumiResponse` + `CommitMetadata` | `CommitResult` |

Steps 2-5 only fire on `intent_class === 'execute'`. Steps 6-7 fire for all intents.

### 1.5 Post-Commit (All Branches)

**File:** `src/orchestrator/route-v2.ts:505-551`

1. **Commit-status check FIRST** (line 505): `commit_performed === false` → 500 + BoundaryError. This is the fail-closed invariant.
2. **Egress validation SECOND** (line 542): `validateEgress(run.response, requestId)` → 200 + validated response, or 200 + fallback envelope on schema drift.

---

## Part 2: What Sonnet Actually Sees

### 2a: System Prompt

**File:** `src/orchestrator-v5/routing/route-with-tool-use.ts:131-143`

```
You are Olumi's routing layer. You receive a ContextPack and a user turn. Your single job is to decide the intent:

- Call the olumi_action tool with intent_class="execute" when an action is needed.
- Call the olumi_action tool with intent_class="clarify" when the turn is ambiguous and you cannot safely act.
- Respond with plain text (no tool call) for conversational turns.
- Call the olumi_action tool with intent_class="coach" to mark the turn as coaching — the user-facing text you emit alongside is the coaching response.

Rules:
- When calling the tool on execute turns, you may accompany it with SHORT pre-action orientation text (context, not outcomes). Never narrate results you have not seen.
- When resolving entities, cite which ContextPack fields you used in cited_context_fields.
- When the user's request is ambiguous (entity, parameter, intent, scope, or missing context), prefer clarify over a guessed execute.
- Do not invent entities or parameters not present in the ContextPack.
```

This is the COMPLETE system prompt. It is:
- 13 lines / ~145 tokens
- Routing-only — no domain knowledge, no stage descriptions, no handler inventory
- No mention of what Olumi is, what decisions it helps with, what stages mean
- Relies entirely on the ContextPack JSON for Sonnet to infer available actions

### 2b: Messages Array

**File:** `src/orchestrator-v5/routing/route-with-tool-use.ts:287-295`

```typescript
const userMessage = buildUserMessage(contextPack, message);

const firstCallArgs: ChatWithToolsArgs = {
  system: ROUTING_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: userMessage }],
  tools: [OLUMI_ACTION_TOOL],
  tool_choice: { type: 'auto' },
  temperature: 0,
};
```

**User message construction** (`route-with-tool-use.ts:429-437`):
```typescript
function buildUserMessage(contextPack: ContextPack, message: string): string {
  return [
    '## ContextPack',
    JSON.stringify(contextPack, null, 2),
    '',
    '## User turn',
    message,
  ].join('\n');
}
```

**Structure of what Sonnet sees:**

```
[System] ROUTING_SYSTEM_PROMPT (13 lines)

[User]
## ContextPack
{
  "version": "2.0",
  "stage": "analyse",
  "graph": { "nodes": [...], "edges": [...], "options": [...], "goals": [...], "constraints": [...], "counts": {...} },
  "analysis": { "status": "...", "leading_option": "...", ... } | null,
  "conversation": { "recent_turns": [...], "turn_count": N, "last_tool_used": "...", "pending_confirmation": false },
  "coaching": { "draft_coaching": ... | null, "decision_review": ... | null, "last_coaching_signal": ... | null },
  "compound_detected": false,
  "compound_pattern_matched": null,
  "parsed_quantities": [...],
  "system_event": null
}

## User turn
<current user message text>

[Tools] OLUMI_ACTION_TOOL definition
```

Key facts:
- **Single user message** — no multi-turn conversation in `messages[]`
- **All history is embedded inside ContextPack JSON** — not as separate message turns
- **temperature: 0** — deterministic routing
- **tool_choice: auto** — Sonnet decides tool use vs text-only

### 2c: Tool Schema

**File:** `src/orchestrator-v5/routing/tool-schema.ts:35-182`

```typescript
export const OLUMI_ACTION_TOOL = {
  name: 'olumi_action',
  description:
    'Route a user turn to one of four intents: execute (take an action), ' +
    'clarify (ask a question), converse (chat), coach (coaching turn). ' +
    'Call this tool when an action is needed or clarification is required; ' +
    'respond with text only for conversational/coaching turns.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent_class: {
        type: 'string',
        enum: ['execute', 'clarify', 'converse', 'coach'],
        description: 'Top-level routing intent.',
      },
      coaching_mode: {
        type: 'string',
        enum: ['reframe', 'challenge', 'deepen', 'summarise'],
        description:
          'Coaching stance. Required when intent_class === "coach", omitted otherwise.',
      },
      action: {
        type: 'object',
        additionalProperties: false,
        description: 'Concrete action payload. Required when intent_class === "execute".',
        properties: {
          handler_id: { type: 'string' },        // ← FREE STRING, NO ENUM
          entity: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['node', 'edge', 'option', 'goal', 'constraint'],
              },
              label: { type: 'string' },
              resolution_status: {
                type: 'string',
                enum: ['resolved', 'ambiguous', 'unresolved'],
              },
              resolution_method: {
                type: 'string',
                enum: ['id_match', 'label_match', 'kind_inference', 'context_inference'],
              },
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, label: { type: 'string' } },
                  required: ['id', 'label'],
                },
              },
            },
            required: ['id', 'kind', 'resolution_status', 'resolution_method'],
          },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                value: {
                  anyOf: [
                    { type: 'number' },
                    { type: 'string' },
                    { type: 'boolean' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        value: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] },
                        raw_value: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] },
                        unit: { type: 'string' },
                        cap: { type: 'number' },
                      },
                      required: ['value'],
                    },
                  ],
                },
                operator: {
                  type: 'string',
                  enum: ['set', 'increase', 'decrease', 'multiply'],
                },
                source: { type: 'string', enum: ['user_explicit', 'inferred', 'default'] },
                unit: { type: 'string' },
              },
              required: ['name', 'value', 'source'],
            },
          },
          cited_context_fields: { type: 'array', items: { type: 'string' } },
        },
        required: ['handler_id', 'entity'],
      },
      clarification: {
        type: 'object',
        additionalProperties: false,
        description: 'Clarification payload. Required when intent_class === "clarify".',
        properties: {
          ambiguity_type: {
            type: 'string',
            enum: ['entity', 'parameter', 'intent', 'scope', 'missing_context'],
          },
          question: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { id: { type: 'string' }, label: { type: 'string' } },
              required: ['id', 'label'],
            },
          },
        },
        required: ['ambiguity_type', 'question'],
      },
    },
    required: ['intent_class'],
  },
};
```

**Critical observation:** `handler_id` is `{ type: 'string' }` — a free string with NO enum restriction. Sonnet can propose ANY handler ID. The system prompt does not tell Sonnet which handlers exist. The only signal is what Sonnet can infer from the ContextPack structure.

### 2d: Token Budget Breakdown (Estimate)

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt | ~145 |
| Tool schema (OLUMI_ACTION_TOOL) | ~650 |
| ContextPack JSON (10-node graph, 5 prior turns, analysis, coaching) | ~4,000–6,000 |
| User message | ~50–200 |
| **Total input** | **~5,000–7,000** |

The ~9,400 input tokens seen in staging logs would be consistent with a larger graph (15+ nodes) or verbose node labels/descriptions in the graph JSON.

---

## Part 3: What Context Reaches Sonnet

### 3a: Graph Context

**Assembly:** `src/orchestrator-v5/context/context-pack-assembler.ts:197-222`

```typescript
function projectGraph(graph: GraphWithOptions | null): ContextPackGraph {
  if (graph === null) return EMPTY_GRAPH;

  const nodes = graph.nodes;                    // FULL raw nodes — no filtering
  const edges = graph.edges;                    // FULL raw edges
  const options = graph.options ?? nodes
    .filter((node) => node.kind === 'option')
    .map((node) => ({ id: node.id, label: ... }));
  const goals = nodes.filter((n) => n.kind === 'goal');
  const constraints = graph.goal_constraints ?? [];

  return { nodes, edges, options, goals, constraints, counts: { ... } };
}
```

**Format:** Full JSON passthrough. Every node with all its fields (id, kind, label, value, provenance, etc.), every edge with all its fields (from, to, strength, exists_probability, effect_direction), plus derived options/goals/constraints lists.

**Source on follow-up turns:** When `graphState` is absent from the request body, `loadPersistedGraph()` at `src/orchestrator-v5/build-turn-context.ts:267-282` loads the graph from the Supabase `scenarios.graph` column.

**Token impact:** The full graph JSON is the largest variable contributor to token count. A 10-node graph with edges can easily be 2,000-4,000 tokens. The V4 `compactGraph()` utility at `src/orchestrator/context/graph-compact.ts` exists (produces ~800-1,200 tokens for 10 nodes) but is NOT used in the V5 path.

### 3b: Analysis Context

**Assembly:** `src/orchestrator-v5/turn-executor.ts:348-350`

```typescript
const analysisSummary = options.analysisState
  ? compactAnalysis(coerceIngressAnalysis(options.analysisState))
  : null;
```

Then projected via `src/orchestrator-v5/context/context-pack-assembler.ts:224-239`:

```typescript
function projectAnalysis(analysis: AnalysisResponseSummary | null): ContextPackAnalysis | null {
  if (analysis === null) return null;

  const sortedOptions = [...analysis.options].sort((a, b) => b.win_probability - a.win_probability);
  return {
    status: analysis.analysis_status,
    leading_option: sortedOptions[0]?.option_label ?? null,
    runner_up: sortedOptions[1]?.option_label ?? null,
    robustness_band: analysis.robustness_level,
    top_drivers: analysis.top_drivers.map((d) => d.factor_label),
    fragile_edges: (analysis.top_fragile_edges ?? []).map((e) => `${e.from_label} → ${e.to_label}`),
    staleness_reason: null,
  };
}
```

**Format:** Compacted summary — NOT the full analysis envelope. Fields: `status`, `leading_option`, `runner_up`, `robustness_band`, `top_drivers` (labels only), `fragile_edges` (from→to labels).

**Source:** From the HTTP request body `analysisState`. Analysis is NOT persisted or reloaded from the database — it must be re-supplied in every request body if available.

**When absent:** Sonnet sees `"analysis": null` in the ContextPack.

### 3c: Conversation History

**Assembly:** `src/orchestrator-v5/context/context-pack-assembler.ts:242-265`

```typescript
function projectConversation(
  priorTurns: readonly SessionTurn[],
  pendingConfirmation: boolean,
): ContextPackConversation {
  const recent = priorTurns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP).map((turn) => ({
    turn_id: turn.turn_id,
    turn_class: turn.turn_class,
    handler_id: turn.handler_id,
    created_at: turn.created_at,
  }));
  const lastTool = priorTurns.find((t) => t.turn_class === 'handler' && t.handler_id !== null);
  return {
    recent_turns: recent,
    turn_count: priorTurns.length,
    last_tool_used: lastTool?.handler_id ?? null,
    pending_confirmation: pendingConfirmation,
  };
}
```

**Cap:** `CONTEXT_PACK_RECENT_TURNS_CAP = 5` (line 41)

**Format:** Metadata only — `turn_id`, `turn_class`, `handler_id`, `created_at`. **NO user message text. NO assistant response text.**

Sonnet sees something like:
```json
{
  "recent_turns": [
    { "turn_id": "abc-123", "turn_class": "handler", "handler_id": "run_analysis", "created_at": "2026-04-23T10:00:00Z" },
    { "turn_id": "def-456", "turn_class": "direct_answer", "handler_id": null, "created_at": "2026-04-23T09:55:00Z" }
  ],
  "turn_count": 7,
  "last_tool_used": "run_analysis",
  "pending_confirmation": false
}
```

**Source:** `SessionStore.readRecent()` via `fetchPriorTurns()` at `src/orchestrator-v5/build-turn-context.ts:120-143`. Ordered by `created_at DESC` (most recent first).

**Implication for prompt design:** Sonnet has NO ability to reference prior user messages or prior assistant responses. It cannot say "as you mentioned earlier" or "building on my previous suggestion". It knows WHAT actions were taken (via turn_class/handler_id) but not WHY or WHAT was said.

### 3d: Coaching Signals

**Assembly:** `src/orchestrator-v5/turn-executor.ts:352-362`

```typescript
const coachingCache = await readCoachingCache(
  context.session_id,
  context.prior_facts,
);
```

**CoachingCache structure** (from `src/orchestrator-v5/coaching/types.ts`):

```typescript
interface CoachingCache {
  readonly draft_coaching: DraftCoaching | null;
  readonly decision_review: DecisionReviewOutput | null;
  readonly last_coaching_signal: LastCoachingSignal | null;
}
```

**Sources** (from `src/orchestrator-v5/coaching/coaching-cache-reader.ts`):

1. **`draft_coaching`** — from sidecar file `logs/v5-draft-graph-coaching.jsonl`, keyed by scenario_id. Contains: `summary`, `strengthen_items`, `widening_log`, `bias_signals`.

2. **`decision_review`** — from the most recent `run_analysis` handler fact's `enrichment.decision_review`. Contains the LLM-generated decision review text with `produced_at` timestamp.

3. **`last_coaching_signal`** — merged from two sources (newest wins by `produced_at`):
   - run_analysis enrichment: `coaching_signal_id` (e.g., `FIRST_ANALYSIS_COMPLETE`)
   - Per-scenario sidecar: `STALE_ANALYSIS_AFTER_EDIT`, `HIGH_SENSITIVITY_EDIT`

**Signal detection** (from `src/orchestrator-v5/signals/coaching-signals.ts`):
- `STALE_ANALYSIS_AFTER_EDIT` — edit handler with prior successful analysis
- `HIGH_SENSITIVITY_EDIT` — edit handler of a top driver factor
- `FIRST_ANALYSIS_COMPLETE` — run_analysis handler with no prior analysis success

At most one signal per action turn.

### 3e: CQE (Contextual Quantity Extraction)

**Assembly:** `src/orchestrator-v5/context/context-pack-assembler.ts:177`

```typescript
const extraction = runExtraction(input.payload.message);
```

**Format:** Pre-parsed numeric quantities from the user message. Sonnet uses these instead of doing arithmetic.

```json
"parsed_quantities": [
  { "value": 50000, "unit": "dollars", "raw_value": "50k", ... }
]
```

### 3f: Compound Intent Detection

**Assembly:** `src/orchestrator-v5/context/context-pack-assembler.ts:176`

```typescript
const compound = detectCompound(input.payload.message);
```

**Format:** Boolean flag + segments when detected.

```json
"compound_detected": true,
"compound_segments": ["change the budget to 50k", "run the analysis"],
"compound_pattern_matched": "and"
```

---

## Part 4: Handler Registry and Dispatch

### 4a: Runtime Handler Registry

**File:** `src/orchestrator-v5/tools/registry.ts:165-173`

```typescript
export function createRegistry(overrides?: RegistryOverrides): HandlerRegistry {
  const plotClient = overrides?.plotClient ?? resolvePlotClient();
  const scenarioReader = overrides?.scenarioReader ?? DEFAULT_SCENARIO_READER;
  const runAnalysis = createRunAnalysisHandler({ plotClient, scenarioReader });
  return new Map<V5ActionType, HandlerFn>([['run_analysis', runAnalysis]]);
}
```

**Only one handler is registered: `run_analysis`.**

Implementation: `src/orchestrator-v5/tools/handlers/run-analysis.ts`

### 4b: Validation Registry

**File:** `src/orchestrator-v5/routing/validation-registry.ts:45-57`

```typescript
export const HANDLER_VALIDATION_REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option', 'goal'],
    preconditions: runAnalysisPrecondition,
    confirmation_template: 'Ran analysis on your current scenario.',
  },
};
```

**Only one handler is declared: `run_analysis`.**

Precondition: at least one option node in the graph (line 37-43).

### 4c: V5ActionType (Schema)

**File:** `@talchain/schemas/dist/boundary/enums.js`

```typescript
export const ActionType = z.enum([
  'run_analysis',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
  'explain_result',
  'compare_options',
  'what_would_flip',
]);
```

**7 values declared in the schema.**

### 4d: Tool Schema handler_id

**File:** `src/orchestrator-v5/routing/tool-schema.ts:62`

```typescript
handler_id: { type: 'string' },
```

**Free string — no enum.** Sonnet can propose any handler ID string.

### 4e: Parity Check

| handler_id | In V5ActionType | In Runtime Registry | In Validation Registry | In Tool Schema | Reachable? |
|------------|----------------|--------------------|-----------------------|---------------|------------|
| `run_analysis` | Yes | Yes | Yes | Yes (free string) | Yes — full TurnExecutor path |
| `set_factor_value` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `add_constraint` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `adjust_edge_strength` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `explain_result` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `compare_options` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `what_would_flip` | Yes | **No** | **No** | Yes (free string) | **No** — HANDLER_NOT_FOUND → unsupported coaching |
| `draft_graph` | **No** | **No** | **No** | Yes (free string) | Pre-Sonnet dispatch only |
| `edit_graph` | **No** | **No** | **No** | Yes (free string) | Pre-Sonnet dispatch only |
| `add_option` | **No** | **No** | **No** | Yes (free string) | **No** — unsupported-action-response knows it (structural) |
| `add_factor` | **No** | **No** | **No** | Yes (free string) | **No** — unsupported-action-response knows it (structural) |
| `remove_factor` | **No** | **No** | **No** | Yes (free string) | **No** — unsupported-action-response knows it (structural) |
| `add_node` | **No** | **No** | **No** | Yes (free string) | **No** — unsupported-action-response knows it (structural) |
| `remove_node` | **No** | **No** | **No** | Yes (free string) | **No** — unsupported-action-response knows it (structural) |
| Any other string | **No** | **No** | **No** | Yes (free string) | **No** — unsupported generic fallback |

**Summary:**
- 6 of 7 V5ActionType values have no registered handler
- Tool schema advertises unlimited handler IDs (free string)
- The unsupported-action response composer at `src/orchestrator-v5/compose/unsupported-action-response.ts` handles ~20 known handler IDs with category-specific coaching text (structural / value_change / analysis_dep)
- Unknown handler IDs get generic fallback text

### 4f: Pre-TurnExecutor Dispatch Branches

| Branch | Trigger | V4 Code Called | Bypasses Registry? | Overlap with TurnExecutor? |
|--------|---------|---------------|-------------------|--------------------------|
| system_event | `kind === 'system_event'` | No — deterministic | Yes — no handler lookup | No — system events have no `message` field |
| chip_click run_analysis | `source === 'chip_click' && chip.action_type === 'run_analysis'` | No — uses V5 registry | No — looks up `run_analysis` | No — chip_click source is distinct |
| draft_graph | `stage=frame, no graph, long msg, decision regex` | `handleDraftGraph()` from V4 | Yes — completely | No — stage=frame + no graph = TurnExecutor can't draft |
| edit_graph | `graph present, stage in {analyse,decide}, edit regex, no negative regex` | `handleEditGraph()` from V4 | Yes — completely | **YES** — if edit regex doesn't match but TurnExecutor receives the turn, Sonnet could propose `set_factor_value` → HANDLER_NOT_FOUND |

**Critical overlap:** A message like "change the marketing budget to $50k" with `stage=analyse` and graph present:
- If EDIT_GRAPH_POSITIVE_REGEX matches "change" → edit_graph dispatch → V4 handler
- If the message were "I think the marketing budget should be $50k" (no edit verb) → TurnExecutor → Sonnet proposes `set_factor_value` → HANDLER_NOT_FOUND → unsupported coaching ("Direct value updates like set factor value aren't available through chat yet. You can adjust values in the inspector panel...")

Both paths handle the same intent but through completely different code paths with different user experiences.

---

## Part 5: V4 Code Still in Use on V5 Paths

### 5a: V4 Bridges

| V5 File | V4 Import | What It Calls | Purpose |
|---------|-----------|---------------|---------|
| `handlers/draft-graph-dispatch.ts:54` | `../../orchestrator/tools/draft-graph.js` | `handleDraftGraph(message, request, turn_id)` | V4 unified pipeline for first-time brief submission |
| `handlers/edit-graph-dispatch.ts:24` | `../../orchestrator/tools/edit-graph.js` | `handleEditGraph(context, message, adapter, requestId, turn_id)` | V4 unified pipeline for graph edits |
| `tools/registry.ts:82` | `../../orchestrator/plot-client.js` | `createPLoTClient()` | PLoT HTTP client factory for run_analysis handler |
| `turn-executor.ts:106` | `../../orchestrator/context/analysis-compact.js` | `compactAnalysis()` | Compact analysis envelope → summary for ContextPack |
| `context/graph-hash.ts:82` | `../../orchestrator/context/stable-stringify.js` | `stableStringify()` | Deterministic graph hashing for validation drift detection |
| `context/context-pack-assembler.ts:31` | `../../orchestrator/context/analysis-compact.js` | `AnalysisResponseSummary` (type only) | Type import for analysis projection |
| `coaching/types.ts:15` | `../../orchestrator/tools/draft-graph.js` | `StrengthenItem` (type only) | Type import for coaching signal enrichment |

### 5b: V4 Type Imports

| V5 File | V4 Module | Types Imported |
|---------|-----------|---------------|
| `turn-executor.ts:105` | `../../orchestrator/types.js` | `V2RunResponseEnvelope` |
| `tools/handlers/run-analysis.ts:49-51` | `../../orchestrator/types.js` | `V2RunResponseEnvelope` |
| `tools/handlers/run-analysis.ts:49-51` | `../../orchestrator/plot-client.js` | `PLoTClient`, `PLoTError`, `PLoTTimeoutError` |
| `handlers/edit-graph-dispatch.ts:27-32` | `../../orchestrator/types.js` | `ConversationContext`, `DecisionStage`, `GraphV3T`, `V2RunResponseEnvelope` |

### 5c: Assessment

The V4 bridges are **intentional and documented** — `draft_graph` and `edit_graph` are NOT in V5ActionType by design. They use the existing V4 unified pipeline because the V5 handler registry doesn't have implementations for them yet.

The V4 type imports (`V2RunResponseEnvelope`, `GraphV3T`, `ConversationContext`) are structural dependencies from the shared schema layer. These are stable types that both V4 and V5 consume.

The PLoT client import in the handler registry is an infrastructure dependency — the run_analysis handler calls PLoT, which is a shared service regardless of V4/V5.

**No problematic legacy contamination found.** All V4 usage is intentional, documented, and structurally sound.

---

## Part 6: Response Composition

### 6a: Compose Functions

**File:** `src/orchestrator-v5/compose.ts`

**Three standard composers:**

```typescript
// Direct answer / converse / coach (line 22-31)
function composeDirectAnswerResponse(input: ComposeInput): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: input.assistant_text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };
}

// Clarify (line 33-42) — structurally identical to direct answer
function composeClarifyResponse(input: ComposeInput): OlumiResponse { ... }

// Tool call / execute (line 76-94)
function composeToolCallResponse(input: ComposeToolCallInput): OlumiResponse {
  const pieces: string[] = [];
  const trimmedOrientation = input.orientation.trim();
  const trimmedConfirmation = input.confirmation.trim();
  if (trimmedOrientation) pieces.push(trimmedOrientation);
  if (trimmedConfirmation) pieces.push(trimmedConfirmation);
  if (input.coaching) pieces.push(input.coaching.trim());

  const blocks = input.handlerFacts ? buildBlocksFromFacts(input.handlerFacts) : [];

  return {
    response_version: 2,
    assistant_text: pieces.join('\n\n'),
    blocks,
    suggested_actions: [],         // ← ALWAYS EMPTY
    insights: [],                  // ← ALWAYS EMPTY
    stage_indicator: input.stage,
  };
}
```

**Two special composers:**

1. **`draftResultToOlumiResponse()`** at `src/orchestrator-v5/handlers/draft-graph-dispatch.ts:84-142` — adds `draft_graph` and `analysis_ready` fields to the response.

2. **`composeUnsupportedActionResponse()`** at `src/orchestrator-v5/compose/unsupported-action-response.ts:95-117` — produces coaching text + chips pointing at available actions.

### 6b: Where Response Fields Come From

| Field | Source | Notes |
|-------|--------|-------|
| `response_version` | Hardcoded `2` | Immutable |
| `assistant_text` | **Execute:** Sonnet orientation + handler confirmation template + coaching text, joined with `\n\n`. **Converse/coach/clarify:** Sonnet's text output (sanitised). **Draft graph:** V4 pipeline narration or node/edge count fallback. **Edit graph:** V4 pipeline narration or status fallback. | All text runs through `sanitiseNarrateOutput()` for contamination detection |
| `blocks` | `buildBlocksFromFacts()` — only `run_analysis` facts produce `analysis_result` blocks (line 102-118) | Empty on non-execute turns, draft, and edit |
| `suggested_actions` | Always `[]` in the three standard composers. Only `composeUnsupportedActionResponse()` and `composeValidationFailure()` emit chips. | **Normal success turns produce NO chip suggestions** |
| `insights` | Always `[]` | Reserved for future |
| `stage_indicator` | From `payload.stage`. Only `draftResultToOlumiResponse` advances it to `'analyse'` when `graphPersisted === true`. | TurnExecutor never changes the stage |
| `draft_graph` | Only from `draftResultToOlumiResponse()` — inline graph when graphPersisted | Not present on TurnExecutor paths |
| `analysis_ready` | Only from `draftResultToOlumiResponse()` — pre-analysis panel state | Not present on TurnExecutor paths |

### 6c: Field Population for Typical Follow-up Turn

**Scenario: User says "run the analysis" on a graph with options**

| Field | Value |
|-------|-------|
| `response_version` | `2` |
| `assistant_text` | Sonnet's orientation text + "Ran analysis on your current scenario." |
| `blocks` | `[{ type: 'analysis_result', summary: '...', leading_option_id: '...', win_probabilities: {...}, enrichment: {...} }]` |
| `suggested_actions` | `[]` |
| `insights` | `[]` |
| `stage_indicator` | Whatever stage was sent in the request (unchanged) |

**Scenario: User says "what would happen if I increased marketing?" (conversational)**

| Field | Value |
|-------|-------|
| `response_version` | `2` |
| `assistant_text` | Sonnet's text-only response |
| `blocks` | `[]` |
| `suggested_actions` | `[]` |
| `insights` | `[]` |
| `stage_indicator` | Whatever stage was sent in the request (unchanged) |

---

## Part 7: Issues and Recommendations

### Issue 1: No handler_id Enum in Tool Schema

**Severity:** Medium — causes unnecessary HANDLER_NOT_FOUND roundtrips

**What:** `handler_id` in the tool schema is `{ type: 'string' }`. Sonnet can propose any handler ID, and only `run_analysis` is actually registered. Every other proposal hits HANDLER_NOT_FOUND → unsupported coaching.

**Impact:** On turns where Sonnet reasonably infers the user wants to change a value (e.g., "set marketing to 50k"), it proposes `set_factor_value`, which fails validation. The user sees a polite coaching response instead of the action they requested.

**Recommendation:** Either:
- (a) Add `enum: ['run_analysis']` to the tool schema so Sonnet knows the only available action, or
- (b) Add the available handler list to the system prompt: "The only available execute action is run_analysis. All other modifications must be done through the canvas UI.", or
- (c) Both — the system prompt guidance and the schema constraint reinforce each other.

### Issue 2: No Conversation History Text in ContextPack

**Severity:** High — limits conversational quality

**What:** `projectConversation()` only projects turn metadata (`turn_id`, `turn_class`, `handler_id`, `created_at`). No user message text or assistant response text reaches Sonnet.

**Impact:** Sonnet cannot:
- Reference what the user said earlier
- Build on its own prior responses
- Maintain conversational coherence across turns
- Resolve anaphora ("do that again", "the same thing but with 60k")

**Recommendation:** Add at least the last 3-5 user messages (and optionally assistant responses) to the ContextPack conversation field, with a token budget cap. The existing `CONTEXT_PACK_RECENT_TURNS_CAP = 5` already bounds the turn count; adding message text within that cap would provide conversational grounding.

### Issue 3: Heuristic/TurnExecutor Overlap on Edit Intent

**Severity:** Low — existing graceful fallback handles it

**What:** The edit_graph heuristic dispatch fires on positive edit verbs (`change`, `set`, `increase`, etc.) with graph present at stage `analyse` or `decide`. Messages that express the same edit intent without matching the regex fall through to TurnExecutor, where Sonnet proposes `set_factor_value` → HANDLER_NOT_FOUND → unsupported coaching.

**Impact:** User experience diverges for semantically identical requests based on word choice. "Change the budget to 50k" → graph edit. "I think the budget should be 50k" → coaching fallback.

**Recommendation:** This is a known consequence of the conservative heuristic design (false negatives fall to TurnExecutor safely). The unsupported coaching response already points users to the canvas UI. No immediate action needed, but the prompt should acknowledge this pattern once conversation history is available.

### Issue 4: Full Graph JSON in ContextPack

**Severity:** Medium — unbounded token growth

**What:** The ContextPack graph is the full raw JSON from the wire. Node objects can include `label`, `value`, `provenance`, `description`, and other verbose fields. Graphs with 15+ nodes can consume 5,000+ tokens.

**Impact:** Token budget is not controlled. For complex graphs, the ContextPack dominates the input tokens, leaving less room for conversation history, coaching context, and Sonnet's reasoning.

**Recommendation:** Use the existing V4 `compactGraph()` utility (at `src/orchestrator/context/graph-compact.ts`) in the V5 path. It produces ~800-1,200 tokens for a 10-node graph (sorted, deterministic, drops verbose fields). The full graph is still available via `graphLookupForValidate` for validation.

### Issue 5: Empty Chips on Successful Turns

**Severity:** Low — UX concern, not a bug

**What:** All three standard compose functions emit `suggested_actions: []`. Only failure and unsupported-action paths produce chips. Successful execute turns (e.g., after run_analysis) produce no suggested next actions.

**Impact:** After a successful action, the UI has no chip suggestions to guide the user's next step. The user must know what to ask next.

**Recommendation:** Add chip generation to `composeToolCallResponse()` based on the handler that just ran and the current stage. For example, after `run_analysis`, suggest "Explain the results" or "What would flip the leading option?" as chips.

### Issue 6: System Prompt Has No Domain Knowledge

**Severity:** Medium — Sonnet lacks operational context

**What:** The `ROUTING_SYSTEM_PROMPT` is 13 lines of routing instructions. It does not describe:
- What Olumi is or what it helps with
- What the stage values mean (frame, analyse, decide, review)
- What handlers are available and what they do
- What coaching means in this context
- What the graph/analysis/coaching fields in ContextPack represent
- What constitutes a good clarification question

**Impact:** Sonnet infers all context from the raw JSON structure of the ContextPack. This works for simple routing decisions but limits quality for:
- Coaching responses (no guidance on coaching stance or domain)
- Clarification questions (no sense of what information is actually needed)
- Orientation text (no domain vocabulary or framing guidance)

**Recommendation:** Expand the system prompt with:
- A 2-3 sentence description of Olumi and the decision workflow
- A brief handler inventory ("Available actions: run_analysis. All other changes use the canvas UI.")
- Stage semantics ("frame = defining the decision; analyse = running analysis; decide = choosing")
- Coaching guidelines ("When coaching, help the user think critically about their decision model")

### Issue 7: Analysis State Not Persisted for Follow-up Turns

**Severity:** Low-Medium — requires UI cooperation

**What:** Analysis state (`analysisState`) is read from the HTTP request body only — never loaded from the database. If the UI doesn't re-send `analysis_state` on follow-up turns, Sonnet sees `"analysis": null` even after a successful analysis run.

**Impact:** On follow-up turns where the UI fails to include `analysis_state`, Sonnet loses awareness of analysis results. Coaching signals based on analysis state may not fire correctly.

**Mitigation:** The chip_click run_analysis path loads the scenario snapshot from the database (via `loadScenarioSnapshotForRunAnalysis` at `build-turn-context.ts:284-314`), so the analysis itself runs correctly. The issue is only for Sonnet's ContextPack awareness of prior analysis results on conversational follow-up turns.

---

## Appendix A: Request → Response Flow Diagram

```
HTTP POST /orchestrate/v2/turn
    │
    ├── runPreFlight()
    │     ├── parseRequestExtensions()     → graph_state, analysis_state, user_id
    │     ├── validateIngress()            → OrchestratorTurnPayload (kind union)
    │     ├── preflightEnsureScenario()    → create/verify scenario row
    │     └── FAIL → 422 BoundaryError
    │
    ├── DISPATCH (first match wins)
    │
    │   ┌── [A] system_event?
    │   │     └── dispatchSystemEvent() → empty OlumiResponse
    │   │           ├── commit (except undo/redo)
    │   │           └── 200 or 500
    │   │
    │   ├── [B] chip_click + run_analysis?
    │   │     └── dispatchChipClickRunAnalysis()
    │   │           ├── buildTurnContext()
    │   │           ├── resolveHandler('run_analysis')
    │   │           ├── execute handler
    │   │           ├── enrichRunAnalysisWithDecisionReview()
    │   │           ├── composeToolCallResponse()
    │   │           ├── commitDirectAnswer()
    │   │           └── discriminated outcome → 200 or 500
    │   │
    │   ├── [C] draft_graph shape?
    │   │     └── dispatchDraftGraph()
    │   │           ├── handleDraftGraph() ← V4 pipeline
    │   │           ├── commitDirectAnswer({ graph })
    │   │           ├── draftResultToOlumiResponse()
    │   │           └── 200 or 500
    │   │
    │   ├── [D] edit_graph shape?
    │   │     └── dispatchEditGraph()
    │   │           ├── graphStateToGraphV3()
    │   │           ├── handleEditGraph() ← V4 pipeline
    │   │           ├── editResultToOlumiResponse()
    │   │           ├── commitDirectAnswer()
    │   │           └── 200 or 500
    │   │
    │   └── [E] FALLTHROUGH → runTurnExecutor()
    │         ├── Step 0: Pre-flight graph lookup
    │         │     ├── buildGraphLookup(graphState) OR loadPersistedGraph()
    │         │     └── HARD-FAIL if all nodes dropped
    │         │
    │         ├── Step 1: ORIENT
    │         │     ├── readCoachingCache()
    │         │     ├── assembleContextPackWithSummary()
    │         │     └── routeWithToolUse(contextPack, message)
    │         │           ├── system: ROUTING_SYSTEM_PROMPT
    │         │           ├── messages: [{ role: 'user', content: '## ContextPack\n...\n## User turn\n...' }]
    │         │           ├── tools: [OLUMI_ACTION_TOOL]
    │         │           ├── tool_choice: auto, temperature: 0
    │         │           └── → RoutingResult (tool_call or text_only)
    │         │
    │         ├── Step 2: VALIDATE (execute intent only)
    │         │     ├── validateToolCall(action, graphLookup, registry)
    │         │     ├── HANDLER_NOT_FOUND → coaching fallback (200, committed)
    │         │     └── Other errors → validation failure (500)
    │         │
    │         ├── Step 3: EXECUTE (execute intent only)
    │         │     ├── resolveHandler(registry, proposedHandlerId)
    │         │     ├── handlerFn({ context, payload, requestId, signal })
    │         │     └── enrichRunAnalysisWithDecisionReview() (if run_analysis)
    │         │
    │         ├── Step 4: CONFIRM (execute intent only)
    │         │     └── renderConfirmation() → handler's confirmation_template
    │         │
    │         ├── Step 5: COACH (execute intent only)
    │         │     └── detectCoachingSignal() → optional signal + text
    │         │
    │         ├── Step 6: COMPOSE
    │         │     ├── [execute] composeToolCallResponse(orientation, confirmation, coaching, facts)
    │         │     ├── [clarify] composeClarifyResponse(question)
    │         │     ├── [coach]   composeDirectAnswerResponse(text)
    │         │     └── [converse] composeDirectAnswerResponse(text)
    │         │
    │         └── Step 7: COMMIT
    │               └── commitDirectAnswer(response, metadata)
    │
    └── POST-COMMIT
          ├── commit_performed === false → 500 + BoundaryError
          └── commit_performed === true
                ├── validateEgress(response) → OK → 200 + response
                └── validateEgress(response) → FAIL → 200 + fallback
```

## Appendix B: Key Invariants

1. **Fail-Closed** (`route-v2.ts:505`): `commit_performed === false` NEVER appears in HTTP 200. Commit-status check runs BEFORE egress validation.

2. **Exactly-One-Response** (`turn-executor.ts:29-31`): Every `TurnExecutor.started` telemetry event has matching `.completed` with `response_emitted=true`. Top-level try/finally guarantees this.

3. **Idempotent Commits** (`commit.ts:14-16`): `turn_id` + `scenario_id` + RPC `ON CONFLICT DO NOTHING` ensures safe retry.

4. **Atomic Graph Persistence** (`commit.ts:19-21`): When `graph` provided, both graph update and turn insert succeed or both roll back.

5. **Budget Enforcement** (`turn-executor.ts:34-36`): Outer wall-clock `AbortSignal` with `budgets.turn_ms`. Budget-exceeded check wins over inner timeouts (Paul's constraint 7).

6. **Heuristic Conservative** (`route-v2.ts:152-173`): False negatives fall through to TurnExecutor (safe). False positives would mutate graph (unsafe) — regexes err on NOT dispatching.

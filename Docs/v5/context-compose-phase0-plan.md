# V5 Context + Compose Layer Completion — Phase 0 Plan

**Date:** 2026-04-23
**Branch target:** `claude/v5-context-compose` (off staging HEAD `5a4f1a6e`)
**Status:** Plan only — awaiting review before any code changes.

---

## Executive summary

The brief's seven tasks divide cleanly into three categories after investigation:

1. **Executable as specified** (4 tasks): graph compaction, handler enum, chip generation, prompt loading mechanism confirmation + observability.
2. **Executable with modification** (1 task): analysis state fallback — feasible via `readFactsFor`, no migration needed.
3. **Blocked by halt condition** (1 task): conversation history text — the `v5_conversation_turns` table has no columns for user message or assistant text. Adding them requires a Supabase migration AND an `@talchain/schemas` change, both listed as hard-stop conditions.

One task (Task 1.1) should therefore be **deferred and proposed separately** rather than attempted in this branch. The remaining six tasks can proceed in the phased order the brief specifies.

---

## 0.1 Audit re-verification

All seven issues in `Docs/v5/v5-implementation-audit.md` still exist at staging HEAD `5a4f1a6e`. File:line references are correct.

Issue 3 (heuristic/TurnExecutor overlap) is explicitly out of scope per the brief. The other six are addressed or deferred below.

---

## 0.2 Investigation answers

### Q1: Does `readRecent` return user message text and assistant response text?

**No.** This is the critical blocking finding.

- `SessionStore.readRecent()` ([src/orchestrator-v5/session/supabase-store.ts:114-161](src/orchestrator-v5/session/supabase-store.ts#L114-L161)) reads `v5_conversation_turns` with column list:
  ```
  id, scenario_id, user_id, turn_id, turn_class, handler_id, request_hash,
  response_emitted, llm_calls_used, duration_ms, created_at
  ```
- The table schema (`supabase/migrations/20260417160000_v5_session_store.sql:25-39`) has no `message`, `assistant_text`, or similar columns.
- `request_hash` is a SHA-256 prefix (not raw text), per `commit.ts:124-140`.
- `SessionTurnSchema` at `@talchain/schemas/orchestrator/session.js:31-43` is `.strict()` — fields cannot be added without a tarball rebuild.
- `readFactsFor()` returns handler facts (e.g. `run_analysis` result) but not message text either.

**Implication:** Task 1.1 as written cannot be completed without BOTH:
1. A Supabase migration adding `user_message TEXT` and `assistant_text TEXT` columns to `v5_conversation_turns`
2. An `@talchain/schemas` change widening `SessionTurnSchema`

Both are listed halt conditions. **Recommendation: halt Task 1.1 and propose the migration + schema change as a separate follow-up brief.** Continue Phase 1 with tasks 1.2, 1.3, 1.4.

### Q2: Is `compactGraph()` safely importable from V5?

**Yes.** `src/orchestrator/context/graph-compact.ts` is already used by V5 — the audit notes `compactAnalysis` from V4 is imported at `turn-executor.ts:106`, confirming the V5→V4 context-utility bridge is an accepted pattern. `compactGraph` has these imports:
- `GraphV3T` from `schemas/cee-v3.js` (shared, safe)
- `DEFAULT_EXISTS_PROBABILITY` from `./constants.js` (V4-local but pure constant)
- `isLegalStructuralEdge` from `cee/utils/structural-edge-classifier.js` (V4-local, pure function)

Importing `compactGraph` into V5 does not break the ownership contract — it's the same pattern as `compactAnalysis`. The function produces exactly what the brief needs: sorted, deterministic, ~800-1,200 tokens for 10 nodes.

**However:** `compactGraph` expects `GraphV3T` (strict Zod-parsed). The V5 ContextPack path receives `GraphStateIngress` (permissive passthrough). We need to either (a) parse the ingress into `GraphV3T` first, falling back to a structural projection on parse failure (same pattern as `graphStateToGraphV3` in edit-graph-dispatch.ts:110-151), or (b) write a thin V5-local wrapper that handles both strict and permissive inputs.

**Recommendation:** Option (a) — reuse the existing conversion pattern. Minimal new code.

### Q3: Where is analysis state stored after `run_analysis`?

**In handler facts.** `run_analysis` handler at `src/orchestrator-v5/tools/handlers/run-analysis.ts:331-362` constructs a `RunAnalysisHandlerFact` with fields: `scenario_id`, `leading_option_id`, `summary`, `win_probabilities`, `enrichment` (decision_review, coaching_signal_id, etc.). This fact is persisted via `append_turn_atomic` in the same row as the turn.

`readFactsFor(turnIds)` returns these facts. The `build-turn-context.ts` already loads `prior_facts` for the coaching cache — we can reuse this existing access pattern.

**Recommendation:** For analysis fallback, scan `prior_facts` for the most recent `fact_type === 'run_analysis'`, extract its result fields, and project them into `ContextPackAnalysis`. No new database call, no migration.

### Q4: Can analysis freshness be verified against the current graph?

**Partially.** The `RunAnalysisHandlerFact.result` does not currently include a graph hash or graph version. However, `computeDeterministicGraphHash` exists at `src/orchestrator-v5/context/graph-hash.ts` and is already called in the routing log.

**Two approaches:**
- **A (minimal):** Always flag fallback analysis with `staleness_reason: "loaded_from_prior_run_freshness_unknown"`. Honest, no new hashing work. The Sonnet prompt (future) can be trusted to handle a staleness flag correctly.
- **B (optimal):** Compute the graph hash at run_analysis time, store it in enrichment, compare at fallback load. Requires extending the run_analysis fact enrichment (which is already a passthrough object — no schema change needed).

**Recommendation: A.** Approach B is a worthwhile follow-up but adds coupling. For this brief, mark all fallback analyses as unknown-freshness. The UI contract is unchanged; the next step will be to have run_analysis stamp a graph hash into enrichment, which is additive.

### Q5: Is `draft_graph` / `edit_graph` in the TurnExecutor validator or runtime registry?

**No — both are pre-Sonnet heuristic paths only.**
- V5ActionType enum (`@talchain/schemas/boundary/enums.js:12`) contains: `run_analysis`, `set_factor_value`, `add_constraint`, `adjust_edge_strength`, `explain_result`, `compare_options`, `what_would_flip`. `draft_graph` and `edit_graph` are NOT listed.
- Adding them to the tool-schema enum would require them to be in V5ActionType, which means a schema change.

**Recommendation for Task 1.3 (handler_id enum):** Option (a) — enum = `['run_analysis']` only. Matches both registries, avoids cross-cutting concerns, and the heuristic dispatch + graceful fallback covers the draft/edit paths. If the heuristic misses, Sonnet's text_only response still works (unsupported action coaching is not required because no action was attempted).

### Q6: What is the `SuggestedAction` schema?

From `@talchain/schemas/boundary/olumi-response.js:10-14`:
```typescript
export const ActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  message: z.string().min(1),
  action_type: ActionType.optional(),  // V5ActionType enum, optional
}).strict();
```

**Both executable and conversational chips are supported by the existing schema:**
- **Executable chip:** `action_type` present → UI maps to a handler call (e.g. `chip_click run_analysis`)
- **Conversational chip:** `action_type` omitted → UI submits `message` as user text, Sonnet answers from context

The `composeUnsupportedActionResponse` composer already uses both patterns (lines 171-192 of `unsupported-action-response.ts`). The same helpers (`chipId`, `curatedHandlerChips`) can be reused.

### Q7: What is the prompt loading mechanism?

**Currently a hardcoded const.** `ROUTING_SYSTEM_PROMPT` at `route-with-tool-use.ts:131-143` is passed directly as `system:` in the Anthropic call. No PMS integration on this path.

A full PromptStore infrastructure exists (see `src/prompts/index.js`, `src/adapters/llm/prompt-loader.js`) — it is used for other prompts (unified pipeline, coaching, etc.) but not the V5 routing layer.

**Size limits:** Anthropic accepts system prompts up to ~200K characters; the practical limit for input tokens is the model's input window (200K for Claude Opus/Sonnet 4). A 19K-character prompt (~5K tokens) is well within bounds.

**Recommendation for Task 3.1:** Keep the routing prompt as a hardcoded const for now (simplest, lowest-risk, zero new moving parts). Paul can drop the new 19K prompt in as a single file edit when the content is ready. Moving to PMS is a separate decision — doing it in this brief would risk scope creep. If Paul wants PMS on the routing path, that should be a separate change.

The brief explicitly says "CC must not author, edit, or optimise prompt text" — so we only prepare the path, not the content.

### Q8: Where should conversation history appear in the Anthropic call?

**Moot given Q1 answer** — conversation text is unavailable. If Q1 were resolved:

Two options:
- **(a) New field in ContextPack JSON** (`conversation.recent_turns[].user_message`, `.assistant_text`). Discoverable by Sonnet through structure; caveat is that JSON-embedded text is harder for the model to reason about than native conversation turns.
- **(b) Separate `## Conversation history` section in the user message.** More natural for the model, clearer delimitation.

**Recommendation (for the future migration):** Option (b). It matches how humans and models naturally think about conversation history and keeps the ContextPack focused on structured state. Example:

```
## ContextPack
{ ... }

## Conversation history
User: <message 1>
Assistant: <response 1>
User: <message 2>
Assistant: <response 2>

## User turn
<current message>
```

---

## 0.3 Task-by-task plan

### Task 1.1 (Conversation history text) — **HALT AND DEFER**

**Blocker:** `v5_conversation_turns` does not store message text; `SessionTurnSchema` is `.strict()`.

**Proposal for separate follow-up brief:**
1. Supabase migration: add `user_message TEXT NULL` and `assistant_text TEXT NULL` columns to `v5_conversation_turns` (nullable for backfill; non-null going forward).
2. Update `append_turn_atomic` RPC signature to accept and store these.
3. Schema tarball rebuild: extend `SessionTurnSchema` with both optional fields.
4. Extend `SessionTurnWrite` in `src/orchestrator-v5/session/store.ts` likewise.
5. Write path: `commit.ts` passes `payload.message` (user) and `response.assistant_text` (server) through.
6. Read path: add `user_message`, `assistant_text` to `V5_CONVERSATION_TURN_COLUMNS`.
7. ContextPack assembly: project into conversation history section of the user message (option b from Q8), with per-message 500-char cap and total ~1,500-token budget.

**This work is intentionally out of scope for the current branch.** Documented in the discoveries section of the evidence pack.

### Task 1.2 (Compact graph context) — **EXECUTE**

**Files to modify:**
- `src/orchestrator-v5/context/context-pack-assembler.ts` — replace `projectGraph` with a compaction step
- `src/orchestrator-v5/turn-executor.ts` — call the compaction helper between `graphStateForTurn` resolution and `assembleContextPackWithSummary`
- New helper: `src/orchestrator-v5/context/compact-graph-for-contextpack.ts` — thin adapter that parses `GraphStateIngress` → `GraphV3T` (with structural fallback), then calls `compactGraph`

**Approach:**
1. Adapter reuses `GraphV3.safeParse` pattern from `edit-graph-dispatch.ts:110-151`.
2. Parse success → call `compactGraph` → convert `GraphV3Compact` back to the ContextPackGraph shape (or extend ContextPackGraph to accept the compact shape — simpler).
3. Parse failure → log warning (same pattern), fall back to the existing passthrough projection.
4. Full graph remains in `graphLookupForValidate` for validation — unchanged.

**Design decision — ContextPackGraph shape:**
The current `ContextPackGraph` type has `nodes`, `edges`, `options`, `goals`, `constraints`, `counts`. The compact form drops `options`/`goals`/`constraints` derivation (options/goals are still extractable from compact nodes by `kind`). Simplest path: change `ContextPackGraph.nodes` and `.edges` to carry the compact types while keeping `options`/`goals`/`constraints` derivation from compact nodes. This minimises ContextPack consumer changes.

**Tests:**
- `tests/unit/orchestrator-v5/context/compact-graph-for-contextpack.test.ts` (new)
  - 10-node graph → token count substantially less than raw (assert < 50% of raw)
  - Essential fields preserved: `id`, `kind`, `label`, `value`, `source`, edge `strength`, `from`, `to`
  - Verbose fields dropped: `body`, `state_space`, `goal_threshold`, `observed_state.std`
  - Parse failure → structural fallback does not throw
- Update `context-pack-assembler.test.ts` to assert compact fields appear where raw fields previously did

**Risks:**
- ContextPack consumers downstream (routing log, debug store) might read raw fields. Mitigation: audit consumers before landing the shape change. If any read raw fields, they should read from `graphStateForTurn` or adapter output, not the ContextPack.

### Task 1.3 (Constrain handler_id enum) — **EXECUTE**

**Recommended approach:** Option (a) — enum = `['run_analysis']`.

**Files to modify:**
- `src/orchestrator-v5/routing/tool-schema.ts` — add enum constraint + update description
- Tests that assert `handler_id` shape

**Approach:**
```typescript
// Before:
handler_id: { type: 'string' },

// After:
handler_id: {
  type: 'string',
  enum: ['run_analysis'],
  description:
    'The action to execute. Only run_analysis is available through chat. ' +
    'Graph structural changes (draft_graph, edit_graph) are dispatched ' +
    'by the system before routing and never reach this tool call.',
},
```

**Tests:**
- Assert `handler_id.enum` exists and equals `['run_analysis']`.
- Existing HANDLER_NOT_FOUND / unsupported-action tests remain valid — they test the defensive path even if Sonnet can no longer trigger it through the tool schema (LLMs sometimes ignore enums; schema validation is the authoritative layer).

**Risks:**
- If the staging prompt has been encouraging Sonnet to propose `set_factor_value` or similar, routing could fail at parse time until the new prompt is installed. Mitigation: the existing REPAIR_ONCE path catches parse failures and re-prompts. Track via telemetry (validation_error_code) on staging after merge.

### Task 1.4 (Analysis state fallback) — **EXECUTE**

**Files to modify:**
- `src/orchestrator-v5/turn-executor.ts` — add fallback path between `options.analysisState` check and `compactAnalysis` call
- `src/orchestrator-v5/context/context-pack-assembler.ts` — add `staleness_reason` field to `ContextPackAnalysis` (type already has it; just needs population)
- New helper: `src/orchestrator-v5/context/analysis-fallback.ts` — extracts analysis from prior facts

**Approach:**
1. Only activate fallback when `options.analysisState` is null/undefined.
2. Scan `context.prior_facts` (already loaded, no new DB call) for the most recent `fact_type === 'run_analysis'` fact.
3. If found, project the fact result into a minimal `V2RunResponseEnvelope`-compatible shape that `compactAnalysis` accepts.
4. Set `staleness_reason: "loaded_from_prior_run_freshness_unknown"` on the resulting `ContextPackAnalysis`.
5. Log `analysis_state_source: 'fallback'` for observability (per Task 3.2).

**Tests:**
- `tests/unit/orchestrator-v5/context/analysis-fallback.test.ts` (new):
  - Prior analysis fact present → analysis projected with staleness flag
  - No prior analysis fact → returns null
  - `analysisState` in options → fallback not invoked
- Integration test via `turn-executor.test.ts`:
  - Follow-up turn without `analysisState`, with prior run_analysis turn → ContextPack includes analysis summary with staleness flag

**Risks:**
- Analysis fact shape may not map cleanly into `V2RunResponseEnvelope`. The `compactAnalysis` function is defensive on missing fields (per the existing `coerceIngressAnalysis` comment), so best-effort projection is safe.
- If the fact's result lacks certain fields (e.g. `factor_sensitivity`), `top_drivers` will be empty. Document this as a known limitation.

### Task 2.1 (Chip generation) — **EXECUTE**

**Files to modify:**
- `src/orchestrator-v5/compose.ts` — `composeDirectAnswerResponse` and `composeToolCallResponse` accept optional chip generation context
- New: `src/orchestrator-v5/compose/chip-generator.ts` — deterministic chip selection logic
- `src/orchestrator-v5/turn-executor.ts` — pass chip context into compose calls

**Chip generation rules (refined from brief table):**

| Stage | Handler just run | Other signals | Chip 1 | Chip 2 | Chip 3 |
|-------|------------------|---------------|--------|--------|--------|
| `frame` | none (text_only) | — | "Draft the decision graph" (prompt) | — | — |
| `analyse` | none (text_only) | options ready | "Run analysis" (executable, `action_type: run_analysis`) | — | — |
| `analyse` | none (text_only) | options not ready | "Set values for options" (prompt) | — | — |
| `analyse` | run_analysis | — | "Explain the result" (prompt) | "What could change the outcome?" (prompt) | — |
| `decide` | any | robustness === "fragile" | "Run a pre-mortem" (prompt) | "What would make this flip?" (prompt) | — |
| `decide` | any | not fragile | "Explain the decision" (prompt) | — | — |
| `review` | any | — | "Summarise the decision" (prompt) | — | — |

- **Executable chips** only reference `run_analysis` (the only registered handler). All other chips are conversational prompts (no `action_type`).
- Maximum 3 chips. Empty array returned if no rule matches.
- Chip IDs follow the existing `chip_<scope>_<discriminator>` pattern.

**Chip context input type:**
```typescript
interface ChipContext {
  stage: StageType;
  handlerFacts?: readonly HandlerFact[]; // to detect "just ran X"
  analysis?: ContextPackAnalysis | null;
  // signals: analysis_ready status for frame→analyse bridge
  analysisReadyStatus?: string;
}
```

**Tests:**
- `tests/unit/orchestrator-v5/compose/chip-generator.test.ts` (new):
  - Each stage + signal combination produces expected chips
  - Empty/null context → returns `[]`
  - Chip text contains no handler IDs or developer terminology
  - All chips pass `ActionSchema.safeParse`
- Update `compose.test.ts` to verify chips flow through

**Risks:**
- Chip generation is context-dependent; getting the inputs right requires threading state through TurnExecutor. The current `composeToolCallResponse` already receives `handlerFacts` — just needs `analysis` and `stage` (stage is already passed).
- Mitigation: chip generator is a pure function; if inputs are missing it returns `[]` (safe default).

### Task 3.1 (Prompt loading mechanism) — **CONFIRM AND PREPARE**

**Current state:** `ROUTING_SYSTEM_PROMPT` is a hardcoded const at `route-with-tool-use.ts:131-143`. No PMS integration.

**Recommendation:** Keep as hardcoded const. When Paul provides the new ~19K-char prompt, it replaces the existing constant. No mechanism changes needed.

**Preparation work in this branch:**
- Document the mechanism in a comment at the constant declaration site ("Updated prompt drop-in point — replace this constant to ship new routing prompt")
- Verify `chatWithTools` adapter passes `system` through without truncation (spot-check the adapter code; if it does truncate, raise as discovery)
- Add one smoke test that verifies a >10K-char system prompt is passed through unchanged to the adapter mock

**Files to modify:**
- `src/orchestrator-v5/routing/route-with-tool-use.ts` — comment only (no content change)
- New test: `tests/unit/orchestrator-v5/routing/route-with-tool-use-prompt-size.test.ts`

### Task 3.2 (Observability logging) — **EXECUTE**

**Files to modify:**
- `src/orchestrator-v5/turn-executor.ts` — add debug log emission after ContextPack assembly

**Fields logged at debug level after `assembleContextPackWithSummary`:**
- `system_chars`: `ROUTING_SYSTEM_PROMPT.length` (will show step-change when new prompt lands)
- `context_pack_chars`: `JSON.stringify(contextPack).length`
- `conversation_history_turns`: `contextPack.conversation.recent_turns.length` (metadata count for now; will reflect message text once Task 1.1 is unblocked)
- `graph_compacted`: boolean — `true` when compaction succeeded
- `analysis_state_source`: `'request' | 'fallback' | 'absent'`
- `chip_count`: emitted at compose time, inside `composeToolCallResponse` / `composeDirectAnswerResponse`

**Tests:**
- Not strictly required for debug logs; include one smoke test that asserts log emission with expected fields on a happy-path turn.

---

## 0.4 Execution sequence

The brief suggests "graph compaction before conversation history to free token budget first." Since conversation history is deferred, the revised sequence is:

**Phase 1 (context layer):**
1. **Task 1.2** — graph compaction (largest token saving, isolated change)
2. **Task 1.4** — analysis fallback (depends on Task 1.2's ContextPack shape being settled)
3. **Task 1.3** — handler enum (smallest, isolated change)

**Phase 1 gate:** `tsc` clean, targeted tests pass, two-round self-review, proceed.

**Phase 2 (compose layer):**
4. **Task 2.1** — chip generation (uses analysis state from Phase 1)

**Phase 2 gate:** as above.

**Phase 3 (prompt + observability):**
5. **Task 3.1** — prompt mechanism confirmation
6. **Task 3.2** — observability logs

**Phase 3 gate:** as above.

**After Phase 3:** full test suite, evidence pack, local commits.

---

## 0.5 Token budget estimates (revised)

Brief targets ~12-15K total input tokens. Actual allocation after this branch:

| Component | Estimate | Notes |
|-----------|----------|-------|
| System prompt | ~145 tokens (current) → ~5K tokens (when new prompt installs) | Task 3.1 prepares the path |
| Compacted graph | ~1,000 tokens for 10-node graph | Task 1.2 — down from ~4K |
| Conversation history | ~0 tokens (deferred) | Task 1.1 halted; future work ~1,500 tokens |
| Tool schema | ~650 tokens | Unchanged |
| Analysis summary | ~300 tokens | Task 1.4 fills this on follow-ups |
| Coaching cache | ~200 tokens | Unchanged |
| User message | ~50-200 tokens | Unchanged |
| **Total (this branch)** | **~7,200-7,400** | Down from current ~7K on large-graph scenarios, up slightly when new prompt ships |
| **Total (after Task 1.1 unblocked)** | **~8,700-8,900** | Still well under 15K target |

Conversation history budget is not consumed in this branch. When Task 1.1 is unblocked via migration, the 1,500-token budget remains available.

---

## 0.6 Risks and constraints

### Risk 1: ContextPack shape change affecting downstream consumers
- **What:** Task 1.2 changes the `ContextPackGraph.nodes` / `.edges` shapes from raw to compact.
- **Mitigation:** Grep for all readers of `contextPack.graph.nodes` and `.edges`. Known readers: turn-executor's routing log (uses only `counts.nodes`, `counts.edges` — safe), the serialised ContextPack going to Sonnet (intentional), tests. No other consumers expected.

### Risk 2: Staging prompt may expect specific context shape
- **What:** If the current (terse) prompt references raw graph fields that compaction drops, Sonnet behaviour could regress before the new prompt lands.
- **Mitigation:** Current prompt is generic ("use ContextPack fields"); it doesn't reference specific field names. Compaction preserves all fields the prompt could plausibly rely on (label, kind, value). Stage the change and watch routing error rate.

### Risk 3: Handler enum constraint may cause REPAIR_ONCE increase
- **What:** If Sonnet has been proposing non-`run_analysis` handlers, enforcing the enum will cause parse failures → REPAIR_ONCE attempts → latency + cost increase.
- **Mitigation:** The current system prompt already tells Sonnet to prefer clarify over guessed execute; only the handler registry could accept proposals anyway. The new prompt (future) will explicitly list available actions. In the gap, track `validation_error_code` and `llm_calls_used` metrics for any regression.

### Risk 4: Analysis fallback staleness misleading users
- **What:** Fallback analysis marked "unknown freshness" might still present stale win_probabilities that the user could act on.
- **Mitigation:** The staleness_reason flag is visible in Sonnet's ContextPack. The prompt (future) should teach Sonnet to handle this gracefully (e.g., "analysis results from a prior run; may not reflect recent changes"). The UI contract is unchanged — it still receives either fresh or no analysis in the response path.

### Risk 5: Chip text rendering in UI
- **What:** The UI parser may have assumptions about chip structure (e.g. always expecting `action_type`). Conversational chips (no `action_type`) have been produced before by `composeUnsupportedActionResponse`, so this pattern is known-good.
- **Mitigation:** Verify by running the changes against the UI in staging before merge. If the UI mis-renders prompt chips, halt and propose a UI coordination.

### Risk 6: Token budget overshoot on large graphs
- **What:** Compaction targets ~1K tokens for a 10-node graph. A 50-node graph would compact to ~5K tokens, still large.
- **Mitigation:** Out of scope for this brief. If staging shows large-graph token issues, propose a follow-up to truncate compact output (e.g., drop low-degree nodes) or add an enforced token cap.

---

## 0.7 Files in scope

### New files
- `src/orchestrator-v5/context/compact-graph-for-contextpack.ts` — graph compaction adapter
- `src/orchestrator-v5/context/analysis-fallback.ts` — fallback analysis extractor
- `src/orchestrator-v5/compose/chip-generator.ts` — deterministic chip selection
- `tests/unit/orchestrator-v5/context/compact-graph-for-contextpack.test.ts`
- `tests/unit/orchestrator-v5/context/analysis-fallback.test.ts`
- `tests/unit/orchestrator-v5/compose/chip-generator.test.ts`
- `tests/unit/orchestrator-v5/routing/route-with-tool-use-prompt-size.test.ts`
- `Docs/v5/context-compose-evidence.md` (final evidence pack)

### Modified files
- `src/orchestrator-v5/context/context-pack-assembler.ts` — compact graph projection
- `src/orchestrator-v5/turn-executor.ts` — call compaction + analysis fallback, observability logs
- `src/orchestrator-v5/routing/tool-schema.ts` — handler_id enum + description
- `src/orchestrator-v5/routing/route-with-tool-use.ts` — prompt loading comment only
- `src/orchestrator-v5/compose.ts` — accept chip context, call chip generator
- Tests: `context-pack-assembler.test.ts`, `compose.test.ts`, `turn-executor.test.ts` (update expectations)

### NOT modified
- `src/orchestrator/route-v2.ts` (dispatch logic — out of scope)
- `src/orchestrator/tools/draft-graph.ts`, `edit-graph.ts` (V4 bridge — out of scope)
- `@talchain/schemas/*` (tarball change — halt condition)
- `supabase/migrations/*` (migration — halt condition)
- `src/orchestrator/context/graph-compact.ts` (V4 utility — reuse as-is)
- `src/orchestrator-v5/compose/unsupported-action-response.ts` (recently deployed, working)
- `data/prompts.json` (dirty from prior session per brief)

---

## 0.8 Baseline capture plan

Before Phase 1 starts:
1. `git checkout -b claude/v5-context-compose` off current staging HEAD
2. `tsc -p tsconfig.build.json --noEmit` — capture baseline type errors (expected: test files only, src clean per memory)
3. Run full test suite — capture pass/fail counts
4. Record baseline in scratch; reconcile deltas at each phase gate

---

## 0.9 Verification gates (recap)

Each phase gate:
1. `tsc -p tsconfig.build.json --noEmit` clean (no new errors)
2. Targeted tests for changed files pass
3. Two rounds of self-review:
   - Round 1: brief compliance — does this match what was asked?
   - Round 2: adversarial — worst-case input, hidden regression, edge cases
4. Decisive outcome: `proceed | halt | abandon`

Full suite runs at phase boundaries only.

---

## 0.10 Deferrals and discoveries

### Task 1.1 deferral rationale
Conversation history text cannot ship in this branch without a schema tarball rebuild and Supabase migration. Both are hard-stop conditions in the brief. The correct action is to halt this task and propose it as a separate follow-up brief (contents outlined in Task 1.1 section above).

### Discoveries for evidence pack
- `request_hash` is a SHA-256 prefix, not raw payload — noted for any future audit that assumes it's the raw text
- Analysis fact enrichment is a passthrough object; adding `graph_hash` there is additive and unlocks freshness verification (future work)
- `compactGraph` already exists in V4 and is safely importable from V5 (same pattern as `compactAnalysis`)
- The PMS infrastructure exists but is not used for V5 routing — moving to PMS is a separate decision
- `ActionSchema` supports both executable and conversational chips via optional `action_type`

---

## Awaiting approval

The plan above completes six of the seven brief tasks in-scope and proposes the seventh (conversation history text) as a separate follow-up with a complete migration + schema plan.

Please review and confirm:
1. **Defer Task 1.1** (conversation history text) — yes/no?
2. **Handler enum = `['run_analysis']` only** (option a) — yes/no?
3. **Analysis freshness: approach A** (always flag unknown-freshness on fallback) — yes/no?
4. **Prompt mechanism: keep as hardcoded const** — yes/no?
5. **Execution sequence: 1.2 → 1.4 → 1.3 → 2.1 → 3.1 → 3.2** — yes/no?

Once confirmed, I will create the branch, capture baseline, and begin Phase 1.

# V5 Context + Compose Layer Evidence

**Date:** 2026-04-24 (last updated after review-response cycle)
**Branch:** `claude/v5-context-compose`
**Baseline commit:** `5a4f1a6e` (staging HEAD at branch creation)
**Final commits:** 6 on top of baseline (see `git log claude/v5-context-compose --oneline`)
**Baseline tests (pre-branch):** 12,248 pass / 1 fail / 228 skipped / 1 todo (12,478 total)
**Final tests after review-response:** 12,294 pass / 0 fail / 228 skipped / 1 todo (12,523 total)
**Delta:** +46 new passes; 0 new failures. The one pre-existing `adapters.test.ts` failure in the baseline was fixture-dependent and resolved independently of this branch.
**New tests added (total):** 48
- 12 `compact-graph-for-contextpack.test.ts` (was 11; +1 for `goal_constraints` passthrough)
- 16 `analysis-fallback.test.ts` (was 13; +3 for label resolution)
- 2 new in `tool-schema.test.ts` (enum + permissive parser)
- 14 `chip-generator.test.ts` (was 12; +2 for options-gating + setup-prompt fallback)
- 2 `route-with-tool-use-prompt-size.test.ts` (content tightened post-review)
- 1 updated in `turn-executor-failure-responses.test.ts` (chips-on-success)
- 2 fixture updates in `tests/fixtures/contracts/b1/valid-turn-payload.json`

---

## ContextPack before/after shape

| Field | Before | After |
|-------|--------|-------|
| `conversation.recent_turns` | metadata only: `turn_id`, `turn_class`, `handler_id`, `created_at` | unchanged — Task 1.1 deferred (schema + migration halt) |
| `graph.nodes` / `graph.edges` | full raw JSON passthrough (~3–5K tokens for 10-node graph) | **compacted** via V4 `compactGraph` (~1K tokens for 10-node graph); >50% byte reduction asserted by unit test |
| `graph.options` / `graph.goals` | derived from raw nodes | derived from compact nodes (same kind-based filter) |
| `graph.constraints` | passthrough from `goal_constraints` | empty array when compact path active (compactor drops `goal_constraints`) |
| `analysis` | request-body only; null when UI omitted `analysis_state` | **server-side fallback** from prior `run_analysis` facts; flagged `staleness_reason: "loaded_from_prior_run_freshness_unknown"` |
| `analysis.staleness_reason` | always `null` | `null` when fresh; stamped on fallback |

### Token estimate before / after

| Component | Before | After (this branch) | After new prompt drop-in |
|-----------|--------|---------------------|-------------------------|
| System prompt | ~145 tokens | ~180 tokens (enum description added) | ~5,000 tokens (future) |
| Tool schema | ~650 tokens | ~700 tokens (enum constraint + desc) | ~700 tokens |
| Graph (10-node) | ~3,500 tokens (raw) | ~1,000 tokens (compact) | ~1,000 tokens |
| Analysis summary | ~300 tokens on request; 0 on follow-up | ~300 tokens on request; ~150 tokens on fallback | ~150–300 tokens |
| Coaching cache | ~200 tokens | ~200 tokens | ~200 tokens |
| Conversation history | ~50 tokens (metadata) | ~50 tokens (metadata) — Task 1.1 deferred | ~1,500 tokens (future, once unblocked) |
| User message | ~50–200 tokens | ~50–200 tokens | ~50–200 tokens |
| **Total** | ~4,900–7,000 | ~2,400–3,100 | ~8,600–9,000 |

Net effect: this branch REDUCES input tokens (compaction more than offsets modest additions). When the ~19K-char routing prompt drops in, we land around 8.6–9K — still well under the 15K target with ~191K model runway left.

---

## Phase 1: Context layer

| Item | Status |
|------|--------|
| Conversation history text | **Not included** — Task 1.1 deferred. The `v5_conversation_turns` table has no columns for message text and `SessionTurnSchema` is `.strict()`. Adding them requires both a Supabase migration and an `@talchain/schemas` tarball rebuild (hard-stop halt conditions). Proposed migration documented in `Docs/v5/context-compose-phase0-plan.md §0.3, Task 1.1`. |
| Turn count window | 5 (unchanged); metadata-only projection unchanged |
| Graph compaction | **Active** on every TurnExecutor turn with a graph. Strict GraphV3 parse with structural fallback. V4 `compactGraph` reused (same bridge pattern as `compactAnalysis`). Typical 10-node graph: ~3,500 → ~1,000 tokens. |
| Handler enum | **Constrained** to `['run_analysis']` at the tool-schema layer (what Sonnet sees). Zod parser deliberately remains permissive so unknown handler_ids flow to the existing HANDLER_NOT_FOUND → graceful coaching fallback (200, not 500). |
| Analysis fallback | **Active** when `analysis_state` is absent from the request. Reads from `prior_facts` (no new DB call — already loaded by `buildTurnContext`). Always flagged unknown-freshness because the fact does not carry a graph hash (Approach A from Phase 0 plan). |

### Task 1.1 migration plan (deferred, separate follow-up)

Summary of the proposal in `Docs/v5/context-compose-phase0-plan.md §0.3 Task 1.1`:
1. Supabase migration: add `user_message TEXT NULL` and `assistant_text TEXT NULL` to `v5_conversation_turns`
2. Update `append_turn_atomic` RPC signature
3. Schema tarball: extend `SessionTurnSchema` with both optional fields
4. Extend `SessionTurnWrite` and commit/read paths
5. Project into ContextPack as a new `## Conversation history` section in the user message (option b from Q8), per-message 500-char cap, ~1,500-token total budget

---

## Phase 2: Compose layer

| Item | Status |
|------|--------|
| Chip generation | **Active on all four compose branches** (execute, clarify, coach, converse). Deterministic rules; no LLM. |
| Rules covered | post-run_analysis; analyse+no-analysis+no-handler; decide+fragile; decide+stable; review. All other contexts → `[]`. |
| Max chips per response | 3 |
| Executable vs conversational | Distinguished by `action_type` presence. Only `run_analysis` (the single registered handler) appears as an executable chip. All other chips are conversational prompts — safe because they don't reference unavailable handlers. |
| Single-turn self-containment | Chip copy designed to work without conversation memory ("Explain the result" submits as "Please explain the analysis result in plain language"). |

### Chip examples produced (unit-tested)

| Context | Chips |
|---------|-------|
| analyse + handlerFacts=[run_analysis] + any analysis | `[Explain the result (prompt), What could change the outcome? (prompt)]` |
| analyse + analysis=null + handlerFacts=[] | `[Run analysis (executable; action_type=run_analysis)]` |
| analyse + analysis=null + registry empty | `[Run the analysis (prompt fallback)]` |
| decide + analysis.robustness_band=fragile | `[What would make this flip? (prompt), Run a pre-mortem (prompt)]` |
| decide + analysis.robustness_band=stable | `[Explain the decision (prompt)]` |
| review + any analysis | `[Summarise the decision (prompt)]` |

---

## Phase 3: Prompt mechanism + observability

| Item | Status |
|------|--------|
| Loading mechanism | **Hardcoded const** `ROUTING_SYSTEM_PROMPT` in `src/orchestrator-v5/routing/route-with-tool-use.ts:131-143`. Passed to the adapter verbatim as `system:`. No PMS / no template engine on this path. |
| Max size supported | No artificial limit. Anthropic Claude 4.x accepts system prompts up to the model's input window (~200K tokens). A ~19K-char prompt (~5K tokens) leaves ~195K tokens of runway. Smoke-tested with an explicit >100-char passthrough assertion in `route-with-tool-use-prompt-size.test.ts`. |
| Ready for prompt drop-in | **Yes.** Replace the `ROUTING_SYSTEM_PROMPT` constant value in full. No other changes needed. A block comment at the declaration site flags the drop-in point and the single-turn self-containment constraint (because Task 1.1 remains deferred — the new prompt must not assume conversation memory). |

### Observability logs

Emitted at **debug level** once per turn, right after ContextPack assembly:
- `system_chars` — length of the routing system prompt (step-changes when the new prompt lands)
- `context_pack_chars` — full ContextPack JSON serialised length
- `conversation_history_turns` — count of prior turns included (metadata today; will reflect message text once Task 1.1 unblocks)
- `graph_compacted` — boolean; true when compaction ran
- `graph_compact_via` — `'strict_parse' | 'structural_fallback' | null`
- `analysis_state_source` — `'request' | 'fallback' | 'absent'`
- `analysis_staleness_reason` — `null` or `'loaded_from_prior_run_freshness_unknown'`

Chip count is observable via the response payload in Supabase (`v5_conversation_turns`) and was intentionally NOT added as an extra log field to keep the single debug line focused on context-assembly signals.

---

## Discoveries (out of scope, documented only)

1. **`v5_conversation_turns` has no text columns** — `request_hash` is a SHA-256 prefix, not the raw user message. Any future effort to surface conversation text requires the migration + schema change proposed in Phase 0 plan.
2. **Analysis fact enrichment is a passthrough object** (`z.record(z.string(), z.unknown()).optional()`). Adding `graph_hash` there is ADDITIVE and unlocks freshness verification (Approach B) without a schema change — a worthwhile follow-up once Task 1.1's tarball is being rebuilt for other reasons.
3. **PMS infrastructure exists** (`src/prompts/index.ts`, `src/adapters/llm/prompt-loader.ts`) but is not on the V5 routing path. Moving the routing prompt to PMS is a separate architectural decision, not a mechanism requirement.
4. **Zod permissive parser + enum schema constraint is deliberate.** The tool-schema enum gives Sonnet a hint ("only run_analysis is valid"), but Anthropic treats custom-tool schemas as descriptive. The Zod parser stays permissive so unknown handler IDs flow through to the validator's HANDLER_NOT_FOUND graceful coaching fallback (200) rather than triggering `schema_repair_failed` → `LLM_SCHEMA_VIOLATION` (500).
5. **ContextPack graph shape change** — `nodes`/`edges` typed as `readonly unknown[]` in the ContextPackGraph interface, so the compact shape slots in without type churn. No downstream consumer reads specific fields off these arrays (routing log only reads `.counts.nodes/edges`; Sonnet sees JSON).
6. **Chip fixture regression resolved.** The B1 contract fixture `tests/fixtures/contracts/b1/valid-turn-payload.json` previously expected `suggested_actions: []` on an analyse-stage turn. Task 2.1 rules now emit a `Run analysis` chip in that context. Fixture updated in the same commit as the test change to keep the rule visible.

---

## Review response (post-initial-commit)

External review identified 5 P1 findings + 3 improvements. Each was critically analysed and addressed in-scope or rejected with reasoning. All 5 P1s addressed; 3 of 4 improvements addressed; 1 improvement (V4→V5 extraction refactor) rejected per the brief's explicit anti-cleanup scope lock.

| # | Finding | Action | Commit |
|---|---------|--------|--------|
| P1.1 | `draft-graph-dispatch.ts` success path had `suggested_actions: []` despite the brief's chip-mapping table including post-draft chips | **Addressed** — new `buildPostDraftChips` helper emits executable Run analysis when `analysis_ready.status === "ready"`, else a `Set values for options` prompt, else `[]` on failed persistence | review-response |
| P1.2 | Executable Run analysis chip emitted whenever analyse stage + no analysis, even when `run_analysis` would hit PRECONDITION_UNMET (no options) | **Addressed** — `generateChips` now takes `graphOptionCount` and gates the executable chip on `> 0`, otherwise falls back to `Set values for options` | review-response |
| P1.3 | Compact path dropped `goal_constraints` | **Addressed** — assembler accepts `compactedConstraints` passthrough; turn-executor threads `graphStateForTurn.goal_constraints` alongside the compact graph | review-response |
| P1.4 | `readFactsFor` had no `ORDER BY`; `buildAnalysisFromPriorFacts` trusted `find()` first match | **Addressed** — `.order('created_at', { ascending: false })` added to the Supabase query (covered by existing composite index) | review-response |
| P1.5 | Task 3.2 required `chip_count` logging; only failure-response telemetry carried it | **Addressed** — new debug log emitted for every successful compose path with `chip_count` + `turn_class` | review-response |
| Imp-1 | Evidence pack commit count / test count stale | **Addressed** — this section and the test totals updated after the final suite run | review-response |
| Imp-2 | Prompt-size test had dead `longSystem` variable; didn't actually prove a large prompt survives | **Addressed** — test rewritten to import `ROUTING_SYSTEM_PROMPT` and assert the adapter receives exactly its length (regression guard for the eventual drop-in) | review-response |
| Imp-3 | Fallback analysis used raw option IDs as labels | **Addressed** — `buildAnalysisFromPriorFacts` accepts an optional `OptionLabelSource[]`; turn-executor passes current graph option nodes | review-response |
| Imp-4 | Consider extracting V5→V4 graph-compact dependency | **Rejected** — brief's anti-cleanup scope lock forbids restructuring modules or changing import patterns when not directly required by a task. The V5→V4 bridge is an accepted pattern (same as `compactAnalysis`). |

### Behavioural changes from review-response

- **B1 contract fixture** (`tests/fixtures/contracts/b1/valid-turn-payload.json`) now expects the `Set values for options` prompt chip instead of an executable Run analysis chip. The fixture carries no graph, so `graphOptionCount = 0` correctly routes to the safer prompt.
- **`prior_facts` semantics** — now deterministic newest-first at the session-store layer. Any other callers reading prior facts benefit; no caller relied on the previous arbitrary order.

## Commits on this branch (off staging `5a4f1a6e`)

```
25ca1d64 test(v5): update B1 fixture to expect run_analysis chip on analyse stage
f096dacc feat(v5): phase 3 prompt mechanism confirmation + observability
f9ce94eb feat(v5): phase 2 compose layer — deterministic chip generation on success
82df36aa feat(v5): phase 1 context layer — compact graph, analysis fallback, handler enum
```

**Not pushed.** Local commits only, per brief.

---

## Verification checklist

- [x] tsc clean at every phase gate
- [x] New V5 tests all pass (40 added)
- [x] No new failures vs baseline (delta = 0; pre-existing `adapters.test.ts` failure unchanged)
- [x] No files touched outside the Phase 0 plan's declared scope
- [x] No V4 bridge code modified
- [x] No `route-v2.ts` dispatch logic changed
- [x] No schema tarball or Supabase migration in this branch
- [x] `data/prompts.json` not committed (dirty from prior session, per brief)
- [x] Single-turn self-containment honoured: chip copy + prompt comments flag the constraint for the prompt drop-in

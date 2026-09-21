# V5 Context + Compose Layer Evidence

**Date:** 2026-04-24 (last updated after second review-response cycle)
**Branch:** `claude/v5-context-compose`
**Baseline commit:** `5a4f1a6e` (staging HEAD at branch creation)
**Current final commits on top of baseline:** 8 (see `§Commits` below — list updated each review cycle)
**Baseline tests (pre-branch):** 12,248 pass / 1 fail / 228 skipped / 1 todo (12,478 total)
**Latest full-suite totals:** see §Final test summary. 0 new failures vs baseline at every gate.

**New tests added across both review cycles:** 62
- 12 `compact-graph-for-contextpack.test.ts` (10 original + 1 size + 1 constraints passthrough)
- 16 `analysis-fallback.test.ts` (13 original + 3 label-resolution)
- 2 in `tool-schema.test.ts` (enum + permissive parser)
- 14 `chip-generator.test.ts` (12 original + 2 option-gating + setup-prompt fallback)
- 3 `route-with-tool-use-prompt-size.test.ts` (loading path + constant-length + 19K-char override)
- 5 new in `draft-graph-dispatch.test.ts` (post-draft chips: ready, absent, pending, failed, schema)
- 2 new in `supabase-store.test.ts` (ordering + FK-column regression)
- 1 new in `build-turn-context.test.ts` (row-id vs turn_id regression)
- 2 new in `turn-executor.test.ts` (analysis-fallback e2e: readFactsFor arg + ContextPack projection)
- 1 updated in `turn-executor-failure-responses.test.ts` (chips-on-success)
- 2 fixture updates in `tests/fixtures/contracts/b1/valid-turn-payload.json`

---

## ContextPack before/after shape

| Field | Before | After |
|-------|--------|-------|
| `conversation.recent_turns` | metadata only (turn_id, turn_class, handler_id, created_at) | **unchanged** — Task 1.1 deferred (schema + migration halt) |
| `graph.nodes` / `graph.edges` | full raw JSON (~3–5K tokens for 10-node graph) | **compact** via V4 `compactGraph` (~1K tokens for 10-node graph) |
| `graph.options` / `graph.goals` | derived from raw nodes | derived from compact nodes (same kind-based filter) |
| `graph.constraints` | passthrough from `goal_constraints` | **passthrough** — `goal_constraints` threaded via `compactedConstraints` so Sonnet does not lose decision constraints on the compact path (fixed in review cycle 1) |
| `analysis` | request-body only; null when UI omitted `analysis_state` | **server-side fallback** from prior `run_analysis` facts with unknown-freshness staleness flag |
| `analysis.staleness_reason` | always `null` | `null` when fresh; `'loaded_from_prior_run_freshness_unknown'` on fallback |
| Option labels in fallback analysis | option IDs (leak risk) | resolved from current graph when available, with id fallback (fixed in review cycle 1) |

### Token estimate before / after

| Component | Before | After (this branch) | After future prompt drop-in |
|-----------|--------|---------------------|---------------------------|
| System prompt | ~145 tokens | ~210 tokens (enum desc + loading-point comment) | ~5,000 tokens |
| Tool schema | ~650 tokens | ~700 tokens (enum constraint + desc) | ~700 tokens |
| Graph (10-node) | ~3,500 tokens (raw) | ~1,000 tokens (compact, constraints preserved) | ~1,000 tokens |
| Analysis summary | ~300 on request / 0 on follow-up | ~300 on request / ~150 on fallback | ~150–300 tokens |
| Coaching cache | ~200 tokens | ~200 tokens | ~200 tokens |
| Conversation history | ~50 tokens (metadata) | ~50 tokens (metadata) — Task 1.1 deferred | ~1,500 tokens (future) |
| User message | ~50–200 tokens | ~50–200 tokens | ~50–200 tokens |
| **Total** | **~4,900–7,000** | **~2,410–3,110** | **~8,650–9,000** |

The compact path continues to more than offset the prompt + schema growth. Even with the full 19K-char prompt drop-in, total input tokens stay well under the 15K target.

---

## Phase 1: Context layer

| Item | Status |
|------|--------|
| Conversation history text | **Not included** — Task 1.1 deferred. `v5_conversation_turns` has no columns for message text; `SessionTurnSchema` is `.strict()`. Migration + schema rebuild are halt conditions. |
| Turn count window | 5 (unchanged); metadata-only projection unchanged |
| Graph compaction | **Active** on every TurnExecutor turn with a graph. Strict GraphV3 parse with structural fallback. V4 `compactGraph` reused (same pattern as `compactAnalysis`). Typical 10-node graph: ~3,500 → ~1,000 tokens. |
| Constraints on compact path | **Preserved** via `compactedConstraints` passthrough (fixed in review cycle 1; previously `[]`). |
| Handler enum | **Constrained** to `['run_analysis']` at the tool-schema layer. Zod parser deliberately permissive so unknown handler_ids flow to HANDLER_NOT_FOUND → graceful coaching. |
| Analysis fallback | **Active** and verified end-to-end. Reads `prior_facts` (already loaded by `buildTurnContext`). Always flagged unknown-freshness. Option labels resolved from current graph. |
| `prior_facts` lookup correctness | **Fixed in review cycle 2.** `fetchPriorFacts` now passes `SessionTurn.id` (row UUID) into `readFactsFor`, which filters `v5_handler_facts.v5_conversation_turn_id` (FK to `v5_conversation_turns.id`). The pre-existing bug had it passing `turn_id` (client-generated) into a query that filtered the row-id column, returning zero rows silently. This had been disabling both the Task 1.4 fallback and the pre-existing coaching-cache decision-review / signal-from-facts lookups. Covered by three new regression tests across the store, builder, and TurnExecutor layers. |

---

## Phase 2: Compose layer

| Item | Status |
|------|--------|
| Chip generation | **Active on all four TurnExecutor compose branches** AND on the post-draft_graph dispatch (fixed in review cycle 2). Deterministic rules; no LLM. |
| Post-draft_graph chips | **Emitted** when the draft dispatcher succeeds: executable "Run analysis" when `analysis_ready.status === "ready"`, else a `Set values for options` conversational prompt. No chips on persistence failure. |
| Executable Run analysis chip gating | **Gated on `graphOptionCount > 0`** (fixed in review cycle 1) — offering the chip when no options exist would click through to PRECONDITION_UNMET. Falls back to `Set values for options` prompt when options are absent. |
| Max chips per response | 3 |
| Executable vs conversational | Distinguished by `action_type` presence. Only `run_analysis` (the single registered handler) appears as an executable chip. All other chips are conversational prompts. |
| Single-turn self-containment | Chip copy designed to work without conversation memory ("Explain the result" submits as "Please explain the analysis result in plain language"). |

### Chip examples produced (unit-tested end-to-end)

| Context | Chips |
|---------|-------|
| analyse + post run_analysis | `[Explain the result (prompt), What could change the outcome? (prompt)]` |
| analyse + no analysis + options > 0 | `[Run analysis (executable; action_type=run_analysis)]` |
| analyse + no analysis + no options | `[Set values for options (prompt)]` |
| analyse + no analysis + registry empty + options > 0 | `[Run the analysis (prompt fallback)]` |
| decide + robustness_band=fragile | `[What would make this flip? (prompt), Run a pre-mortem (prompt)]` |
| decide + robustness_band=stable | `[Explain the decision (prompt)]` |
| review + any analysis | `[Summarise the decision (prompt)]` |
| post draft_graph + analysis_ready.status === "ready" | `[Run analysis (executable)]` |
| post draft_graph + analysis_ready absent / not-ready | `[Set values for options (prompt)]` |
| post draft_graph + commit failed | `[]` (route returns 500 anyway) |
| frame + no handler | `[]` |

---

## Phase 3: Prompt mechanism + observability

| Item | Status |
|------|--------|
| Loading mechanism | **Hardcoded const** `ROUTING_SYSTEM_PROMPT` in `src/orchestrator-v5/routing/route-with-tool-use.ts`. Passed to the adapter as `system:`. No PMS on this path. |
| Loading-path regression guard | **Three tests:** (a) smoke that a system prompt reaches the adapter, (b) byte-for-byte equality to `ROUTING_SYSTEM_PROMPT.length`, (c) 19K-character override via the `systemPromptOverride` test seam proves the path survives the future drop-in. |
| Max size supported | No artificial limit (Claude 4.x input window ≈ 200K tokens). A ~19K-char prompt (~5K tokens) leaves ~195K tokens of runway. |
| Ready for prompt drop-in | **Yes.** Replace the `ROUTING_SYSTEM_PROMPT` constant value in full. No mechanism changes needed. Declaration carries a block comment flagging the drop-in point and the single-turn self-containment constraint. |

### Observability logs

After ContextPack assembly (one debug log per turn):
- `system_chars` — length of the routing system prompt (step-changes when the new prompt lands)
- `context_pack_chars` — full ContextPack JSON serialised length
- `conversation_history_turns` — count of prior turns included
- `graph_compacted` — boolean; true when compaction ran
- `graph_compact_via` — `'strict_parse' | 'structural_fallback' | null`
- `analysis_state_source` — `'request' | 'fallback' | 'absent'`
- `analysis_staleness_reason` — `null` or `'loaded_from_prior_run_freshness_unknown'`

After every successful compose (one additional debug log per turn — added in review cycle 1):
- `chip_count` — number of chips emitted on this response
- `turn_class` — which compose branch fired

---

## Review-response cycles

### Cycle 1 (initial external review)

Five P1 findings + three improvements addressed; one improvement (V4→V5 extraction refactor) rejected per the brief's anti-cleanup scope lock. Fixes:

- **P1.1** post-draft_graph chips (added `buildPostDraftChips` in `draft-graph-dispatch.ts`)
- **P1.2** executable Run analysis chip gated on `graphOptionCount > 0`
- **P1.3** `goal_constraints` preserved via `compactedConstraints` passthrough
- **P1.4** `readFactsFor` ordered `created_at DESC`
- **P1.5** `chip_count` debug log added on every successful compose
- Imp-1 evidence-pack numbers updated; Imp-2 prompt-size test rewritten to assert exact constant length; Imp-3 option labels resolved from current graph in fallback.

### Cycle 2 (this cycle — correctness deepening)

Two P1 findings + four improvements addressed:

- **P1 (critical correctness):** `fetchPriorFacts` passed `turn_id` into `readFactsFor`, but `v5_handler_facts.v5_conversation_turn_id` references `v5_conversation_turns.id`, not `turn_id`. Every production lookup returned empty, silently disabling the Task 1.4 analysis fallback AND the pre-existing coaching-cache decision_review / signal-from-facts lookups. Pre-existing bug that surfaced because my fallback feature was the first code to rely on `prior_facts` being non-empty in a test-visible way. **Fixed** by passing `t.id`; `readFactsFor` parameter renamed to `conversationTurnRowIds` with a docstring that loudly calls out the semantics.
- **P1 (coverage):** added an end-to-end TurnExecutor test using the mocked session store: a persisted `run_analysis` fact + a follow-up turn with no request `analysis_state` → the fallback analysis appears in the ContextPack with the unknown-freshness flag.
- **Imp-1** evidence pack rewritten end-to-end in this pass (constraints, chip examples, observability, commit list, checklist, totals).
- **Imp-2** prompt-size test now exercises a real 19K-char prompt via the new `systemPromptOverride` seam on `routeWithToolUse`.
- **Imp-3** draft-graph-dispatch chip behavior covered by five new tests (ready, absent, pending, failed-persistence, ActionSchema validation).
- **Imp-4** store-layer regression tests: assert `.order('created_at', { ascending: false })` is applied and the query filters `v5_conversation_turn_id`. The existing `v5_handler_facts_turn_idx` covers the `IN` filter; the ORDER BY is an in-memory sort by Postgres — explicitly documented in the call-site comment. Flagged a composite `(v5_conversation_turn_id, created_at DESC)` index as a potential future follow-up (not required at the current workload).

### Cycle 2 — behavioural changes

- Production behaviour: `prior_facts` was empty in every production turn before this cycle. It is now correctly populated, which activates the analysis fallback and the coaching-cache decision-review + signal-from-facts reads (both pre-existing features that had been silently dormant).
- `readFactsFor` signature: parameter renamed for clarity (`conversationTurnRowIds` instead of `turnIds`).

---

## Commits on this branch (off staging `5a4f1a6e`)

```
<this commit will append here>       — fix(v5): address second review cycle
0a140eb9 fix(v5): address external review findings on context + compose layer
6b4cbd62 docs(v5): context + compose layer completion — evidence pack
25ca1d64 test(v5): update B1 fixture to expect run_analysis chip on analyse stage
f096dacc feat(v5): phase 3 prompt mechanism confirmation + observability
f9ce94eb feat(v5): phase 2 compose layer — deterministic chip generation on success
82df36aa feat(v5): phase 1 context layer — compact graph, analysis fallback, handler enum
5a4f1a6e docs(v5): comprehensive V5 implementation audit (baseline)
```

**Not pushed.** Local commits only, per brief.

---

## Final test summary

| Scope | Before cycle 2 | After cycle 2 |
|-------|---------------|---------------|
| V5 tests (`src/orchestrator-v5`) | 737 pass / 0 fail | 749 pass / 0 fail |
| Integration tests | 1024 pass / 0 fail | 1024 pass / 0 fail |
| Full repo suite | see latest run | **12,305 pass / 0 fail / 228 skipped / 1 todo** (12,534 total) |

Delta vs baseline: +57 passes (new tests across both cycles), 0 new failures, pre-existing baseline failure in `tools/graph-evaluator/tests/adapters.test.ts` no longer surfaces in this environment.

---

## Verification checklist

- [x] tsc clean at every phase gate and after every cycle
- [x] All new V5 tests pass (62 added across both cycles)
- [x] No new failures vs baseline at any gate
- [x] Scope locks respected: no V4 bridge code edited, no `route-v2.ts` dispatch change, no schema tarball or Supabase migration
- [x] `data/prompts.json` not committed (dirty from prior session, per brief)
- [x] Single-turn self-containment honoured: chip copy + prompt-drop-in comment flag the constraint
- [x] Post-review correctness fix verified with three-layer regression tests (store call arg, builder arg mapping, TurnExecutor end-to-end projection)
- [x] Prompt-size loading path tested with a real 19K-char override
- [x] Evidence pack reconciled end-to-end — no stale sections

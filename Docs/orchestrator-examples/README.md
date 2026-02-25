# Orchestrator Examples (INT-3 Handoff)

Example `OrchestratorResponseEnvelope` JSON responses for Track D (UI) integration.
Types are exported from `src/orchestrator/types.ts`.

## Example files

### `pure-conversation.json`

No tools invoked. The user asks a follow-up question ("Why does churn matter so much?")
and the LLM responds with `assistant_text` only. No blocks, no `analysis_response`.
Includes two `suggested_actions` (facilitator + challenger) and a `stage_indicator`.

**When this shape occurs:** Any conversational turn where the LLM does not invoke a tool —
clarifications, explanations, follow-ups.

### `draft-graph.json`

The `draft_graph` tool is invoked deterministically ("Draft the graph").
Produces a single `GraphPatchBlock` with `patch_type: "full_draft"` containing
`add_node` and `add_edge` operations. Block has `accept`/`edit`/`dismiss` actions.

**When this shape occurs:** User requests graph creation or the LLM decides a graph
draft is needed. Always `long_running: true`.

### `run-analysis.json`

The `run_analysis` tool is invoked deterministically ("Run the analysis").
Calls PLoT `/v2/run` and returns the full PLoT response in `analysis_response`.
Produces a `ReviewCardBlock` (Evidence Priority). Zero `FactBlock`s (fact assembly
flag OFF in current staging).

**When this shape occurs:** User requests analysis. The most data-rich envelope — Track D
reads `analysis_response` directly for the Results Panel.

## Known Limitations (PoC)

1. **`patch_accepted` does not call validate-patch.** The UI must call PLoT
   `/v1/validate-patch` directly after patch acceptance. Post-PoC, CEE will
   handle this and return the validated `graph_hash` in the envelope.

2. **`undo_patch` is a stub.** Returns a text message explaining undo is coming
   soon. Not wired to any state management.

3. **Token budget uses static heuristic.** 4 chars/token estimate. Needs real
   staging measurement with 8-12 node graphs before production.

## Data edge cases

1. **`response_hash` location.** The authoritative `response_hash` lives at the
   **top level** of the PLoT response (`analysis_response.response_hash`), not
   inside `meta`. The envelope's `lineage.response_hash` is sourced from this
   top-level field.

2. **`meta.seed_used` is a string.** PLoT returns `seed_used` as a string
   (e.g. `"182005"`). The raw PLoT payload in `analysis_response` preserves this.
   CEE normalises to a number only inside `lineage.seed_used` and FactBlock lineage.

3. **`fact_objects` absent when flag OFF.** When `ENABLE_FACTS_ASSEMBLY` is OFF
   (current staging), PLoT does not return `fact_objects`. No `FactBlock`s are
   produced. Track D should treat `blocks` of type `fact` as optional.

4. **`review_cards` may be sparse.** Staging currently returns 0-1 review cards
   (Evidence Priority only). Track D should handle 0-N cards.

5. **`constraint_results` and `probability_of_joint_goal` may be null.** When no
   constraints are defined, both fields are null in the PLoT response.

6. **`analysis_response` is the full PLoT response.** The UI reads this directly
   for the Results Panel. CEE does not filter or transform it. The shape matches
   the PLoT `/v2/run` response exactly.

7. **Block IDs are format-correct illustrations.** The `block_id` values in these
   examples follow the `blk_<type>_<16-char-hex>` format but are not deterministically
   computed from the hash algorithm used in production. Do not use them as test
   fixtures for ID equality checks.

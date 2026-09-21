# V5 product-state continuity — UI handoff brief

**Tranche:** foamy-bee (V5 product-state continuity)
**Status:** CEE side complete and tested. UI work is the remaining tranche to close the failure loop end to end.
**Reference:** [Phase 0 investigation](../../.claude/plans/v5-product-state-continuity-investigatio-foamy-bee.md)

## Why this brief exists

The CEE-side fix grounds the routing LLM with curated mutation receipts and adds a deterministic state-query guard for the named "what update did you make?" follow-up. The UI side still has three issues that must be fixed before the staging failure scenario is fully closed:

1. The `graph_patch` block's raw `before` / `after` payload leaks structural identifiers (`constraint_id`, `node_id`, `operator`, `provenance`, edge IDs) into the default UI.
2. There is no user-facing surface where existing constraints are visible, so the user has nowhere to "see" the constraint they just added.
3. The freshness verdict (latest analysis is out of date) and the structural readiness verdict (model is ready to analyse) are conflated in the UI even though CEE already emits them as distinct fields.

The CEE side is shipping with a clean `assistant_text` for every mutation. The UI brief covers what to do with that, plus the rendering and visibility cleanup.

## What CEE now emits

CEE behaviour after this tranche:

- **Mutation success turns** still emit a `graph_patch` block (boundary schema unchanged — `.strict()` and out of scope to widen here). The `assistant_text` is the deterministic decision-language summary, e.g. `"Added constraint: Total cost must be at most £50,000."`. The `graph_patch` block's `before` / `after` records are unchanged on the wire — they still carry raw structural fields and remain available for debug surfaces.
- **State-query follow-up turns** ("what update did you make?", "what changed?", "I can't see it", etc.) are now intercepted by a deterministic pre-route. The response is a normal `direct_answer` with `assistant_text` referencing the most recent mutation summary verbatim; no `graph_patch` block is emitted on these turns. The routing LLM is not called.
- **Freshness signals** stay where they have always been: `analysis_ready.freshness ∈ { 'fresh' | 'stale' | 'unknown' | 'none' }` and `analysis_ready.status` (structural readiness) are independent fields. After a successful mutation following a prior analysis, the next response carries `analysis_ready.status: 'ready'` and `analysis_ready.freshness: 'stale'` simultaneously.
- **Post-mutation chips**: a successful mutation (or a state-query turn that refers back to a mutation) emits exactly one chip when the model is ready: `"Run analysis"` if no analysis has run, `"Run analysis again"` if the prior analysis is stale.

## UI work — three workstreams

### 1. Patch-card rendering cleanup

`GraphPatchBlockRenderer` (or the equivalent in the UI repo) currently renders the `before` / `after` records as a JSON-style table. Change:

- **Default surface:** render the block from `assistant_text` (already clean) plus a single value chip if the mutation has a clear before/after pair (e.g. `Customer churn → at most 5%`). Do not render structural IDs, edge IDs, `<=` / `>=` operator characters, or `provenance` / `applied_graph_hash` / similar.
- **Forbidden in default UI:** `constraint_id`, `node_id`, `target_id`, `operator` (as character), `provenance`, `applied_graph_hash`, `base_graph_hash`, `noop`, `fact_type`, `Zod`, `mean`, `std`, raw UUIDs, edge IDs (`a→b` / `a->b`), or any `_meta` / `enrichment` fields.
- **Debug-only surface (optional):** if the design system already has an "advanced" / "debug" disclosure, the raw `before` / `after` may live behind it. If no such surface exists, the raw fields stay in the response payload but are simply not rendered.
- **Decision language:** copy is already produced by `formatConstraintAdded` / `formatConstraintUpdated` / `formatFactorChange` / `formatEdgeAdjustment` in CEE. The UI should treat the `assistant_text` as authoritative for the human-readable summary, not synthesise its own from `before` / `after`.

The wire schema for `graph_patch` is locked to `{ type, status, operation, target_id, before, after }` and rejects unknown fields. Adding a `display` / `summary` field is a separate coordinated contract change that's out of scope for this tranche, so the UI must use `assistant_text` as the primary display source for this tranche. *(Implementation note for the CEE side: schema lives in the vendored `@talchain/schemas` package; the renderer doesn't need to know that.)*

### 2. Constraint visibility surface

The user said "I can't see this constraint on the graph" — and they were right. Today there is no panel listing the constraints applied to the model.

**Investigation, not commitment, in this tranche.** Pick the smallest enterprise-grade option from the existing surfaces:

- **Goal inspector / right panel:** likely already shows goal metadata. Adding a "Decision constraints" subsection co-located with the goal node is the most discoverable option and aligned with how users think about constraints (constraints are *on* the goal).
- **Model-summary / analysis panel:** if there is already a panel summarising the model state, a "Decision constraints" subsection there is also good. Less discoverable than the goal inspector but reuses an existing panel.
- **Goal node card on the graph:** could surface a constraint count badge plus a click-through. Keeps the graph clean but discoverability depends on the badge.
- **Dedicated section in a new top-level area:** out of scope for this tranche.

Whichever surface is chosen, the UI should be able to render the constraint list directly from the persisted graph (`graph.goal_constraints[]`). The fields on each entry split into a strict allowlist and an explicit do-not-render list:

| Field | Render in default UI? | Notes |
|---|---|---|
| `label` | Yes | Decision-language label, e.g. "Total cost" |
| `value` | Yes | Pair with the operator phrase + `unit` |
| `unit` (optional) | Yes | Currency / percent / unit suffix |
| `operator` | Yes — but TRANSLATE: `<=` → "at most", `>=` → "at least". **Do not render the literal operator characters.** |
| `constraint_id` | **No** | Internal id; debug surfaces only |
| `node_id` | **No** | Internal id; never user-visible |
| `provenance` | **No** | Internal metadata; never user-visible |

Render only the four allowlist fields, mapped to the decision-language phrase. The CEE-side `assistant_text` already uses the same mapping; match its output verbatim. *(Implementation note for the CEE side: the formatter is `formatConstraintAdded` in the d1-shared format-confirmation module; the UI doesn't need to navigate to it.)*

After choosing a surface, the AI's deterministic response copy can reference its location ("You can see all current constraints under Decision constraints in the right panel."). For now CEE does not include a "where to find this" hint in the receipt copy because the surface is not yet committed.

### 3. Stale / ready labels

CEE emits both fields on `analysis_ready`. UI must surface them as two distinct labels:

| Internal field | User-facing label suggestion |
|---|---|
| `analysis_ready.status === 'ready'` | "Decision model: ready to analyse" |
| `analysis_ready.status` ≠ ready | "Model needs more detail before analysis" (subtype shown by `blockers`) |
| `analysis_ready.freshness === 'fresh'` | "Latest analysis: current" |
| `analysis_ready.freshness === 'stale'` | "Latest analysis: out of date. Rerun to refresh." *(British English; sentence break preferred over em dash.)* |
| `analysis_ready.freshness === 'none'` | "No analysis run yet" |

After a successful mutation following a prior analysis, both labels should be visible simultaneously (model ready, analysis stale). The "Run analysis again" chip CEE emits is the recovery action; the badges are the diagnostic.

Forbidden in default UI: `graph_hash`, `graph_hash_at_run`, `current_graph_hash`, `freshness_reason`, `applied_graph_hash`. These belong in debug surfaces only.

## Acceptance — a successful round trip

End-to-end test the UI brief should hit, replaying the staging failure scenario:

1. User adds a constraint ("Yes, we don't want to spend more than £50k on this.").
2. Assistant text reads `"Added constraint: Total cost must be at most £50,000."` — UI renders this verbatim, with no UUIDs / structural IDs visible.
3. A "Run analysis" or "Run analysis again" chip is visible.
4. The constraint appears under the chosen visibility surface (Decision constraints in the goal inspector or right panel).
5. Both labels visible — "Decision model ready to analyse" + "Latest analysis is out of date" if the user had analysed before.
6. User says "I can't see this constraint. What update did you make?".
7. CEE deterministic dispatch: assistant text reads `"Added constraint: Total cost must be at most £50,000."` again.
8. No legacy denial copy ("No changes were needed for this request." / "No update has been made") ever appears.
9. User clicks "Run analysis again" → analysis runs → freshness flips back to current.

## Notes on copy

British English. Sentence case. No em dashes in default user-facing strings — a colon, a sentence break, or a comma reads better and avoids the rule. "Model" or "decision model", not "graph", in any user-visible text. The deterministic CEE strings already follow this; the UI brief is to extend the same discipline to badge copy and panel labels.

## Out of scope for this brief

- Routing prompt v40 changes — explicit deferral.
- Boundary schema changes to `graph_patch` block (would require a schemas package coordination).
- Broader conversation history architecture — only the named-follow-up loop is being closed.
- New top-level navigation surfaces.

## What CEE will support after the UI work lands

- `assistant_text` continues to carry the clean decision-language summary on every mutation success and every state-query intercept.
- `recent_changes` ContextPack projection grounds Sonnet's general-case answers (already shipping).
- The `v5.state_query_guard` telemetry event surfaces the deterministic pre-route hit rate; routing log fields `recent_changes_count`, `prior_mutation_fact_count`, `state_query_guard_outcome` are queryable in production.
- Post-mutation chip rule fires when applicable.

When the UI brief lands, this scenario stops being a regression risk and the loop is fully closed.

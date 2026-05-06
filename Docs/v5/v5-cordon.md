# V5 cordon — V4 dispatch sites still in use

> No-behaviour-change document. Authored 2026-05-07. Centralises the rationale for every V4 pipeline call still wired into the V5 route, so future work can see at a glance what is and is not on the V5 deterministic path.

## Why this document exists

`src/orchestrator/route-v2.ts` is the V5 route. The V5 routing tool schema (`src/orchestrator-v5/routing/route-with-tool-use.ts`) deliberately omits `draft_graph` and `edit_graph` as handler choices — Sonnet can never propose them. But two pre-Sonnet deterministic dispatch branches still call into V4 pipelines for those flows. Both are gated, both are documented, and both are tracked deferrals — not silent fallbacks.

This document is the single source of truth for which V4 paths remain, why, and what eventually replaces each.

## Active V4 dispatch sites

### 1. `draft_graph` — frame-stage initial graph from a decision brief

**Site.** `src/orchestrator/route-v2.ts` ~line 686 (the `dispatchDraftGraph` call inside the `isDraftGraphShape` branch). Returns via `sendFinalised200(reply, requestId, 'draft_graph', …)` on success.

**Trigger (conservative, false-positive averse).**
- `kind === 'message'` (system events branched earlier).
- `stage === 'frame'`.
- No `graph_state` on the request.
- Message length ≥ `DRAFT_GRAPH_MIN_BRIEF_LENGTH`.
- Message matches `DRAFT_GRAPH_DECISION_BRIEF_REGEX` (decision verbs or trailing `?`).

**Why it remains.** V5 does not yet have a deterministic `draft_graph` handler in the registry. Building one would require porting the V4 graph-synthesis pipeline (`src/orchestrator/tools/draft-graph.ts`) into a V5 handler with the same prompt-driven graph derivation, plus a registered tool schema. That is a Workstream-scale piece of work, not part of Workstream 1.

**What replaces it.** A future Workstream that introduces a deterministic V5 `draft_graph` handler (or a routing path that lets Sonnet propose a generic `synthesise_graph` action). Tracked as a follow-up; no ETA committed in this workstream.

**Allowed to depend on this temporarily.** First-turn frame-stage flows where the user supplies a decision brief but has no graph yet.

### 2. `edit_graph` — edit-intent dispatch when a graph is already present

**Site.** `src/orchestrator/route-v2.ts` ~line 870 (the `dispatchEditGraph` call inside the `isEditGraphShape` branch). Returns via `sendFinalised200(reply, requestId, 'edit_graph', …)` on success. There is also a recovery dispatch at `sendEditGraphRecovery` (~line 354) that ships a deterministic recovery message when graph state is missing.

**Trigger (conservative, false-positive averse).**
- `kind === 'message'` (system events branched earlier).
- `effectiveGraphState != null` (a graph exists to edit).
- Message matches `EDIT_GRAPH_POSITIVE_REGEX` (edit verbs).
- Message does NOT match `EDIT_GRAPH_NEGATIVE_REGEX` (meta-questions, figurative uses, "set up", etc.).
- Message does NOT match the value-update gate (`src/orchestrator/routing/value-update-gate.ts`) — value updates have their own deterministic V5 path.

**Why it remains.** V5 ships deterministic mutation handlers for the well-typed cases (`set_factor_value`, `add_constraint`, `adjust_edge_strength`). Free-form edit intents that do not match a typed handler (e.g. "rename this option", "remove the headcount factor", "add a risk node") still rely on V4 graph-edit synthesis to produce a structured patch. A general "proposal-to-action" contract (Workstream 2 in the audit) is the architectural replacement.

**What replaces it.**
- Per-mutation V5 deterministic handlers as we identify additional well-typed shapes (e.g. `add_option`, `remove_node`, `rename_node`).
- The `apply_proposed_change` end-to-end mechanism (Workstream 2) for proposals the model emits in response to "what should I add?" / "make those updates" style requests.

**Allowed to depend on this temporarily.** Free-form edit intents on an existing graph that do not match a typed V5 mutation handler.

## Tracked deferrals (not in this workstream's scope)

- **`apply_proposed_change` end-to-end.** The `PendingAction` union has the slot reserved (`session/pending-action.ts`); no composer emits, no handler exists, no resume path. Closing this is Workstream 2.
- **A4 add-risk clarification continuity.** `edit_graph_add_risk` has a clarification-resume path (`routing/clarification-resume.ts`) but the end-to-end continuity for the A4 scenario is deferred per Wave 6 acceptance.
- **Schema-package enrichment for richer `v5_graph_patch` display fields.** Adding a `human_description` / `entity_label` / `change_summary` field to `V5GraphPatchBlockData` requires a schema-package release. Workstream 1 explicitly avoids this — clean receipts are derived UI-side from `target_id` resolved against the canvas store.

## Cordon hygiene

When you touch one of the sites above:

1. Update this doc if the trigger conditions or replacement plan change.
2. Keep the inline pointer comment at the dispatch site (`// V4 cordon: see Docs/v5/v5-cordon.md §<n>`) intact.
3. Do not introduce a new V4 dispatch site without adding it here.
4. Removing a V4 site requires deleting both the inline pointer comment and the section here.

## Sites that are NOT V4 dispatch (do not list here)

For clarity — these mention `edit_graph` or `draft_graph` but are not V4 calls and do not need cordon comments:

- Capability stubs (`build-turn-context.ts`: `can_edit_graph: false`).
- Documentation comments in TurnExecutor explaining handler ID separation.
- `pending_action` kind classification (`edit_graph_add_risk`, `apply_proposed_change`).
- Validator exemptions in `route-with-tool-use.ts` (excluding `draft_graph`/`edit_graph` from the Sonnet tool schema).
- The legacy V4 `src/orchestrator/tools/*` modules themselves — these are the implementations the dispatch sites above call into.

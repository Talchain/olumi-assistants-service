# V5 routing contracts

Living document. Each contract listed here is enforced by at least one
integration test; new contracts must arrive with an enforcing test
(`assert*` helper) referenced from the contract entry.

---

## C-EDIT-1 — Edit-intent invariant

**Statement.** When edit intent is detected on an `OrchestratorTurnPayload`
with `kind: 'message'`, the route MUST produce **exactly one** of:

1. **Mutation dispatched** — `dispatchEditGraph` is called and its
   `commitPerformed: true` outcome flows through `sendFinalised200(...,
   'edit_graph', ...)`. (HTTP 200, OlumiResponse with the dispatcher's
   `assistant_text`.)
2. **Clarification requested** — a typed clarify response is emitted
   (Part 2 — not yet wired; reserved for the referential-resolution
   path that resolves "let's add this" against
   `recent_assistant_suggestions`). (HTTP 200, finalised via
   `sendFinalised200`.)
3. **Typed recovery** — a `direct_answer` 200 with the recovery message
   plus a `v5.edit_graph.graph_state_unavailable` telemetry event whose
   `reason` is one of `no_persisted_graph | persisted_graph_invalid |
   session_store_failed`. (HTTP 200, finalised via `sendFinalised200`.)
4. **Typed BoundaryError failure** — `dispatchEditGraph` is called but
   either reports `commitPerformed: false` (commit failed) or throws
   (pipeline error). The route surfaces this as `reply.code(500).send(
   boundaryError)` with `details.reason ∈ { 'edit_graph_commit_failed',
   'edit_graph_pipeline_threw' }`. This path **bypasses
   `sendFinalised200`**, so it emits ZERO `v5.response.finalised`
   events. The contract is still honoured: the failure is typed and
   observable on the wire, not a silent fallthrough.

The route MUST NEVER:

- Fall through to `runTurnExecutor` and finalise via
  `exit_path: 'turn_executor'` (the canonical signal of the silent-
  fallthrough bug this contract exists to prevent).
- Return an unflagged `direct_answer` 200 (one without either a
  `dispatchEditGraph` call or the
  `v5.edit_graph.graph_state_unavailable` telemetry signal).
- Emit a `v5.response.finalised` event on the typed-500 path. A 500
  outcome that accidentally went through `sendFinalised200` would
  conflate failure surfacing with success and break the
  `commit_performed === false ⇒ non-200` invariant elsewhere in the
  route.

### Edit-intent definition

Edit intent is detected when both of the following hold against the
ingress message text:

- `EDIT_GRAPH_POSITIVE_REGEX` matches (an edit verb is present).
- `EDIT_GRAPH_NEGATIVE_REGEX` does **not** match (no meta-question,
  figurative, or phrasal-verb override).

Both regexes live in `src/orchestrator/route-v2.ts`. Modifications must
preserve the asymmetry: tightening the negative regex is safe; adding
positive verbs requires paired negative-regex coverage to avoid
mutating the graph on a meta-question.

### Telemetry envelope

The contract is observable end-to-end through three pre-dispatch events
plus the standard `v5.response.finalised` finaliser-emission log:

| Event | When | Payload |
|---|---|---|
| `v5.edit_graph.graph_state_present` | Edit intent detected, `graphState` arrived on the request body. Baseline counter; no recovery action taken. Fires on both outcome (1) and outcome (4) — i.e. the dispatch was attempted, regardless of whether it ultimately succeeded. | `{ request_id, scenario_id }` |
| `v5.edit_graph.graph_state_reloaded` | Edit intent detected, `graphState` absent, persisted reload succeeded; dispatch proceeds against the reloaded graph. | `{ request_id, scenario_id }` |
| `v5.edit_graph.graph_state_unavailable` | Edit intent detected, outcome (3) returned. | `{ request_id, scenario_id, reason }` where reason ∈ `'no_persisted_graph' \| 'persisted_graph_invalid' \| 'session_store_failed'` |

A turn under this contract emits **at most one** of the three.
For `_present` and `_reloaded`, a follow-on `dispatchEditGraph` call is
expected (outcome 1) — or a typed BoundaryError 500 (outcome 4) if
that dispatch fails. For `_unavailable`, no dispatch occurs (outcome 3).

`v5.response.finalised` events are emitted by `sendFinalised200`.
Outcomes (1)-(3) emit exactly one such event with
`exit_path: 'edit_graph'`. Outcome (4) emits zero (the 500 path uses
`reply.code(500).send` directly).

### Enforcement

`assertRoutingContractHonoured({ expectsFinalised200 })` in
[`tests/integration/orchestrator/route-v2-edit-graph-recovery.test.ts`](../../tests/integration/orchestrator/route-v2-edit-graph-recovery.test.ts).

- Default (`expectsFinalised200: true`) — outcomes (1)-(3): asserts
  exactly one outcome signal AND exactly one `v5.response.finalised`
  event AND no event has `exit_path: 'turn_executor'`.
- `expectsFinalised200: false` — outcome (4): asserts exactly one
  outcome signal AND ZERO `v5.response.finalised` events (the typed-500
  path must not accidentally route through the 200 finaliser).

New cases that exercise edit intent should call this helper with the
parameter that matches the expected wire HTTP status.

### Scope limitation

The Part 1 fix closes the missing-`graphState` failure mode for the
**route-classification** half of the contract. With `graphState`
reachable (on the request or via reload), an edit-verb message —
including referential phrasing like "let's add this" — now reaches
`dispatchEditGraph` rather than falling through to TurnExecutor.

What Part 1 does NOT close is **target resolution inside the edit
handler**. Messages like "let's add this" carry an unresolved referent;
the handler may still fail to identify *which* entity the user meant,
and the user-visible outcome can be a confused or ineffective edit.
That gap is Part 2's responsibility and depends on a
`v5_coaching_state` (or equivalent) persistence path that surfaces
structured prior-assistant suggestions to the L1 context pack so
referential terms can be resolved before reaching the handler. Until
Part 2 lands, referential phrasing without an explicit entity name
remains a user-visible regression at the handler layer, even though the
route-level invariant in this contract is now honoured.

---

## How to add a contract

1. Pick a stable ID (`C-<AREA>-<N>`) and write the statement, MUSTs, and
   MUST NOTs.
2. Implement (or extend) an `assert*` helper in the integration suite
   that exercises the contract end-to-end.
3. Reference the helper from the contract entry.
4. Each test that exercises the contract calls the helper.

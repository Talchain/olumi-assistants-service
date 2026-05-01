# V5 routing contracts

Living document. Each contract listed here is enforced by at least one
integration test; new contracts must arrive with an enforcing test
(`assert*` helper) referenced from the contract entry.

---

## C-EDIT-1 — Edit-intent invariant

**Statement.** When edit intent is detected on an `OrchestratorTurnPayload`
with `kind: 'message'`, the route MUST produce **exactly one** of:

1. **Mutation dispatched** — `dispatchEditGraph` is called and its
   `commitPerformed` outcome is honoured by the route's downstream
   commit-status check.
2. **Clarification requested** — a typed clarify response is emitted
   (Part 2 — not yet wired; reserved for the referential-resolution
   path that resolves "let's add this" against
   `recent_assistant_suggestions`).
3. **Typed recovery** — a `direct_answer` 200 with the recovery message
   plus a `v5.edit_graph.graph_state_unavailable` telemetry event whose
   `reason` is one of `no_persisted_graph | persisted_graph_invalid |
   session_store_failed`.

The route MUST NEVER:

- Fall through to `runTurnExecutor` and finalise via
  `exit_path: 'turn_executor'` (the canonical signal of the silent-
  fallthrough bug this contract exists to prevent).
- Return an unflagged `direct_answer` (one without the
  `v5.edit_graph.graph_state_unavailable` telemetry signal).

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

The contract is observable end-to-end through three events:

| Event | When | Payload |
|---|---|---|
| `v5.edit_graph.graph_state_present` | Edit intent detected, `graphState` arrived on the request body. Baseline counter; no recovery action taken. | `{ request_id, scenario_id }` |
| `v5.edit_graph.graph_state_reloaded` | Edit intent detected, `graphState` absent, persisted reload succeeded; dispatch proceeds against the reloaded graph. | `{ request_id, scenario_id }` |
| `v5.edit_graph.graph_state_unavailable` | Edit intent detected, recovery returned. | `{ request_id, scenario_id, reason }` where reason ∈ `'no_persisted_graph' \| 'persisted_graph_invalid' \| 'session_store_failed'` |

A successful turn under this contract emits **at most one** of the three.
For `_present` and `_reloaded`, a follow-on `dispatchEditGraph` call is
expected. For `_unavailable`, no dispatch occurs.

### Enforcement

`assertRoutingContractHonoured()` in
[`tests/integration/orchestrator/route-v2-edit-graph-recovery.test.ts`](../../tests/integration/orchestrator/route-v2-edit-graph-recovery.test.ts).
The helper checks both **exactly one** outcome and **no
turn_executor exit_path** on `v5.response.finalised`. New cases that
exercise edit intent should call this helper.

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

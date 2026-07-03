# Track 2 → Track 3 — pending-state read seam

**Owner:** Track 2 (AI Harness Core). **Consumer:** Track 3 (graph management /
mutation referee). **Status:** stable read seam; Track 3 must consume it rather
than re-derive pending truth.

Track 2 owns *state truth* for pending actions; Track 3 owns *mutation
application* (the referee, CAS/hash apply, `add_option`, full graph evolution).
This note pins the minimal, stable surface Track 3 consumes so graph management
never reinvents pending-state authority — the single-source-of-truth rule from
the platform hazard map.

## The authority (read this, do not re-implement)

Persisted pending actions live in `v5_conversation_turns.pending_actions`
(JSONB), written atomically at commit by `append_turn_atomic(p_pending_actions)`.
The **only** supported reads are the last prior turn's set via the session store:

- `loadMostRecentPendingActions(scenarioId, requestId)` — swallowing (returns
  `[]` on read failure). Use when a degraded read should look like "no pending".
- `loadMostRecentPendingActionsStrict(scenarioId, requestId)` — throws on read
  failure. Use when you must distinguish "no pending" from "read failed" (the
  route-level proposal suppressor does).

Both live in `src/orchestrator-v5/build-turn-context.ts`. During a turn, the
already-loaded set is on `EnrichedTurnContext.most_recent_pending_actions`.

**The store read does NOT filter expiry** (parse + scenario checks only). Wall-
and turn-expired entries reach the caller. Liveness is the caller's job.

## Liveness — the single predicate (Track 2, `session/pending-action.ts`)

```ts
isPendingActionExpired(pa, nowMs): boolean         // malformed ISO → expired;
                                                   // nowMs > expires_at_iso → expired;
                                                   // expires_at_turn_count <= 0 → expired
filterLivePendingActions(pendings, nowMs): PendingAction[]   // order-preserving
CONFIRMATION_EXPECTING_ACTION_TYPES: ReadonlySet<PendingActionKind>
    // { apply_proposed_change, proposed_concept, set_factor_value, edit_graph_add_risk }
```

Track 3 MUST use `filterLivePendingActions` (or `isPendingActionExpired`) to
decide what is live. Do **not** treat `most_recent_pending_actions.length > 0`
as "there is a live pending action".

### Two deliberately-different predicates — do NOT unify with the above

- **Carry-forward survival** (`commit.ts` `computeSurvivingPriorPendings` /
  `…Detailed`) decrements the turn-count TTL and additionally applies
  consume/supersede/graph-hash rules. It is the *persistence* rule, not a read
  rule. The turn-count TTL is decremented in exactly one place (the executor's
  `commitTurn` wrapper threads `priorPendingActions`); route-level dispatchers
  never decrement. Do not call it to answer "is this live now".
- **`isProposedConceptExpired`** (`coaching/proposal-continuation.ts`) is
  wall-clock only, by design (documented there). Do not fold it into the shared
  predicate.

## Lifecycle vocabulary (proposed → held → refused → applied → expired)

There is **no lifecycle state machine and no new column** — the lifecycle is
*diagnosable* from existing fields, not stored:

- **proposed** — a live pending action exists (`filterLivePendingActions`).
- **held** — it carried forward across a non-consuming turn (a survivor of
  `computeSurvivingPriorPendings`; TTL decremented once).
- **refused** — its `chip_id`/`proposal_ref` was passed in `consumedPendingRefs`
  by a dismissal path at commit.
- **applied** — its ref was passed in `consumedPendingRefs` by an apply path at
  commit (after the apply actually dispatched).
- **expired** — dropped by wall or turn TTL (carry-forward, or read-time
  liveness).

The commit-time carry-forward pass emits a redacted tally
(`PendingLifecycleSummary` in `session/pending-action.ts`, surfaced on
`CommitResult.pendingLifecycle` and in the frame's `pending.lifecycle`
diagnostics): `{ priorCount, consumedCount, supersededCount, expiredWallCount,
expiredTurnsCount, hashInvalidatedCount, survivedCount }`. The six outcomes
partition `priorCount` exactly.

## The apply/refuse contract Track 3 must honour

When Track 3's referee applies or refuses a proposal, it records the outcome by
threading the consumed handle through commit metadata — it does NOT mutate
pending state directly:

```ts
CommitMetadata.consumedPendingRefs: readonly string[]   // the chip_id(s) = proposal_ref(s)
```

Carry-forward then drops those refs so a consumed proposal can never reappear as
a zombie. Invariants to preserve:

- **persisted-pending ⟹ resumable** — every persisted entry parses to a
  `RESUMABLE_ACTION_TYPES` kind (`parsePendingAction` enforces).
- **`proposal_ref === chip_id`** for `apply_proposed_change` (the bridge the
  short-confirm resumer uses; `parsePendingAction` rejects violations).
- **`preconditions.graph_hash` gating** — a graph-mutating proposal carries its
  emit-time hash; the referee compares against the live hash and treats a
  mismatch as superseded (see `decideProposedChangeSynthesis`). Track 3's CAS
  apply should reuse this, not invent a parallel hash check.

## Persisted-first graph authority (unchanged; do not fork)

The graph read source is `graphStateForTurn ?? context.persistedGraph`
(request-second). Writes go through `commit.ts` → `append_turn_atomic(p_graph)`
atomically with the turn row. Track 3's apply logic must write through this same
chokepoint — do **not** add a second graph-write path or a second source of
truth.

## What Track 2 does NOT own (Track 3's to build)

The mutation referee, CAS/hash apply, `add_option`, and full graph evolution.
Track 2 exposes only the read seam + lifecycle vocabulary above.

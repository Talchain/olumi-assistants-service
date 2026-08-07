# V5 turn fence — Stop tombstone + per-scenario generation

Codex P0. Brief: `parallel-briefs/STOP-FENCE-BUILD-2026-07-31.md`.
Evidence: `PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md`.

## The defect, as reproduced

Live on staging (CEE `76d2e1c`, UI `1e320e5c`), scenario
`a6ccf5cf-aab0-4f01-b889-e0d6c072067c`:

1. A streamed draft turn was STOPPED by the user at **+4.0 s**. The UI's Stop
   aborts only its own `AbortController`; no cancel endpoint existed anywhere in
   CEE, and `src/routes/streamed-turn-sse.ts:71-78` deliberately does not cancel
   a turn when the client hangs up. The turn ran its full **52.7 s** and
   committed.
2. A second, different turn was sent on the same scenario at **+5.0 s**. It
   committed at `23:43:37.438179`; the stopped turn committed **163 ms later**
   and overwrote its graph.
3. Final persisted state was **forked**: `brief_text` from the live turn,
   `scenarios.graph` from the stopped one.

## What the fence does

Two facts had nowhere to live. Now they do, in `v5_turn_fence` (one row per turn
START, migration `20260731120000_v5_turn_fence.sql`):

| Fact | Column | Written by |
|---|---|---|
| "the user explicitly stopped THIS turn" | `stopped_at` | `POST /proxy/v5/turn/stop` → `v5_mark_turn_stopped` |
| "a LATER turn has claimed this scenario" | `generation` (`bigserial`) | post-admission claim (`admitCurrentTurnFence`, after `runPreFlight` passes — 2.174 fix b; the preHandler only binds the slot) → `v5_claim_turn_fence` |

Both are read in one round trip (`v5_evaluate_turn_fence`) immediately before a
graph-bearing commit, inside `SupabaseSessionStore.append()` — the single
`scenarios.graph` writer in the service.

**Exactly what is rejected:** a write that carries a graph, whose turn is either
tombstoned (`stopped`) or whose `generation` is lower than the newest generation
claimed on that scenario (`superseded`) — or whose fence cannot be read at all
(`unavailable` / `unclaimed`, fail closed). Nothing else. Non-graph commits are
never fenced: a superseded turn ROW is harmless history.

**Atomicity (2.174 fix c):** a claimed turn's graph write now runs through
`append_turn_atomic_v4`, which performs the fence check INSIDE the append
transaction under `FOR UPDATE` on the turn's own fence row — a concurrent Stop
either commits first (the append refuses) or waits (and then
`already_committed` reads true). The pre-v4 sentence stands for the FALLBACK
path only (v4 not migrated, feature-detected via PGRST202): there the
evaluation and the append are separate round trips and a Stop landing inside
that ~10-40 ms window is not seen — stated in `turn-fence.ts` arrival 10.

**Incidental disconnect is unchanged.** A tab close or network drop sends no stop
request, so there is no tombstone and the turn commits exactly as before — the
finish-atomically semantics the #751 arc chose deliberately. Pinned by a separate
test from the Stop case, so a regression in either direction fails on its own.

## The three UI copy states

The Stop route answers with what it RECORDED, in the past tense. The UI's
terminal notice is keyed on that answer and never promises an outcome:

| Server answer | Terminal notice | Chip |
|---|---|---|
| `200`, `already_committed: false` | *"You stopped this draft. It was cancelled before it was saved."* | Start a new draft |
| `200`, `already_committed: true` | *"You stopped this draft, but it had already been saved to your canvas."* | Start a new draft |
| non-`200` / unreachable | *"You stopped this draft. We could not reach the server to cancel it, so it may still be saved."* | Start a new draft |

`already_committed` is derived server-side from `v5_conversation_turns`, so it is
a statement about a row that exists rather than a prediction. The notice is
emitted on **every** explicit Stop, including one pressed before any streaming
message or graph preview exists — that is the "early Stop is silent by design"
record from #527's liveproof being superseded.

## Deploy ordering — not advice, a precondition

The application half **fails closed**: if the fence RPCs are absent, every
graph-bearing commit is refused. So the migration must be executed on the target
database BEFORE this code deploys. Non-graph turns keep working either way, and
the failure is loud and immediate rather than a service silently running
unfenced.

> ⚠ **This section was false when written, and the #759 adversarial review is why
> it is true now.** A missing migration presents as `PGRST202` on the ingress
> *claim*. A failed claim used to bind **no** fence handle, so the commit took its
> "this commit never came through the fenced ingress" branch — which **allows** the
> write. A wrong deploy order therefore ran **silently unfenced**, the exact
> opposite of the paragraph above, and the `unclaimed` verdict that was supposed to
> catch it was unreachable because the only producer of a handle was a *successful*
> claim. The proven consequence was not merely "no fence" but an active clobber
> with no timing inversion needed: turn B's claim blips → B commits unfenced → turn
> A (generation 1) reads `max_generation = 1` → verdict `current` → **A overwrites
> B**. A failed claim now binds `generation: null` and graph writes refuse.

## What a fence refusal looks like on the wire

A refusal is a typed 409-class conflict, never a 500. `TurnFenceRejectedError` has
its own branch in the executor's commit catch (ahead of the generic
`STATE_COMMIT_FAILED` fallback) and maps to `GRAPH_WRITE_CONFLICT` →
`GRAPH_DIVERGED` → HTTP 409, carrying:

| field | value |
|---|---|
| `fence_verdict` | `stopped` · `superseded` · `unclaimed` · `unavailable` |
| `recovery_action` | `start_new_draft` (stopped) · `refresh_and_reconfirm` (superseded) · `retry_later` (unclaimed/unavailable) |

Until the #759 review nothing caught that error, so every refusal flattened to
`INTERNAL_ERROR` → **HTTP 500**: "you stopped this turn" arriving as a server
error, unactionable for the UI and permanent alert noise. Honest residual: 409 is
a compromise for the two INFRASTRUCTURE verdicts (`unclaimed`, `unavailable`) —
a 503-class code would be more accurate but needs a contract change, and they stay
distinguishable via `fence_verdict`.

## Residuals (rowed, not hidden)

* ~~The evaluate→append window above. Closing it needs the check inside
  `append_turn_atomic` itself.~~ **Built (2.174 fix c):** `append_turn_atomic_v4`
  (migration 20260731130000, rehearsed; execution orchestrator-sequenced —
  runbook at `Docs/v5/runbooks/turn-fence-atomic-append-migration.md`). Until
  the migration executes, the feature-detect fallback keeps the window as the
  documented residual.
* `v5_turn_fence` grows one row per turn and nothing prunes it; retention is a
  separate decision. **Two ways a trim job would break the fence**, spelled out in
  the migration next to the table: deleting an in-flight turn's row refuses that
  turn's write (a lost draft), and deleting a scenario's NEWEST row lowers
  `max_generation` so an older in-flight turn reads `current` and can clobber — the
  second silently reintroduces the very defect the table prevents.
* **No retry on a fence read.** One transient blip costs a whole draft. A retry
  would widen the evaluate→append window the fence's honesty depends on, so it is
  priced and rowed rather than built; if added it belongs inside the RPC.
* A dedicated 503-class wire code for the infrastructure verdicts.
* A commit reached by any route other than `POST /orchestrate/v2/turn` would be
  unfenced. No such route exists today (every `commitDirectAnswer` call site is
  downstream of that handler), and the store emits
  `v5.turn_fence.evaluated{verdict:"unfenced"}` at ERROR if one ever appears.

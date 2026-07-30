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
| "a LATER turn has claimed this scenario" | `generation` (`bigserial`) | the ingress preHandler → `v5_claim_turn_fence` |

Both are read in one round trip (`v5_evaluate_turn_fence`) immediately before a
graph-bearing commit, inside `SupabaseSessionStore.append()` — the single
`scenarios.graph` writer in the service.

**Exactly what is rejected:** a write that carries a graph, whose turn is either
tombstoned (`stopped`) or whose `generation` is lower than the newest generation
claimed on that scenario (`superseded`) — or whose fence cannot be read at all
(`unavailable` / `unclaimed`, fail closed). Nothing else. Non-graph commits are
never fenced: a superseded turn ROW is harmless history.

**What it is not:** a lock. The evaluation and the append are separate round
trips, so a Stop landing inside that ~10-40 ms window is not seen. Stated in
`turn-fence.ts` arrival 10, and never described as atomic anywhere.

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

## Residuals (rowed, not hidden)

* The evaluate→append window above. Closing it needs the check inside
  `append_turn_atomic` itself.
* `v5_turn_fence` grows one row per turn and nothing prunes it; retention is a
  separate decision.
* A commit reached by any route other than `POST /orchestrate/v2/turn` would be
  unfenced. No such route exists today (every `commitDirectAnswer` call site is
  downstream of that handler), and the store emits
  `v5.turn_fence.evaluated{verdict:"unfenced"}` at ERROR if one ever appears.

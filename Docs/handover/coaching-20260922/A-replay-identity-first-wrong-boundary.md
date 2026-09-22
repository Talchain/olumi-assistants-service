# Gate 1 replay recovery — the first wrong boundary

**Date** 22 Sep 2026 · **Owner** coaching lane (CEE) · **Verdict: the boundary is in CEE, not SDL.**
Measured at CEE `bd35cc9e1a838159ec3949a278a89820acb01151` (= deployed staging `bd35cc9`,
confirmed via `/healthz`), in a fresh blobless clone with `HEAD` asserted equal to that SHA.

## Verdict

CEE persists **two different durable turn identities on two different paths**, and the
handler-routed (mutation) path uses the one the client cannot reproduce on a retry.

| Path | Durable `v5_conversation_turns.turn_id` written | Source |
|---|---|---|
| route-v2's own commit branches (draft / clarify / offer) | `ingress.turn_id` — the **client body** identity | `route-v2.ts` ~9 `commitDirectAnswer` sites, e.g. `:4559`, `:8056` |
| turn-executor's commit branches (**handler-routed**) | `context.request_id` — a **server-minted per-HTTP-request** id | `turn-executor.ts`, ~36 `commitTurn` sites, `turn_id: context.request_id` |

The fence keys on the **client body** identity on both paths:
`turn-fence-prehandler.ts:readIngressTurnIdentity` reads `body.scenario_id` + `body.turn_id`
and `admitCurrentTurnFence` claims `v5_turn_fence (scenario_id, turn_id)` with them.

So on a handler-routed mutation the fence row and the durable turn row are keyed by
**different identifiers**. The durable replay lookup —
`SupabaseSessionStore.committedTurnRowId(scenario_id, write.turn_id)` (the sole production
caller is `tryFirstWriteExemptRecovery`, `supabase-store.ts:1438`) — and the RPC's
`UNIQUE (scenario_id, turn_id)` therefore key on the **request id**.

`request_id` comes from `getOrGenerateRequestId(req)` (`utils/request-id.ts:79`): the
`x-request-id` / `x-cee-request-id` / `x-correlation-id` header if it matches
`^[A-Za-z0-9._-]{1,64}$`, **otherwise `randomUUID()`**. The UI mints a fresh one per send
(`useConversation.ts` → `buildRequestIdHeaders(generateRequestId())`).

**Consequence.** A retry that carries the same durable client identity (`body.turn_id`)
arrives with a *new* request id. The replay lookup keyed on that id finds nothing, so the
write is treated as fresh — and SDL's repaired ordering (replay-before-CAS) cannot help,
because there is no prior row *under the key it is given*. The CAS then refuses, because the
original write moved the graph head. That is the 409.

**This is upstream of persistence.** The lower layer is being handed an identity that changes
on every retry; it is behaving correctly for the key it receives.

## Independent corroboration (different lane, different tips, 3 Sep)

The UI lane derived the same five hops and wrote them down in
`DecisionGuideAI/src/canvas/conversation/deliveryUnknown.ts` (header + `retrySafety`):
`useConversation` → `buildRequestIdHeaders` → CEE `ALLOWED_REQUEST_HEADERS` →
`getOrGenerateRequestId` → `turn-executor` `turn_id: context.request_id` →
`append_turn_atomic` `UNIQUE (scenario_id, turn_id)`. Their `retrySafety()` predicate is
written and **deliberately not wired**; its `request_id_reused` branch is the client half of
the same fix.

## Live measurement (the discriminating one)

Supabase REST, service role, most recent **1000** `v5_conversation_turns` rows in the last
7 days (PostgREST capped the page at 1000 — this is a sample, not a manifest), left-joined
client-side against all `v5_turn_fence` rows for the same 359 scenarios (718 fence rows):

```
--- committed turn_id present in v5_turn_fence? by turn_class ---
direct_answer   turns= 582  fence_match= 367  absent= 215
handler         turns= 341  fence_match=  16  absent= 325
clarify         turns=  77  fence_match=   5  absent=  72

--- by handler routing ---
handler_routed  turns= 341  fence_match=  16  absent= 325   (4.7%)
no_handler      turns= 659  fence_match= 372  absent= 287  (56.4%)
```

**Contrast control fires**: 367 `direct_answer` turns DO match a fence row in the same run, so
the probe can see agreement. Handler-routed turns agree **4.7%** of the time against
**56.4%** for the rest — a 12× gap in one run, one window, one probe.

`direct_answer` is mixed because turn-executor also commits `direct_answer` turns; the split
inside that class is exactly the two-writer picture above. The 16 handler matches are not yet
explained and are recorded as an open item, not waved away.

## What is NOT the defect

- Not the SQL. `20260920210000_v5_append_v5_replay_precedes_cas.sql` is the right fix for the
  ordering, and SDL's own evidence that it landed stands. It cannot recover a row that was
  never written under the key the retry presents.
- Not the fence. The fence reads the client identity correctly, and already proves the client
  identity reaches CEE intact on every fenced ingress.
- Not `client_turn_id`. `OrchestratorTurnRequest.client_turn_id` (`orchestrator/types.ts:117`,
  commented "Client-generated turn ID for idempotency") has **zero** readers estate-wide —
  measured with a contrast control: the symbol occurs in exactly two files, the declaration
  and a comment excluding it from hashing. It is a legacy v1 field, not the live carrier.

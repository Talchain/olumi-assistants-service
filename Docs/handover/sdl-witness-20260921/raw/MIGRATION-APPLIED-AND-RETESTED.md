# `20260920210000` APPLIED to the shared Supabase project — 2026-09-21T23:13:34Z

Applied on Paul's explicit instruction, via the ledger-aware guarded runner.

## Apply

| | before | after |
|---|---|---|
| ordering | `CAS_BEFORE_REPLAY (defective)` | **`REPLAY_BEFORE_CAS (fixed)`** |
| replay lookup offset | 2417 | **1639** |
| `IF NOT v_turn_preexisting` guard | absent | **present at 1862** |
| CAS guard offset | 1743 | 2242 |
| body length | 10,010 | 10,259 |

## Independent verification (fresh connection, read-only, not via the applier)

| check | result |
|---|---|
| `prosrc` md5 | `7b78d8e12550628570e15b2b739c2d4d` |
| **same md5 as the body lane A proved GREEN (8/8) in the container** | **true** |
| overloads of `append_turn_atomic_v5` | 1 (no stray overload) |
| argument count | 30 (signature unchanged) |
| replay lookup precedes CAS | true |
| MV409 / MV422 replay-identity guards | both present |
| v4 delegation | present |
| ledger row `20260920210000` | **present** |
| ledger row `20260920220000` | **absent** (correct — not requested) |
| total ledger rows | 137 → **138** |
| grants: service_role / authenticated / anon EXECUTE | true / false / false (unchanged) |

The live function is now **byte-identical to the body that passed lane A's eight
assertions** against a container whose pre-fix body was in turn byte-identical to
the deployed one. The proof and the deployment are the same artefact.

## Replay witness, rerun after the apply

| | before migration | after migration |
|---|---|---|
| step 1 commit | receipt, version created | receipt, version 6 created |
| step 2 head moved | yes | yes |
| **step 3 replay** | 409 `GRAPH_DIVERGED` / `turn_fence_superseded` | **409 `GRAPH_DIVERGED` / `turn_fence_superseded`** |
| receipt on replay | none | none |
| duplicate version | none (5 → 5) | none (7 → 7) |

**Wire behaviour: UNCHANGED — and this confirms the pre-apply analysis rather than
contradicting it.** The replay never reaches the RPC: it is intercepted by the
turn fence, because the client's `turn_id` is discarded on handler-routed turns
and the RPC's replay key is therefore a server-minted id the client never holds.
The SQL ordering defect is genuinely fixed; the wire-level recovery gap is a
different, un-fixed defect and was never claimed to be in scope.

## Safety

No regression. Both graph-changing turns in the retest committed normally and
produced receipts and versions (6 and 7), so the working path is intact. Genuinely
stale writes are still refused. Rollback remains one command:
`MIGRATION_APPLY_APPROVED=1 node scripts/witness/apply-migration.mjs --rollback`.

## What remains open, and is NOT requested

Threading the client `turn_id` through the handler path so the idempotency key is
one the client actually holds. That is the other half of exactly-once. Until it
lands, an agent or client that retries a mutation will receive `409
GRAPH_DIVERGED`, must treat it as "re-read canonical state and reconcile", and
must never interpret it as "the write failed, send it again".

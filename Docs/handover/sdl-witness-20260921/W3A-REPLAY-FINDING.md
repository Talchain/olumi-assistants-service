# W3-A: the wire replay is refused — but not by the defect we were chasing

Measured on deployed staging, owned scenario, 2026-09-21T23:0x BST. Structured state only.

## What was run

1. **T** (client `turn_id` `883ed691-a763-474e-bb7e-f1e0ae4c4a2c`): "Set Monthly Churn Rate to 5%."
   → HTTP 200, `model_version_receipt` PRESENT, version 4 created, head moves to `b4575848…`.
2. **U** (different turn): "Set Active Customer Base to 1500." → HTTP 200, receipt present,
   version 5, head moves to `6cdc982c…`. **Head confirmed moved.**
3. **Replay of T, byte-identical body, same client `turn_id`.**

## Result

| | |
|---|---|
| replay HTTP | **409** |
| error | `GRAPH_DIVERGED` |
| `conflict_category` | **`turn_fence_superseded`** |
| `fence_verdict` | `superseded` |
| `recovery_action` | `refresh_and_reconfirm` |
| receipt returned | none |
| versions before → after replay | **5 → 5 (no duplicate)** |

**Good news first: there is no corruption.** The replay did not double-apply the
mutation and did not create a second version. The system is safe. What the caller
loses is *recovery*: it holds a turn id, gets a refusal, and cannot obtain the
receipt for a write that did commit.

## ⭐ The finding that matters: the client's `turn_id` is DISCARDED on handler turns

The replay was refused by the **turn fence**, not by the v5 CAS — and the reason
the SQL replay path never even came into play is more fundamental.

Measured, with a contrast control in the same query:

| turn | client `turn_id` sent | stored in `v5_conversation_turns` |
|---|---|---|
| draft (`direct_answer`) | `0ee1cf2f…` | **`0ee1cf2f…` — preserved** ✅ control |
| mutation T (`handler`) | `883ed691…` | **absent; stored as `003261ae…`** |
| mutation U (`handler`) | (random) | stored as `c108a6ad…` |

`select count(*) where turn_id = '883ed691…'` → **0 rows anywhere in the table**,
while the draft's client id is present. So the id is preserved on the
draft/`direct_answer` path and **regenerated on the handler path** — which is
exactly the path that commits a model version.

### Why that defeats the idempotency contract

`append_turn_atomic_v5`'s replay lookup keys on
`WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id`, and the row it later
inserts carries that same `p_turn_id` — so the stored `turn_id` IS `p_turn_id`.
For a handler-routed mutation that value is **server-minted and never returned to
the client**. A client replaying with its own `turn_id` therefore presents a key
the lookup can never match: the RPC sees a brand-new turn, and the fence or the
CAS refuses it as a conflict.

**So wire-level idempotency does not exist today for the write class that creates
model versions** — regardless of the CAS/replay ordering.

## ⚠ What this means for migration `20260920210000` — stated honestly

The migration is still **correct and worth applying**: lane A proved RED→GREEN on
a container running a byte-identical copy of the deployed function, and the
ordering defect it fixes is real.

But it must not be sold as restoring exactly-once for user mutations. On the
evidence above it does **not**, on its own, make a wire replay recoverable for
handler-routed mutations, because the replay lookup's key never matches. It fixes
the ordering for any caller that *can* present the same `p_turn_id` — the
server-side and port-level callers — and it removes a latent trap. That is the
honest claim, and it is narrower than "exactly-once is fixed".

The complete fix needs a second, separate change: **thread the client's `turn_id`
through the handler path** so the idempotency key is one the client actually
holds. That is not in scope tonight and is not requested.

## Consequence for the OpenAI connected-witness seam

The integration contract's "what key must an Agent retry with?" row must say:
the Agent's `turn_id` is **not** currently honoured as an idempotency key on the
handler path. An Agent that retries will be refused with `GRAPH_DIVERGED` /
`turn_fence_superseded` rather than receiving the original receipt. Any agent
loop must treat a 409 as "re-read canonical state and reconcile", never as
"the write failed, send it again".

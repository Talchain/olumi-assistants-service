# AI Coaching / Core Correctness — lane state

**Updated 22 Sep 2026 15:5xZ · served `0b2b472` · STATE: active, blocked on three DECISIONS**

## The number

```
### 24 PASS · 5 FAIL · 0 SKIP   on build 0b2b472   (29 assertions, criteria 1-7)
1=PASS · 2a=PASS · 2b=FAIL · 3=FAIL · 4=PASS · 5=PASS · 6=PASS · 7=FAIL
```

⚠ **Criteria 1–6 are measured on `/orchestrate/v2/turn`. Criterion 7 says whether
a user reaches it — and it FAILS.** A green conventional roll-up no longer
describes a user's experience.

## What is done — merged, deployed, witnessed

**#1686, #1679, #1685.** Criteria 1, 2a, 4, 5, 6 are JOURNEY-WITNESSED on
deployed staging via `/orchestrate/v2/turn`.

## The 5 failures, and who owns each

| rows | criterion | owner | blocked on |
|---|---|---|---|
| 3 | 2b reconcile · 3 reused id | **#1688** `344cf12cf02233035e816a16eb05066e9db40eb8`, green ×2 | **release-control exact-head verdict** |
| 2 | 7 the user's surface | `PROXY_V5_TARGET=agent` | **release-control / Paul decision** |

Also green and awaiting a verdict: **#1680** `02627c475de45041f434c3902c62f3ceb0ab6165`.

## Three decisions this lane cannot make for itself

1. **#1688's verdict.** It is a wire change (`assistant_text`, `graph_patch.status`),
   so NOT LOW RISK by the rubric and self-merge is unavailable. It clears all 3
   conventional rows.
2. **`PROXY_V5_TARGET`.** Set to `agent` at ~14:55Z; deploy live 14:58Z. The
   deployed UI posts **every** turn to `/proxy/v5/turn` (89 chunks swept, no flag,
   no alternative path). So a user can start a model and **cannot edit one**, and
   no `analysis_ready`/`analysis_result` reaches their client. Rollback is
   unsetting one variable (schema default `orchestrator`).
3. **The strictness marker.** "under 4%" becomes `<=` at extraction with **no loss
   record**; at exactly 4% the product says *"met every limit you set"*. CEE
   **cannot** withhold on its own — the copy is PLoT's and CEE has no free-form
   slot (`v5_handler_facts.payload` is a strict 14-member union). The smallest
   enabling change is a **strictness marker**, which is a schema/wire change.

## Settled — do NOT re-derive
- Priority 4 holds end to end on the conventional route; UI renders staleness on
  **four flag-free surfaces**, all binding to `analysis_ready.freshness` /
  `blocks[].freshness` — **both ABSENT on the agent route**.
- `factor_value_edit` HAS a receipt-bearing carrier; the guest 0 is the known
  guest-conditional skip. Authorship marks are written identically for guests.
- CEE reads **no `category`** on the value write path.
- The agent lane's "READ-ONLY" gates **edits, not creation** — it writes a
  32-node graph from a brief, and drops goal constraints with a disclosure.
- `/proxy/v5/turn/stream` is re-targeted too, so the **whole** journey is agent-served.
- ⛔ **A turn row is NOT an orchestrator/agent discriminator** — use `_agent`.
- **The witness has been wrong five times, always optimistically.** See
  `BASELINE-CURRENT.md` and `READ-ONLY-IS-NOT-READ-ONLY-20260922.md`.

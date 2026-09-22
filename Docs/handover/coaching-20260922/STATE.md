# AI Coaching / Core Correctness — lane state

**Updated 22 Sep 2026 14:38Z · served `34ee62f` · STATE: active**

## Where the spine is

```
### 24 PASS · 3 FAIL · 0 SKIP   on build 34ee62f   (27 assertions)
1=PASS · 2a=PASS · 2b=FAIL · 3=FAIL · 4=PASS · 5=PASS · 6=PASS
```

**#1686, #1679, #1685 are all merged, deployed and witnessed.** Criteria 1, 2a,
4, 5, 6 are JOURNEY-WITNESSED on deployed staging.

## CURRENT TASK — land #1688. It owns every remaining failure.

| PR | head | state |
|---|---|---|
| **#1688** | `344cf12cf02233035e816a16eb05066e9db40eb8` | base retargeted to `staging`, `behind=0`, CI re-running, awaiting exact-head verdict |
| **#1680** | `02627c475de45041f434c3902c62f3ceb0ab6165` | green ×2, `behind=0`, awaiting verdict |

#1688 now carries **two** fixes:
1. a reused operation id refuses truthfully (2 rows);
2. the reconciliation guard tested the optional param so the reread was **dead on
   staging** (1 row) — found by witnessing #1685's own deploy.

## NEXT ACTIONS
1. On a verdict: merge, wait for Render, confirm `/healthz` build changed.
2. Re-run `witness/spine.mjs` signed-in. **All 27 must pass**, not just the 3.
3. Rows that must NOT move: `a CAPPED scale factor does NOT swallow a bare 0.8`,
   `a reused turn_id writes nothing`, and both criterion-5 controls.

## BLOCKERS
- Release-control exact-head verdicts on #1688 and #1680. Both are NOT LOW RISK
  (wire/commit-path), so self-merge is unavailable. Nothing else is blocked.

## Settled — do NOT re-derive
- **Priority 4 holds end to end.** CEE emits `freshness` fresh→stale
  (`graph_hash_match`→`graph_hash_diverged`); the UI renders it on **four
  flag-free surfaces**. `readiness` deliberately does not demote on staleness —
  never use `status`/`may_run` as a freshness signal.
- **CEE reads no `category`** on the value write path; observable/external
  persist identically. The read-only-ness is UI-side and total.
- **`factor_value_edit` HAS a receipt-bearing carrier** (signed-in mints a
  version; guest 0 is the known guest-conditional skip). The authorship mark
  (`user_override` / `user_set`) is written identically for guests.
- **The OpenAI agent route does NOT share the spine for its conversational
  turn** — no `v5_conversation_turns` row, no durable replay key, `blocks: []`,
  in-process `Map` history. NOT deployed, but `AGENT_LANE_ENABLED=true` is
  already live. `build_model_from_brief` has **no durable idempotency key**.
- Goal-direction reach is **1.3%** of live boards; PLoT #365 alone is a no-op.
- **The witness has been wrong four times, always optimistically.** History in
  `BASELINE-CURRENT.md`. Re-read it before trusting any number.

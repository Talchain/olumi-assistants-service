# BLOCKED — 22 Sep 2026, updated ~20:55Z

**2026-09-22 — BLOCKED: staging's user surface is on the Agent route with four
known defects open, and this lane is explicitly instructed not to change the
target — needs release control to either unset `PROXY_V5_TARGET` or accept a
refusal that is no longer bounded away from users.**

## The instruction conflict someone must reconcile

- **20:08Z, release control:** *"`PROXY_V5_TARGET=orchestrator` set by Release
  Control. This closes the config-execution delay. **Do not change the target.**"*
- **~20:50Z:** the target is `agent` again (`AGENT_LANE_PREVIEW=false`, full mode).

I have **not** changed it and will not — the instruction is explicit and the
disposition is release control's. But the current state and that instruction are
inconsistent, and two lanes are now blocked behind it.

## What it costs users, measured 20:52Z on the live surface, signed-in

```
POST /proxy/v5/turn   "change Sales Cycle Length to 11"
HTTP 200 · v5_conversation_turns rows: 0 · blocks: (empty) · raw_value: 9 (unchanged)

"Sales Cycle Length currently holds 0.45 in the model, but its unit/range is
 not recorded. I can't safely replace it with 11…"
```

1. **`0.45` is the internal 0–1 scale** — the model holds **9 months**.
2. **"unit/range is not recorded" is FALSE** — the node carries `unit: "months"`,
   `raw_value: 9`. The route reads `observed_state.value` and not the unit it holds.
3. **The edit silently did not happen** — 0 turn rows, no receipt, nothing to reread.

⭐ **Canvas reached the same conclusion independently, from a different surface,
at 20:50Z.** Two lanes, two methods, same wire.

## Why "accept the bound" is no longer available

I asked (comment 5783575389) whether the agent route's state was an **accepted**
safe refusal, and flagged that acceptance must carry *"do not front this route
until these are fixed"*. **The route was fronted.** A refusal that reaches users
is not a bounded refusal — it is the product.

## The rollback

**Unset `PROXY_V5_TARGET`** → schema default `orchestrator`. On that route the
witness read **`31 PASS · 0 FAIL · 0 SKIP`** at 20:20Z: criterion 7 green, edits
applying, receipts minted, `analysis_ready` present. One variable, no deploy of
its own.

## What is NOT blocked

Conventional route work is **done and was witnessed**: seven PRs merged and
deployed today (#1686, #1679, #1685, #1688, #1692, #1690, #1697), the staging
red-gate incident found and fixed, the strictness defect code-bounded in CI.

Both OpenAI-route implementations are **complete, pushed, and verified to merge
cleanly** into current staging — held unlanded by the 18:12 assignment:
`feat/agent-route-discloses-readiness` @ `0595718252e6`,
`fix/registration-leaves-a-version` @ `b3643ccb028c`.

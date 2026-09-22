# "READ-ONLY preview" builds whole models — and my discriminator did not discriminate

**22 Sep 2026 · builds `c8c8841` → `dfb31ed` → `0b2b472` · each claim bound to the build beside it**

## ⛔ Two errors of mine, in order

**1. "The agent route commits nothing and records nothing."** False. I had only
probed it with an **edit to an existing model**, which it refuses. Given a
**brief on an empty model** it writes a 32-node graph and a turn row.

**2. I used "a turn row was written" as the orchestrator/agent discriminator.**
It does not discriminate — the agent's `build_model_from_brief` writes one
through the graph-register writer. My first sibling probe read "ORCHESTRATOR"
for both routes and I was one command from publishing it.

⭐ The rule that caught it: *when a probe returns the same answer for every
item, suspect the probe.* Both rows said ORCHESTRATOR; the conventional route
had already been measured as agent-served minutes earlier. The contradiction was
the tell, not the reading.

## The discriminating probe — `_agent` vs `analysis_ready`/`_diagnostic_trace`

Build `0b2b472`, signed-in:

| request | `_agent` | orch markers | turn rows | nodes | verdict |
|---|---|---|---|---|---|
| `/proxy/v5/turn` · **empty** · frame | true | false | **1** | **0 → 32** | AGENT |
| `/proxy/v5/turn` · populated · edit | true | false | 0 | 12 unchanged | AGENT |
| **`/proxy/v5/turn/stream`** · empty · frame | true | false | **1** | **0 → 33** | AGENT |

## What it settles

1. **Read-only for EDITS, not for CREATION.** `agent-tools.ts:104` lists only
   `propose_model_change` / `authorise_change` as mutation tools, so
   `build_model_from_brief` is **not gated by `AGENT_LANE_PREVIEW`**. The label
   is doing work the flag does not do.
2. **`/proxy/v5/turn/stream` is re-targeted too.** The cold first draft — the
   0-node case the UI streams — is agent-served, so the **whole** journey is on
   that route, not just the turns after the first.
3. **The model it builds drops the user's constraints**, and says so:
   `build-model.ts:155-166` records `goal_constraints_not_carried`. That
   disclosure is **more honest than the conventional path**, which silently
   widens `<` to `<=` with no loss record at all.

## Witness change

`spine.mjs` gains **criterion 7 — the route the user actually reaches**,
reported separately so it can never flatter the conventional roll-up:

- `/proxy/v5/turn` forwards to the orchestrator (PASS) or the agent route (FAIL);
- a user CAN apply a model edit on their own surface;
- a `403 PROXY_ORIGIN_REJECTED` is recorded as **"not measurable"**, never as a
  product failure — my first attempt at this probe was rejected on origin and
  printed a `false` that looked like a finding.

⚠ Criteria 1–6 are measured on `/orchestrate/v2/turn`. **A green roll-up there
no longer describes a user's experience**, and the run now prints that warning.

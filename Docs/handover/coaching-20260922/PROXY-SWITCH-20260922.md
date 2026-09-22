# The UI surface stopped being able to apply edits at 14:58Z

**`PROXY_V5_TARGET` went from ABSENT (14:00) to `agent`, and the deploy carrying
it went live at 14:58Z.** Measured on both sides of that deploy, same commit
`c8c88412`, same request, same allowed `Origin`, same signed-in user.

| `POST /proxy/v5/turn` — *"change Sales Cycle Length to 11"* | before 14:53Z | after 14:58Z |
|---|---|---|
| `v5_conversation_turns` rows | **1** | **0** |
| `blocks` | `graph_patch, ui_directive` | **(empty)** |
| persisted `raw_value` | **9 → 11 applied** | **9 unchanged** |
| reply | *"Updated Sales Cycle Length from 9 months to 11 months…"* | *"This read-only preview cannot make the change…"* |

The only difference is which process was serving: the 14:50 deploy read its
config **before** the variable was set. That boot ordering is the entire reason
the first measurement looked fine, and it is why config must be confirmed
**behaviourally**.

## The spine itself did not move

Witness on `c8c8841`: **24 PASS · 3 FAIL · 0 SKIP** — byte-identical roll-up to
`34ee62f`. The agent-lane merge touched **no** spine file (`commit.ts`,
`session/`, `route-v2.ts`, `turn-executor` all untouched) and the witness posts
to `/orchestrate/v2/turn` directly, so it still measures the real spine
regardless of what `/proxy/v5/turn` forwards to.

⚠ **That is also the limitation.** A green spine witness now says **nothing**
about what a user experiences, because the user's surface is no longer the route
the witness measures. Any future "witnessed on staging" claim must state which
route it drove.

## The preview is behaving correctly in its own right

Probed directly: `POST /agent/v1/turn` *"Change Sales Cycle Length to 42 months.
Apply it now."* → `HTTP 200`, *"I can't apply changes in this read-only
preview."*, graph hash unchanged, `raw_value` still 9. Mount confirmed against an
absent-route control (404). The refusal was tested, not the absence.

⚠ But it quotes the **normalised internal value** to the user — *"its current
model value of 0.45"* — where the orchestrator says *"9 months"*. `0.45` is the
stored scale, not anything a user set or would recognise.

**No config was changed by this lane.** Rollback is unsetting `PROXY_V5_TARGET`
(schema default `orchestrator`).

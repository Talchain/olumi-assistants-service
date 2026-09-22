# The OpenAI agent route does not share the spine for its conversational turn

**22 Sep 2026 · deployed `a459d23` · PR branches #1684 `9d55f77e`, #1687 `cec29016`**

The remit is the spine **"for both the conventional PoC and OpenAI route"**. Only
the conventional one had ever been witnessed.

## Verdict: PARTIAL, NOT DEPLOYED — but pre-armed

Absence at `a459d23a` with controls in the same run: `agent-lane` **0** files,
`agent/v1/turn` **0**, `AGENT_LANE` **0**; controls `orchestrate/v2/turn` **260**,
`append_turn_atomic_v5` **25**, `commitDirectAnswer` **174**. Live: `POST
/agent/v1/turn` → **404**; mounted control → **422** from its own handler.

⚠ **`AGENT_LANE_ENABLED='true'` and `AGENT_LANE_PREVIEW='true'` are ALREADY SET**
on the live service (Render env fully paginated, 123/123), against code that does
not exist. Merging either PR mounts the route on the next deploy with no further
decision.

## What is shared

| capability | path | spine |
|---|---|---|
| `authorise_change` | `/orchestrate/v2/turn` `system_event` | SHARED |
| `run_analysis` | `/orchestrate/v2/turn` `message` | SHARED |
| `build_model_from_brief` | `/assist/v1/…/graph/register` | other sanctioned writer, bypasses `commit.ts` |
| **the conversational turn** | compose + finalise + return | **SEPARATE** |

Zero direct DB access lane-wide (`.rpc(`/`supabase`/`SessionStore` = 0; contrast
`session/` = 9). Every state movement is `app.inject` to an existing route —
good discipline, and it means the two shared arms genuinely inherit the spine.

## ⛔ But the agent's own turn never commits

`composeDirectAnswerResponse` + `finaliseV5Response`, returned. Neither persists
(`store.append` = 0 in both; control `commit.ts` = 5). So:

- **no row in `v5_conversation_turns`** — no turn id, no receipt, **no durable
  replay key**;
- conversation of record is an **in-process `Map`** (200 sessions / 24 turns,
  lost on restart, not shared across instances);
- `blocks: []` and never filled — **no `graph_patch` to carry a status, and no
  `analysis_result` block reaches the client**.

**Every guarantee witnessed this session — exactly-once commit, truthful replay
reconciliation, no false success narration — is scoped to `commit.ts`, so none
of it applies to that turn.** The lane has its own narrower machinery
(`confirmEdgeWrite`, written after it shipped a false success on 22 Sep) but it
covers `add_edge` **only**; `run_analysis` sets `ok: r.status === 200`, which is
status-code truth — the exact shape `confirm-write.ts` exists to forbid.

## Idempotency — mixed, one real gap

- `authorise_change`: derived, stable (`SHA-256('agent_authorise:<proposal_id>')`).
  But the DB replay arm is **unreachable** — `structural-add-edge.ts:249-265`
  returns `BASE_HASH_DIVERGED` **before** `payload.turn_id` is consulted, so a
  retry gets a divergence refusal, not a replay-identical receipt.
- `run_analysis`: `randomUUID()`, deliberate.
- ⛔ **`build_model_from_brief`: no durable key** — `graph_registration:<uuid>`
  per request. A retry is a **second whole-graph replace**, guarded only by a
  read-before check: a **TOCTOU window, not a key**. This is the one place the
  lane can replace an entire user model twice.

## The switch to watch

`proxy-v5-turn.ts` (#1687): `proxyV5Target === "agent" ? "/agent/v1/turn" :
"/orchestrate/v2/turn"`. The UI posts to `/proxy/v5/turn`. **One merge plus one
env var moves ALL UI conversational traffic** onto the route with no turn rows.
`PROXY_V5_TARGET` is currently **absent** on staging (defaults to
`orchestrator`). Mounting and switching should stay separate decisions.

⚠ Do not conflate with `orchestrator-v5/replacement/agent-loop.ts`, which **is**
deployed inside `route-v2` (flag `CEE_REPLACEMENT_COACH_ENABLED`, absent on
staging) and therefore **does** share the spine.

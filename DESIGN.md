# Current-level answers reach the level door

Scope: HARNESS item 1 only. Edit files; no vitest, commits or deployment.

## Producer and storage
- `agent-lane/goal-certainty.ts:noDeadEndAsks` produces the “today’s level”
  question for a frameless goal; the warning carries its typed
  `first_ask: { kind: 'goal_level', node_id }` with the warning via
  `placeholderGoalWarning`.
- That identity is not currently retained as an Agent pending ask.
- Add the exact question to this producer's typed goal-level ask. Persist an
  `elicit_goal_current_level` pending action in the existing `pending_actions`
  JSONB, atomically with the FINAL delivered Agent answer. No new store/DB.
- Emit only if that producer question survives final prose gates. Retain its
  goal identity, user-given figures and their original quote through a clarification, only
  when the latest reply restates those figures and asks for their reading.
- Read only the most recent pending row, scoped to scenario and authenticated
  subject, with expiry checks. Never recover an older ask from chat text.

## Routing and change
- `routes/agent-v1-turn.ts` claims/replays the turn, resolves explicit chips
  (approval, Run, explanation, research, methods), then reads canonical state
  and runs the Agent. Existing brief routing uses `hostFirstCall`; a stated
  link uses `firstCallTool`. Method/answer doors retain priority.
- At that same state-read seam, a typed level ask plus a plausible figure/unit
  answer forces `propose_goal_current_level` as the first call. The model reads
  the user's units/ambiguity; the existing capability validates the actual
  quantity and prepares the approval card. No new level writer or auto-apply.
- A confirmation routes only when the latest typed carrier records that its
  assistant reply restated a figure the user supplied. “The latter.” requires
  a two-way choice; “Yes, how do they affect this decision?” confirms first.
- No ask, stale/mismatched subject/goal, another forced path, preview mode,
  withheld tool, another quantity, a question back, uncertainty or a percent
  answer to a non-percent metric: leave the existing route untouched.
- A pending approval consumes the ask. Free conversation never renews it.

## Validation and scanner constraints
- Read the route's writer/cache, state-authority, compose-site and
  anti-rederivation source guards before editing. Preserve their pinned writer
  calls, compose sites and existing authority reads; add no commit door.
- New rows drive the actual Agent route: the three founder replies with their
  typed prior asks force the level tool; the direct sentence still works.
- Pair with controls for another quantity, question back, uncertainty and
  percent/non-percent mismatch, plus no/stale ask, preview and subject mismatch.
- Exercise JSON round-trip/parse and clarification carry; DL runs all tests.

## Open ruling
- Ambiguous multi-figure replies force the existing door rather than selecting
  one number in host code. The DL rules whether the resulting clarification
  and subsequent reading meet the served founder journey; no invented weights.

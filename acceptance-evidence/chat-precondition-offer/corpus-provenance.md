# Chat precondition offer corpus provenance

The corpus retains six current served P44 draws and five earlier stored runner add-risk turns. All source graph, stored brief, user request, card and assistant-text fields are copied from local served artifacts. Every copied source has its absolute path and SHA-256 in the fixture. No external model calls, network requests, database reads or writes were used for this extraction.

**Evidence limit:** none of these runner captures retains the provider's raw `function_call.arguments`. The `_agent.tool_calls` array contains name, status and proposal identity only. The saved graph readback's `conversation_turns` contains user and assistant prose only. The runner's `tools` output reads that same metadata. A saved partial Render log has `hasMore: true`, covers only the first current draw, and does not contain the arguments; it is not a complete interval or a zero-evidence claim.

Consequently the fixture `args` are explicitly labelled **reconstructed minimal inputs**, based on the observed card's risk label, target, effect direction and precondition option label. Optional rationale, presence versus absence of `caused_by`, and `whole_request` are unknown. These rows verify each recorded graph and call outcome through the real door with a scripted model. They are not exact actual-arguments replay. The first missing evidence for that stronger brief requirement is the recorded provider `function_call.arguments` for each draw. No invented argument is presented as recorded.

## Six current served draws

Fixture: `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/p44-six-served-draws.json`.

All six requests say: “Add a risk: Feature release slips — if the next Pro feature release slips, MRR will be lower.” Each uses its own exact recorded graph and brief; the graphs and option labels differ between draws.

| Runner directory under `/Users/paulslee/olumi-work/er-witness-rc3/` | Recorded outcome | Reconstructed minimal input | Expected new presses |
| --- | --- | --- | --- |
| `chatpre-1791445452373` | Ordinary risk → MRR card | `label: Feature release slips`, `affects: MRR negative` | 2 |
| `rate-1791445706889` | Science precondition card for “Raise price with release” | Same risk, empty affects, `relies_on_option: Raise price with release` | 0 |
| `rate-1791445821808` | Science precondition card for “Raise Pro price to £59” | Same risk, empty affects, `relies_on_option: Raise Pro price to £59` | 0 |
| `rate-1791445947054` | Ordinary risk → MRR card | Same ordinary input | 2 |
| `rate-1791446061420` | Ordinary risk → MRR card | Same ordinary input | 2 |
| `rate-1791446180986` | Ordinary risk → MRR card | Same ordinary input | 2 |

Source files in every directory: `wire/turn-002-p44-add-risk-*.json`, the matching `.req.json`, `wire/read-draft-*.json`, and `card.json`.

The first five provider ledgers bind to CEE `31ae60cb59f429c6ea9e2e3d09080d3ecece37da`; the last binds to `b31021623cfb13c43d395e9e0dbf1e6751c4a482`. The exact source hashes are recorded with each fixture row. The two observed lease cards establish the option label the held result disclosed, rather than proving the exact argument spelling the model supplied.

## Stored runner turns

Fixture: `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/stored-runner-add-risk-corpus.json`.

| Runner source | Recorded tool outcome | Replay treatment |
| --- | --- | --- |
| `/private/tmp/accel-p44/goalreach/draw-3/wire/turn-002-r5-add-risk-1791434265714.json` | `propose_new_risk`, ordinary Feature release slips → MRR card | Reconstructed minimal inputs, expect 2 presses |
| `/private/tmp/accel-p44/goalreach/draw-4/wire/turn-002-r5-add-risk-1791434885505.json` | Same ordinary P44 outcome | Reconstructed minimal inputs, expect 2 presses |
| `/Users/paulslee/olumi-work/joined-witness/jw-j2/wire/turn-006-add-risk-1791428738006.json` | `propose_new_risk`, Largest-client contract cancellation → Monthly revenue card | Reconstructed minimal inputs, unrelated-event control, expect 0 presses |
| `/Users/paulslee/olumi-work/joined-witness/jw-j1/wire/turn-006-add-risk-1791428064940.json` | No tool call; asks whether to refine the existing contract-cut risk | Retained, `do_not_replay: true`; do not fabricate a call |
| `/Users/paulslee/olumi-work/joined-witness/rg-j1/wire/turn-006-add-risk-1791444935119.json` | No tool call; same-event clarification | Retained, `do_not_replay: true`; do not fabricate a call |

For each stored runner row the graph and stored brief come from the latest saved graph read with a timestamp before the add-risk request. Its exact source and hash are retained. The cancellation message states 20–40% within six months; the fixture preserves that full request and observed card.

There is also a witnessed deterministic More-risks precondition press at `/Users/paulslee/olumi-work/er-witness-rc3/run-1791436975547/wire/turn-003-add-precondition-1791437097070.req.json`: `agent-widen-add:815bb98a800bc635`, Feature release delay to Raise Pro price to £59. Its zero-hop response records `propose_new_risk`. The host call can be reconstructed from the press and the source-version `widenAddCallOf`, but the wire again does not retain a raw argument payload. The existing RC3 door machinery is the authority for that reconstruction, not a new precondition writer.

## Egress and visible press audit

`src/routes/agent-v1-turn.ts` assembles ordinary specific controls at `offeredSpecific`, passes them through `nextStepOffersForTurn`, then forms `offeredNow`. The final composer uses `offeredNow` as `suggested_actions`; the persistence floor can subsequently remove lapsed approval controls. Put new presses beside the ordinary specific controls without replacing the card. The deterministic reply line should be composed as an owed visible line before the final reply writer and history/answer persistence.

The live-style DGAI source in `/private/tmp/accel-p44-dgai3/src/canvas/conversation/zones/SuggestedChips.tsx` handles `agent-widen-add:` by identity, bypasses its three-chip display cap for the whole press set, and displays every chip's `label`. Existing risk Add labels are just “Add ‘risk’”, so two offered options require labels that name their option. An ordinary widen chip's `detail` is only its accessible name and hover title; only consent and research details get a visible disclosure panel. The chip `message` is the sent press request, not visible button text.

CEE `isDurableAnswerOffer` rejects any action carrying `detail`. Adding full-message detail therefore makes a press live-only under the current contract. Plain option-labelled presses without detail fit the existing durable carrier, but `stillValidOffers` currently re-offers next-step/widen presses only while a Run is current and no approval is held. A response that intentionally offers precondition alternatives beside an ordinary held card is outside that old predicate; do not assume the general reload carrier automatically replays the new alternatives. The existing stamped-risk RC3 reload remains unaffected.

The existing `widenAddCallOf` validates current graph identities and mechanism. Its old relies-on path requires a factor changed by the option plus a unique goal/outcome solely to bind unused identities; the new offer requirement is any non-baseline option. Reusing an option-only press minted by the same family and extending the same resolver is the minimal way to meet this requirement without introducing a second writer. Revalidation must refuse deleted, changed-identity, relabelled, newly baseline or status-quo options.

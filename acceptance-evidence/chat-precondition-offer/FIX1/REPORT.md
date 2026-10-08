FIX1 is complete in the working tree. HEAD remains `b31021623cfb13c43d395e9e0dbf1e6751c4a482` on `dl/event-risk-precondition-offer`. The first-pass work and evidence are retained. No commit, push, merge or deployment.

On the deterministic trigger, the ordinary `gmh_` proposal remains held with its original revision/digest/card words. The reply is exactly:

> Your brief launches the change with the next Pro feature release, so ‘Feature release slips’ may be something one option relies on, rather than a threat to MRR for every option. Which is it?

Its only presses are £59, £54, then “It lowers MRR for every option”. No ordinary approve chip or `_proposal_fields` card is emitted. Direct approval of the hidden hold is also refused at `confirmHeld`.

The decline press binds the held id and displayed digest. It re-offers that same card, revision and digest, without a model call or another `propose_new_risk` call. Approval then writes the ordinary risk → MRR batch. Unknown ids and changed digests are terminal refusals with no graph write.

Choosing £59 uses **existing same-key supersession**, not expiry. Both interpretations intentionally share the deterministic `gmh_` handle; RC3 replaces its revision, digest, operations and approval words. The old ordinary two-change chip is absent. Its direct approval is refused both before and after the RC3 card is approved. The stamped risk has `relies_on.option_id = raise_pro_price_to_59` and zero incident edges.

Choice data is carried inside the existing held inline patch. Warm replay, process-restarted replay and cold graph GET restore the three choices, with no ordinary card. The general widening/Run replay predicates and action-bar predicates remain unchanged. Requests without a supplied turn id bind the choice marker to the actual generated answer id.

The final persistence floor checks the exact latest revision/digest before recording a choice presentation. A delayed decline cannot resurrect ordinary operations after a concurrent RC3 replacement; the newer hold survives and the stale decline is refused.

| Row | Final result | Evidence |
| --- | --- | --- |
| (a) Exact reply; ordered three choices; no ordinary chip/card | PASS | [Targeted GREEN](targeted-GREEN.log) |
| (b) Decline → same card/revision/digest, 0 calls → approve → risk → MRR | PASS | [Targeted GREEN](targeted-GREEN.log) |
| (c) Unknown gmh / changed digest → refused; no graph write | PASS | [Targeted GREEN](targeted-GREEN.log) |
| (c) Concurrent same-handle replacement at persistence floor | PASS | [RED race](RED-decline-floor-race.log), [GREEN](targeted-GREEN.log) |
| (d) £59 → RC3 → approve → stamp; old words refused before/after | PASS | [Targeted GREEN](targeted-GREEN.log) |
| (e) Warm/cold replay and production graph reload retain choices only | PASS | [RED graph reload](RED-graph-reload.log), [GREEN](targeted-GREEN.log) |

RED was run before the FIX1 production changes: [first-pass RED](RED-first-pass.log) showed the ordinary chip/card leak, missing decline, direct hidden approval and lost replay choices. I initially asserted that row (d) needed a different `gmh_` id; that assertion was wrong because the existing machinery supersedes the same handle. The corrected row was already GREEN on the first pass: [corrected baseline](first-pass-d-corrected.log). The final row checks the replaced digest/card words and direct refusal, retaining that existing machinery. Graph reload separately failed 2 rows before its fix (15 controls passed), and the decline-floor race was separately reproduced RED before the floor binding change.

Validation: **202 passing tests across 10 files**, run in batches of at most two files, with one worker, null stdin and the mandated load gate before every test process.

- Seam + graph reload: **79/79**, including all six served-draw semantic replays and the stored runner corpus ([log](targeted-GREEN.log)). The captured tool arguments remain reconstructed from cards/briefs; exact raw provider-argument replay is not claimed. [Original corpus provenance](../corpus-provenance.md).
- RC3 + offer unit regressions: **123/123**: widening **69**, incident/left-out **14**, counterfactual/real commit **9**, stamp ownership + offer unit **31**. [Run manifest](regressions.json).
- **12 non-trigger controls are byte-identical to the exact base source**, including both non-trigger served draws and the stored non-trigger runner. Compared replies, chips, card contents, operations, receipts and committed graph bytes: **196,624 bytes**, identical SHA256 `e88e2c6e02c27f1aff649b21f6e2e639773fe21dff4ca0903fb0bfc3b2aa5840`. Random revision/digest/issuance ids and timing telemetry are excluded from this content projection. [Comparison](control-bytes-comparison.json), [reproducible script](check-control-bytes.py). Every temporarily replaced source file was restored byte-for-byte.
- Source typecheck, lint of all hot production/test files, and `git diff --check`: PASS. [Typecheck](typecheck.log), [lint](lint.log).

All three mutants were caught and restored:

- Emit ordinary chip **and** `_proposal_fields` card beside the choices → row (a) RED, **1 failed**. [Log](mutant-ordinary-card-alongside.log), [restoration proof](mutant-ordinary-card.json), [script](check-ordinary-card-mutant.py).
- Disable timing trigger → P44 RED, **1 failed / 3 controls passed**. [Log](mutant-trigger-always-false.log).
- Offer baseline options → P44 count, both split-baseline screens and all-baseline control RED, **4 failed**. [Log](mutant-baseline-also-offered.log), [restoration proof](mutants.json), [script](check-detector-mutants.py).

FIX1 hot production files:

- `src/orchestrator-v5/agent-lane/chat-risk-precondition-choice.ts`: durable choice marker, bound decline, digest/current-option validation and identity re-offer helpers.
- `src/routes/agent-v1-turn.ts`: terminal decline handling, hidden-card projections, exact trigger reply/actions, cold replay and floor validation.
- `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts`: authoritative hidden-approval refusal and approved addendum wording.
- `src/routes/assist.v1.scenario-graph.ts`: cold conversation choice restoration and hidden proposal-field projection.
- `src/orchestrator-v5/persist-graph-write.ts`: supplies the already CAS-bound latest pending read to the existing reconciliation callback; other callers retain their behavior.

The first-pass timing detector and RC3 press work in `chat-risk-precondition.ts`, `widen-turn.ts` and `proposal-reply.ts` remain; only the latter's explanatory comment was clarified in FIX1. Test changes are in `agent-chat-precondition-door-seam.test.ts` and `x4-answer-offers-reload.test.ts`. All evidence is local; no served/deployed acceptance is claimed.

Note: the logs, the scripts (*.py) and the control-bytes base/final projections are kept in the lane evidence folder (offer-evidence/), not the repo. The relative links above point there.

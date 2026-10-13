# R1 — Implemented; ready for DL review (uncommitted)

Base: `staging` at `eb90646da5974959cc26f0d362419b126b5d6b88`. No commit, deployment or live-model claim.

## Change

- The existing typed Run dispatcher/K2 operation enters `runAgentTurn`, using its existing first-tool mechanism. The agent supplies `run_analysis` arguments and reads the result in the same turn. The host-only Run dispatch/receipt block is removed.
- The press permits one Run. The existing loop withholding fence removes proposal, construction and approval tools; the per-request Run capability refuses a second attempt, including calls returned together. Method and approval identities take precedence over a conflicting Run action type.
- N1: the Run capability receives only the agent call’s `reason` and `effects_timing`; request-body/chip timing is never merged. G2 receives the unchanged producer argument.
- Existing typed engine refusals retain their authoritative cause after the model call; invented model causes are rejected. Existing unknown-as-zero and threshold-reason disclosures still run after a completed explicit Run.
- Run replay retains saved words; current result/guided carriers are attached only when the remembered offered Run identity still matches. The existing committed-row reader has no Run-key field, so after process restart a loop replay does not invent that binding. Legacy ready-receipt replay behavior remains covered.
- An omitted Run produces `The analysis did not run. Press Run to try again.` and a usable, persisted Run offer. Fabricated model success is not delivered.
- Explain, Strengthen and method handlers stay in place. Successful Run retains Explain as an optional control and marks its same-turn narration ready. K1 licence, readiness, unknown-as-zero and structure checks are unchanged. No prompt or tool-description text changed.

## Test method and limits

Every command uses the installed `node_modules` and runs one spec at a time with `npx vitest run <file>`. The named route-importing specs and `tests/contract/*guard*` are enumerated in `recovery-notes/r1-tests/specs.json`. Baselines run against a source snapshot of the clean requested base; after runs use this checkout. JSON reporters and logs are retained beside that inventory. Test placeholders: `VITE_SUPABASE_URL=http://localhost:54321`, `VITE_SUPABASE_ANON_KEY=test-anon-key`.

The new hiring route test uses the real Fastify route, agent loop, tool dispatcher, capability, Run handler and G2 licence producer. Only the external model response and PLoT response are scripted. The immutable served hiring fixture is read, not edited. Assertions bind the tool result to scenario/hash/time and the licence’s goal, target and option IDs before checking the displayed percentages. This proves route wiring and scientific licensing, not live AI quality or a deployed user journey.

TypeScript: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --pretty false` passed. Its local generated OpenAPI types were produced from the checked-in schema using the installed `openapi-typescript`; no network or generated artifact is included in the diff. `git diff --check` passed.

The baseline census guard initially could not collect because the temporary baseline copy had no Git inventory. Rebuilt its tracked-src index without a commit and reran it successfully. Failed migration attempts and logs remain available; counts below are the latest completed run for each file.

## Focused acceptance and mutants

| Check | Pass | Fail |
|---|---:|---:|
| New R1 suite on base | 5 | 7 |
| New R1 suite after | 12 | 0 |
| Mutant 1: restore host-only Run | 6 | 6 |
| Mutant 2: trust client chip timing | 11 | 1 |

Observed mutant failures: restoring host-only dispatch makes the hiring `in_place_by_period` loop/licence row RED. Substituting client timing makes the N1 negative RED because a `GOAL_CHANCE_LICENSED` record appears despite the agent reading `later_or_partial`. Mutations are restored after execution and the source SHA-256 is checked.

## Files and fixture changes

- `src/orchestrator-v5/agent-lane/__tests__/agent-run-reply-answer-shape.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/agent-subturn-not-conversation.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/break-even-route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/chip-click-withholds-authority.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/claim-permissions-caveat-not-withhold.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/converse-reasoning-effort.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-carry.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-typed-turns.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/deadline-card-chain.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/decision-input-ask.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/decision-sensitivity-screen-gate.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/explain-guards-one-leader-spelling.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/explain-low-robustness-caveat.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/first-analysis-coaching-card.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/first-analysis-route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.explain.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/guided-sizing.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/interpret-deadline.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/interpreter-investigation-priority.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/kept-run-stale-after-a-change.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/never-reask-closed.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/next-step-chips.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/one-reply-build-contract.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/option-name-truth-route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/proposal-survives-a-restart.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/provider-ledger-prompt-identity.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/provisional-view-route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/rerun-carries-run-delta.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/rerun-explanation.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/result-first-licensed.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/result-first-replay.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/result-first-run.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-answer-completeness.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-fast-path.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-keeps-reasoning-item.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-keeps-the-approve-chip.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-offer-after-approval.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-outcome-follow-ups.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-reply-reason-is-the-engine-outcome.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/run-reply-unvalued-root.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/selected-coach-wiring.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/steady-horizon-card.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/target-not-testable-beside-ranges.route.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/unchecked-limit-no-remedy-clause-pinned.test.ts`
- `src/routes/__tests__/agent-v1-turn-canonical-view-wire.test.ts`
- `src/routes/__tests__/assist.v1.scenario-graph.held-offers.test.ts`
- `src/routes/__tests__/goal-reach-confirm-reading-route.test.ts`
- `src/routes/agent-v1-turn.ts`
- New: `src/orchestrator-v5/agent-lane/__tests__/run-press-loop.route.test.ts`.
- New: `src/orchestrator-v5/agent-lane/__tests__/fixtures/run-press-model.ts`.


- `run-fast-path.test.ts`: Run now has a model tool call plus a continuation; Explain is still a separate read-only request, counted separately. Blocked/failed Run fixture narration reads the actual tool output. Fresh session IDs avoid repeated `c1` tool identities leaking across cases. Failure/no-invented-cause, no extra Run, instruction hash and Explain authority assertions retained.
- `result-first-run.test.ts`: model fixture now calls the forced Run tool and interprets; pre-Run context read plus one post-Run read replaces the host-only single read. Separate Run provider ledger proves two model calls; Explain ledger still proves zero calls on refused controls and one on valid ones. Initial narration is ready; both stored replies contain their interpretation. Wrong-key, concurrent change, failed interpretation and no-write negatives retained.
- `result-first-licensed.route.test.ts`: fixture records the Run loop separately from Explain and uses its actual tool-call identity in history assertions. The next turn must still receive only the neutral historical marker, never raw unlicensed result prose.
- `agent-run-reply-answer-shape.test.ts`: scripted Run tool and initial interpretation precede the unchanged Explain tests. Run-only expectations now include model narration instead of a zero-call ready receipt. Legacy host replay negative explicitly seeds the old ready marker so it continues to test the old rebuild's rejection of an unproved shape; no recording changed.
- `agent-subturn-not-conversation.test.ts`: the Run button fixture makes an agent-owned Run call. Existing sub-turn conversation-contamination assertions retained.
- `break-even-route.test.ts`: explicit Run tool response added to the model fixture; diagnostic expects the loop. Arithmetic-presence and evaluated-product/no-Run absence controls remain unchanged.
- `chip-click-withholds-authority.test.ts`: Run positive explicitly scripts its tool call and expects the loop diagnostic; all method-chip authority negatives are unchanged.
- `claim-permissions-caveat-not-withhold.test.ts`, `converse-reasoning-effort.test.ts`: simulate the Run tool before testing the unchanged Explain prompt/budget; locate Explain by its `tool_choice: none` rather than assuming it is the first provider request.
- `current-level-ask-carry.route.test.ts`, `current-level-ask-typed-turns.route.test.ts`: the fixture answers the forced Run tool and expects the loop diagnostic. Current-level question carry/typed-answer controls remain intact.
- `deadline-card-chain.test.ts`: the Run route fixture now supplies a scripted local tool call and reply instead of throwing on every provider request. There is still no network access; the existing deadline-card chain assertions are unchanged.
- `decision-input-ask.test.ts`, `decision-sensitivity-screen-gate.route.test.ts`: scripted provider now answers the forced Run tool; existing source/basis disclosure, question-once, replay and sensitivity negatives are retained.
- The current-level expiry negative clears the fixture’s earlier question before Run: Run now has an actual model reply, so leaving the question scripted would issue a new ask rather than test carry expiry. Its `null` expiry assertion is retained.

- `explain-guards-one-leader-spelling.route.test.ts`: scripted Run tool before interpretation; isolate capture to the subsequent Explain/ordinary call, use a fresh Run session. All 127 guard assertions retained.
- `explain-low-robustness-caveat.route.test.ts`: scripted Run tool and neutral interpretation before Explain; the existing narrator knobs and count remain scoped to Explain, preserving its race and unavailable-narration negatives.
- `first-analysis-coaching-card.test.ts`, `first-analysis-route.test.ts`: explicit Run mock now calls the tool, and expects loop rather than host-fast-path diagnostic; automatic construction and approval negatives unchanged.

- `run-keeps-reasoning-item.test.ts`: scripted Run tool, loop diagnostic; the API reasoning/message pairing check still inspects the next turn history.
- `run-keeps-the-approve-chip.test.ts`: script the Run tool and interpretation separately from proposal creation; loop diagnostic replaces host diagnostic. All stale/replay approval negatives unchanged.

- `kept-run-stale-after-a-change.test.ts`, `proposal-survives-a-restart.test.ts`: explicit Run issues its tool call; assertions identify the loop path. Stale history, restart and proposal authority checks unchanged.
- `rerun-carries-run-delta.test.ts`: Run diagnostic now identifies the loop; existing mock already calls run_analysis and all delta binding checks remain.
- `run-offer-after-approval.test.ts`: typed offer issues one Run through two model calls, then independently captures Explain. Approval, stale and durable-offer negatives unchanged.

- `goal-chance-screen-lines.explain.route.test.ts`: Run setup calls the tool, with fresh sessions; exact chance line and stale Explain controls unchanged.
- `goal-chance-screen-lines.route.test.ts`: the stale selected-Run row now scripts a Run call and stale-result interpretation, preserving its Run face contract and no-what-changes negative.

- `guided-sizing.route.test.ts`: scripted Run tool and continuation precede guided sizing; Run continuation does not consume the fixture queue for later link proposals. All identity, no-write, stale, replay and exact guided-copy assertions retained.

- `selected-coach-wiring.test.ts`: script Run before its interpretation and the optional Explain; assert the unchanged selected model/prompt hash on both loop calls, then retain all Explain prompt/budget pins.

- `interpret-deadline.test.ts`: the setup Run now answers both loop calls; the separate Explain request still never resolves except through its deadline, with the same no-retry/time/fallback negatives.
- `interpreter-investigation-priority.route.test.ts`: setup Run calls the tool with a fresh session before the unchanged Explain narration, clause and limit assertions.

- `never-reask-closed.route.test.ts`: explicit Run mock now makes the Run tool call. All closed-question, wrong-history and replay negatives remain unchanged.

- `next-step-chips.test.ts`: typed Run fixture calls the tool; the current-result positive and stale-result no-next-steps negative still require exactly one Run.

- `one-reply-build-contract.route.test.ts`: explicit Run requests now script run_analysis and its existing narration instead of attempting construction; build fixtures still use construction. All risk disclosures and replay assertions retained.
- `option-name-truth-route.test.ts`: Run mock issues its tool call. Stale/unknown reads now make the two loop calls, with an explicit zero-Explain-call assertion and unchanged no-Explain-control negative; display-name and historical-wording checks retained.

- `provider-ledger-prompt-identity.test.ts`: assert two agent.converse ledger rows and exact sent prompt hashes for the Run, then independently capture Explain and keep its existing agent.interpret/hash assertions.

- `provisional-view-route.test.ts`: explicit Run setup makes its tool call and neutral continuation, leaving the queued typed view for Explain; assert two setup calls, then retain the one-Explain-call, strict-schema and forbidden-preference negatives unchanged.

- `rerun-explanation.route.test.ts`: setup Run has its tool call and neutral continuation; the existing model-call counter remains scoped to Explain. All unsupported movement, duplicate, typed-view and replay negatives retained.

- `run-answer-completeness.test.ts`: typed Run now tests its own loop response directly, just like chat Run; both require two calls, the actual bound tool result, and one Run even on incomplete narration. No incompleteness negative weakened.
- `run-keeps-reasoning-item.test.ts`: the next-turn pairing assertion now names message 2 (Explain); message 1 is the new Run interpretation and becomes the existing neutral historical marker. The fake API still rejects every unpaired retained message.
- `result-first-replay.route.test.ts`: setup Run calls its tool. Four old ready-receipt replay tests explicitly seed a legacy receipt row, retaining their exact cold/stale/rebuild negatives; current loop replay is covered by R1. No recorded fixture edited.

- `run-outcome-follow-ups.test.ts`, `run-reply-reason-is-the-engine-outcome.test.ts`: mock now calls Run first; expected model count is two. The deliberately false/invented model reasons remain unchanged, as do exact engine-refusal and no-spurious-remedy negatives. The route preserves the existing typed engine outcome after the loop.
- `run-reply-unvalued-root.route.test.ts`: scripted Run and provisional model interpretation replace the empty provider/host receipt; the exact interpretation replaces the receipt in detail assertions. All unknown-as-zero, label-injection, question-once and replay negatives remain.

- `steady-horizon-card.test.ts`: Run fixture calls its tool before the existing model script; joined approval, bare-yes refusal, stale proof and zero-implicit-Run assertions unchanged.

- `target-not-testable-beside-ranges.route.test.ts`: setup Run makes its tool call with a fresh session; scoped-range and no-unscoped-claim negatives remain unchanged on Explain input.

- `unchecked-limit-no-remedy-clause-pinned.test.ts`: mock Run tool added; assert the unchanged exact clause on both Run calls and Explain, keeping one Explain and the replaced-clause absence pins.

- `agent-v1-turn-canonical-view-wire.test.ts`: mock now calls Run; assert two model calls and two reads (context before Run, canonical result after), then inspect next-turn history independently. The old byte-parity row keeps every non-narration hash unchanged; the six deliberately changed narration/provider/agent metadata fields instead assert interpreted text, ready status, exactly one Run and two provider calls. Stored hash literals and all canonical-view leak/staleness negatives remain unchanged.

- `assist.v1.scenario-graph.held-offers.test.ts`: real-turn helper makes the Run tool call; exact held offers and read/no-read parity assertions unchanged.
- `goal-reach-confirm-reading-route.test.ts`: scripted local Run tool and interpretation replace the always-throw provider, and loop diagnostic replaces host diagnostic. The joined approval check still asserts zero added model calls, zero implicit Runs and the exact saved identity; all method/approval-only zero-call negatives remain.

- Follow-up canonical-view fixture changes: four total model inputs (two Run, two warm/cold Explain); the unavailable-port injection now fires after the final graph read, not the newly added pre-Run context read. All no-view and unchanged-canonical-state assertions retained.
- Follow-up goal-reach fixture: exact ready receipt replaced by the scripted Run interpretation in face assertions; threshold reason remains verbatim once in detail.
- Follow-up r13 risk disclosure fixture: the interpreted loop uses existing sentence deduplication. Assert all three named risk/option dependencies survive, and the identical shared chance-exclusion sentence appears once. Marker, full note, replay and no-fresh-build-receipt assertions unchanged.

## User-visible hiring words

These are exact route-fixture outputs, with the model response scripted from the actual tool licence; they are not live-provider observations.

### Before

```text
Not shown yet; why is under More detail

• Olumi's estimates: 14, see Check estimates.
• No figure is set for "Launch date missed" yet, so the analysis treats it as zero. How likely or how large is "Launch date missed" today?

Your results are ready. You can view them now or ask me to explain them.

This run doesn’t show a target chance for some options.
```

### After

```text
‘Hire a Tech lead’: about 24% chance of ‘productivity’ being at least 10% higher than today at three months, in this model, using Olumi's estimates for 4 starting values, 2 option settings and 7 relationships (see Check estimates). It rests most on Olumi’s own estimate of how strongly ‘Tech leads hired’ affects ‘Leadership guidance’: if that effect is weaker than Olumi assumed, the chance falls. Is that estimate right?

• ‘Hire two developers’: about 32% chance of ‘productivity’ being at least 10% higher than today at three months, in this model, using Olumi's estimates for 4 starting values, 1 option setting and 7 relationships (see Check estimates). It rests most on Olumi’s own estimate of how strongly ‘Developers hired’ affects ‘Delivery capacity’: if that effect is weaker than Olumi assumed, the chance falls.
• At today's numbers; not projected forward yet
• Not shown yet; why is under More detail
• No figure is set for "Launch date missed" yet, so the analysis treats it as zero. How likely or how large is "Launch date missed" today?

This assumes carrying on as now leaves ‘productivity’ unchanged through month three; each option is measured against that. Provisional: this calculation assumes the estimated effects are in place by month three. It does not model when they arrive. This chance covers ‘productivity’ only. It does not include: ‘Hiring spend’ at most £200,000; maintaining code quality; the urgent launch date. Provisional: this result uses inputs whose sources have not been verified.

No single option can be put forward yet, because a limit on your model was not shown to be met on this run, and running the analysis again as it stands will not change that; ask me what the limit needs before it can be checked.

Doing nothing: no change to ‘productivity’ in this model, by assumption.

What would change it: for ‘Hire a Tech lead’, how strongly ‘Tech leads hired’ affects ‘Leadership guidance’; for ‘Hire two developers’, how strongly ‘Developers hired’ affects ‘Delivery capacity’.

Olumi's estimates: 14, see Check estimates.

These chances use the model's numbers as they are today; the model doesn't project how they change over time yet.
```

Product test: the same Run turn now exposes the model-relative productivity chances with their timing assumption, excluded conditions and consequential assumptions to challenge. It does not choose a hire or authorise action. Existing host disclosure/composition remains visible; its broader subtraction is outside R1.

## Per-file regression counts

| Spec | Before pass/fail/skip | After pass/fail/skip |
|---|---:|---:|
| `src/orchestrator-v5/__tests__/agent-midturn-ownership-wire.test.ts` | 17/0/0 | 17/0/0 |
| `src/orchestrator-v5/__tests__/door-refusal-propagation.test.ts` | 15/0/0 | 15/0/0 |
| `src/orchestrator-v5/admission/__tests__/target-testability.test.ts` | 43/0/0 | 43/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/a6-guidance-variant-slot.test.ts` | 13/0/0 | 13/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/a7-said-last-turn.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-add-factor-door-seam.test.ts` | 45/0/0 | 45/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-add-option-held-seam.test.ts` | 86/0/0 | 86/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts` | 26/0/0 | 26/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts` | 22/0/0 | 22/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-knows-board-edits.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-never-shows-instructions-or-codes.test.ts` | 26/0/0 | 26/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-option-participation-context.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-proposal-user-in-control-seam.test.ts` | 52/0/0 | 52/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-remembers-the-conversation.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-revises-a-link.test.ts` | 22/0/0 | 22/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-run-delta-disclosure.route.test.ts` | 1/0/0 | 1/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-run-reply-answer-shape.test.ts` | 30/0/0 | 30/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sees-one-readiness.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-selection-context.test.ts` | 17/0/0 | 17/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sets-the-goal-target-real-writer.test.ts` | 21/0/0 | 21/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-sets-the-goal-target.test.ts` | 69/0/0 | 69/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-subturn-not-conversation.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-target-edit-says-target.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-authoritative-state.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-goal-certainty.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-limit-verdicts.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-not-modelled.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-option-participation.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-carries-run-provenance.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-claim-wait.test.ts` | 1/0/0 | 1/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-is-openai-only.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay-real-store.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay-real-store.v6.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay.claim-release-regression.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-replay.test.ts` | 9/0/0 | 9/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-states-its-run-freshness.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-turn-withheld-leader-fail-closed.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/agent-writer-doors-seam.test.ts` | 21/0/0 | 21/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/approval-chips.test.ts` | 13/0/0 | 13/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/approval-fast-path.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/b3-scope-one-ask.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/board-edit-first-still-seeds.test.ts` | 1/0/0 | 1/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/break-even-route.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/brief-read-frame.test.ts` | 23/0/0 | 23/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/ceiling-stock-chain.test.ts` | 148/0/0 | 148/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/chat-truth-chip-and-save-line.test.ts` | 21/0/0 | 21/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/chip-approval-prunes-its-proposal.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/chip-click-withholds-authority.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/claim-permissions-caveat-not-withhold.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/compose-reply-restatement.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/construction-output-cap.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/contextual-next-step-pills.test.ts` | 14/0/0 | 14/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/converse-reasoning-effort.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-answer.route.test.ts` | 30/0/0 | 30/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-carry.route.test.ts` | 23/0/0 | 23/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/current-level-ask-typed-turns.route.test.ts` | 13/0/0 | 13/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/deadline-card-chain.test.ts` | 68/0/0 | 68/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-input-ask.test.ts` | 67/0/0 | 67/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-review-press.route.test.ts` | 13/0/0 | 13/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/decision-sensitivity-screen-gate.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/display-ids.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/drafter-raw-record.route.test.ts` | 14/0/0 | 14/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/drawn-link-press.route.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/e6-said-once-paul-replay.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/empty-model-state-given.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/event-risk-build-reply.route.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/explain-guards-one-leader-spelling.route.test.ts` | 127/0/0 | 127/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/explain-low-robustness-caveat.route.test.ts` | 42/0/0 | 42/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/factor-review-served.test.ts` | 20/0/0 | 20/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/fallback-held-card.test.ts` | 15/0/0 | 15/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/fast-approve-carries-follow-up.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-analysis-coaching-card.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-analysis-route.test.ts` | 44/0/0 | 44/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/first-graph-read-overlaps-claim.test.ts` | 1/0/0 | 1/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/forward-direct-manipulation.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/fresh-goal-scope-leader-egress.route.test.ts` | 65/0/0 | 65/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-driver-egress.pv-route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-driver-egress.route.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-ranking-instruction.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.explain.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.route.test.ts` | 44/0/0 | 44/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/goal-horizon-verdict.route.test.ts` | 18/0/0 | 18/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/graph-ready-frame.test.ts` | 10/0/0 | 10/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/guided-sizing.route.test.ts` | 31/0/0 | 31/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/held-proposal-user-in-control-seam.test.ts` | 25/0/0 | 25/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/held-status-quo-gets-no-levels.test.ts` | 48/0/0 | 48/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/history-sent-text.route.test.ts` | 14/0/0 | 14/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/hop-limit-route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/hop-limit-text.test.ts` | 9/0/0 | 9/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/identity-card-reoffer.test.ts` | 10/0/0 | 10/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/identity-part-figures.route.test.ts` | 13/0/0 | 13/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/index-goal-weights-note.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/instructions-breakpoint-refusal.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/interpret-deadline.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/interpreter-investigation-priority.route.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/kept-run-stale-after-a-change.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/leader-final-egress-replay.route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/left-out-option-egress-carriers.route.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-effect-card-route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-sentence-first-call.route.test.ts` | 56/0/0 | 56/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/link-size-ask.test.ts` | 20/0/0 | 20/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/living-model-assumption-challenge.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/marketing-l20-derivation.route.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/method-turn-route-seam.test.ts` | 17/0/0 | 17/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/model-relative-naming-instruction.test.ts` | 12/0/0 | 12/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/never-reask-closed.route.test.ts` | 34/0/0 | 34/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/next-step-chips.test.ts` | 16/0/0 | 16/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/no-direct-link-figure.route.test.ts` | 33/0/0 | 33/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/no-leader-sentence-reads-limit-rows.route.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/one-reply-build-contract.route.test.ts` | 39/0/0 | 39/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/option-name-truth-route.test.ts` | 14/0/0 | 14/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/premortem-worksheet-route.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/proposal-survives-a-restart.test.ts` | 43/0/0 | 43/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/provider-ledger-prompt-identity.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/provider-ledger-request-identity.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/provisional-view-route.test.ts` | 21/0/0 | 21/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/public-research-route.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/r3-give-your-estimate-asks-that-estimate.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/rc3-precondition-incident-edge-seam.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/rebuild-after-too-large.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/receipt-asks-for-a-needed-level.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/reply-length-instruction.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/rerun-carries-run-delta.test.ts` | 10/0/0 | 10/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/rerun-explanation.route.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/research-control-survives.test.ts` | 47/0/0 | 47/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-licensed.route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-replay.route.test.ts` | 9/0/0 | 9/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/result-first-run.test.ts` | 24/0/0 | 24/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-answer-completeness.test.ts` | 7/0/0 | 7/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-fast-path.test.ts` | 17/0/0 | 17/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-keeps-reasoning-item.test.ts` | 1/0/0 | 1/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-keeps-the-approve-chip.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-offer-after-approval.test.ts` | 28/0/0 | 28/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-outcome-follow-ups.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-reply-reason-is-the-engine-outcome.test.ts` | 5/0/0 | 5/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run-reply-unvalued-root.route.test.ts` | 31/0/0 | 31/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/run4-deadline-plain-approval.route.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/s4-horizon-consumers.route.test.ts` | 19/0/0 | 19/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/s5t-receipt-route.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/same-run-goal-chance-and-sensitivity.test.ts` | 20/0/0 | 20/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/selected-coach-wiring.test.ts` | 6/0/0 | 6/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/semantic-spine-real-route.test.ts` | 19/0/0 | 19/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/starting-point-omission-disclosed.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/steady-horizon-card.test.ts` | 21/0/0 | 21/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/strengthen-press.test.ts` | 27/0/0 | 27/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/structural-challenge-route-reachability.test.ts` | 24/0/0 | 24/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/structural-challenge-route.test.ts` | 11/0/0 | 11/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/suggest-starting-assumptions.test.ts` | 25/0/0 | 25/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/t2-guidance-wire.test.ts` | 22/0/0 | 22/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/target-not-testable-beside-ranges.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/tipping-point-coaching.route.test.ts` | 8/0/0 | 8/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/typed-approval-offers-the-run.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/unchecked-limit-no-remedy-clause-pinned.test.ts` | 2/0/0 | 2/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/unfinished-answer-text.test.ts` | 3/0/0 | 3/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/what-changes-route.test.ts` | 114/0/0 | 114/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-draft.test.ts` | 82/0/0 | 82/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-risks-seam.test.ts` | 42/0/0 | 42/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/widen-turn-seam.test.ts` | 9/0/0 | 9/0/0 |
| `src/orchestrator-v5/agent-lane/__tests__/write-outcome.test.ts` | 45/0/0 | 45/0/0 |
| `src/orchestrator-v5/agent-lane/method-turn/__tests__/method-turn.test.ts` | 40/0/0 | 40/0/0 |
| `src/orchestrator-v5/coaching/__tests__/fragile-link-challenge.test.ts` | 31/0/0 | 31/0/0 |
| `src/orchestrator-v5/coaching/__tests__/no-flagged-link-card.test.ts` | 12/0/0 | 12/0/0 |
| `src/orchestrator-v5/goal-target/__tests__/batch-g-hiring-conditional.test.ts` | 24/0/0 | 24/0/0 |
| `src/orchestrator-v5/goal-target/__tests__/ebd-paul-hiring-replay.route.test.ts` | 4/0/0 | 4/0/0 |
| `src/orchestrator-v5/system-events/__tests__/canonical-reread-deadline.test.ts` | 72/0/0 | 72/0/0 |
| `src/routes/__tests__/agent-lane-readiness-carries-admission.test.ts` | 4/0/0 | 4/0/0 |
| `src/routes/__tests__/agent-readback-carries-leader-limit-risks.test.ts` | 3/0/0 | 3/0/0 |
| `src/routes/__tests__/agent-v1-turn-canonical-view-wire.test.ts` | 27/0/0 | 27/0/0 |
| `src/routes/__tests__/assist.v1.scenario-graph.held-offers.test.ts` | 57/0/0 | 57/0/0 |
| `src/routes/__tests__/goal-reach-confirm-reading-route.test.ts` | 10/0/0 | 10/0/0 |
| `src/routes/__tests__/s-b-action-bar-route.test.ts` | 31/0/0 | 31/0/0 |
| `src/routes/__tests__/s1-d-live-cold-readiness-parity.test.ts` | 7/0/0 | 7/0/0 |
| `src/routes/__tests__/scenario-analysis-constraint-verdict-state.test.ts` | 9/0/0 | 9/0/0 |
| `src/routes/__tests__/scenario-analysis-one-serialisation.test.ts` | 13/0/0 | 13/0/0 |
| `src/routes/__tests__/stored-goal-chance-horizon-read.test.ts` | 10/0/0 | 10/0/0 |
| `src/routes/__tests__/x4-answer-offers-reload.test.ts` | 16/0/0 | 16/0/0 |
| `tests/contract/coaching-chip-intent-completeness.guard.test.ts` | 11/0/0 | 11/0/0 |
| `tests/contract/context-summary-diagnostic-only.guard.test.ts` | 6/0/0 | 6/0/0 |
| `tests/contract/goal-record-census.guard.test.ts` | 5/0/0 | 5/0/0 |
| `tests/contract/horizon-basis-outbound.guard.test.ts` | 5/0/0 | 5/0/0 |
| `tests/contract/reduced-samples-disclosure-single-site.guard.test.ts` | 3/0/0 | 3/0/0 |
| `tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts` | 5/0/0 | 5/0/0 |
| `tests/contract/run-delta-pack-parity.guard.test.ts` | 5/0/0 | 5/0/0 |
| `tests/contract/run-delta-prior-facts-no-default.guard.test.ts` | 10/0/0 | 10/0/0 |
| `tests/contract/tier3-leak-guard.runtime.test.ts` | 16/0/0 | 16/0/0 |
| `tests/contract/tier3-leak-guard.static.guard.test.ts` | 3/0/0 | 3/0/0 |
| `tests/contract/untestable-goal-disclosure-single-site.guard.test.ts` | 9/0/0 | 9/0/0 |
| `tests/unit/sys1-turn-authority.test.ts` | 79/0/0 | 79/0/0 |

Completed baseline files: 188/188. Completed after files: 188/188.
Baseline totals: 3385 passed, 0 failed, 0 skipped.
After totals: 3385 passed, 0 failed, 0 skipped.

All 48 modified existing spec files were re-run once more after the final shared-route corrections; each passed. No negative was removed or disabled, and no replay recording was edited.

Assumptions: the existing typed chip/operation is the authorised Run action; no authority is inferred from its label or message. The engine still runs the current canonical snapshot through the existing Run path. DL owns commit/review and any serving acceptance.

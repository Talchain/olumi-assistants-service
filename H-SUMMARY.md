# HARNESS items 2 and 3

SOURCE only. Base: `692fb96e91bcdc3082b28ba4be2b6e15ec28de45`, branch `harness/receipt-and-provisional`.
Read `CODEX-BRIEF.md`, HARNESS items 2/3 in `ADDENDUM.md`, and `ACCEPTANCE-EVIDENCE.md`.
No Vitest, build, typecheck, commit, database change or deployment was performed. `git diff --check` passed.
The required `gh api` staging-head read failed with `error connecting to api.github.com`; local HEAD matches the brief's base. The DL must refresh the remote head and test before landing.

## Item 2: producers and change

- `src/orchestrator-v5/tools/handlers/run-input-snapshot.ts`: producer of the persisted Run input. Previously excluded the goal's observed state, so the receipt could not name today's recorded level. It now records that authored quantity using the existing value carrier (`factors`, identified by the Run's own goal node id). No contract extension or new store.
- `src/orchestrator-v5/coaching/run-input-changes.ts`: producer of `input_changes`. Previously included the metric unit in target equality, manufacturing a target row for an unchanged `0.1` target when the unit was adopted. Target rows now depend on authored threshold/frame changes; unit changes have their own row. Relative target ends render as `+10% from today`, without the metric unit. The goal's current-level value gets a `goal/value` row.
- `src/orchestrator-v5/coaching/build-run-delta.ts`: inspected, unchanged. `pairInputs` reads the two persisted snapshots and delegates to the diff above; the existing wire-contract validation remains in place.
- `src/orchestrator-v5/agent-lane/rerun-explanation.ts`: producer of the exact `You changed …` sentences, handed to the Run interpreter and typed follow-up through `rerunExplanationPlan` / `rerunRecordForModel`. A current-level row now says `Today's level of ‘productivity’ was recorded: 16 small-update equivalents per sprint.` Its unit row is folded into that sentence. A unit-only adoption says what the metric is measured in. A true target change explicitly names the target.

Threshold comparison retains the existing honesty boundary: the encoded `goal_threshold` remains in the whole-request residual, so a threshold difference with no authored raw change is unexpressed/partial, rather than invented as a user target change. Frame changes remain partial too. Unit adoption cannot create a target row. No current graph or transcript reconstructs either Run.

The requested `rg` census found the generic non-link sentence in `rerun-explanation.ts` and the separate link templates there. The guidance catalogue and generated `guidance/policy.ts` also describe generic `You changed …` templates; those are unchanged. `handlers/describe-changeset.ts` describes proposed operations, not this Run pair; it is unchanged. The exact literal `Since the last run, inputs changed, including Goal target` is absent from CEE `src`; the false target row feeding that downstream wording is removed here. Other `Goal target` hits are drafter instructions, extraction diagnostics or comments, not producers of the reported Run receipt.

## Item 3: producers and change

- `src/orchestrator-v5/agent-lane/provisional-view.ts`: the shared rule now asks WHAT to test/find out, never WHICH option to do/explore first. Both the Run interpreter instruction and its strict JSON schema carry that rule. `checkProvisionalView` refuses option-first/preference forms in all three fields, shared by tool validation, `readRunInterpretation` and accepted-result re-check. `sanitiseProvisionalView` also checks graph-labelled ranking/advice after id-to-label replacement; rejected views are withheld, not rewritten into invented advice.
- `src/orchestrator-v5/agent-lane/runtime/agent-tools.ts`: the `give_provisional_view` tool description and parameter descriptions now use the same rule.
- `src/orchestrator-v5/agent-lane/coach-route-v0_2.ts`: the host instruction's explicit invitation to say “what you would do” is replaced with model-relative testing wording.
- `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts`: the existing invalid-view refusal tells the model to correct it into what to test/find out.
- `src/routes/agent-v1-turn.ts`: inspected, unchanged. Its existing final sanitisation/check feeds the typed `_agent.provisional_view` sidecar after the prose leader gate. Thus tool and Run-button views reach the same egress check. No change to the ordinary analysis leader gate, heading, sidecar fields or withholding eligibility.

## Regression rows for the DL

Expected RED at base, not executed here:

| File / row | Why RED at base |
| --- | --- |
| `coaching/__tests__/change-goal-run-receipt.test.ts`: founder before/after adoption | Snapshot drops the current level; diff emits a false target row plus a generic unit-change sentence. |
| Same: real relative target `0.1 → 0.2` | Base prints fractions with the metric unit, rather than `+10% from today → +20% from today`. The control also requires the real target change to remain visible. |
| Same: change_abs current level `16 → 18`, target unchanged | Base omits both goal levels from its snapshots and has no level receipt. |
| Same: unit-only adoption | Base creates a target change too. |
| Same: frame change at the same raw threshold | Base marks coverage partial but supplies no distinguishable target row. |
| `agent-lane/__tests__/provisional-view.test.ts`: each option-first phrase in view/reasoning/confirm_step | Base only checks size/sentence limits; tool, Run JSON and accepted-result re-check all accept the preference. Includes straight and curly apostrophes. |
| Same: option-labelled exploration without “first” | Base egress only scrubs ids/codes and accepts the option preference. |
| Same: producer instructions/schema rule | Base expressly asks “what you would do”, with unconstrained string descriptions. |
| `agent-lane/__tests__/provisional-view-route.test.ts`: three option-first Run-button egress rows | Base exposes each rejected preference as the typed view. |

Must-pass controls include the exact model-relative form `Before comparing, it's worth testing how much ‘churn’ moves the goal.`, unchanged level/target producing no rows, a real level-frame target change, and an encoded-only threshold difference staying partial without an invented target receipt.

The goal-node regression fields follow the founder adoption in `agent-lane/__tests__/change-goal-adopts-level-unit.test.ts` at the stated base and the brief's wire description. The surrounding Run envelopes are synthetic; these are not new live acceptance captures.

Existing affected rows updated, without weakening their unrelated checks:

- `coaching/__tests__/sc24-run-input-delta.test.ts`: unit-only goal edit expects its unit row, not a duplicated target row.
- `agent-lane/__tests__/provisional-view.test.ts` and `provisional-view-route.test.ts`: valid view fixtures now test factors; the original ranking prose remains a separate gate control.
- `agent-lane/__tests__/rerun-explanation.route.test.ts`: its valid-view control now tests capacity; the movement-claim failure stays intact.
- `agent-lane/__tests__/unchecked-limit-no-remedy-clause-pinned.test.ts`: the pinned host clause matches the corrected producer instruction.

All paths above are relative to `src/orchestrator-v5/`. The root `H-SUMMARY.md` is the only additional handover file.
DL validation should run the named receipt/provisional suites, the existing `sc24-run-input-delta`, `run-input-snapshot`, `run-input-residual`, rerun-explanation and pinned-clause suites, plus the project's required checks. No TESTED/REVIEWED/MERGED/SERVED claim is made.

# B2 Keep zero-spread reason — DL 58e392, a2 B2 chain

## Scope and identity

Worktree `/private/tmp/accel-er-b2scope-cee`; branch `dl/b2-zero-spread-when-none-licensed`.
Asserted starting HEAD: `f8ed674dec63758a2945acaffebe67e26a5f0a4a`; initial working tree clean.
Only working-tree edits are authorised. No commit/push and no changes under `supabase/`.

## Reader census — completed before production edits

Staging line references below. Executable search covered TypeScript/JavaScript outside dependencies, generated output and `supabase/`.

| Reader | Assumes one or more licensed options? | Empty-set behaviour / necessary guard |
| --- | --- | --- |
| `goalChanceLicenceOf`, goal-chance-licence.ts:209/267/311 | Yes | Retain only when a zero-spread reason exists; empty message avoids “Each option’s … is licensed”. Form stays `each`, no leader/similar fields. |
| `sentGoalThresholdOf`, licence.ts:342/355 | Implicitly, via vacuous `every` | Reject empty pct map before threshold agreement. |
| `withGoalChanceLicence`, licence.ts:565 | No | Appends the producer record without claiming a figure. |
| `nearestFiveGoalChancesForAgent`, licence.ts:582 | No | Requires valid rounding + pct entries; empty map yields nothing. |
| `goalChanceDisplayForAgent` / `goalChanceDisplayFromLicence`, licence.ts:610/616 | No | Excludes missing pct and withheld IDs; no displays yields undefined. |
| `goalChanceDriverAvailabilityForAgent`, licence.ts:640 | No | No displayed points yields undefined. |
| `agentLicenceRecordOf`, licence.ts:676 | No | Returns only a single validated record; no claim itself. |
| `goalChanceLicenceForAgent`, licence.ts:688 | No | Accepts `each` + all withheld; rejects incompatible leader/similar fields. Add validated stored zero-spread reasons for the canonical reader. |
| `runHasGoalChanceLicenceRecord`, range-agent.ts:30 | No | Era classifier; prevents legacy probability fallback. |
| `goalChanceNeedsGraphLabels`, range-agent.ts:105 | No | Requires ranges or actual drivers. |
| `goalChanceWithheldReasonsForAgent`, range-agent.ts:129 | No | Per-option withhold reader; add stored named zero-spread reason rather than reason_not_recorded. |
| Point/driver readers, range-agent.ts:151/159/173 | No | Actual-display gates yield no point/driver sentence for empty pct. |
| `goalChanceFactsForAgent`, range-agent.ts:225/239/248 | No | Exposes licence/display only with `hasChance`; empty set is no claim. |
| Screen composer, `goalChanceScreenLinesForAgent`, `goalChanceCellFacesForAgent`, screen-lines.ts:58/126/134 | No | Points require actual display and per-ID figure. Ranges keep their independent licence. |
| Canonical builder, canonical-analysis-view.ts:105/116/165/169 | No point-claim assumption | Previously ignored withheld_reason_by_option. Read the producer reason and put its line before generic withheld face. |
| guided-sizing.ts:182 | No | Reads scored goal identity only. |
| goal-chance-sides.ts:14 | No | Empty pct yields range/withheld, never point. |
| goal-chance-estimate-egress.ts:20/38 | No | Requires actual screen lines; no points means no licensed point claim. |
| `analysisResultForAgent`, decision-sensitivity.ts:174/321 | No | Display gates probability; warning pass-through requires producer message silence. |
| Saved Agent context, runtime/agent-capabilities.ts:1685 | No | Actual-display gates saved probabilities; no legacy fallback with record present. |
| Agent ranking instruction, agent-v1-turn.ts:717 | No | Highest/similar require those forms; `each` forbids ranking. No raw point is supplied when empty. |
| Agent replay/live/Explain, agent-v1-turn.ts:2314/4582 | No | Shared screen reader. |
| coach-route-v0_2.ts:60 | No | Leader needs independent permission; goal-chance driver availability requires displayed points. |
| scope-target-not-testable.ts:15 | No | Actual display/range maps. |
| structural-challenge-compare.ts:495 | No | Actual display maps. |
| scripts/gp-goal-census.ts:339/343/381-385 | No | Replay identification; shown requires nonempty pct. |
| tools/limit-check-replay/replay.ts:39/134 | Fixture-specific | Specified point-licence snapshot; no generic presence claim. |

Chosen shape **(i)**: an `each` licence with `pct_by_option: {}`, all withheld IDs, and zero-spread reasons. This uses the same producer, stored warning carrier and existing canonical withheld-cell contract. A second Run carrier would duplicate the transport path without improving claim safety. The empty licence carries no licensed-claim message or leader/similar form.

## Binding Science 93 ruling

Science 93 @ `5e0fafa7e467ed211ced875828677cf54e1d201d`:

> “(a), keep the §(o′) line "Not shown yet: needs month-by-month changes", as built. (b) is rejected: "constant at every month" is a property of the static model, not the business. It would be a today's-numbers finding on a time-bound goal, which Paul rejected in §(o′). The DL brief's "if today's rates hold" is the CARRIER form only. Allowed in detail, as a fact: "Today it's £120,000 a month; your target is £126,000 a month by month 9." Your licence.ts:267 fix is agreed. Row: all-withheld Run + zero-spread option → the line is still shown.”

The optional detail fact is out of scope and is not added. The selector remains on §(o′).

## Implementation

- `goal-chance-licence.ts` retains the record when no points are licensed **only if** the same producer found a zero-spread reason. A no-zero-spread/all-withheld Run still returns `null`. The empty-set message is `''`, and there are no percentages, leader/similar fields, drivers, estimate-link count or inferred scoring threshold.
- `sentGoalThresholdOf` rejects empty percentage maps, preventing vacuous agreement from licensing an inferred threshold. Explicit spread metadata is also silent for an empty licensed set.
- `goalChanceLicenceForAgent` projects a stored zero-spread reason only for a withheld roster member without a conflicting percentage, with the typed reason/side and a nonempty single-line stored line. It never reconstructs the finding from public numeric rows.
- The existing per-option withhold reader carries `{ code: 'zero_spread', message: line }`. The canonical withheld cell puts that same stored line before generic withheld copy. Other point/range and withhold gates stay in place.
- `zeroSpreadNoCarrierHorizonLine()` in `zero-spread-horizon-line.ts` owns the **no carrier + stated horizon** choice. Its one return line stays on §(o′). The carrier/rates and no-horizon/figures templates retain their exact staging words. The original constant remains exported from `goal-chance-licence.ts` for compatibility.

## Fixtures and staging control

The lane's own witness bytes were copied under `src/routes/__tests__/fixtures/b2-zero-spread/`:

| Fixture | Origin | SHA-256 |
| --- | --- | --- |
| `run.json` | `/Users/paulslee/olumi-work/accept-f/a2-b2w-d2/run.json` | `efc9c5380431027aec9d7d902bc91d1a496af2c74258b8846d9ac4339ed2e2e5` |
| `read-graph-1791489457020.json` | Newest `wire/read-graph-*.json` in that lane | `b2a372adca05d3eb0baa91c9eb6b76a7cfa04cd7ce42328d8de8e80bfb5c47e4` |

The public Run already has Keep's unearned exact zero stripped. The test restores **only** `Keep.probability_of_goal = 0`, the producer input observed by the lane and given in the build brief, and then runs the real producer and transport. This is a fixture replay of the supplied witness, not a new engine draw.

`starter-point-staging.json` captures the staging source output **before production edits**. It additionally gives Starter `p = 0.97`, retains the original warnings, and records producer/transport/canonical/Agent/screen-line outputs. The capture ran after a successful load gate (4.32666015625 < 25). Starter's existing range remains independently licensed and dominates its canonical cell. Producer and transport must stay byte-identical; only Keep's formerly stranded canonical reason/face gains the stored line.

## Validation

`run-checks.py` checks the **exit code** of a fresh Node `os.loadavg()[0] < 25` gate before every test process. It asserts one or two test files, uses `--maxWorkers=1 --no-file-parallelism --configLoader=runner`, and closes stdin with `/dev/null`. Runs are sequential. Each log and `checks.jsonl` records the gate and test exit codes. Static checks use fresh load gates as well.

| Required row | Result | Evidence |
| --- | --- | --- |
| d2 all-withheld + Keep zero spread | GREEN: `{ kind: 'withheld', reasons: [{ code: 'zero_spread', message: 'Not shown yet: needs month-by-month changes' }], face: 'Not shown yet: needs month-by-month changes' }` | `green-b2-fixture-final.log` |
| No licensed claims on that Run | GREEN: empty `message`/pct, no leader/similar/summary, no point display/driver, no exact probability in public or Agent rows | Same fixture row plus reader census and Agent suites |
| Starter-point control | GREEN: licence, full producer enrichment, transport enrichment, Agent facts and screen lines are byte-identical to captured staging. Only Keep's canonical reason/face changes; every other canonical option and view field is byte-identical | `green-b2-fixture-final.log`, `starter-point-staging.json` |
| No zero-spread option + none licensed | GREEN: `null`; withGoalChanceLicence returns original envelope; Keep remains `none` | `green-b2-fixture-final.log` |
| Selector flip | GREEN: temporary selector substitution changes only Keep's stored line and its canonical message/face copies. Selector restored; production stays on §(o′) | `green-b2-fixture-final.log` |
| Restore old early `return null` | **RED as required**: the d2 row receives null, exit 1, successful load gate | `mutant-old-return.log` |
| Restore final source after mutant | GREEN: same d2 row passes, exit 0. Finally block restored source bytes | `green-b2-restored.log`, `mutant-restoration.json` |

Final green suites: **224 distinct tests across 9 files**, with an additional successful rerun of the d2 row after restoring the mutant:

| Batch | Files | Passed tests | Gate/test exit |
| --- | --- | ---: | --- |
| `green-licence-certainty` | goal-chance-licence.test.ts + zero-spread-certainty.test.ts | 17 | 0 / 0 |
| `green-canonical` | canonical-analysis-view.test.ts + canonical-analysis-view-face.test.ts | 24 | 0 / 0 |
| `green-agent-screen` | agent-goal-chance-licence.test.ts + goal-chance-screen-lines.test.ts | 90 | 0 / 0 |
| `green-sides-egress` | goal-chance-sides.test.ts + goal-chance-estimate-egress.test.ts | 78 | 0 / 0 |
| `green-b2-fixture-final` | b2-zero-spread.test.ts | 15 | 0 / 0 |
| `green-b2-restored` | b2-zero-spread.test.ts, selected d2 row | 1 (14 skipped) | 0 / 0 |

The first fixture attempt had 14 passing rows and one faulty provenance assertion (`run._provider_calls[0].cee_build`, absent in the captured Run). It was corrected to assert the captured wire build and the staging snapshot's full source HEAD; the final fixture suite passes all 15. The original failed log is retained as `green-b2-fixture.log` with its exit code, without treating it as a product RED.

| Static check | Result | Evidence |
| --- | --- | --- |
| Full `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit < /dev/null` | Exit **2**; **290 diagnostics**, **0 in all five changed TypeScript files**. Full-repository typechecking is not globally clean; no global pass is claimed. | `tsc-full.log`, `static-checks.json` |
| ESLint on all five changed TypeScript files | Exit **0**, no output | `eslint-changed.log`, `static-checks.json` |
| `git diff --check` | Exit **0** | Final scope check |

The five checked files are `goal-chance-licence.ts`, `goal-chance-range-agent.ts`, `zero-spread-horizon-line.ts`, `canonical-analysis-view.ts` and the new `b2-zero-spread.test.ts`. Both static processes had fresh successful load gates (5.30810546875 and 13.14794921875 respectively, threshold 25), with stdin closed. Diagnostics outside changed files are preserved verbatim; this run does not establish their baseline age.

## Final scope check

Final HEAD remains `f8ed674dec63758a2945acaffebe67e26a5f0a4a`, branch `dl/b2-zero-spread-when-none-licensed`. The early-return mutant is removed and the original final source hash still matches `mutant-restoration.json`.

Changes comprise four production TypeScript files, one regression test, four fixture/provenance files and this evidence directory. No files under `supabase/` changed. No commit, push or deployment was performed.

## Evidence boundary

This validates the working-tree producer, transport, canonical projection and Agent readers against the lane's stored d2 witness. No fresh engine draw, deployment or post-fix live UI acceptance is claimed. The saved Agent door is included in the reader census and existing Agent suite; the new d2 row exercises the actual run-door projection.

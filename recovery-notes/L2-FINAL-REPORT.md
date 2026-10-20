DONE

- Progress: L2 S5/S10 declared baseline pair and S1 failed-turn recovery, locally witnessed through the real route.
- Next priorities: DL integration and fresh HIGH review; then the missing served correction/save/Run/Undo/reopen witness (highest-value: Y).
- Mistakes: the first readback-mutant fixture preserved an in-memory alias across a fake wire.
- Corrections applied: registration now crosses JSON bytes; the readback mutant is killed, with the initial survivor log retained.

This handback supersedes the earlier lease-blocked `L2-REPORT.md`, which remains as historical evidence. Base: `wip/l2-goallevel-saveoutcome` at `f4022fb82680a428d87117a439044aa9e75adad2`. No commit, push, deployment or live provider call. DGAI copy remains with the later lane.

Files changed (plus L2 approach, verification and mutation evidence in `recovery-notes/`):

| File | Added / removed |
| --- | --- |
| `src/orchestrator-v5/agent-lane/__tests__/ai-core-provider-capacity.route.test.ts` | +24 / −0 |
| `src/orchestrator-v5/agent-lane/runtime/transport-retry.ts` | +16 / −13 |
| `src/orchestrator-v5/path-b/tools/__tests__/change-tools.goal-level.test.ts` | +44 / −2 |
| `src/orchestrator-v5/path-b/tools/__tests__/goal-level-card.route.test.ts` | +150 / −5 |
| `src/orchestrator-v5/path-b/tools/change-tools.ts` | +33 / −6 |
| `src/routes/agent-v1-turn.ts` | +45 / −11 |

`change-tools.ts` changes only the original goal-level functions and the explicitly extended proposeChange dispatch hunk. L1's original :170–215 and :700–760 are untouched. Other source files are the existing capacity/error and failed-turn lease. No lease extension was inferred.

The AI declares the current-level quantity through the goal/value pair. The host checks sum membership by ID and equality of the two declarations, never coincident labels or figures. Exactly that pair becomes one content-hashed card. The existing goal writer supplies its complete postimage; the declared operand is included before that writer's one CAS registration. Its own receipt and full equality of both observed states are required before new-save success. The person's statement is recorded once on the goal. The readback also reports the operand's stored state. Unsupported mixtures remain refused, including non-sums, non-members, different values, units, sources or stances, and extra members. Existing consent, digest, identity, stale-card, idempotency and A-unchanged negatives remain.

Failure after a possible write records the ordinary answer row, using the original request hash and existing held-proposal reconciliation. Same-turn retry reads that answer and current graph immediately, with no second registration or scripted model call. A successful adapter outcome with its own receipt/readback establishes VERIFIED_SAVED; zero dispatched writes establishes VERIFIED_NO_WRITE; a dispatched effect without that evidence stays UNKNOWN. `nothing_saved:false` alone is never treated as save proof. The replay words are exactly:
- Verified: “The saved change is kept, but the reply didn’t arrive. Send a new message to continue.”
- Unknown: “The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.”

The existing HTTP error producers now retain OpenAI's native APIError fields and headers while preserving the legacy diagnostic text. The status-only brief reader still consumes no error body. The old status-based billing classifier and its inclusion of rate_limit_exceeded are retired. The one replacement projection exposes the upstream code/type/status, retry-after and retry-after-ms without inventing timing. credit_balance_exhausted and insufficient_quota produce PROVIDER_CAPACITY/retryable:false; rate_limit_exceeded stays UPSTREAM_ERROR/retryable:true; an unclassified 429 stays UPSTREAM_ERROR with retryability unspecified. There is no new automatic HTTP retry.

Real-route RED→GREEN rows, 0 live provider calls:

| Spec / row class | Lane base | Final |
| --- | --- | --- |
| goal-level-card.route: existing non-sum correction, two declared-sum briefs, two failure/replay briefs, unknown-save contrast | 2 pass / 5 fail | 7 pass / 0 fail |
| ai-core-provider-capacity.route: captured credit failures, server-fault negative, exhausted-credit/quota/transient/unknown contrasts through core and A HTTP producers | 3 pass / 4 fail | 7 pass / 0 fail |
| change-tools.goal-level: existing 23 negatives/positive controls plus seven mixed-change refusals and two receipt/readback contrasts | Existing negatives retained | 32 pass / 0 fail |

The two synthetic briefs correct weekly orders to 110/week and monthly deliveries to 105/month. The second reverses the operation order and contains unrelated revenue 2m, a date and a deadline. A same-label/same-number unrelated factor stays byte-equal. Each sum row verifies one card, one registration, that registration's own receipt, full goal/operand equality, exactly one correctly credited claim, unchanged unrelated nodes, and no second save/call on replay. Save-failure rows retain an unrelated card arriving DURING registration, with exact pending-actions equality. The no-receipt failure/replay remains UNKNOWN despite the graph holding the value.

Mutants (each restored; logs and `L2-mutation-summary.txt` retained):

| Changed claim | Mutant | Result |
| --- | --- | --- |
| Atomic pair | Remove operand from the postimage | KILLED: both real-route sum rows fail |
| Complete pair readback | Remove operand equality from the success predicate | KILLED: operand-loss row fails |
| Durable replay | Omit the catch's answer append | KILLED: all three failure/replay rows fail |
| Held-card preservation | Omit held-proposal reconciliation | KILLED: both concurrent-hold rows fail |
| Honest save outcome | Initialise verifiedSave=true without receipt/readback | KILLED: unknown-save row fails |
| Distinct 429 outcomes | Treat every typed HTTP 429 as billing | KILLED: transient and unknown contrasts fail |
| Retry timing | Drop retry-after and retry-after-ms | KILLED: all four recorded contrast rows fail |

The readback mutant initially SURVIVED because structuredClone preserved a goal/operand object alias in the fake registration. The fixture now serialises JSON like the real route; changing only the stored operand leaves the goal intact and kills the mutant. The original survivor log is preserved. A newly authored retry expectation was also corrected to the existing receipt contract: a prior receipt proves an earlier commit, while `holds_now:false` separately reports a later mismatch; no old protected expectation was loosened.

Final verification: one spec per process, 261 pass / 0 fail across these 25 bounded specs. This is a local result, not a suite or served acceptance claim.

| Spec | Pass / fail |
| --- | --- |
| `goal-level-card.route.test.ts` | 7 / 0 |
| `change-tools.goal-level.test.ts` | 32 / 0 |
| `ai-core-provider-capacity.route.test.ts` | 7 / 0 |
| `change-tools.compound.test.ts` | 7 / 0 |
| `change-tools.goal-target.test.ts` | 12 / 0 |
| `change-tools.claims.test.ts` | 7 / 0 |
| `change-tools.door.test.ts` | 48 / 0 |
| `index.test.ts` | 9 / 0 |
| `ai-core-correction-card.route.test.ts` | 11 / 0 |
| `ai-core-auto-run.route.test.ts` | 13 / 0 |
| `ai-core-consent.route.test.ts` | 8 / 0 |
| `ai-core-proposal-restart.test.ts` | 1 / 0 |
| `ai-core-add-option.route.test.ts` | 9 / 0 |
| `ai-core-add-to-model.route.test.ts` | 7 / 0 |
| `transport-retry.test.ts` | 5 / 0 |
| `instructions-breakpoint-refusal.test.ts` | 5 / 0 |
| `run-keeps-reasoning-item.test.ts` | 1 / 0 |
| `public-research-route.test.ts` | 7 / 0 |
| `figure-must-be-written-by-user.test.ts` | 20 / 0 |
| `context-summary-diagnostic-only.guard.test.ts` | 6 / 0 |
| `run-delta-flip-thresholds-single-site.guard.test.ts` | 5 / 0 |
| `run-delta-pack-parity.guard.test.ts` | 5 / 0 |
| `run-delta-prior-facts-no-default.guard.test.ts` | 10 / 0 |
| `tier3-leak-guard.runtime.test.ts` | 16 / 0 |
| `tier3-leak-guard.static.guard.test.ts` | 3 / 0 |

ESLint: exit 0, no diagnostics on all six changed TS files; the final status-only source adjustment was linted again. `git diff --check`: exit 0. Required new-cycles.py against the lane base: head 9, base 9, NEW/GROWN 0. Typecheck not run: the required process-list probe could not access the sandbox process list; DL retains the build gate. No new scientific engine result or served chance is claimed; the existing auto-Run route spec independently passes 13/13 with scripted dependencies.

pr-shape.sh numbers (the exact script's counting logic, replacing only gh transport with the local src/tests diff because this tree has no PR/network): source +94/−30, net +64 in 3 files; tests +218/−7 in 3 files; fixtures 0; gross added refusal/reason codes 0, regex literals 0, exports 1, if-branches 8. The exported projection replaces the old exported boolean (net exports 0). Growth bridges the declared pair into the existing atomic writer and failed continuations into the existing durable answer floor; it also retains typed provider evidence. No new tool, user-meaning parser, store, retry mechanism or competing writer. Space freed: 0 bytes; no cleanup performed.

HIGH trace:
Value/source: the user says “about 110 a week” or “about 105 a month”; the AI declares that same quantity's goal/current-operand pair. Unrelated digits and subjects confer no authority.
Approved: the single issued card's proposal ID, revision, digest and graph hash, with fields []; both representations are bound into that proposal.
Persisted/readback: one registration, its own receipt, both observed states equal, one exact user-attributed claim, unrelated nodes and held cards retained.
This Run: no live scientific Run is claimed by these correction fixtures; the separate automatic-Run caller rows test the existing pipeline, and the served integration witness remains open.
User saw: one correction card naming the human-readable quantity; after failure, immediate replay of truthful saved/unknown wording and the current saved graph.
First loss boundary: proposeChange's blanket mixed-goal refusal; next boundary tested: complete postimage → one registration → own receipt → full pair readback.
NUMBER: no figure comes from revenue, dates, deadlines, defaults or a host formula.
AUTHOR: the exact claim is credited once to its stated speaker; approving an unrelated Olumi card does not transfer authorship.
CLAIM: a dispatched write is not save proof; a receipt for an earlier commit is distinct from holds_now; no chance or recommendation is invented.

Product test: a person's correction consistently changes the Living Model they approved and remains recoverable after a failed reply, so they can continue their reasoning without repeating or losing their contribution.

Buddy self-check (not an independent reviewer PASS), ≤3 lines:
Correct within the local real-route rung: the declared pair, safe-save authority, exact attribution, unknown state and existing negatives are preserved.
Simplest: reuse the goal writer, ordinary answer floor and one native error projection; +64 source lines bridge missing boundaries, with the superseded billing inference removed.
Out of the box / AI / efficiency: SDK runner, Conversation and needsApproval remain; native APIError retains provider evidence; AI declares binding/source/stance; no host meaning parser, no extra provider call, immediate replay.

Exact commit message (DL commits):
`fix(core): preserve baseline saves and typed provider failures`

- Progress: S5/S10 atomic declared pair; S1 durable failure replay and typed provider outcomes, local route rung.
- Next priorities: fresh HIGH review/integration; then served correction/save/Run/Undo/reopen (highest-value: Y).
- Mistakes: a fake-wire alias initially hid the operand-only readback loss.
- Corrections applied: JSON wire fidelity, independent operand corruption, seven killed mutants; retain this check for future paired writes.
Plan: L2 · Simplest approach? Y — reuse the atomic goal writer, answer floor and native APIError · Net src lines: +64

# Lane: CEE claim-integrity batch (ROADMAP 1.18 / 1.19 / 1.20)

Branch: `claude-cee/claim-integrity-batch`, off `origin/staging` tip `643136474`.
Three independent RED-first fixes, each its own commit. This doc gives an
honest per-fix account: what was verified broken, what the fix does, what
proves it, and what residual risk remains.

## Fix 1 — ROADMAP 1.18: cap-doctrine unification (goal-threshold percentage parity)

**Starting state.** PR #378 (`2a6f4128e`, already on `origin/staging`) had
already unified the draft-path enricher's goal-threshold redirection with the
sanctioned `resolveGoalThresholdCap` doctrine for the ABSOLUTE-VALUE branch
(`factor.unit !== '%' && factor.value > 1`). No test anywhere exercised this
redirection logic end-to-end or compared it against the chat-path
(`add_constraint`) registration for the same raw target — `Docs`/tests search
confirmed zero coverage of `enrichGraphWithFactorsAsync`'s goal-threshold
branch.

**RED proof.** New fixture
(`src/cee/factor-extraction/__tests__/enricher-goal-threshold-cap-parity.test.ts`)
registers the SAME raw target via both paths:
- Unitless (raw=800): draft and chat paths ALREADY agreed (`cap: 1000`,
  `goal_threshold: 0.8` both sides) — PR #378's fix holds for this case.
- Percentage (raw=15%): draft path produced `goal_threshold_raw: 0.15`
  (the pre-divided FRACTION, not the raw percent number) with `goal_threshold_cap:
  undefined`, while the chat path produced `goal_threshold_raw: 15`,
  `goal_threshold_cap: 100` — a real draft-vs-chat CONTRACT divergence (the
  scored `goal_threshold` happened to coincide at 0.15 either way, papering
  over the fact that the persisted `raw`/`cap` fields — what a UI would
  render as "Target: X%" — disagreed).

**Fix.** `cee/factor-extraction/enricher.ts`'s goal-threshold branch now
reconstructs the raw percent number (`factor.value * 100` when
`factor.unit === '%'`) before delegating to `resolveGoalThresholdCap`,
removing the special-cased short-circuit entirely — full delegation, not
partial.

**Verified:** `pnpm typecheck:src` clean; ratchet clean (462 baseline,
no new-file drift); targeted vitest green (2/2 new + 7/7
`add-constraint-goal-target-join.test.ts` regression).

**Residual risk:** none identified for goal-threshold registration parity.
Plain FACTOR-NODE normalisation (`computeNormalisationCap`, a deliberately
separate concern per the file's own doc comment) is untouched — out of
scope.

## Fix 2 — ROADMAP 1.19: receipt claim-integrity

### (a) Unchanged-value re-registration must not claim "updated"

**RED proof.** New fixture
(`src/orchestrator-v5/tools/handlers/__tests__/add-constraint-noop-receipt-honesty.test.ts`)
restates an identical constraint/goal-target value twice via `add_constraint`.
Before the fix: second call's `assistant_text` was
`"Updated constraint: Customer churn must be at most 5%."` for the
non-goal case (matched `/\bupdated\b/i`), and byte-identical
`"Success target set: …"` for the goal-target case — both claiming a fresh
commit event despite `fact.noop === true` (the FACT channel already knew
nothing changed; the TEXT channel didn't check).

**Fix.** New `formatConstraintUnchanged` / `formatGoalTargetUnchanged`
(`d1-shared/format-confirmation.ts`), gated on the ALREADY-COMPUTED
`valueUnchanged` (target node + real diff vs the persisted `existing`
constraint) in `add-constraint.ts`'s assistant-text selection.

**Verified:** typecheck/ratchet clean; 2/2 new tests green; 7/7
`add-constraint-goal-target-join.test.ts` regression green.

### (b) Swap-vs-commit: a swapped receipt must not persist the unbacked graph

**RED proof.** Two PRE-EXISTING tests
(`turn-executor-goal-target-commit-honesty.test.ts`,
`edit-graph-dispatch-goal-target-receipt.test.ts`) explicitly asserted the
BUG as correct behaviour: `expect(write.graph).toBeDefined()` /
`expect(metadata.graph).toBeDefined()` on a turn whose
`decideGoalTargetReceipt` verdict was `'swap'` (assistant_text swapped to
`GOAL_TARGET_NOT_SAVED_TEXT` because the committed graph didn't register the
claimed goal threshold). The text said "I couldn't register that success
target" while the graph carrying the LLM's non-contract fields (the live
313e7b61 leak shape) was STILL persisted (and, on the edit_graph path,
returned to the client).

**Fix.** Both `turn-executor.ts` (STEP 7 D1 chokepoint) and
`edit-graph-dispatch.ts` now withhold the graph write (`graphForCommit =
undefined`) whenever `decideGoalTargetReceipt` swaps AND a graph was written
this turn. `edit-graph-dispatch.ts` also nulls its returned `graph` field
(threaded by route-v2 into `sendFinalised200` for label-resolution and the
diagnostic-trace graph counts) via a new `goalTargetSwapWithheldGraph` flag,
so nothing downstream can surface the unpersisted mutation either.

**Verified:** typecheck/ratchet clean. Updated both pre-existing tests to
assert the corrected behaviour (`write.graph`/`metadata.graph` now
`undefined`, plus a new `out.graph === null` assertion on the edit_graph
path) — both GREEN. Full regression: 362/362 turn-executor tests, 131/131
edit-graph-dispatch tests, 620/620 D1-handler-directory tests.

**Residual risk:** `handler_facts` (the claim-integrity FACT record) is
intentionally left unchanged on a swap — this fix scopes to the GRAPH write
only, per the task's explicit framing ("a SWAP turn must not commit junk").
Auditing whether the fact record itself should also be suppressed/annotated
on a swap is a separate, deeper question not addressed here.

## Fix 3 — ROADMAP 1.20: empty-direct-answer papering + chip sameness

### (a) Empty direct_answer compose → honest bounded-recovery, unconditional

**RED proof.** Pre-existing tests in
`turn-executor-answer-text-compose-guard.test.ts`, explicitly titled
"regression pin for the known live defect", asserted `response.assistant_text
=== ''` for a coach/converse turn whose `answer_text` was absent AND
`orientationText` was empty, WHEN `CEE_ANSWER_TEXT_REQUIRED` (the #388
flag-gated layer-B guard) is OFF — the default. This is the exact live
defect: a direct_answer turn ships `sha256('')`-empty text, papered over by
a deterministic chip (stage/analysis-driven chip generation is independent
of the text, so the empty turn still carries a chip and reads as valid).

**Fix.** A NEW, UNCONDITIONAL guard at turn-executor's STEP 7 commit
chokepoint (the same chokepoint every coach/converse/deterministic
direct_answer-class turn passes through before commit) checks the FINAL
`composedOk.assistant_text`; if blank AND the turn is `direct_answer`-class
(not `handler`), it invokes the SAME `buildBoundedFallbackCopyAndChips()`
helper #388 uses — no new copy/chip source. This does not touch or widen
the flag-gated layer-B logic itself (per the scope guard); it is a separate,
always-on backstop at a later chokepoint that happens to also close the
flag-off gap as a natural consequence of running unconditionally.

**Verified:** typecheck/ratchet clean. Updated the two flag-OFF "regression
pin" tests to assert the corrected (non-blank, bounded-recovery) text
instead of the pinned bug — both GREEN, plus the other 6 tests in that file
(flag-ON layer-B behaviour) unchanged/green. Full regression: 362/362
turn-executor tests.

**Residual risk:** this backstop only runs at the ONE shared STEP 7
chokepoint (coach/converse's main path). The ~15 other deterministic
`direct_answer`-class commit sites in `turn-executor.ts` (state-query guard,
stale-rerun guard, post-analysis-advice-gate, etc.) each call `commitTurn`
independently, earlier in the function, and were NOT audited individually
for a dynamic (non-fixed-template) empty-text path — they compose from
fixed template strings by construction, so no concrete defect was found
there, but this is inspection, not exhaustive proof for every branch.

### (b) Chip selection must vary with turn content

**RED proof.** New fixture
(`src/orchestrator-v5/compose/__tests__/chip-generator-recently-offered.test.ts`)
demonstrates that `generateChips` — a pure deterministic function of
structured turn state by design (never parses response text, per the
module's own doc comment) — returns byte-identical chip arrays for two
calls with identical structured state (stage/analysis/facts unchanged),
which is exactly the "5/5 consecutive turns offered IDENTICAL chips"
failure mode when a conversation sits in the same analysis state across
several converse/coach turns.

**Fix (minimum-bar, per task instruction "at minimum exclude chips already
offered in the last N turns").** New `recentlyOfferedChipIds` field on
`ChipGeneratorInput`; `generateChips` filters the final chip set against it,
shipping `[]` (honest empty, same philosophy as the existing
`no_safe_floor` branch) when every candidate was already offered, rather
than repeating it. Threaded from `context.most_recent_pending_actions`'
`chip_id`s (N=1: the immediately prior turn — the single-prior-turn
authority every other pending-action consumer in `turn-executor.ts` already
reads; there is no existing persistence for a longer chip-offer history),
wired into the coach and converse `generateChips` call sites only (the two
branches responsible for conversational/direct_answer turns — matches Fix
3(a)'s scope; execute/clarify chips were left untouched as their semantics
differ — clarify chips are entity-disambiguation options that should stay
consistent, execute-turn chips are mutation follow-ups).

**Verified:** typecheck/ratchet clean. 5/5 new unit tests green (byte-
identical baseline without the field; full suppression when every candidate
was recently offered; partial suppression leaves the non-repeated chip;
differing state is unaffected; omitting the field is byte-identical to
before). Full regression: 99/99 chip-generator tests, 362/362 turn-executor
tests — no existing test's fixture happened to collide with the new
filtering.

**Residual risk / explicitly NOT done:** this is the "minimum bar" the task
authorised, not full content-awareness. It only closes the loop for
`chip_id`-bearing (executable, resumable-kind) chips reachable via
`most_recent_pending_actions`; a purely conversational prompt chip with no
`action_type` never gets a pending action, so its repeat is NOT caught by
this mechanism unless a later turn's candidate chip HAPPENS to collide with
a `chip_id` from a still-live executable pending action. A genuinely
content-aware chip selector (varying wording/rotation based on what the
turn was actually about) was judged out of scope for a single fix — it
would need new persistence (a real "last N turns' offered chips" store)
and touches the module's core "never parse response text" design
constraint, which is a larger, separate workstream.

## Scope guard compliance

- GM paths: not touched.
- Reasoning-capture paths: not touched.
- Answer-text hardening (#388, `CEE_ANSWER_TEXT_REQUIRED` flag-gated
  layer-B logic in the coach/converse branches): not modified. Fix 3(a)
  reuses `buildBoundedFallbackCopyAndChips()` exactly as instructed, as a
  separate, later, unconditional chokepoint — it does not touch layer A/B.

## Gates run per commit

`pnpm typecheck:src` (clean, all 3 commits) + `bash scripts/ci/typecheck-ratchet.sh`
(462-error baseline held, no new-file drift, all 3 commits) + targeted
`pnpm exec vitest run` on the affected files/directories per commit (all
green, see per-fix sections above for exact counts). Full pre-push gate not
yet run — deferred to the push step per repo convention (Tier 3, "only when
the user explicitly says to push to staging").

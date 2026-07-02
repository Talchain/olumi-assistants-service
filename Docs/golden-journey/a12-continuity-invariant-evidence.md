# A12 prior-turn continuity invariant: evidence pack (component 5 PR1)

**Branch:** `claude/harness-c5-continuity-invariant`. **Baseline:** `origin/staging` @ `2376914c8` (rebased parentage-only onto the post-#317/#318 tip; originally authored on `3e4b86115`). **Date:** 2026-07-02.
Durable home for the A12 RED/GREEN replay transcripts and the fixture exit-code matrix (the classifier unit tests re-run in CI forever; the one-off replay proofs cannot, so they live here rather than in an ephemeral scratchpad).

## The blind spot, proven

`fixtures/golden-journey-v1-context-drop.json` is a hand-authored transcript of the lived defect: the draft and analysis establish the option labels and the leader, then the follow-up flatly denies the conversation ("I don't have the earlier results in this conversation…") and names nothing it established.

**Pre-A12 replay (A1-A11 only), captured before the invariant landed:**

```
findings: 23 (fail=1 [gating=0 advisory=1] inconclusive=10)
exit code: 0
```

The only fail was advisory A5. A verbatim dropped-conversation answer replayed GREEN — the proof that A1-A11 alone could not catch the single most user-felt defect.

**Post-A12 replay (current branch):**

```
findings: 25 (fail=2 [gating=1 advisory=1] inconclusive=10)
exit code: 1
| A12 | fail | gating | high | 1. Context management | 4_follow_up |
  prior-context turn (role=follow_up) denies the prior conversation (…) — prior-turn context was dropped
Next component to fix: 1. Context management (via A12)
```

The report's invariant table (now headed A1..A12) and the component matrix both carry the failing A12 row, agreeing with the exit code.

## Fixture exit-code matrix (for the PR2 gate manifest)

Replayed with the final classifier on this branch:

| Fixture | Exit | Notes |
|---|---|---|
| `golden-journey-v1.json` | 0 | A12 passes on explain, follow-up, explain-what-changed and reload steps (four grounded turns) |
| `golden-journey-v1-defects.json` | 1 | unchanged (its own gating A1/A8 fails) |
| `golden-journey-v1-f4835349-regression.json` | 0 | unchanged |
| `golden-journey-v1-add-risk-rejection.json` | 0 | A8b fires (advisory) on its rejection step, as its authors intended |
| `golden-journey-v1-context-drop.json` | 1 | gating A12 fail, discriminated in the report |

## Review hardening applied (2026-07-02 code review)

The adversarial review found nine real defects in the first A12/role implementation; each fix is pinned by a committed regression test in `tests/unit/golden-journey-harness/continuity.test.ts`:

1. **Report blindness.** `report.ts` never learnt A12: the invariant table (headed "A1..A7") omitted it and the component matrix showed Context management as inconclusive while the run exited 1. Fixed: A12 in the invariant order; headings updated.
2. **Unknown-role safety drop.** The neutral `unknown` role silently lost the gating A1 stale-as-fresh and A4 false-success coverage the old `follow_up` guess accidentally provided, and unknown steps produced no signal at all. Fixed: `unknown` joins A1's analysis-bearing and A4's non-mutating role lists (both self-guard, so no noise), and `evaluateJourney` emits a loud coverage caveat naming every unknown step.
3. **A8 fail-open.** The rejection carve-out was turn-wide, so a mixed "I wasn't able to apply X. The Budget factor has been updated." passed a gating safety invariant it previously failed. Fixed: sentence-scoped strong-ack detection (rejection sentences excluded; sentence-opening, first-person, passive and state-assertion claim shapes count; bare attributive verbs like "an updated brief" do not). Known stated limit: a claim in the same sentence as rejection copy.
4. **Substring anchors.** "budgeting" grounded the "Budget" anchor. Fixed: whole-token anchor matching.
5. **Curly apostrophes.** U+2019 denials evaded every pattern. Fixed: apostrophe normalisation before matching (also applied to A8's ack detection).
6. **Missing roles.** A denial on the explain or reload step escaped A12 entirely. Fixed: both roles included; the golden steps' invariant coverage lists updated.
7. **Denial false positive.** "If you share updated numbers for Budget, I can run the comparison again." matched the re-request pattern. Fixed: the object must directly precede "again".
8. **Anchor sources.** Real wire bodies often omit `option_comparison[].option_label`; anchors now also read `analysis_ready.options[].label`, and accumulate in a single forward walk (one source for the strictly-prior semantics).
9. **Capture robustness.** A typo'd `--capture` path crashed AFTER the authorised live journey, destroying the report; `--capture` was silently ignored in replay; captures dropped `elapsedMs` (A10 evidence degraded to unobservable on replay) and re-declared the reader's type. Fixed: directory creation + non-fatal capture failure, a replay-mode warning, role + elapsed round-trip, and one shared `ReplayFixture` type owned by `capture.ts`. Fixtures may also declare a `role` per observation (honoured over the step-name lookup), which is the durable answer to fixture-specific step names.

Also from review: `EvaluateJourneyOptions.mode` is now required (an optional parameter defaulting to the gating posture would let a future live caller silently gate on LLM variance).

### Review round 3 (PR #319) — three further fixes, each pinned by a committed test

1. **Replay fixture shape now fails closed.** A fixture with a missing, renamed, non-array, or empty `transcript.observations` previously replayed zero turns, reported only inconclusives, and exited 0 (a green-by-emptiness fail-open). The fixture→evaluation path is now a shared pure seam `evaluateReplayFixture` that throws `ReplayFixtureError` (CLI → exit 2) on any of those shapes. Pinned in `tests/unit/golden-journey-harness/replay-fixtures.test.ts`.
2. **RED fixture expected exits are enforced, not just documented.** A machine-readable manifest test runs `evaluateReplayFixture` over every committed fixture and asserts its exit code (`golden-journey-v1`=0, `defects`=1, `f4835349-regression`=0, `add-risk-rejection`=0, `context-drop`=1, the last discriminated to a gating **A12**). A RED fixture silently flipping green now fails the required unit gate immediately, rather than going unnoticed until the PR2 CI replay lands. (This is a unit test, not the PR2 CI workflow — it uses the same seam the CLI uses.)
3. **A8 same-sentence reject-plus-ack closed.** The per-sentence rejection exclusion was itself fail-open: "I wasn't able to apply X, but the Budget factor has been updated." hid a genuine ack behind the rejection clause and passed. The exclusion is removed — the strong-ack shapes (opening verb / first-person / passive / state-assertion) are precise enough that the adjectival "an updated brief" still does not match, so pure rejection copy and the Cap-2A placeholder remain clean while both mixed forms now gate. A8 is a gating safety invariant, so the one residual over-match (rejection copy that literally asserts a completed change via "now shows/reflects") is the safe direction.

## Known residual limit (stated, not hidden)

Anchor matching is whole-token, not paraphrase-tolerant: a healthy live answer that paraphrases every label ("the offshore route" for "Engage an offshore partner") would fail the anchor check when captured and replayed. The capture flow's step 6 (verify the exit code before adding a fixture to the gate manifest) is the control point: a paraphrasing-but-healthy capture surfaces there as an unexpected exit 1 and must be resolved by fixture review, never by loosening the classifier under pressure. If live prose style makes this common, the next step is token-overlap matching, taken deliberately.

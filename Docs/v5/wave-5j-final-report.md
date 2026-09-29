# V5 interaction recovery — Wave 5J final report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 5J commits:** `62fed6ce`, `bfdf4478`, `e12fa5dd`
**Branch ahead of staging:** 31 commits (Wave 0 → Wave 5J)

This supersedes [`wave-5i-final-report.md`](wave-5i-final-report.md).
Wave 5G review of Wave 5I surfaced one P0 (re-persistence on
ambiguous recovery), one P1 safety regression (legacy pendings
bypass the divergence guard), and several hygiene items. Wave 5J
closes them and tightens the proof matrix to ChatGPT's exact
suggested wording.

---

## What Wave 5J changed

### P0 — `recovery_label_ambiguous` re-persists pending actions

**Verified bug.** The Wave 5I-2 ambiguous-recovery branch emitted
chips with no `action_type` and called `commitDirectAnswer` with no
`pending_actions` in metadata, so `derivePendingActionsFromChips`
returned nothing and the recovery turn committed with empty
`pending_actions`. On chip click, the next turn's
`readMostRecentPendingActions` read from the recovery row (the
latest), found nothing, and the original quantity was silently lost.

Fix in `turn-executor.ts`: on `recovery_label_ambiguous`, build a
fresh `recoveryPendingActions` array from
`clarificationDispatch.candidates`. Each surviving candidate is
re-emitted with new id and emit timestamp (lifecycle treats this as
a fresh offer; turn-count and wall-clock TTLs reset), preserving
`factor_id`, `value`, `unit`, and `operator` from the original
clarify. `preconditions.graph_hash` is re-stamped from the live
graph hash at recovery time. Pass via
`commitDirectAnswer({...metadata, pending_actions: recoveryPendingActions})`.

The OTHER three recovery branches (`recovery_expired`,
`recovery_graph_changed`, `recovery_targets_missing`) deliberately
persist nothing — the original pendings are no longer safe to
apply, so the next turn must collect a fresh proposal.

Em-dash fix paired with this change: the recovery copy now uses a
full stop (brief rule):

> Old: "Your reply matches more than one factor — did you mean…"
> New: "Your reply matches more than one factor. Did you mean…"

### P1 — `graphHashConflicts` is now kind-gated

`graphHashConflicts` previously early-returned `false` whenever
`pa.preconditions?.graph_hash` was absent. For mutating kinds this
was unsafe — legacy rows, any future emit path that forgets to pass
a hash, or any turn where the live hash cannot be computed all
bypassed the divergence guard for set_factor_value.

Fix in `clarification-resume.ts`:
- Added a `MUTATING_KINDS` ReadonlySet (currently `{set_factor_value}`).
- For mutating kinds: missing hash on EITHER side → conflict.
- For non-mutating kinds (`run_analysis`, `what_would_flip`): only
  flag when both sides exist and differ. These intentionally carry
  no hash and resuming them never mutates.

Test fixture `setFactorValuePending` now matches production by
setting a `DEFAULT_GRAPH_HASH`. Two new test cases assert the
fail-closed behaviour for legacy rows and for the live-hash-undefined
path.

### P1 hygiene — em-dash sweep

Found and fixed two user-facing em dashes:
- `turn-executor.ts:1183` (short-confirm `recovery_ambiguous`):
  "I had more than one offer open — which would you like?" → "…
  open. Which would you like?"
- `turn-executor.ts:1361` (clarification `recovery_label_ambiguous`,
  fixed in 5J-1): "more than one factor — did you mean" → "more
  than one factor. Did you mean"

Sweep across V5 production code confirms no remaining em dashes in
user-facing strings.

### P1 hygiene — mock fixture clears on empty writes

The `orchestrate-v2-clarify-reply-two-turn.test.ts` mock previously
only updated `mostRecentPendingActions` when the new write carried
non-empty pending_actions. A future regression where a recovery
turn fails to re-persist pendings would still see the previous list
and pass silently. Mock now always overwrites with `pending ?? []`,
mirroring production semantics.

### Two-turn HTTP executability proof

A new HTTP test in `orchestrate-v2-clarify-reply-two-turn.test.ts`
proves the P0 contract end to end through `app.inject`:
- Turn 1: ambiguous reply ("Time Commitment" fuzzy-matches both
  seeded pendings) → `recovery_label_ambiguous` fires; the mock
  SessionStore captures the re-persisted pendings.
- Turn 2: chip-equivalent reply ("Engineering Time Commitment") →
  resumer matches uniquely against the re-persisted pendings,
  reconstructs the original quantity (5), and dispatches
  set_factor_value with `target_id=fac_eng_time` on the wire.
- Across both turns, zero LLM calls.
- Receipt uses human factor label, no raw ids leak, original
  quantity (5) is in the wire response.

---

## Honest proof matrix — named brief failures

Column semantics unchanged from Wave 5I. ChatGPT's specific
explanation-coverage wording is now in the matrix verbatim.

| # | Failure | Implemented | Unit tested | Route tested | HTTP-boundary tested | User-visible locally proven | Live staging proven | Deferred |
|---|---|---|---|---|---|---|---|---|
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ recovery + ✅ success branches | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ not added | ✅ (preflight blocks LLM call; recovery is INLINE PROSE, no chips) | ❌ not run | A4 add-risk **clarification continuity** (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value side; graph_hash persistence + kind-gated divergence guard + ambiguous-recovery re-persistence) | ✅ | ✅ | ✅ single-turn deterministic + ✅ two-turn clarify→reply + ✅ two-turn ambiguous-recovery → chip-equivalent reply applies original quantity | ✅ | ❌ not run | A4 add-risk side (Wave 5G) |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ HTTP deterministic explanation prose checked (chip-click success-path asserts no raw decimals on the wire) ; **generated forbidden-answer downgrade NOT HTTP-tested** | ✅ | ❌ not run | — |

### Per-failure evidence pointers (delta from Wave 5I)

#### Failure 3 — Value-update continuity

Now has **three** layered HTTP-boundary proofs, all hitting POST
`/orchestrate/v2/turn` via `app.inject`:

| Test | What it proves |
|---|---|
| `orchestrate-v2-deterministic-value-update.test.ts` | Single-turn unambiguous match dispatches `set_factor_value`, no LLM call |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("Turn 1 emits clarify chips… Turn 2 typed factor label dispatches…") | Two-turn clarify → typed factor label applies original quantity |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("Wave 5J-1 P0: ambiguous reply re-persists…") | Three-step flow (ambiguous reply → re-persisted recovery → chip-equivalent reply applies original quantity) — proves the P0 contract end to end |

Plus the kind-gated divergence guard (Wave 5J-2) closes the legacy /
missing-hash path the previous resumer would have applied blindly.

#### Failure 4 — Explanation egress

Wording tightened to ChatGPT's exact suggested phrasing. The HTTP
proof is for the deterministic explanation prose passing the egress
guard on a real wire response (chip-click success-path test). A
dedicated HTTP test for the validator-driven downgrade fires when
the LLM-generated `answer_text` contains forbidden content
(`noop`, `BUDGET_TARGET`, `Zod`, `graph_hash`, raw decimals) is NOT
added in this tranche. The validator is exercised at
`validator-explanation.test.ts` (handler unit-test layer);
upgrading to a route test would require mocking
`chatWithTools` to return a tool_use proposal for `explain_results`
with a forbidden `answer_text` plus a fresh analysis fact —
substantial scaffolding for incremental coverage of behaviour the
unit tests already pin. Marked as Wave 6 follow-up if needed.

---

## Test and hygiene summary

### Touched-test results (Wave 5J)

```
Wave 5J-1 — re-persist + em-dash + executability test:
  src/orchestrator-v5/__tests__/clarification-resume-route-level.test.ts: 4/4 ✓
                                          (re-persistence assertions added)
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 3/3 ✓
                                              (P0 ambiguous-recovery test added)

Wave 5J-2 — kind-gated graphHashConflicts:
  src/orchestrator-v5/routing/__tests__/clarification-resume.test.ts: 21/21 ✓
                                                (was 19/19; 2 cases added)

Wave 5J-3 — em-dash sweep + mock fixture cleanup:
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 3/3 ✓
```

### Full V5 + orchestrator suite

```
$ pnpm vitest run --reporter=default \
    src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts \
    tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts

  Test Files  1 failed | 132 passed (133)
  Tests       2 failed | 2125 passed | 1 skipped (2128)
```

Net change vs Wave 5I close-out: +3 passing tests (1 P0 HTTP
two-turn + 2 kind-gated graph-hash unit cases). No new regressions.

### Failing tests — staging baseline check

Unchanged from Wave 5I — the 2 failures are the pre-existing
`no-op-helpers.test.ts` "options" wording mismatch on staging. `git
diff --stat staging..HEAD --
src/orchestrator-v5/tools/handlers/__tests__/no-op-helpers.test.ts
src/orchestrator-v5/tools/handlers/no-op-helpers.ts` returns no
output.

The 1 skipped test is unchanged (PLoT environment variable gate).

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing (`generated/openapi.d.ts` codegen
artefact in `src/routes/assist.v1.*.ts` and
`src/services/review/*.ts`). None of the Wave 5J touched files have
TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs supabase scripts
(clean — Wave 5J commits explicit-path staged; no node_modules,
 env, lockfiles, prompts, or build artefacts)
```

### DB migration / rollback status

Unchanged from Wave 5H close-out. No schema changes in Wave 5I or
Wave 5J. The `v5_pending_actions` migration applied to staging in
Wave 0 with a default that keeps existing callers working. The
`graph_hash` field added in Wave 5I-1 is at the application layer
only — the JSONB column accepts any shape.

### Push / merge / deploy status

- No `git push` issued.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All 31 commits are local on this worktree, on
`claude/p0-v5-interaction-recovery`.

---

## Wave 5G review items — disposition

| ChatGPT review item | Disposition |
|---|---|
| P0: ambiguous recovery does not re-persist pendings | **Fixed** in Wave 5J-1 with HTTP two-turn regression test |
| P1: missing graph_hash treated as safe for set_factor_value | **Fixed** in Wave 5J-2 (kind-gated, fail-closed) with two unit-test cases |
| P1: em dash in ambiguous recovery copy | **Fixed** in Wave 5J-1 (and 5J-3 swept the short-confirm copy too) |
| P1: focused recovery chips under-tested for executability | **Fixed** in Wave 5J-1 — three-step HTTP test proves chip-equivalent reply applies original quantity |
| P1: HTTP explanation proof still not generated-answer egress | **Tightened** in matrix above to ChatGPT's exact suggested wording — "HTTP deterministic explanation prose checked, generated forbidden-answer downgrade NOT HTTP-tested" |
| P1: value-update HTTP test mock doesn't clear on empty writes | **Fixed** in Wave 5J-3 — mock now mirrors production by always overwriting |
| P1: matrix overclaims explanation HTTP coverage | **Fixed** in matrix above |
| Improvements: P0 graph-hash persistence | Kept (Wave 5I-1) ✅ |
| Improvements: lead-framing copy | Kept (Wave 5I-5) ✅ |
| Improvements: pre-Wave-6 grep for em dashes and chip executability | **Done** in Wave 5J-3 (em-dash) and 5J-1 (chip executability via re-persistence + test) |

---

## Proceeding to Wave 6

Wave 5J closes every actionable Wave 5G review item. The remaining
deferral is A4 add-risk **clarification continuity** (Wave 5G), a
genuine follow-up brief.

Wave 6 next:
- A representative end-to-end local journey replay across the four
  named failures, captured as a single CEE integration test.
- A manual deployed-staging replay checklist.
- A final status grid + merge recommendation.

Optional Wave 6 follow-up tests if the unit-level proof is judged
insufficient:
- HTTP-boundary at-limit add-risk (would require a 30-edge fixture).
- HTTP-boundary forbidden-term denylist on generated `explain_results`
  body (would require an LLM mock returning a tool_use with
  forbidden `answer_text`).

Neither is required for the matrix above to be honest as written.

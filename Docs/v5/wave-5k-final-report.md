# V5 interaction recovery — Wave 5K final report

**Branch:** `claude/p0-v5-interaction-recovery`
**Base:** `staging` (`c8306047`)
**Date:** 2026-05-06
**Wave 5K commits:** `e8fb9a76`, `6e75dfcd` (and this report)
**Branch ahead of staging:** 33 commits (Wave 0 → Wave 5K)

This supersedes [`wave-5j-final-report.md`](wave-5j-final-report.md).
Wave 5J review of Wave 5J found no new P0s; the items it raised were
honesty / safety-by-design improvements. Wave 5K closes them.

---

## What Wave 5K changed

### Defensive `reEmitGraphHash` invariant

The Wave 5J-1 re-emit branch on `recovery_label_ambiguous` used a
conditional spread to attach `graph_hash`:

```ts
preconditions: {
  target_entity_ids: [a.factor_id],
  ...(reEmitGraphHash != null ? { graph_hash: reEmitGraphHash } : {}),
},
```

Tracing the resumer confirms `recovery_label_ambiguous` only fires
AFTER the hash-safety filter has passed, which for `set_factor_value`
mandates a non-undefined live hash. So the conditional should be
unreachable in practice — but the conditional silently tolerated null,
so a future refactor of the gate ordering could quietly drop the hash
field. Wave 5J-2's fail-closed gate would then mark the re-persisted
pendings as `recovery_graph_changed` on the chip click, denying the
user's intent without diagnostic surface.

Fix in `turn-executor.ts`:
- Replace the conditional with an explicit `throw` if
  `reEmitGraphHash == null` at this code path. Error message names
  the invariant.
- The `preconditions` shape now ALWAYS sets `graph_hash` directly
  (no spread). The next-turn divergence guard reads the right
  baseline by construction.

Test cordon in `clarification-resume-route-level.test.ts` asserts
every re-persisted pending carries a non-empty
`preconditions.graph_hash`. A future refactor that drops the
re-stamp breaks the test loudly.

### Seeded HTTP test renamed

The Wave 5J-1 HTTP test was titled
`Wave 5J-1 P0: ambiguous reply re-persists pendings; chip-equivalent
reply applies the original quantity, no LLM call across both turns`.
Accurate but did not flag that the test pre-seeds
`mostRecentPendingActions` rather than driving through a real Turn 0
clarify.

Renamed to:

```
SEEDED two-turn HTTP proof — ambiguous reply re-persists pendings;
chip-equivalent reply applies the original quantity, no LLM call
across both turns
```

The docstring now references the canonical clarify→reply HTTP test
in the same file (the one that DOES drive through a value-update
clarify Turn 0) and explains the seeding choice — the value-update
detector's multi-match tokenisation behaviour for long factor labels
is unrelated to the recovery-and-apply contract this test cordons.

### `MUTATING_KINDS` classification — honest comment + regression test

The Wave 5J-2 `MUTATING_KINDS` comment promised that "adding a future
mutating kind without updating the safety gate fails loudly".
TypeScript does NOT enforce this — a kind added to the
`PendingAction.action.kind` union but omitted from `MUTATING_KINDS`
would silently be treated as non-mutating and bypass the divergence
guard.

Honest fix in `clarification-resume.ts`:
- Soften the comment to name the constraint accurately:
  *"MAINTENANCE CONTRACT: this set must be kept in sync with the
  PendingAction.action.kind union by hand. TypeScript does NOT
  enforce exhaustiveness — a kind added to the union but omitted
  from this set would silently be treated as non-mutating and
  bypass the fail-closed divergence guard."*
- Add a companion `NON_MUTATING_KINDS` set (currently `{run_analysis,
  what_would_flip, apply_proposed_change, edit_graph_add_risk}`) so
  a new kind must land in EITHER mutating or non-mutating.
- Export `PENDING_ACTION_KIND_SAFETY` so the test layer can audit
  classification without reaching into module internals.
- Two new regression tests in `clarification-resume.test.ts`:
  a. **Every kind classified exactly once** — iterates every kind
     in `RESUMABLE_ACTION_TYPES` and asserts each is in exactly one
     of `{mutating, non-mutating}`.
  b. **No orphan entries** — every entry in either set must be a
     known kind. Catches typos and stale entries after a kind rename.

A future kind addition that forgets to classify now trips the
classification regression rather than shipping silently. The fix
doesn't pretend to make TypeScript exhaustive-check the runtime
sets — it makes the maintenance contract testable.

---

## Honest proof matrix — named brief failures

Column semantics unchanged from Wave 5J. The wording for failure 3
(value-update continuity HTTP coverage) is now precise about what
each HTTP test exercises. The wording for failure 4 (explanation
egress HTTP coverage) is unchanged from the Wave 5J tightening.

| # | Failure | Implemented | Unit tested | Route tested | HTTP-boundary tested | User-visible locally proven | Live staging proven | Deferred |
|---|---|---|---|---|---|---|---|---|
| 1 | "yes" after explore-result offer dispatches what_would_flip / run_analysis | ✅ | ✅ | ✅ | ✅ recovery + ✅ success branches | ✅ | ❌ not run | — |
| 2 | At-limit add-risk no longer spends 16-18s in `edit_graph` | ✅ (preflight) | ✅ | ✅ | ❌ not added | ✅ (preflight blocks LLM call; recovery is INLINE PROSE, no chips) | ❌ not run | A4 add-risk **clarification continuity** (Wave 5G) |
| 3 | Value-update clarification applies the original quantity | ✅ (set_factor_value side; graph_hash persistence + kind-gated divergence guard + ambiguous-recovery re-persistence + reEmitGraphHash invariant) | ✅ | ✅ | ✅ full HTTP proof for normal clarify→reply ; ✅ **seeded** HTTP proof for ambiguous-recovery → chip-equivalent reply applies original quantity | ✅ | ❌ not run | A4 add-risk side (Wave 5G) |
| 4 | Explanation output has no raw decimals or internal terms | ✅ | ✅ (boundary buckets + denylist) | ✅ | ✅ HTTP deterministic explanation prose checked (chip-click success-path asserts no raw decimals on the wire) ; **generated forbidden-answer downgrade NOT HTTP-tested** | ✅ | ❌ not run | — |

### Per-failure evidence pointers (delta from Wave 5J)

#### Failure 3 — Value-update continuity

The HTTP-boundary cell now distinguishes the two proof shapes:

| Test | What it proves | Provenance |
|---|---|---|
| `orchestrate-v2-deterministic-value-update.test.ts` | Single-turn unambiguous match dispatches `set_factor_value`, no LLM call | Drives a real Turn N from message + graphState |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("Turn 1 emits clarify chips… Turn 2 typed factor label dispatches…") | Two-turn clarify → typed factor label applies original quantity | Drives both turns from real value-update detector dispatch |
| `orchestrate-v2-clarify-reply-two-turn.test.ts` ("SEEDED two-turn HTTP proof…") | Ambiguous-recovery re-persists pendings; chip-equivalent reply applies original quantity | **Pre-seeds** `mostRecentPendingActions`; drives the recovery + apply turns through `app.inject`. Skips the value-update detector dispatch path on Turn 0 |

The seeded form isolates the recovery-and-apply contract (the Wave
5J-1 P0). It does not claim to be a continuous production three-turn
journey — the canonical clarify→reply HTTP test above covers that
path. Together they cover the failure-3 contract; alone, neither
does.

Plus the kind-gated divergence guard (Wave 5J-2) and the
`reEmitGraphHash` invariant (Wave 5K-1) close the legacy /
missing-hash paths the resumer would otherwise have applied
blindly.

---

## Test and hygiene summary

### Touched-test results (Wave 5K)

```
Wave 5K-1 — defensive reEmitGraphHash invariant + seeded test rename:
  src/orchestrator-v5/__tests__/clarification-resume-route-level.test.ts: 4/4 ✓
                                          (graph_hash assertion added)
  tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts: 3/3 ✓

Wave 5K-2 — MUTATING_KINDS classification:
  src/orchestrator-v5/routing/__tests__/clarification-resume.test.ts: 23/23 ✓
                                          (was 21/21; +2 cases:
                                           classification regression)
```

### Full V5 + orchestrator suite

```
$ pnpm vitest run --reporter=default \
    src/orchestrator-v5 src/orchestrator \
    tests/integration/orchestrate-v2-chip-click-resume.test.ts \
    tests/integration/orchestrate-v2-deterministic-value-update.test.ts \
    tests/integration/orchestrate-v2-clarify-reply-two-turn.test.ts

  Test Files  1 failed | 132 passed (133)
  Tests       2 failed | 2127 passed | 1 skipped (2130)
```

Net change vs Wave 5J close-out: **+2** passing tests (the two new
classification regression cases). No new failures.

### Failing tests — staging baseline check

Unchanged from Wave 5J — the 2 failures are the pre-existing
`no-op-helpers.test.ts` "options" wording mismatch on staging.

The 1 skipped test is unchanged (PLoT environment variable gate).

### Build typecheck

```
$ pnpm exec tsc -p tsconfig.build.json --noEmit
```

Errors are all pre-existing (`generated/openapi.d.ts` codegen
artefact). None of the Wave 5K touched files have TS errors.

### Branch diff hygiene

```
$ git status --short -- src tests Docs supabase scripts
(clean — Wave 5K commits explicit-path staged; no node_modules,
 env, lockfiles, prompts, or build artefacts)
```

### Em-dash sweep — scope honesty

The Wave 5J report claimed "Sweep across V5 production code confirms
no remaining em dashes in user-facing strings". That overstated the
evidence — the grep used patterns like `assistant_text|message:`
which incidentally caught comments, log messages, and doc strings
alongside emit-path strings. The two specific user-facing strings in
that tranche (`turn-executor.ts:1183` and `:1361`) were fixed and
verified by re-running the touched tests, but a structured global
audit of every assistant_text emit path was not performed.

For the audit gap to matter in production a new user-facing copy
would have to slip through with an em dash. The chip-click recovery
HTTP test, the two-turn clarify test, and the SEEDED two-turn
recovery test all assert `not.toContain('—')` on their wire
responses, so any em dash on those code paths fires loudly. Other
emit paths are not under that assertion today.

### DB migration / rollback status

Unchanged from Wave 5H close-out. No schema changes in Waves 5I,
5J, or 5K.

### Push / merge / deploy status

- No `git push` issued.
- No PR opened.
- No merge to `staging` or `main`.
- No deploy.

All 33 commits are local on this worktree, on
`claude/p0-v5-interaction-recovery`.

---

## Wave 5J review items — disposition

| ChatGPT review item | Disposition |
|---|---|
| P1: seeded HTTP test name doesn't flag provenance | **Fixed** in Wave 5K-1 — renamed to "SEEDED two-turn HTTP proof…" |
| P1: re-emit relies on `reEmitGraphHash` without invariant assertion | **Fixed** in Wave 5K-1 — explicit throw + test cordon |
| P1: report says "three-step HTTP test" | **Fixed** in matrix above — failure-3 row distinguishes the two HTTP forms |
| P1: `MUTATING_KINDS` comment misleads | **Fixed** in Wave 5K-2 — comment softened, classification regression added |
| P1: em-dash sweep wasn't user-facing-only | **Acknowledged** in this report (see "Em-dash sweep — scope honesty" above) — no further code change |
| Improvements: keep Wave 5J changes | ✅ |
| Improvements: tighten value-update matrix wording | **Done** in matrix above |
| Improvements: A4 add-risk continuity stays deferred | ✅ already labelled |

---

## Proceeding to Wave 6

Wave 5K closes every actionable Wave 5J review item. The remaining
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
- Structured global audit of assistant_text emit paths for em dash
  / brief-rule compliance (the implicit claim from Wave 5J).

None is required for the matrix above to be honest as written.

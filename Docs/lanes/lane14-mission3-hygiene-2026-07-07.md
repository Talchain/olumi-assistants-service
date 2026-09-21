# Lane CEE-W4 — Mission 3 carry-over + test hygiene (2026-07-07)

Branch: `claude-lane14/mission3-hygiene` (fresh worktree from `origin/staging` @ `2896bebf4`)

Two missions:

- **A — Mission 3 (#358, roadmap 1.9):** carry the open draft PR "mission3
  unknown-freshness transport" (based on old staging @ `b9fbc988e`, #351) forward onto
  current staging.
- **B — Test hygiene (roadmap 1.13):** fix the 9 pre-existing failures in the 5
  `REQUIRED_GATE_RED_EXCLUSIONS` suites named by the mission, plus the known
  flaky-slow `forbidden-user-facing-phrases` route-v2 audit test.

---

## Mission A — #358 carry-over

### Assessment

- `gh pr view 358`: OPEN draft, head `claude/output-recovery-transport-rydxor`
  (`0e512989`), base `staging`, `mergeable: UNKNOWN` (GitHub had not recomputed against
  the moved base).
- Overlap check: `comm -12` of files touched by #358 (`b9fbc988e..pr358-head`) vs files
  changed in the staging drift (`b9fbc988e..2896bebf4`, 12 commits including #348,
  #346, #359, #360, #349, #354–#357, #341, #361, #362) → **empty**. No file-level
  conflict surface.

### Action taken

Both #358 commits cherry-picked **clean** (no conflicts, original authorship
preserved — `Author: Claude <noreply@anthropic.com>`, original messages intact):

| Original (#358) | On this branch | Subject |
|---|---|---|
| `fd034a22a` | `0483db64a` | feat(v5/mission3): recover dropped unknown freshness verdict onto the wire — freshness-only analysis_ready synthesis |
| `0e5129897` | `524bf6ec0` | fix(v5/mission3): mark freshness telemetry null-fallbacks forbidden-exempt |

Scope unchanged from the #358 body: synthesise a safe `status: "blocked"`,
freshness-only, science-free `analysis_ready` for exactly the two allowlisted
`unknown` reasons (`legacy_fact_missing_hash`, `current_graph_hash_unavailable`) on
the legacy/unparseable reload gap; synthesis runs after `sanitiseEnrichmentBlocks`
and before `validateEgress` at the same finaliser seam — the transport is recovered
**through** the #352 cage, not around it (transport recovery, not claim recovery).

### Verification on current staging

All nine mission-3 suites green on this branch (141/141):
`response-finaliser` (synthesis matrix), `turn-executor-freshness-canonical-graph`
(true-gap integration), `analysis-ready-emit`, `response-finaliser-enrichment-backstop`,
`response-finaliser-hook`, `context/freshness`, `tests/contract/analysis-freshness`,
`tier3-leak-guard.runtime`, `tier3-leak-guard.static.guard`.

### Merge-condition status (from the #358 body)

- "ISSUE-9023 gate green" — **DONE** (converted 7 Jul, per lane briefing).
- The inherited ISSUE-9024 tripwire red documented in #358 was fixed on staging by
  #359 (`010bb422`), which is in this branch's base — that blocker no longer exists.
- "Smoke UI handling of `analysis_ready.status='blocked'` + empty options before
  merge" — **still open, post-merge verification** for the orchestrator's browser
  harness. Not verifiable from this repo (DGAI renderer is out-of-repo). The #358
  body's risk framing stands: target reload path has no prior readiness view to
  overwrite; the reason-allowlist keeps mid-session `unknown` paths unwidened.

### Close-out

#358 is superseded by this branch (content carried via clean cherry-picks with
authorship preserved). Recommend closing #358 without merge once this PR lands;
a close-out comment referencing this PR has been left on #358.

---

## Mission B — test hygiene (roadmap 1.13)

### Reproduction (pristine baseline)

On the untouched worktree at `origin/staging` = `2896bebf4`, one vitest run of the 5
named files reproduced **exactly 9 failures / 70 passes**, matching the mission list:

| File | Fails |
|---|---|
| `src/orchestrator-v5/__tests__/d1-followup-fixes.test.ts` | 2 |
| `src/orchestrator-v5/__tests__/turn-executor-explain-precondition-chip.test.ts` | 1 |
| `src/orchestrator-v5/__tests__/turn-executor-recoverable-handler.test.ts` | 1 |
| `src/orchestrator-v5/handlers/__tests__/chip-click-dispatch.test.ts` | 2 |
| `src/orchestrator-v5/handlers/__tests__/chip-click-dispatch-analysis-ready.test.ts` | 3 |

All 5 files sit on `REQUIRED_GATE_RED_EXCLUSIONS` (excluded from the required gate
since #225, 2026-06-01) — which is why they rotted silently while the gate stayed
green. These reds are **older than the recent staging drift**: none of the culprit
source changes below is in the `b9fbc988e..2896bebf4` window.

### Diagnosis per failure — stale expectation vs real defect

**All 9 are stale test expectations. No product defect found.** One *test*-side
masked defect found and fixed (group 3). Verdicts derived from `git log`/`-S` of the
source seams:

1. **d1-followup-fixes ×2** (`userGuidance` expected to carry "exceeds" / "£150,000").
   P1.1 follow-up P1.2 (`8f0dc939`, 2026-05-10) deliberately locked `userGuidance` to
   the per-handler canonical War-Room phrase (`d1-shared/user-guidance.ts`: "War-Room
   locked phrases — do not edit") while the detailed value/cap wording rides
   `message`/`specific_issue` (still asserted, still passing). **Stale.** Fix: assert
   the detail on `message`, assert `userGuidance` equals the imported canonical
   constant.
2. **turn-executor-explain-precondition-chip ×1** (what_would_flip wire-level chip).
   Trace showed `v5.no_analysis_guard matched:true, intent_class:'what_would_flip'` —
   the carrier "What would change the outcome?" now matches the broadened
   `classifyAnalyticalIntent` patterns (#200 2026-05-26, #236 2026-06-06), so the turn
   is legitimately intercepted pre-Sonnet and the precondition-fail path under test
   never runs. Same drift class the file's own BASE_PAYLOAD comment documents.
   **Stale carrier.** Fix: reuse the proven-neutral BASE_PAYLOAD carrier + add the
   `routingAdapter.chatWithTools` tripwire the sibling explain_results test has.
3. **turn-executor-recoverable-handler ×1** (`handler_not_registered` stays fatal).
   Masked test defect: the mock proposal used `entity.kind: 'factor'`, which is not
   in `EntityKindSchema` (`'node'|'edge'|'option'|'goal'|'constraint'`) — the proposal
   **never parsed**, so the pin had been passing on the parse-failure fatal path, not
   the dispatch registry-miss it names. When the bounded routing fallback landed
   (schema_repair_failed → committed 200 direct_answer; trace:
   `v5.routing_bounded_fallback routing_error_cause:'schema_repair_failed'`), the
   false pin flipped red. The *dispatch* fatal path itself is unchanged and intended
   (turn-executor `translateExecuteError` → UNSUPPORTED_ACTION). **Stale/defective
   test, product behaviour intended.** Fix: drive the pin with the known-good
   `PROPOSAL_RUN_ANALYSIS` + empty handler registry so it genuinely reaches dispatch;
   fatal assertions unchanged and passing.
4. **chip-click-dispatch ×2 + chip-click-dispatch-analysis-ready ×3** (enricher not
   called / validate-chip missing). #209 (`d92702d4`, 2026-05-28) gated the
   decision_review auto-fire behind `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`
   (default **false** → skip with `autofire_disabled`). These tests pin the await
   path (brief threading into the enricher; current-turn validate-chip parity).
   **Stale (missing flag setup).** Fix: set the env flag + `_resetConfigCache()` in
   the affected describes, mirroring `turn-executor-decision-review-resilience.test.ts`
   (which documents exactly this pattern; the default fast path is covered separately).
5. **forbidden-user-facing-phrases route-v2 audit** (5s timeout, known flaky-slow,
   pre-existing): the dynamic import of route-v2's full module graph runs ~4.7s cold.
   Bumped that single test to 30s; assertion untouched.

### Gate restoration

Per the config's own rule ("Remove a path only once it is genuinely green again"),
the 5 now-green files were removed from `REQUIRED_GATE_RED_EXCLUSIONS` in
`vitest.required.config.ts`, restoring them to the required merge gate.
17 paths remain on the exclusion list (out of scope for this lane).

---

## Verification (this branch, worktree)

- 9 previously-failing tests green; **all 5 whole files green** (48 + 31 tests), plus
  `forbidden-user-facing-phrases` whole file green (167 tests).
- Mission-3 suites: 9 files, 141/141 green.
- `pnpm typecheck:src` — clean.
- `npx eslint` on all changed files — clean.
- `pnpm test:required` WITH the 5 files restored to the gate — **GREEN**:
  936 files passed / 8 skipped (944 collected), 18,714 tests passed / 99 skipped /
  13 todo (18,826 collected). The 944-vs-939 file and 18,826-vs-18,738 test deltas
  against the pristine-staging control run are exactly the 5 restored files.
- Control: `pnpm test:required` on a **pristine `origin/staging` probe worktree** —
  GREEN (931 files / 18,626 tests passed).

### Honest note — transient CQE load-flake observed (NOT this branch)

The FIRST full required run on this branch failed 2 tests in
`src/orchestrator-v5/routing/__tests__/deterministic-value-update.from-to.test.ts`
("Fix A — real-CQE integration": expected 1 merged quantity, got 2). Triage:

- passes in isolation on this branch AND on pristine staging;
- full-suite re-run on this branch under normal load: green (85s vs the failing
  run's 200s wall duration);
- mechanism: `extractQuantities` enforces `CQE_REGEX_TIMEOUT_MS = 50`ms per rule /
  `CQE_TOTAL_BUDGET_MS = 200`ms total **wall clock**; under CPU saturation a rule
  blows its budget and is skipped, so the from/to merge doesn't fire and CQE emits
  2 unmerged quantities.

Verdict: pre-existing load-sensitivity in the CQE budget design, not caused by (or
fixed by) this branch. Flagged as a follow-up: those real-CQE assertions are
timing-sensitive members of the required gate.

## Files changed (this lane's own commits)

- 6 test files (see hygiene commit `test(v5/hygiene): …`) — test-only.
- `vitest.required.config.ts` — exclusion-list shrink (gate-strengthening only).
- `docs/lanes/lane14-mission3-hygiene-2026-07-07.md` — this report.

Plus the two cherry-picked #358 commits (5 files, +290/−11, additive; boundary
untouched — both schemas pre-existed and are `.passthrough()`; no schema promotion).

No `src/` product-code changes originate from this lane beyond the #358 cherry-picks.
`node_modules` untouched in every commit (pnpm install ran for the worktree; tracked
tree restored before commit staging — only intended paths staged).

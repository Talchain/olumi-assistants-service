# F7 — unknown-freshness bounded-fallback fix — completion evidence

PR: [#398](https://github.com/Talchain/olumi-assistants-service/pull/398)
Squash-merged into `staging` as `97aed5bcb1ff0193f1fc947c036a7c2ad0d3f771`.

## Change

`buildBoundedFallbackCopyAndChips` (`src/orchestrator-v5/turn-executor.ts`,
~line 7050) previously lumped `freshness === 'unknown'` in with `'stale'`
(`analysisStaleButPresent = hasAnalysisProjection && !isFresh`), producing
misleading "has changed" / "out of date" copy in cases where the analysis's
freshness genuinely cannot be determined (e.g. a persisted graph that fails
`GraphStateIngressSchema` ingress parsing, so the current graph hash is
unavailable).

Added `isUnknown = freshness?.freshness === 'unknown'` and
`analysisUnknownButPresent = hasAnalysisProjection && isUnknown`;
`analysisStaleButPresent` now excludes `unknown` explicitly
(`hasAnalysisProjection && !isFresh && !isUnknown`). `null`/`undefined`
freshness is unchanged and still buckets with stale.

Unknown copy invites a re-run without asserting staleness, and is asserted
to not match `/has changed|out of date/i`. Chips for unknown mirror stale
(`[runAnalysisChip]` only), preserving the F2 chip-sameness guard.

New test: `src/orchestrator-v5/__tests__/turn-executor-bounded-recovery-unknown-freshness.test.ts`
— 4 cases (fresh/stale/unknown/none) through the STEP-7 backstop via
`runTurnExecutor`. Unknown reachability is driven by a malformed
`persistedGraph` fixture (`{nodes:'not-an-array',edges:[]}`) that fails
`GraphStateIngressSchema.safeParse`, forcing `deriveAnalysisFreshness` to
`'unknown'` / `current_graph_hash_unavailable`. RED-first verified
(stash-confirmed failing pre-fix, per the implementing agent's session —
this rescue/verify pass re-ran the suite green post-commit, see
`new-test-green.txt`).

## Provenance note

This fix was implemented and RED→GREEN-verified by a prior agent session,
which ended with the work uncommitted in a scratchpad git worktree
(`claude-cee/f7-unknown-freshness`, based on `origin/staging` at `2f747ee2`).
This session rescued the uncommitted diff (exactly 2 files: the modified
`turn-executor.ts` and the new test file — no `node_modules` staged),
committed, pushed, and carried it through gates/PR/merge/deploy.

## Gates (this session, re-run in a fresh worktree post-rescue)

- `typecheck-src.txt` — `pnpm typecheck:src`, clean.
- `forbidden-boundary-patterns.txt` — `scripts/check-forbidden-boundary-patterns.sh`,
  0/95/17, matches baseline exactly.
- `new-test-green.txt` — the new test file alone, 4/4 passed.
- `test-required-summary.txt` — `pnpm test:required`, 993 files / 19429 tests
  passed, 0 failed (matches the expected ~19425 floor, +4 for the new file).
- `validate-prepush.txt` — `bash scripts/validate-prepush.sh`, all checks OK.
- `pr-398-ci-checks.txt` — GitHub Actions checks on PR #398. The only
  **required** check per branch protection (`staging`) is
  "Lint, TypeCheck, Unit Tests" — passed. Two advisory/non-required checks
  failed (`Integration Tests (advisory)`, `Security Audit`) — both are
  pre-existing and unrelated to this diff (same failures reproduce
  identically at `origin/staging` tip per PR #397's evidence).

## Deploy verify (Render, `cee-staging` / `srv-d4slpaili9vc73eiq4og`)

- Auto-deploy triggered on the merge push (deploy `dep-d97m7s3tqb8s73cf4na0`,
  commit `97aed5bcb1ff0193f1fc947c036a7c2ad0d3f771`), reached `live` at
  `2026-07-09T09:06:11Z`.
- `post-deploy-healthz.json` — `GET /healthz` build == `97aed5b` (matches the
  merge SHA short form).
- `post-deploy-env-spotcheck.txt` — env quad confirmed intact on
  `cee-staging`:
  - `CEE_GRAPH_MANAGEMENT_MODE=live`
  - `CEE_ANSWER_TEXT_REQUIRED=true`
  - `CEE_MODEL_ORCHESTRATOR=claude-sonnet-5`
  - `CEE_DECISION_REVIEW_ENABLED=true`

## Files in this evidence pack

- `README.md` — this file
- `typecheck-src.txt`
- `forbidden-boundary-patterns.txt`
- `new-test-green.txt`
- `test-required-summary.txt`
- `validate-prepush.txt`
- `pr-398-ci-checks.txt`
- `post-deploy-healthz.json`
- `post-deploy-env-spotcheck.txt`

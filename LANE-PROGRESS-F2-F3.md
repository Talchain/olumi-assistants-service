# Lane: F2 (comparison-pair ordering) + F3 (leader identity = option id)

Clone: /private/tmp/cee-lane-F2F3-ordering-labelid/cee
Base: staging @ d388c12084e027ec1befc99ce2025e545c529070
Branch: fix/f2-comparison-pair-ordering-f3-leader-option-id

## Read-only survey (done)

- `selectTwoNewestRunAnalysisFacts` (compare-runs.ts:74-80) — `successful[0]/[1]` by ARRAY POSITION.
- `selectNewestRunAnalysisFact` (freshness.ts:364-407) — stable sort by `computed_at` desc, nulls last.
  Candidate set with `requireSuccessfulStatus:true` is EXACTLY
  `priorFacts.filter(isSuccessfulRunAnalysisFact)` — same filter, different ORDER. Confirms F2.
- THIRD copy found: `coaching-signals.ts:buildRerunDelta` picks the prior with
  `priorFacts.find(isSuccessfulRunAnalysisFact)` — insertion order again.
- `compareRuns` identity = `normaliseLabel(prior.winner.option_label) !== normaliseLabel(current...)`.
  `AnalysisResponseSummary.winner.option_id` exists but `compactAnalysis` FALLS BACK
  `option_id <- option_label` when the raw record has no `option_id` — so a naive id compare
  silently degrades to a label compare on legacy enrichment. Genuineness must be derived from
  the RAW enrichment via the same `winnerOptionResultSource` reader compact uses.

## Status log

- [x] clone + branch + install
- [x] RED-first proven at HEAD: 5 failing (3 × F2 pair-ordering in compare-runs.test.ts,
      2 × F3 rename/legacy in run-comparison-gate.test.ts), 47 passing incl. the
      F3 true-positive control.
- [x] F2 fix: `orderRunAnalysisFacts` extracted in freshness.ts; exported
      `orderSuccessfulRunAnalysisFactsNewestFirst`; `selectNewestRunAnalysisFact` = its head;
      inline status filter replaced by a CALL to `isSuccessfulRunAnalysisFact`.
      compare-runs `selectTwoNewestRunAnalysisFacts` + `deriveRerunReadiness` now consume it.
      coaching-signals `buildRerunDelta` prior now = `selectRunAnalysisFact`.
- [x] F3 fix: `projectRunFact` returns `RunProjection { summary, leader_option_id }`;
      identity read off the RAW enrichment via `winnerOptionResultSource`;
      `compareRuns` compares ids exactly; `leader_identity_basis` added to RunDelta.
- [x] `pnpm typecheck` GREEN
- [x] compare-runs + run-comparison-gate + coaching-signals suites GREEN (79 + 23)
- [x] Full suite GREEN locally (21,979 passed / 0 failed), lint clean
- [x] 7 mutants, all bite (throwaway worktree OUTSIDE repo root, removed before gate runs)
- [x] Local integration flake REFUTED as ours: control full-suite run on pristine d388c120
      reproduced the identical 5 files with identical `Hook timed out in 10000ms`
- [x] PR #738 -> staging, head 866663ba7cc7a9bf75c0cbfb5d96f3b0ad03ce39, MERGEABLE, NOT merged
- [x] All 20 CI checks PASS incl. `Typecheck Drift (ratchet)`, `Full Test Suite`,
      `Integration Tests`

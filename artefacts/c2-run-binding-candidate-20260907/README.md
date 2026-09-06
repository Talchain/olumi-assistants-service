# C2 run-binding integration candidate — 2026-09-07

Status: CODE EXISTS / TESTED in an isolated composition. UNAPPLIED to shared product source; no PR, push, merge, deployment, wire witness or journey witness.

## Exact identity and bank

- Branch: `codex/c2-run-fact-identity-20260907`.
- Verified CEE staging base: `78aa1efa0c7ed29da343e9c2dc04d0178d8312df` (health build `78aa1ef`, status `ok: true`, version `1.12.0` when checked).
- Pure identity helper and original 39 tests: `ac60c326005725cd67a7435b9505d3179b586777`.
- Owned fixture typing correction: `41417988573d85a954c948b3aaa5b7df82c55e3f`. No helper behavior changed.
- Candidate patch applies above those commits; SHA-256: `aa08d22945de3507154153631a461eee99f925c200e6f4a4c9df56686846c98d`.
- Main worktree: `/private/tmp/olumi-c2-identity-UNYI83/cee`.
- Tested detached sibling: `/private/tmp/olumi-c2-identity-UNYI83/composition`, based on helper commit, with the identical fixture typing correction plus this patch.
- Local commits preserve the bank in the common Git object database. Temporary worktree paths are not the sole recovery mechanism.

## Exact shared-file handoff requested

Core must hand off these three existing product files before source application:

1. `src/orchestrator-v5/compose/analysis-state-v1.ts`
2. `src/orchestrator-v5/response-finaliser.ts`
3. `src/routes/scenario-graph-analysis-read.ts`

The patch also includes two new owned C2 tests:

- `src/orchestrator-v5/__tests__/c2-analysis-interpretation-composition.test.ts`
- `src/routes/__tests__/c2-analysis-interpretation-restore.test.ts`

And one additive existing test inventory update:

- `src/orchestrator-v5/compose/__tests__/leader-claim-not-evaluated.test.ts`

The open-PR scans found no overlapping owner on the three product files (45 PRs inspected) or the inventory test (46 PRs inspected). That observation is not a handoff and can drift. Parent has the Core handoff request at programme-docs PR 38 comment 5562649428. No late-created C2 app task was visible in the task list inspected; its earlier creation remains unconfirmed. No duplicate task was created.

## Actual reached call chain and API

The existing run producer writes `scenario_id`, `graph_hash_at_run` and `computed_at` into `run_analysis.result`. The graph token is the established analysis-affecting 16-lowercase-hex projection; time is the producer's `Date.toISOString()` token. The helper reads those tokens unchanged. It rejects arbitrary full/short aliasing, legacy representations and missing identity as unconfirmed; it neither converts hashes nor manufactures time.

The helper APIs are `validateAnalysisRunFactIdentity`, `compareAnalysisRunFactIdentity`, and `compareAnalysisInterpretationBinding`. The last accepts caller-supplied supported contract/policy pairs, with no product versions invented. A tuple match never proves execution uniqueness, request idempotency, payload equality, durable persistence, permission or currentness.

This patch consumes `compareAnalysisRunFactIdentity` in the EXISTING `composeAnalysisStateV1` through optional `runFactBinding: { scenarioId, selectedResult }`. It compares the original selected fact to request scenario plus the canonical historical hash/time that supplies the emitted run state. It does not compare history to the current graph.

- Fresh run/rerun: `TurnExecutor` already passes `priorFacts: unifiedFactsAtExit` when a successful run completed on that turn (base line 14374). `sendFinalised200` already carries scenario scope into its finaliser context. `attachAnalysisState` can therefore pass selected fact binding without route or executor edits.
- Reload/restore: `readScenarioAnalysis` already loads scenario-scoped persisted facts. The patch separates historical selection from whether current freshness permits displaying a result, then passes the same binding input to the composer.
- Cross-input check: selected facts must match the canonical tuple actually emitted, even if a separately supplied freshness derivation refers to a different rerun. An explicit empty fact list cannot silently bypass binding when canonical state references a selected fact.
- `projectAnalysisBlocksForRunBinding` consumes the composer's reason. A conflicting fact cannot supply the result block; unconfirmed legacy identity retains available figures with designation withheld through existing projections. The finaliser also suppresses comparative `run_delta` after failed binding, with a firing valid-pair positive control.
- Known refused, blocked and running lifecycle arms retain precedence. Unknown identity is not never-run. Changing the current graph does not mutate historical fact tokens.

## Validation

The seven exact suites passed: 166/166 tests, exit 0, Vitest 4.1.10, duration 72.00 seconds, start 01:02:37 in the runner display. This is the final run AFTER test-fixture typing corrections. The two new C2 test files contain 23 cases; the helper file contains 39 cases.

```sh
node node_modules/vitest/vitest.mjs run src/orchestrator-v5/context/__tests__/analysis-interpretation-identity.test.ts src/orchestrator-v5/__tests__/c2-analysis-interpretation-composition.test.ts src/routes/__tests__/c2-analysis-interpretation-restore.test.ts src/orchestrator-v5/__tests__/analysis-state-emit.test.ts src/orchestrator-v5/__tests__/analysis-state-running-arm.test.ts src/orchestrator-v5/compose/__tests__/leader-claim-not-evaluated.test.ts src/routes/__tests__/scenario-analysis-restore-chronology.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```

The new tests use actual strict `RunAnalysisHandlerFactSchema`, `OlumiResponseSchema` and `AnalysisStateV1Schema`, real freshness, block builder, composer, finaliser and scenario reader. Only the restore store and log are mocked. Synthetic figures are fixtures, not measured product outcomes. No provider calls or browser claims.

- Final scoped ESLint including all new/changed test files: exit 0.
- `git diff --check`: exit 0.
- `git apply --check artefacts/c2-run-binding-candidate-20260907/candidate.patch` on the main helper branch: exit 0; the patch remains unapplied.
- Final scoped compiler including all new/changed source and tests: exit 0, no diagnostics.
- The first scoped compiler correctly caught invalid test fixtures and broad union access, which were fixed rather than suppressed. The config explicitly includes the existing ambient `compromise-numbers.d.ts`, as the production config does.
- The full production compiler passed before the last cross-input change. That earlier pass is not relabelled as a final full-project check.
- The normal ignored OpenAPI output was generated in the sibling via the installed `openapi-typescript` CLI module. Dependencies were reused read-only; no install occurred.

`scoped-tsconfig.json` is the exact scoped config; put it at the composition root as `.c2-tsconfig.json` and run `node node_modules/typescript/bin/tsc -p .c2-tsconfig.json --pretty false`. It includes all three changed production files, both new integration tests, the changed inventory test, the helper and helper test, and their imported dependencies.

## Evidence limits and remaining integration decision

This is the genuinely reached run-binding increment of candidate A, NOT completion of candidate A or C2.

1. Core must accept the exact three-file handoff and inventory-test update, then independent review/revalidation on the chosen integration head must precede application.
2. Ordinary conversational exits currently omit `priorFacts` because that field is gated for completed-run deltas. Those unadopted exits intentionally retain existing behavior and gain NO C2 binding guarantee. Widening adoption needs an explicit caller-context decision; do not simply remove the delta gate.
3. The conditional interpretation policy remains unconsumed. Current strict `AnalysisStateV1` and `RunAnalysisResult` contracts have no versioned interpretation/persistence slot. This patch does not invent one or hide a CEE record inside byte-for-byte engine enrichment. A canonical contract/producer-write/restore decision remains necessary for actual historical interpretation persistence and version matching.
4. Analysis blocks and run delta are confined here. Arbitrary assistant prose, coaching, chips, UI adapters and other claim consumers are not all governed by this increment. The existing policy/claim gates remain authorities. Do not ship this patch alone as cross-surface claim-safety closure.
5. No request idempotency, payload collision resolution, DB durability, new admission policy, measured UX result, deployed behavior or native fresh/rerun/reload journey is proven by these focused tests.

Minimal persisted producer evidence already pinned in the helper test: programme-docs commit `a831f631174dd515c052ed4f9aea249f2b2719f2`, wire-variant persisted-facts capture SHA-256 `70496dd01907a10f84a723c590738d453dc17d54bc65eb43c3a38d3e3c073f17`, scenario `5fca0326-e5aa-43ad-9fe3-a1772ab689e2`, graph token `06bbc717bbf85867`, distinct times `2026-09-06T17:50:03.871Z` and `2026-09-06T17:50:11.035Z`. Only that minimal projection is retained, not the private transcript.

# C2 CI repair — 7 September 2026

Repair of exact PR #1373 head `89bed009d1bcfe790b73357b78bbd1fe113bbda8`, committed as `6af9794cd217c69c7ccb5fe5530abcd93b055fd6`. No composer, finaliser, reader, executor, schema, UI or claim-policy behavior was weakened.

## Actual CI failures

Read [CI run 34070990613](https://github.com/Talchain/olumi-assistants-service/actions/runs/34070990613), exact head above:

- Required job `101588166159`: lint and build/typecheck passed; the forbidden-boundary-pattern gate failed at 60 double-casts versus baseline 58. Both new occurrences were in `analysis-interpretation-identity.ts`. The downstream required test subset was SKIPPED, not green.
- Full-suite advisory job `101588166118`: exactly two failing tests, 37,932 passed, 262 skipped and 12 todo. Failures were the stale scenario-read fixture and the positive run-delta threading fixture.
- Integration advisory job `101588166142`: the same run-delta threading test was its sole failure; 1,718 passed and 168 skipped. This log was retrieved successfully after one cancelled transport read.
- A separate Security Audit job was also red in the run overview; it was not diagnosed or changed by this bounded repair.

These are CI receipts, not a local full-suite run. The prior 209 focused passes never licensed CI clearance.

## Attribution and precise repair

Executed the two failing suites unchanged at clean base `243287ed5865c42f780f2e9267569a9f46f65e4d`: **12/12 passed**. Executed the same suites at C2 head `89bed009`: **2 failed / 10 passed**, reproducing both CI failures. Thus they are introduced compatibility failures, not attributed to a pre-existing base red.

1. **Helper gate:** validate each token into its own narrowed string before constructing the identity or policy. Removed both double-casts; no exemption, baseline increase, accepted-format change, conversion or changed error reason. The 39 identity/policy controls remain green.
2. **Stale result fixture:** replace the opaque `hash_from_a_graph_since_edited` marker with a hash computed by the real producer over the same graph before a factor-value edit. Explicitly assert that old/current hashes differ. Preserve the original `complete_stale` and no-result assertions. A separate negative case retains the old opaque marker and now pins unknown identity rather than treating it as a supported historical token.
3. **Run-delta threading fixture:** replace `HASH_A/HASH_B` with two hashes from the real projection over different factor values. Add the real freshness derivation over the same two-fact array to the mocked executor return. Preserve all positive delivery, leader movement, per-option signal, provenance and absence-twin assertions. Add missing-context and wrong-scenario negative wire controls; both must emit unknown/conflict and no delta. The positive case additionally pins current run state and the actual selected timestamp.

The fixture carriage is grounded in existing production source, NOT invented canonical context:

- `TurnExecutor` binds `unifiedFactsAtExit = unifiedFactsForPostHandler` and derives freshness over that same array (at this head, lines 11198–11200).
- The completed-run return includes `freshness` (line 14417) and the existing successful-current-run gate supplies `priorFacts`.
- `route-v2.ts` forwards `run.priorFacts` (6942), `run.freshness` (6949), and independent ingress scenario (6951) into finalisation.
- No `canonicalState` object was added to the test double; the existing finaliser derives its supported fallback from supplied freshness.

Read-only ownership check before editing: neither fixture file appears in live #1371 at `1e0e47cfe88decc48eeb15ae52fa99e8c38469fb` or #1372 at `efd288ae7dcda0e9b36b4cf508d69430afb12f59`. Parent approved this precise semantic fixture migration.

## Final verification

- **224/224 tests passed across 10 focused suites**, exit 0; Vitest 4.1.10; runner start 03:48:58; duration 7.41 seconds.
- Scoped compiler INCLUDING both migrated fixtures and every prior changed C2 source/test: exit 0, no diagnostics. Exact config retained as `ci-repair-tsconfig.json`; used from repository root as `.c2-tsconfig.json`.
- Scoped ESLint on the three repaired source/test files: exit 0.
- `git diff --check`: exit 0.
- The actual `bash scripts/check-forbidden-boundary-patterns.sh` now passes with the baseline UNCHANGED:
  - `warnOnInvalid`: 0
  - `as unknown as`: 58
  - science-field constant fallbacks: 10

Final focused command:

```sh
node node_modules/vitest/vitest.mjs run src/orchestrator-v5/context/__tests__/analysis-interpretation-identity.test.ts src/orchestrator-v5/__tests__/c2-analysis-interpretation-composition.test.ts src/routes/__tests__/c2-analysis-interpretation-restore.test.ts src/orchestrator-v5/__tests__/analysis-state-emit.test.ts src/orchestrator-v5/__tests__/analysis-state-running-arm.test.ts src/orchestrator-v5/compose/__tests__/leader-claim-not-evaluated.test.ts src/routes/__tests__/scenario-analysis-restore-chronology.test.ts src/orchestrator-v5/__tests__/response-finaliser.test.ts src/routes/__tests__/assist.v1.scenario-graph.analysis-read.test.ts tests/integration/orchestrator/route-v2-run-delta-threading.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```

## Remaining limits

Remote CI on the repair head still needs its own result. No full local estate test, provider/browser call, product merge or deployment was performed. During this repair #1371 was confirmed merged at 01:41:26Z as `6ec2163fd78f005bf18387cdbc7a81ee85b88abe`; #1372 remains open. The old proposed dependency order is historical, not the remaining sequence. Actual local validation base remains `243287ed`; this repair has NOT incorporated or tested `6ec2163f`. Core determines the next order, and merge-forward must preserve `6ec2163f` plus any Core follow-up repair. #1371's independently reproduced refusal/provisional blocker is NOT closed by C2's unchanged no-fact-context compatibility path. Conditional policy consumption, historical versioned persistence and broader consumer adoption remain the boundaries documented in IMPLEMENTATION.md.

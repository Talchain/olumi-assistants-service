# C2 known-scenario conflict repair — 7 September 2026

Repairs the independently reproduced blocker at PR #1373 head `2a092e23dc7a5d98474239bc8b5452ffa409b81d`. Actual local integration base remains `243287ed5865c42f780f2e9267569a9f46f65e4d`; this change does not merge newer staging or repair #1371.

## Finding and discriminator

Read the independent test and result at `/private/tmp/olumi-c2-independent.7t6rXN/`: actual strict-schema scenario read retained foreign 65%/35% figures when the fact had a known different scenario but an unsupported timestamp. Its same-scenario legacy positive and foreign canonical negative passed; the foreign legacy crossed control failed (2 pass / 1 fail).

Cause: `compareAnalysisRunFactIdentity` returned unconfirmed from whole-tuple validation before checking independently known scenario IDs. The existing unconfirmed projection retains useful legacy figures, so a definite wrong-scenario conflict was incorrectly treated like merely incomplete same-scenario identity.

Added tests to the existing owned helper, finaliser/composition and restore suites BEFORE the source fix. Actual red receipt: **7 failed / 65 passed, 72 cases, 3 files**, exit 1. The failures were four helper crosses, two finaliser crosses and one restore cross. Existing same-scenario legacy controls and unknown/invalid-scope controls remained positive.

## Minimal source repair

Only `src/orchestrator-v5/context/analysis-interpretation-identity.ts` changes production behavior: two scenario fields are first checked against the EXISTING exact nonempty string rule. When both are valid and different, return the existing `scenario_id_conflict` mismatch before validating the rest of the tuple.

This establishes only a known scope conflict. It does not confirm or normalise an unsupported timestamp/hash, accept a new representation, invent scenario identity, or broaden a claim permission. Missing/invalid scenario identifiers remain unconfirmed. Same-scenario legacy output follows the unchanged unconfirmed projection. Existing composer/finaliser/reader consumers already remove the result for the mismatch result; no source changes there were needed.

## Crossed coverage

- Foreign scope plus unsupported timestamp, missing timestamp, unsupported full hash, or missing hash: scenario mismatch in BOTH comparison directions, while full identity validation remains unconfirmed.
- The same incomplete/unsupported tuples in the same scenario: still unconfirmed.
- Missing, whitespace-padded and non-string scenario identifiers: no guessed conflict.
- Actual finaliser: foreign scenario with canonical, unsupported or missing timestamp yields the conflict reason and no result block.
- Actual persisted reader with strict schemas: foreign canonical AND foreign legacy timestamp omit the result.
- Same-scenario legacy reader: retains both 65% and 35% figures with no leader designation.

## Exact verification receipt

Final source tree, before documentation-only banking:

- **234/234 tests passed, 10 focused files**, exit 0, Vitest 4.1.10; runner start 04:08:47; duration 9.34 seconds.
- Scoped TypeScript compiler including all modified C2 source/tests and the two prior CI-migrated fixtures: exit 0, no diagnostics. Config is unchanged from `ci-repair-tsconfig.json`, temporarily used as root `.c2-tsconfig.json`.
- ESLint over the helper and all three modified tests: exit 0.
- `git diff --check`: exit 0.
- Actual forbidden-boundary gate: exit 0, unchanged counts 0 / 58 / 10.

Command:

```sh
node node_modules/vitest/vitest.mjs run src/orchestrator-v5/context/__tests__/analysis-interpretation-identity.test.ts src/orchestrator-v5/__tests__/c2-analysis-interpretation-composition.test.ts src/routes/__tests__/c2-analysis-interpretation-restore.test.ts src/orchestrator-v5/__tests__/analysis-state-emit.test.ts src/orchestrator-v5/__tests__/analysis-state-running-arm.test.ts src/orchestrator-v5/compose/__tests__/leader-claim-not-evaluated.test.ts src/routes/__tests__/scenario-analysis-restore-chronology.test.ts src/orchestrator-v5/__tests__/response-finaliser.test.ts src/routes/__tests__/assist.v1.scenario-graph.analysis-read.test.ts tests/integration/orchestrator/route-v2-run-delta-threading.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```

No full local estate suite, live provider, browser, schema/UI/executor edit, product merge or deployment. No independent re-review clearance claimed by the author. New-head CI still needs its own outcome; the prior run `34074392893` at `2a092e23` had not completed when checked during repair. Core must still merge-forward current staging and its #1371 follow-up for a composed validation; #1372 was independently confirmed still open during this repair.

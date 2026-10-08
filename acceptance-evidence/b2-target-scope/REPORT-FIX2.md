# #2860 FIX-2 — class 3 implemented; staging merge blocked

## Status and identity

The class-3 source change, positive row, linear control and killed mutant are complete on the current **unmerged** working tree. The required staging merge, conflict resolution, staging of the merge, and post-merge #2858 checks remain blocked. This is not a completed FIX-2 integration.

- Worktree: `/private/tmp/accel-er-b2scope-cee`; branch asserted: `dl/b2-per-option-target-withhold`.
- HEAD asserted before the merge attempt: `eaf73f7424bd2f886700d4d6c96d841adc04f049`; it remains unchanged.
- Existing `origin/staging` asserted: `178cc5bf045cf3e13281359c56c14cfd0845e73b` (#2858).
- No commit, push, object import, or `supabase/` change. No isolated replacement Git repository was created.
- Evidence is local source and in-process producer tests, on the current unmerged tree.

## Merge blocker

Ran the requested `git merge --no-commit origin/staging` after asserting HEAD, branch and staging ref. It exited **128** before starting the merge:

```text
fatal: update_ref failed for ref 'ORIG_HEAD': cannot lock ref 'ORIG_HEAD': Unable to create '/Users/paulslee/olumi-work/d2-cee/.git/worktrees/accel-er-b2scope-cee/ORIG_HEAD.lock': Operation not permitted
```

The worktree's `.git` points to that metadata directory, outside the permitted writable roots. `MERGE_HEAD` is absent; no merge index or conflict markers exist. An asynchronous request was sent for the lane to perform these Git operations outside this sandbox; no response had arrived at report time.

Staging the two source files and this report with `git add` also exited **128**: `Unable to create '/Users/paulslee/olumi-work/d2-cee/.git/worktrees/accel-er-b2scope-cee/index.lock': Operation not permitted`. The changes remain unstaged.

The staging commit/tree is present, but **15 of #2858's 17 changed file blobs are absent**, including all five new test files and `accumulation-identity.ts`. The ordinary requested diff attempted Git's automatic promisor fetch and failed DNS for `github.com`. Disabling rename detection allowed the filename census without loading missing blobs:

```sh
GIT_NO_LAZY_FETCH=1 git -c diff.renames=false diff --name-only eaf73f74 origin/staging
```

Full filename evidence: [FIX2-staging-diff-files.txt](FIX2-staging-diff-files.txt), [FIX2-staging-added-files.txt](FIX2-staging-added-files.txt). The exact #2858 file/blob audit is [FIX2-2858-files.txt](FIX2-2858-files.txt), [FIX2-staging-blob-audit.json](FIX2-staging-blob-audit.json). No objects were imported by hand.

## Science §(aa) implementation

> an accumulation operand (inflow/churn/level) → treat as 1.

In `src/orchestrator-v5/goal-target/target-testability-per-option.ts`, the existing class-1 carrier collection now accepts product **or accumulation** identities on the selected goal path. Product still uses `readProductIdentityCarrier`. Accumulation uses the existing `NodeV3.shape.nonlinear_identity` parser, taking its typed `factor_ids`; invalid carriers, sums and accumulation carriers on the goal are excluded. This is the same schema validation used by the existing definitional-link reader.

The same cached reachability and cross-operand predicate then apply to both carrier kinds. There is no second dependency walk and no label-based detection. Goal-global a/b/d failures and the self-attested class-2 baseline rule retain their existing code.

`b2-target-scope.test.ts` adds a derived accumulation on the goal path, with typed accumulation evaluation and user-stated operands. The unsized `u → churn_per_month` link feeds churn; X moves inflow; Y moves no identity operand. A third graph option activates P5's existing graph-wide link census but is absent from the X/Y scored comparison. Neutral labels prove labels do not establish the dependency.

The producer assertions pin:

- X's chance withheld, exact X-only TARGET scope and own churn-feed reason;
- Y's chance retained at `0.6`, with both options' shares unchanged;
- removing only the accumulation carrier/evaluation leaves the same graph and unsized link linear, preserving X/Y chances at `0.7`/`0.6` and creating no TARGET warning.

## RED, GREEN and mutant

| Run | Result |
| --- | --- |
| Before implementation, class-3 rows | Positive RED: X incorrectly remained shown; linear control passed. |
| After implementation, final class-3 rows | 2 passed. |
| Class 3 disabled, product/class 1 retained | Positive row RED again: received X/Y instead of Y; linear control passed. |

The mutant changes only accumulation admission in this dependency collection, then restores the original source byte-for-byte in `finally`. [FIX2-mutation-summary.json](FIX2-mutation-summary.json) records `killed: true`, `restored: true`, and the source SHA-256.

Logs: [FIX2-RED-class3.log](FIX2-RED-class3.log), [FIX2-GREEN-class3-final.log](FIX2-GREEN-class3-final.log), [FIX2-MUTANT-class3-off.log](FIX2-MUTANT-class3-off.log). The first implementation run exposed an expected-sentence unit mismatch (`% / month` versus the existing writer's `percentage points`); the fixture expectation was corrected to the established writer output. Its behavior assertions had already passed.

## Available requested checks

**77 tests across five files passed**, on the current unmerged source:

| Batch | Files | Tests |
| --- | --- | --- |
| `FIX2-unmerged-core` | `b2-target-scope`, `s-e-goals-s6` | 29 |
| `FIX2-unmerged-handlers` | `run-analysis-target-not-testable`, `run-analysis-horizon-untested` | 26 |
| `FIX2-unmerged-schema` | `tests/unit/schemas/accumulation-carrier.test.ts` | 22 |

Before **every** test invocation, [run-checks-fix2.py](run-checks-fix2.py) checks the actual exit code of a load gate (`os.loadavg()[0] < 25`). A nonzero gate exit prevents the test process. Every invocation used at most two files, `--maxWorkers=1 --no-file-parallelism --configLoader=runner`, and `< /dev/null`. Exact commands, gate exits and test exits: [checks-fix2.jsonl](checks-fix2.jsonl).

- Full `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit`: exit **2**, **290 diagnostics outside changed files; zero in changed files**. The repository-wide typecheck is not clean. [Log](FIX2-unmerged-tsc-full.log), [summary and checked path set](FIX2-unmerged-tsc-summary.json).
- Full `node_modules/.bin/eslint .`: exit **0**, zero errors and two warnings in unchanged `trace-captures.ts` and `analysable-option-gate.ts`. [Log](FIX2-unmerged-eslint-full.log).
- ESLint on both modified TypeScript files: exit **0**, zero errors/warnings. [Log](FIX2-unmerged-eslint-changed.log).
- `git diff --check`: passed. HEAD/branch, source hashes, absence of `MERGE_HEAD`, and no `supabase/` changes: [FIX2-final-tree.json](FIX2-final-tree.json).

These checks do not substitute for the requested post-merge run.

## Required integration continuation

The lane must make the linked Git metadata writable to its executor and let Git materialise the missing promised blobs normally. Then run the real `git merge --no-commit origin/staging` in this worktree, preserving these current source edits.

Resolve the two expected conflicts with both intents:

1. `identity-evaluations.ts`: retain the shared product-only `readProductIdentityCarrier`, `GOAL_LEVEL_FROM_IDENTITY_INPUTS` and self-attested `goalBaselineFromIdentityInputs`; retain staging's `classifyValueSource` import and `identityCanCarryExactLinks`, including its gates in **both** `evaluatedIdentityCarriers` and `exactIdentityOperandLinks`.
2. `admit-model.ts`: retain the import of that shared reader as `readCarrier`, retain `isAccumulationCarrier` and every staging accumulation admission change, and remove the duplicate local product reader staging reintroduces.

The five new #2858 test files identified from the requested diff are currently unavailable and **were not run**:

- `src/orchestrator-v5/admission/__tests__/accumulation-chance-credit.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/accumulation-identity-build.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/accumulation-product-reconciliation.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/zero-spread-certainty.test.ts`
- `tests/unit/agent-lane/accumulation-identity.test.ts`

Rerun all ten requested files, gated in batches of at most two, then the class-3 mutant, full typecheck and ESLint on the merged source. Resolve/stage the real merge and leave it uncommitted for the lane. Update this report with the merged-tree evidence; the merge and its staging have not been completed in this sandbox.

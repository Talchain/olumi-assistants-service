## Draft: C2 scenario/run binding increment

**CI repair update:** the initial head's required boundary-pattern gate and two fixture compatibility tests failed. The repair removes the helper's two double-casts without weakening validation, migrates only producer-faithful test hashes/freshness, and adds negative identity controls. Local verification is now 224/224 focused tests plus the unchanged boundary gate, scoped compiler and lint. Remote CI still needs its own result; the original 209 passes below were not CI clearance. See [the diagnosis and repair receipt](https://github.com/Talchain/olumi-assistants-service/blob/codex/c2-run-fact-identity-20260907/artefacts/c2-run-binding-candidate-20260907/CI-REPAIR.md).

**Current integration hold:** #1371 merged at 01:41:26Z as `6ec2163fd78f005bf18387cdbc7a81ee85b88abe`; #1372 is still open. The former proposed #1372 → #1371 order is no longer a future sequence. Core remains the sole product integrator and determines the remaining order. This candidate is verified on staging `243287ed5865c42f780f2e9267569a9f46f65e4d` (local merge `9ba0d53557db4ab37a9e706be741bff5645b04a0`), not on `6ec2163f`. Its next integration must merge forward, preserving `6ec2163f` and any Core follow-up repair; no rebase.

Core granted exclusive source ownership in CCC-PRIMARY-058, programme docs `5a623edd`, 7 September 00:38Z. The previously banked integration is now applied as product source, not merely a helper or patch proposal.

## What changes

- The existing `composeAnalysisStateV1` consumes the pure identity helper through optional `runFactBinding: { scenarioId, selectedResult }`.
- It compares original selected fact identity with independent request scenario and the canonical historical hash/time that supplies the emitted run state. A changed current graph never rewrites historical identity.
- The existing finaliser supplies already-loaded fact context on completed-run exits. The existing persisted scenario reader supplies historical fact context on reload/restore.
- Conflicting identity cannot supply the result block. Unconfirmed legacy identity retains available figures but not a leader designation, using existing withheld projections. An unbound result cannot append a comparative run delta.
- Refused, blocked and running lifecycle precedence remains intact. Unknown identity is not evidence that no run exists. Readiness and execution permission remain separate.
- No invented run ID, hash conversion, clock stamp, supported policy version, admission policy, provider call or persistence record.

## Source scope

Three existing product files:

- `src/orchestrator-v5/compose/analysis-state-v1.ts`
- `src/orchestrator-v5/response-finaliser.ts`
- `src/routes/scenario-graph-analysis-read.ts`

Plus the new pure identity helper, its focused tests, two new C2 integration test files, and the additive existing leader-reason inventory test update. No authored edits to `turn-executor.ts`, either Core PR, routes outside the owned reader, telemetry, shared schemas or UI. Staging's landed changes are inherited by merge-forward, not authored here.

The earlier candidate patch and receipts remain as historical local-bank artifacts. This file supersedes their unapplied status.

## Original applied-source verification (before CI repair)

**209/209 tests passed across eight focused suites**, Vitest 4.1.10, exit 0, duration 5.42 seconds; runner start 02:45:28. No full-suite claim.

```sh
node node_modules/vitest/vitest.mjs run src/orchestrator-v5/context/__tests__/analysis-interpretation-identity.test.ts src/orchestrator-v5/__tests__/c2-analysis-interpretation-composition.test.ts src/routes/__tests__/c2-analysis-interpretation-restore.test.ts src/orchestrator-v5/__tests__/analysis-state-emit.test.ts src/orchestrator-v5/__tests__/analysis-state-running-arm.test.ts src/orchestrator-v5/compose/__tests__/leader-claim-not-evaluated.test.ts src/routes/__tests__/scenario-analysis-restore-chronology.test.ts src/orchestrator-v5/__tests__/response-finaliser.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```

Scoped TypeScript check: exit 0, no diagnostics. It includes all changed production files, both new integration tests, the changed inventory test, helper and helper test, plus the existing ambient declaration. Exact config is retained in `artefacts/c2-run-binding-candidate-20260907/scoped-tsconfig.json`; it was copied to the repository root as `.c2-tsconfig.json` for `node node_modules/typescript/bin/tsc -p .c2-tsconfig.json --pretty false`.

Scoped ESLint: exit 0. `git diff --check`: exit 0. Dependencies were reused read-only and normal ignored OpenAPI types generated; no install.

The tests exercise actual strict run-fact/response/state schemas, real composer/finaliser/freshness and persisted-reader logic. Restore tests mock only storage and logging. The 23 new integration cases cover valid fresh results, same-graph reruns, repeated reload, changed-model history, restore chronology, wrong scenario, missing/unsupported identity, conflicting independently supplied canonical inputs, explicit empty facts, genuine run-delta positive control and lifecycle precedence. Fixtures are synthetic except the minimal persisted identity projection already documented in the 39-case helper suite.

## #1371 compatibility and remaining boundaries

Read #1371 at `94906477e6f04ac8928a790fccc9296813118553`, including its source-fact co-selection and FRESH-only grounding block. Its payload-scoped robustness reader remains untouched: C2 does not replace missing payload evidence with hidden fact evidence.

**This head is not a composed test of landed #1371, its needed refusal/provisional follow-up, or open #1372.** Merge current staging and Core's eventual repair forward, in Core's chosen remaining integration order, then rerun affected focused checks with C2 before requesting release clearance. The independently reproduced #1371 leader leak remains open; C2's no-fact-context compatibility path does not close it.

1. #1371's ordinary prose branches still omit `priorFacts` under the existing completed-run delta gate. Their newly grounded blocks therefore remain outside this C2 binding adoption. Do not remove that gate or join `promptAnalysisSourceFact` to a canonical state selected from another array/rerun. Widening adoption needs an explicit same-source caller-context change.
2. Conditional interpretation policy is still unconsumed. The strict current run-result/state contracts have no versioned interpretation/persistence slot. This increment does not create one or hide a CEE record inside engine enrichment. Historical interpretation persistence requires a canonical contract → producer write → restore decision.
3. The helper's policy-comparison API has no invented supported versions, and no production caller of that versioned comparison is claimed here.
4. Arbitrary assistant prose, coaching, chips and UI adapters are not all governed by this increment. Existing claim/admission authorities remain separate; useful provisional information is preserved.
5. Tuple equality does not establish execution uniqueness, request idempotency, payload conflict resolution or database durability.

**CODE EXISTS / FOCUSED TESTED / DRAFT REVIEW CANDIDATE. Not deployed, wire-witnessed, journey-witnessed, or C2 feature closure.** No live provider/browser call, product merge or deployment was performed.

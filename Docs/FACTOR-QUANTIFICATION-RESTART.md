# Factor Quantification — restart handoff, 30 August 2026

Resumed after the user's machine restart. Implementation is authorised in Default mode. Resume the bounded implementation, not discovery or planning. No merge, publication, deployment, feature enablement or release clearance has been performed.

## Recover the work

- CEE repository: `https://github.com/Talchain/olumi-assistants-service.git`; branch `codex/factor-quantification-20260830`; draft PR https://github.com/Talchain/olumi-assistants-service/pull/1235 . Existing checkout `/Users/paulslee/CodexWork/factor-quantification/cee`. Use the pushed branch HEAD; `/private/tmp` may not survive restart.
- Shared repository: `https://github.com/Talchain/olumi-schemas.git`; same branch name; exact factor contract HEAD `51dca7aa03efaef9160c8a9f806b804b7f8a68fd`; draft PR https://github.com/Talchain/olumi-schemas/pull/54 stacked on Science objective PR #53. Existing checkout `/Users/paulslee/Documents/GitHub/factor-quantification-work/schemas`.
- The actual unpublished `0.53.0` package is committed at `vendor/talchain-schemas-0.53.0.tgz` in CEE, SHA256 `a532fb3ce386be8610bb56d4e4efee77fe39f75da7269a774c1d97009997eea1`. Shared source includes objective authority plus factor selection/unknown/rationale/scale/hash v3; do not revert to a main-only older package.
- Node 22 and pnpm 10 were used. CEE has isolated local dependencies. Reinstall from the committed lock if recreating a checkout; do not modify another lane's package pin. `.npmrc` token warnings occurred locally without preventing existing cached dependency use.
- All durable evidence is under `Docs/evidence/factor-quantification/`; no credentials or env files are committed. `Docs/factor-quantification-handoff.md` explains production contracts, replay commands and limitations.

## Resumed correction — supersedes the pause next-step wording below

The unchanged v2 corpus executed at clean `86246ce438a55c1e2a5838353ed68f896c5dea8f`; raw results and independent review are banked under `Docs/evidence/factor-quantification/live-sonnet-v2/`. Mechanical checks passed, but the rich estimate incorrectly claimed no transfer assumption was needed to attach daily variation to today's exact count. **Zero of its one numeric estimates earned semantic support.** Two other gaps correctly remained unknown. Remaining fallback and changed protected values were zero; neither proves a defensible numeric estimate.

V3 tightens only the estimator-specific time/population/quantity rule. The original rich brief is unchanged and now requires unknown for the stochastic representation; its arithmetic is still known. A separate records planning-day fixture explicitly supplies historical daily mean, matching daily spread and provisional reuse of the same process. The deterministic dispatch positive uses that fixture, not the ambiguous original. Both historical raw runs remain unchanged. V3 live verification is next; do not claim it from deterministic controls.

The working CEE clone moved outside the GitHub ancestor directory to `/Users/paulslee/CodexWork/factor-quantification/cee`; the prior durable path is a compatibility symlink. Parent cloud-backed fallback declarations caused the original `pnpm typecheck` to stall. The same frozen local dependencies and actual `pnpm typecheck` gate completed successfully outside that ancestor tree, without package, lock or compiler-setting changes. The original stalled run is not a pass.

Science's saved checkpoint still has no consumption-ready `.53` successor. Its PLoT/ISL/CEE hash ownership is unchanged. No rival downstream implementation or feature enablement was started.

## Exact state at pause — historical, retained for continuity

The bounded estimator, strict parser, canonical adoption, fallback typing, shared selection, readiness and actual draft-dispatch connection are implemented. Feature `CEE_FACTOR_QUANTIFICATION_ENABLED` defaults **off**. Core production was banked as `54dd156682f12da4792d688a3e05e02d0096d39c`; the live v1 witness used clean `8deefc63f79c6e1afa93da2387e752824a30cf6c`. The Science objective snapshot hook was carried as `d6a7b1875`, and its owner's exact test-only fixture dependency as `cb636b0e1`.

The five live v1 structural checks passed using real Sonnet adapter/parser/adoption and real `commitDirectAnswer` with an injected atomic local-file store plus fresh readback. Three gaps produced two numeric estimates and one unknown, no fallback or protected writes. **Independent semantic review then rejected the figure-poor `.35/std .15`: qualitative anchors do not supply an interior score or dispersion. The historical 66.7% adoption rate is NOT a defensible-resolution rate.** Preserve the raw outputs and `live-sonnet-banked/semantic-review.json`.

The estimator-specific **v2 prompt correction is now written**: separate quantitative support for value and spread; no numeric spread from qualitative anchors, edge stds or confidence language; observed variability is not measurement error. The unchanged figure-poor brief now **must return unknown**. A control using the exact bad v1 response fails semantically, while unknown passes. The v2 prompt has **not yet had a live model rerun** at this pause. That is the immediate next step, not an already-proven improvement.

The rich `.75` derives from 15/20; `.05` is explicitly supplied daily variation. Its rationale must preserve the distinction between daily variability and uncertainty in today's exact count, and disclose any provisional planning-centre assumption. The insufficient-information case correctly remained numeric-free unknown.

## Resume sequence

1. Verify both pushed branch heads and clean worktrees. Read the v1 semantic review and current v2 prompt/mandatory-unknown control.
2. Run the focused FQ controls and `node --import tsx scripts/semantic-contract/factor-quantification-fixtures.ts --check` (nine exact shared consumer fixtures).
3. Rerun the bounded five-case live estimator corpus on the current supported model using `scripts/semantic-contract/factor-quantification-live.ts --live --out <new-directory>`. Supply credentials only in process environment, never files/commits/output. The runner refuses Supabase credentials. Prior live testing used the current staging-supported `claude-sonnet-5`; the key was passed ephemerally from existing authorised configuration. Do not read the cloud-placeholder `.env` file (it hangs), dump environment values, or persist secrets.
4. Independently inspect the returned quantities and uncertainty against each exact brief. Do not treat parser success or plausible rationale as factual evidence. If poor-case numeric precision persists, it remains a producer failure; do not weaken its unknown control or count it resolved. Bank the new prompt/request/model/head-bound outputs.
5. Hand the final exact CEE head/fixtures to Science for actual PLoT/ISL consumption. Science owns that code. The alternative-model comparison comes only after the canonical-to-Science path works; it remains deferred.
6. CC independently reviews/integrates. No feature exposure before Science and minimum UI truthfulness gates are met. The builder does not certify itself.

## Existing verification and its scope

- Shared final gate: 69 files / 2,396 tests, including 81 focused controls, plus discriminating metadata/unknown/hash/authority mutants.
- CEE v1 FQ and relevant transport/regression collection: 494 passing tests. The separate objective snapshot suite initially could not collect because its owner-supplied fixture was missing; after copying that exact fixture, all three cases passed. Logs preserve both facts.
- Source build typecheck and scoped production lint passed at `cb636b0e1` before the v2 prompt-only change.
- V2 mandatory-unknown corpus/runner control plus adoption suites: 60/60 passed before pause. Additional prompt/dispatch/stage controls collected 28/28 passing tests; the log is banked as validation/pause-v2-controls.log. No live v2 claim.
- Isolated source mutants at `8deef`: base GREEN; removed estimator output RED; dropped std RED; dropped provenance RED; unrelated wording GREEN. Each executed the exact rich dispatch target once; seven other tests skipped. Patches, reports and raw results are banked under `mutants/`.
- The live v1 witness is fixed records replay or authored control, real estimator, and local file persistence. It is NOT first-pass live generation, Supabase, deployed service, UI, or a completed scientific journey.

## Ownership and first boundaries

- **Science** task `01a0529d-050c-7743-aa58-cd0f9be4724f`: PLoT `graph-normaliser.ts`, `translator-v3.ts`, request/types; ISL ingestion/sampling/recommendation authority; CEE `run-analysis.ts` and private analysis hash. Do not second-write. Accepted final shared package and nine producer fixtures. Their consumer work is pending objective exit. Current executed PLoT `75e7f974` / ISL `28fe0c95` loses numeric-free unknown and prior qualifiers: unknown becomes zero; estimated/fallback priors become identical. Large std is clamped. Exact JSON probes are banked. `raw_count` with cap must not be silently normalised; FQ does not multiply raw values except explicit unit-interval conversion.
- **Graph Truth** task `01a0528d-a4dd-72d2-b1c3-f718416145d8`: accepted-edit handlers, d1 normalisation/scale frame, CQE. Hook draft #1232 at `d6fb5b11cdc82700b092c0100e86b0853ddc6fc1` is separate and NOT in the FQ branch. Its independent reviewer found fallback 12% + relative 5 points becoming authoritative user 17%; this is a caller-admission failure, not permission to expand the shared cleanup helper. That candidate is frozen pending review. Known absolute `.12/.24` controls and stale prior preservation remain required.
- **Prompt/Consumer** task `01a0528a-cd45-7c12-ad43-bf5f7264ffb1`: #1228/#1233 and framework registration. Has exact FQ exports/head pointer; no local mirrored schema. Claim-mediated percent unit/frame/source loss remains its separate red control; our direct-stated positive does not close it.
- **CCUX/UI** owns display/overlay. Current UI `e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe` can retain an omitted prior during full-receipt overlay/autosave and mislabel estimates/user edits. Graph Truth attached exact evidence to https://github.com/Talchain/olumi-programme-docs/issues/26#issuecomment-5469105242 . No FQ UI writes. Programme/System B routing task is `01a034fa-6098-7592-966e-61738b5cda28`.

**First unclosed boundary at pause:** v2 correction of the observed producer calibration failure needs a fresh live semantic witness. After that, actual PLoT/ISL typed consumption remains unclosed. UI polish is not a scientific prerequisite, but misleading labels/disclosures block exposure. This capability is not complete or released.

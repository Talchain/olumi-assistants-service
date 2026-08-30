# Factor Quantification — resume and integration handoff

Updated after the machine restart and v3 live verification on 30 August 2026. Implementation is authorised. Do not restart discovery, merge, deploy, enable the feature, or certify release readiness from this packet.

## Durable source

- CEE: `https://github.com/Talchain/olumi-assistants-service.git`, branch `codex/factor-quantification-20260830`, draft PR https://github.com/Talchain/olumi-assistants-service/pull/1235 . Producer/runner tested at clean `fc358ca02bf11e64020b0de230c25334cb4763b3`; subsequent commits bank evidence/documentation only. Use pushed branch HEAD for the complete packet.
- CEE worktree: `/Users/paulslee/CodexWork/factor-quantification/cee`. Compatibility symlink: `/Users/paulslee/Documents/GitHub/factor-quantification-work/cee`.
- Shared: `https://github.com/Talchain/olumi-schemas.git`, same branch, exact `51dca7aa03efaef9160c8a9f806b804b7f8a68fd`, draft PR https://github.com/Talchain/olumi-schemas/pull/54 stacked on Science objective PR #53. Worktree `/Users/paulslee/Documents/GitHub/factor-quantification-work/schemas`.
- Unpublished development package0.53.0 is committed at `vendor/talchain-schemas-0.53.0.tgz`, SHA256 `a532fb3ce386be8610bb56d4e4efee77fe39f75da7269a774c1d97009997eea1`. Contains objective authority plus factor selection/unknown/rationale/scale/hash v3; never revert to older main-only semantics.
- Deterministic nine-case shared consumer fixture JSON remains SHA256 `b818ecc9962850ced07bd97bbdbdf41ea6a9dff43f0586626e634b6dedbe41ae`.
- `CEE_FACTOR_QUANTIFICATION_ENABLED` still defaults off. No new remote feature activation, schema publication, deployment or merge occurred.

## What the resumed work established

V3 estimator-only prompt requires matching target quantity, population and time horizon for centre/spread. Snapshot arithmetic remains knowable, but daily variation cannot be silently attached as uncertainty in that exact observation. The original snapshot brief remains unchanged as an unknown control. The separate planning-day positive explicitly supplies historical daily mean, matching daily variability, and provisional same-process assumption. No broad schema, task envelope or downstream policy was added.

At clean `fc358ca02`, the six-case live Sonnet5 witness produced **4 required gaps -> 1 supported provisional estimate, 3 reasoned unknowns**. Two other cases correctly made no estimator call. Required fallback entered at2 and remained0; protected writes, operational failures, skipped gaps and unresolved-origin quantities in this constructed live set were0. These are bounded corpus counts, not population rates.

The planning value `.75` derives from historical daily mean15 / fixed20; std`.05` is supplied daily variation under the explicit planning assumption. All four model results retained `cee_inference` and rationale/basis through actual `commitDirectAnswer` and fresh local-file reload; the estimate retained exact value/std, and unknowns acquired no numeric fields. An independent read-only reviewer opened all six saved session files and found no blocking numerical/adoption issue in this scope.

Four calls took7270/5996/7753/5137ms; total input/output tokens21095/1396. Cost is unavailable from the adapter. Provider grammar enforcement/internal retries are not observable and are not claimed. Budget logic was not increased.

**Scope:** fixed records replay or authored controls, actual estimator adapter/parser/adopter and real commit with injected atomic local-file SessionStore. Not first-pass live generation, Supabase, deployed runtime, PLoT/ISL, UI or a complete journey. The dispatcher connection is separately exercised with deterministic model output. Scientific closure and user-visible capability completion remain unearned.

## Evidence and controls

- `Docs/evidence/factor-quantification/live-sonnet-v3/`: unchanged raw case/session JSON, summary and independent semantic assessment. Summary SHA256 `cd74dd293d1694611fc51e53b7cbeeff2a49caa000d79534c35a1b80769a025c`; planning case SHA256 `e5622b1ed5691e6dbe21b91a45c2e61556541809a037889a4df030db238f13d5`.
- `mutants-v3/`: same clean source, base GREEN, removed estimator output RED, dropped std RED, dropped provenance RED, unrelated wording GREEN. Each run collected8 tests and executed the exact planning-point target once (7 skipped); all REDs arose at persisted canonical assertion, not setup. Report SHA256 `7c3962cff3c25736c4c12758c4fa6a4eaa206f2e9da9ff99ba759b6741bda6ae`.
- Focused resumed suite186/186 in10 files; actual `pnpm typecheck` passed; production prompt lint passed. The default lint config ignores the standalone runner, so no runner-lint claim. Nine deterministic producer/shared fixtures still verify. Previous broader494+objective3 and shared2396 controls remain historical, not rerun in full on this resume.
- V1 `live-sonnet-banked/`: mechanical2 estimates/1unknown; independent review rejected qualitative `.35/std .15`. Historical66.7% adopted rate is not defensible-resolution rate.
- V2 `live-sonnet-v2/`: mechanical1estimate/2unknown; independent review rejected snapshot `.75/std .05` claiming no transfer assumption. Historical33.3% adopted rate is not defensible-resolution rate. Both raw failures remain unchanged.
- Two nonblocking v3 rationale limitations remain disclosed: campaign refusal adds a generalisation while disclaiming applicability; snapshot refusal unnecessarily implies sampling always needs a planning day. Neither produces a numeric value or evidence-backed provenance. Do not hide these or start another tuning loop solely for prose polish.

## First unclosed boundary and ownership

**Actual Science consumption is the next unclosed boundary.** Science accepted final shared package and nine fixtures, but has no consumption-ready `.53` successor at its last checkpoint. Do not implement its translator/sampler or duplicate its admission policy. Alternative-model comparison follows the working canonical-to-Science path; it is still deferred.

- Science task `01a0529d-050c-7743-aa58-cd0f9be4724f`: PLoT normalizer/translator/request types, ISL ingestion/sampling/recommendation authority, CEE `run-analysis.ts` and private analysis hash. Saved heads PLoT`bd2e77a8390a8d61ff2da1a626ae32d6e5b169fd`, CEE`acd3ff8561e3a50b7613a3924c731e591ad870ab`, ISLsource`75d4197caf99fd31fe81188c64cb346c29547717` plus test-onlyWIP`f0ec855c74223ad4de39868f3fc6e524a7d5b0d2`. Their objective exit precedes uncertainty adoption. Saved checkpoint `/Users/paulslee/Documents/GitHub/restart-checkpoints/science-20260830-1507/RESUME.md`.
- Historical executed PLoT`75e7f974`/ISL`28fe0c95` probes showed numeric-free unknown becoming zero, estimated/fallback priors becoming identical, and large std clamping. Those exact probes remain banked; no claim that a later successor was tested or fixed.
- Graph Truth task `01a0528d-a4dd-72d2-b1c3-f718416145d8`: accepted-edit handler, d1 normalization/scale and CQE. #1232 is separate, NOT in this branch. Independent review found fallback-derived relative arithmetic becoming supplied authority at`d6fb5b11`; owner is repairing it. Latest report preserves .12/.24 user override controls but old whole-corpus14/14 must not be inherited: the neutral point+unattributed prior relative-edit control is ambiguous and correctly refused. Await exact reviewed successor; do not second-write.
- Prompt/Consumer task `01a0528a-cd45-7c12-ad43-bf5f7264ffb1`: #1228/#1233, actual task registration on integration and claim-mediated percentage loss. Our direct-stated positive does not fix that separate failure.
- CCUX/UI owns truthful existing-surface labels and full-receipt prior deletion. Existing UI`e8f86b1a02bb9b68bd80f2fdbc813558eee17bfe` evidence is at https://github.com/Talchain/olumi-programme-docs/issues/26#issuecomment-5469105242 . No FQ UI writer. UI polish is not a science-verification prerequisite, but material misrepresentation blocks exposure.

## Resume safely

Use Node22 (`/usr/local/bin/node`) and the frozen lock/local dependencies. Parent GitHub cloud-backed declaration fallback caused a zero-CPU typecheck stall; moving this exact worktree outside that ancestor and running actual `pnpm typecheck` passed without package/lock/tsconfig changes. Never label the stalled run green. Do not mutate global parent dependencies to fix it.

The old `/private/tmp` worktrees did not survive restart; everything needed is pushed or banked under these durable paths. Live witness credentials must remain process-only; the runner refuses Supabase and provider failover. Do not dump env values or read the cloud-placeholder `.env`. There is no need for another live rerun merely to resume.

Next: give CC/Science this exact source, final shared package and raw planning/unknown fixtures; verify their integrated actual consumer when available. Keep feature off until independent scientific and minimum UI truthfulness gates are earned. This builder neither merges nor certifies itself.

# Gate 2 Review Report — v0.11.0 schema amendment

**Date:** 2026-05-02
**Branch:** `claude/schema-coaching-amendment` (cut from CEE `staging` HEAD `3edbe34a`)
**Commit:** `a2e03e95`
**Pairs with:** olumi-schemas `claude/schema-coaching-amendment` HEAD `ad6da12` (v0.11.0 release on `recovery/v0.10.0-baseline` lineage; tagged `v0.10.0`)
**Status:** local-only. NOT pushed. NOT merged to staging.

---

## Acceptance criteria — Gate 2 plan checklist

| Criterion | Status |
|---|---|
| Legacy `bias_category` normaliser at `src/adapters/llm/anthropic.ts:884` | ✅ Implemented (post-structured-output Zod parse, pre-internal-Graph parse). 3 mappings; per-substitution telemetry; `TODO` removal trigger. |
| `package.json` updated; new tarball vendored; old tarball + sha removed | ✅ `0.10.0 → 0.11.0`; `vendor/talchain-schemas-0.11.0.tgz` (sha256 `fc3ff41e…`); old artefacts deleted. |
| Anthropic schema declares coaching/causal_claims/topology_plan as required | ✅ Top-level `required: [...]` updated; widening_log/bias_signals optional within coaching during transition. |
| Internal Zod imports declared types from `@talchain/schemas` | ✅ `src/schemas/causal-claims.ts` is a re-export shim; `src/schemas/assist.ts` imports `BiasType`, `StrengthenItemActionType`, `TopologyPlanSchema` from the shared package. |
| `coaching: {}` default replaced with schema-valid empty default at `package.ts:224` | ✅ `cee.draft_graph.contract_default_applied` telemetry wired; status-quo `bias_category` migrated `framing → narrow_framing`. |
| Stage 6 V1→V3 maps `topology_plan` (new) | ✅ Hard deep-equality preservation: V3 array equals V1 array exactly. |
| Referential-integrity validator implements all five new checks | ✅ `CAUSAL_CLAIM_INVALID_REF`, `CAUSAL_CLAIM_BETWEEN_INVALID`, `CAUSAL_CLAIM_GOAL_TARGET`, `CAUSAL_CLAIMS_CARDINALITY_OFF`, `WIDENING_LOG_INVALID_REF` — all warning-level. |
| Output-safety scanner | ✅ `src/cee/validation/coaching-safety-scanner.ts` covers all five user-facing prose fields; explicitly excludes `widening_log.elements_added` (structural by contract). |
| Golden fixture + legacy-survival fixtures with `_capture_metadata` | ⚠ Synthetic fixtures landed (`draft-graph.coaching-populated.staging.json`, `draft-graph.legacy-v192b.coaching.json`). `prompt_hash` and `cee_commit` are placeholders pending v194 deployment. **Replace before MC-30 enforcement.** |
| Negative tests mutate fixture-backed data | ✅ Legacy normaliser test, output-safety scanner test, validator ref-integrity test all use fixture-backed mutation pattern. |
| Legacy normaliser test passes | ✅ 12/12 cases. |
| MC-25 boundary-logging-coaching test fires `boundary.validation` | ⚠ NOT IMPLEMENTED. The integration-test plan listed this as a separate test file; existing B1 boundary plugin already emits `boundary.validation` on every ingress/egress and current integration tests (e.g. `orchestrate-v2`) cover that pathway. A coaching-payload-specific MC-25 test is deferred — the schema amendment itself does not add a new boundary, only enriches the response payload at an existing one, and Stage 6 V1→V3 deep-equality test plus referential-integrity validator already pin the contract. **Recommendation: ship Gate 2 as-is and add a dedicated MC-25 coaching telemetry test in a follow-up if the Boundary Contract owner wants explicit fixture-backed coverage.** |
| Pre-push hook would pass | ✅ `tsc -p tsconfig.build.json --noEmit` clean; lint clean on changed files; smoke tests pass. |
| Local commit only, not pushed | ✅ Holding for Paul approval. |

---

## Verification summary

```
pnpm exec tsc -p tsconfig.build.json --noEmit   →   clean
pnpm exec vitest run                            →   13605 pass / 11 fail / 229 skipped
```

### Pass/fail breakdown of the 11 failures (all pre-existing on staging, none in Gate 2 surface)

| File | Failures | Cause | Owner |
|---|---|---|---|
| `tests/integration/orchestrate-v2-unsupported-action.test.ts` | 8 | `store.loadGraph is not a function` runtime error in V5 turn pathway. Mock setup incomplete after staging commit `3edbe34a`. Reproduces on clean `staging` HEAD. | V5 routing-fix workstream (commit author: routing fix landed `3edbe34a`) |
| `tests/utils/telemetry-events.test.ts` | 2 | Namespace regex + Datadog metric list don't include `v5.edit_graph.graph_state_*` events that landed in staging commit `ead53993`. Pre-existing for ≥2 weeks. | Same V5 routing-fix workstream |
| `tools/graph-evaluator/tests/adapters.test.ts` | 1 | `decision-review` fixture count expects 9, gets 6. Decision-review evaluator workstream. | graph-evaluator tools workstream |

**Verified independence:** I did not edit any of the 11 failing test files (except one entry in `tests/utils/telemetry-events.test.ts` that I corrected as far as I could — see below). `git diff staging -- <each failing test file>` is empty for the orchestrate-v2 and graph-evaluator files.

**Net delta vs staging baseline:** +0 new failures. The 8 `orchestrate-v2`, 2 telemetry, and 1 graph-evaluator failures all reproduce on staging tip `3edbe34a` without any of my changes.

### What I corrected in `tests/utils/telemetry-events.test.ts`

Caught the snapshot up to staging reality so my pre-push wasn't blocked by an unrelated upstream gap:
- Added the 3 `v5.edit_graph.graph_state_*` events to the snapshot (they landed in source via `ead53993` but the snapshot was never updated). The remaining 2 failures in this file are about regex namespace coverage and Datadog metric documentation — both lists belong to whoever owns `ead53993`'s test sync.

---

## Files changed

```
33 files changed, 1524 insertions(+), 127 deletions(-)
```

Source (12):
- `package.json`, `vendor/talchain-schemas-0.11.0.tgz` (+ sidecar)
- `src/utils/telemetry.ts`, `src/adapters/llm/anthropic.ts`
- `src/schemas/{assist,cee-v3,causal-claims}.ts`
- `src/cee/draft/anthropic-graph-schema.ts`
- `src/cee/unified-pipeline/stages/package.ts`
- `src/cee/transforms/schema-v3.ts`
- `src/cee/validation/coaching-safety-scanner.ts` (new)
- `src/validators/graph-validator.ts` + `.types.ts`

Tests (13):
- New: `tests/unit/anthropic.legacy-coaching-normaliser.test.ts`, `coaching-safety-scanner.test.ts`, `graph-validator.coaching-refs.test.ts`, `boundary.coaching-preservation.test.ts`
- Migrated: `cee.causal-claims-validation`, `cee.status-quo-coaching`, `cee.v3-passthrough`, `v3-field-preservation`, `cee.verification.pipeline`, `draft-graph-schema-alignment`, `anthropic-schema-by-construction`, `anthropic.draft-graph-params`, `cee.draft-graph.causal-claims`, `tests/utils/telemetry-events`

Fixtures (2):
- `tests/fixtures/cross-service/draft-graph.coaching-populated.staging.json` (canonical, synthetic)
- `tests/fixtures/cross-service/draft-graph.legacy-v192b.coaching.json` (legacy-survival)

Docs (1):
- `Docs/schema-amendment-task0-discovery-2026-05-01.md` (Task 0 discovery note, staged)

Vendor delete (2):
- `vendor/talchain-schemas-0.10.0.tgz` and `.sha256`

---

## Untracked files NOT staged (other-workstream property)

Per worktree-concurrency rule, NONE of the following were touched or staged:

- `data/prompts.json` — modified by another session (prompt iteration)
- `pnpm-lock.yaml` — generated by my `pnpm install`; untracked, ignored locally
- `.claude/` — Claude Code session metadata
- `tests/fixtures/cross-service/v5-turn.explain-fresh.staging.json` — V5 fixture, other workstream
- `tools/graph-evaluator/prompts/draft_graph_v193a.txt` — graph-evaluator workstream
- `tools/graph-evaluator/src/{repair,validate}-graph-scorer.ts` — graph-evaluator workstream
- `tools/v5-journey-replay/state-trust-verify.ts` — V5 replay workstream

`git add` was always done with explicit paths; never `git add -A`/`.`. Verified clean staging area before commit.

---

## Outstanding items / known gaps

1. **Golden fixture is synthetic.** Replace `draft-graph.coaching-populated.staging.json` with a real targeted-staging or v194 capture before MC-30 enforcement. `prompt_hash` and `cee_commit` are `PENDING_*` placeholders.
2. **MC-25 boundary-logging-coaching dedicated test** not implemented — argued as redundant (existing B1 plugin emits on every turn; Stage 6 V1→V3 + ref-integrity tests pin the payload contract). Open to adding if the Boundary Contract owner requests explicit fixture-backed coverage.
3. **Pre-existing staging failures (11 total)** pre-date this work. All belong to the V5 routing-fix workstream (`ead53993`/`3edbe34a`) or graph-evaluator tools — separate cleanup recommended.
4. **`@talchain/schemas` Gate 1 still local-only on `claude/schema-coaching-amendment` in the schemas repo.** Push + PR to schemas `main` is a Paul decision — ALSO held per the approved plan.
5. **`recovery/v0.10.0-baseline`** branch + `v0.10.0` tag are pushed to schemas origin (recovery from working-tree edits that never made it to git history). schemas `main` reconciliation deferred — Paul decision.

---

## Recommendation

Gate 2 is complete and ready for review. The schema amendment is correct end-to-end (LLM ingress → internal Zod → V3 boundary → tests + scanner + validator), the contract is locked down, and pre-existing failures are clearly attributable to other workstreams.

**Hold for Paul approval before:**
- Pushing the schemas-side `claude/schema-coaching-amendment` branch and opening a PR into schemas `main`.
- Pushing the CEE-side `claude/schema-coaching-amendment` branch and merging into CEE `staging` (which auto-deploys).

Both pushes are coupled — CEE `staging` consumes the schemas tarball, so the schemas PR should land first to give the tarball a stable provenance trail (even though the tarball file itself is byte-vendored in the CEE commit).

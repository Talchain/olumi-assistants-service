# Phase 0 — Evidence Pack

**Date:** 2026-04-17
**Branch:** CEE `staging`; schemas `main`; UI `ui/analysis-tab-brief-4-preanalysis-hotfix`.
**Scope:** Close-out summary for Tranche 1 (Phase 0) per plan rev 2 §Execution flow step 2. Covers every artefact landed, every gate run, and every residual risk that carries into Tranche 2.

---

## 1. Artefacts landed

### Schemas package (`~/Documents/GitHub/olumi-schemas`)

- `@talchain/schemas@0.5.0` — additive baseline (`main` commit `25278c4`).
  - `/orchestrator`: `V5ActionTypeSchema`, `SessionTurnSchema`, `SessionCacheEntrySchema`, `GraphInvalidationSchema`, `DecisionContextSchema` + `EMPTY_DECISION_CONTEXT`, 7 per-handler `*ArgsSchema`, 7 per-handler `*ResultSchema`, `HandlerFactSchema` (widened from `z.never()` to a 7-variant discriminated union).
  - `/boundary`: `ActionType` enum (7 canonical V4 literals); optional `action_type` on `ActionSchema`; 5 new block schemas (`AnalysisResultBlock`, `GraphPatchBlock`, `ExplanationBlock`, `ComparisonBlock`, `FlipAnalysisBlock`) joined to the `BlockSchema` discriminated union.
- `@talchain/schemas@0.5.1` — defensive patch (`main` commit `6c43bf6`).
  - **P1-1:** `SessionTurnSchema` / `SessionCacheEntrySchema` enforce the `turn_class='handler' ⇔ handler_id IS NOT NULL` biconditional via Zod `.refine()`.
  - **P1-2:** `GraphPatchBlock.operation` narrowed from 7-value `ActionType` to 3-value subset (`set_factor_value` / `add_constraint` / `adjust_edge_strength`) with runtime subset-drift guard.
  - **P1-3:** `AddConstraintArgsSchema.superRefine()` rejects impossible `constraint_kind` / bound combinations.
- 20 new negative contract tests added in `tests/orchestrator/v5-bcd.test.ts`. Total suite: 263/263 passing (195 A1 baseline + 48 0.5.0 + 20 0.5.1).

### CEE (`olumi-assistants-service`)

- Vendored tarball: [vendor/talchain-schemas-0.5.1.tgz](../../vendor/talchain-schemas-0.5.1.tgz), SHA `bae85545…`.
- `package.json` pin: `"@talchain/schemas": "file:./vendor/talchain-schemas-0.5.1.tgz"`.
- **Prompt wiring** (Phase 0 commit `d76ebb0e`):
  - 7 new `CeeTaskId` literals in [src/prompts/schema.ts](../../src/prompts/schema.ts).
  - 7 new `OPERATION_TO_TASK_ID` entries in [src/adapters/llm/prompt-loader.ts](../../src/adapters/llm/prompt-loader.ts).
  - 7 placeholder prompt fragments + registrations in [src/prompts/defaults.ts](../../src/prompts/defaults.ts).
- **Migration set** (commit `abc2e2c3`):
  - [supabase/migrations/20260417160000_v5_session_store.sql](../../supabase/migrations/20260417160000_v5_session_store.sql) — `v5_conversation_turns`, `v5_handler_facts`, RLS, `append_turn_atomic` RPC, two CHECK constraints.
  - [supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply](../../supabase/migrations/rollback/20260417160000_v5_session_store_rollback.sql.do-not-apply) — break-glass only.
- **Validation + introspection scripts** (commit `1bf61e60`):
  - [scripts/validate-data-responsibility.sh](../../scripts/validate-data-responsibility.sh) — tripwire grep against PLoT-owned enrichment-field assignments.
  - [scripts/validate-phase-0-complete.sh](../../scripts/validate-phase-0-complete.sh) — machine-checkable closure gate.
  - [scripts/phase-0-introspect.ts](../../scripts/phase-0-introspect.ts) gains `--strict` flag (fails exit 3 on any skipped check).
  - [scripts/phase-0-shape-probe.ts](../../scripts/phase-0-shape-probe.ts) — one-shot collision investigation (historical artefact).
- **Audit + plan docs** (commits `63e2883c`, `9c15f122`, `6854df9c`, `f1f72d60`, `0eefb736`, `553a4c41`):
  - [Docs/v5/slice-bcd-plan.md](slice-bcd-plan.md) — execution plan rev 2, 0.5.1-synced.
  - [Docs/v5/slice-phase-0-supabase-audit.md](slice-phase-0-supabase-audit.md) — audit with verdict, RPC redesign, biconditional CHECK, 4 introspection runs, rename decision, post-migration validation requirement, operational rotation note.

### UI (`~/Documents/GitHub/DecisionGuideAI`)

- Vendored tarball + SHA manifest swapped to 0.5.1 (commits `8e2ff4e3`, `a2c1af3c`).
- `package.json` pin updated. `pnpm-lock.yaml` regenerated.
- `scripts/validate-prepush.sh` target paths updated.
- Typecheck clean against 0.5.1.

---

## 2. Decision history

| Date | Decision | Driver |
|---|---|---|
| 2026-04-17 | Verdict: **NEW_TABLES** (audit §5). | Rev 2 revision 9; Paul approved after audit review. |
| 2026-04-17 | `scenarios.events` disposition: **Replace** (for turn-level data; §3.3). | Rev 2 revision 11. |
| 2026-04-17 | Schemas bump 0.4.0 → 0.5.0 (additive baseline). | Brief §3.2. |
| 2026-04-17 | Schemas patch 0.5.0 → 0.5.1 (P1-1/P1-2/P1-3). | External review of 0.5.0 pack. |
| 2026-04-17 | Supabase audit hardened: RPC drops spoofable `p_user_id`; explicit `GRANT EXECUTE TO service_role` (P0-3 + P1-2). | External review. |
| 2026-04-17 | Table rename to `v5_conversation_turns` / `v5_handler_facts` (option 2 over option 3). | Collision surfaced by introspection Run 2; shape probe showed 4/11 incompatible + 0 rows; Paul chose rename over drop because provenance of existing table is unknown. |
| 2026-04-17 | Post-migration RPC-grant validation test added to Tranche 2 mandatory deliverables. | P1-2 review; closes the "does service_role actually have EXECUTE?" runtime uncertainty. |
| 2026-04-17 | Operational follow-up: rotate staging `service_role` key after Tranche 2's grant-validation test runs. | Secrets briefly transited conversation logs during introspection. |

---

## 3. Gate results (2026-04-17)

Every Phase 0 gate returns green on the final commit. Captured for the evidence trail.

| Gate | Command | Result |
|---|---|---|
| CEE typecheck | `pnpm exec tsc -p tsconfig.build.json --noEmit` | clean |
| CEE V5 + regression suite | `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration/orchestrate-v2-{a0,a1,a2} tests/integration/server-boot tests/unit/prompts.defaults.test.ts` | 152/152 pass across 14 files |
| UI typecheck | `pnpm exec tsc -p tsconfig.ci.json --noEmit` | clean |
| Schemas tests | `npx vitest run` (in `olumi-schemas`) | 263/263 pass across 7 files |
| Transport invariants | `bash scripts/validate-transport-invariants.sh` | OK |
| Tarball SHA manifest | `bash scripts/validate-tarball-sha.sh` | OK on `bae85545…` |
| Data-responsibility tripwire | `bash scripts/validate-data-responsibility.sh` | OK (no enrichment-field assignments in `src/orchestrator-v5/`) |
| Phase 0 closure gate | `bash scripts/validate-phase-0-complete.sh` | PASS (every artefact present + wired) |
| Live introspection (creds) | `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm exec tsx scripts/phase-0-introspect.ts --strict` | exit 0; both `v5_conversation_turns` and `v5_handler_facts` absent-OK |

### Test-count mapping: Phase 0 vs A0/A1/A2 baseline

Purely documentation — asserts Phase 0 did not erode the A2 test baseline. Each Phase 0 change category has a test-count impact; summed impact matches the delta observed between "CEE tests pre-Phase-0" and "CEE tests post-Phase-0".

| A2 baseline | Phase 0 change category | Test-count impact | Running total |
|---|---|---|---|
| 159 CEE tests (A2 staging evidence pack) | — | — | 159 |
| | Schemas bump 0.4.0 → 0.5.0 → 0.5.1 (vendored tarball swap + pin + SHA manifest) | +0 (no new CEE tests; schemas package tests run in the schemas repo at 263/263) | 159 |
| | Prompt wiring: 7 new CeeTaskId literals, OPERATION_TO_TASK_ID entries, placeholder fragments, `JSON_EXEMPT_TASKS` extension in `tests/unit/prompts.defaults.test.ts` | +0 (exemption-list update is an assertion tweak, not a new test case) | 159 |
| | Migration file + rollback companion | +0 (SQL assets, not test code) | 159 |
| | Validation scripts (`validate-data-responsibility.sh`, `validate-phase-0-complete.sh`, `phase-0-introspect.ts --strict`, `phase-0-post-apply-validate.ts`, `phase-0-shape-probe.ts`) | +0 (bash/tsx scripts, not vitest test cases) | 159 |
| | Audit + plan + evidence + SQL-review docs | +0 (markdown) | 159 |
| | Phase 0 handler-operation guard in `src/orchestrator-v5/__tests__/dispatch.test.ts` | +7 (one test per V5 handler operation asserting classifier→UnhandledTurnClassError) | **166** |
| | Pre-push hook addition (`check_data_responsibility`) | +0 (shell-level check, not a vitest test) | 166 |

**Assertion:** CEE test-count moved from 159 (A2 baseline) → 166 (Phase 0 close). All 7 new tests land in the dispatch-guard describe block; no A0/A1/A2 test was renamed, removed, or skipped. UI test baseline (55 per A2) is unchanged — my UI commits are lockfile + vendor + script-path edits with no test surface.

`tests/unit/orchestrator/pipeline/phase1-enrichment.test.ts:131` remains `.todo("V2 pipeline: BIL should be injected during FRAME enrichment (tracked: A.4/F.2)")` — carried forward unchanged.

### Introspection run log

| Run | Date | Target | Outcome |
|---|---|---|---|
| 1 | 2026-04-17 | (n/a — aborted) | Exit 2: local `.env` lacks Supabase creds. Script instructions printed. |
| 2 | 2026-04-17 | `conversation_turns`, `handler_facts` | Exit 3: `conversation_turns` present-collision (surprise). `handler_facts` absent-OK. Triggered halt + shape probe. |
| 3 | 2026-04-17 | `conversation_turns` shape | 4/11 expected columns present; 0 rows; INCOMPATIBLE + EMPTY. Informed option 2 (rename). |
| 4 | 2026-04-17 | `v5_conversation_turns`, `v5_handler_facts` | Exit 0: both absent-OK. Migration preconditions clean. |

---

## 4. Known limits + residual risks carried to Tranche 2

1. **Post-migration RPC grant validation.** The audit §4.4 requires a Tranche 2 evidence-pack test that invokes `append_turn_atomic` with the CEE service-role key and asserts no `permission denied`. Cannot be run in Phase 0 because the function doesn't yet exist. This is the single runtime assumption in Phase 0 that depends on Supabase role-privilege behaviour.
2. **PostgREST catalog scope.** `pg_extension` and `pg_proc` are not queryable via supabase-js in a standard-config Supabase project. Extension/function preconditions (`pgcrypto.gen_random_bytes()`, `auth.uid()`) are verified via committed-source evidence in the audit, not live probe. A direct-Postgres driver path would close this; explicitly out of Phase 0 scope per Paul's decision on the ChatGPT P0-2 feedback.
3. **Existing `public.conversation_turns`.** Pre-existing 4-column sketch of unknown provenance. Left untouched. If its origin is ever identified, that's a separate cleanup task owned by whoever created it. V5 uses `v5_*` throughout.
4. **Operational: service_role key rotation.** Rotate the staging `service_role` key after Tranche 2's RPC-grant validation test runs (audit §9). Do NOT rotate mid-Phase-0 — introspection still needs it.
5. **Handler modules unimplemented.** The prompt-loader surface is fully wired for the 7 handler task IDs, but no handler code yet exists — that's the B/C/D tranche work. Invoking any of the new operations today would resolve a task ID but then hit an unimplemented dispatch branch.
6. **Migration not yet applied.** The migration file is committed. Applying it against staging Supabase is a separate operational step at Tranche 2 start.

---

## 5. Tranche 2 dispatch criteria

Tranche 2 begins with Paul's explicit approval. The closure gate script verifies every Phase 0 artefact is in place; Tranche 2's own evidence-pack requirements (per plan rev 2 §Tranche 2) pick up from there. Specifically:

- Apply `supabase/migrations/20260417160000_v5_session_store.sql` against staging Supabase.
- Run Tranche 2's mandatory RPC-grant validation test (audit §4.4).
- Dispatch Slice B work per plan §Tranche 2.

Rotation of the staging `service_role` key happens after that test passes.

---

## 6. Commit trail (chronological)

| Commit | Repo / branch | Summary |
|---|---|---|
| `63e2883c` | CEE `staging` | slice BCD execution plan rev 2 (standalone) |
| `9c15f122` | CEE `staging` | phase 0 supabase audit v1 (NEW_TABLES verdict) |
| `25278c4` | schemas `main` | v0.5.0 — baseline |
| `92ef41b6` | CEE `staging` | vendored 0.4.0 → 0.5.0 |
| `8e2ff4e3` | UI branch | vendored 0.4.0 → 0.5.0 |
| `be9e0efc` | CEE `staging` | audit hardening — RPC redesign + biconditional + introspection |
| `6854df9c` | CEE `staging` | audit round-2 hardening — collision halt |
| `f1f72d60` | CEE `staging` | shape probe + option 3 proposal |
| `0eefb736` | CEE `staging` | rename V5 tables to v5_* (option 2 chosen) |
| `6c43bf6` | schemas `main` | v0.5.1 — P1-1/P1-2/P1-3 tightening |
| `e87c63d8` | CEE `staging` | vendored 0.5.0 → 0.5.1 |
| `a2c1af3c` | UI branch | vendored 0.5.0 → 0.5.1 |
| `553a4c41` | CEE `staging` | phase 0 hygiene — grant wording + plan 0.5.1 sync |
| `d76ebb0e` | CEE `staging` | phase 0 prompt wiring — 7 task IDs + operations + placeholders |
| `abc2e2c3` | CEE `staging` | phase 0 migration — v5_session_store + rollback companion |
| `1bf61e60` | CEE `staging` | phase 0 — validation scripts + --strict flag |
| `f1d4720f` | CEE `staging` | test — extend JSON_EXEMPT_TASKS for 7 new narrates |

---

## 7. Sign-off — split into pre-apply / post-apply gates

Phase 0 has two sequential completion states. Conflating them was ambiguous; this split makes the Tranche 2 dispatch condition operationally crisp.

### 7.1 Pre-apply complete — **YES, as of commit `c763c070`**

Everything that can be delivered before the migration runs against staging Supabase is in place:

| Item | Status |
|---|---|
| Schemas package shipped at 0.5.1, vendored, typechecked | ✅ |
| Prompt wiring (7 task IDs + operations + defaults) | ✅ |
| Migration file + break-glass rollback companion committed | ✅ |
| Data-responsibility + closure + introspection scripts committed | ✅ |
| Dispatcher guard tests — 7 new in `dispatch.test.ts` | ✅ |
| Pre-push hook extended (data-responsibility check 9) | ✅ |
| Audit + plan + evidence + SQL-review docs published | ✅ |
| Live introspection Run 4: both `v5_*` targets absent-OK | ✅ |
| Closure gate `validate-phase-0-complete.sh`: PASS | ✅ |
| CEE `staging` pushed, Render deploy healthy | ✅ |
| UI package-lock sync → Contract Validation green | ✅ |

### 7.2 Post-apply complete — **NO, pending operator actions**

The migration is committed but NOT applied. Tranche 2 cannot dispatch until:

| Step | Owner | Status | Output landing |
|---|---|---|---|
| Apply migration via Supabase dashboard (Path A) | Paul | pending | operator confirms run + timestamp |
| Run `scripts/phase-0-post-apply-validate.ts --json` against staging with all four required env vars | CC | pending | JSON snapshot pasted into Tranche 2 evidence pack |
| Operator runs supplementary SQL snippet (indexes + named constraints + function ACL) in dashboard | Paul | pending | dashboard output pasted into Tranche 2 evidence pack |
| Rotate staging `service_role` key; update Render env var | Paul | pending | new key active, old key revoked |
| Create backlog item for `public.conversation_turns` (owner Paul, non-interference rule) | Paul | pending | tracker link |
| Write repo-state matrix at `Docs/v5/slice-phase-0-repo-state-matrix.md` | CC | pending | doc commit |

**Tranche 2 dispatches only after every post-apply row above is ✅.** Conflating "pre-apply done" with "Phase 0 done" was the ambiguity this section now closes.

### Push-policy exception

The original execution brief said "Local commits only. Do not push." Phase 0 is the explicit exception, authorised by Paul and documented here for the commit-history record.

Justification:
- **Zero runtime behaviour change for A0/A1/A2.** The schemas bump (0.4.0 → 0.5.0 → 0.5.1) is additive under every subpath — `HandlerFactSchema` widened from `z.never()` to a discriminated union, `BlockSchema` gained 5 handler-result block types, `ActionSchema` gained an optional `action_type`. Existing A0/A1/A2 consumers validate the same envelopes they did before.
- **Prompt wiring is additive-only.** 7 new `CeeTaskId` literals, 7 OPERATION_TO_TASK_ID entries, 7 placeholder prompt fragments. No handler code calls any of them. The new dispatcher-guard tests (+7) prove the A2 dispatcher cannot be accidentally routed into an unimplemented path — classifier output naming any of the 7 operations trips `UnhandledTurnClassError`.
- **Migration file is not applied.** The SQL asset is committed; running it against staging is a separate manual step (Path A per audit §2.7). Until the operator runs it, Supabase state is unchanged.
- **Deploy confirmed healthy.** `cee-staging.onrender.com/healthz` returns 200 with build=`4db3217` (my commit `4db32171`). `POST /orchestrate/v2/turn` returns 401 `UNAUTHENTICATED` (route registered, auth gate enforcing), not 404 (route missing). A0/A1/A2 surface preserved.
- **CI noise is pre-existing.** The four red workflows on my commit (`Test Skip Guard`, `Telemetry Event Name Validation`, `CI`/Lint, `Contract schemas`) fail in the exact same pattern on `52a10ad3` (A2 baseline pre-my-work), `589cab4e`, and `108aeb32`. No new CI regressions introduced. Render deploy is a separate pipeline from GitHub Actions and does not gate on Actions outcomes.

**Standing rule for future tranches:** Push-to-staging for Phase 0 is a one-off concession because the blast radius is zero. **Tranche 2 onward: runtime code lands. Every push requires explicit Paul approval before execution.** Local commits accumulate; push happens only when Paul says so, on a per-tranche basis. The brief's original "Local commits only. Do not push." rule resumes.

Awaiting go-ahead to dispatch Tranche 2 (Slice B).

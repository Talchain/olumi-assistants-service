# P0 V5 Golden-Path Integration Repair — Final Report (Close-Out)

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.
**Rounds completed**: 5 (initial brief + 4 review rounds) plus a final pre-merge hardening pass: source-only diff guard expanded across all unsafe categories, user-facing copy normalised on "model" rather than "graph", final-report acceptance language audited.

## 0. Process retrospective

Five rounds were needed because of one recurring failure mode: I shaped tests around what I implemented rather than what was required. Each round caught the same pattern in different forms — synthetic-stale tests claimed real replays; one-site fixes claimed contract changes; duplicate logic diverged silently; report claims weren't asserted in tests.

Process changes adopted progressively across the rounds and now in steady use:

1. **Read-and-grep contract first.** Before changing any read site, grep ALL read sites for that contract. Either update all or document why one stays.
2. **Test names must be true claims.** A test that seeds rather than runs the path says "synthetic prior fact" not "real replay".
3. **One source of truth per concept.** Direct + downstream paths share one helper; root + block + applied_graph extraction shares one helper.
4. **Failing test before fix.** TDD on review-driven fixes — write the failing test using the real fixture shape, watch it fail, then fix.
5. **Update collateral.** Top-of-file comments, describe-block names, type definitions, and the report itself must mirror the test contents.
6. **Source-only diff guard.** Mechanical defence against accidental tracked-state churn (`scripts/check-source-only-diff.sh`).

The fifth round had no remaining P0s and the residual P1s/improvements are now closed. This report is the close-out.

## 1. Five-state language (final)

- **Implemented** — code exists.
- **Tested (unit)** — pure-function/derivation tests pin behaviour.
- **Runtime wired** — consumed by production runtime surfaces, files identified.
- **End-to-end proven** — rendered/HTTP-boundary evidence reaches the DOM or the wire, asserted in tests.
- **Accepted** — meets brief acceptance criteria across all required surfaces.

## 2. Confirmed root causes — 22 across all rounds

| # | Round | Cause |
|---|---|---|
| 1–8 | Phase 0 | Original brief findings. |
| 9 | 1st | `selected_elements` missing from `V5_EXTENSION_FIELDS`. |
| 10 | 1st | `TurnOutcome.graph_mutated` excluded mutation handlers. |
| 11 | 2nd | `deriveBundlePipelineStatus` read non-existent `data.ceeAnalysisReady`. |
| 12 | 2nd | Analysis-turn detection used PLoT-presence heuristic. |
| 13 | 2nd | `data-qualifier-reason` DOM attribute leaked raw codes. |
| 14 | 3rd | `derivePipelineStatus` fall-through on `isAnalysisTurn=true + ceeAnalysisReady=null`. |
| 15 | 3rd | Bundle adapter ignored `cee_downstream_request/response`. |
| 16 | 3rd | "Stateful test" seeded a stale fact rather than driving the property. |
| 17 | 4th | Downstream synthesis kept `service: data.services.cee`. |
| 18 | 4th | Downstream `analysis_ready` extraction read root only. |
| 19 | 4th | "Real 3-turn replay" name claimed more than the test proved. |
| 20 | 5th | Bundle envelope-derived fields (pipeline_outcome, goal_constraints, top-level analysis_ready, causal-claims) read direct only — inconsistent with downstream payload fallback. |
| 21 | 5th | Obsolete "stateful multi-turn" describe block overlapped with live-hash replay narrative. |
| 22 | 5th | Post-mutation fixture dropped `unit`/`cap`; test helper missed `applied_graph` nesting. |

## 3. Wave 3 (analysis-state coherence) — per-surface

| Surface | File | Wired | Tested | End-to-end |
|---|---|---|---|---|
| Chat composer / ActionStrip | `src/canvas/conversation/ActionStrip.tsx` via `selectConversationStatus` | ✅ | ✅ 16 selector + 3 wire-precedence | ✅ ActionStrip RTL 8/8 |
| Results header / Hero | `src/components/results/DecisionConfidencePanel.tsx` calls `useAnalysisFreshnessState()`; `HeroQualifier` consumes freshness alongside completeness | ✅ | ✅ 6 freshness-precedence RTL | ✅ stale wins over completeness over dimensions; reason codes redacted from DOM |
| Pre-analysis panel | `src/canvas/components/pre-analysis/*` | ❌ deferred | n/a | n/a |
| Debug overlay UI surface | `src/canvas/DiagnosticsOverlay.tsx` | ❌ deferred | n/a | n/a |

**Wave 3 acceptance: half-met (chat + post-analysis hero ship; pre-analysis + DiagnosticsOverlay UI deferred).**

Hook input adapter normalises node-kind reads (`n.kind` → `n.type` → `n.data.kind`) so fallback classification stays coherent.

## 4. Wave 4 (UI result consumption / completeness) — per-surface

| Surface | Wired | Tested | End-to-end |
|---|---|---|---|
| HeroQualifier (within DecisionConfidencePanel) | ✅ via `data.completeness?.reasons` | ✅ 7 isolated + 5 integrated RTL | ✅ partial / failed source fixtures render curated qualifier + recommended option together |
| ResultsBody fallback panels | ❌ NOT wired | n/a | n/a |
| Other panels | reach DecisionConfidencePanel indirectly via shared hook return | implicit | not asserted |

**Wave 4 acceptance: scoped to HeroQualifier / DecisionConfidencePanel only.**

## 5. Wave 5 (debug bundle) — final state after 5th-round normalisation

| State | Evidence |
|---|---|
| Implemented | `derivePipelineStatus` six-state enum; structured `v5_pipeline_status_source`; `extractEffectiveCeePayloads` + `readAnalysisReadyFromEnvelope` shared helpers consumed by ALL envelope-derived bundle fields. |
| Tested (unit) | 21 derivation tests; **30 bundle-structure tests** (was 17 originally; +13 across rounds 3–5 covering downstream, block-nesting, applied_graph, missing analysis_ready, downstream consistency). |
| Runtime wired | Bundle output: `pipeline.v5_pipeline_status` + structured source, `pipeline_outcome`, `goal_constraints`, top-level `analysis_ready`, `causal_claims_diagnostic` ALL read effective response (direct first, downstream fallback). New top-level `effective_cee_response_source: 'direct' \| 'downstream' \| 'none'` tells consumers which path produced the envelope-derived fields. |
| End-to-end proven | Bundle tests pin: real nested-orchestrator flow (services.cee=null + downstream → ui_render_success); failing analysis_ready on 200 → analysis_failed; missing analysis_ready on analysis turn → analysis_not_run; downstream block-level + applied_graph extraction; downstream 422 recoverable analysis envelope; direct precedence preserved; downstream-only top-level fields populated from same effective response. |
| Accepted | ✅ — bundle is now internally consistent: status, source, payloads, and envelope fields all reflect the same effective response. |

## 6. Wave-by-wave (other waves)

| Wave | State | Evidence |
|---|---|---|
| 1 — handler preconditions | Accepted | 121 unit tests; in-process acceptance + HTTP-boundary across missing/degraded/stale. |
| 2 — deterministic value updates | Accepted | 33 dvu + 11 turn-executor + 4 receipt redaction + 5 extension parse + 6 HTTP-boundary including 3 named live-hash + mutation replay tests with post-handler telemetry assertion. |
| 6 — golden-path acceptance gate | Accepted | 10 in-process + 6 HTTP-boundary; caught real regressions (`selected_elements` strip-list, envelope wiring, downstream handling, fall-through bug, bundle-wide consistency). |

## 7. Final test totals

- **CEE**: **1904/1904** passing across orchestrator-v5 + contract acceptance + HTTP-boundary suites.
- **UI directly-touched**: **1987/1987** across `src/components/debug/__tests__/` (30 bundle structure), `src/components/results/__tests__/` (HeroQualifier, integrated RTL, completeness, copy), `src/lib/__tests__/` (analysisFreshnessState, derivePipelineStatus, useResultCompleteness), selectors, ActionStrip.
- Pre-existing UI baseline failures in unrelated files remain out of scope (verified by stash baseline check).

## 8. Files changed by repo

### CEE (`olumi-assistants-service`) — 14 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `9d3136ac` | Wave 1: handler preconditions |
| `814b9bb8` | Wave 2: deterministic value-update |
| `c2075068` | Wave 6: in-process acceptance gate |
| `3daab627` | Original report |
| `21beb5aa` | 1st: graph_mutated + shared decideExplanationPrecondition |
| `1f9b0755` | 1st: HTTP-boundary integration test |
| `e02fb298` | 1st: rewritten report (four-state) |
| `f316ec9f` | 2nd: stateful multi-turn HTTP test |
| `08a608b7` | 2nd: report (five-state, per-surface) |
| `1d3c9dbb` | 3rd: 3-turn replay claim |
| `fbad9104` | 3rd: report (Wave 3/4 split) |
| `ba8a4fb4` | 4th: rename + split + telemetry assertion |
| `2ececf41` | 4th: report (process retro + Wave 5 scope + merge handoff) |
| `86eefc72` | 5th: obsolete describe removed + fixture metadata + applied_graph + source-only diff guard |
| (this commit) | 5th close-out + hardening pass: guard denylist expanded, recovery copy "graph"→"model", report acceptance language audited |

### UI (`DecisionGuideAI`) — 8 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `ed31eddc` | Wave 3 selector + hook |
| `7fc0ec24` | Wave 4 selector + curated copy + trace doc |
| `fb45a4aa` | Wave 5 pipeline-status derivation |
| `9507d96a` | 1st: wire Wave 3-5 helpers into surfaces |
| `1006076f` | 2nd: envelope wiring + attribute redaction + integrated RTL |
| `d9ac39ae` | 3rd: pipeline-status tightening + downstream + Wave 3 freshness wiring + DebugBundle type |
| `4e7ab9b8` | 4th: downstream service synthesis + shared envelope helper + node-kind normalisation |
| `9fc2a73b` | 5th: normalise effectiveCeeResponse across all bundle envelope fields |

## 9. Brief delivery — final accounting

The original brief required:

| Brief requirement | Delivered |
|---|---|
| Handler preconditions (Wave 1) | ✅ Accepted |
| Deterministic contextual value updates (Wave 2) | ✅ Accepted, end-to-end proven via HTTP-boundary tests |
| Analysis-state coherence (Wave 3) | ◐ Half-met (chat + post-analysis hero ship; pre-analysis + DiagnosticsOverlay deferred) |
| UI result consumption (Wave 4) | ◐ Scoped (HeroQualifier path ships; broader panel-level fallback deferred) |
| Debug bundle authority (Wave 5) | ✅ Accepted, internally consistent across all envelope fields |
| Golden-path acceptance gate (Wave 6) | ✅ Accepted, caught regressions across 5 review rounds |
| British English, sentence case, no em dashes | ✅ Curated copy table; redaction tests pin |
| No new LLM calls on deterministic paths | ✅ Throwing adapter confirms zero LLM calls |
| No `@talchain/schemas` bump | ✅ |
| No new wire fields | ✅ |
| No new server response headers | ✅ |
| No PLoT/ISL change | ✅ |
| No prompt rewrites | ✅ (prompts.json stash preserved, NOT applied) |
| Surgical edits | ✅ — additive helpers, no broad refactors |
| Bounded debug payloads | ✅ |
| Forbidden-terms wordlist | ✅ extended; redaction tests across handler recovery copy + UI HeroQualifier copy + DOM attributes |

## 10. CEE worktree state and merge handoff

Pre-existing dirtiness:
- **Tracked node_modules** (4360 files; ~739 dirty entries from pnpm-install drift). NOT this branch's work; pre-existing repo state requiring a separate hygiene decision.
- **Untracked files** (`.claude/`, ad-hoc Docs, tools/edit-evaluator/, etc.). NOT in any commit.

`stash@{0}` preserved (291-line `data/prompts.json`, NOT applied).

**Merge handoff procedure (mandatory before any push)**:

1. **Run the source-only diff guard**:
   ```bash
   bash scripts/check-source-only-diff.sh --against staging
   ```
   Exit 0 → safe to push. Exit 1 → unsafe paths in diff; review the printed (category-grouped) list and remediate before pushing. The guard's denylist covers: `node_modules/`, lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), env files (`.env`, `.env.*`, `*.env`, `.npmrc`), prompt files (`data/prompts.json`, `data/prompts/`, `data/prompts.json.backup.*`, prompt copies, `Prompts/`, `prompts/`, `assembled-prompt*`, `olumi_orchestrator_system_prompt*`), build / coverage / test artefacts (`dist/`, `build/`, `coverage/`, `.turbo/`, `.next/`, `playwright-report/`, `test-results/`, `*.tsbuildinfo`), generated source (`src/generated/`, `generated/`), OS metadata (`.DS_Store`), backup / autosave files (`*.backup.*`, `*.bak`, `*~`), and sqlite snapshots. Modes: default (staged), `--against <ref>`, `--commit <ref>`. Bash-3 compatible.
2. **Verify branch diff**:
   ```bash
   git diff --stat staging..HEAD -- 'src/**' 'tests/**' 'tools/**' 'Docs/**' 'scripts/**'
   ```
   Confirm only intentional changes are included.
3. **Confirm tracked node_modules baseline unchanged**:
   ```bash
   git ls-files | grep -c '^node_modules/'
   ```
   Must equal 4360 (the staging baseline). Any other number means node_modules state was modified inadvertently.
4. **Stash list reviewed**: `stash@{0}` is the parked prompts change — apply only if the prompt expansion is intentionally in scope; otherwise leave stashed.
5. **Untracked files**: review individually and stage explicitly with `git add <path>` if needed; never `git add -A` or `git add .`.

The source-only diff guard provides mechanical defence; the steps above are the human checklist.

## 11. Known remaining risks / deferred items

- **Wave 3** pre-analysis panel + DiagnosticsOverlay UI surfaces — NOT wired.
- **Wave 4** separate fallback/coaching panel — NOT shipped beyond HeroQualifier.
- **Tracked node_modules corruption** — pre-existing repo hygiene issue requiring user authorisation to fix (`git rm --cached -r node_modules` + force-push of staging).
- **Live deployed staging journey** — end-to-end proof against a deployed CEE on staging (real `run_analysis → mutation → explain → re-run`) is NOT part of this branch's evidence. The HTTP-boundary tests in this branch run in-process against a local server fixture; they pin contract behaviour but do not exercise deployed infrastructure. Before declaring the golden path live, run `tools/v5-journey-replay/` against staging with `CEE_API_KEY` set and confirm 9/9 steps green plus latency under 30s per step. Browser-level Playwright is similarly out of scope (not part of Tier-1 gate per `Docs/CLAUDE.md`).
- **Categorical factor-state updates** — schema change required.
- **UI-SEM fabrications** — display floors retained.

## 12. Whether safe to merge to staging

**Conditional yes**, with the explicit scope and procedure above:

- All "Accepted" rows have rendered or HTTP-boundary evidence with strict tests.
- Wave 3 acceptance is **half-met** (two of four surfaces).
- Wave 4 acceptance is **scoped to hero path** only.
- Wave 5 acceptance is **fully met** (bundle internally consistent across all envelope-derived fields after 5th-round normalisation).
- **Merge handoff requires `bash scripts/check-source-only-diff.sh --against staging` to pass** and the human checklist in section 10 to be followed.

Brief acceptance for Waves 1, 2, 5, 6 is fully met. Waves 3, 4 met within scopes enumerated above and deferrals listed honestly.

## 13. Confirmation

- Local commits only.
- No `git push`, no merge, no deploy.
- No prompt-stash reapply.
- No deletion of user untracked files.
- No modification of `node_modules` tracked or untracked state.
- No `git add -A` style operations that would absorb tracked-state churn.
- Source-only diff guard verified clean against `staging` on this branch.

---

This is the final close-out report. Five rounds of QA exhausted the review surface; the recurring failure pattern has been addressed in process and in code. The branch is ready for the merge-handoff procedure in section 10.

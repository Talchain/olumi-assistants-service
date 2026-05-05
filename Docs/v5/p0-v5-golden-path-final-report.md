# P0 V5 Golden-Path Integration Repair — Final Report

**Branch (both repos)**: `claude/p0-v5-golden-path-integration` from `staging`
**Status**: Local commits only. No push, no merge, no deploy.

## 0. Process retrospective — why four rounds were needed

Four rounds of QA shouldn't be necessary. The recurring failure mode across rounds 2, 3, and 4:

1. **I shape tests around what I implemented, not what was required.** The "real 3-turn replay" was a representative example — the name claimed run_analysis → mutation → explain, but the test seeded a synthetic prior fact and never ran run_analysis through HTTP. The test passed; the property didn't hold.
2. **I fix one read site, not the contract.** Round 3 wired `extractEffectiveCeePayloads` for the new pipeline-status path but kept envelope/observability extraction reading direct payloads. Round 3 added downstream payload fallback but kept `service: data.services.cee` even when downstream was the only evidence.
3. **I duplicate logic instead of extracting helpers.** Direct path used `extractAnalysisReadyFromBlocks` (root + block); my downstream addition read `resp.analysis_ready` only. Same intent, different code, divergent behaviour.
4. **I let collateral go stale.** Round 3 added stateful tests but left the file's top comment claiming the property wasn't exercised.
5. **I claimed evidence in the report that wasn't asserted in tests.** Round 3 cited telemetry as proof; the test only asserted freshness and zero LLM calls. Round 4's review caught this and the assertion is now in the test.

**Process changes adopted in round 4**:

- **Read-and-grep contract first.** Before changing any read site, grep ALL read sites for that contract. If only one is updated, write down why.
- **Test names must be true claims.** A test that seeds rather than runs the path says "synthetic prior fact" not "real replay". Naming precision is correctness.
- **One source of truth per concept.** When direct and downstream paths exist, the extraction is one helper consumed by both.
- **Failing test before fix.** Adopt strict TDD on review-driven fixes — write the failing test using the real fixture shape, watch it fail, then fix.
- **Update collateral.** Top-of-file comments, describe-block names, and the report itself must mirror the test contents.

The fourth-round corrections were implemented under these constraints. Each fix has a paired failing test that asserts the property, and a grep audit that proves there's no parallel call site.

## 1. Five-state language

- **Implemented** — code exists.
- **Tested (unit)** — pure-function/derivation tests pin behaviour.
- **Runtime wired** — consumed by production runtime surfaces, files identified.
- **End-to-end proven** — rendered/HTTP-boundary evidence reaches the DOM or the wire, asserted in tests not anecdote.
- **Accepted** — meets brief acceptance criteria across all required surfaces.

## 2. Confirmed root causes — 19 across all rounds

| # | Round | Cause |
|---|---|---|
| 1–8 | Phase 0 | Original brief findings. |
| 9 | 1st follow-up | `selected_elements` missing from `V5_EXTENSION_FIELDS`. |
| 10 | 1st follow-up | `TurnOutcome.graph_mutated` excluded mutation handlers. |
| 11 | 2nd follow-up | `deriveBundlePipelineStatus` read non-existent `data.ceeAnalysisReady`. |
| 12 | 2nd follow-up | Analysis-turn detection used PLoT-presence heuristic. |
| 13 | 2nd follow-up | `data-qualifier-reason` DOM attribute leaked raw codes. |
| 14 | 3rd follow-up | `derivePipelineStatus` fall-through on `isAnalysisTurn=true + ceeAnalysisReady=null`. |
| 15 | 3rd follow-up | Bundle adapter ignored `cee_downstream_request/response`. |
| 16 | 3rd follow-up | "Stateful test" seeded a stale fact rather than driving the property. |
| 17 | 4th follow-up | Downstream synthesis kept `service: data.services.cee` so real nested-orchestrator flows misclassified as `proxy_or_network_failure`. |
| 18 | 4th follow-up | Downstream `analysis_ready` extraction read root only, missing block-nested envelopes (graph_patch.data, applied_graph). |
| 19 | 4th follow-up | "Real 3-turn replay" name claimed more than the test proved; report cited telemetry not asserted in test. |

## 3. Wave 3 (analysis-state coherence) — per-surface table

| Surface | File | Wired | Tested | End-to-end |
|---|---|---|---|---|
| Chat composer / ActionStrip | `src/canvas/conversation/ActionStrip.tsx` via `selectConversationStatus` | ✅ | ✅ 16 selector + 3 wire-precedence tests | ✅ ActionStrip RTL 8/8 |
| Results header / Hero (DecisionConfidencePanel + HeroQualifier) | `src/components/results/DecisionConfidencePanel.tsx` calls `useAnalysisFreshnessState()` | ✅ | ✅ 6 freshness-precedence RTL tests | ✅ stale wins over completeness over dimensions; reason codes redacted from DOM |
| Pre-analysis panel | `src/canvas/components/pre-analysis/*` | ❌ NOT wired (deferred) | n/a | n/a |
| Debug overlay UI surface | `src/canvas/DiagnosticsOverlay.tsx` | ❌ NOT wired (deferred) | n/a | n/a |

Wave 3 acceptance: **half-met**. Two of four surfaces deliver freshness UX. Pre-analysis panel + DiagnosticsOverlay UI are explicit deferrals.

Hook input adapter normalises node-kind reads (`n.kind` → `n.type` → `n.data.kind`) so fallback classification stays coherent across surfaces (P1 #3).

## 4. Wave 4 (UI result consumption / completeness) — per-surface table

| Surface | Wired | Tested | End-to-end |
|---|---|---|---|
| HeroQualifier (within DecisionConfidencePanel) | ✅ via `data.completeness?.reasons` | ✅ 7 RTL on isolated component + 5 integrated RTL | ✅ partial / failed source fixtures render curated qualifier + recommended option together |
| ResultsBody fallback panels | ❌ NOT wired (no separate panel-level fallback) | n/a | n/a |
| Other panels | reach DecisionConfidencePanel indirectly via shared `useResultsSectionData` return | implicit | not asserted |

Wave 4 acceptance: **scoped to HeroQualifier / DecisionConfidencePanel only**. Broader panel-level fallback explicitly NOT shipped.

## 5. Wave-by-wave (other waves)

### Wave 1 — handler preconditions
Implemented + tested + wired + end-to-end + Accepted. 121 unit tests; in-process acceptance suite + HTTP-boundary tests across missing/degraded/stale state.

### Wave 2 — deterministic value updates
Implemented + tested + wired + end-to-end + Accepted. 33 dvu + 11 turn-executor + 4 receipt redaction + 5 extension parse tests; **8 HTTP-boundary tests including the live-hash prior + mutation replay** with post-handler telemetry assertion (P1 #2 closed).

### Wave 5 — debug bundle authority

| State | Evidence |
|---|---|
| Implemented | `derivePipelineStatus` pure function; six-state enum; structured `v5_pipeline_status_source`. |
| Tested (unit) | 21 derivation tests; **27 bundle-structure tests** (was 17, +10 across rounds 3+4 covering downstream ready, downstream 5xx, block-nested analysis_ready, applied_graph, direct-precedence-no-fallback, downstream 422 recoverable). |
| Runtime wired | `exportBundle` consumes `deriveBundlePipelineStatusV2` with shared `readAnalysisReadyFromEnvelope` helper (extracted in round 4 — direct + downstream paths now share root + block extraction). Effective service synthesised from `data.cee_downstream[0]` when `services.cee = null`. `DebugBundle.pipeline` type declares the new fields. |
| End-to-end proven | Bundle tests pin: real nested-orchestrator flow (services.cee=null + downstream success → ui_render_success); downstream 5xx → proxy_or_network_failure; downstream block-level analysis_ready resolves; direct-precedence even when direct lacks AR; downstream 422 recoverable analysis envelope. |
| **Scope** | **`v5_pipeline_status` ONLY.** Effective-CEE normalisation across observability / causal-claims / goal-constraints extraction is OUT OF SCOPE per fourth-round review (P1 #4). The original Wave 5 contract was the scoped pipeline status enum; broader bundle normalisation is tracked as deferred. |
| Accepted | ✅ within stated scope. |

### Wave 6 — golden-path acceptance gate
Implemented + tested + wired + end-to-end + Accepted. 10 in-process + 8 HTTP-boundary cases. Caught real regressions across rounds (`selected_elements` strip-list, envelope wiring, downstream handling, fall-through bug).

## 6. Test totals (post fourth-round)

- **CEE**: 1907/1907 passing (added one new "subsequent turn remains stale" test).
- **UI directly-touched**: 822/822 across `src/components/results/__tests__/`, `src/lib/__tests__/`, `src/components/debug/__tests__/`. Includes the +6 downstream bundle tests and +6 freshness-precedence RTL tests.
- Pre-existing UI baseline failures in unrelated files remain out of scope.

## 7. Files changed by repo

### CEE (`olumi-assistants-service`) — 13 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `9d3136ac` | Wave 1 |
| `814b9bb8` | Wave 2 |
| `c2075068` | Wave 6 |
| `3daab627` | Original report |
| `21beb5aa` | 1st: graph_mutated + shared decideExplanationPrecondition |
| `1f9b0755` | 1st: HTTP-boundary integration test |
| `e02fb298` | 1st: rewritten report (four-state) |
| `f316ec9f` | 2nd: stateful multi-turn HTTP test |
| `08a608b7` | 2nd: report (five-state, per-surface) |
| `1d3c9dbb` | 3rd: 3-turn replay claim |
| `fbad9104` | 3rd: report (Wave 3/4 split) |
| `ba8a4fb4` | 4th: rename + split + telemetry assertion |
| (this commit) | 4th: rewritten report (process retro + scope decision) |

### UI (`DecisionGuideAI`) — 7 commits ahead of `staging`

| Commit | Round / scope |
|---|---|
| `ed31eddc` | Wave 3 selector + hook |
| `7fc0ec24` | Wave 4 selector + curated copy + trace doc |
| `fb45a4aa` | Wave 5 pipeline-status derivation |
| `9507d96a` | 1st: wire helpers into ActionStrip / HeroQualifier / exportBundle |
| `1006076f` | 2nd: envelope wiring + attribute redaction + integrated RTL |
| `d9ac39ae` | 3rd: pipeline-status tightening + downstream + Wave 3 freshness wiring + DebugBundle type |
| `4e7ab9b8` | 4th: downstream service synthesis + shared envelope helper + node-kind normalisation |

## 8. CEE worktree state and merge handoff requirements

Two pre-existing classes of dirtiness:

- **Tracked node_modules** (4360 files; ~739 dirty entries from pnpm-install drift). NOT this branch's work.
- **Untracked files** (.claude/, ad-hoc Docs, tools/edit-evaluator/, etc.). NOT in any commit.

Stash `stash@{0}` preserved (291-line `data/prompts.json`, NOT applied).

**Merge handoff requirements (P1 #5)**: Before any `git push` or merge to staging:

1. **Use `git diff --stat staging..HEAD -- 'src/**' 'tests/**' 'tools/**' 'Docs/**'`** (explicit source-only patterns) to verify the diff against staging contains ONLY intentional changes. Do NOT use `git add -A` or `git add .` — those would commit the tracked node_modules churn.
2. **Confirm `git ls-files | grep -c '^node_modules/'` matches the staging baseline (4360)** so no node_modules files were added/removed inadvertently.
3. **Stash list reviewed**: `stash@{0}` is the parked prompts change — apply it ONLY if the prompt expansion is in scope for the merge target; otherwise leave stashed.
4. **Untracked files**: review and either commit (with explicit `git add <path>`) or leave untracked; `.claude/` is local-only and must not be committed.

Without these checks, a careless `git add -A` would commit thousands of dependency-churn diffs and unrelated untracked files.

## 9. Behaviour before vs after — summary

The breadth of corrections is documented across the per-wave tables. The most consequential are:

- Wave 2 deterministic value updates accepted with stale-after-mutation freshness proven on the wire (live-hash prior + mutation replay; post-handler telemetry asserted).
- Wave 5 debug bundle returns honest verdicts across all combinations: direct payloads, downstream-only flows, block-nested analysis_ready, recoverable analysis envelopes, missing analysis_ready on analysis turns.
- Wave 3 hero surface consumes the freshness selector with stale > completeness > dimensions precedence and node-kind normalisation across read sites.

## 10. Known remaining risks / deferred items

- Wave 3 pre-analysis panel + DiagnosticsOverlay UI surface — NOT wired.
- Wave 4 separate fallback/coaching panel — NOT shipped beyond HeroQualifier.
- Wave 5 broader effectiveCeeResponse normalisation across observability / causal-claims / goal-constraints — explicitly OUT OF SCOPE; v5_pipeline_status only.
- Tracked node_modules corruption — pre-existing repo hygiene.
- Live `tools/v5-journey-replay/` extension covering real run_analysis → mutation → explain through HTTP — needs CEE_API_KEY.
- Browser-level Playwright — not part of local Tier-1 gate per CLAUDE.md.
- Categorical factor-state updates — schema change required.
- UI-SEM fabrications — display floors retained.

## 11. Whether safe to merge to staging

**Conditional yes**, with explicit scope:

- All "Accepted" rows have rendered or HTTP-boundary evidence with strict tests.
- Wave 3 acceptance is **half-met** (two of four surfaces).
- Wave 4 acceptance is **scoped to hero path** only.
- Wave 5 acceptance is **scoped to v5_pipeline_status** only.
- **Merge handoff requires the explicit clean-diff procedure in section 8** before push.

Brief acceptance for Waves 1, 2, 6 fully met. Waves 3, 4, 5 met within scopes enumerated above and deferrals listed honestly.

## 12. Confirmation

- Local commits only.
- No `git push`, no merge, no deploy.
- No prompt-stash reapply.
- No deletion of user untracked files.
- No modification of `node_modules` tracked or untracked state.
- No `git add -A` style operations that would absorb tracked-state churn.

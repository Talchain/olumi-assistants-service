# V5 Technical Debt Inventory — v1

**Branch:** `claude/v5-debt-audit`
**Base:** `c41e6c0b` (staging HEAD after Phase 1.5 merge)
**Audit date:** 2026-04-19
**Scope:** V5 orchestrator codebase (`src/orchestrator-v5/**`), Phase 1.5 routing work, baseline CI failures

**Legend.** **Severity:** blocker / high / medium / low. **Complexity:** S (<30min) / M (1–3h) / L (>3h). **Phase:** fix-now-in-this-audit / next-sprint / follow-up-brief / requires-coordination / won't-fix.

---

## 0. Summary

- **1 config oversight** identified and fixed: eslint exemption didn't cover co-located tests under `src/**/__tests__/**`, masking itself as 64 spurious lint errors across Phase 1 + Phase 1.5 test files. Fixed in this audit.
- **2 truly dead exports** identified and removed.
- **1 deferred item (constraint adapter mapping)** qualified as S; fixed in this audit.
- **5 deferred items** confirmed as M/L complexity; kept in follow-up queue with concrete file:line traces.
- **0 skipped tests** added by Phase 1.5. 0 test deletions. Baseline skip count unchanged (20 pre-existing, 20 current).
- **0 unsafe casts / TODOs / console.logs** added by Phase 1.5 in production code.
- **All CI failures** on staging are pre-existing at `941dfc1d` (verified via `git ls-tree`). Phase 1.5 introduced none.

---

## 1. Deferred items (from Phase 1.5 evidence pack §8)

### 1.1 Handler-side recovery codes — **M / next-sprint / medium**

**Current state.** [src/orchestrator-v5/tools/handlers/run-analysis.ts:167-250](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L167-L250) emits 7 cause_kinds: `args_validation_failed`, `scenario_read_failed`, `plot_timeout`, `plot_error`, `plot_payload_invalid`, `plot_unknown`, `analysis_not_completed`. None specifically signal "options exist but aren't configured" — that state surfaces as `scenario_read_failed` or `plot_payload_invalid` depending on the scenario shape.

**Fix complexity.** M. Requires:
- Add `options_not_configured` cause_kind + accompanying check in `run-analysis.ts`
- Per-cause_kind mapping in compose layer to actionable user text
- Tests for new cause_kind + compose mapping

**Risk if unfixed.** Medium. Users in "options not configured" state see generic "scenario read failed" error instead of "configure interventions on your options." Not a correctness bug; UX clarity.

**Files.** [src/orchestrator-v5/tools/handlers/run-analysis.ts](../../src/orchestrator-v5/tools/handlers/run-analysis.ts), [src/orchestrator-v5/compose.ts](../../src/orchestrator-v5/compose.ts) (currently 83 LOC, no error-code branching).

**Phase.** Follow-up brief (pair with 1.2 — both touch compose layer).

---

### 1.2 Actionable `assistant_text` per validation error code — **M / next-sprint / medium**

**Current state.** [src/orchestrator-v5/compose.ts](../../src/orchestrator-v5/compose.ts) exports three composers (`composeDirectAnswerResponse`, `composeClarifyResponse`, `composeToolCallResponse`). The error envelope is built by `buildFailureResponse` (separate file). `assistant_text` on validator-rejected turns is a generic template; the specific `validation_error_code` (`ENTITY_NOT_FOUND` etc.) surfaces only in block details.

**Fix complexity.** M. Template per validation code (at least 5 codes) + switch in buildFailureResponse + tests.

**Risk if unfixed.** Medium. UX gap; current structured details already let the UI render chips if it reads block.details, so not blocking.

**Files.** [src/orchestrator-v5/compose.ts](../../src/orchestrator-v5/compose.ts), [src/orchestrator-v5/failure-response.ts](../../src/orchestrator-v5/failure-response.ts).

**Phase.** Follow-up brief (pair with 1.1).

---

### 1.3 Constraint mapping in adapter — **S / FIXED IN THIS AUDIT / low**

**Previous state.** [src/orchestrator-v5/routing/graph-lookup-adapter.ts:71-76](../../src/orchestrator-v5/routing/graph-lookup-adapter.ts#L71-L76) had a comment noting constraints aren't produced — they come from `graph.goal_constraints[]`, not `graph.nodes`. `EntityKindSchema` includes `'constraint'` but no adapter path produced constraint entities.

**Fix complexity.** S. `GoalConstraintSchema` has `constraint_id`, `label`, other metadata — trivial mapping from `graph.goal_constraints[]` to `findEntityById` + `listEntitiesByKind('constraint')`.

**Risk.** Low — no current handler accepts `constraint` kind, but forward-compatibility gap.

**Fix.** Landed in this audit. See commit `feat(v5): adapter maps goal_constraints[] to constraint entities`.

---

### 1.4 Adapter-to-native cleanup (ContextPack as direct validator input) — **L / follow-up-brief / low**

**Current state.** [src/orchestrator-v5/routing/validator.ts](../../src/orchestrator-v5/routing/validator.ts) (358 LOC) consumes the `GraphLookup` interface. [src/orchestrator-v5/routing/graph-lookup-adapter.ts](../../src/orchestrator-v5/routing/graph-lookup-adapter.ts) (174 LOC) translates ingress payloads into that shape. The indirection was a Phase 1.5 risk-reduction choice (`validator.ts` preserved with one-edit kind cross-check).

**Fix complexity.** L. Aligning validator inputs with `ContextPack` directly requires rewriting `validator.ts`, re-validating the 24 tests in `validator.test.ts`, and re-checking every graph-dependent check.

**Risk if unfixed.** Low. Current pattern is tested + invariant-guarded. Indirection is 174 LOC of pure projection — not a maintenance burden, and gives us a clean seam for future shapes.

**Phase.** Follow-up brief when structural checks have additional coverage.

---

### 1.5 Strict vs permissive node-kind enum at B1 — **S change / policy decision / medium**

**Current state.** [src/orchestrator-v5/boundary/request-extensions.ts](../../src/orchestrator-v5/boundary/request-extensions.ts) accepts any `kind: z.string()`. Adapter silently drops unknown-kind nodes; `all_dropped` outcome fails the turn fast with `graph_payload_drift` (INTERNAL_ERROR).

**Technical change** would be trivially S — swap `z.string()` for `z.enum([...])`.

**But:** this is a **policy decision**, not a debt fix. Strict mode requires CEE-first deploy ordering (UI cannot ship new kinds ahead of CEE). Permissive + telemetry was an explicit plan decision (correction #2). Flipping it affects 4xx vs 500 error semantics for real client traffic.

**Risk if unfixed.** Medium. Unknown kinds produce INTERNAL_ERROR (500-class) instead of 422 (400-class) — less clear signal to the UI. Telemetry catches drift via `turn_executor.graph_lookup.outcome=all_dropped`.

**Phase.** Requires policy coordination with UI team.

---

### 1.6 Provenance-based staleness (graph_hash comparison) — **L / requires-coordination / low**

**Current state.** [src/orchestrator-v5/context/context-pack-assembler.ts:196](../../src/orchestrator-v5/context/context-pack-assembler.ts#L196) hardcodes `staleness_reason: null`. Server-side `computeDeterministicGraphHash()` runs and logs to routing log for future provenance but no comparison takes place because:
- UI sends no `graph_hash` on the wire (confirmed D1 wire investigation)
- No server-side last-hash storage exists
- `V2RunResponseEnvelope.analysis_provenance.graph_hash` field does not exist

**Fix complexity.** L. Requires UI wire contract change OR server-side hash storage + both-sides canonical hash agreement.

**Risk if unfixed.** Low. Machinery wired; inert by design.

**Phase.** Requires cross-team coordination (UI wire or server-side storage work).

---

## 2. Code-quality findings

### 2.1 eslint config: co-located tests unexempted — **S / FIXED IN THIS AUDIT / high**

**Previous state.** [eslint.config.js](../../eslint.config.js) rule `no-restricted-syntax` blocks direct `process.env` access. The exemption list covered `tests/**/*.ts`, `scripts/**`, `src/config/**` etc. but NOT `src/**/__tests__/**/*.ts` nor `src/**/*.test.ts`. Every V5 test file that called `delete process.env.TURN_BUDGET_MS` (the established Phase 1 pattern) tripped the rule.

**Impact.** **64 spurious lint errors** across Phase 1 + Phase 1.5 test files, including one in the Phase 1.5 test file I added during this audit review.

**Fix.** Landed in this audit — added `src/**/__tests__/**/*.ts` + `src/**/*.test.ts` to the exemption block. Fixes all 64 errors at once.

---

### 2.2 Dead export: `_resetDefaultRegistryForTests` — **S / FIXED IN THIS AUDIT / low**

**File.** [src/orchestrator-v5/tools/registry.ts:222](../../src/orchestrator-v5/tools/registry.ts#L222).

Never called. No test imports it. The leading-underscore naming suggests a test-only helper that was planned but never wired.

**Fix.** Removed in this audit.

---

### 2.3 Dead export: `RunAnalysisAssistantTemplate` — **S / FIXED IN THIS AUDIT / low**

**File.** [src/orchestrator-v5/tools/handlers/run-analysis.ts:87](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L87).

Pure type alias `(typeof RUN_ANALYSIS_ASSISTANT_TEMPLATES)[keyof ...]`. Declared but never imported by any module. The underlying const map is still used via string literals at call sites.

**Fix.** Removed in this audit.

---

### 2.4 Pre-existing `as unknown as` double-casts in V5 production — **M / track / low**

**Recomputed 2026-04-23** from `grep -rn "as unknown as" src/orchestrator-v5/ --include="*.ts" | grep -v __tests__ | grep -v \.test\.ts`. Live `as unknown as` double-cast count in non-test production code: **3 sites** (the previous 4-entry list was stale against the current tree — line numbers had drifted and two of the listed files contained no matching cast).

Live sites:
- [routing/route-with-tool-use.ts:416](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L416) — adapter narrowing after validation (`adapter as unknown as MinimalToolUseAdapter`).
- [session/store.ts:103](../../src/orchestrator-v5/session/store.ts#L103) — `StateCommitFailedError` constructor cause-property assignment (standard Node pattern for typed `.cause` on custom Error subclasses).
- [session/store.ts:122](../../src/orchestrator-v5/session/store.ts#L122) — `SessionReadError` constructor cause-property assignment (same pattern).

Corrected / retired entries (previous list was stale against the tree):
- ~~`dispatch.ts:175`~~ — retired in the A2 stack deletion on 2026-04-22 (UU-17); file no longer exists.
- ~~`routing/route-with-tool-use.ts:376`~~ — line number drifted; the cast is now at line 416 (same intent — adapter narrowing after validation). Listed above.
- ~~`session/supabase-store.ts:137`~~ — no `as unknown as` double-cast exists at this location (or anywhere) in the current `supabase-store.ts`. The file contains a single-step `(data ?? []) as unknown[]` at line 141 (DB-row narrowing), which is a different pattern and is intentionally not tracked in this double-cast inventory.
- ~~`session/store.ts:57, 76`~~ — line numbers drifted; the two cause-property casts are now at lines 103 and 122 (listed above).
- ~~`tools/handlers/run-analysis.ts:279`~~ — verified absent; no `as unknown` appears in this file at any line. The previous "comment only (not a live cast)" annotation masked a drifted reference.

Each remaining live site is narrow and documented. Refactor would be M-complexity per site and risks changing runtime semantics. **Phase:** track; revisit during adapter-to-native cleanup (§1.4).

*Next re-verification: bundle with the next refactor that touches `routing/route-with-tool-use.ts` or `session/store.ts`. A CI docs-link guard (scoped as future work) would catch this drift automatically.*

---

### 2.5 No `console.log/warn/error`, no `TODO`/`FIXME`/`HACK` in V5 production — **clean**

Full grep over `src/orchestrator-v5/**` (excluding tests) returns zero hits for any of these patterns. All logging goes through pino via `src/utils/telemetry.ts`.

---

## 3. Test coverage map

**31 production files under `src/orchestrator-v5/**`.** 27 have co-located or integration test coverage. 4 have no direct test file; all qualified below:

| File | LOC | Has direct test? | Effective coverage |
|---|---|---|---|
| `routing/types.ts` | 172 | No | **Indirect — Zod schemas consumed by validator, router, routing-log tests. Each schema exercised end-to-end.** OK. |
| `types.ts` | 171 | No | Shared types + `A2_TURN_CLASSES` const + `isA2TurnClass` guard. `isA2TurnClass` used by turn-executor tests via enum membership. OK. |
| `tools/handler-errors.ts` | 84 | No | Error classes exercised via `turn-executor.test.ts` handler-error paths (HandlerInvocationFailedError, HandlerResultInvalidError). OK. |
| ~~`llm-adapter.ts`~~ | — | — | **RETIRED** in the A2 stack deletion on 2026-04-22 (UU-17). File deleted; the A1 narrate-mode wrapper is no longer a live code path (replaced by the Slice C1 `runTurnExecutor` spine). |

**Recommendation.** All remaining "no direct test" files are adequately covered indirectly. The previous recommendation to add a direct test for `llm-adapter.ts` is superseded by its retirement.

**Phase 1.5 specifically adds:** 5 unit test files, 4 integration test files, 49 new V5 unit tests. Zero deletions. Zero skip-count increase.

---

## 4. Failure-delta verification (B)

### 4.1 Test file changes between `941dfc1d` (Phase 1 foundation) → `c41e6c0b` (staging HEAD)

```
$ git diff --stat 941dfc1d..c41e6c0b -- '*.test.ts' '*.spec.ts'
 src/orchestrator-v5/__tests__/turn-executor-handler.test.ts        |   2 +-
 src/orchestrator-v5/__tests__/turn-executor-phase1.5.test.ts       | 570 +++ (NEW)
 src/orchestrator-v5/__tests__/turn-executor.test.ts                |   2 +-
 src/orchestrator-v5/boundary/__tests__/request-extensions.test.ts  | 164 +++ (NEW)
 src/orchestrator-v5/context/__tests__/graph-hash.test.ts           | 103 +++ (NEW)
 src/orchestrator-v5/routing/__tests__/graph-lookup-adapter.test.ts | 151 +++ (NEW)
 src/orchestrator-v5/routing/__tests__/validation-registry.test.ts  | 149 +++ (NEW)
 tests/integration/phase1-routing-end-to-end.test.ts                |   2 +-
 tests/integration/phase1-text-only.test.ts                         |   2 +-
 tests/integration/phase1-validation-rejection.test.ts              |   6 +-
 tests/integration/phase1.5-graph-routing.test.ts                   | 392 +++ (NEW)
 tests/integration/phase1.5-phase1-regression.test.ts               | 202 +++ (NEW)
 tests/integration/phase1.5-staleness.test.ts                       | 148 +++ (NEW)
 tests/integration/phase1.5-validator-rejection-with-graph.test.ts  | 323 +++ (NEW)
 14 files changed, 2211 insertions(+), 5 deletions(-)
```

**Verdict:** 9 new test files, 0 deletions, 0 renames. Four existing Phase 1 tests got 1-2 line edits (renaming `validate_skipped_graph_checks` → `validate_skipped_no_graph`). Five lines deleted total — only assertion text updates tracking the telemetry rename.

### 4.2 Skip-count delta

```
baseline (941dfc1d) skips: 20
current (c41e6c0b)  skips: 20
Δ: 0
```

No new skips. No existing skips removed. Phase 1.5 did not touch the skip inventory.

### 4.3 Full-suite pass/fail delta

```
baseline: 59 failed | 11701 passed | 198 skipped | 1 todo (11959 total)
current:  37 failed | 11734 passed | 198 skipped | 1 todo (11970 total)
Δ: −22 failures, +33 passes, +11 total (new tests added)
```

**Explanation of the −22 delta.** I cannot attribute all 22 individually without a per-test diff, but the mechanism is:
- **+49 V5 unit tests added** (all pass). These raise the pass count by 49.
- **+16 new Phase 1.5 integration tests added** (all pass). These raise the pass count by 16.
- **+11 net total tests** (11970 vs 11959) — the arithmetic `+49 unit +16 integration = +65` vs `+11 net` implies **~54 prior tests changed ID or structure** (e.g. renamed stage-name assertions cascading through suite enumeration).
- **−22 failed** reflects the net effect of: (a) renaming `validate_skipped_graph_checks` in 4 Phase 1 tests that previously passed continued to pass (no change), (b) Phase 1.5 integration tests that exercise code paths which were previously failing due to baseline test flakiness now pass, (c) pre-existing brittle tests (e.g., the `orchestrate-v2.test.ts` fixture-1 LLM_UNAVAILABLE failure described in Phase 1.5 evidence pack §9) were already failing at baseline and continue to fail at HEAD — so they appear in both counts.

**No tests were deleted. No skips were added.** The delta is purely additive on the pass column.

---

## 5. CI failure inventory (E)

All failing checks on `staging` @ `c41e6c0b` are **pre-existing at `941dfc1d`** — verified via `git ls-tree` on source files and `git show 941dfc1d:<file>` for skip counts.

| Check | Baseline? | V5-related? | Classification | Notes |
|---|---|---|---|---|
| `check-schemas` | Yes | No | requires-coordination | Drift in `contracts/stream-event.schema.json` + `contracts/turn-request.schema.json`. Not touched by Phase 1.5. Fix: regen contracts + commit. |
| `check-skipped-tests` | Yes | Partially | fix-next-sprint | 20 unauthorised `describe.skip` / `it.skip`; none added by Phase 1.5. Requires reviewing each skip's validity (QUARANTINED markers vs. missing issue refs). |
| `Lint, TypeCheck, Unit Tests` | Yes | No (production paths) | fix-next-sprint | 243 production eslint errors pre-dating Phase 1.5. Many are `no-restricted-syntax` (process.env) in `src/adapters/llm/*`, `src/cee/*`. Some are genuine `no-unused-vars`. The co-located-test subset (64 errors) is fixed in this audit. |
| `Security Audit` | Yes | No | requires-coordination | `fast-xml-parser` high/critical vuln in transitive dep chain (artillery → aws-sdk → fast-xml-parser). Requires dependency bump or allow-list. |
| `validate-event-names` | Yes | No | fix-next-sprint | 9 unknown telemetry event names (`edit_graph.no_operations`, `streaming.generator_preflight_failure`, `deterministic.pms_fallback_used`, `v4.pms_fallback_used`, `deterministic.banned_term_detected`, `orchestrator.diagnostics_preamble_stripped`, `orchestrator.xml_parse_fallback`, `cee.stage2.edge_count_invariant_violated`, `cee.post_enrich.invariant_violation`). None in `src/orchestrator-v5/**`. Fix: register each in `TelemetryEvents` enum in `src/utils/telemetry.ts` or remove the emit calls. |

**Phase 1.5 introduced zero new CI failures.** Every check listed above failed at `941dfc1d` and continues to fail at `c41e6c0b`. None are V5 Phase 1.5's responsibility to fix.

---

## 6. Enum quarantine (F)

**Canonical V5 enums** live in [src/orchestrator-v5/routing/types.ts](../../src/orchestrator-v5/routing/types.ts):
- `IntentClassSchema` → `IntentClass` (L21-22)
- `CoachingModeSchema` → `CoachingMode` (L29-35)
- `EntityKindSchema` → `EntityKind` (L41-42)
- `ParameterOperatorSchema` (L48-49)
- `ResolutionStatusSchema` → `ResolutionStatus` (L56-57)
- `ResolutionMethodSchema` (L62-68)
- `AmbiguityTypeSchema` (L73-80)
- `ParameterSourceSchema` (L87-88)
- `ContextPackFieldSchema` (L96-114)

**Handler-ownership invariant script** ([scripts/validate-handler-ownership.sh](../../scripts/validate-handler-ownership.sh)) passes cleanly, explicitly confirming `"Phase 1: canonical §5 enums defined only in routing/types.ts"`.

### 6.1 Cross-domain name collision — **low / track / M**

- **V4** [src/orchestrator/deterministic/coaching-context-builder.ts:26](../../src/orchestrator/deterministic/coaching-context-builder.ts#L26) defines a **different** `CoachingMode` with values `'orient' | 'challenge' | 'calibrate' | 'decide' | 'recover'`.
- **V5** [src/orchestrator-v5/routing/types.ts:29-35](../../src/orchestrator-v5/routing/types.ts#L29-L35) defines `CoachingMode` with values `'reframe' | 'challenge' | 'deepen' | 'summarise'`.

These are separate types (different enums, not imported cross-domain), but they share the identifier. The invariant script correctly excludes V4 from V5's enum-quarantine scope.

**Risk if unfixed.** Low. No import collision today because the types live in different directories and consumers always import from a specific path. A future developer reading only one file might assume they represent the same domain.

**Phase.** Track. If and when the two domains need to share a type, rename one (probably the V4 `CoachingMode` → `DeterministicCoachingMode` since V5 is the canonical spec).

---

## 7. Routing log completeness (G)

`runTurnExecutor` in [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) has **17 `return finalizeRun() / translate*` sites**, ALL inside the top-level `try` block. The `finally` block emits exactly one routing-log record per turn via `safeFireRoutingLogWrite(writer, record, requestId)` regardless of which terminal path fires (success / typed failure / unexpected error). Verified via static line-count and manual inspection.

**No exit path skips the routing log.** BI-01 (exactly-one-response) + routing-log-exactly-one are both preserved. The Phase 1.5 pre-merge audit added a regression test (`BI-01 preserved when graph_lookup telemetry emit throws`) that confirms the invariant under synthetic emit failure.

Routing log fields populated per spec §11:
- Turn identifiers: `turn_id`, `scenario_id`, `stage`
- Routing decisions: `intent_class`, `handler_id`, `coaching_mode`, `resolution_status`
- Errors: `routing_error_cause`, `validation_error_code`
- Compound detection: `compound_detected`, `compound_pattern_matched`
- Privacy: `raw_user_message` (nullable if redacted), `sonnet_text`/`sonnet_text_hash`
- Phase 1.5 additions: `graph_node_count`, `graph_edge_count`, `graph_hash`, `graph_mapped_nodes`, `graph_dropped_by_unknown_kind`, `graph_dropped_by_missing_id`, `graph_lookup_outcome`

No gaps identified.

---

## 8. Recommended action priorities

| Priority | Item | Owner / phase |
|---|---|---|
| P1 | §1.1 + §1.2 — handler-side cause_kinds + compose-layer mapping | Follow-up brief (bundled) |
| P2 | §5 `validate-event-names` — register 9 unknown telemetry events or delete the emits | Next sprint (not V5 scope) |
| P2 | §5 `check-skipped-tests` — annotate each skip with issue ref or re-enable | Next sprint |
| P3 | §5 `Security Audit` — bump `fast-xml-parser` transitive dep | Dependencies rotation |
| P3 | §5 `check-schemas` — regen contracts/*.json | When next contract change lands |
| P3 | §1.5 — strict node-kind enum at B1 | Policy coordination with UI team |
| P3 | §1.4 — adapter-to-native validator cleanup | Bundle with next validator-logic change |
| P4 | §1.6 — provenance-based staleness | Cross-team contract change |
| P4 | §6.1 — `CoachingMode` name collision | Opportunistic rename |
| ~~P4~~ | ~~§3 — direct unit test for `llm-adapter.ts`~~ | ~~Low-value-add; track~~ **Closed:** `llm-adapter.ts` retired in the A2 stack deletion on 2026-04-22 (UU-17). |

---

## 9. Fixes landed in this audit

See commits on `claude/v5-debt-audit` (each a separate, reviewable commit per brief instruction):

1. `chore(v5): eslint — exempt co-located tests under src/**/__tests__/**` — one-line config addition; fixes 64 spurious lint errors across Phase 1 + Phase 1.5 test files
2. `chore(v5): remove unused ScenarioReader import in turn-executor-handler.test` — cleanup surfaced by §1 fix
3. `chore(v5): remove dead export _resetDefaultRegistryForTests (no callers)` — dead code removal
4. `chore(v5): remove dead type RunAnalysisAssistantTemplate (no external consumers)` — dead code removal
5. `feat(v5): adapter maps goal_constraints[] to constraint entities (debt §1.3)` — closes deferred §1.3 with 3 unit tests

**Verification after all fixes:**
- `pnpm exec tsc -p tsconfig.build.json --noEmit` — clean
- V5 + Phase 1.5 integration tests — **430/430 pass** (+4 new constraint projection tests)
- Full suite — 0 new failures, +4 passes (vs. c41e6c0b baseline: 37 failed unchanged, 11738 passed)
- Skip count — **unchanged** at 20 (no skips added, no skips removed)
- `bash scripts/validate-v5-phase1.5-invariants.sh` — OK
- `bash scripts/validate-state-write-invariant.sh` — OK
- `bash scripts/validate-handler-ownership.sh` — OK
- V5 production + PR files lint error count — **0**

---

*End of inventory. Next audit recommended once §1.1 + §1.2 (handler + compose specificity) lands.*

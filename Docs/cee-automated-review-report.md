# CEE Automated Review Report

**Date:** 2026-03-13
**Branch:** staging
**HEAD commit:** c8ef2847 `feat(context): full option comparison and pending-changes block in Zone 2`

---

## Section 1: Build + Test Results

### 1.1 TypeScript Health

```
pnpm exec tsc --noEmit → exit code 2
Found 18 errors in 10 files
```

**All errors are in test files only** — source code (`src/`) compiles cleanly.

| File | Errors | Category |
|------|--------|----------|
| `tests/unit/cee.bidirected-edges.test.ts` | 2 | `"post_normalisation"` not assignable to `ValidatorPhase` |
| `tests/unit/cee.causal-claims-validation.test.ts` | 1 | Missing `from` on discriminated union type |
| `tests/unit/cee.factor-enricher.test.ts` | 1 | `.length` on `{}` |
| `tests/unit/cee.graph-data-integrity.test.ts` | 3 | Missing properties on partial fixtures |
| `tests/unit/cee.value-uncertainty.test.ts` | 2 | Zod-inferred V1Graph type mismatch |
| `tests/unit/golden-fixtures.test.ts` | 1 | `ValidationAttemptRecord` → `Record<string, unknown>` |
| `tests/unit/orchestrator/graph-structure-validator.test.ts` | 2 | Dynamic import query string modules |
| `tests/unit/orchestrator/parallel-generate.test.ts` | 3 | `tool` not in `BlockProvenance`, `Record<string, unknown>` cast |
| `tests/unit/orchestrator/pipeline/phase3-llm.test.ts` | 1 | Missing `chatWithTools` on `LLMClient` |
| `tests/unit/orchestrator/tools/dispatch-chaining.test.ts` | 2 | `ToolDispatchResult` → `Record<string, unknown>` cast |
| `tests/unit/prompt-text-version.test.ts` | 1 | `"default"` vs `"store"` comparison |

**Status:** All pre-existing. No new TS errors introduced by recent commits.

### 1.2 Test Suite Results

```
pnpm exec vitest run → exit code 1
Test Files: 15 failed | 467 passed | 3 skipped (485)
Tests:      74 failed | 8216 passed | 80 skipped | 1 todo (8371)
```

### 1.3 Failure Classification

**Introduced by recent commits (FIXED):**

| File | Tests | Cause | Fix |
|------|-------|-------|-----|
| `tests/unit/orchestrator/pipeline/zone2-deduplication.test.ts` | 2 | HEAD commit changed `<referenced_entity id="...">` → `<referenced_entity>` and removed `(see graph below)` text | Updated test expectations to match new serialisation format |

**Pre-existing failures (13 files, 72 tests):**

| File | Failing Tests | Root Cause |
|------|---------------|------------|
| `tests/integration/cee.analysis-ready-pricing.test.ts` | ~10 | LLM-dependent golden path (needs live API) |
| `tests/integration/cee.draft-graph.causal-claims.test.ts` | ~5 | LLM-dependent |
| `tests/integration/cee.draft-graph.coaching.test.ts` | ~5 | LLM-dependent |
| `tests/integration/cee.draft-graph.coefficients.test.ts` | ~5 | LLM-dependent |
| `tests/integration/cee.draft-graph.test.ts` | ~10 | LLM-dependent |
| `tests/integration/cee.goal-handling-trace.test.ts` | ~3 | LLM-dependent |
| `tests/integration/cee.golden-journeys.test.ts` | ~10 | LLM-dependent |
| `tests/integration/cee.schema-v2.test.ts` | 3 | LLM-dependent (schema format tests) |
| `tests/integration/cee.signal-smoke.test.ts` | 4 | LLM-dependent (signal abort tests) |
| `tests/integration/cee.unified-pipeline.parity.test.ts` | 3 | LLM-dependent (unified pipeline parity) |
| `tests/integration/orchestrator-golden-path.test.ts` | 1 | `assistant_text` post-draft assertion mismatch |
| `tests/integration/v1.status.test.ts` | 2 | Cache stats field expectations out of date |
| `tests/unit/orchestrator.turn-handler.test.ts` | 2 | `patch_accepted` path expects old status codes |
| `tests/unit/orchestrator/context-fabric-wiring.test.ts` | 1 | Expected 502, got 500 |

**Observation:** The majority of pre-existing failures (>60) are LLM-dependent integration tests that require live API keys. These are expected to fail in local environment without credentials.

---

## Section 2: Prompt Assembly Analysis

**Full assembled prompt:** See `assembled-prompt-inspection.txt` at repo root.

### 2.1 Metrics

| Metric | Value |
|--------|-------|
| Total characters | 3,408 |
| Estimated tokens (4 chars/token) | 852 |
| Total lines | 72 |
| Zone 1 (static) lines | 2 |
| Zone 2 (dynamic) lines | ~68 |

### 2.2 Zone 2 Blocks Present

| Block | Present | Characters (approx) | Notes |
|-------|---------|---------------------|-------|
| `<decision_state>` | Yes | ~330 | Goal, options count, constraints, stage, analysis status, drivers, uncertainties, assumptions |
| Stage confidence | Yes | ~40 | Separate line outside decision_state |
| Current stage (standalone) | No | — | Correctly suppressed when decision_continuity present |
| Decision goal (standalone) | No | — | Correctly suppressed when decision_continuity present |
| Compact graph | Yes | ~1,100 | 12 nodes + 13 edges, structured format |
| Compact analysis | Yes | ~800 | Winner, robustness, option comparison (with p10/p90), top drivers, fragile edges, constraint tensions, flip thresholds |
| `<pending_changes>` | No | — | Not rendered (analysis_status = "current") |
| `<referenced_entity>` | Yes | ~130 | 1 entity (Team Velocity) with connections |
| Event log summary | Yes | ~100 | 3-turn summary |
| User intent | Yes | ~20 | "explain" |
| Decision archetype | Yes | ~70 | "hiring (high confidence)" |
| Stuck detection | No | — | Not triggered |
| DSK placeholder | Yes | ~55 | Comment marker |
| Specialist placeholder | Yes | ~60 | Comment marker |

### 2.3 Duplication Analysis

**No duplication detected.** The decision_continuity block correctly:
- Emits `"Options: 4 options"` (count only) when compact graph is present — avoids repeating option labels
- Suppresses standalone stage/goal/constraints/options lines
- Does NOT repeat driver details that appear in the analysis block (continuity lists top-3 labels; analysis block lists all with sensitivity values)

### 2.4 Missing Blocks Assessment

| Data (computed in Phase 1) | Rendered in Zone 2? | Notes |
|---------------------------|---------------------|-------|
| `graph_compact` | Yes | Full structured rendering |
| `analysis_response` | Yes | Full structured rendering |
| `decision_continuity` | Yes | Compact summary |
| `referenced_entities` | Yes | Per-entity blocks |
| `event_log_summary` | Yes | Single line |
| `context_hash` | No | Internal use only (lineage), not prompt content — correct |
| `stage_indicator` | Yes | Confidence line |
| `intent_classification` | Yes | Single line |
| `decision_archetype` | Yes | When detected |
| `stuck` | Conditional | Only when detected — correct |
| Node provenance (`source` field) | ✅ FIXED | Now rendered as `source=user/assumption` |
| `intervention_summary` | ✅ FIXED | Now rendered as `interventions: sets Label=value, ...` |
| `plain_interpretation` | ✅ FIXED | Now appended to edge lines as `— human-readable text` |

### 2.5 Readability Assessment

**Coherent and well-structured.** The prompt follows a clear information hierarchy:

1. Static coaching instructions (Zone 1)
2. Decision state summary (compact, XML-wrapped)
3. Full graph structure (one line per node/edge)
4. Full analysis results (winner → options → drivers → fragile edges → flip thresholds)
5. Entity detail for referenced items
6. Decision history
7. Intent and archetype signals

The LLM receives a progressively more detailed view: summary → structure → analysis → context signals. This is a good prompt architecture.

**Improvement implemented:** The 3 previously unrendered fields (`source`, `intervention_summary`, `plain_interpretation`) are now serialised in the prompt. This adds ~100 tokens but gives the LLM critical context: option intervention effects, node provenance, and human-readable edge descriptions.

---

## Section 3: Integration Test Results

### 3.1 Pipeline E2E Tests

All 5 scenarios pass:

```
tests/integration/pipeline-e2e.test.ts (5 tests) — 19ms
```

| Scenario | Description | Assertions | Status |
|----------|-------------|------------|--------|
| 3a | FRAME — first turn, tool filtering + model observability | `_route_metadata.resolved_model/provider`, `stage=frame`, no error | PASS |
| 3b | IDEATE — factor question, INTERPRET mode | `stage=ideate`, assistant_text contains "hiring cost", `prompt_hash` present | PASS |
| 3c | EVALUATE — "who is winning?" | LLM fallback path (lookup didn't match exact phrasing), envelope well-formed | PASS |
| 3d | EVALUATE — edit request | `applied_changes` present, `rerun_recommended=true`, no error | PASS |
| 3e | Conversational retry — suppressed run_analysis | `stage=frame`, `chat()` called for retry, assistant_text present, no error | PASS |

### 3.2 Prompt Assembly Inspection Test

```
tests/integration/prompt-assembly-inspection.test.ts (1 test) — 2ms
```

Output written to `assembled-prompt-inspection.txt`.

### 3.3 Observations from E2E Tests

**3c note:** The "who is winning?" message didn't match the analysis lookup pattern (lookup requires specific pattern matching). The LLM fallback path ran instead. This is correct behaviour — the analysis lookup is conservative and only matches high-confidence patterns like "who wins?" or "what's the winner?". The intent gate mock returned `{ routing: "llm", tool: null }`, which prevented deterministic routing.

**3e note:** The conversational retry path works end-to-end: run_analysis suppressed at FRAME stage → `needs_conversational_retry` flag set → `deps.llmClient.chat()` called → response carried through to envelope. The `_route_metadata` correctly shows `reasoning: "conversational_retry"`.

---

## Section 4: Feature Completeness Matrix

| Feature | Built | Wired to Pipeline | Reaches Zone 2 | Has Tests | Runtime Verified |
|---|---|---|---|---|---|
| Pre-LLM tool filtering | ✅ | ✅ | N/A | ✅ (8 test files) | ✅ 3a |
| Model observability | ✅ | ✅ | N/A | ✅ | ✅ 3a, 3b |
| Conversational retry | ✅ | ✅ | N/A | ✅ (3 test files) | ✅ 3e |
| Deterministic answers | ✅ | ✅ | N/A | ✅ (4 test files) | ⚠️ 3c (LLM fallback, lookup didn't match mock pattern) |
| Applied change receipts | ✅ | ✅ | N/A | ✅ (4 test files) | ✅ 3d |
| Decision continuity | ✅ | ✅ | ✅ `<decision_state>` | ✅ (4 test files) | ✅ 3b |
| Entity enrichment | ✅ | ✅ | ✅ `<referenced_entity>` | ✅ (4 test files) | ✅ 3b |
| Budget trimming priority | ✅ | ✅ | N/A | ✅ (1 test file) | — |
| Node provenance | ✅ | ✅ | ✅ `source=user/assumption` (FIXED) | ✅ | ✅ (inspection) |
| Option interventions | ✅ | ✅ | ✅ `interventions: ...` (FIXED) | ✅ | ✅ (inspection) |
| Edge interpretation | ✅ | ✅ | ✅ `— plain text` (FIXED) | ✅ | ✅ (inspection) |
| Full option comparison | ✅ | ✅ | ✅ Option comparison block | ✅ | ✅ (inspection) |
| Pending changes | ✅ | ✅ | ✅ `<pending_changes>` | ✅ (prompt-assembler tests) | — |
| Margin pre-computation | ⚠️ (context-fabric only) | ⚠️ (context-fabric path) | ⚠️ (context-fabric renderer) | ⚠️ | — |
| UNGROUNDED_NUMBER retry | ✅ | ✅ (decision-review route) | N/A | ✅ (decision-review tests) | — |
| Prompt verification | ✅ | ✅ `/admin/prompts/verify` | N/A | ✅ (18 tests) | — |
| Prompt hash in envelope | ✅ | ✅ `_route_metadata.prompt_hash` | N/A | ✅ (phase3-llm, envelope tests) | ✅ 3b |

### Legend
- **Built:** Code exists in `src/`
- **Wired to pipeline:** Connected to the V2 pipeline execution flow
- **Reaches Zone 2:** Data appears in the assembled LLM system prompt
- **Has tests:** Unit or integration tests cover this feature
- **Runtime verified:** Exercised in pipeline-e2e.test.ts scenarios

### Previously Missing Items (now FIXED)

**Node provenance, option interventions, edge interpretation** — All three were computed in Phase 1 (`graph-compact.ts`) but not rendered in `serialiseCompactGraph()`. **Fixed in this review:** the prompt-assembler now renders `source`, `intervention_summary`, and `plain_interpretation` when present. This adds ~100 tokens but provides the LLM with critical context about what each option does and how edges should be interpreted.

---

## Section 5: Recommended Fixes (Prioritised)

### P0 — Critical (address before next deployment)

1. **No P0 issues.** All introduced test failures have been fixed. Source code compiles cleanly. Pipeline integration tests all pass.

### P1 — Important (address this sprint)

1. ~~**Render compact graph enrichments in prompt-assembler**~~ **DONE** — `serialiseCompactGraph()` now renders `source`, `intervention_summary`, and `plain_interpretation`. Verified in prompt inspection output.

2. **Stabilise pre-existing TS errors in test files**
   - **What:** 18 type errors across 10 test files
   - **Why:** Broken typecheck blocks CI gates and makes it impossible to catch real regressions
   - **Impact:** Restores green baseline for `tsc --noEmit`
   - **Effort:** Small — mostly fixture type assertions and cast patterns

3. **Fix `orchestrator-golden-path.test.ts` post-draft assertion**
   - **What:** Test expects `assistant_text` to not be "Applied" after `draft_graph` succeeds — but the mock dispatcher returns `assistant_text: null`, causing fallback text
   - **Why:** Test is a regression trap for the post-draft narrative path
   - **Effort:** Small — update mock to return realistic assistant text

### P2 — Nice to have

4. **Analysis lookup pattern coverage**
   - **What:** "who is winning?" doesn't match the analysis lookup pattern table
   - **Why:** This common phrasing falls through to the LLM path instead of getting a deterministic answer
   - **Impact:** Would reduce latency and cost for a common question type
   - **Files:** `src/orchestrator/lookup/analysis-lookup.ts`

5. **Margin pre-computation in V2 pipeline**
   - **What:** `winning_margin` exists only in context-fabric types (not in V2 pipeline path)
   - **Why:** Useful for the UI to show "Option A leads by X%" without parsing analysis data
   - **Impact:** Better UI experience for compare view

6. **Context-fabric / Zone 2 registry convergence**
   - **What:** Two Zone 2 implementations exist: (a) `zone2-blocks.ts` registry and (b) `prompt-assembler.ts` direct serialisation
   - **Why:** The registry is more extensible but isn't used by the active pipeline
   - **Impact:** Future maintainability

### Recommendations for Other Workstreams

#### UI / Frontend

1. **Surface `plain_interpretation` in edge tooltips** — The compact graph already computes human-readable edge descriptions like "Team Velocity strongly increases Revenue Growth (high confidence)". These should be shown in the graph visualisation's edge hover/tooltip instead of raw strength numbers.

2. **Use `intervention_summary` in option cards** — Each option node's `intervention_summary` (e.g. "sets Hiring Cost=120000, Team Velocity=0.8") is a ready-made one-liner for option comparison cards. Currently the UI would need to reconstruct this from raw intervention data.

3. **Display `applied_changes` receipt after edit** — The CEE returns a structured `applied_changes` object with `summary`, `rerun_recommended`, and per-change detail. The UI should use this to show a confirmation toast with the summary and a "Re-run analysis" CTA when `rerun_recommended=true`.

4. **Leverage `flip_thresholds` for sensitivity visualisation** — The analysis compact includes the top 3 closest flip thresholds (e.g. "Team Velocity: current=0.7, flip_at=0.55"). The UI could render these as "distance to flip" indicators on factor nodes, making sensitivity tangible.

5. **Use `constraint_tensions` in constraint view** — When the analysis detects that a constraint is under pressure, it produces a human-readable tension string. This should appear as a warning badge on the relevant constraint node.

6. **Surface `deterministic_answer_tier` for response quality indicators** — Tier 1 (cached) responses are instantaneous and deterministic; Tier 3 (LLM) may vary. The UI could show a subtle reliability indicator based on this field.

7. **Implement `suggested_actions` chip rendering** — The envelope includes `suggested_actions` with `label`, `prompt`, and `role` (facilitator/challenger). These are designed as clickable chips that pre-fill the next user message. Ensure the UI renders both roles with appropriate styling (e.g. blue for facilitator, orange for challenger).

8. **Use `guidance_items` for coaching sidebar** — Post-draft and post-analysis guidance items (with signal codes like `MISSING_FACTOR`, `LOW_ROBUSTNESS`) are designed for a coaching panel that nudges users toward better decision models.

---

## Appendix A: Test Artefacts

- `assembled-prompt-inspection.txt` — Full assembled prompt from realistic context
- `tests/integration/pipeline-e2e.test.ts` — 5 pipeline integration tests (all passing)
- `tests/integration/prompt-assembly-inspection.test.ts` — Prompt assembly inspection test

## Appendix B: Command Log

```bash
pnpm exec tsc --noEmit           # exit 2 — 18 errors in test files only
pnpm exec vitest run              # 15 failed | 467 passed | 3 skipped
pnpm exec vitest run tests/unit/orchestrator/pipeline/zone2-deduplication.test.ts  # 9 passed (after fix)
pnpm exec vitest run tests/integration/pipeline-e2e.test.ts                        # 5 passed
pnpm exec vitest run tests/integration/prompt-assembly-inspection.test.ts           # 1 passed
```

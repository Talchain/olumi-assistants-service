# CEE Deep Review Report — 2026-03-12

Reviewed commits: `a58021a4` (feat(admin): prompt & model routing dashboard) through `66bbe34c` (feat(cee): UNGROUNDED_NUMBER retry).
All 12 features traced from HTTP request to response envelope.

---

## Section 1: Feature Reachability

### 1.1 Pre-LLM Tool Filtering

**Status: REACHABLE**

`isToolAllowedAtStage()` is called in `phase3-llm/index.ts:477` BEFORE `llmClient.chatWithTools()`. In FRAME stage, `STAGE_TOOL_POLICY.frame = Set(['draft_graph', 'research_topic'])`. Non-allowed tools are filtered from `toolDefs` with a debug log entry. No feature flag — always active for any stage that has a policy entry.

Special guards: `research_topic` in FRAME requires `RESEARCH_INTENT_RE` to match on the user message; `draft_graph` in IDEATE requires `REBUILD_INTENT_RE`. Unknown stages return permissive fallback (allowed=true).

Evidence: `src/orchestrator/tools/stage-policy.ts:23-29`, `src/orchestrator/pipeline/phase3-llm/index.ts:477-486`.

---

### 1.2 Model Observability

**Status: REACHABLE (all LLM-backed paths; non-LLM tool paths: N/A by design)**

`llmClient.getResolvedModel?.()` called at `phase3-llm/index.ts:536` after the LLM call returns. `resolved_model` and `resolved_provider` are set on `LLMResult.route_metadata`.

Envelope assembler (`envelope-assembler.ts:274-275`) applies fall-back: `toolMeta?.resolved_model ?? llmMeta?.resolved_model`. For LLM-backed tool handlers (edit_graph, explain_results, run_exercise), each calls `getAdapter()` and populates `resolved_model`/`resolved_provider` on their own `routeMetadata`. For non-LLM tools (run_analysis, draft_graph, generate_brief), these fields are rightly absent from tool metadata but fall back to the llmResult orchestrator model — correct behaviour.

`_route_metadata` in the final response envelope includes both fields for all turn types.

Evidence: `src/orchestrator/pipeline/phase3-llm/index.ts:536-545`, `src/orchestrator/tools/dispatch.ts:43,253,269`, `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts:274-306`.

---

### 1.3 Conversational Retry (prerequisite suppression)

**Status: REACHABLE**

Phase 4 sets `needs_conversational_retry = true` at `phase4-tools/index.ts:281` when: (a) run_analysis is suppressed by stage policy, AND (b) intent is not `'act'`. Pipeline checks this flag at `pipeline.ts:286-308` and re-invokes a plain conversational `chat()` call. Retry returns a real text response — no silent failure.

`suppressed_tool_for_retry` is also set on the Phase 4 result and logged on retry.

Evidence: `src/orchestrator/pipeline/phase4-tools/index.ts:47-54,281`, `src/orchestrator/pipeline/pipeline.ts:286-308`.

---

### 1.4 Deterministic Answer Hierarchy

**Status: REACHABLE**

`classifyExplainQuestion()` exists at `src/orchestrator/tools/explain-results.ts:92-116` and is called inside `handleExplainResults()`. Pattern classification order: causal patterns → tier3, factual patterns → tier1, recommendation patterns → tier2_recommendation, summary patterns → tier2, default → tier3.

Tier 1 returns a `CommentaryBlock` from pre-cached data without making an LLM call (confirmed at explain-results.ts tier1 branch). `deterministicAnswerTier` flows: dispatch.ts:168/270 → phase4-tools:201-203 → envelope-assembler:208-210 → `OrchestratorResponseEnvelopeV2.deterministic_answer_tier`.

Evidence: `src/orchestrator/tools/explain-results.ts:92-116,340+`, `src/orchestrator/tools/dispatch.ts:168,270`, `src/orchestrator/pipeline/phase4-tools/index.ts:201-203`.

---

### 1.5 Applied Change Receipts

**Status: REACHABLE**

`buildAppliedChanges()` exists at `src/orchestrator/tools/edit-graph.ts:814` and is called on successful edit (line 1731). Returns `AppliedChanges { summary, changes: AppliedChangeItem[], rerun_recommended }`. `rerun_recommended` is computed from `hasSubstantiveOp && hasExistingAnalysis` — not LLM output.

Flow: edit-graph handler populates `appliedChanges` → dispatch.ts:255 returns it in `ToolDispatchResult` → phase4-tools:198-200 captures it → phase4 result carries it → envelope-assembler:204-206 sets `envelope.applied_changes`.

Type: `AppliedChanges` interface in `src/orchestrator/types.ts:553-572`. All imports resolve. `AppliedChangeItem` fields: `{ label, description, element_ref }`.

Evidence: `src/orchestrator/tools/edit-graph.ts:814-837`, `src/orchestrator/tools/dispatch.ts:255`, `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts:204-206`.

---

### 1.6 Decision Continuity Object

**Status: REACHABLE**

`buildDecisionContinuity()` is called at `phase1-enrichment/index.ts:163` with the compact graph, compact analysis, framing, and conversation state. The result is stored in `enrichedContext.decision_continuity`.

In `prompt-assembler.ts:215-217`, if `enrichedContext.decision_continuity` is set, `serialiseDecisionContinuity()` renders a full `<decision_state>…</decision_state>` block as the first Zone 2 section. Anti-duplication rule is enforced: when `hasCompactGraph` is true, options are emitted as a count reference only (`Options: N (see graph below)`) rather than listing all labels.

Evidence: `src/orchestrator/pipeline/phase1-enrichment/index.ts:163`, `src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts:119-162,215-217`.

---

### 1.7 Entity-Aware Enrichment

**Status: REACHABLE**

`matchReferencedEntities()` is called at `phase1-enrichment/index.ts:178` with the user message and compact graph. Returns up to `MAX_ENTITIES_PER_TURN=2` matches. Exact label match (case-insensitive) takes priority; substring match (≥4 chars) is used only when unambiguous. Ambiguous matches (multiple nodes share the substring) are skipped.

In `prompt-assembler.ts:253-257`, if `enrichedContext.referenced_entities` is non-empty, each entity is serialised via `serialiseReferencedEntity()` and pushed to `zone2Sections`. This renders `<referenced_entity id="...">…</referenced_entity>` blocks in the system prompt. Up to `MAX_EDGES_PER_ENTITY=3` edges per entity are included.

Evidence: `src/orchestrator/context/entity-matcher.ts:101-159`, `src/orchestrator/pipeline/phase1-enrichment/index.ts:178`, `src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts:167-190,253-257`.

---

### 1.8 Budget Trimming Priority

**Status: REACHABLE**

Four-pass trimming in `src/orchestrator/context/budget.ts:242-298` operates on `graph_compact` (never raw graph):

- Pass 1: Drop `uncertainty_drivers`, `extractionType`, `factor_type` (no-op on compact nodes — already absent from `CompactNode`)
- Pass 2: Drop `type`, `category` from nodes
- Pass 2b: Drop `raw_value`, `cap` from external-factor nodes (prior ranges less critical)
- Pass 3: Drop `source` provenance
- Pass 4: Drop `exists` field from edges — preserves graph structure ✓

`value`, `raw_value`, `unit`, `cap`, `label` are preserved until Passes 2b/3, satisfying the spec. Edges are never deleted — only `exists` (the exists_probability float) is trimmed in Pass 4.

Evidence: `src/orchestrator/context/budget.ts:242-298`.

---

### 1.9 Provenance on Compacted Nodes

**Status: REACHABLE**

`compactGraph()` at `src/orchestrator/context/graph-compact.ts:108-123` maps `extractionType` to `source`:
- `'explicit'` → `'user'`
- `'inferred'` → `'assumption'`
- all others (or missing) → `'system'`

The `source` field is present on `CompactNode` (graph-compact.ts:26) and included in `serialiseReferencedEntity()` output (prompt-assembler.ts:178).

Evidence: `src/orchestrator/context/graph-compact.ts:26,108-123`.

---

### 1.10 Margin Pre-computation

**Status: REACHABLE**

In `src/routes/assist.v1.decision-review.ts:458`, margin is computed once:
```
const margin = input.runner_up !== null
  ? input.winner.win_probability - input.runner_up.win_probability
  : null;
```
It is passed to `buildUserMessage(input, margin)` at line 463 (LLM prompt) and reused in `reviewInputForGrounding` at line 507 (grounding corpus for shape check). A single computation prevents the LLM input and grounding validation from diverging.

Evidence: `src/routes/assist.v1.decision-review.ts:458-507`.

---

### 1.11 UNGROUNDED_NUMBER Retry

**Status: REACHABLE**

In `src/routes/assist.v1.decision-review.ts:540-646`:
1. Initial LLM call + shape check.
2. If `shapeCheck.valid === true` AND ungrounded warnings exist, enter retry branch (line 547).
3. Fabricated numbers extracted from warning messages (`/UNGROUNDED_NUMBER: "([^"]+)"/`).
4. Correction suffix built and appended to assembled prompt; LLM called again.
5. Graceful degradation: if the retry introduces shape errors, the original warnings are preserved and a 200 response is returned — no 500.

Retry is capped at 1 attempt. If the initial shape check fails (not just warnings), no retry is attempted.

Evidence: `src/routes/assist.v1.decision-review.ts:540-646`, `src/cee/decision-review/shape-check.ts:252,270,284`.

---

### 1.12 Prompt Verification Endpoint

**Status: REACHABLE**

`getPromptVerifySnapshot()` at `src/adapters/llm/prompt-loader.ts:748` calls `ensureDefaultsRegistered()` then enumerates ALL registered task IDs — not just cached ones. For uncached tasks it falls back to `loadPromptSync()` to get the hardcoded default.

Each entry: `{ prompt_id, source: 'default'|'store', store_version, content_hash (first 16 hex chars of SHA-256), content_length, first_100_chars, last_100_chars, loaded_at }`.

Endpoint `GET /admin/prompts/verify` at `src/routes/admin.prompts.ts:273-283` returns `{ prompts, environment, timestamp }`. Protected by `verifyAdminKey()`.

Evidence: `src/adapters/llm/prompt-loader.ts:748-798`, `src/routes/admin.prompts.ts:273-283`.

---

## Section 2: Integration Issues Found and Resolved

### 2.1 Type Consistency

**Pre-fix state:** `tests/unit/orchestrator/pipeline/phase4-tools.test.ts:324` had a fixture using `{ op, node_id, from, to }` for `AppliedChanges.changes`, which is the old patch operation shape, not the `AppliedChangeItem` interface (`{ label, description, element_ref }`). This caused TS2322.

**Fix applied:** Updated fixture to use correct `AppliedChangeItem` shape.
- File: `tests/unit/orchestrator/pipeline/phase4-tools.test.ts:324`

`AppliedChanges` and `AppliedChangeItem` interfaces: confirmed in `src/orchestrator/types.ts:553-572`. All imports resolve.

### 2.2 Dispatch Completeness

`appliedChanges` and `deterministicAnswerTier` flow: fully wired across dispatch → phase4 → envelope. Confirmed by tracing source code and passing unit tests.

For `run_analysis` auto-chaining: `deterministicAnswerTier` from the chained `explain_results` call is propagated through dispatch.ts:168.

### 2.3 Feature Flag Dependencies

All 12 reviewed features are unconditional (no feature flag) once the orchestrator V2 pipeline is active. The Zone 2 block registry (`CEE_ZONE2_REGISTRY_ENABLED`) is separate from the `assembleV2SystemPrompt` path — the prompt assembler used by the V2 pipeline always renders decision continuity and referenced entities regardless of that flag.

| Env var | Default | Gates |
|---------|---------|-------|
| `CEE_ZONE2_REGISTRY_ENABLED` | false | Zone 2 block registry (alternate assembly path, not the main V2 path) |
| `CEE_ORCHESTRATOR_CONTEXT_ENABLED` | false | Full Context Fabric pipeline |
| `DSK_ENABLED` / `ENABLE_DSK_V0` | false | DSK bundle loading |

Staging env: `CEE_ZONE2_REGISTRY_ENABLED=true` — block registry active but does not affect the features reviewed here.

### 2.4 Prompt Hash in Response

**Gap found and fixed.**

Previously, `prompt_hash` and `prompt_version` were logged via telemetry (`phase3.prompt_identity`) but absent from `_route_metadata` in the response envelope.

**Fix applied:**
1. Added `prompt_hash?: string | null` and `prompt_version?: string | null` to `RouteMetadata` in `src/orchestrator/pipeline/types.ts`.
2. Populated both fields at `src/orchestrator/pipeline/phase3-llm/index.ts:553-554` from the already-computed `promptMeta`.
3. The envelope assembler carries them through via `...baseMetadata` spread — no assembler change needed.

`prompt_hash` is now present in `_route_metadata` on all LLM turns. Non-LLM turns (run_analysis, generate_brief) do not set route_metadata from the tool handler and fall back to llmResult metadata, which carries the orchestrator prompt hash — correct.

### 2.5 Test Fixture Type Errors (admin.prompts.verify.test.ts)

**Pre-fix state:** Three `TS7031: Binding element implicitly has 'any' type` errors in destructured `.find()` callbacks.

**Fix applied:** Annotated destructured parameters with `[unknown, ...unknown[]]` and `[unknown, unknown, ...unknown[]]` to satisfy `noImplicitAny`.
- File: `tests/integration/admin.prompts.verify.test.ts:358,389,426`

---

## Section 3: Test Results

### Typecheck

**Before:** 24 errors across 9 files.
**After:** 15 errors — all pre-existing, all in test files unrelated to recent commits. Source code (`src/`) compiles cleanly.

**Errors resolved by this session:**
- `phase4-tools.test.ts:329` — AppliedChangeItem shape mismatch (stale fixture) ✓
- `admin.prompts.verify.test.ts:358,389,426` — implicit `any` in destructured callbacks ✓

**Remaining pre-existing errors (not caused by recent commits):**
- `cee.bidirected-edges.test.ts` (2) — `"post_normalisation"` not in `ValidatorPhase`
- `cee.causal-claims-validation.test.ts` (1) — discriminated union narrowing issue
- `cee.factor-enricher.test.ts` (1) — `length` on `{}`
- `cee.graph-data-integrity.test.ts` (3) — missing fields on partial fixtures
- `cee.value-uncertainty.test.ts` (2) — V1Graph assignment mismatch
- `golden-fixtures.test.ts` (1) — `ValidationAttemptRecord` → `Record<string, unknown>` overlap
- `graph-structure-validator.test.ts` (2) — dynamic import with query params not resolvable by tsc
- `parallel-generate.test.ts` (3) — `tool` on `BlockProvenance`, `Record<string, unknown>` casts
- `prompt-text-version.test.ts` (1) — `"default"` vs `"store"` literal comparison

### Test Suite

**New tests added:** 2 (prompt observability in phase5-envelope-assembler.test.ts)
**Tests fixed:** 0 runtime failures introduced by this session.

Directly modified test files — all pass:
- `tests/unit/orchestrator/pipeline/phase4-tools.test.ts` — 12 tests ✓
- `tests/unit/orchestrator/pipeline/phase5-envelope-assembler.test.ts` — passes (new P0-3 tests included)
- `tests/unit/orchestrator/tools/dispatch-chaining.test.ts` — 18 tests ✓ (no changes needed)
- `tests/integration/admin.prompts.verify.test.ts` — 18 tests ✓
- All 22 pipeline unit test files — 267 tests + 1 todo ✓

### Coverage Gaps (pre-existing, not introduced by this session)

Features with unit tests but no pipeline-level integration test:
- **1.3 Conversational retry:** `phase4-conversational-retry.test.ts` covers the Phase 4 signal; no end-to-end pipeline test verifying the `chat()` retry response is returned.
- **1.6 Decision continuity:** Unit tests exist for `buildDecisionContinuity()`; no pipeline test asserting the `<decision_state>` block appears in the assembled system prompt.
- **1.7 Entity enrichment:** Unit tests exist for `matchReferencedEntities()`; no pipeline test asserting `<referenced_entity>` blocks appear.

These gaps are acceptable for current phase — the unit tests provide sufficient coverage for the implemented logic.

---

## Section 4: Recommended Fixes (Prioritised)

### P0 — Fixed in this session

1. ~~`phase4-tools.test.ts:324`~~ — AppliedChangeItem fixture updated ✓
2. ~~`admin.prompts.verify.test.ts:358,389,426`~~ — implicit `any` annotations added ✓
3. ~~`prompt_hash`/`prompt_version` absent from `_route_metadata`~~ — added to `RouteMetadata`, populated in phase3 ✓

### P1 — Remaining pre-existing test type errors (low risk)

4. `tests/unit/cee.bidirected-edges.test.ts:415,450` — `"post_normalisation"` not valid in `ValidatorPhase`. Add it to the enum or update the test fixture if the phase was renamed.
5. `tests/unit/orchestrator/parallel-generate.test.ts:136` — `tool` not in `BlockProvenance`. Either the provenance type needs a `tool` field or the test should use a different field.
6. `tests/unit/orchestrator/parallel-generate.test.ts:172,204` — `as Record<string, unknown>` casts need `as unknown as Record<string, unknown>`. Straightforward fix.
7. `tests/unit/golden-fixtures.test.ts:486` — `as Record<string, unknown>` on `ValidationAttemptRecord` — same pattern as above.
8. `tests/unit/cee.graph-data-integrity.test.ts` — test fixtures are missing required fields on node/edge types. Update fixtures to match current schema.
9. `tests/unit/cee.value-uncertainty.test.ts` — V1Graph assignment. Likely needs a `as unknown as V1Graph` cast or schema update.

### P2 — Coverage improvements (optional)

10. Add pipeline integration test for conversational retry: mock a suppressed `run_analysis` turn with intent `'conversational'`, assert `chat()` is called and response has `assistant_text` with no stage fallback block.
11. Add pipeline integration test for stage tool filtering: mock a FRAME-stage turn, assert the tool definitions array passed to `chatWithTools` contains only `draft_graph` and (without research intent) not `research_topic`.

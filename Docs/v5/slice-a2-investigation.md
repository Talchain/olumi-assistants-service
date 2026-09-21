# Slice A2 — Investigation

**Branch:** CEE `claude/nostalgic-hermann` (this worktree). UI `ui/ai-panel-tranche-1` (A1 UI branch).
**Stage 1 approved with 4 corrections** (see §Decisions locked).

---

## Context

A1 landed `TurnExecutor` for the `direct_answer` class end-to-end. A2 extends to accept `clarify` — the user's message is ambiguous enough that the assistant asks a follow-up question instead of answering. Clarification is text-only: no blocks, no suggested_actions, no tool dispatch, no state mutation beyond the conversation turn append (no mutation at all in A2, commit remains a no-op per Paul's constraint 11).

---

## Stage 1 findings (6 targets)

### 1. V4 ambiguity-detection signals

**V4 has no turn-level ambiguity classifier.** V4's clarifier operates at **brief-draft time** on graph structural weakness, not on free-text user messages.

- Predicate: [src/cee/clarifier/ambiguity-detector.ts:249-271](../../src/cee/clarifier/ambiguity-detector.ts#L249-L271) — `detectAmbiguities(graph, qualityScore)`.
- Signals: missing standard nodes (goal/decision/option/outcome/risk), edges with `belief < 0.3`, vague labels (`other`, `misc`), brief-concept keywords not modeled in graph.
- Pipeline site: [src/cee/unified-pipeline/stages/repair/clarifier.ts:20-67](../../src/cee/unified-pipeline/stages/repair/clarifier.ts#L20-L67).
- None of these signals are available from a V5 TurnExecutor payload (which carries only `{ message, stage, scenario_id }`).

**Implication:** A2 cannot port V4's classifier. A2 decides at the turn level via a dedicated LLM classifier call (see Decision §1 below).

### 2. Existing clarification text patterns

- V4 has a `clarify_brief` prompt (task_id): [data/prompts.json:85-256](../../data/prompts.json#L85-L256) and default registered in [src/prompts/defaults.ts:2206](../../src/prompts/defaults.ts#L2206).
- Output shape is heavy: `{ questions: [{question, choices?, why_we_ask, impacts_draft}], confidence, should_continue }` — MCQ-oriented, brief-pipeline specific.
- **Not reusable.** A2 clarify is free-text conversational ("What's the decision you're weighing?"), not structured MCQ. A2 introduces a new `clarify_narrate` task_id, same thin-seam pattern as A1's `direct_answer_narrate`. Paul authors the fragment.

### 3. Dispatch decision surface

A1 had `dispatchDirectAnswer(turnClass, context, opts)` with turnClass as a parameter. A2 renames to `dispatch(context, opts)` — no turn-class parameter. Internally:
1. Classify via `classifyTurn` (new module).
2. Load the matching narrate fragment.
3. Invoke narrate.
4. Return `{ turn_class, sanitised, llm_calls_used, raw_text_length }`.

`UnhandledTurnClassError` still fires from inside `dispatch` — any unknown branch → P0 alert. Direct_answer handler is inline in dispatch.ts; clarify lives in `clarify.ts` (extracted because later slices will extend clarify behaviour independently).

### 4. UI eligibility-predicate widening

[src/v5/eligibility.ts:63-92](../../../../DecisionGuideAI/.claude/worktrees/v5-slice-a2/src/v5/eligibility.ts#L63-L92) gates on 8 conditions — all about HOW a turn is triggered (flag/mode/chip/retry/analysis-state/prior-tools), none on message content.

**No new predicate conditions.** The existing frame-stage/free-text filter already accepts ambiguous messages as naturally as unambiguous ones. The CEE classifier decides downstream. Changes:
- JSDoc updated to name both accepted classes.
- Unit tests add coverage: ambiguous-message inputs remain eligible.
- Reject cases preserved (post-analysis, prior-tool contexts → V4).

Post-tool-failure clarify is deferred to later slices.

### 5. `pending_confirmation` invariant

**Invariant holds trivially.** `pending_confirmation` is **not defined** on `TurnContext` in `@talchain/schemas@0.4.0`:
- Schema: [~/Documents/GitHub/olumi-schemas/src/orchestrator/turn-context.ts:35-44](../../../../olumi-schemas/src/orchestrator/turn-context.ts#L35-L44), `.strict()`.
- Builder: [src/orchestrator-v5/build-turn-context.ts:15-41](../../src/orchestrator-v5/build-turn-context.ts#L15-L41) — does not set it.

A2 makes no TurnContext shape change. No schema bump. No vendored tarball change.

### 6. V4 regression bundle for clarify

**None of the 7 debug bundles referenced in A1 (`d8d0cab0`, `a0280603`, `9325a506`, `4ac0caae`, `2394efe6`, `7a3fa9d4`, `b2968343`) represent a clarify turn.** All seven are direct_answer-shaped.

**Conclusion:** A2 has **no V4 behavioural baseline**. Coverage is A2-fixture-based only. Documented in `slice-a2-implementation.md` and `_meta.note_a2` of `clarify-happy.json`.

---

## Decisions locked (4 corrections on Stage 1 proposal)

1. **Classifier mechanism = pre-narrate LLM classifier.** New `turn_classifier` task_id, `responseFormat: 'json_object'`, Zod-validates `{ turn_class: 'direct_answer' | 'clarify' }`. `llm_calls_used` = 2 on success (classify + narrate). [src/orchestrator-v5/classify.ts](../../src/orchestrator-v5/classify.ts).

2. **Internal naming = `clarify`** (matches wire `TurnClass` enum). `A2TurnClass = 'direct_answer' | 'clarify'`. Fragment = `clarify_narrate`. File = [src/orchestrator-v5/clarify.ts](../../src/orchestrator-v5/clarify.ts). Composer = `composeClarifyResponse`. Fixtures prefixed `clarify-`. No schema bump.

3. **A1 telemetry compatibility.** Audit result: **no A1 test asserts on `stages_completed`**. The new `classify` stage entry adds cleanly. `llm_calls_used` assertions updated from 1 → 2 in the A1 unit + integration tests (semantically accurate post-A2). A1 fixture `_meta.note_a2_update` annotations explain the shift.

4. **Classifier parse-error → `LLM_SCHEMA_VIOLATION`**, a new `InternalFailure` literal mapped to the existing `LLM_UNAVAILABLE` wire code. Rationale: the closest existing wire code that says "model temporarily unavailable, retry" (the correct user action for classifier output malformation). `UNHANDLED` remains reserved for (a) valid classifier output returning an out-of-union `turn_class`, or (b) generic catch-all errors. See [src/orchestrator-v5/types.ts:37-64](../../src/orchestrator-v5/types.ts#L37-L64) for the mapping + commentary.

5. **Budget independence.** Documented in [src/orchestrator-v5/budgets.ts](../../src/orchestrator-v5/budgets.ts): classifier and narrate each get a fresh `LLM_BUDGET_NARRATE_MS` window. Outer `TURN_BUDGET_MS` is the shared ceiling. Worst-case total LLM time = 2 × narrate budget, hard-bounded by `TURN_BUDGET_MS`. Unit test: [src/orchestrator-v5/__tests__/budgets.test.ts](../../src/orchestrator-v5/__tests__/budgets.test.ts) — "Budget independence" describe block (3 new tests proving budget independence, worst-case bounds, and no hidden shared counter).

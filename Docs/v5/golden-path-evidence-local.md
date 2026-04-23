# V5 golden-path evidence (local)

**Date:** 2026-04-23
**Branch:** `claude/v5-golden-path-completion` (local commits only, not pushed)
**Base commit:** df0f294768054c05d7b75bff4fa35bbb0a646399 (staging HEAD)
**Scope:** Tasks 1–5 from the CEE brief "V5 golden path completion".

---

## Prompt investigation (summary; full doc: [prompt-investigation.md](prompt-investigation.md))

| Field | Value |
| --- | --- |
| Source | Hardcoded constant `ROUTING_SYSTEM_PROMPT` in [route-with-tool-use.ts:131](src/orchestrator-v5/routing/route-with-tool-use.ts#L131). Not loaded from PMS or files. |
| Length | ~1,000 chars (~250 tokens) |
| Contains coaching instructions | No. Only intent-class routing rules. |
| Contains handler descriptions | No. Tool schema uses open-string `handler_id`. |
| Contains stage-behaviour rules | No. Stage string appears in ContextPack but no prompt rules reference it. |
| Contains grounding requirements | No. Nothing instructs Sonnet to reference specific options / factors / drivers. |
| Context assembly | ContextPack (graph + analysis + conversation + coaching + quantities) is `JSON.stringify(pack, null, 2)`'d into the single user message at [route-with-tool-use.ts:429](src/orchestrator-v5/routing/route-with-tool-use.ts#L429). No field elevation, no natural-language summary. |

**Verdict:** context IS present (~6,000–7,000 tokens of ContextPack JSON on follow-up turns, fully matching the 9,400 observed input_tokens). The quality gap is the prompt: it's classification-only, with no rules for grounded coaching text. Recommended next step is a prompt rewrite owned by the project architect (brief hard-scoped out of this branch).

---

## Step 1: Draft graph (message-kind, frame stage)

Local run against `POST /orchestrate/v2/turn` with `ENABLE_V5_ORCHESTRATOR=true ENABLE_ORCHESTRATOR_V2=true`.

| Field | Value |
| --- | --- |
| Status | 500 |
| `assistant_text` present | N/A (commit path never reached) |
| `draft_graph` nodes | N/A |
| `analysis_ready` | N/A |
| Why | `SessionStore: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set` at commit time. Local env intentionally has only LLM keys per CLAUDE.md memory. |
| Stages reached | `build_turn_context, orient, compose` (commit failed) |
| `failure_type` | `INTERNAL_ERROR` |

**Interpretation:** The draft pipeline ran (gpt-4o routing produced a tool_use, composer wrote a response); persistence failed because Supabase isn't configured locally. This is the expected gap called out in the brief. Staging logs show the same pipeline returning 200 because staging has Supabase credentials — see the CLAUDE.md `reference_supabase_env.md` memory note.

## Step 2: Follow-up (unsupported handler via Sonnet routing)

The follow-up-quality part of the brief is blocked on the same commit path. However, the per-code routing result was observable in logs before commit, and the handler classification worked:

| Field | Value |
| --- | --- |
| Status | 500 |
| Routing classified | `turn_class: clarify` (model saw a message "Run the analysis" with graph_state present but chose to clarify instead of execute) |
| `input_tokens` | 1,084 (graph present but no analysis → small ContextPack in this test; the 9,400-token follow-up turns observed on staging were post-analysis turns with much larger ContextPack) |
| References model context | N/A — 500 prevented composition |

**Interpretation:** Follow-up quality cannot be fully evaluated locally because (a) commit fails, and (b) the current local env uses gpt-4o as the `orchestrator` task model, not Claude Sonnet. Production and staging route to Sonnet via the `orchestrator` task resolution.

## Step 3: Unsupported action (the fix)

Test: 8 integration test assertions in [tests/integration/orchestrate-v2-unsupported-action.test.ts](tests/integration/orchestrate-v2-unsupported-action.test.ts), all passing. Assertions cover the whole declared-but-unregistered surface of V5ActionType (7 handlers) plus `add_option`/`edit_graph` (not in the enum but commonly hallucinated by routing).

| Field | Value |
| --- | --- |
| Status | **200** (was 500 before this branch) |
| Response contains error block | No |
| `assistant_text` length | Non-empty, contextual to the proposed handler category |
| Developer terminology absent | Yes — regex-guarded in the test (`/\b(feature\|enabled\|environment\|handler_id\|registry\|session)\b/i`) |
| `suggested_actions.length` | ≥ 1; chip's `action_type` is `run_analysis` when the registry contains it |
| `commit_performed` | `true` (committed as `direct_answer` turn) |
| `failure_type` | `null` |
| `validation_error_code` telemetry | `HANDLER_NOT_FOUND` (preserved for post-hoc analysis) |
| `template_used` telemetry | `unsupported_action_structural` / `unsupported_action_value_change` / `unsupported_action_analysis_dep` / `unsupported_action_generic` |

**Quality examples** (rendered text verbatim from unit-test assertions):

- `add_option` → *"I can't make structural changes to the model through chat in this version. You can make this change (add option) directly on the canvas, then come back and I can run the analysis on the updated model."*
- `set_factor_value` → *"Direct value updates aren't available through chat yet. You can adjust values in the inspector panel on the right, and once updated I can run the analysis with your new numbers."*
- `explain_result` (no analysis present) → *"That needs analysis results first. Run the analysis, and then I can dig into explain result for you."*
- `explain_result` (analysis present) → *"I can't run explain result as a separate step yet, but the analysis has already produced results for this decision. Ask a follow-up question about the options or drivers and I'll work from those results."*

## Step 4: run_analysis chip_click end-to-end

Test payload: `source="chip_click"` + `chip.action_type="run_analysis"` + inline `graph_state` with one goal and two option nodes.

| Field | Value |
| --- | --- |
| Status | 500 |
| Handler fired | **Yes** (`V5 chip_click run_analysis — handler invocation failed (typed)`; `cause_kind: scenario_read_failed`) |
| PLoT called | No. The handler's scenario-load step fails before PLoT is invoked because Supabase is not configured locally. |
| Decision_review fired | No (depends on run_analysis outcome). |
| Analysis in response | No (handler threw before producing facts). |
| HTTP status | 500 + typed `chip_click_dispatch` BoundaryError with `cause_kind: scenario_read_failed` |

**Interpretation (expected locally):** the dispatch chain is wired correctly — `dispatchChipClickRunAnalysis` in [chip-click-dispatch.ts](src/orchestrator-v5/handlers/chip-click-dispatch.ts) reached the handler and the handler surfaced its typed `HandlerInvocationFailedError`. Persistence (scenarioReader → Supabase) is what's missing in the local env. On staging with Supabase + PLoT configured, this path executes PLoT and returns an `analysis_result` block in the 200 OlumiResponse.

## Step 5: Post-analysis follow-up

Not exercised. Per the brief, this is gated on step 4 returning analysis. Since local env can't complete run_analysis end-to-end, no evidence here. Investigation of follow-up response quality is covered in [prompt-investigation.md](prompt-investigation.md) instead.

---

## What changed on this branch

### Task 1 — Unsupported-handler fallback (the fix)

| File | Change |
| --- | --- |
| [src/orchestrator-v5/compose/unsupported-action-response.ts](src/orchestrator-v5/compose/unsupported-action-response.ts) | **New**. `composeUnsupportedActionResponse()` builds a clean 200 OlumiResponse (no error block) with contextual coaching text + a chip from the live registry. Categorises handler IDs into structural / value_change / analysis_dep / generic. |
| [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts) | HANDLER_NOT_FOUND validator path rewired: instead of `composeValidationFailure` + `failureType=UNSUPPORTED_ACTION` + 500, the executor now composes the unsupported-action response and commits it as a `direct_answer` turn. `commit_performed=true` so route-v2 returns 200. Other validator codes unchanged. |
| [src/orchestrator-v5/compose/__tests__/unsupported-action-response.test.ts](src/orchestrator-v5/compose/__tests__/unsupported-action-response.test.ts) | **New**. 31 unit tests covering: no error block, registry-driven chips, each handler category's coaching text, developer-terminology absence across the whole `V5ActionType` surface. |
| [src/orchestrator-v5/__tests__/turn-executor.test.ts](src/orchestrator-v5/__tests__/turn-executor.test.ts) | Updated the pre-existing "validator path: HANDLER_NOT_FOUND maps to FEATURE_NOT_ENABLED on the wire" test to assert the new 200 graceful behaviour. Dispatch-path test (handler_not_registered) unchanged — the internal invariant still 500s, as intended. |
| [tests/integration/orchestrate-v2-unsupported-action.test.ts](tests/integration/orchestrate-v2-unsupported-action.test.ts) | Rewritten. 8 integration tests hit the Fastify route and assert 200 OlumiResponse + no error block + no developer terminology + correct chip for every unregistered handler across the V5ActionType surface plus two hallucinated ones. |

The curated registry gate was already correct (`curatedHandlerChips` in [helpers.ts](src/orchestrator-v5/compose/helpers.ts) intersects `USER_FACING_HANDLERS` with the live registry), so Task 1c needed no additional changes — chips always reflect live state.

### Task 2 — Prompt investigation

- [Docs/v5/prompt-investigation.md](Docs/v5/prompt-investigation.md): source, content, token breakdown, and recommended next step (prompt rewrite owned by project architect). No prompt content was modified.

### Tasks 3, 4 — run_analysis verification

- No code changes. Verification performed by running the server locally with `ENABLE_V5_ORCHESTRATOR=true`, `ENABLE_ORCHESTRATOR_V2=true`, and observing turn-executor logs. Chain confirmed to handler-invocation; persistence + PLoT require staging env.

### Task 5 — Evidence pack

- This document.

---

## Unresolved gaps

- **Follow-up response quality still generic**: root cause is the routing prompt being classification-only. Fix owned by project architect per brief hard scope; recommended path is a prompt rewrite informed by [prompt-investigation.md](prompt-investigation.md).
- **Local PLoT end-to-end verification**: blocked on `PLOT_BASE_URL` + `PLOT_AUTH_TOKEN` not being available locally. The handler chain is verified to fire; the actual PLoT HTTP call is exercised on staging by the live golden-path suite.
- **Local Supabase end-to-end verification**: blocked on service role key not being available locally (per CLAUDE.md memory note). Session persistence (and therefore full run_analysis completion) requires staging.
- **Dispatch-path handler_not_registered still 500**: intentional. That path fires only when the validation registry and the dispatch registry diverge — an internal invariant breach that deserves an operator alert, not user-facing coaching. The validator's HANDLER_NOT_FOUND path (the one users actually hit) is now the graceful 200.

---

## How to reproduce locally

```bash
# Start with V5 routing enabled:
ENABLE_V5_ORCHESTRATOR=true ENABLE_ORCHESTRATOR_V2=true PORT=10000 npx tsx src/server.ts

# Unsupported action (hits the graceful fallback):
SCENARIO_ID=$(uuidgen); TURN_ID=$(uuidgen)
curl -sS -X POST http://localhost:10000/orchestrate/v2/turn \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: $ASSIST_API_KEY" \
  -d "{\"kind\":\"message\",\"turn_id\":\"$TURN_ID\",\"scenario_id\":\"$SCENARIO_ID\",\"stage\":\"analyse\",\"turn_class\":\"decide\",\"source\":\"composer\",\"message\":\"Explain the results please\",\"graph_state\":{\"nodes\":[{\"id\":\"g\",\"kind\":\"goal\",\"label\":\"Goal\"},{\"id\":\"a\",\"kind\":\"option\",\"label\":\"A\"}],\"edges\":[{\"from\":\"a\",\"to\":\"g\"}],\"goal_node_id\":\"g\"}}"

# Expected: 200 OlumiResponse (not 500), no error block, coaching text referencing the proposed action.
```

Tests that lock this in:

```bash
npx vitest run --no-coverage \
  src/orchestrator-v5/compose/__tests__/unsupported-action-response.test.ts \
  src/orchestrator-v5/__tests__/turn-executor.test.ts \
  tests/integration/orchestrate-v2-unsupported-action.test.ts
```

Result: 71 tests pass.

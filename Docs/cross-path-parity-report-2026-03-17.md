# CEE Cross-Path Parity Audit Report

**Date**: 2026-03-17
**Priority**: P0
**Status**: Fixes applied, regression tests passing, pending staging deployment

---

## 1. Code Path Comparison Table

Both paths share Phases 1, 2, 4, and 5. The divergence is in Phase 3 (LLM call) and the transport layer.

| Aspect | Non-Streaming (`POST /turn`) | Streaming (`POST /turn/stream`) | Parity? |
|--------|------------------------------|--------------------------------|---------|
| Route handler | `route.ts` → `handleTurnV2()` | `route-stream.ts` → SSE generator | Yes (shared validation) |
| Request validation | `TurnRequestSchema` (Zod) | `TurnRequestSchema` (Zod) | Yes |
| Phase 1 (enrichment) | `phase1Enrich()` | `phase1Enrich()` | Yes |
| Phase 2 (specialists) | `phase2Route()` | `phase2Route()` | Yes |
| Phase 3 routing | `phase3Generate()` | `phase3PrepareForStreaming()` → deterministic OR LLM | Yes (shared routing logic) |
| Prompt assembly | `assembleV2SystemPrompt()` | `assembleV2SystemPrompt()` (via `phase3PrepareForStreaming`) | Yes |
| Tool filtering | Stage policy filter in `phase3Generate` | Stage policy filter in `phase3PrepareForStreaming` | **Fixed** — was missing debug logs |
| LLM call | `llmClient.chatWithTools()` | `llmClient.streamChatWithTools()` → fallback to `chatWithTools()` | **Fixed** — was crashing |
| Phase 4 (tools) | `phase4Execute()` | `phase4Execute()` | Yes |
| Phase 5 (validation) | `phase5Validate()` | `phase5Validate()` | Yes |
| Idempotency | Yes (nonce + cache) | No (SSE not idempotent by design) | N/A |
| Budget timeout | `AbortController` with `ORCHESTRATOR_TURN_BUDGET_MS` | Same | Yes |
| `prompt_identity` log | Emitted | **Fixed** — was missing | Yes (post-fix) |
| Tool filtering log | Emitted | **Fixed** — was missing | Yes (post-fix) |

## 2. Divergences Found

### D1: Streaming crash — `PIPELINE_ERROR` (P0)

**Root cause**: The adapter wrapper chain (`CachingAdapter` → `UsageTrackingAdapter` → inner OpenAI adapter) defines `streamChatWithTools` on the wrapper classes, so the `if (adapter.streamChatWithTools)` check in `llm-client.ts` passes. However, the wrapper delegates to the inner adapter, which throws `"does not support streamChatWithTools"`.

**Impact**: Every streaming request returned `PIPELINE_ERROR` instead of a valid response.

### D2: Missing `phase3.prompt_identity` log in streaming path

**Root cause**: `phase3PrepareForStreaming` in `phase3-llm/index.ts` did not emit the `phase3.prompt_identity` structured log that `phase3Generate` emits.

**Impact**: Observability gap — no prompt version/hash in streaming request logs.

### D3: Missing tool filtering debug logs in streaming path

**Root cause**: `phase3PrepareForStreaming` filtered tools by stage policy but did not emit the per-tool `phase3: tool filtered` debug log or the summary `phase3: stage policy filtered tool definitions` info log.

**Impact**: Observability gap — no visibility into which tools were filtered for streaming requests.

## 3. Fixes Applied

### Fix 1: Adapter fallback chain (D1)

**Files**: `src/adapters/llm/caching.ts`, `src/adapters/llm/usage-tracking.ts`, `src/orchestrator/pipeline/llm-client.ts`

Changed all three layers from "throw if inner adapter lacks streaming" to "fall back to `chatWithTools` and yield a single `message_complete` event":

- **`caching.ts`**: `streamChatWithTools` checks `this.adapter.streamChatWithTools` before delegating; falls back to non-streaming with `message_complete` yield.
- **`usage-tracking.ts`**: Same pattern, with budget enforcement and usage logging on the fallback path.
- **`llm-client.ts`**: Try/catch around the wrapper call; catches the "does not support" error and falls back to non-streaming. Other errors rethrown.

### Fix 2: Prompt identity log (D2)

**File**: `src/orchestrator/pipeline/phase3-llm/index.ts` (line ~1196)

Added `log.info({ ... }, 'phase3.prompt_identity')` to `phase3PrepareForStreaming` with identical fields to the non-streaming path: `prompt_id`, `prompt_version`, `prompt_hash`, `prompt_source`, `prompt_instance_id`, `zone2_enabled`, `v2_prompt_zone2_included`, `context_fabric_config_enabled`, `system_prompt_chars`, `pipeline: 'v2_stream'`.

### Fix 3: Tool filtering logs (D3)

**File**: `src/orchestrator/pipeline/phase3-llm/index.ts` (line ~1218)

Added per-tool debug log and summary info log in `phase3PrepareForStreaming`, matching the non-streaming `phase3Generate` implementation.

## 4. Regression Test

**File**: `tests/integration/streaming-parity.test.ts`

7 test cases covering:

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | Streaming invokes `phase3PrepareForStreaming` | Shared routing entry point called |
| 2 | LLM path calls `chatWithTools` with system prompt | Prompt assembly flows through to LLM call |
| 3 | LLM path passes tools array | Tool registry + filtering reaches LLM |
| 4 | `phase1Enrich` called for stage inference | Phase 1 parity |
| 5 | `turn_complete` envelope shape | Response contract parity (turn_id, assistant_text, blocks, suggested_actions, _route_metadata) |
| 6 | No crash without `streamChatWithTools` | **P0 regression guard** — adapter fallback works |
| 7 | Deterministic path produces `turn_complete` | Non-LLM routes still complete correctly |

All 7 tests pass.

## 5. Post-Fix Verification

### Local verification
- `tsc -p tsconfig.build.json --noEmit` — clean (0 errors)
- `vitest run tests/integration/streaming-parity.test.ts` — 7/7 pass
- No new untracked files in `src/`

### Staging verification
Staging verification is **pending deployment**. The fixes are on the `staging` branch but not yet pushed. After deployment, verify with:

```bash
# Non-streaming
curl -s -X POST https://cee-staging.onrender.com/orchestrate/v1/turn \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: $CEE_API_KEY" \
  -d '{"message":"Should I hire a tech lead or two developers?","scenario_id":"parity-test","client_turn_id":"parity-001","context":{"graph":null,"analysis_response":null,"framing":{"stage":"frame"},"messages":[],"selected_elements":[],"scenario_id":"parity-test"}}' \
  | jq '{turn_id, has_text: (.assistant_text != null), blocks: (.blocks | length), actions: (.suggested_actions | length), prompt_hash: ._route_metadata.prompt_hash}'

# Streaming
curl -s -N -X POST https://cee-staging.onrender.com/orchestrate/v1/turn/stream \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: $CEE_API_KEY" \
  -d '{"message":"Should I hire a tech lead or two developers?","scenario_id":"parity-test","client_turn_id":"parity-002","context":{"graph":null,"analysis_response":null,"framing":{"stage":"frame"},"messages":[],"selected_elements":[],"scenario_id":"parity-test"}}'
```

**Pass criteria**: Streaming returns `turn_complete` with non-null `assistant_text`, matching `prompt_hash`, and no `error` events.

## 6. Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Streaming idempotency gap | Low | SSE is not idempotent by design; clients should retry via non-streaming if connection drops |
| Real streaming (SSE token chunks) untested end-to-end | Medium | Current OpenAI adapter doesn't implement `streamChatWithTools`; when it does, add E2E streaming test |
| `phase3PrepareForStreaming` routing drift | Medium | Regression test #7 covers deterministic path; any new deterministic route added to `phase3Generate` must be mirrored |

## 7. Files Changed

| File | Lines | Change |
|------|-------|--------|
| `src/adapters/llm/caching.ts` | +13 -3 | Fallback from throw to non-streaming yield |
| `src/adapters/llm/usage-tracking.ts` | +23 -6 | Fallback with budget enforcement + usage logging |
| `src/orchestrator/pipeline/llm-client.ts` | +30 -6 | Try/catch + fallback in `streamChatWithTools` |
| `src/orchestrator/pipeline/phase3-llm/index.ts` | +36 | Prompt identity log + tool filtering logs |
| `tests/integration/streaming-parity.test.ts` | +248 (new) | 7-case regression test suite |

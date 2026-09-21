# CEE Security Hardening & Codebase Cleanup Report

**Date:** 2026-03-15
**Branch:** staging

---

## Baseline Metrics (pre-change)

| Metric | Value |
|--------|-------|
| Tests passed | 8,498 |
| Tests skipped | 69 |
| TSC errors (build) | 0 |
| TSC errors (full, test files only) | 33 |
| `as any` casts in `src/` | 807 |

---

## Phase 1: Security Hardening

### Task 1: Constant-time key comparisons
- Added `safeEqual()` using `crypto.timingSafeEqual` in `src/utils/hash.ts`
- Applied across auth plugin (`src/plugins/auth.ts`), HMAC auth (`src/utils/hmac-auth.ts`), admin key checks in route handlers

### Task 2: Rate limiter fail-closed
- Rate limiter in `src/routes/assist.v1.draft-graph.ts` now rejects (429) on internal errors rather than silently allowing
- Added `MAX_BUCKETS` (10,000) guardrail with amortized LRU pruning

### Task 3a: Bounded in-memory stores
- `LruTtlCache` utility class (`src/utils/lru-ttl-cache.ts`) — bounded with TTL + LRU eviction
- Applied to rate-limit buckets and quota tracking maps
- Amortized pruning via `PRUNE_INTERVAL` to avoid O(n) on every request

### Task 3b: Split /healthz
- Minimal `/healthz` returns `{ ok: true }` without exposing internals
- Detailed `/healthz/detail` available with admin auth, includes version/uptime/memory

**Phase 1 gate:** 8,510 passed / 69 skipped / 0 failed / TSC build clean

---

## Phase 2: Dead Code Removal

### Task 4: Remove Pipeline B (~5,700 lines)

Removed the legacy dual-pipeline architecture. Key changes:

| Area | Lines removed | Files affected |
|------|--------------|----------------|
| `src/cee/validation/pipeline.ts` | ~2,506 | Kept: `isAdminAuthorized`, `integrateClarifier`, `buildCeeErrorResponse`, `normaliseRiskCoefficients` |
| `src/routes/assist.draft-graph.ts` | ~2,066 | Legacy handlers replaced with 410 Gone stubs; utility functions retained |
| Test files deleted | 23 files | Tests for legacy pipeline, SSE, route parity, chaos |
| Test files updated | 8 files | Endpoint swaps, assertion fixes, Pipeline B trace references |

Config changes:
- `unifiedPipelineEnabled` default → `true`
- `legacyPipelineEnabled` marked DEPRECATED
- `vitest.setup.ts` updated to set `CEE_UNIFIED_PIPELINE_ENABLED`

Post-removal fix: Added `CeeDraftGraphSucceeded`/`CeeDraftGraphFailed` telemetry emit in v1 route handler (previously in Pipeline B's `finaliseCeeDraftResponse`).

### Task 5: Remove `CEE_BIAS_LLM_DETECTION_ENABLED` stub
- Removed from config schema and mapping (`src/config/index.ts`)
- Removed `detectBiasesWithLlm` stub, `_LLM_BIAS_DETECTION_PROMPT`, `_LlmBiasFinding` from `src/cee/bias/hybrid-detector.ts`
- Simplified `detectBiasesHybrid` to only return rule-based findings

### Task 6: Remove `MOE_SPIKE_ENABLED` shadow code
- Deleted `src/orchestrator/moe-spike/` directory (5 files: `schemas.ts`, `prompt.ts`, `call-specialist.ts`, `compare.ts`, `persist.ts`)
- Deleted `tests/unit/orchestrator/moe-spike/` directory (6 test files)
- Removed from config schema and mapping (`src/config/index.ts`)
- Removed conditional spike branches and imports from `src/orchestrator/parallel-generate.ts`
- Simplified promise tuple type from variadic to `[Promise<DraftGraphResult>, Promise<string>]`

**Phase 2 gate:** 8,321 passed / 41 skipped / 0 failed / TSC build clean

---

## Phase 3: Type Safety

### Task 7: `as any` cast reduction

Eliminated all `as any` casts from 3 source files (32 casts removed in this task):

| File | Before | After | Technique |
|------|--------|-------|-----------|
| `src/routes/assist.v1.draft-graph.ts` | 20 | 0 | Extended `baseInput` type union; typed `rawBody` as `Record<string, unknown>`; removed telemetry `as any` via optional chaining on `Record<string, unknown>` intermediates |
| `src/plugins/boundary-logging.ts` | 11 | 0 | Added `BoundaryMeta` interface; used `DownstreamCallTiming.payload_hash`/`response_hash` (already typed); `as unknown as Record<string, unknown>` for Fastify request/reply decorations |
| `src/cee/bias/index.ts` | 12 | 0 | Added `GraphNode`/`GraphEdge` type aliases from `GraphV1`; used typed `nodes`/`edges` access; destructured edge `from`/`to` |

---

## Final Metrics

| Metric | Baseline | Final | Delta |
|--------|----------|-------|-------|
| Tests passed | 8,498 | 8,321 | -177 (deleted legacy tests) |
| Tests skipped | 69 | 41 | -28 (deleted legacy skipped tests) |
| Tests failed | 0 | 0 | 0 |
| TSC errors (build) | 0 | 0 | 0 |
| TSC errors (full) | 33 | 33 | 0 (test files only, pre-existing) |
| `as any` casts | 807 | 680 | -127 |
| Source lines removed | — | ~5,700+ | Pipeline B + MoE spike + bias LLM stub |
| Test files deleted | — | 29 | Legacy pipeline + MoE spike tests |

---

## Constraints Verified

- Unified pipeline logic: NOT modified
- Prompt loading: NOT modified
- LLM adapter behavior: NOT modified
- No untracked source files introduced
- All phases gated by passing tests + TSC

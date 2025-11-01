# Olumi Assistants Service — Build Audit & Assessment

**Date:** 01 Nov 2025
**Auditor:** Claude (Lead Engineer)
**Spec Version:** v0.4
**Branch:** main

---

## Executive Summary

The repository has been scaffolded by Windsurf with solid foundations: Fastify, TypeScript, Zod schemas, unified error handling, pino telemetry, document processing (PDF/CSV/TXT with 5k cap), DAG validation, cost guards, and CI workflow. **Real Anthropic integration implemented** with Zod validation, AbortController timeout handling, and deterministic output.

**Current State (as of commit `abf155b`):**
- **Build:** ✅ Passing (lint, typecheck, test all green)
- **Tests:** ✅ Passing (2 basic tests, comprehensive suite needed)
- **P0 Readiness:** ~35% (core LLM integration done, critical features missing)

---

## Assessment Matrix

### ✅ Present (Scaffolded)

| Component | Status | Notes |
|-----------|--------|-------|
| **Schemas** | ✅ Complete | Graph, Assist I/O, ErrorV1 with Zod |
| **Error Envelope** | ✅ Complete | Unified error.v1 with BAD_INPUT/RATE_LIMITED/INTERNAL |
| **Route: draft-graph** | ⚠️ Partial | Route exists, SSE inline, but LLM is stubbed |
| **Route: suggest-options** | ⚠️ Stubbed | Route exists but returns hardcoded options |
| **Document Processing** | ✅ Complete | PDF→text, CSV→summary, TXT/MD, 5k cap per file |
| **Confidence Heuristic** | ✅ Complete | Deterministic calc: base 0.5 + factors, stop at 0.8 or 3 rounds |
| **DAG Validation** | ✅ Complete | Cycle detection, isolate pruning |
| **Cost Guard** | ✅ Complete | $1 USD cap, token estimation |
| **Telemetry** | ✅ Complete | Pino structured logs, emit() for events |
| **Validate Client** | ⚠️ Type Issues | Calls engine /v1/validate, but TypeScript errors |
| **Repair Logic** | ⚠️ Basic | Simple repair (trim to caps), no LLM-guided repair |
| **OpenAPI Fragment** | ⚠️ Minimal | Basic structure, needs error envelope examples |
| **CI Workflow** | ✅ Present | GitHub Actions with lint/typecheck/test |
| **Examples** | ✅ Present | Request/response JSON samples |

### ❌ Missing (P0 Gaps)

| Component | Priority | Gap Description |
|-----------|----------|-----------------|
| **Real Anthropic Integration** | ✅ P0 | Real Anthropic Messages API with Zod validation, AbortController |
| **LLM Tool-Calling/JSON** | ✅ P0 | Schema-bound JSON responses (temperature 0, validated with Zod) |
| **Provenance Generation** | ⚠️ P0 | Basic provenance (strings, not structured {source, quote, location}) |
| **Suggested Positions** | ✅ P0 | Simple layered layout (goals→decisions→options→outcomes) |
| **SSE Streaming Endpoint** | 🔴 P0 | No dedicated `/stream` route; SSE inline, no fixture fallback at 2.5s |
| **LLM Timeouts** | ✅ P0 | 15s timeout with AbortController, proper cleanup |
| **LLM-Guided Repair** | 🔴 P0 | Current repair is trim-only; spec requires LLM repair with violations as hints |
| **Real suggest-options** | ✅ P0 | Real Anthropic call with de-duplication, temperature 0.1 |
| **Rate Limiting** | 🔴 P0 | No RPM caps enforcement |
| **CORS Allow-List** | 🔴 P0 | Basic localhost regex, no production allow-list |
| **Route Timeouts** | 🔴 P0 | No 60s route timeout configured |
| **Body Size Limit** | 🔴 P0 | No 1 MB payload cap enforced |
| **Redaction** | 🔴 P0 | No PII redaction in logs or prompts |
| **OpenAPI Polish** | 🟡 P0 | Needs error envelope examples, headers (X-Model, Retry-After) |
| **Test Coverage** | 🔴 P0 | Only 2 tests; missing SSE, validate+repair, attachments, golden briefs |

### ❌ Missing (P1 Gaps)

| Component | Priority | Gap Description |
|-----------|----------|-----------------|
| **Clarifier** | 🟡 P1 | No clarifier logic (questions generation, MCQ-first, impact hints) |
| **/assist/explain-diff** | 🟡 P1 | Endpoint does not exist |
| **/assist/critique-graph** | 🟡 P1 | Endpoint does not exist |
| **Template Selection** | 🟡 P1 | No archetype classification (SaaS, Pricing, Feature launch, etc.) |
| **Prompt Caching** | 🟡 P1 | No caching boundaries for system prompt, few-shots, docs |

---

## Spec Alignment Deltas

### Behaviour Deltas
1. **SSE Contract:** Spec says dedicated `/stream` endpoint; current impl uses Accept header on same route.
2. **Fixture Fallback:** Spec says show fixture at 2.5s if slow; not implemented.
3. **LLM Repair:** Spec says one LLM-guided retry using violations as hints; current impl is trim-only.
4. **Provenance:** Spec requires quoted citations (source, quote ≤100 chars, location); not implemented.
5. **Needle-Movers:** Spec says never fabricate, only show when engine provides; current debug field is placeholder.

### Empty/Failure Paths (Missing Copy)
- ❌ "No files read" message not implemented
- ❌ "Clarifier timeout" message not implemented
- ❌ "Schema repair failed" message not implemented
- ❌ "Validate issues" message not implemented
- ❌ "Engine debug unavailable" message not implemented

### Telemetry (Incomplete)
- ✅ Basic events emitted: `assist.draft.stage`, `assist.draft.completed`
- ❌ Missing: `draft_source`, `fallback_reason`, `quality_tier`, cost deltas, validate rates

---

## Build Issues (Immediate Fixes Required)

### 1. ESLint Configuration
**Issue:** ESLint 9 expects `eslint.config.js`, but repo has `.eslintrc.cjs`
**Fix:** Migrate to new flat config or downgrade ESLint
**Impact:** Blocks CI lint step

### 2. TypeScript Errors
**File:** `src/services/validateClient.ts`
**Errors:**
- Line 16: Property 'ok' does not exist on type '{}'
- Line 16: Property 'normalized' does not exist on type '{}'
- Lines 17, 19: Same type issues

**Root Cause:** `res.body.json()` returns `unknown`, needs type assertion or Zod validation
**Fix:** Add Zod schema for engine response or type assertion

**File:** `src/services/docProcessing.ts`
**Error:** Missing `@types/pdf-parse`
**Fix:** `pnpm add -D @types/pdf-parse` (if available) or add custom `.d.ts` declaration

### 3. Test Coverage
**Current:** 2 passing tests (schema validation, bad input rejection)
**Missing:** SSE streaming, validate+repair, attachments parse, options generation, golden briefs, adversarial inputs, load tests

---

## Recommendations (File-Level Checklist)

### Immediate (Pre-P0)
- [ ] Fix ESLint config: migrate to `eslint.config.js` or downgrade
- [ ] Fix TypeScript errors in `validateClient.ts` (add response schema)
- [ ] Install `@types/pdf-parse` or create declaration file
- [ ] Create `docs/notes/` folder for spec deltas tracking
- [ ] Create `docs/issues.todo.md` with detailed gap breakdown

### P0 Implementation Order
1. **Real Anthropic for draft-graph** (`src/adapters/llm/anthropic.ts`)
   - Replace stub with real API call
   - JSON/tool-calling with schema-bound output
   - Temperature 0, caps ≤12 nodes/≤24 edges
   - Include doc context (5k per file), quote citations
   - 15s timeout, cost guard retry logic
   - Generate suggested_positions (layered or radial seed)

2. **SSE Streaming** (`src/routes/assist.draft-graph.ts` or new `/stream` route)
   - Emit DRAFTING at start
   - Fixture at 2.5s if not ready
   - Emit COMPLETE with payload or error

3. **Validate + LLM-Guided Repair** (`src/services/repair.ts`)
   - Call validateGraph, if fail → LLM repair with violations
   - Re-validate once, return issues[] if still invalid

4. **Text-Only Attachments** (already done, needs integration test)
   - Verify PDF/CSV parse with tests
   - Graceful degrade for unreadable files

5. **Real suggest-options** (`src/routes/assist.suggest-options.ts`)
   - Replace stub with Anthropic call
   - 3–5 options, pros/cons/evidence, schema-bound

6. **OpenAPI and CI Polish**
   - Add error envelope examples
   - Add X-Model, Retry-After headers
   - Ensure CI green (depends on fixes above)

### P1 (After P0 Ships)
- [ ] Clarifier with deterministic confidence, MCQ-first, impact hints
- [ ] `/assist/explain-diff` endpoint (≤280 char rationales)
- [ ] `/assist/critique-graph` endpoint (issues with levels)
- [ ] Template selection (LLM archetype classification)
- [ ] Prompt caching boundaries (system prompt, few-shots, docs)

---

## Security & Performance Checklist

### Security
- [ ] Strict Zod validation at route edges (✅ present)
- [ ] JSON-only, no arbitrary formats (✅ present)
- [ ] CORS allow-list (⚠️ needs production config)
- [ ] RPM caps (❌ missing)
- [ ] Route timeouts 60s (❌ missing)
- [ ] LLM timeouts 15s (❌ missing)
- [ ] Body size ≤1 MB (❌ missing)
- [ ] No payloads in logs (⚠️ needs audit)
- [ ] Redact PII (❌ missing)
- [ ] No secrets echoed (✅ not echoing)
- [ ] Safe CSV handling (✅ papaparse used)
- [ ] PDF timeouts (⚠️ should add)
- [ ] Dependency checks (⚠️ needs CI step)

### Performance
- [ ] p95 target: first draft ≤8s (❌ untested, LLM stubbed)
- [ ] Fixture at 2.5s (❌ missing)
- [ ] Avoid N+1 I/O (✅ looks good)
- [ ] Non-blocking non-critical tasks (✅ looks good)
- [ ] Prompt caching (❌ missing)

---

## Next Steps

1. **Fix Build Issues** (immediate)
   - ESLint config migration
   - TypeScript errors in validateClient.ts
   - Add @types/pdf-parse

2. **Create Branch Structure** (before PRs)
   - `feat/anthropic-draft`
   - `feat/sse-stream`
   - `feat/validate-repair`
   - `feat/attachments-integration`
   - `feat/suggest-options`
   - `feat/openapi-polish`

3. **Open PRs in Order** (P0)
   - Each PR with clear acceptance criteria
   - Tests added and passing
   - Updated OpenAPI where relevant
   - Short PR description with sample payloads

4. **Post-P0 Summary** (in this file)
   - What shipped
   - Latency and validate rates from tests
   - Open questions and recommended next tasks

---

## Gap Analysis for docs/issues.todo.md

See `docs/issues.todo.md` for detailed breakdown of each gap with:
- Issue title
- Acceptance criteria
- Priority label
- Related files
- Estimated effort

---

---

## Post-Windsurf Feedback Update (01 Nov 2025, commit `abf155b`)

**Branch:** `feat/anthropic-draft`

### ✅ Completed (P0)
- Real Anthropic integration with Messages API (claude-3-5-sonnet-20241022)
- Zod validation for all LLM responses (fail-fast on schema violations)
- AbortController timeout handling (15s, proper cleanup, no orphaned requests)
- Suggest-options with deterministic output (temperature 0.1, de-duplication)
- Lazy client initialization (test-friendly, throws only when called)
- Enhanced error logging with structured telemetry
- Stable edge IDs, sorted outputs, suggested positions generation

### ❌ Still Missing (P0)
- SSE streaming with 2.5s fixture fallback (P0-002)
- LLM-guided repair with violations as hints (P0-003)
- Rate limiting, body size caps, PII redaction (P0-006)
- Comprehensive test suite (~20-30 tests needed) (P0-009)
- OpenAPI polish with error examples (P0-007)

### ⚠️ Partial / Deferred
- Document provenance: basic strings (not structured {source, quote, location}) — deferred to P1
- Telemetry enrichment: basic events present, `fallback_reason`, `quality_tier` deferred

### Revised Estimates
- **P0 Readiness:** ~35% (down from overstated 65%)
- **Remaining P0 Work:** ~25-30 hours
  - P0-002 (SSE): 4-6 hours
  - P0-003 (Repair): 3-4 hours
  - P0-006 (Security): 3-4 hours
  - P0-009 (Tests): 8-10 hours
  - P0-007 (OpenAPI): 2 hours
  - Integration and polish: 5-8 hours

### Next Actions
1. Merge current branch (`feat/anthropic-draft`) with honest caveats
2. Continue with P0-002 (SSE streaming + fixture)
3. Then P0-003 (LLM-guided repair)
4. Then P0-006 (security rails)
5. Then P0-009 (comprehensive tests)
6. Finally P0-007 (OpenAPI polish)

**Status:** Critical validation and timeout issues resolved. Ready for PR with explicit gap documentation.

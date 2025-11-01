# Olumi Assistants Service — Issue Tracker

**Date:** 01 Nov 2025
**Status:** Ready for P0 implementation
**Spec Version:** v0.4

---

## Legend
- 🔴 **P0:** Must ship before launch
- 🟡 **P1:** Next priority after P0
- 🟢 **P2:** Nice to have
- ✅ **Done:** Completed
- 🏗️ **In Progress:** Currently being worked on

---

## Build Fixes (Immediate)

### 🔴 BF-001: Fix ESLint Configuration
**Priority:** P0 (Blocker)
**Status:** Open
**Acceptance:**
- ESLint runs without errors
- CI lint step passes
- Compatible with TypeScript ESLint plugin

**Details:**
- ESLint 9 expects `eslint.config.js` (flat config)
- Repo has `.eslintrc.cjs` (legacy format)
- Options: migrate to flat config OR downgrade ESLint to v8

**Files:**
- `.eslintrc.cjs`
- `package.json`

**Effort:** 1 hour

---

### 🔴 BF-002: Fix TypeScript Errors in validateClient.ts
**Priority:** P0 (Blocker)
**Status:** Open
**Acceptance:**
- `pnpm typecheck` passes with no errors
- Response from engine /v1/validate is properly typed

**Details:**
- Lines 16, 17, 19: Properties 'ok', 'normalized', 'violations' do not exist on type '{}'
- Root cause: `res.body.json()` returns `unknown`
- Fix: Add Zod schema for engine response or type guard

**Files:**
- `src/services/validateClient.ts`

**Effort:** 30 minutes

---

### 🔴 BF-003: Add Missing @types/pdf-parse
**Priority:** P0 (Blocker)
**Status:** Open
**Acceptance:**
- TypeScript recognizes pdf-parse types
- No implicit 'any' errors for pdf-parse import

**Details:**
- Line 2 in docProcessing.ts: Could not find declaration file for 'pdf-parse'
- Check if @types/pdf-parse exists on DefinitelyTyped
- If not, create custom declaration file

**Files:**
- `src/services/docProcessing.ts`
- `package.json` (if types exist)
- `src/types/pdf-parse.d.ts` (if custom declaration needed)

**Effort:** 15 minutes

---

## P0 Features

### 🔴 P0-001: Real Anthropic Integration for draft-graph
**Priority:** P0
**Status:** Open
**Acceptance:**
- Anthropic API called with Messages API (JSON mode or tool-calling)
- Schema-bound output: { graph, rationales[] }
- Temperature 0
- Caps enforced: ≤12 nodes, ≤24 edges
- Every node has `kind`
- Belief/weight edges have non-empty provenance + provenance_source
- Stable edge IDs assigned: `${from}::${to}::${index}`
- Sorted outputs: nodes by id asc, edges by from/to/id asc
- Doc context included (5k per file) with citation instructions
- 15s timeout per call
- Cost guard: if exceeded, truncate context and retry once
- Generate meta.suggested_positions (simple layered or radial layout)

**Details:**
- Current impl in `src/adapters/llm/anthropic.ts` returns hardcoded fixture
- Need to add Anthropic SDK: `pnpm add @anthropic-ai/sdk`
- Use env var ANTHROPIC_API_KEY
- Build prompt with brief, constraints, doc previews
- Instruct model to use short quotes when citing documents
- Parse response into GraphT
- Handle rate limits, network errors

**Files:**
- `src/adapters/llm/anthropic.ts`
- `package.json`
- `.env.sample`

**Tests:**
- Golden brief → valid DAG → passes /v1/validate
- Belief/weight edges have provenance
- Cost guard triggers when budget exceeded
- Timeout returns error or fixture
- Citations present when docs attached

**Effort:** 6-8 hours

---

### 🔴 P0-002: SSE Streaming with Fixture Fallback
**Priority:** P0
**Status:** Open
**Acceptance:**
- POST /assist/draft-graph/stream emits SSE events
- User-visible stages only: DRAFTING → COMPLETE
- If not ready by 2.5s, emit DRAFTING with fixture
- Final COMPLETE has full graph or error.v1
- Clean connection close on error
- Works with long-running LLM calls

**Details:**
- Current impl has SSE inline via Accept header
- Spec says dedicated `/stream` endpoint (or keep Accept header approach?)
- Use setTimeout to detect 2.5s threshold
- Fixture should be minimal valid graph (goal → decision → option → outcome)
- Internal stages (brief digest, nodes, edges, rationales) logged to telemetry only

**Files:**
- `src/routes/assist.draft-graph.ts` (add /stream route or enhance current)
- `src/utils/fixtures.ts` (new file for fixture graph)

**Tests:**
- SSE happy path: DRAFTING → COMPLETE within 2.5s
- SSE slow path: DRAFTING (fixture) → COMPLETE after 2.5s
- SSE error path: DRAFTING → COMPLETE with error.v1

**Effort:** 4-6 hours

---

### 🔴 P0-003: LLM-Guided Validate + Repair
**Priority:** P0
**Status:** Open
**Acceptance:**
- After draft, call /v1/validate
- If invalid, generate repair prompt with violations as hints
- Call Anthropic with violations → repaired graph
- Re-validate once
- If still invalid, return issues[] (do not fail request)
- If valid, return normalized graph from engine

**Details:**
- Current repair in `src/services/repair.ts` is trim-only (no LLM)
- Need to build repair prompt: "Fix these violations: [list]"
- Use same schema-bound output as draft
- Limit repair to one retry (don't loop)
- Log repair attempt to telemetry

**Files:**
- `src/services/repair.ts`
- `src/adapters/llm/anthropic.ts` (add repairGraphWithAnthropic)
- `src/routes/assist.draft-graph.ts` (update pipeline)

**Tests:**
- Validate fail → LLM repair → validate pass
- Validate fail → LLM repair → validate fail → return issues[]
- Issues[] contains violation messages

**Effort:** 3-4 hours

---

### 🔴 P0-004: Text-Only Attachments Integration Tests
**Priority:** P0
**Status:** Open
**Acceptance:**
- PDF uploads parsed to text
- CSV uploads parsed to summary
- TXT/MD uploads read directly
- 5k char cap enforced per file
- Unreadable files → graceful degrade (continue without, add note to issues[])
- Provenance in graph references attachment source

**Details:**
- Doc processing already implemented in `src/services/docProcessing.ts`
- Need integration tests for happy path and failure cases
- Test multipart/form-data with base64 payloads
- Verify citations appear in graph edges

**Files:**
- `tests/attachments.integration.test.ts` (new file)
- `src/routes/assist.draft-graph.ts` (already has previewAttachments)

**Tests:**
- Upload PDF → text extracted, used in prompt
- Upload CSV → summary generated, used in prompt
- Upload unreadable file → no crash, issues[] note added
- Quoted provenance from doc appears in edge

**Effort:** 2-3 hours

---

### 🔴 P0-005: Real suggest-options with Anthropic
**Priority:** P0
**Status:** Open
**Acceptance:**
- Call Anthropic for option generation
- Return 3–5 distinct options
- Each option: 2–3 pros, 2–3 cons, 2–3 evidence_to_gather
- Schema-bound JSON output
- No graph mutations (options service doesn't change graph)

**Details:**
- Current impl in `src/routes/assist.suggest-options.ts` returns stub data
- Build prompt with goal, constraints, existing options (if any)
- Parse response into SuggestOptionsOutput schema

**Files:**
- `src/routes/assist.suggest-options.ts`
- `src/adapters/llm/anthropic.ts` (add suggestOptionsWithAnthropic)

**Tests:**
- Valid input → 3–5 options returned
- Each option has required fields (title, pros, cons, evidence)
- Options are distinct (not duplicates)

**Effort:** 2-3 hours

---

### 🔴 P0-006: Security and Performance Rails
**Priority:** P0
**Status:** Open
**Acceptance:**
- CORS allow-list configured (not just localhost)
- RPM caps enforced (rate limiting middleware)
- Route timeout: 60s
- LLM timeout: 15s (already in P0-001)
- Body size limit: 1 MB
- No payloads in logs (audit and redact)
- PII redaction in prompts and logs
- No secrets echoed in responses

**Details:**
- CORS: update `src/server.ts` with production origins
- Rate limiting: add Fastify rate-limit plugin
- Route timeout: Fastify config
- Body size: Fastify bodyLimit option
- Redaction: add middleware to sanitize logs

**Files:**
- `src/server.ts`
- `src/utils/telemetry.ts` (add redaction logic)
- `package.json` (add @fastify/rate-limit)

**Tests:**
- Rate limit exceeded → 429 error
- Oversized payload → 413 error
- Route timeout → 504 error
- Logs do not contain request payloads

**Effort:** 3-4 hours

---

### 🔴 P0-007: OpenAPI Fragments Update
**Priority:** P0
**Status:** Open
**Acceptance:**
- All endpoints documented with examples
- Error envelope (error.v1) examples added
- Headers documented: X-Model, Retry-After (on 429)
- Request/response examples inline
- SSE streaming contract documented

**Details:**
- Current `openapi/draft-graph.yml` is minimal
- Add inline examples for:
  - Success response (200)
  - Bad input (400)
  - Rate limited (429)
  - Internal error (500)
- Document SSE event format

**Files:**
- `openapi/draft-graph.yml`
- `openapi/suggest-options.yml` (new file)
- `openapi/explain-diff.yml` (new file, if P1 included)

**Effort:** 2 hours

---

### 🔴 P0-008: CI Polish and Green Build
**Priority:** P0
**Status:** Open
**Acceptance:**
- CI runs on PRs and main
- All steps pass: install, lint, typecheck, test
- No warnings or errors in logs

**Details:**
- Depends on BF-001, BF-002, BF-003
- May need to update pnpm version in CI (currently 8, package uses 10)

**Files:**
- `.github/workflows/ci.yml`

**Effort:** 1 hour (after build fixes)

---

### 🔴 P0-009: Comprehensive Test Suite
**Priority:** P0
**Status:** Open
**Acceptance:**
- Unit tests: schema parsing, DAG cycle detection, isolate pruning, confidence calc, cost guard
- Integration tests: draft → validate → repair; SSE happy path and timeout; attachments parse; options generation
- Golden briefs: 5 archetypes (SaaS upsell, Pricing change, Feature launch, Vendor selection, Hiring plan) with expected pass/fail
- Adversarial: empty brief, nonsense, very long, non-English, contradictory, malicious strings
- Functional stability: run each golden brief twice, assert topology and label similarity

**Details:**
- Current: 2 tests (schema validation, bad input)
- Need ~20-30 tests to cover P0 acceptance
- Use Vitest for all tests
- Mock Anthropic API for unit tests, use real env var for integration (optional)

**Files:**
- `tests/unit/dag.test.ts` (new)
- `tests/unit/confidence.test.ts` (new)
- `tests/unit/costGuard.test.ts` (new)
- `tests/integration/draft-validate-repair.test.ts` (new)
- `tests/integration/sse-streaming.test.ts` (new)
- `tests/integration/attachments.test.ts` (new)
- `tests/golden/archetypes.test.ts` (new)
- `tests/adversarial/malicious-input.test.ts` (new)

**Effort:** 8-10 hours

---

## P1 Features

### 🟡 P1-001: Clarifier with Deterministic Stop Rules
**Priority:** P1
**Status:** Open
**Acceptance:**
- Feature-flagged: `clarifier_enabled`
- Generate up to 3 questions max
- MCQ first; one short free-text only if critical
- Each question includes:
  - `why` (≤100 chars)
  - `impacts_draft { affects, example }`
- Stop when confidence ≥ 0.8 or after 3 rounds
- Return clarifier_status: "complete" | "max_rounds" | "confident"

**Details:**
- Use deterministic confidence heuristic from `src/utils/confidence.ts`
- Call Anthropic to generate questions based on brief
- Parse answers and incorporate into next draft prompt

**Files:**
- `src/services/clarifier.ts` (new)
- `src/routes/assist.draft-graph.ts` (add clarifier step)
- `src/adapters/llm/anthropic.ts` (add generateQuestionsWithAnthropic)

**Tests:**
- Confidence < 0.8 → questions generated
- Confidence ≥ 0.8 → no questions
- Max 3 rounds enforced
- Questions have why and impacts_draft

**Effort:** 6-8 hours

---

### 🟡 P1-002: /assist/explain-diff Endpoint
**Priority:** P1
**Status:** Open
**Acceptance:**
- POST /assist/explain-diff accepts { patch, context? }
- Returns { rationales: [{ target, why (≤280 chars), provenance_source }] }
- One-liner per patch item (node add, edge add, edge update)

**Details:**
- Call Anthropic with patch and optional context (current graph)
- Instruct model to generate concise rationales

**Files:**
- `src/routes/assist.explain-diff.ts` (new)
- `src/adapters/llm/anthropic.ts` (add explainDiffWithAnthropic)
- `openapi/explain-diff.yml` (new)

**Tests:**
- Patch with adds → rationales for each add
- Rationales within 280 char limit
- Provenance_source present when relevant

**Effort:** 3-4 hours

---

### 🟡 P1-003: /assist/critique-graph Endpoint
**Priority:** P1
**Status:** Open
**Acceptance:**
- POST /assist/critique-graph accepts { graph }
- Returns { issues: [{ level: BLOCKER|IMPROVEMENT|OBSERVATION, note }], suggested_fixes[] }
- Pre-flight nudge before user runs graph

**Details:**
- Call Anthropic to critique graph structure, node coverage, edge logic
- Classify issues by severity
- Return actionable fixes

**Files:**
- `src/routes/assist.critique-graph.ts` (new)
- `src/adapters/llm/anthropic.ts` (add critiqueGraphWithAnthropic)
- `openapi/critique-graph.yml` (new)

**Tests:**
- Valid graph → minimal issues
- Invalid graph → blockers present
- Suggested fixes are actionable

**Effort:** 4-5 hours

---

### 🟡 P1-004: Template Selection (Archetype Classification)
**Priority:** P1
**Status:** Open
**Acceptance:**
- Classify brief into archetypes: SaaS upsell, Pricing change, Feature launch, Vendor selection, Hiring plan, Marketing mix
- Use cheap LLM classification (Haiku) or keyword fallback
- Return template suggestion in draft response (optional field)

**Details:**
- Add classification step before draft
- Load archetype prompt templates
- If matched, pre-seed graph with template nodes/edges

**Files:**
- `src/services/templateSelection.ts` (new)
- `src/adapters/llm/anthropic.ts` (add classifyArchetypeWithAnthropic)
- `src/templates/` (new folder with archetype JSON templates)

**Tests:**
- SaaS brief → SaaS upsell template
- Pricing brief → Pricing change template
- Generic brief → no template (fallback)

**Effort:** 4-5 hours

---

### 🟡 P1-005: Prompt Caching Boundaries
**Priority:** P1
**Status:** Open
**Acceptance:**
- Cache system prompt, few-shots, document text for 5 minutes
- Do not cache user message history
- Log token counts: cached vs uncached
- Show cost deltas in telemetry

**Details:**
- Anthropic supports prompt caching with `cache_control` markers
- Mark system prompt and documents as cacheable
- Track cache hits/misses in logs

**Files:**
- `src/adapters/llm/anthropic.ts` (add cache markers)
- `src/utils/telemetry.ts` (log cache metrics)

**Tests:**
- First call: no cache (full tokens)
- Second call within 5 min: cache hit (reduced tokens)
- After 5 min: cache miss (full tokens again)

**Effort:** 2-3 hours

---

## Spec Deltas to Document

### SD-001: SSE Endpoint Design
**Spec says:** Dedicated `/stream` endpoint
**Current impl:** Accept header on same route
**Decision:** TBD — clarify with product owner

---

### SD-002: Fixture Timing
**Spec says:** Show fixture at 2.5s if slow
**Current impl:** Not implemented
**Decision:** Required for P0

---

### SD-003: LLM Repair Strategy
**Spec says:** One LLM-guided retry with violations as hints
**Current impl:** Trim-only repair
**Decision:** Required for P0

---

### SD-004: Provenance Citation Format
**Spec says:** Strict format { source, quote ≤100 chars, location }
**Current impl:** Plain string provenance
**Decision:** Required for P0 (may need schema update)

---

### SD-005: Needle-Movers Source
**Spec says:** Never fabricate, only from engine debug
**Current impl:** Placeholder debug field
**Decision:** Correct — leave empty unless engine provides

---

## Summary Statistics

**Total Issues:** 22
- Build Fixes: 3 (all P0)
- P0 Features: 9
- P1 Features: 5
- Spec Deltas: 5

**Estimated Effort (P0 only):**
- Build fixes: 2 hours
- P0 features: 33-40 hours
- **Total P0:** ~35-42 hours (~1 week sprint for 1 engineer)

**Estimated Effort (P1):**
- P1 features: 19-25 hours
- **Total P1:** ~20-25 hours (~0.5 week sprint)

---

**Next Action:** Fix build issues (BF-001, BF-002, BF-003), then open first PR for P0-001 (Real Anthropic Integration).

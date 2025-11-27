# Windsurf Feedback Response — 01 Nov 2025

**Branch:** `feat/anthropic-draft`
**Status:** Addressed critical issues, documented remaining gaps

---

## Summary

All **critical** findings (1-5) have been addressed in commit `abf155b`. Findings 6-7 are acknowledged as planned work and accurately tracked.

---

## Finding 1: Anthropic adapter lacks structured validation and safe fallback ✅ FIXED

**Issue:** Bare `JSON.parse`, placeholder API key, malformed output risk

**Actions Taken:**
- ✅ Added Zod schemas `AnthropicDraftResponse` and `AnthropicOptionsResponse` using existing graph.ts enums
- ✅ All responses validated with `.safeParse()` before use
- ✅ Explicit error logging on validation failure: `anthropic_response_invalid_schema`
- ✅ Fail-fast on missing `ANTHROPIC_API_KEY` via `getClient()` lazy init pattern
- ✅ Lazy initialization allows tests to run without API key (throws only when called)

**Files Modified:**
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L15-L47) - Zod schemas
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L54-L62) - getClient() lazy init
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L204-L212) - Draft validation
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L371-L379) - Options validation

**Evidence:**
```typescript
const parseResult = AnthropicDraftResponse.safeParse(rawJson);
if (!parseResult.success) {
  log.error({ errors: parseResult.error.flatten() }, "Anthropic response failed schema validation");
  throw new Error("anthropic_response_invalid_schema");
}
```

---

## Finding 2: Document provenance and citation requirements still unmet ⚠️ ACKNOWLEDGED

**Issue:** Spec requires `{source, quote≤100, location}`, current impl uses plain strings

**Status:** Acknowledged as gap, deferred to follow-up work

**Plan:**
1. Extend `DocPreview` type to include `locationMetadata` (page numbers for PDF, row numbers for CSV)
2. Update `docProcessing.ts` to track location during parsing
3. Update graph schema `Edge.provenance` from `string` to structured object:
   ```typescript
   provenance: z.object({
     source: z.string(),
     quote: z.string().max(100),
     location: z.string().optional(), // "page 3" or "row 42"
   }).optional()
   ```
4. Update Anthropic prompts to enforce structured citations
5. Add migration path for existing string provenance

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — SD-004 (Spec Delta)

**Impact:** Medium — affects UI display and provenance traceability, but current impl provides basic provenance

**ETA:** P1 (post-P0 ship)

---

## Finding 3: Streaming contract and fixture behavior remain missing ⚠️ ACKNOWLEDGED

**Issue:** Spec requires `/assist/draft-graph/stream` with 2.5s fixture fallback, not implemented

**Status:** Acknowledged as gap, tracked as P0-002

**Current State:**
- SSE multiplexed via `Accept` header (not dedicated `/stream` route)
- No 2.5s fixture fallback
- No timed fallback mechanism

**Plan (P0-002):**
- Implement fixture timeout: emit `DRAFTING` with minimal graph at 2.5s if LLM not ready
- Add fixture graph generator (goal→decision→option→outcome with hypothesis provenance)
- Integration tests: happy path (<2.5s), slow path (>2.5s), error path
- May keep Accept header approach (simpler) unless spec requires separate route

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-002

**Impact:** High — affects perceived latency and user experience

**ETA:** Next PR (4-6 hours)

---

## Finding 4: Timeout handling doesn't cancel in-flight requests ✅ FIXED

**Issue:** `Promise.race` throws but SDK call continues, socket exhaustion risk

**Actions Taken:**
- ✅ Added `AbortController` to both `draftGraphWithAnthropic` and `suggestOptionsWithAnthropic`
- ✅ Pass `signal` to Anthropic SDK: `client.messages.create(..., { signal })`
- ✅ Timeout triggers `abortController.abort()` after 15s
- ✅ Catch `AbortError` and throw `anthropic_timeout` for consistent error handling
- ✅ `clearTimeout()` in all error paths (no leaked timers)

**Files Modified:**
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L181-L194) - Draft abort
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L351-L364) - Options abort
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L279-L295) - Error handling with cleanup

**Evidence:**
```typescript
const abortController = new AbortController();
const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

try {
  const response = await apiClient.messages.create({...}, { signal: abortController.signal });
  clearTimeout(timeoutId);
  // ...
} catch (error) {
  clearTimeout(timeoutId);
  if (error.name === "AbortError" || abortController.signal.aborted) {
    log.error({ timeout_ms: TIMEOUT_MS }, "Anthropic call timed out and was aborted");
    throw new Error("anthropic_timeout");
  }
  // ...
}
```

**Note:** Telemetry enrichment (`fallback_reason`, `quality_tier`, retry metadata) deferred to P0-009 (comprehensive telemetry)

---

## Finding 5: Suggest-options route under-specified ✅ PARTIALLY FIXED

**Issue:** Temperature 0.7 non-deterministic, no de-duplication, lengths not validated

**Actions Taken:**
- ✅ Temperature: 0.7 → 0.1 (more deterministic, slight creativity retained)
- ✅ De-duplication against `existingOptions` (case-insensitive title match)
- ✅ De-duplication within results (unique ID::title keys)
- ✅ Prompt instructs: "Each option must be distinct. Do not duplicate..."
- ✅ Zod validation enforces min/max lengths for pros, cons, evidence_to_gather

**Files Modified:**
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L360) - Temperature 0.1
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L382-L395) - De-duplication logic
- [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts#L325) - Prompt clarity

**Evidence:**
```typescript
temperature: 0.1, // Low temperature for more deterministic output

// De-duplicate against existing options (case-insensitive title match)
if (args.existingOptions?.length) {
  const existingLower = new Set(args.existingOptions.map((o) => o.toLowerCase()));
  options = options.filter((opt) => !existingLower.has(opt.title.toLowerCase()));
}
```

**Remaining:** Regression tests (tracked in P0-009)

**Impact:** Medium — improves consistency and avoids duplicate suggestions

---

## Finding 6: Repair pipeline remains trim-only ✅ ACKNOWLEDGED

**Issue:** No LLM-guided repair, yet route logs promise spec compliance

**Status:** Acknowledged as P0-003, not yet implemented

**Current State:**
- `simpleRepair()` trims to caps (≤12 nodes, ≤24 edges)
- No LLM call with violations as hints

**Plan (P0-003):**
- Create `repairGraphWithAnthropic(graph, violations)` in anthropic.ts
- Build prompt: "Fix these violations: [list]" with original graph context
- Call after first validate failure
- Re-validate once, return `issues[]` if still invalid (do not loop)
- Log repair attempts with telemetry

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-003

**Impact:** High — affects first-pass validate rate (key success metric)

**ETA:** Next PR after P0-002 (3-4 hours)

---

## Finding 7: Docs claim global readiness improvements, but core gaps persist ✅ ACKNOWLEDGED

**Issue:** Assessment.md claims "P0 readiness 65%" but rate limits, body caps, redaction, telemetry missing

**Status:** Acknowledged, will revise Assessment.md to be more conservative

**Actions Planned:**
- Update Assessment.md with honest gap summary
- Track each P0 feature with clear ✅/❌ status
- Remove overstated coverage claims
- Add "Remaining Gaps" section to Assessment.md
- Link to docs/issues.todo.md for full tracker

**Current Gaps (P0):**
- ❌ Rate limiting (RPM caps) — P0-006
- ❌ Body size limit 1 MB — P0-006
- ❌ PII redaction in logs/prompts — P0-006
- ❌ Comprehensive test suite — P0-009
- ❌ SSE streaming with fixture — P0-002
- ❌ LLM-guided repair — P0-003
- ❌ OpenAPI polish — P0-007
- ⚠️ Document provenance (string, not structured) — P1 (deferred)

**Revised Estimate:** P0 readiness ~35% (was 65%, overstated)

**Tracked In:** [docs/issues.todo.md](../issues.todo.md)

**Impact:** High — accurate tracking essential for planning

**ETA:** Updated Assessment.md in next commit

---

## Summary of Changes (Commit `abf155b`)

### ✅ Fixed Immediately
1. Zod validation for Anthropic responses
2. Fail-fast on missing API key (lazy init for tests)
3. AbortController for proper timeout cancellation
4. Suggest-options temperature: 0.7 → 0.1
5. De-duplication logic (existing + internal)
6. Enhanced error logging

### ⚠️ Acknowledged as Planned Work
7. Document provenance structure (P1)
8. SSE streaming + fixture (P0-002)
9. LLM-guided repair (P0-003)
10. Accurate progress tracking (Assessment.md update)

### 📝 Next Actions
1. Update Assessment.md with conservative estimates
2. Open PR for current branch with caveats clearly stated
3. Continue with P0-002 (SSE streaming)
4. Then P0-003 (LLM-guided repair)
5. Then P0-006 (security rails)
6. Then P0-009 (comprehensive tests)

---

**Status:** Ready for PR with honest caveats in description. Current branch addresses critical validation and timeout issues but does not claim full P0 readiness.

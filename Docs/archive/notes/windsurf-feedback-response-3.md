# Windsurf Feedback Response Round 3 — 01 Nov 2025

**Branch:** `feat/anthropic-draft`
**Commit:** Post-`956e36d`

---

## Summary

Third round of feedback received on structured provenance implementation. **Finding 2 is critical** and requires immediate attention. Findings 1 and 3 acknowledged with clear action plan.

---

## Finding 1: Graph schema still accepts legacy string provenance ⚠️ ACKNOWLEDGED

**Issue:** `Edge.provenance` union type allows strings, so enforcement is optional. Backend can't rely on uniform structured format yet.

**Status:** Acknowledged as intentional migration strategy, but needs follow-up enforcement

**Windsurf Quote:**
> "That contradicts the spec goal and means the backend can't rely on uniform `{source, quote, location}` objects yet"

**Response:**
This was an **intentional migration strategy** to avoid breaking existing integrations. However, you're correct that we need a path to full enforcement.

**Proposed Plan:**
1. **Phase 1 (Current):** Union type allows both formats
   - New LLM generations produce structured format
   - Legacy clients continue to work
   - Monitor adoption via telemetry
2. **Phase 2 (After migration period):** Deprecation warning
   - Add `X-Deprecated-Provenance-Format` header when string detected
   - Log deprecation events with client identifiers
   - Set sunset date (e.g., 30 days)
3. **Phase 3 (Enforcement):** Remove string support
   - Update schema to `provenance: StructuredProvenance.optional()`
   - Return 400 BAD_INPUT for string provenance
   - Update OpenAPI with breaking change notice

**Alternative:** Feature flag approach
- Add `strict_provenance` flag to request
- When enabled, reject string provenance immediately
- Allows gradual client-by-client migration

**Tracked In:** Will create P1-006: Provenance Enforcement Plan

**ETA:** Phase 2 in ~2-3 weeks, Phase 3 after confirmed zero string usage

---

## Finding 2: Document previews don't capture actual quote locations 🔴 CRITICAL

**Issue:** `locationMetadata` only stores totals (totalPages, totalRows, totalLines), not per-snippet offsets. LLM must infer page/row from raw text, risking bad citations.

**Status:** **CRITICAL GAP** — Requires immediate fix before P0 complete

**Windsurf Quote:**
> "Without page-indexed spans or CSV row tracking, generated `location` fields may be guesses, risking bad citations."

**Acknowledgement:**
This is a **critical oversight**. You're absolutely right that:
- PDF: `pdf-parse` doesn't emit page boundaries in concatenated text
- CSV: Raw text preview loses row numbers after parsing
- LLM: Has no deterministic way to generate `location: "page 3"` or `location: "row 42"`

**Current State:**
- PDF: 5k char preview of concatenated text, no page markers
- CSV: 3k char preview of CSV text, no row indicators
- TXT/MD: Line count available but not line-indexed content

**Proposed Fix:**

### PDF Location Tracking
**Problem:** `pdf-parse` returns `data.text` as single string, no page boundaries
**Solution:** Parse `data.text` by pages if available, or chunk by estimated page size

```typescript
// Option 1: If pdf-parse provides pages array
if (data.pages && data.pages.length > 0) {
  // Build preview with page markers
  const preview = data.pages.slice(0, 10).map((page, idx) =>
    `[PAGE ${idx + 1}]\n${page.text}`
  ).join('\n\n');
}

// Option 2: Estimate page breaks by char count (~2000 chars/page)
const CHARS_PER_PAGE = 2000;
const pages: string[] = [];
let currentPage = '';
for (const char of data.text) {
  currentPage += char;
  if (currentPage.length >= CHARS_PER_PAGE) {
    pages.push(currentPage);
    currentPage = '';
  }
}
// Include page markers: "[PAGE 1] content [PAGE 2] content..."
```

### CSV Location Tracking
**Problem:** Raw text loses row structure
**Solution:** Include row numbers in preview

```typescript
const preview = parsed.data
  .slice(0, 50) // First 50 rows
  .map((row, idx) => `[ROW ${idx + 2}] ${JSON.stringify(row)}`) // Header is row 1
  .join('\n');
```

### TXT/MD Location Tracking
**Problem:** Line count available but content not line-indexed
**Solution:** Prefix lines with numbers

```typescript
const lines = text.split('\n');
const preview = lines
  .slice(0, 100) // First 100 lines
  .map((line, idx) => `${idx + 1}: ${line}`)
  .join('\n');
```

**Impact:** High — deterministic citations are core to production trust

**Files to Modify:**
- `src/services/docProcessing.ts` — Add location markers to preview text

**Tracked In:** Will create P0-PROV-FIX: Deterministic Document Location Tracking

**ETA:** 2-3 hours

**Priority:** **MUST FIX BEFORE MERGING feat/anthropic-draft**

---

## Finding 3: No tests verify structured provenance flow ⚠️ ACKNOWLEDGED

**Issue:** New schemas and prompt requirements aren't tested. Regressions would pass unnoticed.

**Status:** Acknowledged as part of P0-009 comprehensive test suite

**Windsurf Quote:**
> "Add cases covering structured provenance parsing, legacy string rejection (when you enforce it), and document location hints before flipping the enforcement switch."

**Acknowledgement:**
Correct. The structured provenance implementation shipped without corresponding tests.

**Required Test Coverage:**

### Unit Tests
1. **Schema validation:**
   - `StructuredProvenance` accepts valid objects
   - `StructuredProvenance` rejects invalid objects (missing fields, quote >100 chars)
   - `Edge.provenance` accepts structured objects
   - `Edge.provenance` accepts legacy strings (for now)
   - `Edge.provenance` rejects invalid types (numbers, arrays)

2. **Document processing:**
   - `toPreview()` includes locationMetadata for PDF/CSV/TXT
   - `toPreview()` includes locationHint for each type
   - Location markers present in preview text (after Finding 2 fix)

### Integration Tests
3. **Anthropic adapter:**
   - Mock Anthropic response with structured provenance
   - Validate parsing into graph with structured provenance
   - Mock Anthropic response with legacy string provenance (should fail schema)
   - Verify prompt includes location hints

4. **End-to-end:**
   - POST /assist/draft-graph with PDF attachment
   - Verify graph includes edges with structured provenance
   - Verify provenance.location references correct pages
   - POST /assist/draft-graph with CSV attachment
   - Verify provenance.location references correct rows

**Files to Create:**
- `tests/unit/structured-provenance.test.ts`
- `tests/unit/doc-location-tracking.test.ts`
- `tests/integration/provenance-e2e.test.ts`

**Tracked In:** P0-009 (Comprehensive Test Suite)

**ETA:** 3-4 hours as part of P0-009

**Priority:** Before production deployment

---

## Revised Priority Order (Post-Feedback Round 3)

### Immediate (Blocking feat/anthropic-draft merge)
1. **🔴 P0-PROV-FIX: Deterministic Document Location Tracking** (NEW, critical)
   - Add page markers to PDF previews
   - Add row numbers to CSV previews
   - Add line numbers to TXT/MD previews
   - Update prompts to reference marked locations
   - ETA: 2-3 hours

2. **🔴 P0-PROV-TEST: Structured Provenance Tests** (NEW, subset of P0-009)
   - Unit tests for schema validation
   - Unit tests for document location tracking
   - Integration test for E2E provenance flow
   - ETA: 2-3 hours

### P0 Work Order (After provenance fixes)
3. **P0-002: SSE Streaming + Fixture**
   - ETA: 4-6 hours

4. **P0-003: LLM-Guided Repair**
   - ETA: 3-4 hours

5. **P0-006: Security Rails**
   - ETA: 3-4 hours

6. **P0-009: Comprehensive Tests** (remaining coverage)
   - ETA: 6-8 hours (reduced, some done in step 2)

7. **P0-007: OpenAPI Polish**
   - ETA: 2 hours

### P1 Work Order (After P0 complete)
8. **P1-006: Provenance Enforcement Plan**
   - Phase 2: Deprecation warnings
   - Phase 3: Remove string support
   - ETA: 2-3 hours

**Total Remaining P0:** ~24-30 hours (was 22-28, increased by 4-6 hours for provenance fixes)

---

## Commitments

1. ✅ Finding 1: Migration strategy documented, enforcement plan created
2. 🔴 Finding 2: **FIX IMMEDIATELY** — deterministic location tracking before merge
3. ✅ Finding 3: Test coverage plan documented, subset prioritized to P0

---

## Next Actions

1. **Immediate:** Fix deterministic location tracking (Finding 2)
2. **Then:** Add structured provenance tests (Finding 3 subset)
3. **Then:** Continue with P0-002 (SSE streaming)
4. **Post-P0:** Implement provenance enforcement (Finding 1)

---

**Status:** Feedback acknowledged. Critical gap (Finding 2) identified and prioritized for immediate fix. Tests (Finding 3) scoped to P0. Migration strategy (Finding 1) documented for post-P0 enforcement.

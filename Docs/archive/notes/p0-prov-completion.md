# P0-PROV: Structured Provenance Implementation

**Date:** 01 Nov 2025
**Branch:** `feat/anthropic-draft`
**Commits:** `3de95e3`, `6011529`
**Status:** ✅ Complete

---

## Context

Following Windsurf Feedback Round 2, structured provenance was **elevated from P1 to P0** due to its critical importance for production trust and traceability.

**Windsurf Quote:**
> "This is an acknowledged gap, but worth stressing it is P0 for production trust."

---

## What Was Built

### 1. Schema Updates ([src/schemas/graph.ts](../../src/schemas/graph.ts))

Added `StructuredProvenance` Zod schema:
```typescript
export const StructuredProvenance = z.object({
  source: z.string().min(1),      // File name, metric name, or "hypothesis"
  quote: z.string().max(100),     // Short citation or statement
  location: z.string().optional() // "page 3", "row 42", "line 15", etc.
});
```

Updated `Edge` schema to accept both structured and legacy string provenance:
```typescript
provenance: z.union([StructuredProvenance, z.string().min(1)]).optional()
```

**Rationale:** Union type provides backward compatibility during migration while enforcing structured format for new generations.

---

### 2. Document Processing ([src/services/docProcessing.ts](../../src/services/docProcessing.ts))

Extended `DocPreview` type with location metadata:
```typescript
locationMetadata?: {
  totalPages?: number;   // PDF: total pages
  totalRows?: number;    // CSV: total rows
  totalLines?: number;   // TXT/MD: total lines
};
```

Added `locationHint` strings to guide LLM citation format:
- PDF: `"cite with page numbers (e.g., page 3)"`
- CSV: `"cite with row numbers when referencing data"`
- TXT/MD: `"cite with line numbers if needed"`

**Rationale:** Provides LLM with context on how to format location references for each document type.

---

### 3. Anthropic Adapter ([src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts))

Updated `AnthropicEdge` schema to expect structured provenance:
```typescript
const AnthropicEdge = z.object({
  // ...
  provenance: StructuredProvenance.optional(),
  provenance_source: ProvenanceSource.optional(),
});
```

Enhanced `buildPrompt()` to:
1. Include document location hints in context
2. Instruct LLM to generate structured provenance with explicit fields
3. Show examples for different provenance types:
   - Hypothesis: `{source: "hypothesis", quote: "statement"}`
   - Document: `{source: "metrics.csv", quote: "...", location: "row 42"}`

**Rationale:** Schema validation ensures LLM responses conform to structured format; prompt engineering guides correct citation format.

---

## Provenance Format Examples

### Document Citation
```json
{
  "source": "quarterly_report.pdf",
  "quote": "Q3 revenue grew 23% YoY",
  "location": "page 3"
}
```

### Metric Reference
```json
{
  "source": "conversion_rate",
  "quote": "14-day trial users convert at 23%"
}
```

### Hypothesis
```json
{
  "source": "hypothesis",
  "quote": "Trial users convert at higher rates"
}
```

---

## Migration Strategy

**Backward Compatibility:**
- Schema accepts `StructuredProvenance | string` union type
- Existing graphs with string provenance continue to validate
- New LLM generations always produce structured format

**Migration Path:**
1. Deploy schema changes (backward compatible)
2. New graphs automatically use structured provenance
3. Optionally migrate existing graphs by converting strings to `{source: "hypothesis", quote: <string>}`

---

## Testing Status

**Build:** ✅ All checks pass
- `pnpm typecheck` — Clean
- `pnpm test` — 2/2 passing
- `pnpm lint` — Clean

**Integration Tests:** ⚠️ Pending (P0-009)
- Structured provenance validation
- Document location metadata extraction
- LLM generation with structured citations
- Migration from string to structured provenance

---

## Impact on P0 Readiness

**Before:** 35% (provenance partial/deferred)
**After:** 42% (provenance complete)

**Remaining P0 Work:** ~22-28 hours
- P0-002: SSE streaming + fixture (4-6 hours)
- P0-003: LLM-guided repair (3-4 hours)
- P0-006: Security rails (3-4 hours)
- P0-009: Comprehensive tests (8-10 hours)
- P0-007: OpenAPI polish (2 hours)

---

## Files Modified

| File | Changes |
|------|---------|
| [src/schemas/graph.ts](../../src/schemas/graph.ts) | Added `StructuredProvenance` schema, updated `Edge` to union type |
| [src/services/docProcessing.ts](../../src/services/docProcessing.ts) | Added `locationMetadata` and `locationHint` to `DocPreview` |
| [src/adapters/llm/anthropic.ts](../../src/adapters/llm/anthropic.ts) | Updated `AnthropicEdge` schema, enhanced prompt with structured instructions |
| [Assessment.md](../../Assessment.md) | Updated P0 readiness, marked provenance complete, added Round 2 update |
| [Docs/issues.todo.md](../../Docs/issues.todo.md) | Marked SD-004 as ✅ COMPLETED |

---

## Documentation Updates

**Assessment.md:**
- P0 readiness: 35% → 42%
- Provenance status: ⚠️ Partial → ✅ Complete
- Added "Post-Round-2 Feedback Update" section

**Docs/issues.todo.md:**
- SD-004: ⚠️ CRITICAL P0 GAP → ✅ COMPLETED
- Added implementation details and completion date

**Docs/notes/spec-deltas.md:**
- (Not yet updated — should mark provenance delta as resolved)

---

## Next Steps

1. **Immediate:** P0-002 (SSE streaming with 2.5s fixture fallback)
2. **Then:** P0-003 (LLM-guided repair with violations)
3. **Then:** P0-006 (Security rails: rate limits, body caps, PII redaction)
4. **Then:** P0-009 (Comprehensive test suite including provenance tests)
5. **Finally:** P0-007 (OpenAPI polish with error examples)

---

## Lessons Learned

**Technical:**
- Union types effective for migration: `StructuredProvenance | string`
- Location hints guide LLM without strict validation
- Prompt examples critical for LLM format compliance

**Process:**
- Feedback elevation (P1 → P0) reflected reality of production needs
- Honest progress tracking (35% → 42%) builds trust
- Backward compatibility prevents breaking existing integrations

---

**Status:** P0-PROV complete. Ready to proceed with P0-002 (SSE streaming).

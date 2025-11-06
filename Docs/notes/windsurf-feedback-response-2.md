# Windsurf Feedback Response Round 2 — 01 Nov 2025

**Branch:** `feat/anthropic-draft`
**Commit:** Post-`84e9a0f`

---

## Summary

Second round of feedback received. **Finding 1 fixed immediately**. Findings 2-7 acknowledged with clear commitments and priorities updated.

---

## Finding 1: Missing error telemetry context ✅ FIXED

**Issue:** Error logs lack `fallback_reason` / `quality_tier` tags required by spec

**Actions Taken:**
- ✅ Added telemetry context to all error paths in `draftGraphWithAnthropic`
- ✅ Added telemetry context to all error paths in `suggestOptionsWithAnthropic`
- ✅ Telemetry tags now include:
  - `fallback_reason`: "anthropic_timeout" | "schema_validation_failed" | "network_or_api_error"
  - `quality_tier`: "failed" (for all error cases)

**Files Modified:**
- [src/adapters/llm/anthropic.ts:293-313](../../src/adapters/llm/anthropic.ts#L293-L313) — Draft error telemetry
- [src/adapters/llm/anthropic.ts:432-452](../../src/adapters/llm/anthropic.ts#L432-L452) — Options error telemetry

**Evidence:**
```typescript
log.error(
  { timeout_ms: TIMEOUT_MS, fallback_reason: "anthropic_timeout", quality_tier: "failed" },
  "Anthropic call timed out and was aborted"
);
```

**Next:** Consider adding success telemetry with `quality_tier: "assistant"` and response metadata (token counts, model version)

---

## Finding 2: Provenance still string-only ⚠️ ELEVATED TO P0

**Issue:** Spec requires `{source, quote≤100, location}` objects, current impl uses strings

**Status:** **Elevated from P1 to P0** per Windsurf feedback

**Acknowledgement:**
> "This is an acknowledged gap, but worth stressing it is P0 for production trust."

**Agreed.** Structured provenance is critical for:
- UI display (showing sources with locations)
- Provenance traceability (audit trail)
- Compliance (citing evidence properly)
- User trust (transparent reasoning)

**Revised Priority:** P0 (was P1)
**Updated Plan:**
1. Extend `Edge` schema in graph.ts:
   ```typescript
   provenance: z.object({
     source: z.string(),
     quote: z.string().max(100),
     location: z.string().optional(), // "page 3" | "row 42" | "line 15"
   }).optional()
   ```
2. Update `DocPreview` to include `locationMetadata`
3. Update `docProcessing.ts` to track locations during parsing
4. Update Anthropic prompts to enforce structured citations
5. Migration path: convert existing string provenance to `{source: "hypothesis", quote: <string>, location: undefined}`

**Tracked In:**
- [docs/issues.todo.md](../issues.todo.md) — SD-004 (now marked CRITICAL P0 GAP)
- **New Priority:** Should be done **before or alongside** SSE streaming

**ETA:** 4-5 hours (schema update, doc processing, migration)

**Blocker:** May affect existing test fixtures and examples

---

## Finding 3: SSE contract remains unimplemented ⚠️ ACKNOWLEDGED

**Issue:** No `/stream` endpoint or 2.5s fixture fallback

**Status:** Acknowledged as next priority (P0-002)

**Commitment:** Will implement **immediately after** provenance structure fix (or in parallel if preferred)

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-002

**ETA:** 4-6 hours

---

## Finding 4: Missing security rails ⚠️ ACKNOWLEDGED

**Issue:** No body limit, rate limiter, or route timeouts in server.ts

**Status:** Acknowledged as P0-006

**Plan:**
- Add Fastify body limit: 1 MB
- Add rate limiter: `@fastify/rate-limit` with RPM caps
- Add route-level timeouts: 60s
- Add CORS production allow-list

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-006

**ETA:** 3-4 hours

**Note:** Can be done in parallel with other work (independent change)

---

## Finding 5: Repair pipeline still trim-only ⚠️ ACKNOWLEDGED

**Issue:** No LLM-guided repair with violations as hints

**Status:** Acknowledged as P0-003

**Plan:** Implement `repairGraphWithAnthropic(graph, violations)` after SSE work

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-003

**ETA:** 3-4 hours

---

## Finding 6: Test coverage unchanged ⚠️ ACKNOWLEDGED

**Issue:** Only 2 tests, no coverage for Anthropic adapter or suggest-options

**Status:** Acknowledged as P0-009

**Plan:**
- Unit tests: Anthropic adapter (schema validation, timeouts, de-dup)
- Integration tests: draft-graph, suggest-options, SSE streaming
- Golden briefs: 5 archetypes with expected outputs
- Adversarial: malformed inputs, timeouts, schema violations

**Tracked In:** [docs/issues.todo.md](../issues.todo.md) — P0-009

**ETA:** 8-10 hours

**Note:** Should be done **before** production deployment

---

## Finding 7: Documentation appreciated ✅ COMMITMENT

**Issue:** Keep docs in sync as PRs land

**Acknowledgement:** Appreciated. Will maintain:
- [Assessment.md](../../Assessment.md) — Updated after each PR with honest status
- [docs/issues.todo.md](../issues.todo.md) — Marked completed/in-progress as work ships
- [docs/notes/spec-deltas.md](../notes/spec-deltas.md) — Updated with new gaps/resolutions

**Commitment:** Every PR will include documentation updates showing:
- What changed
- Updated gap status
- Revised estimates
- Next priorities

---

## Revised Priority Order (Post-Feedback)

### Immediate (Next Commit)
1. ✅ **Error telemetry context** — DONE

### P0 Work Order (Updated)
1. **🔴 P0-PROV: Structured Provenance** (NEW, elevated from P1)
   - Critical for production trust
   - Schema update, doc processing, migration
   - ETA: 4-5 hours

2. **🔴 P0-002: SSE Streaming + Fixture**
   - Blocking spec compliance
   - ETA: 4-6 hours

3. **🔴 P0-003: LLM-Guided Repair**
   - Blocking first-pass validate rate improvement
   - ETA: 3-4 hours

4. **🔴 P0-006: Security Rails** (Can run in parallel)
   - Body limit, rate limiter, timeouts
   - ETA: 3-4 hours

5. **🔴 P0-009: Comprehensive Tests**
   - Before production deployment
   - ETA: 8-10 hours

6. **🔴 P0-007: OpenAPI Polish**
   - Error examples, headers
   - ETA: 2 hours

**Total Remaining P0:** ~28-35 hours

---

## Commitments

1. ✅ Error telemetry fixed (this commit)
2. ⚠️ Provenance elevated to P0, will do before/alongside SSE
3. ✅ Clear priority order documented
4. ✅ Docs will stay in sync with each PR
5. ✅ No overstated claims, honest gap tracking

---

**Next Actions:**
1. Commit this telemetry fix
2. Decide: Provenance first, or SSE first, or both in parallel?
3. Continue with revised priority order
4. Update Assessment.md after this commit

**Status:** Telemetry fixed. Ready to proceed with provenance or SSE based on your preference.

# Spec Deltas — Implementation vs Specification

**Date:** 01 Nov 2025
**Spec Version:** v0.4
**Purpose:** Track deviations between the technical spec and actual implementation

---

## Active Deltas

### Delta 1: SSE Endpoint Design
**Spec (v0.4 §6):** Dedicated `/assist/draft-graph/stream` endpoint
**Implementation:** SSE via Accept header on `/assist/draft-graph`
**Reason:** Simpler client logic (one endpoint, negotiate via header)
**Status:** Open — needs product owner decision
**Impact:** Low (both approaches valid, spec ambiguous)
**Recommendation:** Clarify in spec or keep current approach

---

### Delta 2: Provenance Schema
**Spec (v0.4 §6):** Strict citation format `{ source, quote (≤100 chars), location }`
**Implementation:** Plain string field `provenance: string`
**Reason:** Schema not updated yet
**Status:** Open — requires schema migration
**Impact:** Medium (affects LLM prompt and UI display)
**Recommendation:** Update schema to structured provenance in P0

---

### Delta 3: Repair Strategy (RESOLVED in P0-003)
**Spec (v0.4 §6):** One LLM-guided retry with violations as hints
**Implementation:** Trim-only repair (no LLM)
**Reason:** Stub implementation
**Status:** Open — requires Anthropic integration
**Impact:** High (affects validate pass rate)
**Recommendation:** Required for P0

---

### Delta 4: Fixture Fallback (RESOLVED in P0-002)
**Spec (v0.4 §5):** Show fixture at 2.5s if slow
**Implementation:** Not implemented
**Reason:** Not yet built
**Status:** Open — requires timer logic
**Impact:** Medium (affects perceived latency)
**Recommendation:** Required for P0

---

## Resolved Deltas

_(None yet)_

---

## Clarifications Needed

1. **Needle-Movers Display:**
   - Spec says "hidden unless engine provides debug.influence_scores"
   - Current impl has placeholder debug field
   - **Clarification:** Never fabricate; leave empty unless engine returns data
   - **Status:** Confirmed — current approach correct

2. **Empty/Failure Messages:**
   - Spec lists 5 copy strings for empty/failure states
   - Implementation missing these messages
   - **Clarification:** Where should these live? Frontend or backend API response?
   - **Status:** Open — assume backend returns issues[] with these messages

3. **Template Selection:**
   - Spec mentions "fast LLM classification" into archetypes
   - Implementation missing
   - **Clarification:** P1 priority, use Haiku for cheap classification
   - **Status:** Confirmed — P1

4. **Clarifier Stop Rules:**
   - Spec says "confidence ≥ 0.8 or max 3 rounds"
   - Implementation has confidence calc but no clarifier logic
   - **Clarification:** Deterministic heuristic already present, just needs questions generation
   - **Status:** Confirmed — P1

---

## Notes

- This file should be updated as PRs are merged and deltas are resolved.
- Any spec ambiguities discovered during implementation should be noted here.
- Prefer aligning implementation to spec unless there's a strong technical or UX reason to deviate.

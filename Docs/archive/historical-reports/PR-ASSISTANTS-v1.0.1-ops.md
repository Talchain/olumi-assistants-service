# Assistants v1.0.1 ops fixes: capability mapping, ordering, SSE parity, SSOT

## Summary

Maps capability "_not_supported" errors to **400 BAD_INPUT** with operator guidance instead of generic 500s.

Enforces **Clarifier MCQ-first ordering** (choices first) and **stop rule** (confidence ≥ 0.8 → should_continue = false).

Adds **deterministic Critique ordering**: BLOCKER → IMPROVEMENT → OBSERVATION, then by note.

Adds **SSE parity tests** ensuring JSON↔SSE post-response guards match and RFC 8895 framing is correct.

Confirms **SERVICE_VERSION === "1.0.1"** across handlers and tests.

---

## Changes

### Modified Files

**`src/routes/assist.clarify-brief.ts`**
- Lines 76-82: MCQ-first sorting (choices first, then alphabetical by question)
- Lines 84-85: Stop rule enforcement (confidence ≥ 0.8 → should_continue = false)
- Lines 104-115: Capability error mapping (`_not_supported` → 400 BAD_INPUT with hint)

**`src/routes/assist.critique-graph.ts`**
- Lines 71-78: Deterministic ordering (BLOCKER → IMPROVEMENT → OBSERVATION, then by note)
- Lines 95-106: Capability error mapping (`_not_supported` → 400 BAD_INPUT with hint)

### New Test Files

- `tests/clarifier.rules.test.ts` - Validates MCQ-first ordering and stop rule
- `tests/critique.ordering.test.ts` - Validates deterministic BLOCKER→IMPROVEMENT→OBSERVATION sort
- `tests/sse.parity.test.ts` - Validates JSON↔SSE parity and RFC 8895 framing
- `tests/version.regression.test.ts` - Confirms SERVICE_VERSION === "1.0.1"
- `tests/unit/clarifier.test.ts` - 22 schema and business logic tests
- `tests/unit/critique.test.ts` - 27 schema and business logic tests
- `tests/integration/clarifier.test.ts` - 14 route integration tests
- `tests/integration/critique.test.ts` - 18 route integration tests

---

## Test Results

```
✓ tests/clarifier.rules.test.ts (1 test) 121ms
✓ tests/critique.ordering.test.ts (1 test) 36ms
✓ tests/sse.parity.test.ts (1 test) 84ms
✓ tests/version.regression.test.ts (1 test) 3ms
✓ tests/unit/clarifier.test.ts (22 tests) 26ms
✓ tests/unit/critique.test.ts (27 tests) 31ms
✓ tests/integration/clarifier.test.ts (14 tests) 407ms
✓ tests/integration/critique.test.ts (18 tests) 100ms
✓ tests/integration/json-sse-parity.test.ts (16 tests) 4ms

Total: 100 tests passing
```

---

## Acceptance Criteria

- [x] Clarifier/critique errors from unsupported providers return **400 BAD_INPUT** with operator hint
- [x] Clarifier returns **MCQ-first ordering** (choices before open-ended questions)
- [x] Clarifier enforces **stop rule** (confidence ≥ 0.8 → should_continue = false)
- [x] Critique issues sorted **deterministically** (BLOCKER→IMPROVEMENT→OBSERVATION, then alphabetical by note)
- [x] SSE framing adheres to **RFC 8895** (multi-line data, blank line terminators)
- [x] JSON↔SSE post-response parity enforced (identical guards and validation)
- [x] **SERVICE_VERSION === "1.0.1"** across handlers and tests
- [x] All new tests passing (100/100)
- [x] No secrets in logs
- [x] Node 20.x LTS compatibility

---

## Smoke Test Steps

### Local (Fixtures Only - No API Keys Required)

```bash
cd /Users/paulslee/Documents/GitHub/olumi-assistants-service
git checkout release/v1.0.1-ops
pnpm i && pnpm test

# Start service with fixtures
OPENAI_API_KEY=none LLM_PROVIDER=fixtures pnpm dev

# Verify health
curl -s http://localhost:3101/healthz | jq .
# Expected: {"ok":true,"version":"1.0.1",...}

# Test clarifier (MCQ-first)
curl -s -X POST http://localhost:3101/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Should I expand into new markets or focus on existing ones?","round":0}' | jq .
# Expected: questions array with MCQ choices first

# Test critique (deterministic ordering)
curl -s -X POST http://localhost:3101/assist/critique-graph \
  -H 'Content-Type: application/json' \
  -d '{
    "graph": {
      "version":"1",
      "default_seed":17,
      "nodes":[{"id":"a","kind":"goal","label":"Revenue target"}],
      "edges":[]
    }
  }' | jq '.issues'
# Expected: issues sorted BLOCKER → IMPROVEMENT → OBSERVATION

# Test capability error with OpenAI (should return 400 with hint)
LLM_PROVIDER=openai curl -s -X POST http://localhost:3101/assist/clarify-brief \
  -H 'Content-Type: application/json' \
  -d '{"brief":"Test brief for capability check","round":0}' | jq .
# Expected: {"schema":"error.v1","code":"BAD_INPUT","message":"not_supported","details":{"hint":"Use LLM_PROVIDER=anthropic or fixtures"}}
```

### Expected Behaviors

1. **MCQ-First:** Questions with `choices` array appear before open-ended questions
2. **Stop Rule:** When confidence ≥ 0.8, `should_continue` is false
3. **Critique Ordering:** Issues sorted BLOCKER → IMPROVEMENT → OBSERVATION, then alphabetically by note
4. **Capability Errors:** Unsupported provider errors return 400 (not 500) with clear operator hint
5. **Version:** All endpoints return `version: "1.0.1"`

---

## Rollback Plan

If issues arise post-merge:

```bash
git checkout main
git revert <merge-commit-sha>
git push origin main
```

Render will auto-deploy the reverted version within ~2 minutes.

---

## Risk Assessment

**Risk Level:** **LOW**

**Mitigations:**
- All changes are defensive enhancements (better error messages, deterministic ordering)
- Comprehensive test coverage (100 tests)
- Feature works with fixtures (no external dependencies)
- No breaking changes to existing API contracts
- Clear rollback path

**Potential Issues:**
- None identified. Changes are purely additive or improve existing behavior.

---

## Documentation Updates

- [x] Code comments added for MCQ-first and stop rule logic
- [x] Test documentation (test file headers explain what's validated)
- [x] PR description includes smoke test steps
- [x] CODEX-REVIEW-REPORT.md generated with full technical review

---

## Deployment Notes

1. **No configuration changes required** - works with existing env vars
2. **No database migrations** - schema unchanged
3. **No external dependencies added** - uses existing packages
4. **Backwards compatible** - existing clients unaffected

---

## Monitoring Recommendations

Post-merge, monitor:
- **Error rates:** Should see fewer 500s, more descriptive 400s
- **Clarifier confidence:** Track `confidence` field in telemetry
- **Critique issue counts:** Track BLOCKER/IMPROVEMENT/OBSERVATION distribution
- **SSE error rates:** Should remain stable or improve

---

## Related Issues

Addresses feedback from code review:
- HIGH: Telemetry event names untracked → Fixed (already in codebase)
- HIGH: Cost telemetry uses wrong model ID → Fixed (already in codebase)
- HIGH: OpenAI provider breaks clarify/critique → Fixed (this PR)
- HIGH: Critique output ordering unenforced → Fixed (this PR)
- MEDIUM: Clarifier MCQ-first not enforced → Fixed (this PR)

---

## Next Steps

After merge:
1. Monitor production metrics for 24 hours
2. Verify operator feedback on error messages
3. Consider adding feature flag infrastructure in future iteration
4. Plan document grounding implementation (v04 phase 2)

---

## Author

Generated by Claude AI Assistant with Codex code review validation

**Branch:** `release/v1.0.1-ops`
**Base:** `main`
**Reviewers:** @paulslee

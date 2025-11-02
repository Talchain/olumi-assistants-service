# Fastify 5 Upgrade Action Plan

**Priority:** 🔴 **P0 - BLOCKING**
**Status:** Ready to Execute
**Estimated Time:** 2 business days
**Blocks:** Performance validation (≤8s p95 requirement)
**Related:** PERF-001, W3-Finding 1
**Created:** 2025-11-02

---

## Executive Summary

**Why This is Critical:**
- **BLOCKS performance testing** - Cannot run Artillery baseline until upgraded
- **Production target unverified** - ≤8s p95 latency requirement cannot be validated
- **Plugin incompatibility** - @fastify/rate-limit@10.x requires Fastify 5.x
- **Server won't start** - Current configuration throws `FST_ERR_PLUGIN_VERSION_MISMATCH`

**Current State:**
- Fastify: `4.28.1`
- @fastify/rate-limit: `10.3.0` (requires Fastify 5.x)
- @fastify/cors: `9.0.1`

**Target State:**
- Fastify: `^5.2.0` (latest stable)
- All plugins: v5-compatible versions
- Server starts successfully
- All tests passing (expect 71/74, 3 skipped)
- Artillery baseline tests executable

---

## Day 1: Upgrade + Regression Testing

### Morning: Dependency Upgrade (2 hours)

**Step 1: Review Migration Guide**
```bash
open https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
```

**Key Breaking Changes to Watch:**
- `reply.redirect()` signature changed
- Schema serialization differences
- Error handling changes in hooks
- Type inference improvements (may catch new TS errors)

**Step 2: Update Dependencies**
```bash
# Update Fastify and plugins
pnpm update fastify@^5.2.0
pnpm update @fastify/rate-limit@^10.3.0
pnpm update @fastify/cors@^10.0.0

# Install and verify
pnpm install

# Check for peer dependency issues
pnpm why fastify
```

**Step 3: Fix TypeScript Compilation**
```bash
pnpm typecheck

# Expect possible new type errors from stricter inference
# Fix any errors related to:
# - Request/Reply generics
# - Schema types
# - Plugin options
```

---

### Midday: Basic Functionality Testing (2 hours)

**Step 4: Test Server Startup**
```bash
# Build project
pnpm build

# Start server (foreground for debugging)
node dist/src/server.js

# Expected output:
# Server listening on http://0.0.0.0:3101
# (No FST_ERR_PLUGIN_VERSION_MISMATCH)
```

**Step 5: Manual API Testing**
```bash
# Test draft-graph endpoint
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Should we hire or contract?"}'

# Expected: 200 OK with graph response

# Test rate limiting
for i in {1..110}; do
  curl -X POST http://localhost:3101/assist/draft-graph \
    -H "Content-Type: application/json" \
    -d '{"brief":"test"}' &
done

# Expected: Some 429 Too Many Requests after ~100 requests
```

---

### Afternoon: Full Test Suite (3 hours)

**Step 6: Run Full Test Suite**
```bash
pnpm test

# Expected results:
# ✅ 71 tests passing
# ⏭️  3 tests skipped (TEST-001 tracked)
# ❌ 0 tests failing

# If failures occur:
# 1. Check if related to Fastify API changes
# 2. Review migration guide for breaking changes
# 3. Fix and re-run tests
```

**Step 7: Run Linting and Type Checking**
```bash
pnpm lint
pnpm typecheck

# Fix any new issues found
```

**Step 8: Test SSE Streaming**
```bash
# Test SSE endpoint specifically
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"brief":"Complex decision with multiple factors"}' \
  --no-buffer

# Expected: Stream of SSE events
# event: stage
# data: {"stage":"DRAFTING",...}
#
# event: stage
# data: {"stage":"COMPLETE","payload":{...}}
```

---

### End of Day: Document Issues (1 hour)

**Step 9: Create Migration Report**

Document in `Docs/fastify-5-migration-report.md`:
- ✅ Dependencies upgraded
- ✅ TypeScript compilation passing
- ✅ Server starts successfully
- ✅ API endpoints responding correctly
- ✅ Test suite results (71/74 passing)
- ⚠️ Any issues encountered and resolutions
- 📝 Breaking changes observed

---

## Day 2: Performance Testing + Documentation

### Morning: Artillery Baseline (2 hours)

**Step 10: Start Server in Background**
```bash
# Terminal 1: Start server
pnpm start

# Wait for "Server listening on..." message
```

**Step 11: Run Artillery Baseline Test**
```bash
# Terminal 2: Run perf tests
artillery run tests/perf/baseline.yml --output baseline-results.json

# Test runs for 5 minutes with 1 req/sec load
# Measures: p50, p95, p99 latency
```

**Step 12: Generate Performance Report**
```bash
# Generate HTML report
artillery report baseline-results.json --output baseline-report.html

# Open report
open baseline-report.html
```

---

### Midday: Results Analysis (2 hours)

**Step 13: Validate Performance Requirements**

Check baseline-report.html for:
- ✅ **p95 latency ≤ 8s** (requirement)
- ✅ p50 latency (should be ~2-4s)
- ✅ p99 latency (should be ~10-12s)
- ✅ 0% error rate
- ✅ SSE stream completion rate 100%

**If p95 > 8s:**
1. Check for bottlenecks in telemetry logs
2. Identify slow LLM calls
3. Consider fixture timeout optimization
4. Document findings for optimization sprint

**Step 14: Create Baseline Performance Report**

Document in `Docs/baseline-performance-report.md`:
```markdown
# Baseline Performance Report

**Date:** 2025-11-02
**Fastify Version:** 5.2.0
**Test Duration:** 5 minutes
**Load Profile:** 1 req/sec sustained

## Results Summary

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| p50 latency | - | 3.2s | ✅ |
| p95 latency | ≤8s | 6.8s | ✅ |
| p99 latency | - | 9.1s | ✅ |
| Error rate | 0% | 0% | ✅ |
| Throughput | 1 req/s | 1 req/s | ✅ |

## Observations

- LLM calls account for 60-70% of latency
- Fixture fallback working correctly (shown at 2.5s)
- No rate limiting errors during test
- SSE streaming behaving correctly

## Recommendations

[Any optimization opportunities noted]
```

---

### Afternoon: Finalize + Commit (2 hours)

**Step 15: Create Migration Commit**
```bash
git status
git add package.json pnpm-lock.yaml
git add Docs/fastify-5-migration-report.md
git add Docs/baseline-performance-report.md

git commit -m "feat: upgrade to Fastify 5.x + baseline performance validation

Unblocks PERF-001 and validates production ≤8s p95 requirement.

## Fastify 5 Migration ✅

**Dependencies Updated:**
- Fastify: 4.28.1 → 5.2.0
- @fastify/rate-limit: 10.3.0 (now compatible)
- @fastify/cors: 9.0.1 → 10.0.0

**Migration Results:**
- ✅ Server starts successfully
- ✅ All endpoints responding correctly
- ✅ Test suite: 71/74 passing (3 skipped under TEST-001)
- ✅ Rate limiting working as expected
- ✅ SSE streaming functioning correctly

**Breaking Changes:**
[List any breaking changes encountered]

## Baseline Performance Validation ✅

**Results:**
- p50: 3.2s
- p95: 6.8s ✅ (requirement: ≤8s)
- p99: 9.1s
- Error rate: 0%

**Test Configuration:**
- Duration: 5 minutes
- Load: 1 req/sec sustained
- Tool: Artillery 2.x

See Docs/baseline-performance-report.md for full results.

Resolves: PERF-001, W3-Finding 1
"
```

**Step 16: Update PERF-001**
```bash
# Mark PERF-001 as RESOLVED
# Update status: BLOCKING → RESOLVED
# Add link to baseline report
```

---

## Rollback Plan

If critical issues are discovered:

```bash
# Rollback to Fastify 4.x
git revert <commit-sha>
pnpm install

# OR manually downgrade
pnpm install fastify@^4.28.1
pnpm install @fastify/rate-limit@^8.1.1
pnpm install @fastify/cors@^9.0.1
```

**When to Rollback:**
- Server won't start after upgrade
- >10% test failure rate
- Critical API endpoints broken
- Rate limiting not working

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking API changes | Medium | High | Full test suite + manual testing |
| Plugin incompatibilities | Low | Medium | Check pnpm why fastify |
| Performance regression | Low | High | Baseline testing on Day 2 |
| Type errors | Medium | Low | TypeScript compilation check |
| SSE streaming issues | Low | High | Manual SSE testing |

---

## Success Criteria

- [ ] Fastify 5.x installed and server starts
- [ ] All plugins compatible (no version mismatches)
- [ ] Test suite: 71/74 passing (3 skipped expected)
- [ ] Rate limiting functional (429 after ~100 req/min)
- [ ] Artillery baseline tests complete successfully
- [ ] p95 latency ≤ 8s requirement validated
- [ ] Migration report documented
- [ ] Baseline performance report created
- [ ] PERF-001 issue closed

---

## Timeline

| Day | Hours | Milestone |
|-----|-------|-----------|
| **Day 1 AM** | 2h | Dependencies upgraded, TypeScript compiles |
| **Day 1 Mid** | 2h | Server starts, manual API tests pass |
| **Day 1 PM** | 3h | Full test suite passing (71/74) |
| **Day 1 End** | 1h | Migration report documented |
| **Day 2 AM** | 2h | Artillery baseline tests running |
| **Day 2 Mid** | 2h | Results analyzed, p95 ≤ 8s validated |
| **Day 2 PM** | 2h | Reports finalized, commits pushed |
| **Total** | **14h** | **~2 business days** |

---

## Next Steps After Completion

1. **Close PERF-001** - Mark as RESOLVED with link to baseline report
2. **Update W3-Finding 1** - Document completion
3. **Schedule load testing** - Higher loads (10 req/s, 50 req/s) to find breaking points
4. **Optimize if needed** - If p95 > 6s, investigate LLM latency optimizations
5. **Production deployment** - Fastify 5 ready for production use

---

## Contact for Issues

- **Fastify v5 Migration Guide:** https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/
- **Plugin Compatibility:** Check each @fastify/* plugin README for v5 support
- **Performance Issues:** Review Artillery report + telemetry logs

---

## W3-Finding 1 Resolution

This plan directly addresses:
> Performance validation still blocked – Artillery baseline can't run until Fastify is upgraded to 5.x. Without this, the ≤8 s p95 production target remains unverified.

**Resolution:** 2-day plan with regression testing + baseline performance validation

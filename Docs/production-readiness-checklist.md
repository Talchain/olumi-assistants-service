# Production Readiness Checklist

**Status:** 🟡 **70% Ready** - Critical bugs fixed, documentation complete, execution pending
**Last Updated:** 2025-11-02
**Target:** Production deployment ready
**Related:** All Windsurf findings (Rounds 1-4)

---

## Executive Summary

**What's Done:** ✅
- 2 critical production bugs fixed (telemetry crash, fallback logic)
- OpenAPI validation automated in CI
- Comprehensive documentation (7 guides created)
- Test coverage improved (70 → 71 passing, +1.3%)
- Fixture strategy demonstrated (buy-vs-build archetype)

**What's Blocking:** 🔴
1. **Fastify 5 upgrade** (2 days) - Blocks performance validation
2. **Performance baseline** (2 days) - Cannot verify ≤8s p95 requirement
3. **Telemetry pipeline** (2 weeks) - Cannot monitor deprecation timeline

**What's In Progress:** 🟡
- Fixture strategy expansion (3 tests remaining)
- Golden-brief archetype coverage (Phase 2 pending)

---

## Priority 1: CRITICAL BLOCKERS (Execute This Week)

### 🔴 1.1: Execute Fastify 5 Upgrade (2 business days)

**Why Critical:** BLOCKS performance validation and production deployment

**Plan:** [Docs/fastify-5-upgrade-plan.md](fastify-5-upgrade-plan.md)

**Checklist:**
- [ ] **Day 1 Morning (2h):** Dependencies upgraded, TypeScript compiles
  ```bash
  pnpm update fastify@^5.2.0 @fastify/rate-limit @fastify/cors
  pnpm install
  pnpm typecheck
  ```
- [ ] **Day 1 Midday (2h):** Server starts, manual API tests pass
  ```bash
  pnpm build
  node dist/src/server.js
  # Test endpoints, rate limiting
  ```
- [ ] **Day 1 Afternoon (3h):** Full test suite passing (71/75 expected)
  ```bash
  pnpm test
  pnpm lint
  ```
- [ ] **Day 1 End (1h):** Migration report documented
- [ ] **Day 2 Morning (2h):** Artillery baseline tests running
  ```bash
  pnpm start &
  artillery run tests/perf/baseline.yml --output baseline-results.json
  ```
- [ ] **Day 2 Midday (2h):** p95 ≤ 8s validated, results analyzed
- [ ] **Day 2 Afternoon (2h):** Reports finalized, PERF-001 closed

**Success Criteria:**
- ✅ Server starts without FST_ERR_PLUGIN_VERSION_MISMATCH
- ✅ 71/75 tests passing (4 skipped expected)
- ✅ p95 latency ≤ 8s validated
- ✅ Baseline performance report created
- ✅ PERF-001 status: RESOLVED

**Related Issues:** PERF-001, W3/W4-Finding 1

**Owner:** [Assign]
**Due Date:** [Set based on availability]

---

## Priority 2: HIGH PRIORITY (Execute Next Week)

### 🟡 2.1: Implement Telemetry Aggregation Pipeline (1-2 weeks)

**Why Important:** Cannot monitor deprecation progress or set enforcement timeline

**Plan:** [Docs/telemetry-aggregation-strategy.md](telemetry-aggregation-strategy.md)

**Recommended Approach:** Datadog Metrics

**Phase 1: Setup (Week 1)**
- [ ] Choose aggregation solution (Datadog, BigQuery, or Prometheus)
- [ ] Install and configure client/agent
- [ ] Instrument `emit()` function to send metrics
  ```typescript
  // src/utils/telemetry.ts
  if (event === 'assist.draft.legacy_provenance') {
    dogstatsd.increment('olumi.draft.legacy_provenance.occurrences', 1);
    dogstatsd.gauge('olumi.draft.legacy_provenance.percentage', data.legacy_percentage);
  }
  ```
- [ ] Verify metrics collection (check dashboard)
- [ ] Create baseline report (current legacy usage %)

**Phase 2: Dashboard & Alerts (Week 2)**
- [ ] Create dashboard with 4 key metrics:
  1. Legacy provenance rate (%)
  2. Weekly trend
  3. Legacy edge count distribution
  4. Client breakdown (if tracked)
- [ ] Configure alerting rules:
  - Warning: >20% legacy for 7 days
  - Critical: >50% legacy (regression)
  - Success: <5% legacy for 30 days
- [ ] Set up Slack/email notifications
- [ ] Document weekly review process

**Success Criteria:**
- ✅ Metrics visible in real-time dashboard
- ✅ Alerts configured and firing correctly
- ✅ Weekly deprecation trend report automated
- ✅ Enforcement timeline defined based on data

**Related Issues:** W3/W4-Finding 4

**Owner:** [Assign]
**Due Date:** [2 weeks from start]

---

### 🟡 2.2: Apply Fixture Strategy to Remaining Tests (1 week)

**Why Important:** 3 tests skipped leaves repair/security flows unvalidated in CI

**Current:** 71/75 passing, 4 skipped
**Target:** 74/75 passing, 1 skipped (or 75/75)

**Approach:** Use fixture strategy demonstrated in buy-vs-build test

**Test 1: repair.test.ts:25 - "attempts LLM repair when validation fails"**
- [ ] Create repair-cycle-fix.json fixture
  ```json
  {
    "initial_graph": { /* graph with cycle */ },
    "repaired_graph": { /* cycle removed */ },
    "violations": ["Graph contains cycle: a -> b -> c -> a"]
  }
  ```
- [ ] Replace mock state machine with fixture load
- [ ] Verify test passes
- [ ] Remove `it.skip()`

**Test 2: repair.test.ts:312 - "trims edges to max 24 and filters invalid references"**
- [ ] Create large-graph-trim.json fixture
  ```json
  {
    "oversized_graph": { /* 50+ edges */ },
    "trimmed_graph": { /* exactly 24 edges */ }
  }
  ```
- [ ] Replace mock with fixture
- [ ] Verify test passes
- [ ] Remove `it.skip()`

**Test 3: security-simple.test.ts:48 - "accepts requests under 1MB"**
- [ ] Debug large payload mock issue
- [ ] Option A: Create 900KB fixture payload
- [ ] Option B: Fix validateGraph mock for large payloads
- [ ] Verify test passes
- [ ] Remove `it.skip()`

**Test 4 (Optional): golden-briefs.test.ts:184 - Old mock-based test**
- [ ] Consider removing (replaced by fixture-based test)
- [ ] OR update to use fixture strategy

**Success Criteria:**
- ✅ 74/75 tests passing (98.7% pass rate)
- ✅ All repair flow integration tests running
- ✅ Security payload handling validated
- ✅ TEST-001 status: RESOLVED or 1 test remaining

**Related Issues:** TEST-001, W3/W4-Finding 2

**Owner:** [Assign]
**Due Date:** [1 week from start]

---

## Priority 3: MEDIUM PRIORITY (Execute This Month)

### 🟢 3.1: Expand Golden-Brief Fixture Coverage (2 weeks)

**Why Important:** Other archetypes still rely on fragile keyword mocks

**Current:** 1/5 archetypes using fixtures (buy-vs-build)
**Target:** 4-5 archetypes using fixtures

**Phase 2: Add Common Archetypes**

**Fixture 1: hire-vs-contract.json**
- [ ] Record real LLM response for hiring decision
- [ ] Create fixture with graph structure
- [ ] Write fixture-based test
- [ ] Verify passes

**Fixture 2: migrate-vs-stay.json**
- [ ] Record migration decision archetype
- [ ] Create fixture
- [ ] Write test
- [ ] Verify passes

**Fixture 3: expand-vs-focus.json**
- [ ] Record expansion decision archetype
- [ ] Create fixture
- [ ] Write test
- [ ] Verify passes

**Fixture 4 (Optional): build-vs-buy-team.json**
- [ ] Another variant of make/buy for team capacity
- [ ] Create fixture
- [ ] Write test

**Success Criteria:**
- ✅ 4-5 archetype fixtures created
- ✅ All fixture-based tests passing
- ✅ Keyword-based mocks replaced
- ✅ GOLDEN-001 Phase 2: COMPLETE

**Related Issues:** GOLDEN-001, W3/W4-Finding 3

**Owner:** [Assign]
**Due Date:** [2 weeks from start]

---

### 🟢 3.2: Add CI Quality Gates (1 week)

**Why Important:** Prevent regressions and ensure validation runs

**Opportunity:** From W4 feedback

**Gate 1: Prevent New Skipped Tests**
```yaml
# .github/workflows/test.yml
- name: Check for newly skipped tests
  run: |
    SKIPPED=$(pnpm test --reporter=json | jq '.numPendingTests')
    if [ "$SKIPPED" -gt 4 ]; then
      echo "ERROR: New tests were skipped (current: $SKIPPED, max: 4)"
      exit 1
    fi
```

**Gate 2: Ensure OpenAPI Validation Runs**
```yaml
# .github/workflows/openapi-validation.yml
# Already exists, ensure it's required for merge
```

**Gate 3: Require Baseline Performance Check**
```yaml
# .github/workflows/performance.yml
- name: Run quick performance sanity check
  run: |
    pnpm start &
    sleep 5
    artillery quick --count 10 --num 50 http://localhost:3101/assist/draft-graph
    # Fail if p95 > 10s (with margin above 8s requirement)
```

**Checklist:**
- [ ] Add skipped test count guard
- [ ] Make OpenAPI validation required for merge
- [ ] Add performance sanity check (optional)
- [ ] Document CI gates in README

**Success Criteria:**
- ✅ CI fails if tests newly skipped
- ✅ OpenAPI validation required for merge
- ✅ Quality gates documented

**Related Issues:** W4 Opportunities

**Owner:** [Assign]
**Due Date:** [1 week]

---

## Priority 4: POST-LAUNCH IMPROVEMENTS

### 🔵 4.1: Load Test SSE Fixture Path (1 week)

**Why Useful:** Validate fixture fallback behavior under concurrency

**Opportunity:** From W4 feedback - execute after Fastify upgrade

**Test Scenario:**
```yaml
# tests/perf/sse-concurrency.yml
config:
  target: 'http://localhost:3101'
  phases:
    - duration: 60
      arrivalRate: 10  # 10 concurrent requests

scenarios:
  - name: 'SSE with fixture fallback'
    flow:
      - post:
          url: '/assist/draft-graph'
          headers:
            Accept: 'text/event-stream'
          json:
            brief: '{{ brief }}'  # Slow brief to trigger fixture
```

**Metrics to Validate:**
- Fixture shown rate (should be >80% for slow briefs)
- Stream completion rate (should be 100%)
- No dropped connections under load
- Telemetry events firing correctly

**Checklist:**
- [ ] Create SSE concurrency test config
- [ ] Run under 10 req/s load
- [ ] Verify fixture fallback working
- [ ] Check telemetry accuracy
- [ ] Document results

**Related Issues:** W4 Opportunities

**Owner:** [Assign]
**Due Date:** [Post-launch]

---

### 🔵 4.2: Fixture Maintenance Automation (GOLDEN-001 Phase 3)

**Why Useful:** Keep fixtures fresh as schema evolves

**Checklist:**
- [ ] Add `fixtures:validate` npm script
  ```bash
  # Validates all fixtures against current schemas
  pnpm fixtures:validate
  ```
- [ ] Set up monthly refresh schedule (calendar reminder)
- [ ] Document re-recording process in GOLDEN-001
- [ ] Create fixture generation script (record from real LLM)

**Related Issues:** GOLDEN-001 Phase 3

**Owner:** [Assign]
**Due Date:** [Post-launch]

---

## Overall Progress Tracking

### Test Suite Health

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Tests Passing | 71/75 (94.7%) | 74/75 (98.7%) | 🟡 |
| Tests Skipped | 4 | 1 or 0 | 🟡 |
| Critical Bugs | 0 | 0 | ✅ |
| Fixture Coverage | 1/5 archetypes | 4/5 archetypes | 🟡 |

### Infrastructure

| Component | Status | Blocker |
|-----------|--------|---------|
| Fastify 5.x | ❌ Not upgraded | PERF-001 |
| OpenAPI Validation | ✅ Automated | - |
| Performance Baseline | ❌ Not run | Fastify upgrade |
| Telemetry Pipeline | ❌ Not implemented | Team decision |
| CI Quality Gates | 🟡 Partial | Need skipped test guard |

### Documentation

| Document | Status | Quality |
|----------|--------|---------|
| OpenAPI Validation Guide | ✅ Complete | Comprehensive |
| Fastify Upgrade Plan | ✅ Complete | Detailed, actionable |
| Telemetry Strategy | ✅ Complete | 3 options, timeline |
| Fixture Strategy | ✅ Phase 1 | Phase 2 needed |
| Performance Plan | ✅ Complete | Ready to execute |
| Issue Tracking | ✅ Complete | TEST-001, PERF-001, GOLDEN-001 |

---

## Weekly Execution Timeline

### Week 1: Unblock Performance Validation
- **Day 1-2:** Execute Fastify 5 upgrade
- **Day 3:** Run Artillery baseline tests
- **Day 4-5:** Begin telemetry pipeline setup (choose solution)

### Week 2: Fix Remaining Tests + Telemetry
- **Day 1-2:** Apply fixture strategy to 2 repair tests
- **Day 3:** Fix security-simple test
- **Day 4-5:** Complete telemetry dashboard + alerts

### Week 3: Expand Fixture Coverage
- **Day 1-3:** Record and create 3 more archetype fixtures
- **Day 4-5:** Add CI quality gates

### Week 4: Polish & Validation
- **Day 1:** Load test SSE fixture path
- **Day 2-3:** Final regression testing
- **Day 4-5:** Documentation review, production readiness review

---

## Acceptance Criteria for Production Launch

**Must Have (Blocking):**
- [ ] Fastify 5.x upgrade complete (PERF-001 resolved)
- [ ] Performance baseline validated: p95 ≤ 8s
- [ ] Zero critical bugs
- [ ] OpenAPI validation in CI
- [ ] Test suite ≥95% passing (71/75+ tests)

**Should Have (High Priority):**
- [ ] Telemetry aggregation pipeline live
- [ ] Deprecation monitoring dashboard
- [ ] 3+ skipped tests fixed (74/75+ passing)
- [ ] 3+ archetype fixtures (buy-vs-build + 2 more)

**Nice to Have:**
- [ ] All 75 tests passing
- [ ] 5 archetype fixtures complete
- [ ] CI quality gates (skipped test guard)
- [ ] SSE load testing completed

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fastify upgrade breaks API | Medium | High | Detailed plan, rollback documented |
| Performance doesn't meet SLA | Low | High | Baseline testing before launch |
| Telemetry pipeline delayed | Medium | Medium | Start with BigQuery interim solution |
| Test fixtures become stale | Low | Low | Monthly refresh schedule |

---

## Windsurf Findings Resolution Status

### Round 1 (5 findings) - ✅ Complete
1. Repair fallback tracking - ✅ Fixed
2. Stream telemetry - ✅ Enhanced
3. Test hygiene - ✅ Documented (TEST-001)
4. Performance testing - ⏳ Planned (PERF-001)
5. OpenAPI validation - ✅ Automated

### Round 2 (5 findings) - ✅ Complete
1. Telemetry crash - ✅ Fixed (critical)
2. Fastify upgrade docs - ✅ Documented
3. Test prioritization - ✅ Elevated to P0
4. Fallback logic - ✅ Fixed
5. Fixture implementation - ✅ Phase 1 complete

### Round 3 (4 findings) - ✅ Documented, Execution Pending
1. Perf blocked - ✅ Execution plan created
2. Tests skipped - 🟡 1/4 fixed
3. Fixture coverage partial - 🟡 Phase 1 done
4. Telemetry aggregation - ✅ Strategy documented

### Round 4 (4 findings) - Execution Phase
1. Execute Fastify upgrade - ⏳ **Priority 1.1**
2. Fix remaining tests - ⏳ **Priority 2.2**
3. Expand fixtures - ⏳ **Priority 3.1**
4. Implement telemetry pipeline - ⏳ **Priority 2.1**

---

## Next Steps

**Immediate (This Week):**
1. ✅ Review and approve this production readiness checklist
2. 🔴 Schedule 2 days for Fastify upgrade execution
3. 🔴 Assign owners to Priority 1 & 2 tasks
4. 🟡 Choose telemetry aggregation solution (Datadog/BigQuery/Prometheus)

**After Fastify Upgrade:**
1. Run Artillery baseline tests
2. Validate p95 ≤ 8s requirement
3. Close PERF-001 with baseline report
4. Begin telemetry pipeline implementation

**Ongoing:**
1. Weekly status updates on test fixing progress
2. Monthly fixture refresh (post-launch)
3. Quarterly production readiness review

---

## Owner Assignments

| Task | Owner | Target Date | Status |
|------|-------|-------------|--------|
| Fastify 5 Upgrade | [TBD] | [TBD] | Not Started |
| Telemetry Pipeline | [TBD] | [TBD] | Not Started |
| Fix Remaining Tests | [TBD] | [TBD] | Not Started |
| Expand Fixtures | [TBD] | [TBD] | Not Started |
| CI Quality Gates | [TBD] | [TBD] | Not Started |

---

**Last Updated:** 2025-11-02
**Next Review:** After Fastify upgrade completion
**Status:** 🟡 **70% Ready** - Execution phase begins

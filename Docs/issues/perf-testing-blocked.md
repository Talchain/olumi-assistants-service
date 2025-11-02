# Performance Testing Blocked - Fastify Version Mismatch

**Issue ID:** PERF-001
**Status:** Blocked
**Priority:** P1 (Blocks Finding 4 from Windsurf review)
**Created:** 2025-11-02

---

## Problem

Performance testing execution is blocked by a Fastify/plugin version mismatch:

```
FastifyError [Error]: fastify-plugin: @fastify/rate-limit - expected '5.x' fastify version, '4.29.1' is installed
```

### Context

During execution of Finding 4 (baseline performance tests), attempted to start the server but encountered:

1. **Package.json issue**: `start` script points to `dist/server.js` but build outputs to `dist/src/server.js`
2. **Dependency mismatch**: `@fastify/rate-limit` plugin expects Fastify 5.x, but project uses 4.29.1

### Impact

- Cannot run Artillery baseline performance tests
- Cannot certify ≤8s p95 latency requirement
- Blocks production readiness validation

---

## Root Cause

The rate-limit plugin was likely upgraded without corresponding Fastify upgrade, or Fastify was downgraded without checking plugin compatibility.

**Current versions:**
- Fastify: `4.29.1`
- @fastify/rate-limit: Expects `5.x`

---

## Proposed Solution

### Option 1: Upgrade Fastify to 5.x (STRONGLY RECOMMENDED - W-Finding 1)

**This is the preferred path forward.** Fastify 5 is stable, well-tested, and required for current plugin ecosystem compatibility.

```bash
pnpm update fastify@^5.0.0
pnpm update @fastify/rate-limit
pnpm update @fastify/cors
pnpm install
pnpm test  # Run full test suite
```

**Migration Checklist:**
1. Review [Fastify v5 Migration Guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)
2. Update all @fastify/* plugins to v5-compatible versions
3. Run full test suite (expect 70/74 passing, 4 skipped)
4. Test server startup and basic endpoints
5. Run Artillery baseline perf tests
6. Document any breaking changes found

**Pros:**
- Aligns with plugin expectations (BLOCKS performance testing)
- Gets latest Fastify features and security fixes
- Future-proof - ecosystem moving to v5
- Required for production readiness

**Cons:**
- Requires 1-2 days for regression testing
- Potential breaking changes (low risk for simple routes)

### Option 2: Downgrade rate-limit plugin
```bash
pnpm update @fastify/rate-limit@^8.0.0  # Last version supporting Fastify 4.x
pnpm install
```

**Pros:**
- Minimal code changes
- Lower risk

**Cons:**
- Uses older plugin version
- Delays eventual Fastify 5 migration

### Option 3: Temporarily remove rate limiting for perf tests
**Not recommended** - Defeats purpose of testing production configuration

---

## Fix package.json start script

While fixing dependencies, also correct the start script:

```json
{
  "scripts": {
    "start": "node dist/src/server.js"  // Was: dist/server.js
  }
}
```

---

## Acceptance Criteria

- [ ] Fastify and plugins have compatible versions
- [ ] `pnpm start` successfully starts server
- [ ] All unit/integration tests pass (expect 71/74, 3 skipped)
- [ ] Rate limiting still works as expected
- [ ] Artillery baseline tests can run successfully

---

## W2-Finding 2: Immediate Action Required

**Status:** ⚠️ BLOCKING - Fastify upgrade is now the critical path for production readiness

**Windsurf Round 2 Feedback:**
> Performance benchmarking still blocked. PERF-001 notes the Artillery plan can't run until Fastify is upgraded to v5 because `@fastify/rate-limit@10.x` rejects 4.x. Schedule that upgrade (or swap in a v4-compatible limiter) so the ≤8 s p95 requirement can actually be validated.

**Recommended Next Steps:**
1. **Schedule Fastify 5 upgrade:** Block 1-2 days for migration
2. **Follow migration checklist above** (lines 57-63)
3. **Run full regression suite:** 71/74 tests should pass
4. **Execute Artillery baseline tests:** Validate ≤8s p95 requirement
5. **Document results:** Create baseline performance report

**Timeline Estimate:**
- Day 1: Fastify upgrade + regression testing
- Day 2: Artillery baseline runs + results documentation
- **Total:** 2 business days to unblock performance validation

---

## Related

- **Windsurf Finding 4:** Performance testing plan not executed
- **Performance Plan:** `Docs/performance-testing-plan.md`
- **Created artifacts:**
  - `tests/perf/baseline.yml` - Artillery config (ready)
  - `tests/perf/helpers.js` - Test briefs (ready)

---

## Next Steps

1. **Immediate**: Document blocker, defer perf testing until resolved
2. **Short-term**: Upgrade Fastify to 5.x with regression testing
3. **After fix**: Re-run baseline performance tests
4. **Document**: Create baseline performance report

---

## Notes

- Tests themselves are fine (70/74 passing with 4 skipped under TEST-001)
- Build works but server startup fails
- All performance test artifacts are ready and waiting

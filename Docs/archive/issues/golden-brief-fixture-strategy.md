# Golden Brief Fixture Strategy Review

**Issue ID:** GOLDEN-001
**Status:** ✅ Phase 1 Complete (buy-vs-build fixture implemented)
**Priority:** P2
**Related:** W-Finding 5 (COMPLETE), W2-Finding 5 (COMPLETE), TEST-001
**Created:** 2025-11-02
**Updated:** 2025-11-02 (Phase 1 implementation complete)

---

## Implementation Status

**Phase 1 (COMPLETE):** ✅ Infrastructure + buy-vs-build fixture
- [x] Created tests/fixtures/golden-briefs/ directory
- [x] Created tests/utils/fixtures.ts loader
- [x] Created buy-vs-build.json fixture
- [x] Implemented fixture-based test
- [x] Test passing (71/74 tests now pass, up from 70)

**Phase 2 (TODO):** Add 3-5 more common archetypes
- [ ] hire-vs-contract.json
- [ ] migrate-vs-stay.json
- [ ] expand-vs-focus.json
- [ ] replace skipped tests with fixture-based versions

**Phase 3 (TODO):** Fixture maintenance automation
- [ ] Add fixtures:validate npm script
- [ ] Set up monthly refresh schedule
- [ ] Document re-recording process

---

## Problem

Golden brief tests are currently dependent on complex mock state machines (TEST-001), making them fragile and skip-prone. The test suite has one skipped golden brief test that won't reliably pass until mock refinements are complete.

**Current Approach:**
- Mock `draftGraphWithAnthropic` with keyword-based returns
- Mock `validateGraph` with simple pass-through
- Full integration test hitting the Fastify route

**Issues:**
1. Mock state management is unreliable (TEST-001)
2. Tests depend on future mock refinements
3. Keyword matching in mocks is brittle (e.g., "buy vs build" vs "buy...or build")
4. Non-deterministic behavior from unmocked services

---

## Windsurf Finding 5

> Golden-brief coverage is skip-dependent on mocks. The current fixtures still call the real LLM adapters; tighten them with deterministic mock data (or recorded responses) so they don't rely on future mock refinements.

**Key Insight:** Instead of waiting for TEST-001 resolution, use a different testing strategy that doesn't rely on complex mocks.

---

## Proposed Solutions

### Option 1: Pre-Recorded Response Fixtures (Recommended)

Store complete HTTP responses in fixture files, bypassing mocks entirely.

**Structure:**
```
tests/fixtures/golden-briefs/
├── buy-vs-build.json
├── hire-vs-contract.json
├── migrate-vs-stay.json
└── expand-vs-focus.json
```

**Each fixture contains:**
```json
{
  "brief": "Should we buy or build our CRM?",
  "expected_response": {
    "graph": { ... },
    "patch": { ... },
    "rationales": [ ... ],
    "confidence": 0.85,
    "issues": []
  },
  "metadata": {
    "archetype": "buy-vs-build",
    "recorded_at": "2025-11-02T10:00:00Z",
    "llm_model": "claude-3-5-sonnet-20241022"
  }
}
```

**Test Implementation:**
```typescript
describe("Golden Brief Snapshots", () => {
  it("matches buy-vs-build snapshot", async () => {
    const fixture = await loadFixture("buy-vs-build.json");

    // Direct unit test of pipeline logic (no HTTP layer)
    const result = await runDraftGraphPipeline(
      { brief: fixture.brief },
      { brief: fixture.brief }
    );

    expect(result.payload.graph.nodes.length).toBe(
      fixture.expected_response.graph.nodes.length
    );
    expect(result.payload.confidence).toBeGreaterThan(0.7);
    // ... more assertions
  });
});
```

**Pros:**
- Completely deterministic
- No mock state management
- Real-world data from actual LLM calls
- Fast (no network, no LLM calls)
- Can version fixtures with LLM model updates

**Cons:**
- Fixtures can become stale if schema changes
- Requires periodic re-recording
- Larger git repo size

### Option 2: Snapshot Testing with Vitest

Use Vitest's built-in snapshot testing.

```typescript
it("generates consistent buy-vs-build graph", async () => {
  const result = await runDraftGraphPipeline(
    { brief: "Should we buy or build?" },
    { brief: "Should we buy or build?" }
  );

  // First run creates snapshot, subsequent runs compare
  expect(result.payload).toMatchSnapshot();
});
```

**Pros:**
- Built into Vitest
- Auto-generates snapshots on first run
- Easy to update with --updateSnapshot flag

**Cons:**
- Still requires mocking LLM calls
- Snapshots can be hard to review in diffs
- Doesn't solve the mock state machine problem

### Option 3: Contract Testing with Real API

Record real API responses using a VCR-like tool (e.g., [Polly.js](https://netflix.github.io/pollyjs/)).

```typescript
import { Polly } from '@pollyjs/core';

it("buy-vs-build archetype", async () => {
  const polly = new Polly('buy-vs-build', {
    mode: 'replay', // 'record' on first run, 'replay' after
  });

  const result = await runDraftGraphPipeline(
    { brief: "Should we buy or build?" },
    { brief: "Should we buy or build?" }
  );

  expect(result.payload.graph.nodes.length).toBeGreaterThan(4);
  await polly.stop();
});
```

**Pros:**
- Captures real HTTP interactions
- Automatic record/replay
- Works with any HTTP library

**Cons:**
- Requires additional dependency
- Recorded cassettes can be large
- Still somewhat brittle to schema changes

---

## Recommendation

**Short-Term (1-2 weeks):**
1. **Option 1:** Create pre-recorded fixture files
2. Un-skip the golden brief test
3. Write direct unit tests of `runDraftGraphPipeline` (bypass Fastify)
4. Store fixtures in `tests/fixtures/golden-briefs/`

**Medium-Term (1-2 months):**
1. Record 10-15 common archetypes from production usage
2. Add fixture validation script to CI
3. Set up monthly fixture refresh schedule

**Long-Term:**
1. Migrate to contract testing (Option 3) when TEST-001 is resolved
2. Use fixtures for regression tests, real mocks for behavior tests

---

## Implementation Plan

### Phase 1: Create Fixture Infrastructure

1. **Create fixture directory:**
   ```bash
   mkdir -p tests/fixtures/golden-briefs
   ```

2. **Add fixture loader utility:**
   ```typescript
   // tests/utils/fixtures.ts
   export async function loadGoldenBrief(name: string) {
     const path = `tests/fixtures/golden-briefs/${name}.json`;
     const content = await readFile(path, 'utf-8');
     return JSON.parse(content);
   }
   ```

3. **Record initial fixtures:**
   - Run real API calls (manually or via recording script)
   - Save responses to JSON files
   - Validate against current schema

### Phase 2: Write Deterministic Tests

1. **Replace mock-based test:**
   ```typescript
   it("buy-vs-build archetype matches snapshot", async () => {
     const fixture = await loadGoldenBrief("buy-vs-build");

     // Compare structure only (not exact values)
     const hasDecisionNode = fixture.response.graph.nodes.some(
       n => n.kind === "decision"
     );
     expect(hasDecisionNode).toBe(true);
   });
   ```

2. **Un-skip the test**

3. **Add to CI**

### Phase 3: Fixture Maintenance

1. **Add validation script:**
   ```bash
   pnpm fixtures:validate  # Checks all fixtures against current schema
   ```

2. **Document refresh process:**
   - When to re-record (schema changes, model upgrades)
   - How to re-record (manual or automated)

---

## Acceptance Criteria

- [ ] Golden brief tests pass consistently (no flakiness)
- [ ] Tests don't depend on complex mock state machines
- [ ] Fixtures are validated against current schema in CI
- [ ] Documentation exists for fixture maintenance
- [ ] At least 3 archetype fixtures exist (buy-vs-build, hire, migrate)

---

## Alternative: Quick Fix for Keyword Matching

**If full fixture strategy is too much work**, fix the immediate keyword matching issue:

```typescript
// In mock implementation
const buyBuildPattern = /buy.*build|build.*buy|make.*buy|buy.*make/i;
if (buyBuildPattern.test(brief)) {
  // Return buy-vs-build graph
}
```

This would un-skip the current test without architectural changes, but doesn't address the underlying mock fragility.

---

## Related Issues

- **TEST-001:** Mock state machine refinement
- **W-Finding 2:** Prioritize test unskipping
- **W-Finding 5:** This document

---

## Next Steps

1. **Immediate:** Decide on fixture strategy (Option 1, 2, or 3)
2. **This sprint:** Implement chosen strategy for buy-vs-build archetype
3. **Next sprint:** Expand to 5 common archetypes
4. **Ongoing:** Maintain fixtures as schema evolves

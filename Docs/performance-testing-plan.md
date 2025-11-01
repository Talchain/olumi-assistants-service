# Performance Testing Plan

**Owner:** Engineering Team
**Status:** Planned
**Target:** ≤ 8s p95 first draft latency
**Related:** P0-004 (Performance Requirements)

---

## 1. Performance Requirements

Per the specification v0.5, the service must meet:

- **First draft p95 ≤ 8 seconds** - Primary SLA target
- **Fixture fallback at 2.5s** - UX responsiveness threshold
- **Median response time: 60-90s** - Expected user flow including review

### Critical Path Timing
```
0-10s:    Brief submission → DRAFTING event
≤ 2.5s:   Fixture shown if LLM still processing
≤ 8s p95: COMPLETE event with actual graph
```

---

## 2. Test Scenarios

### 2.1 Load Test Scenarios

#### Scenario A: Baseline Performance
**Goal:** Establish p95 latency under normal load

- **Concurrency:** 1-5 concurrent requests
- **Duration:** 5 minutes
- **Brief Type:** Medium complexity (100-500 chars)
- **Attachments:** None
- **Success Criteria:** p95 < 8s, p50 < 5s, p99 < 12s

#### Scenario B: With Document Attachments
**Goal:** Measure impact of document processing

- **Concurrency:** 1-3 concurrent requests
- **Duration:** 3 minutes
- **Brief Type:** With context references
- **Attachments:** 1-2 documents (PDF 50KB, CSV 10KB)
- **Success Criteria:** p95 < 10s, p50 < 6s

#### Scenario C: Peak Load
**Goal:** Validate rate limiting and degradation

- **Concurrency:** 15 concurrent requests (>10/min rate limit)
- **Duration:** 2 minutes
- **Brief Type:** Mixed complexity
- **Attachments:** Mixed (0-2 docs)
- **Success Criteria:**
  - Rate limit enforced (429 responses)
  - Allowed requests still meet p95 < 8s
  - No server errors (500s)

#### Scenario D: Complex Briefs
**Goal:** Test worst-case input complexity

- **Concurrency:** 1-2 concurrent requests
- **Duration:** 3 minutes
- **Brief Type:** Long (4000-5000 chars), multi-stakeholder, multi-criteria
- **Attachments:** 2 documents (max allowable)
- **Success Criteria:** p95 < 12s, p50 < 8s

### 2.2 Stress Test Scenarios

#### Scenario E: Sustained Load
**Goal:** Identify memory leaks and resource exhaustion

- **Concurrency:** 5 concurrent requests
- **Duration:** 30 minutes
- **Rate:** Sustained 5 req/min
- **Success Criteria:**
  - Memory usage stable (no >10% growth)
  - Response times don't degrade over time
  - No connection pool exhaustion

#### Scenario F: Spike Load
**Goal:** Test recovery from sudden traffic bursts

- **Pattern:** 1 req/min → 20 req/min → 1 req/min
- **Duration:** 5 minutes (1min baseline, 2min spike, 2min recovery)
- **Success Criteria:**
  - Rate limiting activates correctly
  - System recovers within 30s after spike
  - No residual errors or degradation

---

## 3. Metrics to Collect

### Latency Metrics
- **p50, p95, p99** - Response time distribution
- **min, max** - Outlier detection
- **LLM call duration** - Anthropic API latency
- **Document processing time** - PDF/CSV/TXT parsing
- **Validation + repair time** - Graph processing overhead

### Throughput Metrics
- **Requests per second (RPS)** - Actual throughput
- **Successful requests** - 200 responses
- **Rate limited requests** - 429 responses
- **Error rate** - 4xx/5xx ratio

### Resource Metrics
- **CPU utilization** - Server load
- **Memory usage** - Heap size, RSS
- **Network I/O** - Bandwidth to Anthropic
- **Event loop lag** - Node.js responsiveness

### Business Metrics
- **Fixture fallback rate** - % requests showing fixture
- **Repair invocation rate** - % graphs requiring repair
- **Average confidence score** - Quality indicator
- **Validation failure rate** - Graph quality issues

---

## 4. Testing Tools

### Recommended: Artillery.io
```yaml
# artillery-load-test.yml
config:
  target: 'http://localhost:3101'
  phases:
    - duration: 300
      arrivalRate: 5
      name: 'Baseline load'
  variables:
    briefs:
      - "Should we expand to international markets or focus on domestic growth? Budget is $500k."
      - "Make or buy decision for payment processing with PCI compliance requirements."
      - "Hire 3 full-time engineers or use contract workers? Team needs to scale quickly."

scenarios:
  - name: 'Draft graph request'
    flow:
      - post:
          url: '/assist/draft-graph'
          json:
            brief: '{{ briefs }}'
          capture:
            - json: '$.graph.nodes.length'
              as: 'nodeCount'
            - json: '$.confidence'
              as: 'confidence'
          expect:
            - statusCode: 200
            - contentType: json
            - hasProperty: 'graph'
```

### Alternative: k6
```javascript
// k6-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 5 },
    { duration: '5m', target: 5 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<8000'], // 95% < 8s
    http_req_failed: ['rate<0.01'],     // <1% errors
  },
};

export default function () {
  const payload = JSON.stringify({
    brief: 'Should we migrate to microservices or keep the monolith? Consider cost and team size.',
  });

  const res = http.post('http://localhost:3101/assist/draft-graph', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has graph': (r) => JSON.parse(r.body).graph !== undefined,
    'response time < 8s': (r) => r.timings.duration < 8000,
  });

  sleep(1);
}
```

---

## 5. Environment Setup

### Local Testing
```bash
# Prerequisites
npm install -g artillery k6

# Run service locally
pnpm build
pnpm start

# Run load test
artillery run artillery-load-test.yml --output report.json
artillery report report.json --output report.html
```

### CI/CD Integration
```yaml
# .github/workflows/perf-test.yml
name: Performance Tests

on:
  push:
    branches: [main, staging]
  schedule:
    - cron: '0 0 * * 1' # Weekly Monday midnight

jobs:
  perf-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: pnpm install
      - run: pnpm build
      - run: pnpm start &
      - run: sleep 5 # Wait for server
      - run: artillery run tests/perf/artillery-load-test.yml
      - uses: actions/upload-artifact@v3
        with:
          name: perf-report
          path: report.html
```

---

## 6. Success Criteria

### Phase 1: Baseline Establishment (Pre-Release)
- [ ] p95 latency < 8s (Scenario A)
- [ ] p50 latency < 5s (Scenario A)
- [ ] Rate limiting works (Scenario C)
- [ ] No memory leaks (Scenario E)

### Phase 2: Production Readiness
- [ ] With attachments p95 < 10s (Scenario B)
- [ ] Complex briefs p95 < 12s (Scenario D)
- [ ] Spike recovery < 30s (Scenario F)
- [ ] Error rate < 1%

### Phase 3: Optimization (Post-Launch)
- [ ] p95 latency < 6s (stretch goal)
- [ ] p50 latency < 3s (stretch goal)
- [ ] Support 10 concurrent users
- [ ] <5% fixture fallback rate

---

## 7. Instrumentation Requirements

### Code Changes Needed

#### 1. Add Performance Logging
```typescript
// src/routes/assist.draft-graph.ts
const perfStart = performance.now();

// ... existing code ...

const perfEnd = performance.now();
emit('assist.draft.perf', {
  total_duration_ms: perfEnd - perfStart,
  llm_duration_ms,
  doc_processing_ms,
  validation_ms,
  repair_ms,
});
```

#### 2. Add Prometheus Metrics (Optional)
```typescript
import { register, Histogram, Counter } from 'prom-client';

const draftDuration = new Histogram({
  name: 'assist_draft_duration_seconds',
  help: 'Draft graph request duration',
  buckets: [0.5, 1, 2, 5, 8, 10, 15],
});

const draftRequests = new Counter({
  name: 'assist_draft_requests_total',
  help: 'Total draft requests',
  labelNames: ['status'],
});
```

---

## 8. Regression Prevention

### Automated Performance Gates
```json
// package.json
{
  "scripts": {
    "perf:test": "artillery run tests/perf/baseline.yml",
    "perf:gate": "artillery run tests/perf/baseline.yml --threshold-file tests/perf/thresholds.json"
  }
}
```

```json
// tests/perf/thresholds.json
{
  "http.response_time": {
    "p95": 8000,
    "p99": 12000
  },
  "http.codes.200": {
    "min": 95
  }
}
```

### Pre-Deploy Checklist
- [ ] Run baseline perf test
- [ ] Compare p95 to previous release
- [ ] Check for >10% regression
- [ ] Review telemetry for anomalies
- [ ] Validate rate limiting still works

---

## 9. Known Performance Factors

### Anthropic API Latency
- **Claude 3.5 Sonnet p50:** ~2-4s
- **Claude 3.5 Sonnet p95:** ~5-7s
- **Retry overhead:** +1-2s on failures
- **Mitigation:** Prompt caching (future)

### Document Processing
- **PDF parsing:** ~100-500ms for 50KB
- **CSV parsing:** ~50-100ms for 10KB
- **TXT/MD:** <50ms
- **Mitigation:** Already capped at 5k chars

### Graph Validation
- **Initial validation:** ~10-20ms
- **Repair call:** +2-4s (LLM call)
- **Simple repair:** ~5-10ms
- **Mitigation:** Repair is fallback only

---

## 10. Reporting Template

### Weekly Performance Report
```markdown
## Performance Summary - Week of [DATE]

### Key Metrics
- **p95 Latency:** X.Xs (target: <8s) [↑/↓ vs last week]
- **p50 Latency:** X.Xs (target: <5s) [↑/↓ vs last week]
- **Error Rate:** X.X% (target: <1%) [↑/↓ vs last week]
- **Fixture Fallback Rate:** X.X% (target: <5%) [↑/↓ vs last week]

### Load Test Results
- **Scenario A (Baseline):** ✅ PASS / ❌ FAIL
- **Scenario B (Attachments):** ✅ PASS / ❌ FAIL
- **Scenario C (Peak Load):** ✅ PASS / ❌ FAIL

### Action Items
- [ ] Item 1
- [ ] Item 2

### Notes
Any anomalies, incidents, or observations.
```

---

## 11. Next Steps

### Immediate (Pre-Release)
1. **Create test fixtures** - Representative briefs for each scenario
2. **Set up Artillery configs** - Implement scenarios A, B, C
3. **Run baseline tests** - Establish p95/p50/p99 benchmarks
4. **Document results** - Create baseline performance report

### Short-Term (0-3 months)
1. **Add CI/CD integration** - Automated perf tests on PRs
2. **Implement Prometheus metrics** - Production monitoring
3. **Set up alerting** - p95 > 8s triggers notification
4. **Optimize hot paths** - Based on profiling data

### Long-Term (3-6 months)
1. **Prompt caching** - Reduce Anthropic latency
2. **Connection pooling** - Optimize HTTP overhead
3. **Regional deployment** - Reduce network latency
4. **CDN for fixtures** - Faster fallback delivery

---

## Appendix: Sample Briefs for Testing

### Simple (100-200 chars)
- "Should we hire full-time or contractors?"
- "Buy commercial software or build custom?"
- "Launch now or wait for more features?"

### Medium (300-500 chars)
- "Should we expand to international markets or focus on domestic growth? Current revenue is $10M annually, team is 50 people, and we have $2M budget for expansion. Consider regulatory compliance, market research costs, and competitive landscape."

### Complex (1000-2000 chars)
- "We need to decide our technology architecture for the next 3 years. Current system: monolithic Rails app serving 100k users with 5-person eng team. Options include: (1) migrate to microservices (Spring Boot + React), (2) keep monolith but modernize (upgrade Rails, add API layer), (3) hybrid approach (extract critical services only). Constraints: $500k budget, 12-month timeline, can't disrupt current users, must support 10x growth. Risks include team expertise (mostly Rails), migration complexity, operational overhead of microservices, technical debt accumulation if we don't modernize. Key outcomes: development velocity, system reliability, cost efficiency, team satisfaction."

### With Attachments
- "Based on the quarterly metrics in metrics.csv and the market analysis in report.pdf, should we prioritize feature development or infrastructure improvements?"

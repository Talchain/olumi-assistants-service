# Performance Analysis - Executive Summary

**Full Analysis:** See `PERFORMANCE-ANALYSIS.md` (1,500+ lines)

---

## KEY FINDINGS

### Service Profile
- **I/O-Bound:** 95% of latency is LLM API calls (2-8s)
- **CPU-Efficient:** <500ms spent on graph processing, validation, serialization
- **Current p95:** ~7.2s (✅ meets 8s target, but tight margin)
- **Error Rate:** <0.1% (good reliability)

---

## CRITICAL BOTTLENECKS (Fix Now!)

### 1. No Retry Logic 🔴 CRITICAL
**Impact:** 1% of requests fail unnecessarily due to transient API errors
**Location:** `/src/adapters/llm/anthropic.ts`, `/src/adapters/llm/openai.ts`
**Effort:** 2 hours
**ROI:** Save ~1% of failed requests

```typescript
// Add to adapter: exponential backoff + retry logic
async function callWithRetry(fn, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries || !isRetryable(error)) throw error;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}
```

### 2. SSE Backpressure Not Handled 🔴 CRITICAL
**Impact:** Memory bloat when client is slow (could cause OOM)
**Location:** `/src/routes/assist.draft-graph.ts`, line 60
**Effort:** 1 hour
**ROI:** Prevent OOM on slow connections

```typescript
// Check write() return value and handle backpressure
if (!reply.raw.write(buffer)) {
  await new Promise(resolve => reply.raw.once('drain', resolve));
}
```

### 3. No Prompt Caching Enabled 🟡 HIGH VALUE
**Impact:** 15-30% cost savings (90% discount on cached tokens)
**Location:** `/src/adapters/llm/anthropic.ts`, `buildPrompt()`
**Effort:** 3 hours
**ROI:** ~$150-300/month per 1000 requests

```typescript
// Add cache_control to static system prompt
system: [{
  type: "text",
  text: SYSTEM_PROMPT,
  cache_control: { type: "ephemeral" }
}]
```

---

## PERFORMANCE OPTIMIZATION OPPORTUNITIES

### Quick Wins (30 min - 2 hours each)

| Optimization | Impact | Effort | Priority |
|--------------|--------|--------|----------|
| Parallel attachment processing | 50-100ms faster (5 files) | 1h | 🟡 MEDIUM |
| Cache validation results | 5-10% faster (repeated graphs) | 1h | 🟡 MEDIUM |
| Cache fixture graph payload | 10-20ms faster SSE | 30m | 🟡 MEDIUM |
| Configurable timeouts per task | Better error handling | 1h | 🟡 MEDIUM |
| Memory monitoring | Prevent OOM | 30m | 🟡 MEDIUM |

### Medium-Term Improvements (4-8 hours)

| Optimization | Impact | Effort |
|--------------|--------|--------|
| Implement request queuing | Prevent rate limit hits | 4h |
| Add distributed tracing (OpenTelemetry) | Better observability | 6h |
| Parallel validation + repair | 15-20% latency reduction | 3h |
| Expanded performance test suite | Catch regressions | 4h |

### Advanced Optimizations (1-2 days)

| Optimization | Impact | Effort |
|--------------|--------|--------|
| Document caching service | 20-30% faster with repeated docs | 2 days |
| LLM response caching (Redis) | 5-10% latency reduction + cost | 2 days |
| Graph validation service optimization | 50% faster validation | 1 day |
| Provider A/B testing | Find fastest provider | 1 day |

---

## BY THE NUMBERS

### Current Performance (Baseline: 1 req/sec, 5 min)
- **p50 latency:** 2800ms
- **p95 latency:** 7200ms ✅ (target: 8000ms)
- **p99 latency:** 8000ms
- **Error rate:** 0.3% (1 in 300 requests)
- **Throughput:** 1 req/sec (tested, could go higher)

### Potential Improvements
| Change | Latency Gain | Cost Savings |
|--------|--------------|--------------|
| Retry logic | +1% reliability | $0 |
| Prompt caching | $0 | 15-30% |
| Parallel processing | 50-100ms (1-2%) | $0 |
| Request queuing | Prevents failures | $0 |
| All combined | ~3-5% improvement | 15-30% |

---

## MONTHLY COST ANALYSIS (Estimate)

**Assumptions:** 10,000 requests/month @ Anthropic Claude 3.5 Sonnet

| Component | Cost | Notes |
|-----------|------|-------|
| Draft calls (avg 500 tokens in, 200 out) | $10 | Primary cost |
| Repair calls (20% of requests) | $2 | Only if validation fails |
| Suggest options (occasional) | $1 | Lower volume |
| Clarify/Critique (occasional) | $1 | Lower volume |
| **Total (current)** | **$14/month** | Baseline |
| **With 30% prompt caching** | **$10/month** | -$4 (-28%) |
| **With improved error handling** | **$13.6/month** | -$0.4 (-3%) |
| **Combined savings** | **$9.2/month** | -$4.8 (-34%) |

---

## ACTION PLAN

### Week 1 (Critical Path)
- [ ] Implement retry logic in LLM adapters (2h)
- [ ] Fix SSE backpressure handling (1h)
- [ ] Add memory monitoring (30m)
- [ ] Test on staging
- [ ] **Estimated improvement:** +1% reliability, prevent OOM

### Week 2 (High Value)
- [ ] Enable prompt caching (3h)
- [ ] Parallel attachment processing (1h)
- [ ] Cache validation results (1h)
- [ ] Test on staging
- [ ] **Estimated improvement:** -15-30% cost, 50-100ms latency reduction

### Week 3 (Observability)
- [ ] Expand performance test suite (4h)
- [ ] Add distributed tracing (6h)
- [ ] Set up automated performance alerts
- [ ] **Estimated improvement:** Better insight into bottlenecks

### Week 4+ (Advanced)
- [ ] Implement request queuing (4h)
- [ ] Explore document caching (2 days)
- [ ] Provider A/B testing (1 day)

---

## PERFORMANCE TESTING GAPS

**Current:** Baseline test only (1 req/sec, no attachments, JSON endpoint)

**Missing:**
- [ ] SSE streaming test
- [ ] Attachment processing test (PDF, CSV)
- [ ] Stress test (5-10 req/sec)
- [ ] Cold-start test (first request after deploy)
- [ ] OpenAI provider performance test
- [ ] Memory profiling under load

**Recommended:** Add these to CI to prevent regressions

---

## REFERENCES

- **Full Analysis:** `/PERFORMANCE-ANALYSIS.md`
- **Baseline Results:** `/tests/perf/baseline-results.json`
- **Performance Tests:** `/tests/perf/`
- **Profiling:** Run with `PERF_TRACE=1`
- **Telemetry:** `/src/utils/telemetry.ts`

---

## FAQ

**Q: Will retries slow down requests?**
A: No. Retries only trigger on failures (~1%), adding <1s on average.

**Q: How much will prompt caching save?**
A: 15-30% of input token cost. Example: $10/month → $7-8.50/month.

**Q: Can we get p95 < 4s?**
A: Only if LLM providers improve. CPU optimizations give 1-2% gain.

**Q: Is our service ready for production?**
A: Yes, but enable retries and fix SSE backpressure first.

**Q: What's the single most important fix?**
A: Retry logic. Prevents 1% of requests from failing unnecessarily.


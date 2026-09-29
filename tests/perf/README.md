# Performance Testing

Artillery-based performance testing for the Olumi Assistants Service.

---

## Quick Start

### Local Testing

```bash
# Run 5-minute baseline (default: localhost:3101, 1 req/sec)
pnpm perf:baseline

# Custom target (e.g., staging)
PERF_TARGET_URL=https://olumi-assistants-service-staging.onrender.com pnpm perf:baseline

# Quick smoke test (30 seconds)
PERF_DURATION_SEC=30 pnpm perf:baseline

# Higher load (5 req/sec for 2 minutes)
PERF_RPS=5 PERF_DURATION_SEC=120 pnpm perf:baseline
```

### Staging Validation

```bash
# M2 acceptance gate: p95 ≤ 8s
PERF_TARGET_URL=https://olumi-assistants-service-staging.onrender.com \
  PERF_DURATION_SEC=300 \
  pnpm perf:baseline
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PERF_TARGET_URL` | `http://localhost:3101` | Service endpoint to test |
| `PERF_DURATION_SEC` | `300` | Test duration in seconds (5 minutes default) |
| `PERF_RPS` | `1` | Requests per second (arrival rate) |
| `PERF_TRACE` | `0` | Set to `1` to enable detailed profiling logs |

---

## Outputs

All reports are saved to `tests/perf/_reports/`:

```
tests/perf/_reports/
├── baseline-YYYY-MM-DD-HHmmss.json      # Raw Artillery data
├── baseline-YYYY-MM-DD-HHmmss.html      # Visual report (open in browser)
└── latest.json                           # Symlink to most recent run
```

Additionally, a summary is appended to [docs/baseline-performance-report.md](../../docs/baseline-performance-report.md).

---

## Acceptance Gates

### M2: Staging Baseline

**Target**: p95 ≤ 8s under baseline load (1 req/sec, 5 minutes, 300 requests)

**Metrics to capture:**
- p50, p95, p99 latency
- Error rate (must be 0%)
- Throughput (req/sec)
- SSE fixture rate (% of requests showing fixture)
- SSE duration (median time from start to complete)

**How to verify:**

1. Run baseline against staging:
   ```bash
   PERF_TARGET_URL=https://olumi-assistants-service-staging.onrender.com \
     pnpm perf:baseline
   ```

2. Open the HTML report:
   ```bash
   open tests/perf/_reports/latest.html
   ```

3. Check metrics:
   - ✅ p95 ≤ 8s
   - ✅ Error rate = 0%
   - ✅ Throughput ≥ 1 req/sec

4. If p95 > 8s:
   - Enable profiling: `PERF_TRACE=1 pnpm dev` (run one request manually)
   - Check logs for slow spans (LLM call, validation, repair, etc.)
   - Document findings in [docs/baseline-performance-report.md](../../docs/baseline-performance-report.md)
   - Add profiling notes to PR

---

## Test Scenarios

### Baseline Load (baseline.yml)

**Profile**: Representative user behaviour
- **Mix**: 5 different brief complexities (simple → complex)
- **Rate**: 1 req/sec (steady state)
- **Duration**: 5 minutes (300 requests)

**Briefs used:**
1. Simple hiring decision (100-200 chars)
2. International expansion (300-500 chars)
3. Make-or-buy payment system (medium complexity)
4. Hiring: FTE vs contractors
5. Architecture: microservices vs monolith

**Why this mix?**
- Represents realistic user input variety
- Tests LLM performance across complexity levels
- Validates caching effectiveness (repeated patterns)

---

## Profiling Mode

Enable detailed timing logs with `PERF_TRACE=1`:

```bash
# Run service with profiling
PERF_TRACE=1 pnpm dev

# In another terminal, send a test request
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"Should we hire or contract?"}'
```

**Profiling output** (example):
```
[PERF] Request /assist/draft-graph started
[PERF]   onRequest: 1ms
[PERF]   handler.validate: 5ms
[PERF]   handler.llm_call: 2,345ms ⚠️
[PERF]   handler.repair: 123ms
[PERF]   handler.stabilize: 45ms
[PERF]   onSend: 2ms
[PERF] Total: 2,521ms
[PERF] Top 3 slow spans: llm_call (2345ms), repair (123ms), stabilize (45ms)
```

---

## Troubleshooting

### High p95 Latency (> 8s)

**Common causes:**
1. **LLM API latency** - Anthropic Claude calls can take 2-8s
   - Check if prompt is too large (reduce context)
   - Verify prompt caching is enabled
   - Consider brief complexity (simpler briefs → faster)

2. **Cold start** - First request after deploy takes longer
   - Warm up with a test request before Artillery run
   - Not counted in p95 after warm-up

3. **Validation/repair overhead** - Multiple validation rounds
   - Check logs for repair frequency
   - Improve prompt quality to reduce repairs

4. **Network latency** - If testing remote staging
   - Compare with local run (should be < 500ms overhead)
   - Check Render region vs Artillery runner location

### Artillery Connection Errors

**Error**: `ECONNREFUSED` or `ETIMEDOUT`

**Fixes:**
- Verify `PERF_TARGET_URL` is correct and service is running
- Check firewall/CORS settings
- Ensure service health: `curl $PERF_TARGET_URL/healthz`

### Rate Limiting

**Error**: HTTP 429 in Artillery report

**Fixes:**
- Reduce `PERF_RPS` (default is already low at 1 req/sec)
- Check rate limit settings in [src/server.ts](../../src/server.ts)
- Confirm Artillery runner IP is allowed

---

## Advanced Usage

### Custom Scenarios

Create a new scenario file (e.g., `stress-test.yml`):

```yaml
config:
  target: '{{ $processEnvironment.PERF_TARGET_URL || "http://localhost:3101" }}'
  phases:
    - duration: 60
      arrivalRate: 10  # 10 req/sec
      rampTo: 50       # ramp to 50 req/sec
      name: 'Stress test'
  processor: './helpers.cjs'

scenarios:
  - name: 'Stress test - high load'
    flow:
      - post:
          url: '/assist/draft-graph'
          json:
            brief: '{{ brief }}'
          beforeRequest: 'selectBrief'
```

Run with:
```bash
artillery run tests/perf/stress-test.yml
```

### CI Integration

Artillery runs are **not** part of CI by default (too slow, requires staging).

To add (optional):
1. Set `PERF_TARGET_URL` in CI environment
2. Add step to `.github/workflows/perf.yml`
3. Upload reports as artifacts

---

## References

- [Artillery Documentation](https://www.artillery.io/docs)
- [Anthropic API Performance](https://docs.anthropic.com/claude/docs/performance)
- [Render Performance Tuning](https://render.com/docs/performance)

---

**Last Updated:** 2025-11-03
**Owner:** Olumi Engineering

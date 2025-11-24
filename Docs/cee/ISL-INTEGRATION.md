# ISL (Inference & Structure Learning) Integration

## Overview

The ISL integration enriches bias detection findings with causal validation analysis. When enabled, the bias-check endpoint sends detected biases to an external ISL service which performs causal analysis to validate the strength and identifiability of cognitive biases in decision graphs.

## Architecture

### Components

1. **ISL Client** ([src/adapters/isl/client.ts](../../src/adapters/isl/client.ts))
   - HTTP client for communicating with ISL service
   - Handles timeouts, retries, and error handling
   - Supports optional API key authentication

2. **Causal Enrichment** ([src/cee/bias/causal-enrichment.ts](../../src/cee/bias/causal-enrichment.ts))
   - Orchestrates ISL validation requests
   - Merges validation results back into bias findings
   - Implements graceful degradation on errors

3. **Type Definitions** ([src/adapters/isl/types.ts](../../src/adapters/isl/types.ts))
   - TypeScript interfaces for ISL request/response contracts
   - Validation structures and evidence strength enums

### Data Flow

```
POST /assist/v1/bias-check
         ↓
   detectBiases()
         ↓
   sortBiasFindings()
         ↓
   enrichBiasFindings() ←─── ISL Service
         ↓               (optional, if enabled)
   CEEBiasCheckResponseV1
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CEE_CAUSAL_VALIDATION_ENABLED` | No | `false` | Enable/disable ISL integration |
| `ISL_BASE_URL` | Yes* | - | ISL service base URL (e.g., `http://localhost:8888`) |
| `ISL_TIMEOUT_MS` | No | `5000` | Request timeout in milliseconds |
| `ISL_MAX_RETRIES` | No | `1` | Maximum retry attempts on failure (canary default) |
| `ISL_API_KEY` | No | - | Optional API key for ISL authentication |

\* Required only when `CEE_CAUSAL_VALIDATION_ENABLED=true`

### Example Configuration

```bash
# Enable ISL integration
export CEE_CAUSAL_VALIDATION_ENABLED=true
export ISL_BASE_URL=http://localhost:8888
export ISL_TIMEOUT_MS=3000
export ISL_MAX_RETRIES=1
export ISL_API_KEY=your-secret-key
```

## ISL API Contract

### Request: POST `/isl/v1/bias-validate`

```typescript
{
  graph: GraphV1,                    // Decision graph structure
  bias_findings: Array<{
    code: string,                    // Bias code (e.g., "CONFIRMATION_BIAS")
    targets: {
      node_ids: string[],
      edge_ids?: string[]
    },
    severity: "low" | "medium" | "high"
  }>,
  validation_config?: {
    enable_counterfactuals?: boolean,
    evidence_nodes?: string[]        // Nodes considered as evidence
  }
}
```

### Response

```typescript
{
  validations: Array<{
    bias_code: string,
    causal_validation: {
      identifiable: boolean,         // Is bias causally identifiable?
      strength: number,               // 0-1 scale
      confidence: "low" | "medium" | "high",
      details?: {
        affected_paths?: string[],
        counterfactual_delta?: {
          metric: string,
          change_percent: number
        }
      }
    },
    evidence_strength?: Array<{
      node_id: string,
      causal_support: "none" | "weak" | "moderate" | "strong",
      reasoning: string
    }>
  }>,
  request_id: string,
  latency_ms: number
}
```

## Feature Behavior

### When Enabled

1. Bias findings are sent to ISL service for validation
2. ISL response enriches findings with `causal_validation` and `evidence_strength` fields
3. Telemetry events track ISL latency and validation metrics

### Graceful Degradation

The integration is designed to **never break** the bias-check endpoint:

- **ISL service unavailable**: Returns unenriched findings
- **ISL timeout**: Returns unenriched findings after timeout
- **ISL error response**: Returns unenriched findings
- **Feature disabled**: Skips ISL call entirely

All failures are logged with structured telemetry but do not affect the 200 response.

### Circuit Breaker

To prevent cascading failures when ISL is experiencing issues, the integration includes an automatic circuit breaker:

**Behavior:**
- Tracks consecutive ISL failures (timeouts, errors, service unavailable)
- After **3 consecutive failures**, circuit opens and pauses ISL calls for **90 seconds**
- During pause, bias-check returns unenriched findings immediately (no ISL calls)
- After pause expires, circuit closes and ISL calls resume
- Single successful ISL call resets the failure counter
- Failure counter resets if no failures occur for 60 seconds

**Telemetry:**
```typescript
// Circuit opens (ISL calls paused)
event: "isl.circuit_breaker.opened"
{
  consecutive_failures: number,
  pause_ms: 90000,
  resume_at: string  // ISO timestamp
}

// Circuit closes (ISL calls resume)
event: "isl.circuit_breaker.closed"
{
  pause_duration_ms: 90000
}

// Failure counter reset after success
event: "isl.circuit_breaker.reset"
{
  previous_failures: number
}
```

**Operational Impact:**
- Prevents request pile-up when ISL is down
- Reduces unnecessary network calls during outages
- Allows ISL service to recover without constant retries
- Bias-check endpoint remains fast and stable during ISL issues

### Telemetry Events

```typescript
// Success
event: "cee.bias.causal_validation.success"
{
  validated_count: number,
  identifiable_count: number,
  avg_strength: string,
  isl_latency_ms: number,
  total_latency_ms: number
}

// Timeout
event: "cee.bias.causal_validation.timeout"
{
  latency_ms: number,
  error: string
}

// Error
event: "cee.bias.causal_validation.error"
{
  error_code: string,
  status_code: number,
  latency_ms: number,
  error: string
}

// No client
event: "cee.bias.causal_validation.no_client"
{
  reason: "ISL_BASE_URL not configured"
}
```

## Testing

### Unit Tests

- **ISL Client**: [tests/unit/isl-client.test.ts](../../tests/unit/isl-client.test.ts)
  - Success/failure scenarios
  - Timeout handling
  - API key authentication
  - Error response parsing

- **Causal Enrichment**: [tests/unit/cee.bias-causal-enrichment.test.ts](../../tests/unit/cee.bias-causal-enrichment.test.ts)
  - Feature flag behavior
  - Enrichment logic
  - Graceful degradation
  - Evidence node extraction

### Integration Tests

- [tests/integration/cee.bias-check-isl.test.ts](../../tests/integration/cee.bias-check-isl.test.ts)
  - End-to-end bias-check with ISL
  - Feature flag disabled/enabled states
  - Timeout and error scenarios
  - Request structure validation

### Running Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test tests/unit/isl-client.test.ts
pnpm test tests/unit/cee.bias-causal-enrichment.test.ts

# Integration tests
pnpm test tests/integration/cee.bias-check-isl.test.ts
```

## Monitoring

### Key Metrics

1. **Enrichment Rate**: Percentage of bias-check requests that receive ISL enrichment
2. **ISL Latency**: Average time for ISL validation (target: < 1000ms)
3. **Identifiable Rate**: Percentage of biases marked as causally identifiable
4. **Timeout Rate**: Frequency of ISL timeouts (should be < 1%)
5. **Error Rate**: ISL service errors (should be < 0.1%)

### Logs

All ISL interactions are logged with structured JSON:

```bash
# Search for ISL events
grep "isl.bias_validate" logs/*.json

# Check enrichment success rate
grep "cee.bias.causal_validation" logs/*.json | jq -r '.event'
```

## Production Considerations

### Performance

- ISL calls run **inline** with bias-check requests (adds latency)
- Typical ISL latency: 200-500ms
- Configure timeout based on acceptable p99 latency
- Consider async enrichment for high-traffic scenarios

### Resilience

- Set conservative timeouts (default 5s)
- Monitor timeout rates
- Alert on error rate > 1%
- ISL failures don't affect bias detection

### Capacity

- Each bias-check request → 1 ISL call (when enabled)
- ISL service must handle bias-check RPS
- No client-side caching (stateless)

## Rollout Strategy

### Initial Deployment (Feature Disabled)
Deploy with ISL integration **disabled** by default:
```bash
CEE_CAUSAL_VALIDATION_ENABLED=false
```
This ensures existing bias-check functionality remains unchanged.

### Canary Rollout

**Step 1: Enable ISL for Single Test User**
```bash
# Set environment variables
export CEE_CAUSAL_VALIDATION_ENABLED=true
export ISL_BASE_URL=https://isl-service.production.example.com
export ISL_TIMEOUT_MS=5000
export ISL_MAX_RETRIES=1
export ISL_API_KEY=your-secret-key

# Restart service
pm2 restart assistants-service
```

**Step 2: Monitor Key Metrics (5-10 minutes)**
```bash
# Check ISL integration health
curl https://your-service.com/healthz | jq '.isl'

# Monitor logs for ISL events
tail -f logs/*.json | grep "isl\|cee.bias.causal_validation"

# Watch for circuit breaker events (should be rare)
grep "circuit_breaker" logs/*.json
```

**Step 3: Validate Enrichment**
- Send test bias-check request
- Verify response includes `causal_validation` and `evidence_strength` fields
- Confirm metrics: enrichment rate > 95%, timeout rate < 1%

**Step 4: Gradual Expansion**
- Expand to 10% of production traffic
- Monitor for 24 hours
- If stable, expand to 50%, then 100%

### Emergency Rollback

**One-Line Rollback (takes effect immediately, no restart required):**
```bash
export CEE_CAUSAL_VALIDATION_ENABLED=false
```

**Verification:**
```bash
# Confirm ISL is disabled
curl https://your-service.com/healthz | jq '.isl.enabled'
# Should return: false

# Verify no ISL calls in logs
tail -f logs/*.json | grep "isl.bias_validate"
# Should show no new events
```

**When to Rollback:**
- ISL error rate > 5% for 5+ minutes
- ISL timeout rate > 10%
- Circuit breaker opens repeatedly (> 3 times in 10 minutes)
- Bias-check p99 latency exceeds SLA
- ISL service unavailable for > 5 minutes

### Monitoring Dashboard

**Key Telemetry Events:**
```bash
# Success rate
grep "cee.bias.causal_validation.success" logs/*.json | wc -l

# Error patterns
grep "cee.bias.causal_validation" logs/*.json | jq -r '.event' | sort | uniq -c

# Circuit breaker status
grep "isl.circuit_breaker" logs/*.json | jq '{event, time: .timestamp}'

# Average enrichment latency
grep "cee.bias.causal_validation.success" logs/*.json | jq '.total_latency_ms' | awk '{sum+=$1; count++} END {print sum/count}'
```

## Future Enhancements

1. **Async Enrichment**: Queue ISL requests, return findings immediately
2. **Response Caching**: Cache ISL responses by graph hash
3. **Batch Validation**: Send multiple bias-checks in one ISL call
4. **Webhook Mode**: ISL posts results asynchronously
5. **Confidence Thresholds**: Only enrich high-confidence biases

## References

- [CEE Bias Detection](./CEE-decision-review-orchestrator.md)
- [CEE Operations Guide](./CEE-ops.md)
- [ISL Service Documentation](../../../isl-service/README.md) (if applicable)

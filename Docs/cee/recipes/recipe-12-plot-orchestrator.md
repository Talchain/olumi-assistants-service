# Recipe 12: PLoT Orchestrator Pattern

## Purpose

Engine-side integration for calling CEE decision review with timeout handling and graceful degradation.

## Prerequisites

- CEE SDK installed: `@olumi/cee-sdk`
- Feature flag: `ENABLE_CEE_REVIEW`
- Environment: `CEE_BASE_URL`, `CEE_API_KEY`, `CEE_TIMEOUT_MS`

## Implementation

### Configuration

```typescript
// config/cee.ts
export const ceeConfig = {
  baseUrl: process.env.CEE_BASE_URL ?? 'https://olumi-assistants-service.onrender.com',
  apiKey: process.env.CEE_API_KEY,
  timeoutMs: parseInt(process.env.CEE_TIMEOUT_MS ?? '10000', 10),
  enabled: process.env.ENABLE_CEE_REVIEW === 'true',
};
```

### CEE Client Wrapper

```typescript
// services/cee-client.ts
import { CeeClient, CeeDecisionReviewPayload } from '@olumi/cee-sdk';
import { ceeConfig } from '../config/cee';
import { log } from '../utils/logger';

interface CeeReviewResult {
  success: boolean;
  review?: CeeDecisionReviewPayload;
  error?: CeeError;
  degraded: boolean;
  latencyMs: number;
}

interface CeeError {
  code: 'CEE_TIMEOUT' | 'CEE_UNAVAILABLE' | 'CEE_ERROR';
  message: string;
  retryable: boolean;
}

export async function fetchCeeReview(
  decisionId: string,
  scenarioId: string,
  graph: GraphV1,
  options?: { correlationId?: string }
): Promise<CeeReviewResult> {
  if (!ceeConfig.enabled) {
    return { success: true, degraded: true, latencyMs: 0 };
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ceeConfig.timeoutMs);

  try {
    const client = new CeeClient({
      baseUrl: ceeConfig.baseUrl,
      apiKey: ceeConfig.apiKey,
    });

    const response = await client.decisionReview({
      decisionId,
      scenarioId,
      graph,
      correlationId: options?.correlationId,
    }, { signal: controller.signal });

    clearTimeout(timeoutId);

    return {
      success: true,
      review: response,
      degraded: false,
      latencyMs: Date.now() - startTime,
    };

  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    // Timeout
    if (error.name === 'AbortError') {
      log.warn({ decisionId, latencyMs }, 'CEE review timed out');
      return {
        success: false,
        error: {
          code: 'CEE_TIMEOUT',
          message: `CEE review timed out after ${ceeConfig.timeoutMs}ms`,
          retryable: true,
        },
        degraded: true,
        latencyMs,
      };
    }

    // Network/service error
    log.error({ decisionId, error: error.message, latencyMs }, 'CEE review failed');
    return {
      success: false,
      error: {
        code: 'CEE_UNAVAILABLE',
        message: error.message,
        retryable: true,
      },
      degraded: true,
      latencyMs,
    };
  }
}
```

### Integration in Run Handler

```typescript
// routes/v1/run.ts
import { fetchCeeReview } from '../../services/cee-client';

async function handleRun(req: Request, res: Response) {
  const { graph, scenarioId, options } = req.body;
  const correlationId = req.headers['x-correlation-id'] as string;

  // 1. Run inference (existing logic)
  const inferenceResult = await runInference(graph, options);

  // 2. Fetch CEE review (non-blocking, degraded-safe)
  let ceeReview: CeeDecisionReviewPayload | undefined;
  let ceeTrace: { latencyMs: number; degraded: boolean } | undefined;
  let ceeError: CeeError | undefined;

  if (shouldFetchCeeReview(options)) {
    const ceeResult = await fetchCeeReview(
      inferenceResult.decisionId,
      scenarioId,
      graph,
      { correlationId }
    );

    if (ceeResult.success && ceeResult.review) {
      ceeReview = ceeResult.review;
    }

    ceeTrace = {
      latencyMs: ceeResult.latencyMs,
      degraded: ceeResult.degraded,
    };

    if (ceeResult.error) {
      ceeError = ceeResult.error;
    }
  }

  // 3. Return combined response
  return res.json({
    ...inferenceResult,
    ceeReview,      // undefined if disabled/failed
    ceeTrace,       // always present if CEE attempted
    ceeError,       // present only on failure
  });
}

function shouldFetchCeeReview(options?: RunOptions): boolean {
  // Only fetch for explicit review requests or saved scenarios
  return options?.includeReview === true || options?.scenarioId != null;
}
```

### Response Shape

```typescript
interface RunResponse {
  // Existing inference fields
  results: InferenceResults;
  validation: ValidationStatus;

  // CEE fields (all optional)
  ceeReview?: CeeDecisionReviewPayload;
  ceeTrace?: {
    latencyMs: number;
    degraded: boolean;
  };
  ceeError?: {
    code: 'CEE_TIMEOUT' | 'CEE_UNAVAILABLE' | 'CEE_ERROR';
    message: string;
    retryable: boolean;
  };
}
```

### Degraded Mode Handling

```typescript
// UI should check for degraded state
if (response.ceeTrace?.degraded) {
  // Show banner: "Decision review unavailable"
  // Still display inference results
}

if (response.ceeError) {
  // Log for debugging
  console.warn('CEE error:', response.ceeError);

  // Optional: offer retry if retryable
  if (response.ceeError.retryable) {
    showRetryButton();
  }
}
```

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_BASE_URL` | Production URL | CEE service endpoint |
| `CEE_API_KEY` | Required | Authentication key |
| `CEE_TIMEOUT_MS` | `10000` | Request timeout |
| `ENABLE_CEE_REVIEW` | `false` | Feature flag |

## Testing

```typescript
describe('CEE Orchestrator', () => {
  it('returns degraded result on timeout', async () => {
    // Mock slow CEE response
    nock(ceeConfig.baseUrl)
      .post('/assist/v1/decision-review')
      .delay(15000)
      .reply(200, {});

    const result = await fetchCeeReview('dec_123', 'scn_456', mockGraph);

    expect(result.degraded).toBe(true);
    expect(result.error?.code).toBe('CEE_TIMEOUT');
  });

  it('returns degraded result when CEE disabled', async () => {
    process.env.ENABLE_CEE_REVIEW = 'false';

    const result = await fetchCeeReview('dec_123', 'scn_456', mockGraph);

    expect(result.degraded).toBe(true);
    expect(result.review).toBeUndefined();
  });

  it('includes review on success', async () => {
    nock(ceeConfig.baseUrl)
      .post('/assist/v1/decision-review')
      .reply(200, goldenFixture);

    const result = await fetchCeeReview('dec_123', 'scn_456', mockGraph);

    expect(result.success).toBe(true);
    expect(result.review).toBeDefined();
    expect(result.degraded).toBe(false);
  });
});
```

## Telemetry Events

Emit these for monitoring:

```typescript
// On success
emit('cee.review.success', { latencyMs, decisionId });

// On timeout
emit('cee.review.timeout', { timeoutMs: ceeConfig.timeoutMs, decisionId });

// On error
emit('cee.review.error', { error: error.message, decisionId });

// On degraded (disabled or failed)
emit('cee.review.degraded', { reason: 'disabled' | 'timeout' | 'error' });
```

## See Also

- [CEE-v1.md](../CEE-v1.md) - CEE contract documentation
- [CeeDecisionReviewPayload Schema](../../../schemas/cee-decision-review.v1.json) - JSON Schema
- [Golden Fixture](../../../tests/fixtures/cee-decision-review.v1.golden.json) - Example payload

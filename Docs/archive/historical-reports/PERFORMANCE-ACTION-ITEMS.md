# Performance Optimization - Detailed Action Items

**Status:** Ready for implementation  
**Total Effort:** 3-5 weeks (full roadmap)  
**Quick Wins:** 1 week (critical + high-value items)  

---

# TIER 1: CRITICAL (Week 1)

## Item 1.1: Implement Retry Logic with Exponential Backoff

**Priority:** 🔴 CRITICAL  
**Effort:** 2 hours  
**Impact:** Prevents ~1% of requests from failing due to transient API errors  
**ROI:** ~1% request recovery

### Files to Modify:
- `/src/adapters/llm/anthropic.ts` (lines 250-396)
- `/src/adapters/llm/openai.ts` (lines 213-303)

### Implementation Steps:

1. **Create retry utility** in new file `/src/utils/retry.ts`:
```typescript
export type RetryOptions = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  }
): Promise<T> {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === options.maxAttempts) throw error;
      
      if (!isRetryableError(error)) throw error;
      
      const delayMs = Math.min(
        options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
        options.maxDelayMs
      ) + Math.random() * 1000; // Add jitter
      
      log.warn({
        attempt,
        nextRetryMs: Math.round(delayMs),
        error: error instanceof Error ? error.message : String(error)
      }, "Retrying LLM call");
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

function isRetryableError(error: any): boolean {
  if (error.name === 'AbortError') return true;
  if (error.status === 429) return true; // Rate limit
  if (error.status >= 500) return true; // Server error
  if (error.code === 'ECONNREFUSED') return true;
  if (error.code === 'ETIMEDOUT') return true;
  return false;
}
```

2. **Update anthropic.ts** - Wrap main functions:
```typescript
// Replace lines 250-270 (draftGraphWithAnthropic)
export async function draftGraphWithAnthropic(args: DraftArgs): Promise<...> {
  return retryWithBackoff(
    () => draftGraphWithAnthropicOnce(args),
    { maxAttempts: 2, initialDelayMs: 1000 }
  );
}

// Rename current function to draftGraphWithAnthropicOnce
async function draftGraphWithAnthropicOnce(args: DraftArgs): Promise<...> {
  // ... existing implementation
}
```

3. **Update openai.ts** - Same pattern for OpenAI adapter

### Testing:
```bash
# Test with simulated failure
ANTHROPIC_API_KEY=invalid pnpm test -- llm-router.test.ts
```

### Expected Result:
- Transient failures recovered automatically
- Log shows retry attempts
- Cost neutral (only retries on failures)

---

## Item 1.2: Fix SSE Backpressure Handling

**Priority:** 🔴 CRITICAL  
**Effort:** 1 hour  
**Impact:** Prevent memory bloat with slow clients  
**ROI:** Stability under adverse conditions

### Files to Modify:
- `/src/routes/assist.draft-graph.ts` (lines 60-72)

### Current Code (Lines 60-72):
```typescript
function writeStage(reply: FastifyReply, event: StageEvent) {
  reply.raw.write(`event: ${STAGE_EVENT}\n`);

  const jsonStr = JSON.stringify(event);
  const lines = jsonStr.split('\n');
  for (const line of lines) {
    reply.raw.write(`data: ${line}\n`);
  }

  reply.raw.write('\n');
}
```

### Fixed Implementation:
```typescript
async function writeStage(reply: FastifyReply, event: StageEvent): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const jsonStr = JSON.stringify(event);
    const lines = jsonStr.split('\n');
    
    let buffer = `event: ${STAGE_EVENT}\n`;
    for (const line of lines) {
      buffer += `data: ${line}\n`;
    }
    buffer += '\n';
    
    // Check if write succeeded or buffer is full
    if (!reply.raw.write(buffer)) {
      // Buffer full, wait for drain event before continuing
      reply.raw.once('drain', () => {
        log.debug({ event: event.stage }, "SSE write resumed after drain");
        resolve();
      });
      
      // Set timeout to prevent hanging
      const timeout = setTimeout(() => {
        reply.raw.removeAllListeners('drain');
        reject(new Error('SSE write timeout'));
      }, 30000);
      
      reply.raw.once('drain', () => clearTimeout(timeout));
    } else {
      // Write succeeded immediately
      resolve();
    }
  });
}
```

### Update callers (lines 373, 391, 409, 425):
```typescript
// Change from:
writeStage(reply, { stage: "DRAFTING" });

// To:
await writeStage(reply, { stage: "DRAFTING" });
```

### Testing:
```bash
# Simulate slow client
curl --limit-rate 10b http://localhost:3101/assist/draft-graph \
  -X POST -H "Content-Type: application/json" \
  -d '{"brief":"test"}'
```

### Expected Result:
- No memory growth with slow clients
- Proper handling of backpressure
- Server doesn't buffer entire response

---

## Item 1.3: Add Memory Monitoring

**Priority:** 🟡 HIGH (but supports critical fixes)  
**Effort:** 30 minutes  
**Impact:** Detect memory issues early  
**ROI:** Production monitoring

### Files to Modify:
- `/src/server.ts` (add after line 245)

### Implementation:
```typescript
// Add memory monitoring in production
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const externalMb = Math.round(mem.external / 1024 / 1024);
    
    // Log at WARNING level if heap usage > 80%
    const heapUsagePercent = (mem.heapUsed / mem.heapTotal) * 100;
    const level = heapUsagePercent > 80 ? 'warn' : 'debug';
    
    app.log[level]({
      heapUsedMb,
      heapTotalMb,
      externalMb,
      heapUsagePercent: Math.round(heapUsagePercent),
      rss: Math.round(mem.rss / 1024 / 1024),
    }, 'Memory usage');
    
    // Alert if critically high
    if (heapUsagePercent > 95) {
      app.log.error({}, '🚨 CRITICAL: Heap usage >95%, potential OOM imminent');
    }
  }, 60000); // Every 60 seconds
}
```

### Testing:
```bash
NODE_ENV=production pnpm dev
# Monitor logs for memory metrics
```

---

# TIER 2: HIGH VALUE (Week 2)

## Item 2.1: Enable Prompt Caching

**Priority:** 🟡 HIGH VALUE  
**Effort:** 3 hours  
**Impact:** 15-30% cost savings on input tokens  
**ROI:** ~$4/month per 1000 requests (cumulative)

### Files to Modify:
- `/src/adapters/llm/anthropic.ts` (lines 104-184, 250-270)

### Step 1: Extract static system prompt
```typescript
// Add near top of anthropic.ts (after imports)
const DRAFT_SYSTEM_PROMPT = `You are an expert at drafting small decision graphs from plain-English briefs.

## Graph Specification
- ≤12 nodes (goal, decision, option, outcome)
- ≤24 edges
- Every edge with belief/weight MUST have structured provenance
- Node IDs: lowercase with underscores
- Stable topology: goal → decision → options → outcomes

## Output Format (JSON)
{ "nodes": [...], "edges": [...], "rationales": [...] }

Respond ONLY with valid JSON matching this structure.`;
```

### Step 2: Update buildPrompt to use cache headers
```typescript
// Replace buildPrompt() implementation (line 104-185)
function buildDraftPrompt(args: DraftArgs): {
  system: Array<{ type: string; text: string; cache_control?: any }>;
  userMessage: string;
} {
  const docContext = args.docs.length
    ? `\n\n## Attached Documents\n${args.docs
        .map((d) => {
          const locationInfo = d.locationHint ? ` (${d.locationHint})` : "";
          return `**${d.source}** (${d.type}${locationInfo}):\n${d.preview}`;
        })
        .join("\n\n")}`
    : "";

  return {
    system: [
      {
        type: "text",
        text: DRAFT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" } // 5-min cache
      }
    ],
    userMessage: `## Brief\n${args.brief}${docContext}`
  };
}
```

### Step 3: Update API call
```typescript
// In draftGraphWithAnthropicOnce (line ~262)
const prompt = buildDraftPrompt(args);

const response = await apiClient.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 4096,
  temperature: 0,
  system: prompt.system,  // Now supports cache_control
  messages: [{ role: "user", content: prompt.userMessage }],
}, { signal: abortController.signal });
```

### Step 4: Repeat for other functions
- `suggestOptionsWithAnthropic()` (line ~398)
- `clarifyBriefWithAnthropic()` (line ~794)
- `critiqueGraphWithAnthropic()` (line ~954)

### Verification:
```typescript
// Check telemetry for cache hits
// In draftGraphWithAnthropic result (line 363-368)
console.log({
  cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
  cache_read_input_tokens: response.usage.cache_read_input_tokens,
});
```

### Testing:
```bash
# First request creates cache
curl -X POST http://localhost:3101/assist/draft-graph \
  -d '{"brief":"Hire or contract?"}'

# Second request hits cache (should see cache_read_input_tokens in response)
curl -X POST http://localhost:3101/assist/draft-graph \
  -d '{"brief":"Hire or contract?"}'
```

---

## Item 2.2: Parallel Attachment Processing

**Priority:** 🟡 HIGH (if attachments used)  
**Effort:** 1 hour  
**Impact:** 50-100ms faster with 5+ documents  
**ROI:** Benefit scales with document count

### Files to Modify:
- `/src/grounding/process-attachments.ts` (lines 42-226)

### Current Code (Sequential):
```typescript
for (const attachment of attachments) {
  // Process one at a time
  const preview = await extractTextFromPdf(buffer);
  docs.push(preview);
}
```

### Fixed Code (Parallel):
```typescript
// Import pLimit for concurrency control
import pLimit from 'p-limit';

export async function processAttachments(
  attachments: AttachmentInput[]
): Promise<{ docs: DocPreview[]; stats: GroundingStats }> {
  // ... existing setup code ...
  
  // Process max 5 attachments in parallel to avoid memory spikes
  const limit = pLimit(5);
  const processingPromises = attachments.map(attachment =>
    limit(() => processAttachmentInternal(attachment, stats))
  );
  
  try {
    const results = await Promise.all(processingPromises);
    docs.push(...results.filter(Boolean));
  } catch (error) {
    // Handle errors...
  }
}

// Extract processing logic into separate function
async function processAttachmentInternal(
  attachment: AttachmentInput,
  stats: GroundingStats
): Promise<DocPreview | null> {
  // ... existing implementation from loop ...
}
```

### Update package.json dependencies:
```bash
pnpm add p-limit
```

---

## Item 2.3: Cache Validation Results

**Priority:** 🟡 MEDIUM (benefit depends on duplicate graphs)  
**Effort:** 1 hour  
**Impact:** 5-10% faster for repeated graphs  
**ROI:** Especially useful in testing/iterative workflows

### Files to Modify:
- `/src/services/validateClient.ts` (new caching layer)
- `/src/routes/assist.draft-graph.ts` (use cached validation)

### Implementation:
```typescript
// Create /src/services/validateClientWithCache.ts
import { LRUCache } from 'lru-cache';
import { validateGraph as validateGraphDirect } from './validateClient.js';
import type { GraphT } from '../schemas/graph.js';
import crypto from 'crypto';

const validationCache = new LRUCache<string, any>({
  max: 1000, // Cache 1000 graphs
  ttl: 1000 * 60 * 5, // 5 minute TTL
});

export async function validateGraph(g: GraphT) {
  // Create hash of graph for cache key
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(g))
    .digest('hex');
  
  // Check cache
  const cached = validationCache.get(hash);
  if (cached) {
    log.debug({ hash: hash.slice(0, 8) }, "Validation cache hit");
    return cached;
  }
  
  // Cache miss, validate
  const result = await validateGraphDirect(g);
  
  // Store in cache
  validationCache.set(hash, result);
  
  return result;
}
```

### Update assist.draft-graph.ts:
```typescript
// Change import (line 10)
import { validateGraph } from '../services/validateClientWithCache.js';
```

---

# TIER 3: OBSERVABILITY (Week 3)

## Item 3.1: Expand Performance Test Suite

**Priority:** 🟡 MEDIUM  
**Effort:** 4 hours  
**Impact:** Catch performance regressions  
**ROI:** Prevent performance degradation

### Create: `/tests/perf/sse.yml`
```yaml
config:
  target: 'http://localhost:3101'
  phases:
    - duration: 60
      arrivalRate: 1

scenarios:
  - name: 'Draft graph - SSE streaming'
    flow:
      - get:
          url: '/assist/draft-graph/stream?brief={{ brief }}'
          expect:
            - statusCode: 200
            - contentType: 'text/event-stream'
          capture:
            - json: '$.graph.nodes.length'
```

### Create: `/tests/perf/attachments.yml`
```yaml
scenarios:
  - name: 'Draft graph - with PDF'
    flow:
      - post:
          url: '/assist/draft-graph'
          json:
            brief: '{{ brief }}'
            attachments:
              - id: 'doc1'
                kind: 'pdf'
                name: 'report.pdf'
          formData:
            attachment_payloads[doc1]: '@tests/fixtures/sample.pdf'
```

### Create: `/tests/perf/stress.yml`
```yaml
config:
  phases:
    - duration: 120
      arrivalRate: 2
      rampTo: 10
      name: 'Stress test - ramp up'
    - duration: 60
      arrivalRate: 10
      name: 'Stress test - sustained'
```

---

# TIER 4: ADVANCED (Week 4+)

## Item 4.1: Implement Request Queuing

**Priority:** 🟡 MEDIUM (prevents rate limit hits)  
**Effort:** 4 hours  
**Impact:** Smooth request flow, prevent rate limit cascades

### Create: `/src/utils/requestQueue.ts`
```typescript
import PQueue from 'p-queue';

const queue = new PQueue({
  concurrency: 5, // Max 5 concurrent LLM calls
  timeout: 30000, // 30s max queue wait
});

export { queue };
```

### Update: `/src/routes/assist.draft-graph.ts`
```typescript
const result = await queue.add(
  () => runDraftGraphPipeline(input, rawBody),
  { priority: input.is_premium ? 10 : 1 }
);
```

---

# TESTING CHECKLIST

After each implementation:

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Unit tests
pnpm test

# Performance baseline
pnpm perf:baseline

# Memory check
PERF_TRACE=1 pnpm dev
# Send one request and observe memory metrics
```

---

# SUCCESS CRITERIA

| Item | Success Metric |
|------|-----------------|
| Retry logic | 0% failures on transient errors |
| Backpressure | No OOM with slow clients |
| Memory monitoring | Alerts on >80% heap usage |
| Prompt caching | 15-30% cost reduction |
| Parallel processing | 50-100ms faster (5 files) |
| Validation caching | 5-10% faster (same graphs) |
| Performance tests | p95 stable, regressions caught |

---

**Generated:** November 9, 2025  
**Target Completion:** 4 weeks (full) / 1 week (critical + high-value)

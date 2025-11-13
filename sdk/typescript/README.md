# Olumi Assistants SDK

Official TypeScript SDK for [Olumi Assistants Service](https://github.com/Talchain/olumi-assistants-service).

## Features

✅ **Type-safe API** - Full TypeScript support with detailed types
✅ **Automatic retries** - Exponential backoff for transient failures (5xx, 429, network errors)
✅ **Request tracking** - Capture `X-Request-Id` and rate limit headers
✅ **Input validation** - Client-side validation before API calls
✅ **Timeout control** - Configurable timeouts with AbortSignal support
✅ **Modern** - Built on native `fetch()` API (Node.js 18+)
✅ **Share & Status** - Support for v1.6 features (share links, diagnostics)

## Installation

```bash
npm install @olumi/assistants-sdk
```

Or with pnpm:

```bash
pnpm add @olumi/assistants-sdk
```

## Quick Start

```typescript
import { OlumiClient } from "@olumi/assistants-sdk";

const client = new OlumiClient({
  apiKey: process.env.OLUMI_API_KEY!,
});

// Draft a decision graph
const { data, metadata } = await client.draftGraph({
  brief: "Should we expand into EU markets?",
});

console.log("Graph:", data.graph);
console.log("Request ID:", metadata.requestId);
console.log("Rate limit remaining:", metadata.rateLimit?.remaining);
```

## Configuration

```typescript
const client = new OlumiClient({
  apiKey: "your-api-key",
  baseUrl: "https://olumi-assistants-service.onrender.com", // optional
  timeout: 60000, // 60 seconds (default)
  maxRetries: 3, // automatic retries (default)
  retryDelay: 1000, // base delay for exponential backoff (default)
});
```

## API Methods

### Draft Graph

Generate a decision graph from a brief description:

```typescript
const response = await client.draftGraph({
  brief: "Should we migrate to microservices?",
  attachments: [
    {
      id: "att_0",
      kind: "document",
      name: "architecture.md",
    },
  ],
  attachment_payloads: {
    att_0: base64EncodedContent,
  },
});

console.log("Nodes:", response.data.graph.nodes);
console.log("Edges:", response.data.graph.edges);
console.log("Rationales:", response.data.rationales);
```

### Suggest Options

Generate alternative options for a question node:

```typescript
const response = await client.suggestOptions({
  graph: existingGraph,
  question_id: "question_node_id",
});

console.log("Options:", response.data.options);
```

### Clarify Brief

Get clarifying questions for ambiguous briefs:

```typescript
const response = await client.clarifyBrief({
  brief: "Improve our product",
  round: 0,
});

console.log("Questions:", response.data.questions);
console.log("Should continue:", response.data.should_continue);
```

### Critique Graph

Evaluate graph quality and get improvement suggestions:

```typescript
const response = await client.critiqueGraph({
  graph: draftGraph,
  brief: "Original brief",
  focus_areas: ["completeness", "clarity"],
});

console.log("Quality:", response.data.overall_quality);
console.log("Issues:", response.data.issues);
console.log("Fixes:", response.data.suggested_fixes);
```

### Explain Diff

Explain changes between graph versions:

```typescript
const response = await client.explainDiff({
  brief: "Original brief",
  patch: {
    adds: {
      nodes: [{ id: "n1", kind: "option", label: "New option" }],
      edges: [{ from: "q1", to: "n1" }],
    },
  },
});

console.log("Rationales:", response.data.rationales);
```

### Evidence Pack

Generate supporting evidence for a graph:

```typescript
const response = await client.evidencePack({
  graph: finalGraph,
  brief: "Original brief",
  request_id: "req_123",
});

console.log("Evidence:", response.data.rationales);
console.log("Metadata:", response.data.metadata);
```

### Create Share (v1.6)

Create a shareable link for a graph:

```typescript
const response = await client.createShare({
  graph: myGraph,
  brief: "Decision context",
  redaction_mode: "minimal", // or "full"
});

console.log("Share URL:", response.data.share_url);
console.log("Expires at:", response.data.expires_at);
```

### Revoke Share (v1.6)

Revoke a share link:

```typescript
const response = await client.revokeShare("share_abc123");
console.log("Revoked:", response.data.revoked);
```

### Get Status (v1.6)

Get service diagnostics and metrics:

```typescript
const response = await client.getStatus();

console.log("Service version:", response.data.version);
console.log("Uptime:", response.data.uptime_seconds);
console.log("Requests:", response.data.requests);
console.log("LLM provider:", response.data.llm.provider);
console.log("Cache stats:", response.data.llm.cache_stats);
console.log("Feature flags:", response.data.feature_flags);
```

### Health Check

Simple service health check:

```typescript
const response = await client.healthCheck();
console.log("Status:", response.data.ok);
console.log("Version:", response.data.version);
```

## SSE Streaming with Resume (v1.8.0)

The SDK supports Server-Sent Events (SSE) streaming with automatic resume capability for resilient real-time updates.

### Features

✅ **Zero-loss reconnection** - Replay missed events during disconnection
✅ **Automatic buffering** - Server buffers up to 256 events or 1.5 MB
✅ **Resume tokens** - HMAC-signed tokens for secure reconnection
✅ **Snapshot fallback** - Late reconnection to completed streams returns final result
✅ **Graceful degradation** - Streams continue without resume if Redis unavailable

### Streaming Draft Graph

```typescript
import {
  streamDraftGraph,
  extractResumeTokenFromEvent,
} from "@olumi/assistants-sdk";

// Create abort controller for cancellation
const controller = new AbortController();

// Start streaming
const events = streamDraftGraph(
  {
    baseUrl: "https://olumi-assistants-service.onrender.com",
    apiKey: process.env.OLUMI_API_KEY!,
  },
  {
    brief: "Should we expand into EU markets?",
  },
  {
    signal: controller.signal,
    timeout: 120000, // 2 minutes
  }
);

// Save resume token for reconnection
let resumeToken: string | null = null;

// Process events
for await (const event of events) {
  // Capture resume token (emitted as second event)
  const token = extractResumeTokenFromEvent(event);
  if (token) {
    resumeToken = token;
    console.log("Resume token saved:", token);
  }

  // Handle stage events
  if (event.type === "stage") {
    console.log("Stage:", event.data.stage);

    if (event.data.stage === "COMPLETE") {
      console.log("Final graph:", event.data.payload?.graph);
    }
  }
}
```

### Resuming Interrupted Streams

If the connection drops, use the resume token to recover missed events:

```typescript
import { resumeDraftGraph } from "@olumi/assistants-sdk";

// Resume with saved token
try {
  const result = await resumeDraftGraph(
    {
      baseUrl: "https://olumi-assistants-service.onrender.com",
      apiKey: process.env.OLUMI_API_KEY!,
    },
    {
      token: resumeToken,
      signal: controller.signal,
    }
  );

  console.log(`Replayed ${result.replayedCount} events`);

  // Process replayed events
  for (const event of result.events) {
    if (event.type === "stage") {
      console.log("Replayed stage:", event.data.stage);
    }
  }

  // Check if stream completed
  if (result.completed) {
    console.log("Stream completed");
  } else {
    console.log("Need to reconnect for live events");
    // Reconnect to main stream endpoint for ongoing updates
  }
} catch (error) {
  if (error instanceof OlumiAPIError && error.statusCode === 426) {
    console.log("Resume not available - starting new stream");
  }
}
```

### ⚠️ Important - Replay-Only Behavior (v1.8.0)

The resume endpoint currently implements **replay-only** behavior:

1. Server replays all buffered events since the token sequence
2. For **completed streams**: Final `complete` event is sent, then connection closes
3. For **in-progress streams**: Buffered events are replayed, heartbeat sent, then connection closes

**This means:**
- Resume does NOT keep the connection open for live events
- Clients must reconnect to the main stream endpoint for ongoing updates
- Resume is designed for recovering missed events after disconnection, not live streaming

**Future Enhancement (v1.9+):**
- Keep resume connection open for live event continuation
- Support seamless transition from replay to live streaming

### Resilient Streaming Pattern

Complete pattern for production use with automatic recovery:

```typescript
import {
  streamDraftGraph,
  resumeDraftGraph,
  extractResumeTokenFromEvent,
  OlumiAPIError,
  type SseEvent,
} from "@olumi/assistants-sdk";

async function resilientStream(brief: string) {
  const config = {
    baseUrl: "https://olumi-assistants-service.onrender.com",
    apiKey: process.env.OLUMI_API_KEY!,
  };

  let resumeToken: string | null = null;
  let allEvents: SseEvent[] = [];
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount <= maxRetries) {
    try {
      // First attempt or after resume failed
      if (!resumeToken) {
        console.log("Starting new stream...");
        const events = streamDraftGraph(config, { brief });

        for await (const event of events) {
          // Save resume token
          const token = extractResumeTokenFromEvent(event);
          if (token) {
            resumeToken = token;
          }

          allEvents.push(event);

          // Process event
          if (event.type === "stage" && event.data.stage === "COMPLETE") {
            console.log("Stream completed successfully");
            return event.data.payload;
          }
        }
      } else {
        // Try to resume
        console.log(`Attempting resume (retry ${retryCount})...`);
        const result = await resumeDraftGraph(config, { token: resumeToken });

        console.log(`Replayed ${result.replayedCount} events`);
        allEvents.push(...result.events);

        if (result.completed) {
          // Find complete event
          const completeEvent = result.events.find((e) => e.type === "complete");
          if (completeEvent && completeEvent.type === "complete") {
            console.log("Stream completed via resume");
            return completeEvent.data;
          }
        } else {
          // Resume successful but stream not complete - reconnect
          console.log("Resume replay complete, reconnecting for live events...");
          resumeToken = null; // Force new stream
        }
      }
    } catch (error) {
      if (error instanceof OlumiAPIError && error.statusCode === 426) {
        // State expired - start fresh
        console.log("Resume state expired, starting new stream");
        resumeToken = null;
      } else {
        console.error("Stream error:", error);
        retryCount++;

        if (retryCount <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw new Error("Max retries exceeded");
        }
      }
    }
  }

  throw new Error("Stream failed after all retries");
}

// Usage
const result = await resilientStream("Should we expand into EU markets?");
console.log("Final graph:", result.graph);
```

### SSE Event Types

All SSE events follow a common structure:

```typescript
type SseEvent =
  | { type: "stage"; data: { stage: "DRAFTING" | "COMPLETE"; payload?: DraftGraphResponse | ErrorResponse } }
  | { type: "resume"; data: { token: string } }
  | { type: "complete"; data: DraftGraphResponse | ErrorResponse }
  | { type: "heartbeat"; data: null };
```

### HMAC Authentication for Streaming

Both streaming and resume support HMAC authentication:

```typescript
import { streamDraftGraph, sign } from "@olumi/assistants-sdk";

const config = {
  baseUrl: "https://olumi-assistants-service.onrender.com",
  apiKey: "", // Not used with HMAC
  hmacSecret: process.env.OLUMI_HMAC_SECRET!,
};

const events = streamDraftGraph(config, { brief: "Test" });

for await (const event of events) {
  // Events are automatically authenticated with HMAC
  console.log(event);
}
```

### Error Handling

Resume operations can return specific error codes:

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Missing or malformed token | Start new stream |
| 401 | Invalid signature or expired token | Start new stream |
| 426 | Resume not available (secrets/Redis not configured) | Fall back to new stream |

```typescript
try {
  const result = await resumeDraftGraph(config, { token: savedToken });
} catch (error) {
  if (error instanceof OlumiAPIError) {
    switch (error.statusCode) {
      case 400:
      case 401:
        console.log("Invalid token, starting new stream");
        break;
      case 426:
        console.log("Resume not supported, starting new stream");
        break;
      default:
        throw error;
    }
  }
}
```

### Configuration

Resume behavior is controlled by server-side environment variables:

```bash
# Resume Secrets (server-side)
SSE_RESUME_SECRET=<64-char-hex-secret>  # Preferred for SSE resume tokens
HMAC_SECRET=<64-char-hex-secret>        # Fallback if SSE_RESUME_SECRET not set

# Redis Configuration (required for resume)
REDIS_URL=redis://localhost:6379

# Buffer Limits
SSE_BUFFER_MAX_EVENTS=256      # Max events per stream
SSE_BUFFER_MAX_SIZE_MB=1.5     # Max buffer size in MB

# TTLs
SSE_STATE_TTL_SEC=900          # State TTL (15 min)
SSE_SNAPSHOT_TTL_SEC=60        # Snapshot TTL after completion
```

## Advanced Usage

### Request Options

All API methods accept optional request options:

```typescript
const controller = new AbortController();

const response = await client.draftGraph(
  { brief: "My brief" },
  {
    timeout: 30000, // Override default timeout
    retries: 5, // Override default retry count
    signal: controller.signal, // For cancellation
  }
);

// Cancel request
controller.abort();
```

### Response Metadata

All responses include metadata extracted from HTTP headers:

```typescript
const { data, metadata } = await client.draftGraph({ brief: "Test" });

// Request tracking
console.log("Request ID:", metadata.requestId);

// Rate limiting
if (metadata.rateLimit) {
  console.log("Limit:", metadata.rateLimit.limit);
  console.log("Remaining:", metadata.rateLimit.remaining);
  console.log("Reset:", metadata.rateLimit.reset);
}
```

### Error Handling

The SDK provides specific error classes:

```typescript
import {
  OlumiAPIError,
  OlumiNetworkError,
  OlumiValidationError,
  OlumiConfigError,
} from "@olumi/assistants-sdk";

try {
  const response = await client.draftGraph({ brief: "Test" });
} catch (error) {
  if (error instanceof OlumiAPIError) {
    console.error("API error:", error.code);
    console.error("Status:", error.statusCode);
    console.error("Request ID:", error.requestId);
    console.error("Details:", error.details);

    // Check if retryable
    if (error.isRetryable()) {
      const retryAfter = error.getRetryAfter();
      console.log("Retry after:", retryAfter, "ms");
    }
  } else if (error instanceof OlumiNetworkError) {
    console.error("Network error:", error.message);
    console.error("Is timeout:", error.isTimeout);

    // Always retryable
    if (error.isRetryable()) {
      console.log("Will retry automatically");
    }
  } else if (error instanceof OlumiValidationError) {
    console.error("Validation error:", error.message);
    console.error("Field:", error.field);
  } else if (error instanceof OlumiConfigError) {
    console.error("Configuration error:", error.message);
  }
}
```

### Automatic Retries

The SDK automatically retries on:
- **5xx errors** (server errors)
- **429 errors** (rate limits)
- **Network failures**
- **Timeouts**

Retry behavior:
- Exponential backoff: `baseDelay * 2^attempt * (1 + random(0, 0.3))`
- Respects `Retry-After` header from 429 responses
- Max 3 retries by default (configurable)
- No retry on 4xx client errors (except 429)

## TypeScript

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  Graph,
  GraphNode,
  GraphEdge,
  DraftGraphRequest,
  DraftGraphResponse,
  ShareRequest,
  ShareResponse,
  StatusResponse,
  ErrorResponse,
} from "@olumi/assistants-sdk";
```

## Examples

See the [examples/](../../examples/) directory for complete integration examples:

- **[react-sse-client](../../examples/react-sse-client/)** - React + TypeScript demo with SSE streaming

## Requirements

- Node.js 18+ (native `fetch()` support)
- TypeScript 5.0+ (recommended)

## License

MIT

## Support

- **GitHub**: [Talchain/olumi-assistants-service](https://github.com/Talchain/olumi-assistants-service)
- **Documentation**: [Docs/](../../Docs/)

---

**Version**: 1.8.0
**Last Updated**: 2025-11-13

# Frontend Integration Guide - Olumi Assistants Service

**Version**: 1.2.0
**Base URL (Production)**: `https://olumi-assistants-service.onrender.com`
**Base URL (Local)**: `http://localhost:3101`

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Endpoints](#core-endpoints)
3. [SSE Streaming](#sse-streaming)
4. [Document Attachments](#document-attachments)
5. [Evidence Pack](#evidence-pack)
6. [Draft Diff Application](#draft-diff-application)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)
9. [CORS Configuration](#cors-configuration)

---

## Quick Start

### Installation

```bash
npm install eventsource  # For SSE streaming (if using Node.js)
# For browsers, EventSource is built-in
```

### Basic Example (JSON Response)

```typescript
const BASE_URL = 'https://olumi-assistants-service.onrender.com';

async function draftGraph(brief: string) {
  const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ brief }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  const result = await response.json();
  return result;
}

// Usage
const draft = await draftGraph('Should we expand into EU markets?');
console.log(draft.graph.nodes);
```

---

## Core Endpoints

### 1. POST `/assist/draft-graph`

**Description**: Generate a draft graph (JSON response)

**Request**:
```typescript
interface DraftGraphRequest {
  brief: string;                    // The strategic question
  attachments?: Attachment[];       // Optional documents
  attachment_payloads?: Record<string, string>; // Base64 encoded content
  include_debug?: boolean;          // Include needle movers (default: false)
  flags?: {
    grounding?: boolean;            // Enable document grounding (default: true)
    critique?: boolean;             // Enable critique (default: true)
    clarifier?: boolean;            // Enable clarifier (default: true)
  };
}

interface Attachment {
  id: string;                       // Unique ID (e.g., "att_0", "att_1")
  kind: "document";                 // Always "document" for now
  name: string;                     // Filename (e.g., "market_data.csv")
}
```

**Response (Success)**:
```typescript
interface DraftGraphResponse {
  graph: {
    nodes: Node[];                  // Graph nodes
    edges: Edge[];                  // Graph edges
  };
  patch: {                          // Always empty for initial drafts
    adds: { nodes: [], edges: [] };
    updates: [];
    removes: [];
  };
  rationales: string[];             // Edge explanations
  issues?: string[];                // Validation warnings (if any)
  confidence: number;               // 0.0 - 1.0
  clarifier_status: "confident" | "complete" | "max_rounds";
  debug?: {
    needle_movers: DocPreview[];    // Only if include_debug=true
  };
}

interface Node {
  id: string;                       // e.g., "n1", "n2"
  label: string;                    // Node label
  kind: "option" | "factor" | "outcome" | "assumption";
}

interface Edge {
  id: string;                       // Deterministic: hash(from+to+provenance)
  from: string;                     // Source node ID
  to: string;                       // Target node ID
  provenance?: {                    // Evidence (v04 structured format)
    kind: "LLM_REASONED" | "GROUNDED_IN_DOC";
    quote?: string;                 // ≤100 chars (redacted for privacy)
    doc_index?: number;             // Index into needle_movers array
  };
}
```

**Example**:
```typescript
const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    brief: 'Should we expand into EU markets?',
  }),
});

const data = await response.json();
console.log(data.graph.nodes.length); // e.g., 8 nodes
```

---

### 2. POST `/assist/draft-graph/stream`

**Description**: Generate a draft graph with SSE streaming (recommended for production)

**Request**: Same as `/assist/draft-graph` (see above)

**Response**: Server-Sent Events stream

**Events**:
1. `stage: DRAFTING` - Initial event
2. `stage: DRAFTING` (with payload) - Fixture graph shown after 2.5s (optional)
3. `stage: COMPLETE` (with payload) - Final draft or error

**Example** (Browser):
```typescript
function streamDraft(brief: string, onUpdate: (data: any) => void) {
  const eventSource = new EventSource(
    `${BASE_URL}/assist/draft-graph/stream`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    }
  );

  eventSource.addEventListener('stage', (event) => {
    const data = JSON.parse(event.data);

    if (data.stage === 'DRAFTING') {
      console.log('Drafting started...');
      if (data.payload) {
        // Fixture graph shown (draft taking >2.5s)
        onUpdate(data.payload);
      }
    } else if (data.stage === 'COMPLETE') {
      console.log('Drafting complete!');
      onUpdate(data.payload);
      eventSource.close();
    }
  });

  eventSource.onerror = (error) => {
    console.error('SSE error:', error);
    eventSource.close();
  };

  return () => eventSource.close(); // Cleanup function
}

// Usage
const cleanup = streamDraft(
  'Should we expand into EU markets?',
  (data) => {
    if (data.graph) {
      console.log('Graph updated:', data.graph.nodes.length);
    } else if (data.schema === 'error.v1') {
      console.error('Error:', data.message);
    }
  }
);
```

**Example** (fetch with streaming):
```typescript
async function streamDraftFetch(brief: string, onUpdate: (data: any) => void) {
  const response = await fetch(`${BASE_URL}/assist/draft-graph/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ brief }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || ''; // Keep incomplete event in buffer

    for (const line of lines) {
      if (line.startsWith('event: stage')) {
        const dataLine = line.split('\n')[1]; // "data: {...}"
        if (dataLine?.startsWith('data: ')) {
          const json = dataLine.slice(6); // Remove "data: " prefix
          const event = JSON.parse(json);
          onUpdate(event);
        }
      }
    }
  }
}
```

---

## SSE Streaming

### Why Use SSE?

- **Progressive feedback**: Show fixture graph while drafting (2.5s timeout)
- **Better UX**: Users see progress instead of waiting
- **Optimistic rendering**: Display fixture, replace with real draft when ready

### SSE vs JSON

| Feature | `/assist/draft-graph` (JSON) | `/assist/draft-graph/stream` (SSE) |
|---------|------------------------------|-------------------------------------|
| Response format | Single JSON response | Multiple SSE events |
| Rate limit | 120 RPM (global) | **20 RPM** (stricter) |
| Fixture fallback | No | Yes (after 2.5s) |
| Use case | Quick requests, testing | Production UI |

**⚠️ IMPORTANT**: Always use `/assist/draft-graph/stream` for production SSE streaming. The legacy path (`/assist/draft-graph` + `Accept: text/event-stream` header) is deprecated and will be removed.

---

## Document Attachments

### Supported Formats

- **TXT/MD**: Plain text, markdown (5k char limit per file)
- **CSV**: Tabular data (5k char limit, privacy-safe aggregates only)
- **PDF**: Extractable text + images (5k char limit per file)

**Aggregate limit**: 50k chars total across all files

### CSV Privacy Guarantee

**The service NEVER returns raw CSV row data.** Only aggregates (sums, counts, trends) are exposed. This protects PII.

**Example**:
```csv
name,revenue
Alice,10000
Bob,15000
```

**What you'll get**: "Revenue trends show growth" (no "Alice" or "Bob" in response)

### Attachment Schema

```typescript
interface AttachmentRequest {
  brief: string;
  attachments: Attachment[];
  attachment_payloads: Record<string, string>; // Base64 encoded
}

interface Attachment {
  id: string;           // Unique ID (e.g., "att_0")
  kind: "document";     // Always "document"
  name: string;         // Filename with extension
}
```

### Example: Upload CSV

```typescript
async function draftWithCsv(brief: string, csvContent: string) {
  // Base64 encode CSV content
  const base64Csv = btoa(csvContent);

  const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brief,
      attachments: [
        {
          id: 'att_0',
          kind: 'document',
          name: 'market_data.csv',
        },
      ],
      attachment_payloads: {
        att_0: base64Csv,
      },
    }),
  });

  return response.json();
}

// Usage
const csvData = `product,sales\nWidget A,1000\nWidget B,1500`;
const draft = await draftWithCsv('Which product should we focus on?', csvData);
```

### Example: Upload Multiple Files

```typescript
async function draftWithFiles(brief: string, files: File[]) {
  const attachments: Attachment[] = [];
  const payloads: Record<string, string> = {};

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const content = await file.text();
    const base64 = btoa(content);

    attachments.push({
      id: `att_${i}`,
      kind: 'document',
      name: file.name,
    });

    payloads[`att_${i}`] = base64;
  }

  const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brief,
      attachments,
      attachment_payloads: payloads,
    }),
  });

  return response.json();
}
```

### Over-Limit Handling

If files exceed limits, the service returns a `BAD_INPUT` error with helpful hints:

```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "file_att_0_exceeds_limit",
  "details": {
    "hint": "One or more files exceed the 5k character limit. Please reduce file size or split into smaller files."
  },
  "request_id": "req_abc123"
}
```

---

## Evidence Pack

### What is an Evidence Pack?

A **redacted provenance export** containing:
- Graph structure (nodes, edges)
- Rationales (edge explanations)
- Grounding sources (≤100 char quotes, no PII)
- Request metadata (version, confidence, cost)

**Purpose**: Audit trail, explainability, compliance

### GET `/assist/draft-graph/:request_id/evidence`

**Description**: Download evidence pack for a completed draft

**Response**: JSON file with `evidence_pack.v1` schema

**Schema**:
```typescript
interface EvidencePack {
  schema: "evidence_pack.v1";
  request_id: string;               // Request ID from original draft
  timestamp: string;                // ISO 8601
  brief: string;                    // Original brief
  graph: {
    nodes: Node[];
    edges: Edge[];
  };
  rationales: string[];             // Edge explanations
  doc_locations: DocLocation[];     // Grounding sources (redacted)
  confidence: number;               // 0.0 - 1.0
  issues?: string[];                // Validation warnings
  cost_usd: number;                 // LLM cost
  service_version: string;          // e.g., "1.2.0"
  provider: string;                 // e.g., "anthropic"
  model: string;                    // e.g., "claude-3-5-sonnet-20241022"
}

interface DocLocation {
  doc_index: number;                // Index into attachments
  quote: string;                    // ≤100 chars (redacted)
  char_start: number;               // Character offset
  char_end: number;                 // Character offset
}
```

### Example: Download Evidence Pack

```typescript
async function downloadEvidencePack(requestId: string) {
  const response = await fetch(
    `${BASE_URL}/assist/draft-graph/${requestId}/evidence`,
    { method: 'GET' }
  );

  if (!response.ok) {
    throw new Error('Evidence pack not available');
  }

  const evidencePack = await response.json();

  // Download as JSON file
  const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `evidence_pack_${requestId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Usage (from response headers or telemetry)
const requestId = response.headers.get('X-Request-Id');
await downloadEvidencePack(requestId);
```

### React Component Example

```tsx
import { useState } from 'react';

function EvidencePackButton({ requestId }: { requestId: string }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${BASE_URL}/assist/draft-graph/${requestId}/evidence`
      );
      const evidencePack = await response.json();

      const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence_${requestId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download evidence pack:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleDownload} disabled={loading}>
      {loading ? 'Downloading...' : 'Download Evidence Pack'}
    </button>
  );
}
```

---

## Draft Diff Application

### What is Draft Diff?

When updating an existing graph, the service returns a **patch** with additions, updates, and removals.

### Patch Schema

```typescript
interface DraftPatch {
  adds: {
    nodes: Node[];
    edges: Edge[];
  };
  updates: NodeUpdate[];
  removes: string[];              // Node/edge IDs to remove
}

interface NodeUpdate {
  id: string;                     // Node ID to update
  label?: string;                 // New label
  kind?: NodeKind;                // New kind
}
```

### Applying Patches (Client-Side)

```typescript
function applyPatch(
  currentGraph: { nodes: Node[]; edges: Edge[] },
  patch: DraftPatch
): { nodes: Node[]; edges: Edge[] } {
  // 1. Remove nodes/edges
  const nodeIds = new Set(currentGraph.nodes.map(n => n.id));
  const edgeIds = new Set(currentGraph.edges.map(e => e.id));

  for (const id of patch.removes) {
    nodeIds.delete(id);
    edgeIds.delete(id);
  }

  let nodes = currentGraph.nodes.filter(n => nodeIds.has(n.id));
  let edges = currentGraph.edges.filter(e => edgeIds.has(e.id));

  // 2. Update existing nodes
  for (const update of patch.updates) {
    const node = nodes.find(n => n.id === update.id);
    if (node) {
      if (update.label !== undefined) node.label = update.label;
      if (update.kind !== undefined) node.kind = update.kind;
    }
  }

  // 3. Add new nodes/edges
  nodes = [...nodes, ...patch.adds.nodes];
  edges = [...edges, ...patch.adds.edges];

  return { nodes, edges };
}

// Usage
const updatedGraph = applyPatch(currentGraph, response.patch);
```

### Visualization Example (React)

```tsx
import { useState } from 'react';

function DraftViewer() {
  const [graph, setGraph] = useState({ nodes: [], edges: [] });

  const handleDraft = async (brief: string) => {
    const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    });

    const data = await response.json();
    const updatedGraph = applyPatch(graph, data.patch);
    setGraph(updatedGraph);
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Enter brief..."
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleDraft(e.currentTarget.value);
          }
        }}
      />
      <div>
        <h3>Nodes: {graph.nodes.length}</h3>
        <ul>
          {graph.nodes.map(node => (
            <li key={node.id}>
              {node.label} ({node.kind})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

---

## Error Handling

### error.v1 Schema

All errors follow the `error.v1` schema:

```typescript
interface ErrorV1 {
  schema: "error.v1";
  code: "BAD_INPUT" | "RATE_LIMITED" | "INTERNAL";
  message: string;                // Human-readable message
  details?: unknown;              // Additional context
  request_id: string;             // For support/debugging
}
```

### Error Codes

| Code | HTTP Status | Meaning | Action |
|------|-------------|---------|--------|
| `BAD_INPUT` | 400 | Invalid request (e.g., missing brief, over-limit files) | Fix request and retry |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Wait and retry with exponential backoff |
| `INTERNAL` | 500 | Server error | Log request_id and contact support |

### Example: Error Handling

```typescript
async function safeDraft(brief: string) {
  try {
    const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief }),
    });

    const data = await response.json();

    if (data.schema === 'error.v1') {
      switch (data.code) {
        case 'BAD_INPUT':
          console.error('Invalid input:', data.message);
          // Show user-friendly error
          break;
        case 'RATE_LIMITED':
          console.warn('Rate limited, retrying in 60s...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          return safeDraft(brief); // Retry
        case 'INTERNAL':
          console.error('Server error:', data.request_id);
          // Log to error tracking service
          break;
      }
      throw new Error(data.message);
    }

    return data;
  } catch (error) {
    console.error('Network error:', error);
    throw error;
  }
}
```

---

## Rate Limiting

### Limits

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| `/assist/draft-graph` (JSON) | 120 RPM | 1 minute |
| `/assist/draft-graph/stream` (SSE) | **20 RPM** | 1 minute |
| All other endpoints | 120 RPM | 1 minute |

### Rate Limit Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 120           # Max requests per window
X-RateLimit-Remaining: 118       # Remaining requests
X-RateLimit-Reset: 60            # Seconds until reset
```

### Example: Check Rate Limits

```typescript
async function draftWithRateLimit(brief: string) {
  const response = await fetch(`${BASE_URL}/assist/draft-graph`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief }),
  });

  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  console.log(`Rate limit: ${remaining} requests left, resets in ${reset}s`);

  if (response.status === 429) {
    const retryAfter = parseInt(reset || '60');
    console.warn(`Rate limited, retry after ${retryAfter}s`);
    throw new Error('RATE_LIMITED');
  }

  return response.json();
}
```

---

## CORS Configuration

### Allowed Origins

Production service allows requests from:
- `https://olumi.app`
- `https://app.olumi.app`
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (React dev server)

### CORS Headers

The service returns appropriate CORS headers:
```
Access-Control-Allow-Origin: https://olumi.app
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: Content-Type, Accept, X-Request-Id
Access-Control-Expose-Headers: X-RateLimit-*, X-Request-Id
```

### Example: Preflight Handling

```typescript
// Browsers automatically send OPTIONS preflight for cross-origin requests
// No action needed - the service handles CORS automatically

async function draftFromBrowser(brief: string) {
  const response = await fetch('https://olumi-assistants-service.onrender.com/assist/draft-graph', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 'Origin' header automatically added by browser
    },
    body: JSON.stringify({ brief }),
  });

  // CORS headers automatically validated by browser
  return response.json();
}
```

---

## Best Practices

### 1. Use SSE for Production UIs

✅ **DO**: Use `/assist/draft-graph/stream` for real-time UI updates
❌ **DON'T**: Use legacy Accept header path (`/assist/draft-graph` + `Accept: text/event-stream`)

### 2. Handle Rate Limits Gracefully

```typescript
async function retryWithBackoff(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.message === 'RATE_LIMITED' && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

### 3. Always Validate Input

```typescript
function validateBrief(brief: string): string | null {
  if (!brief || brief.trim().length === 0) {
    return 'Brief cannot be empty';
  }
  if (brief.length < 10) {
    return 'Brief too short (minimum 10 characters)';
  }
  if (brief.length > 500) {
    return 'Brief too long (maximum 500 characters)';
  }
  return null; // Valid
}
```

### 4. Log Request IDs for Debugging

```typescript
const requestId = response.headers.get('X-Request-Id');
console.log('Request ID:', requestId);
// Include in error reports for support
```

### 5. Respect CSV Privacy Guarantees

**Never** assume you'll get raw CSV row data. Only use aggregates from the response.

---

## Complete React Example

See [examples/react-sse-client/](../examples/react-sse-client/) for a full working demo.

**Features**:
- SSE streaming with fixture fallback
- File upload (CSV, TXT, PDF)
- Draft graph visualization
- Evidence pack download
- Error handling
- Rate limit display

---

## Support

For issues or questions:
- GitHub: [Talchain/olumi-assistants-service](https://github.com/Talchain/olumi-assistants-service)
- Documentation: [Docs/](../Docs/)

---

**Last Updated**: 2025-11-07
**Service Version**: 1.2.0

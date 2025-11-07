# Examples - Olumi Assistants Service

This directory contains example implementations and demo clients for the Olumi Assistants Service.

---

## Available Examples

### [react-sse-client](./react-sse-client/)

A minimal React + TypeScript demo client (~300 LOC) showcasing all key integration features:

- ✅ **SSE Streaming**: Real-time draft updates via `/assist/draft-graph/stream`
- ✅ **File Upload**: Base64 encoding for TXT, MD, CSV, PDF attachments
- ✅ **Document Grounding**: Toggle grounding feature on/off
- ✅ **Draft Visualization**: Display nodes and edges with provenance
- ✅ **Evidence Pack Download**: Export redacted provenance JSON
- ✅ **Error Handling**: Graceful handling of BAD_INPUT, RATE_LIMITED, INTERNAL errors
- ✅ **Cancel Support**: Abort in-flight requests

**Tech Stack**: Vite + React 18 + TypeScript

---

## Quick Start

### 1. Install Dependencies

From the repository root:

```bash
# Install root dependencies
pnpm install

# Install example dependencies
cd examples/react-sse-client
pnpm install
```

### 2. Configure Environment

Create `.env` from the example:

```bash
cd examples/react-sse-client
cp .env.example .env
```

Edit `.env` to point to your service instance:

```env
# Local development
VITE_BASE_URL=http://localhost:3101

# Or production
# VITE_BASE_URL=https://olumi-assistants-service.onrender.com
```

### 3. Start the Service

In a separate terminal, start the assistants service:

```bash
# From repository root
pnpm dev
```

### 4. Run the Demo Client

```bash
# From repository root
pnpm demo:client

# Or from examples/react-sse-client
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Using the Demo Client

### Basic Usage

1. **Enter a brief**: Type a strategic question (e.g., "Should we expand into EU markets?")
2. **Click "Generate Draft (SSE)"**: Starts SSE streaming
3. **Watch real-time updates**: See DRAFTING → fixture → COMPLETE stages
4. **View the graph**: Nodes and edges displayed with metadata

### Uploading Files

1. **Click "Choose Files"**: Select TXT, MD, CSV, or PDF files
2. **Enable grounding**: Ensure "Enable document grounding" is checked
3. **Generate draft**: Files will be base64-encoded and sent with the request
4. **View grounded edges**: Edges will show provenance with document quotes

### CSV Privacy

When uploading CSV files, the service **never returns raw row data**. Only aggregates (trends, sums, counts) are exposed.

**Example CSV**:
```csv
name,revenue
Alice,10000
Bob,15000
```

**Response**: You'll see "revenue trends" but never "Alice" or "Bob" in the output.

### Downloading Evidence Pack

1. **Generate a draft**: Complete a draft request (JSON or SSE)
2. **Click "Download Evidence Pack"**: Exports redacted provenance JSON
3. **File downloaded**: `evidence_{request_id}.json` with:
   - Graph structure (nodes, edges)
   - Rationales (edge explanations)
   - Grounding sources (≤100 char quotes, no PII)
   - Request metadata (version, confidence, cost)

---

## Project Structure

```
examples/
├── README.md                          # This file
└── react-sse-client/
    ├── package.json                   # Dependencies
    ├── vite.config.ts                 # Vite configuration
    ├── tsconfig.json                  # TypeScript configuration
    ├── index.html                     # HTML entry point
    ├── .env.example                   # Environment variables template
    └── src/
        ├── main.tsx                   # React entry point
        └── App.tsx                    # Main application (~300 LOC)
```

---

## npm Scripts

From the **repository root**:

```bash
# Start demo client dev server
pnpm demo:client

# Build demo client for production
pnpm demo:build
```

From **examples/react-sse-client**:

```bash
# Start dev server (port 5173)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

---

## Key Features Demonstrated

### 1. SSE Streaming

```typescript
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

// Parse SSE events
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  // Parse "event: stage\ndata: {...}\n\n" format
}
```

### 2. File Upload with Base64 Encoding

```typescript
const file = files[0];
const content = await file.text();
const base64 = btoa(content);

const body = {
  brief: 'Analyze this data',
  attachments: [{ id: 'att_0', kind: 'document', name: file.name }],
  attachment_payloads: { att_0: base64 },
};
```

### 3. Evidence Pack Download

```typescript
const response = await fetch(
  `${BASE_URL}/assist/draft-graph/${requestId}/evidence`
);
const evidencePack = await response.json();

// Download as JSON file
const blob = new Blob([JSON.stringify(evidencePack, null, 2)], {
  type: 'application/json',
});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `evidence_${requestId}.json`;
a.click();
```

### 4. Error Handling

```typescript
if (event.payload.schema === 'error.v1') {
  switch (event.payload.code) {
    case 'BAD_INPUT':
      console.error('Invalid input:', event.payload.message);
      break;
    case 'RATE_LIMITED':
      console.warn('Rate limited, retry later');
      break;
    case 'INTERNAL':
      console.error('Server error:', event.payload.request_id);
      break;
  }
}
```

---

## Rate Limiting

The demo client respects the service's rate limits:

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| `/assist/draft-graph` (JSON) | 120 RPM | 1 minute |
| `/assist/draft-graph/stream` (SSE) | **20 RPM** | 1 minute |

**Best Practice**: Use the dedicated `/stream` endpoint for production SSE streaming (20 RPM limit).

---

## CORS Configuration

The service allows requests from:
- `https://olumi.app`
- `https://app.olumi.app`
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (React dev server)

If running on a different port, update the service's `CORS_ALLOWED_ORIGINS` environment variable.

---

## Troubleshooting

### Demo client won't start

```bash
# Ensure dependencies are installed
cd examples/react-sse-client
pnpm install

# Check Vite version
pnpm list vite
```

### "fetch failed" errors

```bash
# Ensure the service is running
pnpm dev

# Check service health
curl http://localhost:3101/healthz
```

### CORS errors in browser

```bash
# Verify CORS configuration
curl -i -X OPTIONS http://localhost:3101/assist/draft-graph \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST"
```

### Rate limit errors

```bash
# Check rate limit headers
curl -i -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"test"}'

# Look for:
# X-RateLimit-Limit: 120
# X-RateLimit-Remaining: 119
```

---

## Adding New Examples

To add a new example:

1. Create a new directory: `examples/my-example/`
2. Add `package.json` with dependencies
3. Update `examples/package.json` workspaces:
   ```json
   {
     "workspaces": [
       "react-sse-client",
       "my-example"
     ]
   }
   ```
4. Document usage in `examples/README.md`

---

## Related Documentation

- **[FRONTEND_INTEGRATION.md](../Docs/FRONTEND_INTEGRATION.md)**: Complete integration guide with API reference
- **[openapi.yaml](../openapi.yaml)**: OpenAPI specification
- **[PROD_VALIDATION_v1.1.1.md](../Docs/PROD_VALIDATION_v1.1.1.md)**: Production validation report

---

## Support

For issues or questions:
- GitHub: [Talchain/olumi-assistants-service](https://github.com/Talchain/olumi-assistants-service)
- Documentation: [Docs/](../Docs/)

---

**Last Updated**: 2025-11-07
**Service Version**: 1.2.0

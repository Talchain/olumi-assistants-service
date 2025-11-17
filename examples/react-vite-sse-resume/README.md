# SSE Live Resume Example - React + Vite

A production-ready example demonstrating SSE (Server-Sent Events) streaming with automatic resume and reconnection using React and Vite.

## Features

✅ **SSE Live Streaming** - Real-time event updates via Server-Sent Events
✅ **Automatic Reconnection** - Exponential backoff retry logic (1.5s → 4s → 8s...)
✅ **Resume Token Management** - Seamless continuation from last received event
✅ **Visual Feedback** - Connection status, retry attempts, and error states
✅ **Type-safe** - Full TypeScript support
✅ **Modern UI** - Clean, responsive design with dark mode

## Prerequisites

- Node.js 18+
- pnpm (or npm)
- Olumi Assistants Service running locally (default: http://localhost:3101)

## Installation

From the repository root:

```bash
pnpm install
```

## Development

1. Start the Olumi Assistants Service:

```bash
# From repository root
pnpm dev
```

2. In a new terminal, start the example:

```bash
cd examples/react-vite-sse-resume
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000)

## Usage

### Basic Streaming

1. Enter a decision brief (e.g., "Should we expand into EU markets?")
2. Click **Start Stream**
3. Watch events arrive in real-time

### Testing Resume

1. Start a stream
2. Click **Disconnect (Test Resume)** mid-stream
3. Watch automatic reconnection with exponential backoff
4. Stream continues from last received event using resume token

### Understanding the UI

- **🟢 Connected** - Active SSE stream
- **🔴 Disconnected** - Stream ended or not started
- **⚠️ Reconnecting** - Automatic retry in progress
- **Resume Token** - HMAC-signed token for resuming stream
- **Current Stage** - Latest stage event received

## Architecture

### `useSseStream` Hook

Custom React hook managing SSE lifecycle:

```tsx
const {
  events,           // Array of received events
  isConnected,      // Connection state
  isReconnecting,   // Retry state
  error,            // Error message
  reconnectAttempts,// Retry count
  resumeToken,      // Resume token from server
  startStream,      // Start new stream
  disconnect,       // Manual disconnect
  reset,            // Reset all state
} = useSseStream({
  baseUrl: '',
  maxRetries: 5,
  initialBackoffMs: 1500,
  maxBackoffMs: 30000,
});
```

### Reconnection Strategy

- **Initial delay**: 1.5 seconds
- **Exponential backoff**: Doubles each attempt (1.5s → 3s → 6s → 12s...)
- **Max backoff**: 30 seconds
- **Max retries**: 5 attempts
- **Resume mode**: Uses `X-Resume-Token` header with `mode=live`

## Event Types

### `resume`
Resume token for reconnection:
```json
{
  "type": "resume",
  "data": {
    "token": "eyJ...abc"
  }
}
```

### `stage`
Graph drafting progress:
```json
{
  "type": "stage",
  "data": {
    "stage": "DRAFTING",
    "payload": { "graph": {...} }
  }
}
```

### `heartbeat`
Keep-alive ping (displayed without data)

## Configuration

### Custom Base URL

```tsx
const stream = useSseStream({
  baseUrl: 'https://api.example.com',
});
```

### Retry Settings

```tsx
const stream = useSseStream({
  maxRetries: 10,
  initialBackoffMs: 2000,
  maxBackoffMs: 60000,
});
```

## Production Deployment

### Environment Variables

```bash
# Vite will replace import.meta.env.VITE_API_BASE_URL
VITE_API_BASE_URL=https://api.production.com
```

### Build

```bash
pnpm build
```

Output in `dist/` directory.

### Preview

```bash
pnpm preview
```

## Troubleshooting

### No events received

- Verify Olumi Assistants Service is running on port 3101
- Check browser console for CORS errors
- Ensure `brief` is not empty

### Reconnection fails

- Check network connectivity
- Verify resume token is valid (15-minute TTL)
- Increase `maxRetries` if needed

### Events lost on resume

- Resume tokens capture state up to last buffered event
- SSE buffer max: 256 events or 1.5MB
- Late resume may fall back to final snapshot

## Related Documentation

- [SSE Resume API](../../../Docs/SSE-RESUME-API.md)
- [v1.9 Implementation](../../../Docs/v1.9-sse-live-implementation.md)
- [SDK Documentation](../../sdk/typescript/README.md)

## License

MIT

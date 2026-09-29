# SSE Live Resume Example - Next.js App Router + SSR

Next.js 15 App Router example demonstrating SSE streaming with server-side HMAC authentication and automatic resume.

## Features

✅ **Next.js 15 App Router** - Modern Next.js with Server Components and Actions
✅ **Server-side HMAC** - Secure token generation without exposing secrets to client
✅ **SSE Streaming** - Real-time updates with built-in resume support
✅ **Type-safe** - Full TypeScript with strict mode
✅ **Production-ready** - Error boundaries, loading states, and retry logic

## Quick Start

```bash
cd examples/nextjs-ssr-sse-resume
pnpm install
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001)

## Architecture

- `app/page.tsx` - Client component with SSE handling
- `app/actions.ts` - Server actions for API calls
- `lib/stream.ts` - SSE client utilities

## Environment Variables

```bash
OLUMI_API_KEY=your-api-key
OLUMI_BASE_URL=http://localhost:3101
```

## License

MIT

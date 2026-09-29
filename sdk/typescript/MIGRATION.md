# CEE SDK Migration Guide

## Node.js 18+ Requirement

Starting with version 1.12.0, the `@olumi/assistants-sdk` requires Node.js 18 or later for the `CeeClient` class. This is due to the use of native `fetch` and `AbortController` APIs.

### Why Node 18+?

- **Native fetch**: Node 18+ includes native `fetch` support, eliminating the need for polyfills
- **AbortController**: Proper timeout handling with native `AbortController`
- **Performance**: Better performance without external dependencies
- **Security**: Fewer dependencies = smaller attack surface

### Migration Options

#### Option 1: Upgrade to Node 18+ (Recommended)

The simplest solution is to upgrade your Node.js version:

```bash
# Using nvm
nvm install 18
nvm use 18

# Or install directly
# macOS (Homebrew)
brew install node@18

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Option 2: Use a Fetch Polyfill (Node 16)

If you must remain on Node 16, you can use a fetch polyfill:

```bash
npm install node-fetch@3
```

Then, before importing the SDK, add the polyfill:

```typescript
// polyfill.ts - import this before any SDK imports
import fetch, { Headers, Request, Response } from 'node-fetch';

if (!globalThis.fetch) {
  // @ts-expect-error - Adding fetch to global
  globalThis.fetch = fetch;
  // @ts-expect-error - Adding Headers to global
  globalThis.Headers = Headers;
  // @ts-expect-error - Adding Request to global
  globalThis.Request = Request;
  // @ts-expect-error - Adding Response to global
  globalThis.Response = Response;
}

// AbortController is available in Node 16+, but if needed:
// npm install abort-controller
// import AbortController from 'abort-controller';
// globalThis.AbortController = AbortController;
```

Then in your main file:

```typescript
// Import polyfill first
import './polyfill.js';

// Then import SDK
import { createCeeClient } from '@olumi/assistants-sdk';

const client = createCeeClient({ apiKey: process.env.CEE_API_KEY! });
```

#### Option 3: Use the Existing CEEClient (Legacy)

The existing `createCEEClient` function remains available and does not require Node 18+. However, it uses a different API pattern:

```typescript
import { createCEEClient } from '@olumi/assistants-sdk';

// Legacy client - works on Node 16+
const client = createCEEClient({
  apiKey: process.env.CEE_API_KEY!,
  baseUrl: 'https://olumi-assistants-service.onrender.com',
});

// Use draftGraph, options, biasCheck, etc.
const result = await client.draftGraph({ brief: 'Your decision brief' });
```

### Breaking Changes in CeeClient

The new `CeeClient` class has the following differences from `CEEClient`:

| Feature | CEEClient (Legacy) | CeeClient (New) |
|---------|-------------------|-----------------|
| Auth Header | `X-Olumi-Assist-Key` | `X-API-Key` |
| Node Version | 14+ | 18+ |
| Main Method | `draftGraph()`, `options()` | `review()` |
| Response Shape | Various | `CeeReviewResponse` |
| Error Class | `OlumiAPIError` | `CeeClientError` |

### Version Support Matrix

| SDK Version | Node 14 | Node 16 | Node 18 | Node 20+ |
|-------------|---------|---------|---------|----------|
| < 1.12.0    | ✅ | ✅ | ✅ | ✅ |
| >= 1.12.0 (CEEClient) | ✅ | ✅ | ✅ | ✅ |
| >= 1.12.0 (CeeClient) | ❌ | ⚠️ polyfill | ✅ | ✅ |

### Getting Help

If you encounter issues migrating:

1. Check our [GitHub Issues](https://github.com/Talchain/olumi-assistants-service/issues)
2. Review the [SDK documentation](./README.md)
3. Contact support at support@olumi.ai

### Timeline

- **v1.12.0**: CeeClient introduced (Node 18+ required)
- **v2.0.0** (planned): CEEClient deprecated (6 months notice)
- **v3.0.0** (planned): CEEClient removed

We recommend upgrading to Node 18+ at your earliest convenience to ensure compatibility with future SDK releases.

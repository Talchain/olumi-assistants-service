# E2E Testing with Playwright

## Overview

This directory contains end-to-end tests for SSE (Server-Sent Events) streaming functionality using Playwright. These tests validate real browser behavior that cannot be captured by unit or integration tests.

## Setup

### Prerequisites

```bash
# Install dependencies
pnpm install

# Install Playwright browsers
pnpm exec playwright install chromium
```

### Running Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests with UI (for debugging)
pnpm test:e2e:ui

# Run tests in headed mode (see browser)
pnpm test:e2e:headed

# View test report
pnpm test:e2e:report
```

## Test Architecture

### Why fetch() instead of EventSource?

The browser's native `EventSource` API doesn't support custom headers, but our API requires the `X-Olumi-Assist-Key` header for authentication. Therefore, we use `fetch()` with manual SSE stream parsing.

### Test Server Configuration

The tests automatically start a test server using the configuration in `playwright.config.ts`:

- **Local development**: Uses `pnpm dev` (TypeScript via tsx)
- **CI environment**: Uses `pnpm build && pnpm start` (compiled JavaScript)

Environment variables for test server:
```bash
NODE_ENV=test
LLM_PROVIDER=fixtures
ASSIST_API_KEYS=e2e-test-key
CEE_DIAGNOSTICS_KEY_IDS=e2e-test-key
GROUNDING_ENABLED=false
CRITIQUE_ENABLED=false
CLARIFIER_ENABLED=false
```

## Test Coverage

### SSE Streaming Tests (`sse-streaming.spec.ts`)

1. **Happy Path**
   - ✅ Successful SSE stream connection
   - ✅ Multiple messages in workflow
   - ✅ Manual connection close

2. **Error Handling**
   - ✅ Authentication failure (401)
   - ✅ Invalid endpoint (404)

3. **Edge Cases**
   - ✅ Rapid successive connections
   - ✅ Large response streams
   - ✅ Connection abortion

## Known Issues & Next Steps

### Current Status

The E2E test infrastructure is in place:
- ✅ Playwright installed and configured
- ✅ Test server startup script created
- ✅ 8 comprehensive test scenarios written
- ✅ fetch()-based SSE client implemented
- ⚠️  Some tests may timeout due to server startup timing

### To Fix

1. **Server Startup Timing**: The test server may take longer than the configured timeout to start. Consider:
   - Increasing webServer.timeout in `playwright.config.ts`
   - Adding health check retries
   - Using a pre-warmed server for local development

2. **Test Stability**: Some tests may be flaky due to:
   - Fixture responses being too fast/slow
   - Network timing issues
   - SSE event parsing edge cases

3. **CI Integration**: Add E2E tests to CI pipeline (`.github/workflows/e2e.yml`)

### Future Enhancements

- [ ] Add network interruption tests (requires Playwright's network throttling)
- [ ] Add SSE resume functionality tests
- [ ] Test across multiple browsers (Firefox, WebKit)
- [ ] Add visual regression testing for error states
- [ ] Performance testing for long-running streams

## Debugging

### View Test Traces

When tests fail, Playwright captures traces that can be viewed:

```bash
pnpm exec playwright show-trace test-results/<test-name>/trace.zip
```

### Common Issues

**Issue: "Error: Timed out waiting 60000ms from config.webServer"**

Solution: The test server failed to start. Check:
1. Port 3000 is not in use: `lsof -ti:3000`
2. Dependencies are installed: `pnpm install`
3. App builds successfully: `pnpm build`

**Issue: "Error: connect ECONNREFUSED"**

Solution: The server started but isn't responding. Check:
1. Server logs for errors
2. Environment variables are set correctly
3. LLM_PROVIDER=fixtures is set

## Contributing

When adding new E2E tests:

1. Use descriptive test names
2. Clean up connections (call `window.closeSSE()`)
3. Use reasonable timeouts (5s for connection, 30s for events)
4. Test both success and failure scenarios
5. Add comments explaining test rationale

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Project API Documentation](../../Docs/api/README.md)

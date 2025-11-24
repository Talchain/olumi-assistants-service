/**
 * E2E Tests: SSE Streaming
 *
 * Tests real browser behavior for Server-Sent Events streaming,
 * including network interruptions, reconnection, and error handling.
 *
 * Note: We use fetch() instead of EventSource because EventSource doesn't support
 * custom headers, and our API requires X-Olumi-Assist-Key header for authentication.
 */

import { test, expect } from "@playwright/test";

// Helper to create a test page with SSE client using fetch
async function createSSETestPage(page: any) {
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SSE Test Client</title>
    </head>
    <body>
      <div id="status">Initializing...</div>
      <div id="messages"></div>
      <div id="error"></div>
      <script>
        window.events = [];
        window.errors = [];
        window.abortController = null;

        // Manual SSE parser using fetch (to support custom headers)
        window.connectSSE = async function(url, apiKey, brief) {
          try {
            window.abortController = new AbortController();

            const headers = {
              'Accept': 'text/event-stream',
              'Content-Type': 'application/json'
            };

            if (apiKey) {
              headers['X-Olumi-Assist-Key'] = apiKey;
            }

            const response = await fetch(url, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify({ brief: brief || 'Test brief for E2E testing' }),
              signal: window.abortController.signal
            });

            if (!response.ok) {
              throw new Error(\`HTTP error! status: \${response.status}\`);
            }

            document.getElementById('status').textContent = 'Connected';

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\\n\\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  window.events.push(line);
                  const msg = document.createElement('div');
                  msg.className = 'message';
                  msg.textContent = line;
                  document.getElementById('messages').appendChild(msg);
                }
              }
            }

            document.getElementById('status').textContent = 'Complete';
          } catch (error) {
            window.errors.push(error);
            document.getElementById('status').textContent = 'Error';
            document.getElementById('error').textContent = error.message || 'Connection error occurred';
          }
        };

        window.closeSSE = function() {
          if (window.abortController) {
            window.abortController.abort();
            document.getElementById('status').textContent = 'Closed';
          }
        };

        window.getEventCount = function() {
          return window.events.length;
        };

        window.getLastEvent = function() {
          return window.events[window.events.length - 1];
        };
      </script>
    </body>
    </html>
  `);
}

test.describe("SSE Streaming E2E Tests", () => {
  const API_KEY = "e2e-test-key";

  test("should successfully stream draft-graph response", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;
    const brief = "Create a simple hello world app";

    // Start SSE connection in background
    page.evaluate(async ([url, key, b]) => {
      window.connectSSE(url, key, b);
    }, [streamUrl, API_KEY, brief]);

    // Wait for connection
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Wait for at least one message
    await page.waitForFunction(() => window.getEventCount() > 0, { timeout: 30000 });

    const eventCount = await page.evaluate(() => window.getEventCount());
    expect(eventCount).toBeGreaterThan(0);

    // Verify we received valid SSE data
    const lastEvent = await page.evaluate(() => window.getLastEvent());
    expect(lastEvent).toBeTruthy();

    // Clean up
    await page.evaluate(() => window.closeSSE());
  });

  test("should handle authentication failure (401)", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Try to connect without API key
    page.evaluate(async ([url]) => {
      window.connectSSE(url, null);
    }, [streamUrl]);

    // Should fail to connect
    await expect(page.locator("#status")).toHaveText("Error", { timeout: 5000 });

    const errorCount = await page.evaluate(() => window.errors.length);
    expect(errorCount).toBeGreaterThan(0);
  });

  test("should handle invalid endpoint (404)", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/invalid-endpoint/stream`;

    // Try to connect to non-existent endpoint
    page.evaluate(async ([url, key]) => {
      window.connectSSE(url, key);
    }, [streamUrl, API_KEY]);

    // Should fail with error
    await expect(page.locator("#status")).toHaveText("Error", { timeout: 5000 });
  });

  test("should handle manual connection close", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Start connection in background
    page.evaluate(async ([url, key]) => {
      window.connectSSE(url, key, 'test');
    }, [streamUrl, API_KEY]);

    // Wait for connection
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Wait a bit for stream to start
    await page.waitForTimeout(1000);

    // Close connection manually
    await page.evaluate(() => window.closeSSE());

    // Verify closed
    await expect(page.locator("#status")).toHaveText("Closed");
  });

  test("should stream complete workflow with multiple messages", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Start SSE connection in background
    page.evaluate(async ([url, key]) => {
      window.connectSSE(url, key, 'Build a REST API with authentication');
    }, [streamUrl, API_KEY]);

    // Wait for connection
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Wait for multiple messages (workflow should have several steps)
    await page.waitForFunction(
      () => window.getEventCount() >= 3,
      { timeout: 45000 } // Longer timeout for multi-step workflow
    );

    const eventCount = await page.evaluate(() => window.getEventCount());
    expect(eventCount).toBeGreaterThanOrEqual(3);

    // Verify messages are being received
    const messages = await page.locator(".message").count();
    expect(messages).toBeGreaterThanOrEqual(3);

    // Clean up
    await page.evaluate(() => window.closeSSE());
  });

  test("should handle rapid successive connections", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Make multiple connections in quick succession
    for (let i = 0; i < 3; i++) {
      // Close previous connection
      await page.evaluate(() => {
        if (window.abortController) {
          window.abortController.abort();
        }
      });

      // Start new connection in background
      page.evaluate(async ([url, key, i]) => {
        window.connectSSE(url, key, `test${i}`);
      }, [streamUrl, API_KEY, i]);

      // Brief wait between connections
      await page.waitForTimeout(500);
    }

    // Verify final connection is active
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Clean up
    await page.evaluate(() => window.closeSSE());
  });
});

test.describe("SSE Streaming - Edge Cases", () => {
  const API_KEY = "e2e-test-key";

  test("should handle large response stream", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Start SSE connection in background
    page.evaluate(async ([url, key]) => {
      window.connectSSE(url, key, 'test large response');
    }, [streamUrl, API_KEY]);

    // Should connect successfully
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Wait for at least one event
    await page.waitForFunction(() => window.getEventCount() > 0, { timeout: 30000 });

    // Clean up
    await page.evaluate(() => window.closeSSE());
  });

  test("should handle connection abortion", async ({ page, baseURL }) => {
    await createSSETestPage(page);

    const streamUrl = `${baseURL}/assist/draft-graph/stream`;

    // Start connection in background
    page.evaluate(async ([url, key]) => {
      window.connectSSE(url, key, 'test abortion');
    }, [streamUrl, API_KEY]);

    // Wait for connection
    await expect(page.locator("#status")).toHaveText("Connected", { timeout: 5000 });

    // Abort immediately
    await page.evaluate(() => window.closeSSE());

    // Verify abortion
    await expect(page.locator("#status")).toHaveText("Closed");
  });
});

/**
 * Shared HTTP request helper for staging tests.
 *
 * Handles:
 *  - Rate-limit spacing (via rateLimitGuard)
 *  - 429 retry with server-specified backoff
 *  - Network error diagnostics
 */

import { rateLimitGuard } from "./rate-limit-guard.js";

export async function makeAuthedRequest(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  maxRetries = 2,
): Promise<{ status: number; body: unknown; elapsed_ms: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimitGuard();
    const t0 = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `fetch() network error — server unreachable:\n` +
        `  url: ${url}\n` +
        `  error: ${err instanceof Error ? err.message : String(err)}\n` +
        `  request_snippet: ${JSON.stringify(body).slice(0, 300)}`,
      );
    }

    // Retry on 429 with server-specified backoff
    if (response.status === 429 && attempt < maxRetries) {
      const retryBody = await response.json().catch(() => null) as Record<string, unknown> | null;
      const retryAfter = (retryBody?.details as Record<string, unknown>)?.retry_after_seconds;
      const waitMs = (typeof retryAfter === "number" ? retryAfter : 30) * 1000;
      console.warn(
        `[makeAuthedRequest] 429 rate-limited, retrying in ${waitMs / 1000}s ` +
        `(attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    const elapsed_ms = Date.now() - t0;
    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body (rare — leave as null)
    }
    return { status: response.status, body: responseBody, elapsed_ms };
  }
  throw new Error("makeAuthedRequest: exhausted retries");
}

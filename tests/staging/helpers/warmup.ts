/**
 * Staging server warmup helper.
 *
 * Polls GET /healthz until the server responds 200, with retries.
 * Handles Render cold-start delays (typically 30-60s).
 *
 * Usage: `await ensureServerWarmed(baseUrl)` in beforeAll().
 */

const MAX_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 5_000;

/**
 * Wait until the staging server's /healthz endpoint returns 200.
 * Throws after MAX_ATTEMPTS * POLL_INTERVAL_MS (~60s) if still unreachable.
 */
export async function ensureServerWarmed(baseUrl: string): Promise<void> {
  const healthUrl = `${baseUrl}/healthz`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // Network error or timeout — retry
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    `Staging server did not respond to GET ${healthUrl} after ${MAX_ATTEMPTS} attempts ` +
    `(${(MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s). Is the server deployed?`,
  );
}

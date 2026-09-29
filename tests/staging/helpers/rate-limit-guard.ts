/**
 * Staging rate-limit guard.
 *
 * Enforces a minimum interval between HTTP requests to stay within
 * the staging RATE_LIMIT_MAX token bucket (default 120 req/min).
 *
 * Usage: call `await rateLimitGuard()` before each staging request.
 * The guard is shared across all tests in a single vitest worker process.
 */

const MIN_INTERVAL_MS = parseInt(process.env.STAGING_REQUEST_INTERVAL_MS ?? "3000", 10);

let lastRequestTime = 0;

/**
 * Wait if needed to maintain minimum spacing between staging requests.
 * Returns immediately if enough time has elapsed since the last call.
 */
export async function rateLimitGuard(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS && lastRequestTime > 0) {
    const wait = MIN_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();
}

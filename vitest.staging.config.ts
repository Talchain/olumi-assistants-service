import { defineConfig } from "vitest/config";

/**
 * Vitest config for staging smoke tests.
 * Used by `pnpm test:staging`.
 *
 * Deliberately excludes nothing in tests/staging/ — the suite gates itself
 * via RUN_STAGING_SMOKE=1 and PLOT_BASE_URL checks.
 */
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/staging/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
    // Run test files sequentially to avoid saturating the staging rate limiter.
    // Each file's internal rateLimitGuard() handles per-request spacing, but
    // parallel files would exceed the global CEE_RATE_LIMIT bucket.
    fileParallelism: false,
  },
});

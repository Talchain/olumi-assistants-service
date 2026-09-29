/**
 * Playwright E2E Test Configuration
 *
 * Tests SSE streaming scenarios, network interruptions, and client-side behavior
 * that can't be captured by unit/integration tests.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",

  // Maximum time one test can run
  timeout: 60 * 1000, // 60 seconds (SSE streams can be long)

  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI, // Fail CI if test.only() left in code
  retries: process.env.CI ? 2 : 0, // Retry flaky tests in CI
  workers: process.env.CI ? 1 : undefined, // Run serially in CI to avoid port conflicts

  // Reporter configuration
  reporter: process.env.CI
    ? [["html"], ["github"]]
    : [["html"], ["list"]],

  // Shared settings for all tests
  use: {
    // Base URL for tests (can be overridden via TEST_BASE_URL env var)
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",

    // Collect trace on failure for debugging
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "retain-on-failure",
  },

  // Test projects for different browsers
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment to test on Firefox and WebKit
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
  ],

  // Development server configuration
  webServer: process.env.TEST_BASE_URL
    ? undefined // Use external server if TEST_BASE_URL is set
    : {
        command: "bash scripts/start-test-server.sh",
        url: "http://localhost:3000/healthz",
        reuseExistingServer: !process.env.CI, // Reuse server in dev, always start fresh in CI
        timeout: 60 * 1000, // 60 seconds to start
      },
});

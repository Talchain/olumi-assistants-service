import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Global setup file to reset config cache before each test
    setupFiles: ["./vitest.setup.ts"],
    // Exclude live LLM tests from default run
    // Run these with: pnpm test:live
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,playwright}.config.*",
      // Exclude recovered test files
      "_recovered/**",
      // Exclude E2E tests (run with pnpm test:e2e using Playwright)
      "tests/e2e/**",
      // Exclude live LLM tests (require LIVE_LLM=1 and API key)
      "tests/integration/adversarial.test.ts",
      // Exclude golden-path e2e (real APIs, run on demand with RUN_E2E_GOLDEN=1)
      "tests/integration/golden-path-e2e.test.ts",
      "tests/validation/golden-briefs-runner.test.ts",
      // Exclude benchmark tests (run with pnpm benchmark:stability)
      "tests/benchmarks/**",
      // Exclude staging smoke tests (require RUN_STAGING_SMOKE=1 and PLOT_BASE_URL)
      // Run with: pnpm test:staging
      "tests/staging/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/tests/**",
        "**/*.test.ts",
        "**/*.config.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});

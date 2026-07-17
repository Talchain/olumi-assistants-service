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
      // Exclude Claude Code git worktrees (used for isolated task branches)
      ".claude/worktrees/**",
      // Exclude recovered test files
      "_recovered/**",
      // Exclude E2E tests (run with pnpm test:e2e using Playwright)
      "tests/e2e/**",
      // Exclude live LLM tests (require LIVE_LLM=1 and API key)
      "tests/integration/adversarial.test.ts",
      // Exclude benchmark tests (run with pnpm benchmark:stability)
      "tests/benchmarks/**",
      // Exclude staging smoke tests (require RUN_STAGING_SMOKE=1 and PLOT_BASE_URL)
      // Run with: pnpm test:staging
      "tests/staging/**",
      // Exclude the standalone graph-evaluator tool package (ROADMAP 1.148 C8).
      // It has its OWN package.json/deps (npm, e.g. gray-matter) and its own
      // vitest runner; the repo-root install never provides its deps, so
      // collecting it here throws ERR_MODULE_NOT_FOUND. Mirrors
      // STANDALONE_TOOL_EXCLUSIONS in vitest.required.config.ts (package
      // boundary, deliberately NOT broadened to tools/** — other tools' tests
      // resolve against product deps and keep running here). NOTE: this
      // removes the tool's only (accidental) CI execution via the advisory
      // Full Test Suite; a dedicated job that npm-installs inside the tool is
      // a separate decision (Phase 2 wiring per the required-config note).
      "tools/graph-evaluator/**",
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
      // COVERAGE RATCHET — these are FLOORS at the measured baseline
      // (2026-07-17: lines 82.29 / functions 85.28 / statements 81.24 /
      // branches 73.66, CI run 29550676845). Raise them as coverage improves;
      // NEVER lower without reviewer sign-off. The old 90/90/90/85 aspiration
      // made the "Full Test Suite (advisory)" job permanently red even with
      // all 1,257 test files green = a broken alarm (ROADMAP 1.148 class).
      // Floors sit ~0.5-0.8pt under the baseline as flake margin.
      thresholds: {
        lines: 81.5,
        functions: 84.5,
        statements: 80.5,
        branches: 73,
      },
    },
  },
});

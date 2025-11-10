import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude live LLM tests from default run
    // Run these with: pnpm test:live
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      // Exclude recovered test files
      "_recovered/**",
      // Exclude live LLM tests (require LIVE_LLM=1 and API key)
      "tests/integration/adversarial.test.ts",
      "tests/validation/golden-briefs-runner.test.ts",
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

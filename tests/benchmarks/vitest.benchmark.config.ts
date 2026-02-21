import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

/**
 * Vitest config for benchmark tests only.
 * Used by `pnpm benchmark:stability` and direct benchmark invocations.
 */
export default defineConfig({
  test: {
    root: projectRoot,
    setupFiles: [resolve(projectRoot, "vitest.setup.ts")],
    include: ["tests/benchmarks/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
    testTimeout: 300_000, // 5 min for LLM-based runs
  },
});

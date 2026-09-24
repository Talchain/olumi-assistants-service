/**
 * Focused config for the deterministic Agent-reply scorer and the paired scoring (Task D) ONLY.
 * No server boot, no network. Run with:
 *   npx vitest run --config tools/agent-reply-eval/vitest.scorer.config.ts
 * Long timeouts: imports alone take ~100 s under the current machine load.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    root,
    include: ['tools/agent-reply-eval/__tests__/**/*.test.ts', 'tools/agent-reply-eval/paired/__tests__/score-paired.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});

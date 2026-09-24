/**
 * Focused config for the paired capture harness ONLY. Never collected by the repo's own
 * configs' broad runs being needed: run with
 *   npx vitest run tools/agent-reply-eval/paired/capture-shapes.test.ts --config tools/agent-reply-eval/paired/vitest.config.ts
 * Long timeouts: imports alone take ~100 s under the current machine load.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

export default defineConfig({
  test: {
    root,
    include: ['tools/agent-reply-eval/paired/capture-shapes.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 900_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});

import { defineConfig } from 'vitest/config';

/**
 * Self-test config for the conversation harness — run from the repo root:
 *   pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 *
 * Deliberately NOT wired into test:required (this PR): the self-test files are
 * named *.harness-test.ts, which the root default include glob
 * (**\/*.{test,spec}.*) does not match, so the required gate cannot collect
 * them by accident (tools/** IS collected there — see the graph-evaluator
 * exact-path exclusion in vitest.required.config.ts).
 */
export default defineConfig({
  test: {
    include: ['tools/conversation-harness/__tests__/**/*.harness-test.ts'],
  },
});

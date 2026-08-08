import { defineConfig } from "vitest/config";

/**
 * ROADMAP 2.909 — the pre-DDL collab N-suite's DEDICATED runner
 * (`pnpm test:collab-nsuite`).
 *
 * The suite (tests/collab-nsuite-pending/*.ntest.ts) is authored RED-FIRST
 * against seams that do not exist yet, so it is deliberately NOT collected by
 * the required gate (the `.ntest.ts` suffix matches no other config's include).
 * The required gate still SEES the suite via
 * tests/meta/collab-n-suite-pending.test.ts, which fails loud the moment any
 * seam lands — see tests/collab-nsuite-pending/README.md.
 */
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/collab-nsuite-pending/**/*.ntest.ts"],
  },
});

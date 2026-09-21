import { defineConfig } from "vitest/config";
import {
  REQUIRED_GATE_INTEGRATION_EXCLUSIONS,
  SERVER_BOOT_HOOK_TIMEOUT_MS,
  STANDALONE_TOOL_EXCLUSIONS,
} from "./vitest.shared.js";

/**
 * Vitest config for the REQUIRED CI gate (`Lint, TypeCheck, Unit Tests` →
 * `pnpm test:required`).
 *
 * It runs the deterministic, in-process test suite that is currently GREEN, so
 * the required merge gate is trustworthy. Three groups are excluded here.
 * Nothing is deleted, weakened, or silently skipped. Groups 1 and 3 are
 * product tests that still run, and fail visibly, in NON-required advisory
 * jobs. Group 2 is a different case — a package-boundary exclusion, not a
 * product test (see its note below).
 *
 *   1. REQUIRED_GATE_INTEGRATION_EXCLUSIONS (vitest.shared.ts) — the FINITE
 *      list of external-dependent integration files (real Supabase/Postgres,
 *      live LLM, deployed staging HTTP). Exact paths only, self-checking in
 *      both directions via tests/meta/required-gate-integration-exclusions
 *      .test.ts. The other ~155 tests/integration files are in-process
 *      `app.inject()` tests and RUN IN THIS GATE (they previously did not:
 *      the old `tests/integration/**` category glob let PR #539 report
 *      "0 failed" while breaking two of them). The excluded files still run
 *      in `Integration Tests (advisory)` / `Full Test Suite (advisory)`
 *      when their env is present.
 *
 *   2. STANDALONE_TOOL_EXCLUSIONS (vitest.shared.ts) — `tools/graph-evaluator/**`, a
 *      self-contained tool package with its own deps and runner. Excluded from
 *      the product gate as a package boundary, NOT because it is red. Its proper
 *      home is the tool's own runner (`cd tools/graph-evaluator && npm test`);
 *      it has no first-class CI job until the Phase 2 wiring lands. (As of
 *      ROADMAP 1.148 C8 the default config carries the same package-boundary
 *      exclusion, so the advisory Full Test Suite no longer incidentally
 *      collects it either — the tool currently has NO CI execution at all
 *      until the dedicated job lands.)
 *
 *   3. REQUIRED_GATE_RED_EXCLUSIONS below — the in-process test files that are
 *      currently red (captured from CI run 26750031968). They run in
 *      `Full Test Suite (advisory)`.
 *
 * This is a TEMPORARY required-gate exclusion list, NOT a claim these tests are
 * fixed. Remove a path only once it is genuinely green again; the list should
 * shrink toward empty, at which point this config can be retired.
 *
 * Do NOT add PR #224 files to this list (they pass and must stay in the gate):
 *   - tests/contract/v5-golden-path-acceptance.test.ts
 *   - src/orchestrator-v5/__tests__/build-turn-context.test.ts
 *   - src/orchestrator-v5/coaching/__tests__/decision-context.test.ts
 *   - src/orchestrator-v5/tools/handlers/__tests__/integration-precondition-fail-chip.test.ts
 *
 * This file deliberately does NOT `import "./vitest.config"` (extensionless
 * relative imports fail node16 module resolution and would trip the
 * full-typecheck ratchet; importing the built config object would also couple
 * the gate to the advisory config's coverage block). The shared exclusion
 * fragments it CAN safely consume live in vitest.shared.ts, imported with an
 * explicit `.js` extension, which node16 accepts — STANDALONE_TOOL_EXCLUSIONS
 * comes from there, single-sourced with vitest.config.ts. RESIDUAL MIRROR:
 * BASE_EXCLUDE / setupFiles below still mirror vitest.config.ts — keep them
 * in sync if the base config changes.
 */

// Mirrors vitest.config.ts `test.exclude` (keep in sync).
const BASE_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,playwright}.config.*",
  ".claude/worktrees/**",
  "_recovered/**",
  "tests/e2e/**",
  "tests/integration/adversarial.test.ts",
  "tests/benchmarks/**",
  "tests/staging/**",
];

// External-dependent integration files — a FINITE exact-path list
// (REQUIRED_GATE_INTEGRATION_EXCLUSIONS, vitest.shared.ts), NOT a category
// glob. Enforced equal to the mechanically-derived external-dependent set by
// tests/meta/required-gate-integration-exclusions.test.ts, which runs in this
// gate: stale entry → RED, unlisted new external-dependent test → RED.

// Standalone tool package (`tools/graph-evaluator`, a package boundary):
// STANDALONE_TOOL_EXCLUSIONS is imported from vitest.shared.ts — single-
// sourced with vitest.config.ts, full rationale on the constant. (It
// supersedes the earlier exact-path `adapters.test.ts` carve-out and its
// "do NOT broaden to tools/**" note, per the Phase 1 follow-up decision.)

// Currently-red in-process test files — exact paths only (no globs).
// 2026-07-07 (lane CEE-W4 test hygiene): five files fixed green and
// restored to the gate per the "remove a path only once it is genuinely
// green again" rule above: d1-followup-fixes,
// turn-executor-explain-precondition-chip, turn-executor-recoverable-handler,
// chip-click-dispatch, chip-click-dispatch-analysis-ready.
// 2026-07-09 (ROADMAP 1.13 test-baseline-hygiene lane): 15 of 16 entries
// fixed/verified green and removed —
//   - 3 already green (verified stale exclusions, no code change needed):
//     turn-executor-failure-responses, turn-executor-handler, request-timing.
//   - 12 fixed (RED→GREEN, test-only):
//     endpoint-feature-matrix + phase2-numeric-format (stale copy/fixture
//     vs the now-canonical STALENESS_PREFIX and the deliberate near-tie
//     qualitative-margin carve-out in composeWhatWouldFlipFallback);
//     cee.progressive-degradation, cee.unified-pipeline.checkpoint,
//     cee.unified-pipeline.graceful-degradation,
//     cee.unified-pipeline.orchestrator, pipeline-shape,
//     threshold-sweep-orchestrator-resilience, unified-pipeline.signal-fix
//     (stale config mock missing `features.diagnosticTraceEnabled`, added
//     to runUnifiedPipeline after these mocks were written);
//     edit-graph-no-op-recovery (stale expected copy — PR #218 reworded
//     the vague-edit text to drop a schema-vocabulary leak, test wasn't
//     updated); explain-leader-stale-chips + what-changed-denial (fixture
//     wording now collides with the canonical FORBIDDEN_USER_FACING_PHRASES
//     list, which the replay harness's coreAssertions() checks before the
//     specific detector under test — reworded/re-asserted, not weakened).
//   - 1 stayed excluded, now fixed and removed (2026-07-09, CEE micro-lane
//     claude-cee/artefact-appendix-casing): artefact-detector passed on
//     macOS (case-insensitive filesystem) but was a GENUINE product bug on
//     Linux (CI/Render): loadArtefactAppendix() (src/orchestrator/pipeline/
//     phase3-llm/prompt-assembler.ts) resolved `prompts/artefact_appendix.txt`
//     (lowercase) but the file lives at `Prompts/artefact_appendix.txt`
//     (capital P — matches the sibling `Prompts/v40.txt` convention). On a
//     case-sensitive filesystem this ENOENTed and loadArtefactAppendix()
//     silently returned null (its own catch-and-warn design), so
//     injectArtefactAppendix:true was a silent no-op in production on
//     Render. Fixed with the literal corrected to `Prompts` and a new
//     filesystem-independent regression test added (compares the literal
//     path segment against the true on-disk directory entry via
//     fs.readdirSync, so it fails on macOS too if the casing ever drifts
//     again — not just on case-sensitive CI).
const REQUIRED_GATE_RED_EXCLUSIONS: string[] = [
  // NOTE: tool tests (incl. the former exact-path `tools/graph-evaluator/tests/
  // adapters.test.ts` collection error) are handled by the package-level
  // STANDALONE_TOOL_EXCLUSIONS (vitest.shared.ts), not enumerated here.
];

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // ROADMAP 2.157 / 2.753 — vitest's UNDOCUMENTED default is 10s, which a
    // full Fastify boot blows under worker CPU starvation, SKIPPING the file's
    // tests silently. Set once here instead of hand-passed per hook (it had
    // reached 3 of 81 server-booting files). Rationale on the constant.
    hookTimeout: SERVER_BOOT_HOOK_TIMEOUT_MS,
    exclude: [
      ...BASE_EXCLUDE,
      ...REQUIRED_GATE_INTEGRATION_EXCLUSIONS,
      ...STANDALONE_TOOL_EXCLUSIONS,
      ...REQUIRED_GATE_RED_EXCLUSIONS,
    ],
  },
});

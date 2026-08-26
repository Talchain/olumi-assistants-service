/**
 * Shared vitest exclusion fragments — the SINGLE source of truth consumed by
 * BOTH vitest.config.ts (default / advisory Full Test Suite) and
 * vitest.required.config.ts (the required CI gate).
 *
 * Extracted because the tools/graph-evaluator exclusion was hand-duplicated
 * in the two configs, each side carrying a "mirrors … keep in sync" comment —
 * and a hand-maintained mirror WILL drift silently (derive, don't mirror).
 *
 * Node16 note: both consumers import this with an explicit `.js` extension
 * (`./vitest.shared.js`), which node16 module resolution requires and tsc maps
 * back to this .ts file — so the full-typecheck ratchet stays clean.
 */

/**
 * Standalone tool package — `tools/graph-evaluator` is a self-contained
 * evaluator with its OWN package.json, dependencies (e.g. gray-matter) and
 * vitest runner. Its tests must not be collected by the repo-root configs,
 * which install only product deps — collecting it throws ERR_MODULE_NOT_FOUND
 * on the tool-local imports. Excluded as a package boundary, NOT because it
 * is red; deliberately NOT broadened to tools/** (other tools' tests resolve
 * against product deps and keep running). NOTE: with both root configs
 * excluding it, the tool has NO repo-root CI execution at all until the
 * dedicated graph-evaluator job lands (Phase 2 wiring); it still runs in the
 * tool's own runner (`cd tools/graph-evaluator && npm test`).
 */
export const STANDALONE_TOOL_EXCLUSIONS = ["tools/graph-evaluator/**"];

/**
 * ROADMAP 2.157 / 2.753 — the GLOBAL `hookTimeout` for both configs.
 *
 * ⚠ WHY THIS MOVED HERE (2026-08-14, test-reliability lane). This constant was
 * introduced by ROADMAP 2.157 in `tests/helpers/env-setup.ts` and passed BY HAND
 * as the second argument to `beforeAll` in the three files whose boots had been
 * seen to blow vitest's UNDOCUMENTED 10 s default `hookTimeout`
 * (`admin.models`, `admin.prompts.verify`, `auth.hmac-fallback`).
 *
 * That is a hand-maintained mirror, and it drifted exactly as this file's own
 * header warns. Derived at `ae0b4af8`: **81 test files boot the full Fastify
 * server in a hook (`await build()`), and 78 of them carry NO explicit boot
 * timeout** — so 96% of the surface the 2.157 fix was written for never
 * received it. `tests/integration/admin.routes.test.ts` is the instance that
 * came due: it fails 3/3 deterministically under load with
 * `Hook timed out in 10000ms`, then `Cannot read properties of undefined
 * (reading 'close')` in `afterAll`, and reports `18 skipped` — the same
 * SILENT-SKIP signature 2.157 documents, which reads as a collection failure
 * rather than a timeout.
 *
 * Setting it once, globally, is the derive-don't-mirror fix: a new
 * server-booting test cannot forget it, because there is nothing to remember.
 * The VALUE is unchanged and not re-argued here — 60 s is the figure 2.157
 * already sized to the measured boot (~3–4 s isolated, ~15× headroom), chosen
 * to be far above any starved-but-progressing boot while staying loud on a
 * genuine hang. `SERVER_BOOT_HOOK_TIMEOUT_MS` is re-exported from
 * `tests/helpers/env-setup.ts` so the three existing call sites keep working
 * and there is exactly ONE definition.
 */
export const SERVER_BOOT_HOOK_TIMEOUT_MS = 60_000;

/**
 * External-service env vars — a `tests/integration` file that READS any of
 * these (literal `process.env.<VAR>` token) is classified as
 * external-dependent and belongs in REQUIRED_GATE_INTEGRATION_EXCLUSIONS
 * below. Everything else under tests/integration is an in-process
 * `app.inject()` test and runs in the required gate.
 *
 * The classification is enforced mechanically by
 * tests/meta/required-gate-integration-exclusions.test.ts, which derives the
 * set from the file contents and asserts it EQUALS the list below — so a new
 * external-dependent test cannot silently join the exclusion, and a stale
 * entry cannot silently linger (derive, don't mirror; fail loud on drift).
 */
export const EXTERNAL_SERVICE_ENV_VARS = [
  // Real Supabase/Postgres (staging DB) —
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROMPTS_POSTGRES_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  // Real Redis —
  "REDIS_URL",
  // Live paid LLM calls —
  "LIVE_LLM",
  "ANTHROPIC_API_KEY",
  // Live HTTP against the deployed staging CEE —
  "CEE_BASE_URL",
  "CEE_API_KEY",
  // Explicit opt-in flags for the staging/e2e suites —
  "RUN_CANARY",
  "RUN_E2E_GOLDEN_V2",
  "RUN_WAVE0_STAGING",
];

/**
 * The FINITE list of external-dependent integration test files excluded from
 * the required merge gate (`vitest.required.config.ts`). These files talk to
 * real Supabase/Postgres, a live LLM, or the deployed staging service when
 * their env is present, and every one of them self-gates (skipIf / runIf /
 * `envReady ? describe : describe.skip` / `{ skip: ... }` options / top-of-
 * file throw) so they skip cleanly where the env is absent.
 *
 * This replaces the former `tests/integration/**` CATEGORY exclusion, which
 * structurally excluded all ~175 integration files — including ~155
 * in-process `app.inject()` tests — from the required gate (PR #539 truthfully
 * reported "0 failed" while breaking two of them). A category glob is the
 * hand-maintained-mirror pattern at its worst; this list is exact paths only
 * and is self-checking in BOTH directions via
 * tests/meta/required-gate-integration-exclusions.test.ts:
 *   - an entry that no longer exists, no longer reads external-service env,
 *     or no longer self-gates → required gate goes RED (stale entry);
 *   - a new tests/integration file that reads external-service env without
 *     being listed here → required gate goes RED (silent join).
 *
 * NOTE: adversarial.test.ts is also excluded at base level by both configs
 * (it throws without LIVE_LLM=1; run via `pnpm test:live`). It is listed here
 * too so this list is the complete external-dependent manifest.
 */
export const REQUIRED_GATE_INTEGRATION_EXCLUSIONS = [
  "tests/integration/adversarial.test.ts",
  "tests/integration/prompts.repository.test.ts",
  "tests/integration/slice-b-commit-failure.test.ts",
  "tests/integration/slice-b-concurrent-writes.test.ts",
  "tests/integration/slice-b-invalidation.test.ts",
  "tests/integration/slice-b-persistence.test.ts",
  "tests/integration/slice-b-preflight.test.ts",
  "tests/integration/slice-b-rpc-grant.test.ts",
  "tests/integration/slice-c2-atomic-persistence.test.ts",
  "tests/integration/slice-c2-concurrent-analysis.test.ts",
  "tests/integration/slice-c2-run-analysis-real.test.ts",
  "tests/integration/slice-c2-stale-read.test.ts",
  "tests/integration/v5-brief-text-persistence.test.ts",
  "tests/integration/v5-explain-then-yes-flagship.test.ts",
  "tests/integration/v5-pending-actions-commit.test.ts",
  "tests/integration/v5-pending-actions-rpc.test.ts",
  "tests/integration/v5-short-confirm-resume.test.ts",
];

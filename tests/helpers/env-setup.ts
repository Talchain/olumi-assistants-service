/**
 * Environment Setup Helpers for Tests
 *
 * Utilities for managing environment variables in test setup/teardown.
 * Used to ensure test isolation and consistent config behavior.
 */

/**
 * Clean BASE_URL from environment for test isolation.
 * Call in beforeAll() or beforeEach() before building the server.
 *
 * This prevents config validation failures when BASE_URL is set to
 * an invalid value in the shell environment. The config system validates
 * BASE_URL as a proper URL if provided.
 *
 * @example
 * beforeAll(async () => {
 *   vi.stubEnv("LLM_PROVIDER", "fixtures");
 *   cleanBaseUrl();
 *   app = await build();
 * });
 */
export function cleanBaseUrl(): void {
  delete process.env.BASE_URL;
}

/**
 * ROADMAP 2.157 — explicit timeout for `beforeAll` hooks that boot the FULL
 * Fastify server (`build()` + `app.ready()`), passed as the hook's second
 * argument.
 *
 * Why it exists (found the expensive way): vitest's UNDOCUMENTED default
 * `hookTimeout` is 10 s, and when a contended parallel run pushed a server
 * boot past it the suite's tests SKIPPED SILENTLY — a run showed
 * `219 skipped` with green-looking output and manufactured a false "HEAD
 * broke it" verdict (`admin.models` / `admin.prompts.verify` /
 * `auth.hmac-fallback`, all 44/44 green in isolation). A flaky required gate
 * teaches lanes to distrust it.
 *
 * SIZED TO THE MEASURED BOOT, not to retries (the 2.157 rule: fix at cause):
 * isolated whole-suite runs measure ~4.5–5.5 s incl. transform, so the boot
 * itself is ~3–4 s; the flake fired only under worker CPU starvation (house
 * trap 6), which multiplies wall time without meaning a hang. 60 s ≈ 15× the
 * isolated measurement — far above any starved-but-progressing boot, still
 * loud on a genuine hang.
 */
export const SERVER_BOOT_HOOK_TIMEOUT_MS = 60_000;

/**
 * Clean common CEE feature flag env vars.
 * Used in beforeEach() for tests that manipulate CEE flags per-test.
 *
 * @example
 * beforeEach(() => {
 *   vi.resetModules();
 *   cleanCEEFlags();
 *   // Now set only the flags you need for this test
 *   vi.stubEnv("CEE_CAUSAL_VALIDATION_ENABLED", "true");
 * });
 */
export function cleanCEEFlags(): void {
  delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
  delete process.env.CEE_BIAS_STRUCTURAL_ENABLED;
  delete process.env.CEE_DRAFT_ARCHETYPES_ENABLED;
  delete process.env.CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED;
  delete process.env.CEE_REFINEMENT_ENABLED;
}

/**
 * Clean all test-relevant env vars for complete isolation.
 * Combines cleanBaseUrl() and cleanCEEFlags().
 *
 * @example
 * beforeEach(() => {
 *   vi.resetModules();
 *   cleanTestEnv();
 *   // Fresh environment for each test
 * });
 */
export function cleanTestEnv(): void {
  cleanBaseUrl();
  cleanCEEFlags();
}

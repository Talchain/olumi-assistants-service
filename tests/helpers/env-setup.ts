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

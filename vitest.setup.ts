/**
 * Vitest Global Setup
 *
 * This setup file runs before each test file to ensure proper test isolation.
 * The main purpose is to reset the config cache before each test, allowing
 * tests to use vi.stubEnv() to set environment variables that will be
 * picked up by the config module.
 */

import { beforeAll, beforeEach } from "vitest";
import { _resetConfigCache } from "./src/config/index.js";

// Enable legacy Pipeline B for existing tests that exercise it.
// The flag test (legacy-pipeline-flag.test.ts) uses vi.stubEnv() to test the real default.
process.env.CEE_LEGACY_PIPELINE_ENABLED = "true";

/**
 * Reset config cache before ALL tests in a file
 *
 * This ensures that:
 * 1. Config is not cached from module import time
 * 2. vi.stubEnv() calls made at file level (outside describe) are respected
 * 3. Integration tests that use beforeAll can set env vars before build()
 */
beforeAll(() => {
  _resetConfigCache();
});

/**
 * Reset config cache before each test
 *
 * This ensures that:
 * 1. Each test starts with a fresh config state
 * 2. vi.stubEnv() calls made in beforeEach/it blocks are respected
 * 3. Config changes in one test don't leak to others
 */
beforeEach(() => {
  _resetConfigCache();
});

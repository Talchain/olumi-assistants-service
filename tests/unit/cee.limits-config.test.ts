import { describe, it, expect, afterEach, vi } from "vitest";

import {
  CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM,
  resolveCeeRateLimit,
} from "../../src/cee/config/limits.js";

const TEST_ENV_VAR = "CEE_TEST_RATE_LIMIT_RPM";

describe("resolveCeeRateLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the default rate limit when env is unset", () => {
    // Do not stub TEST_ENV_VAR; it should be treated as unset
    const value = resolveCeeRateLimit(TEST_ENV_VAR);
    expect(value).toBe(CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM);
  });

  it("parses a valid positive integer from the environment", () => {
    vi.stubEnv(TEST_ENV_VAR, "17");

    const value = resolveCeeRateLimit(TEST_ENV_VAR);
    expect(value).toBe(17);
  });

  it("treats zero as invalid and falls back to the default", () => {
    vi.stubEnv(TEST_ENV_VAR, "0");
    expect(resolveCeeRateLimit(TEST_ENV_VAR)).toBe(CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM);
  });

  it("falls back to the default for non-numeric or NaN-like values", () => {
    vi.stubEnv(TEST_ENV_VAR, "not-a-number");
    expect(resolveCeeRateLimit(TEST_ENV_VAR)).toBe(CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM);

    vi.stubEnv(TEST_ENV_VAR, "NaN");
    expect(resolveCeeRateLimit(TEST_ENV_VAR)).toBe(CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM);
  });
});

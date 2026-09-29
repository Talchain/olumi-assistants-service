import { describe, it, expect } from "vitest";

import {
  formatCeeServiceHealthPretty,
  shouldExitNonZeroForSummary,
} from "../../scripts/cee-diagnostics.js";
import type { CeeServiceHealthSummary } from "../../scripts/cee-health-snapshot.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("cee-diagnostics-cli helpers", () => {
  it("formats a compact summary without leaking secrets", () => {
    const SECRET = "CEE_DIAGNOSTICS_SECRET_SHOULD_NOT_APPEAR";

    const summary: CeeServiceHealthSummary = {
      service: "assistants",
      version: "1.11.0",
      provider: "fixtures",
      model: "cee-fixtures-model",
      limits_source: "config",
      diagnostics_enabled: true,
      feature_flags: {
        grounding: true,
        critique: true,
        clarifier: true,
      },
      cee_config: {
        draft_graph: { feature_version: "draft-model-1.0.0", rate_limit_rpm: 5 },
        options: { feature_version: "options-1.0.0", rate_limit_rpm: 5 },
      },
      recent_error_counts: {
        total: 3,
        by_capability: {
          cee_draft_graph: 1,
          cee_options: 2,
        },
        by_status: {
          error: 2,
          limited: 1,
        },
        by_error_code: {
          CEE_INTERNAL_ERROR: 1,
          CEE_RATE_LIMIT: 1,
          CEE_VALIDATION_FAILED: 1,
        },
      },
    };

    const pretty = formatCeeServiceHealthPretty(summary);

    expect(typeof pretty).toBe("string");
    expect(pretty.length).toBeGreaterThan(0);
    expect(pretty).toContain("Service: assistants");
    expect(pretty).toContain("CEE capabilities");
    expect(pretty).toContain("Recent errors");

    // Ensure summary object does not contain obvious secret-like keys or banned substrings
    expectNoSecretLikeKeys(summary);
    expectNoBannedSubstrings(summary as unknown as Record<string, unknown>);

    const serialized = JSON.stringify(summary).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });

  it("flags severe error volume based on a configurable threshold", () => {
    const baseSummary: CeeServiceHealthSummary = {
      service: "assistants",
      version: "1.11.0",
      provider: "fixtures",
      model: "cee-fixtures-model",
      limits_source: "config",
      diagnostics_enabled: true,
      feature_flags: {},
      cee_config: {},
      recent_error_counts: {
        total: 0,
        by_capability: {},
        by_status: {},
        by_error_code: {},
      },
    };

    expect(shouldExitNonZeroForSummary(baseSummary, { errorThreshold: 10 })).toBe(false);

    const withSomeErrors: CeeServiceHealthSummary = {
      ...baseSummary,
      recent_error_counts: {
        total: 5,
        by_capability: { cee_draft_graph: 5 },
        by_status: { error: 5 },
        by_error_code: { CEE_INTERNAL_ERROR: 5 },
      },
    };

    expect(shouldExitNonZeroForSummary(withSomeErrors, { errorThreshold: 10 })).toBe(false);

    const withManyErrors: CeeServiceHealthSummary = {
      ...baseSummary,
      recent_error_counts: {
        total: 25,
        by_capability: { cee_draft_graph: 20, cee_options: 5 },
        by_status: { error: 25 },
        by_error_code: { CEE_INTERNAL_ERROR: 25 },
      },
    };

    expect(shouldExitNonZeroForSummary(withManyErrors, { errorThreshold: 10 })).toBe(true);
  });
});

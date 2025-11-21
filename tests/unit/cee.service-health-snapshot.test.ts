import { describe, it, expect } from "vitest";

import { summarizeServiceHealth } from "../../scripts/cee-health-snapshot.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("summarizeServiceHealth", () => {
  it("summarises /healthz and /diagnostics into a compact metadata-only view", () => {
    const SECRET = "SERVICE_HEALTH_SECRET_DO_NOT_LEAK";

    const healthz = {
      ok: true,
      service: "assistants",
      version: "1.11.0",
      provider: "openai",
      model: "gpt-4o-mini",
      limits_source: "config",
      feature_flags: {
        grounding: true,
        critique: true,
        clarifier: true,
      },
      cee: {
        diagnostics_enabled: true,
        config: {
          draft_graph: {
            feature_version: "draft-model-1.0.0",
            rate_limit_rpm: 5,
          },
          options: {
            feature_version: "options-1.0.0",
            rate_limit_rpm: 5,
          },
        },
      },
    };

    const diagnostics = {
      service: "assistants",
      version: "1.11.0",
      timestamp: "2025-11-21T23:59:59.000Z",
      feature_flags: {
        grounding: true,
        critique: true,
        clarifier: true,
      },
      cee: {
        provider: "openai",
        model: "gpt-4o-mini",
        config: healthz.cee.config,
        recent_errors: [
          {
            request_id: "cee-req-1",
            capability: "cee_draft_graph",
            status: "error",
            error_code: "CEE_INTERNAL_ERROR",
            http_status: 500,
            latency_ms: 123,
            any_truncated: false,
            has_validation_issues: false,
            timestamp: "2025-11-21T23:59:00.000Z",
          },
          {
            request_id: "cee-req-2",
            capability: "cee_options",
            status: "limited",
            error_code: "CEE_RATE_LIMIT",
            http_status: 429,
            latency_ms: 45,
            any_truncated: false,
            has_validation_issues: false,
            timestamp: "2025-11-21T23:59:10.000Z",
          },
          {
            request_id: "cee-req-3",
            capability: "cee_options",
            status: "error",
            error_code: "CEE_VALIDATION_FAILED",
            http_status: 400,
            latency_ms: 50,
            any_truncated: false,
            has_validation_issues: true,
            timestamp: "2025-11-21T23:59:20.000Z",
          },
        ],
      },
    };

    const summary = summarizeServiceHealth(healthz, diagnostics);

    expect(summary.service).toBe("assistants");
    expect(summary.version).toBe("1.11.0");
    expect(summary.provider).toBe("openai");
    expect(summary.model).toBe("gpt-4o-mini");
    expect(summary.limits_source).toBe("config");

    expect(summary.diagnostics_enabled).toBe(true);

    expect(summary.feature_flags).toEqual({
      grounding: true,
      critique: true,
      clarifier: true,
    });

    expect(summary.cee_config.draft_graph).toEqual({
      feature_version: "draft-model-1.0.0",
      rate_limit_rpm: 5,
    });
    expect(summary.cee_config.options).toEqual({
      feature_version: "options-1.0.0",
      rate_limit_rpm: 5,
    });

    expect(summary.recent_error_counts).toBeDefined();
    expect(summary.recent_error_counts?.total).toBe(3);
    expect(summary.recent_error_counts?.by_capability).toEqual({
      cee_draft_graph: 1,
      cee_options: 2,
    });
    expect(summary.recent_error_counts?.by_status).toEqual({
      error: 2,
      limited: 1,
    });
    expect(summary.recent_error_counts?.by_error_code).toEqual({
      CEE_INTERNAL_ERROR: 1,
      CEE_RATE_LIMIT: 1,
      CEE_VALIDATION_FAILED: 1,
    });

    // Ensure no obviously secret-like keys or banned substrings leak
    expectNoSecretLikeKeys(summary);
    expectNoBannedSubstrings(summary as unknown as Record<string, unknown>);

    const serialized = JSON.stringify(summary).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});

/**
 * CEE v1 Telemetry Integration Tests
 *
 * Verifies that /assist/v1/draft-graph emits structured, privacy-safe
 * telemetry events for CEE lifecycle: requested, succeeded, failed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { TelemetrySink } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

function expectRequestedShape(data: Record<string, any>) {
  const keys = Object.keys(data).sort();
  expect(keys).toEqual(
    expect.arrayContaining([
      "request_id",
      "feature",
      "has_seed",
      "has_archetype_hint",
      "api_key_present",
    ])
  );
  expect(typeof data.request_id).toBe("string");
  expect(data.feature).toBe("cee_draft_graph");
  expect(typeof data.has_seed).toBe("boolean");
  expect(typeof data.has_archetype_hint).toBe("boolean");
  expect(typeof data.api_key_present).toBe("boolean");
}

function expectSucceededShape(data: Record<string, any>) {
  const keys = Object.keys(data).sort();
  expect(keys).toEqual(
    [
      "request_id",
      "latency_ms",
      "quality_overall",
      "graph_nodes",
      "graph_edges",
      "has_validation_issues",
      "any_truncated",
      "draft_warning_count",
      "uncertain_node_count",
      "simplification_applied",
      "cost_usd",
      "engine_provider",
      "engine_model",
      // ⭐ THE DUPLICATE-OPTION-LABEL FREQUENCY INSTRUMENT. Emitted at
      // draft-emission time WITH its denominator, because a bare numerator
      // cannot produce a rate. No label is emitted — option labels are
      // user-authored content.
      "option_label_collision_count",
      "option_count",
    ].sort()
  );
  expect(typeof data.request_id).toBe("string");
  expect(typeof data.latency_ms).toBe("number");
  expect(typeof data.quality_overall).toBe("number");
  expect(typeof data.graph_nodes).toBe("number");
  expect(typeof data.graph_edges).toBe("number");
  expect(typeof data.has_validation_issues).toBe("boolean");
  expect(typeof data.any_truncated).toBe("boolean");
  expect(typeof data.draft_warning_count).toBe("number");
  expect(typeof data.uncertain_node_count).toBe("number");
  expect(typeof data.simplification_applied).toBe("boolean");
  expect(typeof data.cost_usd).toBe("number");
  expect(typeof data.engine_provider).toBe("string");
  expect(typeof data.engine_model).toBe("string");
  expect(typeof data.option_label_collision_count).toBe("number");
  expect(typeof data.option_count).toBe("number");
}

function expectFailedShape(data: Record<string, any>) {
  const keys = Object.keys(data).sort();
  expect(keys).toEqual(
    expect.arrayContaining(["request_id", "latency_ms", "error_code", "http_status"])
  );
  expect(typeof data.request_id).toBe("string");
  expect(typeof data.latency_ms).toBe("number");
  expect(typeof data.error_code).toBe("string");
  expect(typeof data.http_status).toBe("number");
}

function expectNoFreeTextFields(data: Record<string, any>) {
  // Guard against accidental inclusion of brief/LLM text in telemetry
  expect("brief" in data).toBe(false);
  expect("message" in data).toBe(false);
  expect("graph" in data).toBe(false);

  // Also guard against obviously unsafe substrings in any string value
  expectNoBannedSubstrings(data);
}

describe("CEE v1 telemetry for /assist/v1/draft-graph", () => {
  let app: FastifyInstance;
  let telemetrySink: TelemetrySink;

  beforeAll(async () => {
    vi.stubEnv(
      "ASSIST_API_KEYS",
      [
        "cee-key-1",
        "cee-key-2",
        "cee-key-3",
        "cee-key-limit",
        "cee-telemetry-success",
        "cee-telemetry-validation",
        "cee-telemetry-limit",
        "cee-telemetry-explain-success",
        "cee-telemetry-explain-validation",
        "cee-telemetry-explain-limit",
        "cee-telemetry-evidence-success",
        "cee-telemetry-evidence-validation",
        "cee-telemetry-evidence-limit",
        "cee-telemetry-bias-success",
        "cee-telemetry-bias-validation",
        "cee-telemetry-bias-limit",
        "cee-telemetry-sensitivity-success",
        "cee-telemetry-sensitivity-validation",
        "cee-telemetry-sensitivity-limit",
        "cee-telemetry-options-success",
        "cee-telemetry-options-validation",
        "cee-telemetry-options-limit",
        "cee-telemetry-team-success",
        "cee-telemetry-team-validation",
        "cee-telemetry-team-limit",
      ].join(",")
    );
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-telemetry-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "2");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    telemetrySink = new TelemetrySink();
    await telemetrySink.install();
    telemetrySink.clear();
  });

  afterEach(() => {
    telemetrySink.uninstall();
  });

  it("emits requested and succeeded events for successful CEE draft request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-success" },
      payload: {
        brief: "A sufficiently long decision brief for CEE telemetry success tests.",
      },
    });

    expect(res.statusCode).toBe(200);
    const requestId = res.headers["x-cee-request-id"] as string;
    expect(typeof requestId).toBe("string");

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    expectRequestedShape(requested[0].data);
    expectSucceededShape(succeeded[0].data);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(succeeded[0].data);
  });

  it("emits requested and failed events for validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(0);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for rate-limit failure", async () => {
    const payload = {
      brief: "A sufficiently long decision brief for CEE telemetry rate limit tests.",
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-limit" } as const;

    // First two requests within limit
    const first = await app.inject({ method: "POST", url: "/assist/v1/draft-graph", headers, payload });
    const second = await app.inject({ method: "POST", url: "/assist/v1/draft-graph", headers, payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    // Third request should hit per-feature rate limit
    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeDraftGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(0);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });
});

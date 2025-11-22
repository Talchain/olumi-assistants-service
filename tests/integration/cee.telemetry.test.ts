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

function expectRequestedShape(data: Record<string, any>) {
  const keys = Object.keys(data).sort();
  expect(keys).toEqual(
    ["request_id", "feature", "has_seed", "has_archetype_hint", "api_key_present"].sort()
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
      "cost_usd",
      "engine_provider",
      "engine_model",
    ].sort()
  );
  expect(typeof data.request_id).toBe("string");
  expect(typeof data.latency_ms).toBe("number");
  expect(typeof data.quality_overall).toBe("number");
  expect(typeof data.graph_nodes).toBe("number");
  expect(typeof data.graph_edges).toBe("number");
  expect(typeof data.has_validation_issues).toBe("boolean");
  expect(typeof data.any_truncated).toBe("boolean");
   expect(typeof data.cost_usd).toBe("number");
  expect(typeof data.engine_provider).toBe("string");
  expect(typeof data.engine_model).toBe("string");
}

function expectFailedShape(data: Record<string, any>) {
  const keys = Object.keys(data).sort();
  expect(keys).toEqual(["request_id", "latency_ms", "error_code", "http_status"].sort());
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
    vi.stubEnv("CEE_EXPLAIN_FEATURE_VERSION", "explain-model-telemetry-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-helper-telemetry-test");
    vi.stubEnv("CEE_BIAS_CHECK_FEATURE_VERSION", "bias-check-telemetry-test");
    vi.stubEnv("CEE_SENSITIVITY_COACH_FEATURE_VERSION", "sensitivity-coach-telemetry-test");
    vi.stubEnv("CEE_OPTIONS_FEATURE_VERSION", "options-telemetry-test");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_FEATURE_VERSION", "team-perspectives-telemetry-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_EXPLAIN_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_BIAS_CHECK_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_OPTIONS_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM", "2");

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

  it("emits requested and succeeded events for successful CEE team-perspectives request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-team-success" },
      payload: {
        perspectives: [
          { id: "p1", stance: "for", confidence: 0.8 },
          { id: "p2", stance: "against", confidence: 0.7 },
          { id: "p3", stance: "neutral" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "participant_count", "api_key_present"].sort(),
    );
    expect(requestedData.feature).toBe("cee_team_perspectives");
    expect(typeof requestedData.participant_count).toBe("number");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "participant_count",
        "disagreement_score",
        "has_validation_issues",
      ].sort(),
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.participant_count).toBe("number");
    expect(typeof succeededData.disagreement_score).toBe("number");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for team-perspectives validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-team-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for team-perspectives rate-limit failure", async () => {
    const payload = {
      perspectives: [
        { id: "p1", stance: "for" },
        { id: "p2", stance: "against" },
      ],
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-team-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeTeamPerspectivesFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and succeeded events for successful CEE sensitivity-coach request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-sensitivity-success" },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal", kind: "goal", label: "Increase revenue" },
            { id: "driver", kind: "option", label: "Premium pricing" },
          ],
          edges: [],
          meta: { roots: ["goal"], leaves: ["driver"], suggested_positions: {}, source: "assistant" },
        },
        inference: {
          summary: "Telemetry explain summary",
          explain: {
            top_drivers: [
              { node_id: "driver", description: "Premium pricing", contribution: 0.9 },
            ],
          },
          seed: "seed-telemetry-sensitivity",
          response_hash: "hash-telemetry-sensitivity",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "has_inference", "api_key_present"].sort(),
    );
    expect(requestedData.feature).toBe("cee_sensitivity_coach");
    expect(typeof requestedData.has_inference).toBe("boolean");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "driver_count",
        "any_truncated",
        "has_validation_issues",
      ].sort(),
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.driver_count).toBe("number");
    expect(typeof succeededData.any_truncated).toBe("boolean");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for sensitivity-coach validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-sensitivity-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for sensitivity-coach rate-limit failure", async () => {
    const payload = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal", kind: "goal", label: "Increase revenue" },
          { id: "driver", kind: "option", label: "Premium pricing" },
        ],
        edges: [],
        meta: { roots: ["goal"], leaves: ["driver"], suggested_positions: {}, source: "assistant" },
      },
      inference: {
        summary: "Telemetry explain summary",
        explain: {
          top_drivers: [
            { node_id: "driver", description: "Premium pricing", contribution: 0.9 },
          ],
        },
        seed: "seed-telemetry-sensitivity-limit",
        response_hash: "hash-telemetry-sensitivity-limit",
      },
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-sensitivity-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/sensitivity-coach",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeSensitivityCoachFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and succeeded events for successful CEE options request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-options-success" },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal", kind: "goal", label: "Increase revenue" },
            { id: "opt_a", kind: "option", label: "Premium pricing" },
          ],
          edges: [],
          meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
        },
        archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      },
    });

    expect(res.statusCode).toBe(200);
    const _body = res.json() as any;
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "has_archetype", "api_key_present"].sort()
    );
    expect(requestedData.feature).toBe("cee_options");
    expect(typeof requestedData.has_archetype).toBe("boolean");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "option_count",
        "any_truncated",
        "has_validation_issues",
      ].sort()
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.option_count).toBe("number");
    expect(typeof succeededData.any_truncated).toBe("boolean");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for options validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-options-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for options rate-limit failure", async () => {
    const payload = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal", kind: "goal", label: "Increase revenue" },
          { id: "opt_a", kind: "option", label: "Premium pricing" },
        ],
        edges: [],
        meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
      },
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-options-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/options",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeOptionsFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and succeeded events for successful CEE bias-check request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-bias-success" },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal", kind: "goal", label: "Increase revenue" },
            { id: "opt_a", kind: "option", label: "Premium pricing" },
          ],
          edges: [],
          meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
        },
        archetype: { decision_type: "pricing_decision", match: "exact", confidence: 0.9 },
      },
    });

    expect(res.statusCode).toBe(200);
    const _body = res.json() as any;
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "has_archetype", "api_key_present"].sort()
    );
    expect(requestedData.feature).toBe("cee_bias_check");
    expect(typeof requestedData.has_archetype).toBe("boolean");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "bias_count",
        "any_truncated",
        "has_validation_issues",
      ].sort()
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.bias_count).toBe("number");
    expect(typeof succeededData.any_truncated).toBe("boolean");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for bias-check validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-bias-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for bias-check rate-limit failure", async () => {
    const payload = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal", kind: "goal", label: "Increase revenue" },
          { id: "opt_a", kind: "option", label: "Premium pricing" },
        ],
        edges: [],
        meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
      },
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-bias-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/bias-check",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeBiasCheckFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
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

  it("emits requested and succeeded events for successful CEE explain-graph request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-explain-success" },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal", kind: "goal", label: "Increase revenue" },
            { id: "opt_a", kind: "option", label: "Premium pricing" },
          ],
          edges: [],
          meta: {
            roots: ["goal"],
            leaves: ["opt_a"],
            suggested_positions: {},
            source: "assistant",
          },
        },
        inference: {
          summary: "Telemetry explain summary",
          explain: {
            top_drivers: [{ node_id: "opt_a", description: "Premium pricing", contribution: 0.9 }],
          },
          seed: "seed-telemetry-explain",
          response_hash: "hash-telemetry-explain",
        },
        context_id: "ctx-telemetry",
      },
    });

    expect(res.statusCode).toBe(200);
    const _body = res.json() as any;
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "has_context_id", "api_key_present"].sort()
    );
    expect(requestedData.feature).toBe("cee_explain_graph");
    expect(typeof requestedData.has_context_id).toBe("boolean");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "target_count",
        "driver_count",
        "engine_provider",
        "engine_model",
        "has_validation_issues",
      ].sort()
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.target_count).toBe("number");
    expect(typeof succeededData.driver_count).toBe("number");
    expect(typeof succeededData.engine_provider).toBe("string");
    expect(typeof succeededData.engine_model).toBe("string");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for explain-graph validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-explain-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for explain-graph rate-limit failure", async () => {
    const payload = {
      graph: {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "goal", kind: "goal", label: "Increase revenue" },
          { id: "opt_a", kind: "option", label: "Premium pricing" },
        ],
        edges: [],
        meta: { roots: ["goal"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
      },
      inference: {
        summary: "Telemetry explain summary",
        explain: {
          top_drivers: [{ node_id: "opt_a", description: "Premium pricing", contribution: 0.9 }],
        },
        seed: "seed-telemetry-explain-limit",
        response_hash: "hash-telemetry-explain-limit",
      },
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-explain-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/explain-graph",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeExplainGraphFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and succeeded events for successful CEE evidence-helper request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-evidence-success" },
      payload: {
        evidence: [
          { id: "e1", type: "experiment" },
          { id: "e2", type: "user_research" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const _body = res.json() as any;
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperRequested)
      .filter((e) => e.data.request_id === requestId);
    const succeeded = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperSucceeded)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(0);

    const requestedData = requested[0].data;
    const requestedKeys = Object.keys(requestedData).sort();
    expect(requestedKeys).toEqual(
      ["request_id", "feature", "evidence_count", "api_key_present"].sort()
    );
    expect(requestedData.feature).toBe("cee_evidence_helper");
    expect(typeof requestedData.evidence_count).toBe("number");
    expect(typeof requestedData.api_key_present).toBe("boolean");

    const succeededData = succeeded[0].data;
    const succeededKeys = Object.keys(succeededData).sort();
    expect(succeededKeys).toEqual(
      [
        "request_id",
        "latency_ms",
        "quality_overall",
        "evidence_count",
        "strong_count",
        "any_unsupported_types",
        "any_truncated",
        "has_validation_issues",
      ].sort()
    );
    expect(typeof succeededData.latency_ms).toBe("number");
    expect(typeof succeededData.quality_overall).toBe("number");
    expect(typeof succeededData.evidence_count).toBe("number");
    expect(typeof succeededData.strong_count).toBe("number");
    expect(typeof succeededData.any_unsupported_types).toBe("boolean");
    expect(typeof succeededData.any_truncated).toBe("boolean");
    expect(typeof succeededData.has_validation_issues).toBe("boolean");

    expectNoFreeTextFields(requestedData);
    expectNoFreeTextFields(succeededData);
  });

  it("emits requested and failed events for evidence-helper validation failure", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: { "X-Olumi-Assist-Key": "cee-telemetry-evidence-validation" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const requestId = res.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_VALIDATION_FAILED");
    expect(failedData.http_status).toBe(400);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });

  it("emits requested and failed events for evidence-helper rate-limit failure", async () => {
    const payload = {
      evidence: [{ id: "e1", type: "experiment" }],
    };

    const headers = { "X-Olumi-Assist-Key": "cee-telemetry-evidence-limit" } as const;

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const requestId = limited.headers["x-cee-request-id"] as string;

    const requested = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperRequested)
      .filter((e) => e.data.request_id === requestId);
    const failed = telemetrySink
      .getEventsByName(TelemetryEvents.CeeEvidenceHelperFailed)
      .filter((e) => e.data.request_id === requestId);

    expect(requested.length).toBe(1);
    expect(failed.length).toBe(1);

    const failedData = failed[0].data;
    expectFailedShape(failedData);
    expect(failedData.error_code).toBe("CEE_RATE_LIMIT");
    expect(failedData.http_status).toBe(429);
    expectNoFreeTextFields(requested[0].data);
    expectNoFreeTextFields(failedData);
  });
});

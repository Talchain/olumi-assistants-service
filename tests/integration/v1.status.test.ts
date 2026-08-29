/**
 * /v1/status Integration Tests
 *
 * Verifies comprehensive service diagnostics endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { resolveTaskRouting } from "../../src/adapters/llm/model-routing-report.js";

describe("GET /v1/status", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Set environment for testing
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("GROUNDING_ENABLED", "true");
    vi.stubEnv("CRITIQUE_ENABLED", "true");
    vi.stubEnv("CLARIFIER_ENABLED", "true");
    vi.stubEnv("PROMPT_CACHE_ENABLED", "true");
    vi.stubEnv("PROMPT_CACHE_MAX_SIZE", "100");
    vi.stubEnv("PROMPT_CACHE_TTL_MS", "60000");
    vi.stubEnv("SHARE_REVIEW_ENABLED", "true");

    cleanBaseUrl();
    app = await build();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("should return 200 with service diagnostics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");

    const body = JSON.parse(response.body);

    // Basic service info
    expect(body).toHaveProperty("service", "assistants");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime_seconds");
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body).toHaveProperty("timestamp");

    // Request statistics
    expect(body).toHaveProperty("requests");
    expect(body.requests).toHaveProperty("total");
    expect(body.requests).toHaveProperty("client_errors_4xx");
    expect(body.requests).toHaveProperty("server_errors_5xx");
    expect(body.requests).toHaveProperty("error_rate_5xx");
    expect(body.requests.total).toBeGreaterThan(0); // At least this request
  });

  it("should expose LLM adapter information", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    expect(body).toHaveProperty("llm");
    expect(body.llm).toHaveProperty("provider", "fixtures");
    expect(body.llm).toHaveProperty("model");
    // Fixtures adapter does not support caching — cache_enabled is false regardless of env
    expect(body.llm).toHaveProperty("cache_enabled", false);
    expect(body.llm).toHaveProperty("failover_enabled", false);
    // The block is now LABELLED as the untasked default, so a reader cannot
    // take `llm.model` for the model the product runs on.
    expect(body.llm).toHaveProperty("scope", "untasked_default_adapter");
  });

  it("reports the PER-TASK models real turns run on, not the untasked default", async () => {
    // A deployed capture of this endpoint reported `gpt-4o-mini` while real
    // turns routed to `claude-sonnet-5`: the endpoint was answering a
    // question nobody asked (what the untasked fallback would pick) in a
    // field everyone reads as "the model this product runs on".
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    const body = JSON.parse(response.body);

    expect(body).toHaveProperty("model_routing");
    const effective = body.model_routing.effective_task_models;
    expect(effective).toBeDefined();

    // POSITIVE CONTROL (trap 13): the projection must be non-empty, or every
    // assertion below would pass by looking at nothing.
    expect(Object.keys(effective).length).toBeGreaterThan(0);

    // Bound BY TASK ID to the PRODUCER's own resolution — not to a literal
    // written here, and not to anything derived from the default adapter.
    // This is what makes the assertion survive a change to the default
    // adapter and fail on a change to the ROUTING, which is the direction
    // that matters.
    for (const task of ["draft_graph", "edit_graph", "orchestrator", "critique_graph"]) {
      expect(effective[task]).toBe(resolveTaskRouting(task as never).model);
    }

    expect(body.model_routing).toHaveProperty("default_provider");
  });

  it("does not leak configuration key names on this unauthenticated endpoint", async () => {
    // `/v1/status` is public. The full routing rows carry configuration key
    // NAMES (CEE_MODEL_*, providers.json paths) and configuration-error
    // messages; those belong on the admin-key-gated /admin/models/routing.
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    const raw = response.body;

    expect(raw).not.toContain("CEE_MODEL_");
    expect(raw).not.toContain("providers.json");
    expect(raw).not.toContain("source_key");
    expect(raw).not.toContain("configuration_error");
    // CONTRAST CONTROL: the block we DO expose is present in the same body,
    // so these absence assertions are not passing on an empty response.
    expect(raw).toContain("effective_task_models");
  });

  it("should not expose cache_stats for fixtures adapter (no caching support)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    // Fixtures adapter has no stats() method, so cache_stats is undefined
    expect(body.llm.cache_stats).toBeUndefined();
  });

  it("should expose share storage statistics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    expect(body).toHaveProperty("share");
    expect(body.share).toHaveProperty("enabled", true);
    expect(body.share).toHaveProperty("total_shares");
    expect(body.share).toHaveProperty("active_shares");
    expect(body.share).toHaveProperty("revoked_shares");
  });

  it("should expose feature flags", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    expect(body).toHaveProperty("feature_flags");
    expect(body.feature_flags).toHaveProperty("grounding", true);
    expect(body.feature_flags).toHaveProperty("critique", true);
    expect(body.feature_flags).toHaveProperty("clarifier", true);
    // pii_guard removed 2026-07-20 (O-7 wave 2, Appendix A4): the flag only
    // ever fed this report field — no enforcement existed.
    expect(body.feature_flags).not.toHaveProperty("pii_guard");
    expect(body.feature_flags).toHaveProperty("share_review", true);
    expect(body.feature_flags).toHaveProperty("prompt_cache", true);
  });

  it("should increment request counter on each call", async () => {
    // First call
    const response1 = await app.inject({
      method: "GET",
      url: "/v1/status",
    });
    const body1 = JSON.parse(response1.body);
    const count1 = body1.requests.total;

    // Second call
    const response2 = await app.inject({
      method: "GET",
      url: "/v1/status",
    });
    const body2 = JSON.parse(response2.body);
    const count2 = body2.requests.total;

    // Count should increase
    expect(count2).toBeGreaterThan(count1);
  });

  it("should calculate error rate correctly and separate 4xx/5xx", async () => {
    // Get initial stats
    const response1 = await app.inject({
      method: "GET",
      url: "/v1/status",
    });
    const body1 = JSON.parse(response1.body);

    // Error rate should be a percentage between 0 and 100
    expect(body1.requests.error_rate_5xx).toBeGreaterThanOrEqual(0);
    expect(body1.requests.error_rate_5xx).toBeLessThanOrEqual(100);

    // Error counts should be non-negative
    expect(body1.requests.client_errors_4xx).toBeGreaterThanOrEqual(0);
    expect(body1.requests.server_errors_5xx).toBeGreaterThanOrEqual(0);

    // If there are 5xx errors, rate should be calculated correctly
    if (body1.requests.server_errors_5xx > 0 && body1.requests.total > 0) {
      const expectedRate = Math.round((body1.requests.server_errors_5xx / body1.requests.total) * 10000) / 100;
      expect(body1.requests.error_rate_5xx).toBe(expectedRate);
    }
  });

  it("should have valid ISO 8601 timestamp", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    // Verify timestamp is valid ISO 8601
    expect(() => new Date(body.timestamp)).not.toThrow();
    const timestamp = new Date(body.timestamp);
    expect(timestamp.toISOString()).toBe(body.timestamp);
  });

  it("should not require authentication", async () => {
    // Status endpoint should be public (no auth required)
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
      // No X-Olumi-Assist-Key header
    });

    expect(response.statusCode).toBe(200);
  });

  it("should return consistent schema across multiple calls", async () => {
    const response1 = await app.inject({
      method: "GET",
      url: "/v1/status",
    });
    const body1 = JSON.parse(response1.body);

    const response2 = await app.inject({
      method: "GET",
      url: "/v1/status",
    });
    const body2 = JSON.parse(response2.body);

    // Same keys in both responses
    expect(Object.keys(body1).sort()).toEqual(Object.keys(body2).sort());
    expect(Object.keys(body1.llm).sort()).toEqual(Object.keys(body2.llm).sort());
    expect(Object.keys(body1.share).sort()).toEqual(Object.keys(body2.share).sort());
    expect(Object.keys(body1.feature_flags).sort()).toEqual(Object.keys(body2.feature_flags).sort());
  });
});

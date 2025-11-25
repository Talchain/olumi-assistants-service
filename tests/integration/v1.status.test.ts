/**
 * /v1/status Integration Tests
 *
 * Verifies comprehensive service diagnostics endpoint.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

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
    expect(body.llm).toHaveProperty("cache_enabled", true);
    expect(body.llm).toHaveProperty("failover_enabled", false);
  });

  it("should expose cache statistics when caching is enabled", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/status",
    });

    const body = JSON.parse(response.body);

    expect(body.llm).toHaveProperty("cache_stats");
    expect(body.llm.cache_stats).toHaveProperty("size");
    expect(body.llm.cache_stats).toHaveProperty("capacity", 100);
    expect(body.llm.cache_stats).toHaveProperty("ttlMs", 60000); // Note: camelCase from cache
    expect(body.llm.cache_stats).toHaveProperty("enabled", true);
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
    expect(body.feature_flags).toHaveProperty("pii_guard", false);
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

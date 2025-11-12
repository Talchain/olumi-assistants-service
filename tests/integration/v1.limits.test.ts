/**
 * /v1/limits Integration Tests (v1.4.0 - PR E)
 *
 * Tests GET /v1/limits endpoint that returns API limits and quotas.
 * Ensures clients can discover constraints before making requests.
 */

import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import limitsRoute from "../../src/routes/v1.limits.js";

describe("GET /v1/limits", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify();
    await limitsRoute(app);
  });

  it("returns 200 OK with limits schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.schema).toBe("limits.v1");
  });

  it("includes rate_limits object", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body = JSON.parse(res.body);
    expect(body.rate_limits).toBeDefined();
    expect(body.rate_limits.requests_per_minute_per_key).toBeTypeOf("number");
    expect(body.rate_limits.sse_requests_per_minute_per_key).toBeTypeOf("number");
    expect(body.rate_limits.global_requests_per_minute_per_ip).toBeTypeOf("number");

    // Verify reasonable values
    expect(body.rate_limits.requests_per_minute_per_key).toBeGreaterThan(0);
    expect(body.rate_limits.sse_requests_per_minute_per_key).toBeGreaterThan(0);
    expect(body.rate_limits.global_requests_per_minute_per_ip).toBeGreaterThan(0);
  });

  it("includes graph_limits object", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body = JSON.parse(res.body);
    expect(body.graph_limits).toBeDefined();
    expect(body.graph_limits.max_nodes).toBe(12);
    expect(body.graph_limits.max_edges).toBe(24);
  });

  it("includes cost_limits object", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body = JSON.parse(res.body);
    expect(body.cost_limits).toBeDefined();
    expect(body.cost_limits.max_usd_per_request).toBeTypeOf("number");
    expect(body.cost_limits.max_usd_per_request).toBeGreaterThan(0);
  });

  it("includes content_limits object", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body = JSON.parse(res.body);
    expect(body.content_limits).toBeDefined();
    expect(body.content_limits.brief_min_chars).toBe(30);
    expect(body.content_limits.brief_max_chars).toBe(5000);
    expect(body.content_limits.attachment_per_file_max_chars).toBe(5000);
    expect(body.content_limits.attachment_aggregate_max_chars).toBe(50000);
    expect(body.content_limits.request_body_max_bytes).toBeTypeOf("number");
    expect(body.content_limits.request_body_max_bytes).toBeGreaterThan(0);
  });

  it("returns consistent limits across multiple requests", async () => {
    const res1 = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const res2 = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);

    expect(body1).toEqual(body2);
  });

  it("rejects POST method", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/limits",
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects PUT method", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/limits",
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns valid JSON structure matching schema", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/limits",
    });

    const body = JSON.parse(res.body);

    // Verify all top-level keys
    expect(Object.keys(body).sort()).toEqual([
      "content_limits",
      "cost_limits",
      "graph_limits",
      "rate_limits",
      "schema",
    ].sort());

    // Verify rate_limits keys
    expect(Object.keys(body.rate_limits).sort()).toEqual([
      "global_requests_per_minute_per_ip",
      "requests_per_minute_per_key",
      "sse_requests_per_minute_per_key",
    ].sort());

    // Verify graph_limits keys
    expect(Object.keys(body.graph_limits).sort()).toEqual([
      "max_edges",
      "max_nodes",
    ].sort());

    // Verify cost_limits keys
    expect(Object.keys(body.cost_limits).sort()).toEqual([
      "max_usd_per_request",
    ].sort());

    // Verify content_limits keys
    expect(Object.keys(body.content_limits).sort()).toEqual([
      "attachment_aggregate_max_chars",
      "attachment_per_file_max_chars",
      "brief_max_chars",
      "brief_min_chars",
      "request_body_max_bytes",
    ].sort());
  });
});

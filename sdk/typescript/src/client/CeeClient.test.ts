/**
 * CeeClient Tests
 *
 * Tests for the CEE SDK client for PLoT integration.
 *
 * M1 CEE Orchestrator - CEE SDK Workstream
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CeeClient, createCeeClient } from "./CeeClient.js";
import { CeeClientError } from "../errors/CeeClientError.js";
import type { CeeReviewRequest } from "../types/review.js";

declare const global: any;

/**
 * Create a mock Headers object that has forEach method.
 */
function createMockHeaders(entries: [string, string][]): Headers {
  return {
    forEach: (callback: (value: string, key: string) => void) => {
      for (const [key, value] of entries) {
        callback(value, key);
      }
    },
    get: (name: string) => entries.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] ?? null,
  } as unknown as Headers;
}

/**
 * Create a valid M1 CeeReviewRequest for testing.
 */
function createValidRequest(overrides?: Partial<CeeReviewRequest>): CeeReviewRequest {
  return {
    scenario_id: "test-scenario-123",
    graph_snapshot: {
      nodes: [{ id: "goal_1", kind: "goal", label: "Select vendor" }],
      edges: [],
    },
    graph_schema_version: "2.2",
    inference_results: {
      quantiles: { p10: 0.2, p50: 0.5, p90: 0.8 },
      top_edge_drivers: [],
    },
    intent: "selection",
    market_context: {
      id: "ctx-1",
      version: "1.0",
      hash: "abc123",
    },
    ...overrides,
  };
}

/**
 * Create a valid M1 service response for testing.
 */
function createValidServiceResponse(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    intent: "selection",
    analysis_state: "ran",
    readiness: {
      level: "ready",
      headline: "Graph is ready for analysis",
      factors: [
        { label: "Completeness", status: "ok" },
        { label: "Structure", status: "ok" },
      ],
    },
    blocks: [
      {
        id: "next_steps",
        type: "next_steps",
        summary: "Continue with analysis",
        generated_at: new Date().toISOString(),
      },
    ],
    trace: {
      request_id: "req_abc123",
      latency_ms: 150,
      model: "cee-v1",
    },
    ...overrides,
  };
}

describe("CeeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe("constructor", () => {
    it("throws CEE_CONFIG_ERROR when apiKey is missing", () => {
      expect(() => new CeeClient({ apiKey: "" })).toThrow(CeeClientError);
      expect(() => new CeeClient({ apiKey: "" })).toThrow("API key is required");
    });

    it("throws CEE_CONFIG_ERROR when apiKey is whitespace", () => {
      expect(() => new CeeClient({ apiKey: "   " })).toThrow(CeeClientError);
    });

    it("throws CEE_CONFIG_ERROR for invalid baseUrl", () => {
      expect(() =>
        new CeeClient({ apiKey: "test-key", baseUrl: "not-a-url" }),
      ).toThrow(CeeClientError);
    });

    it("uses default baseUrl when not provided", () => {
      const client = new CeeClient({ apiKey: "test-key" });
      expect(client).toBeInstanceOf(CeeClient);
    });

    it("uses provided baseUrl", () => {
      const client = new CeeClient({
        apiKey: "test-key",
        baseUrl: "https://custom.example.com",
      });
      expect(client).toBeInstanceOf(CeeClient);
    });
  });

  describe("createCeeClient", () => {
    it("creates a CeeClient instance", () => {
      const client = createCeeClient({ apiKey: "test-key" });
      expect(client).toBeInstanceOf(CeeClient);
    });
  });

  describe("review()", () => {
    it("sends POST to /assist/v1/review with X-API-Key header", async () => {
      const client = createCeeClient({
        apiKey: "test-api-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: createMockHeaders([
          ["x-cee-request-id", "req_abc123"],
          ["x-cee-api-version", "v1"],
        ]),
        text: async () => JSON.stringify(createValidServiceResponse()),
      });

      const result = await client.review(createValidRequest());

      expect(result.trace.request_id).toBe("req_abc123");
      expect(result.review.intent).toBe("selection");
      expect(result.review.analysis_state).toBe("ran");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = global.fetch.mock.calls[0] as [string, any];
      expect(url).toBe("https://api.example.com/assist/v1/review");
      expect(init.method).toBe("POST");
      expect(init.headers["X-API-Key"]).toBe("test-api-key");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["Accept"]).toBe("application/json");
    });

    it("throws CEE_PROTOCOL_ERROR when trace.request_id is missing", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const responseWithoutRequestId = createValidServiceResponse({
        trace: {
          latency_ms: 100,
          model: "cee-v1",
          // Missing request_id
        },
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutRequestId),
      });

      await expect(client.review(createValidRequest())).rejects.toThrow(CeeClientError);

      // Reset mock for second call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutRequestId),
      });

      await expect(client.review(createValidRequest())).rejects.toThrow(
        "Response missing required trace.request_id",
      );

      // Reset mock for third call to verify error code
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutRequestId),
      });

      // Verify error code is CEE_PROTOCOL_ERROR
      try {
        await client.review(createValidRequest());
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        expect((err as CeeClientError).code).toBe("CEE_PROTOCOL_ERROR");
        expect((err as CeeClientError).retriable).toBe(false);
      }
    });

    it("throws CEE_PROTOCOL_ERROR when intent is missing", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const responseWithoutIntent = createValidServiceResponse();
      delete (responseWithoutIntent as any).intent;

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutIntent),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        expect((err as CeeClientError).code).toBe("CEE_PROTOCOL_ERROR");
        expect((err as CeeClientError).message).toContain("intent");
      }
    });

    it("throws CEE_PROTOCOL_ERROR when analysis_state is missing", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const responseWithoutAnalysisState = createValidServiceResponse();
      delete (responseWithoutAnalysisState as any).analysis_state;

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutAnalysisState),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        expect((err as CeeClientError).code).toBe("CEE_PROTOCOL_ERROR");
        expect((err as CeeClientError).message).toContain("analysis_state");
      }
    });

    it("throws CEE_PROTOCOL_ERROR when blocks is missing", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const responseWithoutBlocks = createValidServiceResponse();
      delete (responseWithoutBlocks as any).blocks;

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(responseWithoutBlocks),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        expect((err as CeeClientError).code).toBe("CEE_PROTOCOL_ERROR");
        expect((err as CeeClientError).message).toContain("blocks");
      }
    });

    it("throws CEE_RATE_LIMIT on 429 response", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const errorResponse = {
        schema: "cee.error.v1",
        code: "CEE_RATE_LIMIT",
        message: "Rate limited",
        retryable: true,
        trace: { request_id: "req_123" },
        details: { retry_after_seconds: 30 },
      };

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: createMockHeaders([["retry-after", "30"]]),
        text: async () => JSON.stringify(errorResponse),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_RATE_LIMIT");
        expect(error.retriable).toBe(true);
        expect(error.statusCode).toBe(429);
        expect(error.retryAfterSeconds).toBe(30);
      }
    });

    it("throws CEE_VALIDATION_FAILED on 400 response", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const errorResponse = {
        schema: "cee.error.v1",
        code: "CEE_VALIDATION_FAILED",
        message: "Invalid graph",
        retryable: false,
      };

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(errorResponse),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_VALIDATION_FAILED");
        expect(error.retriable).toBe(false);
        expect(error.statusCode).toBe(400);
      }
    });

    it("throws CEE_INTERNAL_ERROR on 500 response", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: createMockHeaders([]),
        text: async () => JSON.stringify({ code: "INTERNAL", message: "Server error" }),
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_INTERNAL_ERROR");
        expect(error.retriable).toBe(true);
        expect(error.statusCode).toBe(500);
      }
    });

    it("throws CEE_TIMEOUT on AbortError", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        timeout: 100,
      });

      global.fetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_TIMEOUT");
        expect(error.retriable).toBe(true);
      }
    });

    it("throws CEE_NETWORK_ERROR on network failure", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_NETWORK_ERROR");
        expect(error.retriable).toBe(true);
      }
    });

    it("throws CEE_PROTOCOL_ERROR on empty response body", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => "",
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_PROTOCOL_ERROR");
        expect(error.message).toBe("Server returned empty response body");
      }
    });

    it("throws CEE_PROTOCOL_ERROR on malformed JSON", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => "not valid json",
      });

      try {
        await client.review(createValidRequest());
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_PROTOCOL_ERROR");
        expect(error.message).toBe("Server returned malformed JSON");
      }
    });

    it("extracts headers and includes them in response", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([
          ["x-cee-request-id", "req_123"],
          ["x-cee-api-version", "v1"],
          ["x-cee-feature-version", "decision-review-2.0.0"],
        ]),
        text: async () => JSON.stringify(createValidServiceResponse()),
      });

      const result = await client.review(createValidRequest());

      expect(result.headers["x-cee-request-id"]).toBe("req_123");
      expect(result.headers["x-cee-api-version"]).toBe("v1");
      expect(result.headers["x-cee-feature-version"]).toBe("decision-review-2.0.0");
    });

    it("builds proper review payload with blocks", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      const mockServiceResponse = createValidServiceResponse({
        blocks: [
          {
            id: "biases",
            type: "biases",
            findings: [
              { bias_type: "confirmation", description: "Confirmation bias detected", severity: "high" },
            ],
            confidence: 0.8,
            generated_at: new Date().toISOString(),
          },
          {
            id: "risks",
            type: "risks",
            warnings: [
              { type: "orphan_nodes", message: "Found 2 orphan nodes", severity: "warning" },
            ],
            generated_at: new Date().toISOString(),
          },
          {
            id: "next_steps",
            type: "next_steps",
            summary: "Address biases before proceeding",
            level: "caution",
            score: 0.6,
            factors: {
              completeness: { value: 0.8, status: "ok" },
              structure: { value: 0.6, status: "warning" },
              evidence: { value: 0.5, status: "warning" },
              bias_risk: { value: 0.4, status: "warning" },
            },
            recommendations: ["Review bias findings", "Add more evidence"],
            generated_at: new Date().toISOString(),
          },
        ],
        trace: { request_id: "req_456", latency_ms: 200, model: "cee-v2" },
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(mockServiceResponse),
      });

      const result = await client.review(createValidRequest());

      expect(result.review.blocks).toHaveLength(3);
      expect(result.review.blocks[0].id).toBe("biases");
      expect(result.review.blocks[0].items).toHaveLength(1);

      expect(result.trace.latency_ms).toBe(200);
      expect(result.trace.model).toBe("cee-v2");
    });

    it("respects custom timeout option", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        timeout: 60000,
      });

      // Mock fetch to throw AbortError (simulating timeout)
      global.fetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

      try {
        await client.review(createValidRequest(), { timeout: 10 });
        throw new Error("Should have thrown timeout");
      } catch (err) {
        if (err instanceof CeeClientError) {
          // Could be timeout or network error depending on timing
          expect(["CEE_TIMEOUT", "CEE_NETWORK_ERROR"]).toContain(err.code);
        } else {
          throw err;
        }
      }
    });

    it("normalizes trace from response", async () => {
      const client = createCeeClient({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: createMockHeaders([]),
        text: async () => JSON.stringify(createValidServiceResponse({
          trace: {
            request_id: "req_normalized",
            latency_ms: 123,
            model: "cee-m1",
          },
        })),
      });

      const result = await client.review(createValidRequest());

      expect(result.trace.request_id).toBe("req_normalized");
      expect(result.trace.latency_ms).toBe(123);
      expect(result.trace.model).toBe("cee-m1");
    });
  });

  describe("request validation", () => {
    it("throws CEE_VALIDATION_FAILED when scenario_id is missing", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      delete (invalidRequest as any).scenario_id;

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow(CeeClientError);

      try {
        await client.review(invalidRequest);
      } catch (err) {
        expect(err).toBeInstanceOf(CeeClientError);
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_VALIDATION_FAILED");
        expect(error.message).toContain("scenario_id");
        expect(error.retriable).toBe(false);
      }
    });

    it("throws CEE_VALIDATION_FAILED when graph_snapshot is missing", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      delete (invalidRequest as any).graph_snapshot;

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("graph_snapshot is required");
    });

    it("throws CEE_VALIDATION_FAILED when graph_snapshot.nodes is not an array", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest({
        graph_snapshot: { nodes: "not-an-array" as any, edges: [] },
      });

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("graph_snapshot.nodes must be an array");
    });

    it("throws CEE_VALIDATION_FAILED when graph_schema_version is wrong", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      (invalidRequest as any).graph_schema_version = "1.0";

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("graph_schema_version must be '2.2'");
    });

    it("throws CEE_VALIDATION_FAILED when inference_results is missing", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      delete (invalidRequest as any).inference_results;

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("inference_results is required");
    });

    it("throws CEE_VALIDATION_FAILED when intent is invalid", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      (invalidRequest as any).intent = "invalid";

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("intent must be one of: selection, prediction, validation");
    });

    it("throws CEE_VALIDATION_FAILED when market_context is missing", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      const invalidRequest = createValidRequest();
      delete (invalidRequest as any).market_context;

      await expect(
        client.review(invalidRequest),
      ).rejects.toThrow("market_context is required");
    });

    it("includes all validation errors in message", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      try {
        await client.review({
          scenario_id: "",
          graph_snapshot: { nodes: "invalid" as any, edges: [] },
          graph_schema_version: "1.0" as any,
          inference_results: {} as any,
          intent: "invalid" as any,
          market_context: {} as any,
        });
      } catch (err) {
        const error = err as CeeClientError;
        expect(error.code).toBe("CEE_VALIDATION_FAILED");
        // Multiple errors should be listed
        expect(error.message).toContain("scenario_id");
        expect(error.message).toContain("graph_schema_version");
        // Details should include validation_errors array
        expect(error.details).toHaveProperty("validation_errors");
        expect((error.details as any).validation_errors.length).toBeGreaterThan(1);
      }
    });

    it("does not call fetch when validation fails", async () => {
      const client = createCeeClient({ apiKey: "test-key" });

      try {
        await client.review({} as any);
      } catch {
        // Expected
      }

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe("CeeClientError", () => {
  it("has correct properties", () => {
    const error = new CeeClientError("CEE_PROTOCOL_ERROR", "Test message", {
      statusCode: 200,
      requestId: "req_123",
    });

    expect(error.code).toBe("CEE_PROTOCOL_ERROR");
    expect(error.message).toBe("Test message");
    expect(error.retriable).toBe(false);
    expect(error.statusCode).toBe(200);
    expect(error.requestId).toBe("req_123");
    expect(error.name).toBe("CeeClientError");
  });

  it("retriable is true for network errors", () => {
    const error = new CeeClientError("CEE_NETWORK_ERROR", "Network failed");
    expect(error.retriable).toBe(true);
  });

  it("retriable is true for timeout errors", () => {
    const error = new CeeClientError("CEE_TIMEOUT", "Timed out");
    expect(error.retriable).toBe(true);
  });

  it("retriable is true for rate limit errors", () => {
    const error = new CeeClientError("CEE_RATE_LIMIT", "Rate limited", {
      retryAfterSeconds: 30,
    });
    expect(error.retriable).toBe(true);
    expect(error.getRetryDelayMs()).toBe(30000);
  });

  it("retriable is false for validation errors", () => {
    const error = new CeeClientError("CEE_VALIDATION_FAILED", "Invalid input");
    expect(error.retriable).toBe(false);
  });

  it("retriable is false for config errors", () => {
    const error = new CeeClientError("CEE_CONFIG_ERROR", "Missing API key");
    expect(error.retriable).toBe(false);
  });

  it("toJSON returns serializable object", () => {
    const error = new CeeClientError("CEE_RATE_LIMIT", "Rate limited", {
      statusCode: 429,
      requestId: "req_123",
      retryAfterSeconds: 60,
      details: { foo: "bar" },
    });

    const json = error.toJSON();

    expect(json.name).toBe("CeeClientError");
    expect(json.code).toBe("CEE_RATE_LIMIT");
    expect(json.message).toBe("Rate limited");
    expect(json.retriable).toBe(true);
    expect(json.statusCode).toBe(429);
    expect(json.requestId).toBe("req_123");
    expect(json.retryAfterSeconds).toBe(60);
    expect(json.details).toEqual({ foo: "bar" });
  });
});

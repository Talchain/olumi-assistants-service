import { describe, it, expect, beforeEach, vi } from "vitest";
import { createCEEClient } from "./ceeClient.js";
import type {
  CEEDraftGraphRequestV1,
  CEEDraftGraphResponseV1,
  CEEErrorResponseV1,
} from "./ceeTypes.js";
import type { ErrorResponse } from "./types.js";
import { OlumiAPIError } from "./errors.js";

declare const global: any;

describe("CEEClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("sends draftGraph requests to /assist/v1/draft-graph and returns the envelope", async () => {
    const client = createCEEClient({ apiKey: "test-key", baseUrl: "https://api.example.com" });

    const mockRequest: CEEDraftGraphRequestV1 = {
      brief: "Test",
    } as any;

    const mockResponse: CEEDraftGraphResponseV1 = {
      trace: { request_id: "req_1", correlation_id: "req_1", engine: {} },
      quality: { overall: 8 },
      graph: { schema: "graph.v1", nodes: [], edges: [] },
    } as any;

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(mockResponse),
    });

    const result = await client.draftGraph(mockRequest);

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/assist/v1/draft-graph");
    expect(init.method).toBe("POST");
    expect((init.headers as any)["X-Olumi-Assist-Key"]).toBe("test-key");
    expect((init.headers as any)["Accept"]).toBe("application/json");

    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual(mockRequest);
  });

  it("maps CEE error responses into OlumiAPIError with CEE metadata", async () => {
    const client = createCEEClient({ apiKey: "k", baseUrl: "https://api.example.com" });

    const ceeError: CEEErrorResponseV1 = {
      schema: "cee.error.v1",
      code: "CEE_RATE_LIMIT",
      message: "Rate limited",
      retryable: true,
      trace: { request_id: "req_cee", correlation_id: "req_cee", engine: {} },
      details: { retry_after_seconds: 5 },
    };

    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => JSON.stringify(ceeError),
    });

    await expect(
      client.options({ graph: { schema: "graph.v1", nodes: [], edges: [] } } as any),
    ).rejects.toThrow(OlumiAPIError);

    try {
      await client.options({ graph: { schema: "graph.v1", nodes: [], edges: [] } } as any);
    } catch (err) {
      const apiErr = err as OlumiAPIError;
      expect(apiErr.statusCode).toBe(429);
      expect(apiErr.code).toBe("CEE_RATE_LIMIT");
      expect(apiErr.requestId).toBe("req_cee");
      const details = apiErr.details as Record<string, unknown>;
      expect(details.cee_code).toBe("CEE_RATE_LIMIT");
      expect(details.cee_retryable).toBe(true);
      expect(details.cee_trace).toBeDefined();
    }
  });

  it("falls back to generic ErrorResponse when body is not CEE-shaped", async () => {
    const client = createCEEClient({ apiKey: "k", baseUrl: "https://api.example.com" });

    const body: ErrorResponse = {
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "invalid",
    };

    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify(body),
    });

    await expect(
      client.biasCheck({ graph: { schema: "graph.v1", nodes: [], edges: [] } } as any),
    ).rejects.toThrow(OlumiAPIError);

    try {
      await client.biasCheck({ graph: { schema: "graph.v1", nodes: [], edges: [] } } as any);
    } catch (err) {
      const apiErr = err as OlumiAPIError;
      expect(apiErr.statusCode).toBe(400);
      expect(apiErr.code).toBe("BAD_INPUT");
    }
  });
});

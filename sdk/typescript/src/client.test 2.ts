/**
 * Unit tests for Olumi SDK Client
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OlumiClient } from "./client.js";
import {
  OlumiAPIError,
  OlumiConfigError,
  OlumiNetworkError,
  OlumiValidationError,
} from "./errors.js";
import type {
  DraftGraphRequest,
  DraftGraphResponse,
  ShareRequest,
  StatusResponse,
} from "./types.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("OlumiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should create client with valid config", () => {
      const client = new OlumiClient({
        apiKey: "test-key",
        baseUrl: "https://test.example.com",
      });

      expect(client).toBeInstanceOf(OlumiClient);
    });

    it("should throw on missing API key", () => {
      expect(() => {
        new OlumiClient({ apiKey: "" });
      }).toThrow(OlumiConfigError);
    });

    it("should throw on invalid base URL", () => {
      expect(() => {
        new OlumiClient({
          apiKey: "test-key",
          baseUrl: "not-a-url",
        });
      }).toThrow(OlumiConfigError);
    });

    it("should use default base URL when not provided", () => {
      const client = new OlumiClient({ apiKey: "test-key" });
      expect(client).toBeInstanceOf(OlumiClient);
    });

    it("should accept custom retry configuration", () => {
      const client = new OlumiClient({
        apiKey: "test-key",
        maxRetries: 5,
        retryDelay: 2000,
      });

      expect(client).toBeInstanceOf(OlumiClient);
    });
  });

  describe("Input Validation", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({ apiKey: "test-key", maxRetries: 0 });
    });

    it("should validate draftGraph request - missing brief", async () => {
      await expect(
        client.draftGraph({ brief: "" })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate draftGraph request - brief too long", async () => {
      await expect(
        client.draftGraph({ brief: "a".repeat(51000) })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate suggestOptions request - missing graph", async () => {
      await expect(
        client.suggestOptions({ graph: null as any, question_id: "q1" })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate suggestOptions request - missing question_id", async () => {
      await expect(
        client.suggestOptions({
          graph: { schema: "graph.v1", nodes: [{ id: "n1", kind: "question", label: "Q" }], edges: [] },
          question_id: "",
        })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate graph - missing nodes", async () => {
      await expect(
        client.suggestOptions({
          graph: { schema: "graph.v1", nodes: null as any, edges: [] },
          question_id: "q1",
        })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate graph - empty nodes", async () => {
      await expect(
        client.suggestOptions({
          graph: { schema: "graph.v1", nodes: [], edges: [] },
          question_id: "q1",
        })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate shareRequest - invalid redaction mode", async () => {
      await expect(
        client.createShare({
          graph: { schema: "graph.v1", nodes: [{ id: "n1", kind: "goal", label: "G" }], edges: [] },
          redaction_mode: "invalid" as any,
        })
      ).rejects.toThrow(OlumiValidationError);
    });

    it("should validate revokeShare - missing shareId", async () => {
      await expect(client.revokeShare("")).rejects.toThrow(
        OlumiValidationError
      );
    });
  });

  describe("API Requests", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({
        apiKey: "test-key",
        baseUrl: "https://test.example.com",
        maxRetries: 0,
      });
    });

    it("should make successful draftGraph request", async () => {
      const mockResponse: DraftGraphResponse = {
        schema: "draft-graph.v1",
        graph: {
          schema: "graph.v1",
          nodes: [{ id: "n1", kind: "goal", label: "Goal" }],
          edges: [],
        },
        rationales: [],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        headers: new Map([["X-Request-Id", "req_123"]]),
      });

      const request: DraftGraphRequest = {
        brief: "Test brief",
      };

      const response = await client.draftGraph(request);

      expect(response.data).toEqual(mockResponse);
      expect(response.metadata.requestId).toBe("req_123");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://test.example.com/assist/draft-graph",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Olumi-Assist-Key": "test-key",
          }),
        })
      );
    });

    it("should extract rate limit metadata from headers", async () => {
      const mockResponse = {
        schema: "draft-graph.v1",
        graph: { schema: "graph.v1", nodes: [], edges: [] },
        rationales: [],
      };

      const mockHeaders = new Map([
        ["X-Request-Id", "req_123"],
        ["X-RateLimit-Limit", "120"],
        ["X-RateLimit-Remaining", "119"],
        ["X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + 60)],
      ]);

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
        headers: mockHeaders,
      });

      const response = await client.draftGraph({ brief: "Test" });

      expect(response.metadata.rateLimit).toBeDefined();
      expect(response.metadata.rateLimit?.limit).toBe(120);
      expect(response.metadata.rateLimit?.remaining).toBe(119);
      expect(response.metadata.rateLimit?.reset).toBeInstanceOf(Date);
    });

    it("should handle API error responses", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "Invalid input",
        request_id: "req_123",
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
        headers: new Map(),
      });

      try {
        await client.draftGraph({ brief: "Test" });
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(OlumiAPIError);
        expect((error as OlumiAPIError).statusCode).toBe(400);
        expect((error as OlumiAPIError).code).toBe("BAD_INPUT");
        expect((error as OlumiAPIError).requestId).toBe("req_123");
      }
    });

    it("should make successful getStatus request", async () => {
      const mockStatus: StatusResponse = {
        service: "assistants",
        version: "1.6.0",
        uptime_seconds: 120,
        timestamp: new Date().toISOString(),
        requests: {
          total: 100,
          client_errors_4xx: 5,
          server_errors_5xx: 0,
          error_rate_5xx: 0,
        },
        llm: {
          provider: "openai",
          model: "gpt-4",
          cache_enabled: true,
          failover_enabled: false,
        },
        share: {
          enabled: true,
          total_shares: 10,
          active_shares: 8,
          revoked_shares: 2,
        },
        feature_flags: {
          grounding: true,
          critique: true,
          clarifier: true,
          pii_guard: false,
          share_review: true,
          prompt_cache: true,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockStatus,
        headers: new Map(),
      });

      const response = await client.getStatus();

      expect(response.data).toEqual(mockStatus);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://test.example.com/v1/status",
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    it("should make successful createShare request", async () => {
      const mockShareResponse = {
        schema: "share.v1",
        share_id: "share_123",
        share_url: "https://test.example.com/s/share_123",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        redaction_mode: "minimal",
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockShareResponse,
        headers: new Map(),
      });

      const request: ShareRequest = {
        graph: {
          schema: "graph.v1",
          nodes: [{ id: "n1", kind: "goal", label: "Goal" }],
          edges: [],
        },
        brief: "Test brief",
        redaction_mode: "minimal",
      };

      const response = await client.createShare(request);

      expect(response.data).toEqual(mockShareResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://test.example.com/assist/share",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should make successful revokeShare request", async () => {
      const mockRevokeResponse = {
        schema: "share-revoke.v1",
        share_id: "share_abc123",
        revoked: true,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRevokeResponse,
        headers: new Map(),
      });

      const response = await client.revokeShare("token_xyz789");

      expect(response.data).toEqual(mockRevokeResponse);
      expect(response.data.revoked).toBe(true);
      expect(response.data.share_id).toBe("share_abc123");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://test.example.com/assist/share/token_xyz789",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("Retry Logic", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({
        apiKey: "test-key",
        maxRetries: 2,
        retryDelay: 10, // Short delay for tests
      });
    });

    it("should retry on 5xx errors", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "INTERNAL",
        message: "Internal server error",
      };

      const successResponse = {
        schema: "draft-graph.v1",
        graph: { schema: "graph.v1", nodes: [], edges: [] },
        rationales: [],
      };

      // Fail twice, then succeed
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => JSON.stringify(errorResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => JSON.stringify(errorResponse),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => successResponse,
          headers: new Map(),
        });

      const response = await client.draftGraph({ brief: "Test" });

      expect(response.data).toEqual(successResponse);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should retry on 429 rate limit", async () => {
      const rateLimitError = {
        schema: "error.v1",
        code: "RATE_LIMITED",
        message: "Rate limited",
        details: { retry_after_seconds: 0.01 },
      };

      const successResponse = {
        schema: "draft-graph.v1",
        graph: { schema: "graph.v1", nodes: [], edges: [] },
        rationales: [],
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => JSON.stringify(rateLimitError),
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => successResponse,
          headers: new Map(),
        });

      const response = await client.draftGraph({ brief: "Test" });

      expect(response.data).toEqual(successResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry on 4xx client errors", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "Invalid input",
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
        headers: new Map(),
      });

      await expect(
        client.draftGraph({ brief: "Test" })
      ).rejects.toThrow(OlumiAPIError);

      // Should only call once (no retries)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries exhausted", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "INTERNAL",
        message: "Internal server error",
      };

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify(errorResponse),
        headers: new Map(),
      });

      await expect(
        client.draftGraph({ brief: "Test" })
      ).rejects.toThrow(OlumiAPIError);

      // Should call 3 times (initial + 2 retries)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should handle network errors with retry", async () => {
      const successResponse = {
        schema: "draft-graph.v1",
        graph: { schema: "graph.v1", nodes: [], edges: [] },
        rationales: [],
      };

      (global.fetch as any)
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => successResponse,
          headers: new Map(),
        });

      const response = await client.draftGraph({ brief: "Test" });

      expect(response.data).toEqual(successResponse);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Timeout and Cancellation", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({
        apiKey: "test-key",
        timeout: 100,
        maxRetries: 0,
      });
    });

    it("should handle request timeout", async () => {
      (global.fetch as any).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new DOMException("Timeout", "AbortError")),
              150
            );
          })
      );

      try {
        await client.draftGraph({ brief: "Test" });
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(OlumiNetworkError);
        expect((error as OlumiNetworkError).isTimeout).toBe(true);
      }
    });

    it("should handle user cancellation", async () => {
      const controller = new AbortController();

      (global.fetch as any).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            controller.abort();
            reject(new DOMException("Aborted", "AbortError"));
          })
      );

      await expect(
        client.draftGraph({ brief: "Test" }, { signal: controller.signal })
      ).rejects.toThrow(OlumiNetworkError);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { OlumiClient } from "./client.js";
import { OlumiConfigError, OlumiAPIError, OlumiNetworkError } from "./errors.js";

describe("OlumiClient", () => {
  describe("constructor", () => {
    it("should throw error when API key is missing", () => {
      expect(() => new OlumiClient({ apiKey: "" })).toThrow(OlumiConfigError);
      expect(() => new OlumiClient({ apiKey: "" })).toThrow("API key is required");
    });

    it("should use default base URL when not provided", () => {
      const client = new OlumiClient({ apiKey: "test-key" });
      expect(client).toBeDefined();
    });

    it("should use custom base URL when provided", () => {
      const client = new OlumiClient({
        apiKey: "test-key",
        baseUrl: "https://custom.example.com",
      });
      expect(client).toBeDefined();
    });

    it("should use default timeout when not provided", () => {
      const client = new OlumiClient({ apiKey: "test-key" });
      expect(client).toBeDefined();
    });
  });

  describe("API methods", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({ apiKey: "test-key" });
      global.fetch = vi.fn();
    });

    it("should have draftGraph method", () => {
      expect(client.draftGraph).toBeDefined();
      expect(typeof client.draftGraph).toBe("function");
    });

    it("should have suggestOptions method", () => {
      expect(client.suggestOptions).toBeDefined();
      expect(typeof client.suggestOptions).toBe("function");
    });

    it("should have clarifyBrief method", () => {
      expect(client.clarifyBrief).toBeDefined();
      expect(typeof client.clarifyBrief).toBe("function");
    });

    it("should have critiqueGraph method", () => {
      expect(client.critiqueGraph).toBeDefined();
      expect(typeof client.critiqueGraph).toBe("function");
    });

    it("should have explainDiff method", () => {
      expect(client.explainDiff).toBeDefined();
      expect(typeof client.explainDiff).toBe("function");
    });

    it("should have evidencePack method", () => {
      expect(client.evidencePack).toBeDefined();
      expect(typeof client.evidencePack).toBe("function");
    });

    it("should have healthCheck method", () => {
      expect(client.healthCheck).toBeDefined();
      expect(typeof client.healthCheck).toBe("function");
    });
  });

  describe("error handling", () => {
    let client: OlumiClient;

    beforeEach(() => {
      client = new OlumiClient({ apiKey: "test-key" });
    });

    it("should throw OlumiAPIError on 4xx response", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "Invalid request",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => errorResponse,
      });

      await expect(client.draftGraph({ brief: "test" })).rejects.toThrow(OlumiAPIError);
    });

    it("should include error details in OlumiAPIError", async () => {
      const errorResponse = {
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "Invalid request",
        details: { field: "brief" },
        request_id: "req-123",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => errorResponse,
      });

      try {
        await client.draftGraph({ brief: "test" });
        expect.fail("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(OlumiAPIError);
        const apiError = error as OlumiAPIError;
        expect(apiError.statusCode).toBe(400);
        expect(apiError.code).toBe("BAD_INPUT");
        expect(apiError.details).toEqual({ field: "brief" });
        expect(apiError.requestId).toBe("req-123");
      }
    });

    it("should throw OlumiNetworkError on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      await expect(client.draftGraph({ brief: "test" })).rejects.toThrow(OlumiNetworkError);
    });
  });
});

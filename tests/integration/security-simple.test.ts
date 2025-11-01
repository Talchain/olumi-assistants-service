import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Mock Anthropic to avoid real API calls
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockResolvedValue({
    graph: {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "test_1", kind: "goal", label: "Test" }],
      edges: [],
      meta: { roots: ["test_1"], leaves: ["test_1"], suggested_positions: {}, source: "assistant" },
    },
    rationales: [],
  }),
  repairGraphWithAnthropic: vi.fn(),
}));

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe("Security Tests (Simplified)", () => {
  describe("Body size limits", () => {
    it("rejects requests larger than 1MB", async () => {
      const app = Fastify({
        logger: false,
        bodyLimit: 1024 * 1024, // 1 MB
      });

      await draftRoute(app);

      // Create payload > 1MB
      const largeBrief = "x".repeat(1024 * 1024 + 1000);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: largeBrief },
      });

      expect(res.statusCode).toBe(413);
    });

    it("accepts requests under 1MB", async () => {
      const app = Fastify({
        logger: false,
        bodyLimit: 1024 * 1024, // 1 MB
      });

      await draftRoute(app);

      // Create payload < 1MB but > minimum brief length
      const validBrief = "Strategic planning with detailed analysis. ".repeat(1000);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: validBrief },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Request configuration", () => {
    it("validates timeout configuration is set", async () => {
      const app = Fastify({
        logger: false,
        connectionTimeout: 60000,
        requestTimeout: 60000,
      });

      await draftRoute(app);

      // Verify configuration
      expect(app.server.timeout).toBe(60000);
    });
  });
});

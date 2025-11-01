import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Mock Anthropic to avoid real API calls in tests
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockResolvedValue({
    graph: {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal_1", kind: "goal", label: "Test goal" },
        { id: "dec_1", kind: "decision", label: "Test decision" },
      ],
      edges: [{ from: "goal_1", to: "dec_1" }],
      meta: { roots: ["goal_1"], leaves: ["dec_1"], suggested_positions: {}, source: "assistant" },
    },
    rationales: [{ target: "goal_1", why: "Test rationale" }],
  }),
  repairGraphWithAnthropic: vi.fn().mockResolvedValue({
    graph: {
      version: "1",
      default_seed: 17,
      nodes: [{ id: "goal_1", kind: "goal", label: "Repaired goal" }],
      edges: [],
      meta: { roots: ["goal_1"], leaves: ["goal_1"], suggested_positions: {}, source: "assistant" },
    },
    rationales: [],
  }),
}));

// Mock validation to return success by default
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, normalized: null, violations: [] }),
}));

describe("SSE Streaming Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /assist/draft-graph/stream", () => {
    it("always returns SSE stream", async () => {
      const app = Fastify();
      await draftRoute(app);

      const validPayload = {
        brief: "This is a comprehensive brief with at least 30 characters to pass validation",
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: validPayload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.body).toContain("event: stage");
      expect(res.body).toContain('"stage":"DRAFTING"');
      expect(res.body).toContain('"stage":"COMPLETE"');
    });

    it("returns SSE error format for invalid input", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "short" }, // Too short
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.body).toContain("event: stage");
      expect(res.body).toContain('"code":"BAD_INPUT"');
    });

    it("includes graph in COMPLETE stage", async () => {
      const app = Fastify();
      await draftRoute(app);

      const validPayload = {
        brief: "Create a strategic plan for product launch with multiple stakeholders",
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: validPayload,
      });

      expect(res.statusCode).toBe(200);

      // Parse SSE events
      const events = res.body
        .split("\n\n")
        .filter((block) => block.startsWith("event: stage"))
        .map((block) => {
          const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
          return dataLine ? JSON.parse(dataLine.replace("data: ", "")) : null;
        })
        .filter(Boolean);

      const completeEvent = events.find((e) => e.stage === "COMPLETE");
      expect(completeEvent).toBeDefined();
      expect(completeEvent.payload.graph).toBeDefined();
      expect(completeEvent.payload.graph.nodes).toBeDefined();
      expect(completeEvent.payload.graph.edges).toBeDefined();
    });
  });

  describe("POST /assist/draft-graph with Accept: text/event-stream", () => {
    it("returns SSE when Accept header includes text/event-stream", async () => {
      const app = Fastify();
      await draftRoute(app);

      const validPayload = {
        brief: "Develop a comprehensive strategy for market expansion into new regions",
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: validPayload,
        headers: {
          accept: "text/event-stream",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.body).toContain("event: stage");
    });

    it("returns JSON when Accept header does not include text/event-stream", async () => {
      const app = Fastify();
      await draftRoute(app);

      const validPayload = {
        brief: "Design a comprehensive project roadmap with clear milestones and deliverables",
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: validPayload,
        headers: {
          accept: "application/json",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");

      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      expect(body.patch).toBeDefined();
      expect(body.confidence).toBeDefined();
    });
  });

  describe("Fixture fallback behavior", () => {
    it("shows fixture if LLM takes longer than 2.5s", async () => {
      // Mock slow LLM response
      const { draftGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      vi.mocked(draftGraphWithAnthropic).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                graph: {
                  version: "1",
                  default_seed: 17,
                  nodes: [{ id: "slow_1", kind: "goal", label: "Slow response" }],
                  edges: [],
                  meta: { roots: ["slow_1"], leaves: ["slow_1"], suggested_positions: {}, source: "assistant" },
                },
                rationales: [],
              });
            }, 3000); // 3 seconds
          })
      );

      const app = Fastify();
      await draftRoute(app);

      const validPayload = {
        brief: "Complex analysis requiring deep thinking about strategic options and tradeoffs",
      };

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: validPayload,
      });

      expect(res.statusCode).toBe(200);

      // Parse events
      const events = res.body
        .split("\n\n")
        .filter((block) => block.startsWith("event: stage"))
        .map((block) => {
          const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
          return dataLine ? JSON.parse(dataLine.replace("data: ", "")) : null;
        })
        .filter(Boolean);

      // Should have: DRAFTING (initial), DRAFTING (with fixture), COMPLETE
      const draftingEvents = events.filter((e) => e.stage === "DRAFTING");
      expect(draftingEvents.length).toBeGreaterThanOrEqual(2);

      // Fixture should have source: "fixtures"
      const fixtureEvent = draftingEvents.find((e) => e.payload?.graph?.meta?.source === "fixtures");
      expect(fixtureEvent).toBeDefined();

      // Final should have actual result
      const completeEvent = events.find((e) => e.stage === "COMPLETE");
      expect(completeEvent).toBeDefined();
      expect(completeEvent.payload.graph.nodes[0].id).toBe("slow_1");
    }, 10000); // Increase timeout for this test
  });
});

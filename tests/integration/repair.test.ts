import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Mock Anthropic
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn(),
  repairGraphWithAnthropic: vi.fn(),
}));

// Mock validation
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn(),
}));

describe("Graph Repair Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("LLM-guided repair flow", () => {
    it("attempts LLM repair when validation fails", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import(
        "../../src/adapters/llm/anthropic.js"
      );
      const { validateGraph } = await import("../../src/services/validateClient.js");

      // Initial draft has violations
      const invalidGraph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "a", kind: "goal", label: "A" },
          { id: "b", kind: "decision", label: "B" },
          { id: "c", kind: "option", label: "C" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" }, // Creates cycle
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: invalidGraph,
        rationales: [],
      });

      // First validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Graph contains cycle: a -> b -> c -> a"],
        normalized: null,
      });

      // Repaired graph is valid
      const repairedGraph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "a", kind: "goal", label: "A" },
          { id: "b", kind: "decision", label: "B" },
          { id: "c", kind: "option", label: "C" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          // Cycle removed
        ],
        meta: { roots: ["a"], leaves: ["c"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(repairGraphWithAnthropic).mockResolvedValue({
        graph: repairedGraph,
        rationales: [],
      });

      // Second validation succeeds
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: repairedGraph,
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Create a strategic framework for evaluating product decisions with clear criteria",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(repairGraphWithAnthropic).toHaveBeenCalledWith({
        graph: expect.objectContaining({ nodes: expect.any(Array) }),
        violations: ["Graph contains cycle: a -> b -> c -> a"],
      });

      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      // Should not include the problematic cycle edge
      expect(body.graph.edges.length).toBe(2);
    });

    it("falls back to simple repair when LLM repair fails", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import(
        "../../src/adapters/llm/anthropic.js"
      );
      const { validateGraph } = await import("../../src/services/validateClient.js");

      const invalidGraph = {
        version: "1",
        default_seed: 17,
        nodes: Array.from({ length: 15 }, (_, i) => ({
          id: `node_${i}`,
          kind: "goal",
          label: `Node ${i}`,
        })),
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: invalidGraph,
        rationales: [],
      });

      // First validation fails (too many nodes)
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Graph has 15 nodes, max is 12"],
        normalized: null,
      });

      // LLM repair throws error
      vi.mocked(repairGraphWithAnthropic).mockRejectedValue(new Error("API timeout"));

      // Second validation after simple repair
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: invalidGraph.nodes.slice(0, 12),
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Analyze complex decision scenarios with extensive options and detailed evaluations",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(repairGraphWithAnthropic).toHaveBeenCalled();

      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      // Simple repair should trim to 12 nodes
      expect(body.graph.nodes.length).toBeLessThanOrEqual(12);
    });

    it("handles malformed LLM repair output gracefully", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import(
        "../../src/adapters/llm/anthropic.js"
      );
      const { validateGraph } = await import("../../src/services/validateClient.js");

      const invalidGraph = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "a", kind: "goal", label: "A" }],
        edges: [{ from: "a", to: "nonexistent" }], // Invalid edge
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: invalidGraph,
        rationales: [],
      });

      // First validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ['Edge references unknown node: "nonexistent"'],
        normalized: null,
      });

      // LLM repair returns malformed graph that will fail DAG validation
      vi.mocked(repairGraphWithAnthropic).mockResolvedValue({
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [
            { from: "a", to: "a" }, // Self-loop - will fail DAG check
          ],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        rationales: [],
      });

      // Second validation after fallback to simple repair
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "a", kind: "goal", label: "A" }],
          edges: [],
          meta: { roots: ["a"], leaves: ["a"], suggested_positions: {}, source: "assistant" },
        },
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Evaluate strategic alternatives for managing technical debt and feature development",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      // Should have cleaned up the invalid edge
      expect(body.graph.edges.every((e) => e.from !== e.to)).toBe(true);
    });
  });

  describe("Simple repair as fallback", () => {
    it("trims nodes to max 12", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const { validateGraph } = await import("../../src/services/validateClient.js");

      const largeGraph = {
        version: "1",
        default_seed: 17,
        nodes: Array.from({ length: 20 }, (_, i) => ({
          id: `node_${i}`,
          kind: "goal",
          label: `Node ${i}`,
        })),
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: largeGraph,
        rationales: [],
      });

      // Validation fails on initial graph
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Too many nodes"],
        normalized: null,
      });

      // LLM repair fails
      vi.mocked(repairGraphWithAnthropic).mockRejectedValue(new Error("Failed"));

      // Validation succeeds after simple repair
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: largeGraph.nodes.slice(0, 12),
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Comprehensive strategic planning for multi-year transformation initiative with stakeholders",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph.nodes.length).toBeLessThanOrEqual(12);
    });

    it("trims edges to max 24 and filters invalid references", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");
      const { validateGraph } = await import("../../src/services/validateClient.js");

      const nodes = Array.from({ length: 12 }, (_, i) => ({
        id: `node_${i}`,
        kind: "goal" as const,
        label: `Node ${i}`,
      }));

      const largeGraph = {
        version: "1",
        default_seed: 17,
        nodes,
        edges: [
          ...Array.from({ length: 30 }, (_, i) => ({
            from: `node_${i % 12}`,
            to: `node_${(i + 1) % 12}`,
          })),
          { from: "node_0", to: "nonexistent" }, // Invalid
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: largeGraph,
        rationales: [],
      });

      // Validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Too many edges", "Invalid edge reference"],
        normalized: null,
      });

      // LLM repair fails
      vi.mocked(repairGraphWithAnthropic).mockRejectedValue(new Error("Failed"));

      // Validation succeeds after simple repair
      const repairedNodes = nodes.slice(0, 12);
      const repairedEdges = largeGraph.edges
        .filter((e) => repairedNodes.some((n) => n.id === e.from) && repairedNodes.some((n) => n.id === e.to))
        .slice(0, 24);

      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: repairedNodes,
          edges: repairedEdges,
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      });

      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Design detailed workflow for complex approval process with multiple decision points and paths",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph.edges.length).toBeLessThanOrEqual(24);
      // Should not have invalid references
      const nodeIds = new Set(body.graph.nodes.map((n: { id: string }) => n.id));
      expect(body.graph.edges.every((e: { from: string; to: string }) => nodeIds.has(e.from) && nodeIds.has(e.to))).toBe(true);
    });
  });
});

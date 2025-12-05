import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

// Set provider to anthropic so router uses AnthropicAdapter (which calls mocked functions)
vi.stubEnv('LLM_PROVIDER', 'anthropic');

// Mock Anthropic
vi.mock("../../src/adapters/llm/anthropic.js", () => {
  const mockUsage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
  };

  const draftGraphWithAnthropic = vi.fn();
  const repairGraphWithAnthropic = vi.fn();

  // Create mock AnthropicAdapter class
  class AnthropicAdapter {
    readonly name = 'anthropic' as const;
    readonly model: string;

    constructor(model?: string) {
      this.model = model || 'claude-3-5-sonnet-20241022';
    }

    async draftGraph(args: any, _opts: any) {
      return draftGraphWithAnthropic(args);
    }

    async suggestOptions(_args: any, _opts: any) {
      return {
        options: [],
        usage: mockUsage,
      };
    }

    async repairGraph(args: any, _opts: any) {
      return repairGraphWithAnthropic(args);
    }
  }

  return {
    draftGraphWithAnthropic,
    repairGraphWithAnthropic,
    AnthropicAdapter,
  };
});

// Mock validation
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn(),
}));

// Mock usage data for Anthropic API responses
const mockUsage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 0,
};

describe("Graph Repair Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset adapter cache to ensure each test gets fresh adapters
    const { resetAdapterCache } = await import("../../src/adapters/llm/router.js");
    resetAdapterCache();
  });

  describe("LLM-guided repair flow", () => {
    it("attempts LLM repair when validation fails", async () => {
      const { draftGraphWithAnthropic, repairGraphWithAnthropic } = await import(
        "../../src/adapters/llm/anthropic.js"
      );
      const { validateGraph } = await import("../../src/services/validateClient.js");

      // Initial draft has violations (missing required provenance)
      const invalidGraph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "a", kind: "goal", label: "A" },
          { id: "b", kind: "decision", label: "B" },
          { id: "c", kind: "option", label: "C" },
        ],
        edges: [
          { from: "a", to: "b" }, // Valid DAG, but missing provenance
          { from: "b", to: "c" },
        ],
        meta: { roots: ["a"], leaves: ["c"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: invalidGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // First validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Missing provenance on edges"],
        normalized: undefined, // Type fix - will be replaced with fixtures in M4
      });

      // Repaired graph has provenance added
      const repairedGraph = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "a", kind: "goal", label: "A" },
          { id: "b", kind: "decision", label: "B" },
          { id: "c", kind: "option", label: "C" },
        ],
        edges: [
          {
            from: "a",
            to: "b",
            provenance: { source: "hypothesis", quote: "Strategic goal" },
            provenance_source: "hypothesis"
          },
          {
            from: "b",
            to: "c",
            provenance: { source: "hypothesis", quote: "Option analysis" },
            provenance_source: "hypothesis"
          },
        ],
        meta: { roots: ["a"], leaves: ["c"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(repairGraphWithAnthropic).mockResolvedValue({
        graph: repairedGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // Second validation succeeds
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: repairedGraph as any, // Mock data - will be replaced with fixtures in M4
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
        violations: ["Missing provenance on edges"],
      });

      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      // Should have 2 edges with provenance
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
          kind: i === 0 ? "goal" : "option",
          label: `Node ${i}`,
        })),
        // Add edges to prevent nodes from being pruned as isolated
        edges: Array.from({ length: 14 }, (_, i) => ({
          from: `node_${i}`,
          to: `node_${i + 1}`,
        })),
        meta: { roots: ["node_0"], leaves: ["node_14"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: invalidGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // First validation fails (too many nodes)
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Graph has 15 nodes, max is 12"],
        normalized: undefined, // Type fix - will be replaced with fixtures in M4
      });

      // LLM repair throws error
      vi.mocked(repairGraphWithAnthropic).mockRejectedValue(new Error("API timeout"));

      // Second validation after simple repair - should have 12 nodes with 11 edges
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: invalidGraph.nodes.slice(0, 12) as any, // Mock data - will be replaced with fixtures in M4
          edges: invalidGraph.edges.slice(0, 11), // 11 edges connecting 12 nodes
          meta: { roots: ["node_0"], leaves: ["node_11"], suggested_positions: {}, source: "assistant" as const },
        } as any,
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
        graph: invalidGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // First validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ['Edge references unknown node: "nonexistent"'],
        normalized: undefined, // Type fix - will be replaced with fixtures in M4
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
        usage: mockUsage,
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
      expect(body.graph.edges.every((e: any) => e.from !== e.to)).toBe(true);
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
          kind: i === 0 ? "goal" : "option",
          label: `Node ${i}`,
        })),
        // Add edges to prevent nodes from being pruned as isolated
        edges: Array.from({ length: 19 }, (_, i) => ({
          from: `node_${i}`,
          to: `node_${i + 1}`,
        })),
        meta: { roots: ["node_0"], leaves: ["node_19"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: largeGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // Validation fails on initial graph
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Too many nodes"],
        normalized: undefined, // Type fix - will be replaced with fixtures in M4
      });

      // LLM repair fails
      vi.mocked(repairGraphWithAnthropic).mockRejectedValue(new Error("Failed"));

      // Validation succeeds after simple repair - 12 nodes with 11 edges
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: true,
        violations: [],
        normalized: {
          version: "1",
          default_seed: 17,
          nodes: largeGraph.nodes.slice(0, 12) as any, // Mock data - will be replaced with fixtures in M4
          edges: largeGraph.edges.slice(0, 11), // 11 edges connecting 12 nodes
          meta: { roots: ["node_0"], leaves: ["node_11"], suggested_positions: {}, source: "assistant" as const },
        } as any,
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
          // Create a valid DAG with too many edges (30 instead of max 24)
          ...Array.from({ length: 30 }, (_, i) => ({
            from: `node_${Math.floor(i / 3)}`,
            to: `node_${Math.min(11, Math.floor(i / 3) + 1 + (i % 3))}`,
          })),
        ],
        meta: { roots: ["node_0"], leaves: ["node_11"], suggested_positions: {}, source: "assistant" },
      };

      vi.mocked(draftGraphWithAnthropic).mockResolvedValue({
        graph: largeGraph as any, // Mock data - will be replaced with fixtures in M4
        rationales: [],
        usage: mockUsage,
      });

      // Validation fails
      vi.mocked(validateGraph).mockResolvedValueOnce({
        ok: false,
        violations: ["Too many edges (30 > 24)"],
        normalized: undefined, // Type fix - will be replaced with fixtures in M4
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

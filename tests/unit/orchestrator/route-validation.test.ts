/**
 * Tests for route-boundary shape validation (C.1).
 * Verifies that graph and analysis_response schemas reject malformed inputs at the Zod level.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Re-create the schemas locally to test them in isolation
// (matches the schemas in src/orchestrator/route.ts)

const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string(),
}).passthrough().nullable();

describe("Route-Boundary Shape Validation (C.1)", () => {
  describe("GraphSchema", () => {
    it("accepts valid graph with nodes and edges", () => {
      const result = GraphSchema.safeParse({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "factor_1", kind: "factor", label: "Price" },
        ],
        edges: [
          { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts null graph (nullable)", () => {
      const result = GraphSchema.safeParse(null);
      expect(result.success).toBe(true);
    });

    it("rejects graph with nodes as string instead of array", () => {
      const result = GraphSchema.safeParse({
        nodes: "not an array",
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects graph with edges as string instead of array", () => {
      const result = GraphSchema.safeParse({
        nodes: [],
        edges: "not an array",
      });
      expect(result.success).toBe(false);
    });

    it("rejects graph with missing nodes", () => {
      const result = GraphSchema.safeParse({ edges: [] });
      expect(result.success).toBe(false);
    });

    it("rejects node without id", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ kind: "factor", label: "Price" }],
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects node without kind", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "factor_1", label: "Price" }],
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects edge without from", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "a", kind: "factor" }],
        edges: [{ to: "a" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects edge without to", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "a", kind: "factor" }],
        edges: [{ from: "a" }],
      });
      expect(result.success).toBe(false);
    });

    it("passes through extra fields on graph (passthrough)", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "goal_1", kind: "goal" }],
        edges: [],
        goal_node_id: "goal_1",
        version: "v3",
        extra_metadata: { foo: "bar" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).goal_node_id).toBe("goal_1");
      }
    });

    it("passes through extra fields on nodes (passthrough)", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "n1", kind: "factor", label: "X", custom: true }],
        edges: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data!.nodes[0] as any).custom).toBe(true);
      }
    });
  });

  describe("AnalysisResponseSchema", () => {
    it("accepts valid analysis_response with analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: "completed",
        results: [{ option_id: "a", win_probability: 0.6 }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts null analysis_response (nullable)", () => {
      const result = AnalysisResponseSchema.safeParse(null);
      expect(result.success).toBe(true);
    });

    it("rejects analysis_response missing analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        results: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects analysis_response with non-string analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: 42,
      });
      expect(result.success).toBe(false);
    });

    it("passes through extra fields (passthrough)", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: "completed",
        results: [],
        robustness: { level: "high" },
        custom_field: "extra",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).custom_field).toBe("extra");
      }
    });
  });
});

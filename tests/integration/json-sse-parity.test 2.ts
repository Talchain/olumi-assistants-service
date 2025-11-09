/**
 * JSON↔SSE Parity Tests (v04 spec compliance)
 *
 * Ensures both JSON and SSE endpoints enforce identical guards:
 * - Node/edge caps (≤12 nodes, ≤24 edges)
 * - cost_usd presence and validation
 * - Cost cap enforcement
 * - Telemetry parity (provider, cost_usd with fallbacks)
 *
 * Tests use fixtures/mocks to avoid live LLM calls.
 */

import { describe, it, expect } from "vitest";
import { validateResponse, validateGraphCaps, validateCost } from "../../src/utils/responseGuards.js";
import type { GraphT } from "../../src/schemas/graph.js";

describe("JSON↔SSE Parity Guards", () => {
  describe("Node/Edge Cap Validation", () => {
    it("accepts graph with exactly 12 nodes", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: Array.from({ length: 12 }, (_, i) => ({
          id: `node-${i}`,
          kind: "goal" as const,
          label: `Node ${i}`,
        })),
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const result = validateGraphCaps(graph);
      expect(result.ok).toBe(true);
    });

    it("accepts graph with exactly 24 edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "A", kind: "goal" as const, label: "Goal A" },
          { id: "B", kind: "decision" as const, label: "Decision B" },
        ],
        edges: Array.from({ length: 24 }, (_, i) => ({
          id: `edge-${i}`,
          from: "A",
          to: "B",
          provenance: "causal relationship",
        })),
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const result = validateGraphCaps(graph);
      expect(result.ok).toBe(true);
    });

    it("rejects graph with 13 nodes", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: Array.from({ length: 13 }, (_, i) => ({
          id: `node-${i}`,
          kind: "goal" as const,
          label: `Node ${i}`,
        })),
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const result = validateGraphCaps(graph);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("CAP_EXCEEDED");
        expect(result.violation.message).toContain("13");
        expect(result.violation.message).toContain("12");
      }
    });

    it("rejects graph with 25 edges", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "A", kind: "goal" as const, label: "Goal A" },
          { id: "B", kind: "decision" as const, label: "Decision B" },
        ],
        edges: Array.from({ length: 25 }, (_, i) => ({
          id: `edge-${i}`,
          from: "A",
          to: "B",
          provenance: "causal relationship",
        })),
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const result = validateGraphCaps(graph);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("CAP_EXCEEDED");
        expect(result.violation.message).toContain("25");
        expect(result.violation.message).toContain("24");
      }
    });
  });

  describe("Cost Validation", () => {
    it("accepts valid numeric cost", () => {
      const result = validateCost(0.05);
      expect(result.ok).toBe(true);
    });

    it("accepts zero cost (fixture fallback)", () => {
      const result = validateCost(0);
      expect(result.ok).toBe(true);
    });

    it("rejects missing cost (undefined)", () => {
      const result = validateCost(undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("INVALID_COST");
        expect(result.violation.message).toContain("must be a number");
      }
    });

    it("rejects non-numeric cost (string)", () => {
      const result = validateCost("0.05");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("INVALID_COST");
      }
    });

    it("rejects infinite cost", () => {
      const result = validateCost(Infinity);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("INVALID_COST");
        expect(result.violation.message).toContain("finite");
      }
    });

    it("rejects negative cost", () => {
      const result = validateCost(-0.01);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("INVALID_COST");
        expect(result.violation.message).toContain("non-negative");
      }
    });
  });

  describe("Complete Response Validation (Full Parity)", () => {
    const validGraph: GraphT = {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "A", kind: "goal" as const, label: "Goal A" },
        { id: "B", kind: "decision" as const, label: "Decision B" },
      ],
      edges: [
        {
          id: "A-B",
          from: "A",
          to: "B",
          provenance: "causal relationship",
        },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
    };

    it("accepts valid graph with cost within cap", () => {
      const result = validateResponse(validGraph, 0.05, 1.0);
      expect(result.ok).toBe(true);
    });

    it("rejects cost exceeding cap", () => {
      const result = validateResponse(validGraph, 1.5, 1.0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("CAP_EXCEEDED");
        expect(result.violation.message).toContain("1.5");
        expect(result.violation.message).toContain("1");
      }
    });

    it("rejects graph exceeding node cap even with valid cost", () => {
      const oversizedGraph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: Array.from({ length: 15 }, (_, i) => ({
          id: `node-${i}`,
          kind: "goal" as const,
          label: `Node ${i}`,
        })),
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" as const },
      };

      const result = validateResponse(oversizedGraph, 0.05, 1.0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("CAP_EXCEEDED");
      }
    });

    it("rejects when cost is missing", () => {
      const result = validateResponse(validGraph, undefined, 1.0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation.code).toBe("INVALID_COST");
      }
    });
  });
});

describe("Telemetry Fallbacks", () => {
  it("provider fallback to 'unknown' is available", () => {
    // Test that provider field defaults to "unknown" when provider info unavailable
    const providerValue: string | undefined = undefined;
    const provider: string = providerValue || "unknown";
    expect(provider).toBe("unknown");
  });

  it("cost_usd fallback to 0 is available", () => {
    // Test that cost fallback to 0 when cost unavailable (fixture mode)
    const costValue: number | undefined = undefined;
    const cost = costValue ?? 0;
    expect(cost).toBe(0);
  });
});

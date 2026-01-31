import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateGraph,
  GraphValidationError,
  formatErrorsForRepair,
  buildRepairPromptContext,
  type GraphLLMAdapter,
} from "../../src/cee/graph-orchestrator.js";
import { zodToValidationErrors, isZodError } from "../../src/validators/zod-error-mapper.js";
import { type GraphT } from "../../src/schemas/graph.js";
import { z } from "zod";

// =============================================================================
// Test Fixtures
// =============================================================================

function createValidGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Maximize Value" },
      { id: "dec_1", kind: "decision", label: "Main Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      {
        id: "fac_price",
        kind: "factor",
        label: "Price",
        category: "controllable",
        data: {
          value: 100,
          extractionType: "explicit",
          factor_type: "price",
          uncertainty_drivers: ["market volatility"],
        },
      },
      { id: "outcome_1", kind: "outcome", label: "Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, belief_exists: 1, origin: "ai" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, belief_exists: 1, origin: "ai" },
      // T2: Strict canonical requires strength_std: 0.01 and effect_direction for option→factor
      { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
      { from: "opt_b", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.7, belief_exists: 0.9, origin: "ai" },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.8, belief_exists: 0.95, origin: "ai" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function createInvalidGraphMissingGoal(): unknown {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Main Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, origin: "ai" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, origin: "ai" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function createZodInvalidGraph(): unknown {
  return {
    version: "1",
    nodes: [
      { id: "", kind: "goal", label: "Test" }, // Empty ID - Zod error
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function createGraphWithSignMismatch(): GraphT {
  const graph = createValidGraph();
  // Make strength_mean positive but effect_direction negative (sign mismatch)
  graph.edges[4] = {
    ...graph.edges[4],
    strength_mean: 0.7,
    effect_direction: "negative", // Mismatch!
  };
  return graph;
}

function _createGraphWithWarnings(): GraphT {
  const graph = createValidGraph();
  // Add warning-level issue: strength out of typical range
  graph.edges[4] = {
    ...graph.edges[4],
    strength_mean: 1.5, // Out of range (will be clamped, generates warning)
  };
  return graph;
}

// =============================================================================
// Mock Adapter
// =============================================================================

function createMockAdapter(overrides: Partial<GraphLLMAdapter> = {}): GraphLLMAdapter {
  return {
    draftGraph: vi.fn().mockResolvedValue({
      graph: createValidGraph(),
      usage: { input_tokens: 100, output_tokens: 200 },
    }),
    repairGraph: vi.fn().mockResolvedValue({
      graph: createValidGraph(),
      usage: { input_tokens: 150, output_tokens: 250 },
    }),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("generateGraph orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Happy path — valid graph on first attempt
  // -------------------------------------------------------------------------
  describe("happy path", () => {
    it("returns valid graph on first attempt without repair", async () => {
      const adapter = createMockAdapter();

      const result = await generateGraph(
        { brief: "Should we hire a contractor?", requestId: "test-1" },
        adapter
      );

      expect(result.graph).toBeDefined();
      expect(result.attempts).toBe(1);
      expect(result.repairUsed).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(adapter.draftGraph).toHaveBeenCalledTimes(1);
      expect(adapter.repairGraph).not.toHaveBeenCalled();
    });

    it("includes graph metadata in result", async () => {
      const adapter = createMockAdapter();

      const result = await generateGraph(
        { brief: "Test brief" },
        adapter
      );

      expect(result.graph.nodes).toHaveLength(6);
      expect(result.graph.edges).toHaveLength(6);
      expect(result.graph.version).toBe("1");
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Repair success — invalid graph → repair → valid
  // -------------------------------------------------------------------------
  describe("repair success", () => {
    it("repairs invalid graph and succeeds on second attempt", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();
      const validGraph = createValidGraph();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: invalidGraph,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        repairGraph: vi.fn().mockResolvedValue({
          graph: validGraph,
          usage: { input_tokens: 150, output_tokens: 250 },
        }),
      });

      const result = await generateGraph(
        { brief: "Test brief", requestId: "test-repair" },
        adapter
      );

      expect(result.attempts).toBe(2);
      expect(result.repairUsed).toBe(true);
      expect(adapter.draftGraph).toHaveBeenCalledTimes(1);
      expect(adapter.repairGraph).toHaveBeenCalledTimes(1);
      expect(result.graph.nodes.some((n) => n.kind === "goal")).toBe(true);
    });

    it("passes errors to repair adapter", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();
      const validGraph = createValidGraph();

      const repairFn = vi.fn().mockResolvedValue({
        graph: validGraph,
        usage: { input_tokens: 150, output_tokens: 250 },
      });

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: invalidGraph,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        repairGraph: repairFn,
      });

      await generateGraph({ brief: "Test brief" }, adapter);

      // Check that repair was called with errors
      const repairCall = repairFn.mock.calls[0];
      expect(repairCall[2]).toBeDefined(); // errors array
      expect(repairCall[2].length).toBeGreaterThan(0);
      expect(repairCall[2][0]).toHaveProperty("code");
      expect(repairCall[2][0]).toHaveProperty("message");
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Max retries exceeded — fails after 3 attempts
  // -------------------------------------------------------------------------
  describe("max retries exceeded", () => {
    it("throws GraphValidationError after exhausting all retries", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: invalidGraph,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        repairGraph: vi.fn().mockResolvedValue({
          graph: invalidGraph, // Still invalid
          usage: { input_tokens: 150, output_tokens: 250 },
        }),
      });

      await expect(
        generateGraph({ brief: "Test", maxRetries: 2 }, adapter)
      ).rejects.toThrow(GraphValidationError);

      // 1 draft + 2 repairs = 3 total attempts
      expect(adapter.draftGraph).toHaveBeenCalledTimes(1);
      expect(adapter.repairGraph).toHaveBeenCalledTimes(2);
    });

    it("includes errors and attempt count in thrown error", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({ graph: invalidGraph }),
        repairGraph: vi.fn().mockResolvedValue({ graph: invalidGraph }),
      });

      try {
        await generateGraph({ brief: "Test", maxRetries: 2 }, adapter);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GraphValidationError);
        const validationError = error as GraphValidationError;
        expect(validationError.attempts).toBe(3);
        expect(validationError.errors.length).toBeGreaterThan(0);
        expect(validationError.lastGraph).toBeDefined();
      }
    });

    it("respects custom maxRetries setting", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({ graph: invalidGraph }),
        repairGraph: vi.fn().mockResolvedValue({ graph: invalidGraph }),
      });

      try {
        await generateGraph({ brief: "Test", maxRetries: 1 }, adapter);
      } catch {
        // 1 draft + 1 repair = 2 total attempts
        expect(adapter.draftGraph).toHaveBeenCalledTimes(1);
        expect(adapter.repairGraph).toHaveBeenCalledTimes(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Zod failure triggers repair
  // -------------------------------------------------------------------------
  describe("Zod failure triggers repair", () => {
    it("triggers repair when Zod parse fails", async () => {
      const zodInvalidGraph = createZodInvalidGraph();
      const validGraph = createValidGraph();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: zodInvalidGraph,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        repairGraph: vi.fn().mockResolvedValue({
          graph: validGraph,
          usage: { input_tokens: 150, output_tokens: 250 },
        }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.attempts).toBe(2);
      expect(result.repairUsed).toBe(true);
      expect(adapter.repairGraph).toHaveBeenCalledTimes(1);
    });

    it("includes Zod errors in repair history", async () => {
      const zodInvalidGraph = createZodInvalidGraph();
      const validGraph = createValidGraph();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({ graph: zodInvalidGraph }),
        repairGraph: vi.fn().mockResolvedValue({ graph: validGraph }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.repairHistory).toBeDefined();
      expect(result.repairHistory!.length).toBe(1);
      expect(result.repairHistory![0].phase).toBe("zod");
      expect(result.repairHistory![0].errors.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Phase 2 (post-normalisation) failure triggers repair
  // -------------------------------------------------------------------------
  describe("post-normalisation failure triggers repair", () => {
    it("triggers repair when post-normalisation validation fails", async () => {
      const graphWithSignMismatch = createGraphWithSignMismatch();
      const validGraph = createValidGraph();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: graphWithSignMismatch,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        repairGraph: vi.fn().mockResolvedValue({
          graph: validGraph,
          usage: { input_tokens: 150, output_tokens: 250 },
        }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.attempts).toBe(2);
      expect(result.repairUsed).toBe(true);
    });

    it("records post_norm phase in repair history", async () => {
      const graphWithSignMismatch = createGraphWithSignMismatch();
      const validGraph = createValidGraph();

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({ graph: graphWithSignMismatch }),
        repairGraph: vi.fn().mockResolvedValue({ graph: validGraph }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.repairHistory).toBeDefined();
      expect(result.repairHistory!.some((r) => r.phase === "post_norm")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Warnings don't trigger repair
  // -------------------------------------------------------------------------
  describe("warnings don't trigger repair", () => {
    it("returns graph with warnings without triggering repair", async () => {
      // Create a valid graph that will generate warnings during normalisation
      const validGraph = createValidGraph();
      // Add a low std on non-structural edge to trigger LOW_STD_NON_STRUCTURAL warning
      validGraph.edges[4].strength_std = 0.02;

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({
          graph: validGraph,
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.attempts).toBe(1);
      expect(result.repairUsed).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(adapter.repairGraph).not.toHaveBeenCalled();
    });

    it("includes warning codes in result", async () => {
      const validGraph = createValidGraph();
      validGraph.edges[4].strength_std = 0.02; // Will trigger LOW_STD_NON_STRUCTURAL

      const adapter = createMockAdapter({
        draftGraph: vi.fn().mockResolvedValue({ graph: validGraph }),
      });

      const result = await generateGraph({ brief: "Test" }, adapter);

      expect(result.warnings.some((w) => w.code === "LOW_STD_NON_STRUCTURAL")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 7: Zod error mapping
  // -------------------------------------------------------------------------
  describe("Zod error mapping", () => {
    it("converts Zod errors to ValidationIssue format", () => {
      const schema = z.object({
        nodes: z.array(
          z.object({
            id: z.string().min(1),
            kind: z.enum(["goal", "decision", "option"]),
          })
        ),
      });

      const result = schema.safeParse({
        nodes: [{ id: "", kind: "invalid_kind" }],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = zodToValidationErrors(result.error);

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toHaveProperty("code");
        expect(errors[0]).toHaveProperty("severity", "error");
        expect(errors[0]).toHaveProperty("message");
        expect(errors[0]).toHaveProperty("path");
      }
    });

    it("extracts node/edge index from path", () => {
      const schema = z.object({
        nodes: z.array(z.object({ id: z.string().min(1) })),
      });

      const result = schema.safeParse({
        nodes: [{ id: "valid" }, { id: "" }],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = zodToValidationErrors(result.error);
        const errorWithIndex = errors.find((e) => e.context?.nodeIndex !== undefined);
        expect(errorWithIndex).toBeDefined();
        expect(errorWithIndex!.context!.nodeIndex).toBe(1);
      }
    });

    it("isZodError correctly identifies Zod errors", () => {
      const schema = z.string();
      const result = schema.safeParse(123);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isZodError(result.error)).toBe(true);
      }

      expect(isZodError(new Error("not zod"))).toBe(false);
      expect(isZodError(null)).toBe(false);
      expect(isZodError({ issues: "not an array" })).toBe(false);
    });
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("formatErrorsForRepair", () => {
  it("formats errors into numbered list", () => {
    const errors = [
      { code: "MISSING_GOAL" as const, severity: "error" as const, message: "Graph must have exactly 1 goal node" },
      { code: "INVALID_EDGE_TYPE" as const, severity: "error" as const, message: "Invalid edge from option to goal", path: "edges[2]" },
    ];

    const formatted = formatErrorsForRepair(errors);

    expect(formatted).toContain("1. [MISSING_GOAL]");
    expect(formatted).toContain("2. [INVALID_EDGE_TYPE] at edges[2]");
  });

  it("returns 'No errors' for empty array", () => {
    expect(formatErrorsForRepair([])).toBe("No errors");
  });
});

describe("buildRepairPromptContext", () => {
  it("includes brief, graph, and errors", () => {
    const brief = "Should we expand?";
    const graph = createValidGraph();
    const errors = [
      { code: "MISSING_GOAL" as const, severity: "error" as const, message: "Missing goal" },
    ];

    const context = buildRepairPromptContext(brief, graph, errors);

    expect(context).toContain("Should we expand?");
    expect(context).toContain('"nodes"');
    expect(context).toContain('"edges"');
    expect(context).toContain("MISSING_GOAL");
    expect(context).toContain("Fix ALL the errors");
  });
});

// =============================================================================
// validateAndRepairGraph Tests
// =============================================================================

import {
  validateAndRepairGraph,
  type RepairOnlyAdapter,
} from "../../src/cee/graph-orchestrator.js";

describe("validateAndRepairGraph", () => {
  describe("valid graph without repair adapter", () => {
    it("returns validated graph when graph is valid", async () => {
      const validGraph = createValidGraph();

      const result = await validateAndRepairGraph({
        graph: validGraph,
        brief: "Test decision",
        requestId: "test-123",
      });

      expect(result.graph).toBeDefined();
      expect(result.repairUsed).toBe(false);
      expect(result.repairAttempts).toBe(0);
      expect(result.graph.nodes).toHaveLength(6);
    });

    it("throws GraphValidationError when graph is invalid and no repair adapter", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      await expect(
        validateAndRepairGraph({
          graph: invalidGraph,
          brief: "Test decision",
          requestId: "test-456",
        })
      ).rejects.toThrow(GraphValidationError);
    });
  });

  describe("with repair adapter", () => {
    it("repairs invalid graph and returns validated result", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();
      const validGraph = createValidGraph();

      const repairAdapter: RepairOnlyAdapter = {
        repairGraph: vi.fn().mockResolvedValue({
          graph: validGraph,
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      };

      const result = await validateAndRepairGraph(
        {
          graph: invalidGraph,
          brief: "Test decision",
          requestId: "test-789",
          maxRetries: 1,
        },
        repairAdapter
      );

      expect(result.graph).toBeDefined();
      expect(result.repairUsed).toBe(true);
      expect(result.repairAttempts).toBeGreaterThan(0);
      expect(repairAdapter.repairGraph).toHaveBeenCalled();
    });

    it("throws GraphValidationError after max retries exceeded", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      const repairAdapter: RepairOnlyAdapter = {
        repairGraph: vi.fn().mockResolvedValue({
          graph: invalidGraph, // Return same invalid graph
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      };

      await expect(
        validateAndRepairGraph(
          {
            graph: invalidGraph,
            brief: "Test decision",
            requestId: "test-max-retries",
            maxRetries: 1,
          },
          repairAdapter
        )
      ).rejects.toThrow(GraphValidationError);

      // Should have tried repair once
      expect(repairAdapter.repairGraph).toHaveBeenCalled();
    });
  });

  describe("Zod validation", () => {
    it("catches malformed graphs via Zod", async () => {
      const malformedGraph = {
        version: "1",
        // Missing nodes and edges entirely
      };

      await expect(
        validateAndRepairGraph({
          graph: malformedGraph,
          brief: "Test",
          requestId: "test-zod",
        })
      ).rejects.toThrow(GraphValidationError);
    });
  });
});

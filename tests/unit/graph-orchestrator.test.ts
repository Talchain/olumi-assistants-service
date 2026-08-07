/**
 * graph-orchestrator — DETERMINISTIC validation tests.
 *
 * ROADMAP 2.740a removed every LLM limb from this module (and 2.731/#846
 * removed the draft-side ones before it). The tests that exercised
 * `generateGraph`, the repair adapter, and the repair-prompt builders went
 * with the code they tested.
 *
 * What did NOT go: the deterministic coverage those tests happened to carry.
 * Structural-edge normalisation, Zod mapping, post-normalisation validation
 * and the causal-edge preservation checks are all still here, re-routed
 * through `validateAndRepairGraph` — the surviving deterministic entry point.
 * Removing the LLM call is not removing the validator.
 */

import { describe, it, expect } from "vitest";
import {
  GraphValidationError,
  validateAndRepairGraph,
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

const idsOf = (g: any): string[] => (g?.nodes ?? []).map((n: any) => n.id).sort();

/**
 * Await a call that MUST reject with GraphValidationError, and return it
 * typed. Fails loudly if the promise resolves — a plain `.catch(e => e)`
 * would hand back the success result and let the assertions run against the
 * wrong object.
 */
async function rejectsWithValidationError(
  p: Promise<unknown>,
): Promise<GraphValidationError> {
  let result: unknown;
  try {
    result = await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GraphValidationError);
    return e as GraphValidationError;
  }
  throw new Error(
    `expected validateAndRepairGraph to reject with GraphValidationError, but it resolved: ${JSON.stringify(result)?.slice(0, 200)}`,
  );
}

// =============================================================================
// validateAndRepairGraph — the surviving deterministic entry point
// =============================================================================

describe("validateAndRepairGraph", () => {
  describe("valid graph", () => {
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

    it("2.740a: repairUsed/repairAttempts are permanently inert — there is no repair to report", async () => {
      const result = await validateAndRepairGraph({
        graph: createValidGraph(),
        brief: "Test decision",
        requestId: "test-inert",
      });

      expect(result.repairUsed).toBe(false);
      expect(result.repairAttempts).toBe(0);
    });
  });

  describe("invalid graph", () => {
    it("throws GraphValidationError when deterministic validation fails", async () => {
      const invalidGraph = createInvalidGraphMissingGoal();

      await expect(
        validateAndRepairGraph({
          graph: invalidGraph,
          brief: "Test decision",
          requestId: "test-456",
        })
      ).rejects.toThrow(GraphValidationError);
    });

    it("carries the validator's own MISSING_GOAL code on the thrown error", async () => {
      const error = await rejectsWithValidationError(
        validateAndRepairGraph({
          graph: createInvalidGraphMissingGoal(),
          brief: "Test decision",
          requestId: "test-codes",
        }),
      );

      expect(error.errors.map((e) => e.code)).toContain("MISSING_GOAL");
      expect(error.attempts).toBe(1);
    });

    /**
     * 2.740a provenance guard. Before the removal, `lastGraph` on a
     * repair-attempted path was the graph the LLM returned and the validator
     * then rejected — and substep 1b adopted it. With no adapter in the
     * module, lastGraph can only be a deterministic derivative of the input.
     * Bound by IDENTITY (node IDs), not by a value predicate.
     */
    it("2.740a: GraphValidationError.lastGraph is a deterministic derivative of the INPUT", async () => {
      const input = createInvalidGraphMissingGoal();

      const error = await rejectsWithValidationError(
        validateAndRepairGraph({
          graph: input,
          brief: "Test decision",
          requestId: "test-lastgraph",
        }),
      );

      expect(error.lastGraph).toBeDefined();
      expect(idsOf(error.lastGraph)).toEqual(idsOf(input));
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

    it("catches an empty node id via Zod, before any deterministic phase runs", async () => {
      const error = await rejectsWithValidationError(
        validateAndRepairGraph({
          graph: createZodInvalidGraph(),
          brief: "Test",
          requestId: "test-zod-empty-id",
        }),
      );

      expect(error.errors.length).toBeGreaterThan(0);
      // Zod failed before Phase 1.5, so nothing was normalised and there is
      // no graph to carry forward.
      expect(error.lastGraph).toBeUndefined();
    });
  });

  describe("post-normalisation validation", () => {
    // Re-routed from the deleted generateGraph suite: this is the only
    // coverage of the Phase-4 (post-normalisation) failure path.
    it("rejects a sign mismatch between effect_direction and strength_mean", async () => {
      const error = await rejectsWithValidationError(
        validateAndRepairGraph({
          graph: createGraphWithSignMismatch(),
          brief: "Test sign mismatch",
          requestId: "test-sign",
        }),
      );

      expect(error.errors.map((e) => e.code)).toContain("SIGN_MISMATCH");
    });
  });

  // -------------------------------------------------------------------------
  // Structural edge normalisation (re-routed from the deleted generateGraph
  // suite — deterministic behaviour, unaffected by the LLM removal)
  // -------------------------------------------------------------------------
  describe("structural edge normalisation", () => {
    it("normalises non-canonical option→factor edges before validation", async () => {
      // Graph with non-canonical option→factor edge values
      // All edges have required fields to pass validation
      const graphWithDriftedEdge: GraphT = {
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
          { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
          { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
          // Non-canonical option→factor edge - should be normalised
          {
            from: "opt_a",
            to: "fac_price",
            strength_mean: 0.95, // Drifted from 1.0
            strength_std: 0.08, // Drifted from 0.01
            belief_exists: 0.92, // Drifted from 1.0
            effect_direction: "positive",
            origin: "ai",
          },
          // Another non-canonical option→factor edge
          {
            from: "opt_b",
            to: "fac_price",
            strength_mean: 0.88,
            strength_std: 0.12,
            belief_exists: 0.9,
            effect_direction: "positive",
            origin: "ai",
          },
          // Causal edge - should NOT be normalised
          { from: "fac_price", to: "outcome_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive", origin: "ai" },
          { from: "outcome_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive", origin: "ai" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const result = await validateAndRepairGraph({
        graph: graphWithDriftedEdge,
        brief: "Test structural normalisation",
        requestId: "test-norm",
      });

      // Deterministic normalisation alone is enough — no repair exists to help.
      expect(result.repairUsed).toBe(false);
      expect(result.repairAttempts).toBe(0);

      // Find the option→factor edges in the result
      const optAToFactor = result.graph.edges.find(
        (e) => e.from === "opt_a" && e.to === "fac_price"
      );
      const optBToFactor = result.graph.edges.find(
        (e) => e.from === "opt_b" && e.to === "fac_price"
      );

      // Structural edges should have canonical values
      expect(optAToFactor?.strength_mean).toBe(1);
      expect(optAToFactor?.strength_std).toBe(0.01);
      expect(optAToFactor?.belief_exists).toBe(1);
      expect(optAToFactor?.effect_direction).toBe("positive");

      expect(optBToFactor?.strength_mean).toBe(1);
      expect(optBToFactor?.strength_std).toBe(0.01);
      expect(optBToFactor?.belief_exists).toBe(1);

      // Causal edge should be unchanged
      const causalEdge = result.graph.edges.find(
        (e) => e.from === "fac_price" && e.to === "outcome_1"
      );
      expect(causalEdge?.strength_mean).toBe(0.7);
      expect(causalEdge?.belief_exists).toBe(0.9);
    });

    it("does not normalise factor→factor causal edges", async () => {
      // Use the standard valid graph and check that causal edges remain unchanged
      const validGraph = createValidGraph();

      const result = await validateAndRepairGraph({
        graph: validGraph,
        brief: "Test causal edge preservation",
        requestId: "test-causal",
      });

      // Find the factor→outcome edge (causal, not structural)
      const causalEdge = result.graph.edges.find(
        (e) => e.from === "fac_price" && e.to === "outcome_1"
      );

      // Values should be unchanged - not normalised (it's 0.7, not 1.0)
      expect(causalEdge?.strength_mean).toBe(0.7);
      expect(causalEdge?.belief_exists).toBe(0.9);
    });
  });
});

// =============================================================================
// Zod error mapping (validators/zod-error-mapper — unaffected by 2.740a,
// kept here because this is where its coverage has always lived)
// =============================================================================

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

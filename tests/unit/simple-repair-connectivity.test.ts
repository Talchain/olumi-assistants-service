/**
 * Simple Repair Connectivity Tests
 *
 * Tests for the connectivity repair logic in simpleRepair:
 * - Preserving disconnected meaning without invented causal links
 * - Pruning nodes unreachable from decision
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { simpleRepair } from "../../src/services/repair.js";
import type { GraphT } from "../../src/schemas/graph.js";

/**
 * Helper to create test graphs without requiring all optional fields.
 * Zod applies defaults at runtime, but TypeScript type requires them.
 */
function createTestGraph(partial: {
  version?: string;
  default_seed?: number;
  nodes: GraphT["nodes"];
  edges: GraphT["edges"];
}): GraphT {
  return {
    version: partial.version ?? "1",
    default_seed: partial.default_seed ?? 42,
    nodes: partial.nodes,
    edges: partial.edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  };
}

// Mock telemetry to prevent actual logging during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  TelemetryEvents: {
    FactorBaselineDefaulted: "FactorBaselineDefaulted",
  },
}));

describe("simpleRepair connectivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["outcome", "risk"] as const)("retains disconnected %s meaning without synthetic causal links", (kind) => {
    const graph = createTestGraph({
      nodes: [
        { id: "dec_1", kind: "decision" }, { id: "opt_a", kind: "option" },
        { id: "fac_1", kind: "factor", category: "controllable" },
        { id: "fac_2", kind: "factor", category: "external" },
        { id: "pending", kind }, { id: "goal_1", kind: "goal" },
      ],
      edges: [{ from: "dec_1", to: "opt_a" }, { from: "opt_a", to: "fac_1" }],
    });
    const repaired = simpleRepair(graph);
    expect(repaired.nodes).toEqual(graph.nodes);
    expect(repaired.edges.map(({ from, to }) => ({ from, to }))).toEqual(graph.edges);
    expect(repaired.edges.some((edge) => edge.from === "pending" || edge.to === "pending")).toBe(false);
  });

  describe("pruneUnreachable", () => {
    it("preserves factor nodes unreachable from decision (factors are protected)", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "orphan_fac", kind: "factor", label: "Orphan Factor" }, // Not connected to decision
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "goal_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // orphan_fac has no incoming edges from decision path
        ],
      });

      const result = simpleRepair(graph);

      // orphan_fac (factor) is now protected — preserved for Monte Carlo priors
      expect(result.nodes.find((n) => n.id === "orphan_fac")).toBeDefined();

      // All nodes preserved
      expect(result.nodes.find((n) => n.id === "dec_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "opt_a")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "fac_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();
      expect(result.nodes.length).toBe(5);
    });

    it("does not prune protected kinds even when unreachable", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "orphan_outcome", kind: "outcome", label: "Orphan Outcome" }, // Unreachable but protected
          { id: "orphan_risk", kind: "risk", label: "Orphan Risk" }, // Unreachable but protected
          { id: "goal_1", kind: "goal", label: "Goal" }, // Unreachable but protected
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // No edges connecting outcome, risk, or goal to decision path
        ],
      });

      const result = simpleRepair(graph);

      // All protected kinds should be preserved even when unreachable
      expect(result.nodes.find((n) => n.id === "orphan_outcome")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "orphan_risk")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();
      expect(result.nodes.length).toBe(5); // All original nodes preserved
    });

    it("preserves disconnected protected nodes without manufacturing a goal link", () => {
      // The outcome exists even before its relation to the goal is specified.
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          // No edge from out_1 to goal_1 has been specified.
        ],
      });

      const result = simpleRepair(graph);

      // Protected nodes survive without inventing their relationships.
      expect(result.nodes.length).toBe(5);
      expect(result.nodes.find((n) => n.id === "out_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "goal_1")).toBeDefined();

      // No goal edge should be invented.
      const wiringEdge = result.edges.find(
        (e) => e.from === "out_1" && e.to === "goal_1"
      );
      expect(wiringEdge).toBeUndefined();
    });

    it("preserves edges from unreachable factor nodes (factors protected)", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "orphan_fac", kind: "factor", label: "Orphan Factor" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_1",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "fac_1",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          {
            from: "out_1",
            to: "goal_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // Edge FROM orphan_fac via valid pattern (factor→outcome)
          {
            from: "orphan_fac",
            to: "out_1",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // Edge from orphan factor is preserved (factors are protected, edge pattern is valid)
      const orphanEdge = result.edges.find((e) => e.from === "orphan_fac");
      expect(orphanEdge).toBeDefined();

      // Both factor→outcome edges preserved (fac_1→out_1 and orphan_fac→out_1)
      expect(result.edges.filter((e) => e.to === "out_1" && (e.from === "fac_1" || e.from === "orphan_fac")).length).toBe(2);
    });

    it("handles multiple unreachable factor nodes", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_main", kind: "factor", label: "Main Factor" },
          { id: "orphan_1", kind: "factor", label: "Orphan Factor 1" },
          { id: "orphan_2", kind: "factor", label: "Orphan Factor 2" },
          { id: "orphan_3", kind: "factor", label: "Orphan Factor 3" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          {
            from: "opt_a",
            to: "fac_main",
            strength_mean: 0.8,
            strength_std: 0.1,
            belief_exists: 0.9,
            effect_direction: "positive",
          },
          {
            from: "fac_main",
            to: "out_1",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
          {
            from: "out_1",
            to: "goal_1",
            strength_mean: 0.9,
            strength_std: 0.05,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
          // orphan_1 -> orphan_2 -> orphan_3 chain (all unreachable factors from dec_1)
          {
            from: "orphan_1",
            to: "orphan_2",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
          {
            from: "orphan_2",
            to: "orphan_3",
            strength_mean: 0.5,
            strength_std: 0.2,
            belief_exists: 0.7,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // All orphan factors preserved (factors are now protected for Monte Carlo priors)
      expect(result.nodes.find((n) => n.id === "orphan_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "orphan_2")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "orphan_3")).toBeDefined();

      // All 8 nodes preserved
      expect(result.nodes.length).toBe(8);

      // Valid edges: dec→opt, opt→fac, fac→out, out→goal, orphan_1→orphan_2, orphan_2→orphan_3
      expect(result.edges.length).toBe(6);
    });

    it("preserves external factors with outbound-only causal edges", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_ctrl", kind: "factor", label: "Controllable Factor" },
          { id: "fac_competition", kind: "factor", label: "Competition" },
          { id: "fac_regulations", kind: "factor", label: "Regulations" },
          { id: "out_market_share", kind: "outcome", label: "Market Share" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" as const },
          { from: "opt_a", to: "fac_ctrl", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" as const },
          // External factors have OUTBOUND-only causal edges (no inbound from decision chain)
          { from: "fac_competition", to: "out_market_share", strength_mean: -0.6, strength_std: 0.2, belief_exists: 0.8, effect_direction: "negative" as const },
          { from: "fac_regulations", to: "out_market_share", strength_mean: -0.4, strength_std: 0.25, belief_exists: 0.7, effect_direction: "negative" as const },
          { from: "fac_ctrl", to: "out_market_share", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" as const },
          { from: "out_market_share", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" as const },
        ],
      });

      const result = simpleRepair(graph);

      // External factors must survive (protected kind)
      expect(result.nodes.find((n) => n.id === "fac_competition")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "fac_regulations")).toBeDefined();

      // Their causal edges must survive
      expect(result.edges.find((e) => e.from === "fac_competition" && e.to === "out_market_share")).toBeDefined();
      expect(result.edges.find((e) => e.from === "fac_regulations" && e.to === "out_market_share")).toBeDefined();

      // All 7 nodes preserved
      expect(result.nodes.length).toBe(7);
    });
  });

  describe("edge cases", () => {
    it("handles empty graph", () => {
      const graph = createTestGraph({
        nodes: [],
        edges: [],
      });

      const result = simpleRepair(graph);

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });

    it("handles graph with only decision", () => {
      const graph = createTestGraph({
        nodes: [{ id: "dec_1", kind: "decision", label: "Decision" }],
        edges: [],
      });

      const result = simpleRepair(graph);

      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].id).toBe("dec_1");
    });

    it("skips pruning when no decision nodes exist", () => {
      // Malformed graph without decision - should skip pruning to avoid over-deletion
      const graph = createTestGraph({
        nodes: [
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "fac_2", kind: "factor", label: "Factor 2" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          {
            from: "fac_1",
            to: "fac_2",
            strength_mean: 0.7,
            strength_std: 0.15,
            belief_exists: 0.85,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      // All nodes preserved (pruning skipped due to no decision)
      expect(result.nodes.length).toBe(3);
      expect(result.nodes.find((n) => n.id === "fac_1")).toBeDefined();
      expect(result.nodes.find((n) => n.id === "fac_2")).toBeDefined();
    });

    it("preserves graph metadata through repair", () => {
      const graph = createTestGraph({
        default_seed: 123,
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
        ],
        edges: [
          {
            from: "dec_1",
            to: "opt_a",
            strength_mean: 1.0,
            strength_std: 0.01,
            belief_exists: 1.0,
            effect_direction: "positive",
          },
        ],
      });

      const result = simpleRepair(graph);

      expect(result.version).toBe("1");
      expect(result.default_seed).toBe(123);
    });
  });

  describe("invalid edge pattern removal", () => {
    it("removes outcome→outcome edges", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "out_2", kind: "outcome", label: "Outcome 2" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
          { from: "opt_a", to: "fac_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
          { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { from: "out_1", to: "out_2", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
        ],
      });
      const result = simpleRepair(graph);
      const invalidEdges = result.edges.filter((e) => {
        const fNode = result.nodes.find((n) => n.id === e.from);
        const tNode = result.nodes.find((n) => n.id === e.to);
        return fNode?.kind === "outcome" && tNode?.kind === "outcome";
      });
      expect(invalidEdges).toHaveLength(0);
    });

    it("removes outcome→risk edges", () => {
      const graph = createTestGraph({
        nodes: [
          { id: "dec_1", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "Option A" },
          { id: "fac_1", kind: "factor", label: "Factor 1" },
          { id: "out_1", kind: "outcome", label: "Outcome 1" },
          { id: "risk_1", kind: "risk", label: "Risk 1" },
          { id: "goal_1", kind: "goal", label: "Goal" },
        ],
        edges: [
          { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
          { from: "opt_a", to: "fac_1", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
          { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.5, effect_direction: "positive" },
        ],
      });
      const result = simpleRepair(graph);
      const invalidEdges = result.edges.filter((e) => {
        const fNode = result.nodes.find((n) => n.id === e.from);
        const tNode = result.nodes.find((n) => n.id === e.to);
        return fNode?.kind === "outcome" && tNode?.kind === "risk";
      });
      expect(invalidEdges).toHaveLength(0);
    });
  });

  describe("baseline value consistency", () => {
    it("controllable factor with no stated value gets an EXPLICIT UNKNOWN, not a 0.5 default", async () => {
      // The block was named "baseline default value consistency" and asserted
      // agreement on `0.5` between Stage 1 and the deterministic sweep's safety
      // net. Stage 1 no longer defaults: a factor with no stated value now says
      // so. The safety net still writes 0.5, but only for a factor carrying
      // NEITHER a value nor an explicit unknown — a shape Stage 1 no longer
      // produces — so there is no shared constant left to keep consistent.
      const { ensureControllableFactorBaselines } = await import("../../src/adapters/llm/normalisation.js");
      const response = {
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "opt_a", kind: "option", label: "A" },
          { id: "fac_1", kind: "factor", label: "F", category: "controllable" },
          { id: "goal_1", kind: "goal", label: "G" },
        ],
        edges: [{ from: "dec_1", to: "opt_a" }, { from: "opt_a", to: "fac_1" }],
      };
      const result = ensureControllableFactorBaselines(response);
      const factor = result.response.nodes.find((n: any) => n.id === "fac_1");
      expect(result.unquantifiedFactors).toContain("fac_1");
      expect(factor?.data?.value).toBeUndefined();
      expect(factor?.prior).toEqual({
        distribution: "uniform",
        range_min: 0,
        range_max: 1,
        prior_is_unquantified: true,
      });
      expect(factor?.data?.extractionType).toBe("inferred");
    });
  });
});

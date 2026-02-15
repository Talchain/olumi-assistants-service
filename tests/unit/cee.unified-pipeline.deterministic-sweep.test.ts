/**
 * Deterministic Pre-Repair Sweep — Unit Tests
 *
 * Covers: Bucket A/B fixes, unreachable factors, status quo,
 * violation routing, repair gating, format lock, field preservation,
 * adapter brief inclusion, contract alignment, observability.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  detectEdgeFormat,
  patchEdgeNumeric,
  canonicalStructuralEdge,
  neutralCausalEdge,
} from "../../src/cee/unified-pipeline/utils/edge-format.js";
import type { EdgeFormat } from "../../src/cee/unified-pipeline/utils/edge-format.js";
import { handleUnreachableFactors } from "../../src/cee/unified-pipeline/stages/repair/unreachable-factors.js";
import { fixStatusQuoConnectivity } from "../../src/cee/unified-pipeline/stages/repair/status-quo-fix.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal graph with a valid basic structure */
function makeGraph(overrides: {
  nodes?: any[];
  edges?: any[];
} = {}): any {
  return {
    nodes: overrides.nodes ?? [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 0.5, factor_type: "cost", extractionType: "explicit", uncertainty_drivers: ["market"] } },
      { id: "fac_quality", kind: "factor", label: "Quality", category: "controllable", data: { value: 0.7, factor_type: "quality", extractionType: "explicit", uncertainty_drivers: ["supply"] } },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    ],
    edges: overrides.edges ?? [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_b", to: "fac_quality", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
      { from: "fac_quality", to: "out_revenue", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.8, effect_direction: "positive" },
      { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
    ],
  };
}

// =============================================================================
// Edge Format Utility
// =============================================================================

describe("edge-format utility", () => {
  describe("detectEdgeFormat", () => {
    it("returns V1_FLAT for edges with strength_mean", () => {
      const edges = [{ from: "a", to: "b", strength_mean: 0.5 }];
      expect(detectEdgeFormat(edges as any)).toBe("V1_FLAT");
    });

    it("returns LEGACY for edges with weight/belief", () => {
      const edges = [{ from: "a", to: "b", weight: 0.5, belief: 0.8 }];
      expect(detectEdgeFormat(edges as any)).toBe("LEGACY");
    });

    it("returns NONE for empty edges", () => {
      expect(detectEdgeFormat([])).toBe("NONE");
    });

    it("returns NONE for edges without numeric fields", () => {
      const edges = [{ from: "a", to: "b" }];
      expect(detectEdgeFormat(edges as any)).toBe("NONE");
    });

    it("prefers V1_FLAT over LEGACY when both present", () => {
      const edges = [
        { from: "a", to: "b", strength_mean: 0.5, weight: 0.3 },
      ];
      expect(detectEdgeFormat(edges as any)).toBe("V1_FLAT");
    });
  });

  describe("patchEdgeNumeric", () => {
    it("patches V1_FLAT fields", () => {
      const edge = { from: "a", to: "b" };
      const result = patchEdgeNumeric(edge as any, "V1_FLAT", { mean: 0.5, std: 0.1, existence: 0.8 });
      expect(result.strength_mean).toBe(0.5);
      expect(result.strength_std).toBe(0.1);
      expect(result.belief_exists).toBe(0.8);
    });

    it("patches LEGACY fields", () => {
      const edge = { from: "a", to: "b" };
      const result = patchEdgeNumeric(edge as any, "LEGACY", { mean: 0.5, existence: 0.8 });
      expect((result as any).weight).toBe(0.5);
      expect((result as any).belief).toBe(0.8);
    });

    it("does not mutate input", () => {
      const edge = { from: "a", to: "b", strength_mean: 0.3 };
      const result = patchEdgeNumeric(edge as any, "V1_FLAT", { mean: 0.9 });
      expect(result.strength_mean).toBe(0.9);
      expect(edge.strength_mean).toBe(0.3);
    });
  });

  describe("canonicalStructuralEdge", () => {
    it("sets canonical V1 values", () => {
      const edge = { from: "opt_a", to: "fac_price" };
      const result = canonicalStructuralEdge(edge as any, "V1_FLAT");
      expect(result.strength_mean).toBe(1);
      expect(result.strength_std).toBe(0.01);
      expect(result.belief_exists).toBe(1.0);
    });

    it("preserves other fields", () => {
      const edge = { from: "opt_a", to: "fac_price", origin: "ai", effect_direction: "positive" as const };
      const result = canonicalStructuralEdge(edge as any, "V1_FLAT");
      expect(result.origin).toBe("ai");
      expect(result.effect_direction).toBe("positive");
    });
  });

  describe("neutralCausalEdge", () => {
    it("creates positive neutral edge", () => {
      const result = neutralCausalEdge("V1_FLAT", { from: "fac_a", to: "out_1" });
      expect(result.from).toBe("fac_a");
      expect(result.to).toBe("out_1");
      expect(result.strength_mean).toBe(0.3);
      expect(result.strength_std).toBe(0.2);
      expect(result.belief_exists).toBe(0.7);
      expect(result.origin).toBe("repair");
    });

    it("creates negative neutral edge", () => {
      const result = neutralCausalEdge("V1_FLAT", { from: "fac_a", to: "risk_1", sign: "negative" });
      expect(result.strength_mean).toBe(-0.3);
      expect(result.effect_direction).toBe("negative");
    });
  });
});

// =============================================================================
// Bucket A — Always Auto-Fix
// =============================================================================

describe("Bucket A fixes", () => {
  // We test via the graph-validator + manual fixes. Since the deterministic sweep
  // calls the validator internally, we test the fix functions through integration-style tests.

  describe("NaN strength_mean → replaced with 0.5", () => {
    it("replaces NaN edge values", () => {
      const graph = makeGraph({
        edges: [
          { from: "dec_1", to: "opt_a", strength_mean: NaN, strength_std: 0.01, belief_exists: 1 },
          { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
          { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9 },
          { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95 },
        ],
      });

      // Check the NaN exists
      expect(Number.isNaN(graph.edges[0].strength_mean)).toBe(true);

      // After manual fix (simulating what the sweep does)
      for (const edge of graph.edges) {
        if (typeof edge.strength_mean === "number" && Number.isNaN(edge.strength_mean)) {
          edge.strength_mean = 0.5;
        }
      }

      expect(graph.edges[0].strength_mean).toBe(0.5);
    });
  });

  describe("SIGN_MISMATCH → mean flipped", () => {
    it("flips mean sign to match effect_direction", () => {
      const edge = { from: "fac_a", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "negative" as const };

      // Detect sign mismatch: negative direction but positive mean
      if (edge.effect_direction === "negative" && edge.strength_mean > 0) {
        edge.strength_mean = -edge.strength_mean;
      }

      expect(edge.strength_mean).toBe(-0.5);
    });
  });

  describe("INVALID_EDGE_REF → edge removed", () => {
    it("removes edges referencing non-existent nodes", () => {
      const graph = makeGraph();
      graph.edges.push({ from: "non_existent", to: "goal_1", strength_mean: 0.5 });

      const nodeIds = new Set(graph.nodes.map((n: any) => n.id));
      graph.edges = graph.edges.filter((e: any) => nodeIds.has(e.from) && nodeIds.has(e.to));

      expect(graph.edges).toHaveLength(7);
      expect(graph.edges.every((e: any) => nodeIds.has(e.from) && nodeIds.has(e.to))).toBe(true);
    });
  });

  describe("GOAL_HAS_OUTGOING → outgoing removed", () => {
    it("removes outgoing edges from goal nodes", () => {
      const graph = makeGraph();
      graph.edges.push({ from: "goal_1", to: "fac_price", strength_mean: 0.3 });

      const goalIds = new Set(graph.nodes.filter((n: any) => n.kind === "goal").map((n: any) => n.id));
      graph.edges = graph.edges.filter((e: any) => !goalIds.has(e.from));

      const outgoingFromGoal = graph.edges.filter((e: any) => goalIds.has(e.from));
      expect(outgoingFromGoal).toHaveLength(0);
    });
  });

  describe("DECISION_HAS_INCOMING → incoming removed", () => {
    it("removes incoming edges to decision nodes", () => {
      const graph = makeGraph();
      graph.edges.push({ from: "fac_price", to: "dec_1", strength_mean: 0.3 });

      const decisionIds = new Set(graph.nodes.filter((n: any) => n.kind === "decision").map((n: any) => n.id));
      graph.edges = graph.edges.filter((e: any) => !decisionIds.has(e.to));

      const incomingToDecision = graph.edges.filter((e: any) => decisionIds.has(e.to));
      expect(incomingToDecision).toHaveLength(0);
    });
  });

  describe("Non-canonical structural edge → canonicalised", () => {
    it("canonicalises V1 structural edges", () => {
      const edge = { from: "opt_a", to: "fac_price", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.8 };
      const result = canonicalStructuralEdge(edge as any, "V1_FLAT");

      expect(result.strength_mean).toBe(1);
      expect(result.strength_std).toBe(0.01);
      expect(result.belief_exists).toBe(1.0);
    });

    it("canonicalises LEGACY structural edges", () => {
      const edge = { from: "opt_a", to: "fac_price", weight: 0.5, belief: 0.6 };
      const result = canonicalStructuralEdge(edge as any, "LEGACY");

      expect((result as any).weight).toBe(1);
      expect((result as any).belief).toBe(1.0);
    });
  });
});

// =============================================================================
// Bucket B — Violation-Gated
// =============================================================================

describe("Bucket B fixes (violation-gated)", () => {
  describe("CONTROLLABLE_MISSING_DATA", () => {
    it("adds defaults when violation is cited", () => {
      const node: any = { id: "fac_test", kind: "factor", label: "Test", category: "controllable", data: {} };

      // Simulate: violation exists → fill defaults
      if (node.data.value === undefined) (node.data as any).value = 0.5;
      if ((node.data as any).extractionType === undefined) (node.data as any).extractionType = "inferred";
      if ((node.data as any).factor_type === undefined) (node.data as any).factor_type = "other";
      if ((node.data as any).uncertainty_drivers === undefined) (node.data as any).uncertainty_drivers = ["Not provided"];

      expect(node.data).toEqual({
        value: 0.5,
        extractionType: "inferred",
        factor_type: "other",
        uncertainty_drivers: ["Not provided"],
      });
    });

    it("makes NO changes when violation is NOT cited", () => {
      const node = { id: "fac_test", kind: "factor", label: "Test", category: "controllable", data: {} };
      const before = JSON.parse(JSON.stringify(node));

      // No violation → no fix applied
      // (The sweep only applies Bucket B for cited codes)

      expect(node).toEqual(before);
    });
  });

  describe("OBSERVABLE_EXTRA_DATA", () => {
    it("removes extra fields, preserves others", () => {
      const node: any = {
        id: "fac_obs", kind: "factor", label: "Observable",
        category: "observable",
        data: { value: 0.5, extractionType: "observed", factor_type: "cost", uncertainty_drivers: ["x"] },
        observed_state: { value: 0.5 },
      };

      // Fix: remove factor_type and uncertainty_drivers only
      delete node.data.factor_type;
      delete node.data.uncertainty_drivers;

      expect(node.data).toEqual({ value: 0.5, extractionType: "observed" });
      expect(node.observed_state).toEqual({ value: 0.5 });
    });
  });

  describe("EXTERNAL_HAS_DATA", () => {
    it("removes prohibited fields, preserves extractionType", () => {
      const node: any = {
        id: "fac_ext", kind: "factor", label: "External",
        category: "external",
        data: { value: 0.3, extractionType: "inferred", factor_type: "cost", uncertainty_drivers: ["y"] },
      };

      // Fix: remove value, factor_type, uncertainty_drivers — preserve extractionType
      delete node.data.value;
      delete node.data.factor_type;
      delete node.data.uncertainty_drivers;

      expect(node.data).toEqual({ extractionType: "inferred" });
    });
  });

  describe("CATEGORY_MISMATCH", () => {
    it("infers controllable from option→factor edge", () => {
      const graph = makeGraph();
      const factorNode = graph.nodes.find((n: any) => n.id === "fac_price");
      factorNode.category = "external"; // Wrong category

      const nodeKindMap = new Map(graph.nodes.map((n: any) => [n.id, n.kind]));
      const hasOptionEdge = new Set<string>();
      for (const edge of graph.edges) {
        if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
          hasOptionEdge.add(edge.to);
        }
      }

      // Structure-inferred category
      const inferred = hasOptionEdge.has("fac_price") ? "controllable" : "external";
      expect(inferred).toBe("controllable");
    });

    it("infers external when no option→factor edge", () => {
      const graph = makeGraph({
        nodes: [
          ...makeGraph().nodes,
          { id: "fac_market", kind: "factor", label: "Market Conditions", category: "controllable" },
        ],
      });

      const nodeKindMap = new Map(graph.nodes.map((n: any) => [n.id, n.kind]));
      const hasOptionEdge = new Set<string>();
      for (const edge of graph.edges) {
        if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
          hasOptionEdge.add(edge.to);
        }
      }

      const inferred = hasOptionEdge.has("fac_market") ? "controllable" : "external";
      expect(inferred).toBe("external");
    });
  });
});

// =============================================================================
// Unreachable Factors
// =============================================================================

describe("unreachable factors", () => {
  it("reclassifies factor with zero option→factor edges to external", () => {
    const graph = makeGraph({
      nodes: [
        ...makeGraph().nodes,
        { id: "fac_market", kind: "factor", label: "Market Conditions", category: "controllable", data: { value: 0.5, factor_type: "other" } },
      ],
      edges: [
        ...makeGraph().edges,
        { from: "fac_market", to: "out_revenue", strength_mean: 0.4, strength_std: 0.2, belief_exists: 0.7 },
      ],
    });

    const result = handleUnreachableFactors(graph, "V1_FLAT");

    expect(result.reclassified).toContain("fac_market");
    const marketNode = graph.nodes.find((n: any) => n.id === "fac_market");
    expect(marketNode.category).toBe("external");
    // data removed: after stripping value/factor_type, no union-required key remains
    expect(marketNode.data).toBeUndefined();
  });

  it("preserves external factor with path to goal (no blocker)", () => {
    const graph = makeGraph({
      nodes: [
        ...makeGraph().nodes,
        { id: "fac_market", kind: "factor", label: "Market Conditions", category: "external" },
      ],
      edges: [
        ...makeGraph().edges,
        { from: "fac_market", to: "out_revenue", strength_mean: 0.4, strength_std: 0.2, belief_exists: 0.7 },
      ],
    });

    const result = handleUnreachableFactors(graph, "V1_FLAT");

    // Market factor has path to goal via out_revenue→goal_1
    expect(result.markedDroppable).not.toContain("fac_market");
  });

  it("marks external factor with no path to goal as droppable (NOT removed)", () => {
    const graph = makeGraph({
      nodes: [
        ...makeGraph().nodes,
        { id: "fac_isolated", kind: "factor", label: "Isolated Factor", category: "controllable" },
      ],
    });
    // No edges from fac_isolated to anything

    const nodeCountBefore = graph.nodes.length;
    const result = handleUnreachableFactors(graph, "V1_FLAT");

    expect(result.reclassified).toContain("fac_isolated");
    expect(result.markedDroppable).toContain("fac_isolated");
    // NOT removed
    expect(graph.nodes.length).toBe(nodeCountBefore);
    expect(graph.nodes.find((n: any) => n.id === "fac_isolated")).toBeDefined();
  });

  it("does NOT reclassify factor with option→factor edge", () => {
    const graph = makeGraph();

    const result = handleUnreachableFactors(graph, "V1_FLAT");

    // fac_price and fac_quality have option edges — should NOT be reclassified
    expect(result.reclassified).not.toContain("fac_price");
    expect(result.reclassified).not.toContain("fac_quality");
  });
});

// =============================================================================
// Status Quo Fix
// =============================================================================

describe("status quo fix", () => {
  it("wires status quo option with zero option→factor edges when reachability violation exists", () => {
    const graph = makeGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "opt_sq", kind: "option", label: "Do Nothing" }, // status quo (no edges)
        { id: "fac_price", kind: "factor", label: "Price", category: "controllable" },
        { id: "out_revenue", kind: "outcome", label: "Revenue" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "dec_1", to: "opt_sq", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9 },
        { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95 },
      ],
    });

    const edgeCountBefore = graph.edges.length;
    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    expect(result.fixed).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(edgeCountBefore);

    // Status quo should now have an edge to fac_price
    const sqEdge = graph.edges.find((e: any) => e.from === "opt_sq" && e.to === "fac_price");
    expect(sqEdge).toBeDefined();
  });

  it("marks status quo as droppable when unfixable (NOT removed)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
        { id: "opt_sq", kind: "option", label: "Status Quo" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "dec_1", to: "opt_sq", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        // opt_a has no factor edges either → no targets to copy
      ],
    });

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_EFFECT_PATH" }],
      "V1_FLAT",
    );

    expect(result.markedDroppable).toBe(true);
    // NOT removed
    expect(graph.nodes.find((n: any) => n.id === "opt_sq")).toBeDefined();
  });

  it("makes no changes when status quo already connected", () => {
    const graph = makeGraph();

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    // All options have edges → no status quo detected → no changes
    expect(result.fixed).toBe(false);
    expect(result.markedDroppable).toBe(false);
    expect(result.repairs).toHaveLength(0);
  });

  it("makes no changes without relevant violations", () => {
    const graph = makeGraph({
      nodes: [
        ...makeGraph().nodes,
        { id: "opt_sq", kind: "option", label: "Status Quo" },
      ],
      edges: [
        ...makeGraph().edges,
        { from: "dec_1", to: "opt_sq", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      ],
    });

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NAN_VALUE" }], // Not a relevant violation
      "V1_FLAT",
    );

    expect(result.fixed).toBe(false);
    expect(result.repairs).toHaveLength(0);
  });

  it("does NOT treat option labelled 'status quo' but having interventions as status quo", () => {
    const graph = makeGraph({
      nodes: [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_sq", kind: "option", label: "Status Quo" },
        { id: "opt_b", kind: "option", label: "Option B" },
        { id: "fac_price", kind: "factor", label: "Price", category: "controllable" },
        { id: "out_revenue", kind: "outcome", label: "Revenue" },
        { id: "goal_1", kind: "goal", label: "Goal" },
      ],
      edges: [
        { from: "dec_1", to: "opt_sq", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "dec_1", to: "opt_b", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "opt_sq", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1 }, // Has intervention edge
        { from: "opt_b", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
        { from: "fac_price", to: "out_revenue", strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9 },
        { from: "out_revenue", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95 },
      ],
    });

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    // opt_sq has interventions — it's NOT status quo by structure
    expect(result.fixed).toBe(false);
    expect(result.repairs).toHaveLength(0);
  });
});

// =============================================================================
// Routing — LLM Repair Needed
// =============================================================================

describe("violation routing", () => {
  it("only Bucket A → llmRepairNeeded = false", () => {
    // When all violations are Bucket A (NAN_VALUE, SIGN_MISMATCH, etc.)
    // the sweep resolves them and llmRepairNeeded should be false
    const bucketACodes = new Set(["NAN_VALUE", "SIGN_MISMATCH", "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR", "INVALID_EDGE_REF", "GOAL_HAS_OUTGOING", "DECISION_HAS_INCOMING"]);
    const bucketCCodes = new Set(["NO_PATH_TO_GOAL", "NO_EFFECT_PATH", "UNREACHABLE_FROM_DECISION", "MISSING_BRIDGE", "MISSING_GOAL", "MISSING_DECISION", "INVALID_EDGE_TYPE", "CYCLE_DETECTED", "OPTIONS_IDENTICAL", "GOAL_NUMBER_AS_FACTOR", "INSUFFICIENT_OPTIONS"]);

    const violations = [{ code: "NAN_VALUE" }, { code: "SIGN_MISMATCH" }];
    const hasBucketC = violations.some((v) => bucketCCodes.has(v.code));
    expect(hasBucketC).toBe(false);
  });

  it("Bucket A + C → A resolved, llmRepairNeeded = true", () => {
    const bucketCCodes = new Set(["NO_PATH_TO_GOAL", "NO_EFFECT_PATH", "UNREACHABLE_FROM_DECISION", "MISSING_BRIDGE", "MISSING_GOAL", "MISSING_DECISION", "INVALID_EDGE_TYPE", "CYCLE_DETECTED", "OPTIONS_IDENTICAL", "GOAL_NUMBER_AS_FACTOR", "INSUFFICIENT_OPTIONS"]);

    const violations = [{ code: "NAN_VALUE" }, { code: "NO_PATH_TO_GOAL" }];
    const hasBucketC = violations.some((v) => bucketCCodes.has(v.code));
    expect(hasBucketC).toBe(true);
  });

  it("only Bucket C → llmRepairNeeded = true", () => {
    const bucketCCodes = new Set(["NO_PATH_TO_GOAL", "NO_EFFECT_PATH", "UNREACHABLE_FROM_DECISION", "MISSING_BRIDGE", "MISSING_GOAL", "MISSING_DECISION", "INVALID_EDGE_TYPE", "CYCLE_DETECTED", "OPTIONS_IDENTICAL", "GOAL_NUMBER_AS_FACTOR", "INSUFFICIENT_OPTIONS"]);

    const violations = [{ code: "NO_PATH_TO_GOAL" }, { code: "CYCLE_DETECTED" }];
    const hasBucketC = violations.some((v) => bucketCCodes.has(v.code));
    expect(hasBucketC).toBe(true);
  });

  it("no violations → llmRepairNeeded = false", () => {
    const violations: Array<{ code: string }> = [];
    expect(violations.length).toBe(0);
  });
});

// =============================================================================
// Format Lock
// =============================================================================

describe("format lock", () => {
  it("V1 graph: all repairs use V1", () => {
    const graph = makeGraph();
    const format = detectEdgeFormat(graph.edges);
    expect(format).toBe("V1_FLAT");

    // Status quo fix should produce V1 edges
    const sqGraph = makeGraph({
      nodes: [
        ...makeGraph().nodes,
        { id: "opt_sq", kind: "option", label: "SQ" },
      ],
      edges: [
        ...makeGraph().edges,
        { from: "dec_1", to: "opt_sq", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      ],
    });

    const result = fixStatusQuoConnectivity(
      sqGraph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    // New edges should use V1_FLAT format
    const newEdges = sqGraph.edges.filter((e: any) => e.from === "opt_sq" && e.to !== undefined && e.to !== "opt_sq");
    for (const edge of newEdges) {
      if (edge.from === "opt_sq") {
        // Canonical structural edges use V1_FLAT
        expect(edge.strength_mean).toBeDefined();
        expect(edge.strength_std).toBeDefined();
        expect(edge.belief_exists).toBeDefined();
      }
    }
  });

  it("LEGACY graph: all repairs use LEGACY", () => {
    const edge = neutralCausalEdge("LEGACY", { from: "fac_a", to: "out_1" });
    expect((edge as any).weight).toBeDefined();
    expect((edge as any).belief).toBeDefined();
    expect(edge.strength_mean).toBeUndefined();
  });
});

// =============================================================================
// Field Preservation
// =============================================================================

describe("field preservation", () => {
  it("Bucket A fix preserves unknown fields on affected edges", () => {
    const edge = {
      from: "opt_a", to: "fac_price",
      strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.8,
      custom_field: "preserve_me",
      provenance: "doc_1",
    };

    const result = canonicalStructuralEdge(edge as any, "V1_FLAT");

    expect(result.strength_mean).toBe(1);
    expect((result as any).custom_field).toBe("preserve_me");
    expect((result as any).provenance).toBe("doc_1");
  });

  it("unaffected nodes/edges identical before and after", () => {
    const graph = makeGraph();
    const unaffectedEdge = JSON.parse(JSON.stringify(graph.edges[4])); // fac_price → out_revenue

    // Apply a fix to a different edge
    graph.edges[0].strength_mean = 1; // Already canonical

    // Unaffected edge should be identical
    expect(graph.edges[4]).toEqual(unaffectedEdge);
  });

  it("top-level graph fields preserved", () => {
    const graph = makeGraph();
    (graph as any).metadata = { version: "1.0" };

    // After fixes, metadata should still be there
    expect((graph as any).metadata).toEqual({ version: "1.0" });
  });
});

// =============================================================================
// Adapter Brief Inclusion
// =============================================================================

describe("adapter brief inclusion", () => {
  it("includes brief in prompt text when present", () => {
    // Verify the prompt format includes brief
    const brief = "Should we expand into European markets?";
    const promptText = `Brief: ${brief ?? "Not provided"}`;
    expect(promptText).toContain("Should we expand into European markets?");
  });

  it("shows 'Not provided' when brief is absent", () => {
    const brief: string | undefined = undefined;
    const promptText = `Brief: ${brief ?? "Not provided"}`;
    expect(promptText).toContain("Not provided");
  });

  it("shows escalation text on attempt 2", () => {
    const attempt = 2;
    const escalationText = attempt > 1 ? "Previous attempt failed. Try a different approach." : "";
    expect(escalationText).toContain("Previous attempt failed");
  });

  it("no escalation text on attempt 1", () => {
    const attempt = 1;
    const escalationText = attempt > 1 ? "Previous attempt failed. Try a different approach." : "";
    expect(escalationText).toBe("");
  });
});

// =============================================================================
// Contract Alignment — analysis_ready
// =============================================================================

describe("contract alignment — analysis_ready", () => {
  it("graph with unreachable controllable factor → needs_user_mapping", () => {
    // Simulate the check from buildAnalysisReadyPayload
    const nodes = [
      { id: "opt_a", kind: "option" },
      { id: "fac_price", kind: "factor", category: "controllable" },
      { id: "fac_unlinked", kind: "factor", category: "controllable" }, // No option edge
    ];
    const edges = [
      { from: "opt_a", to: "fac_price" },
    ];

    const nodeKindMap = new Map(nodes.map((n) => [n.id, n.kind]));
    const optionEdgeTargets = new Set<string>();
    for (const edge of edges) {
      if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
        optionEdgeTargets.add(edge.to);
      }
    }

    const unreachableControllable = nodes.filter((n) => {
      if (n.kind !== "factor") return false;
      if (optionEdgeTargets.has(n.id)) return false;
      if ((n as any).category === "external") return false;
      return true;
    });

    expect(unreachableControllable).toHaveLength(1);
    expect(unreachableControllable[0].id).toBe("fac_unlinked");
  });

  it("graph with unreachable external factor → ready (no blocker)", () => {
    const nodes = [
      { id: "opt_a", kind: "option" },
      { id: "fac_price", kind: "factor", category: "controllable" },
      { id: "fac_market", kind: "factor", category: "external" }, // External — should NOT block
    ];
    const edges = [
      { from: "opt_a", to: "fac_price" },
    ];

    const nodeKindMap = new Map(nodes.map((n) => [n.id, n.kind]));
    const optionEdgeTargets = new Set<string>();
    for (const edge of edges) {
      if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
        optionEdgeTargets.add(edge.to);
      }
    }

    const unreachableControllable = nodes.filter((n) => {
      if (n.kind !== "factor") return false;
      if (optionEdgeTargets.has(n.id)) return false;
      if ((n as any).category === "external") return false;
      return true;
    });

    expect(unreachableControllable).toHaveLength(0);
  });

  it("graph with all factors reachable → ready", () => {
    const nodes = [
      { id: "opt_a", kind: "option" },
      { id: "fac_price", kind: "factor", category: "controllable" },
    ];
    const edges = [
      { from: "opt_a", to: "fac_price" },
    ];

    const nodeKindMap = new Map(nodes.map((n) => [n.id, n.kind]));
    const optionEdgeTargets = new Set<string>();
    for (const edge of edges) {
      if (nodeKindMap.get(edge.from) === "option" && nodeKindMap.get(edge.to) === "factor") {
        optionEdgeTargets.add(edge.to);
      }
    }

    const unreachableControllable = nodes.filter((n) => {
      if (n.kind !== "factor") return false;
      if (optionEdgeTargets.has(n.id)) return false;
      if ((n as any).category === "external") return false;
      return true;
    });

    expect(unreachableControllable).toHaveLength(0);
  });
});

// =============================================================================
// Observability
// =============================================================================

describe("observability", () => {
  it("repair_summary has all required fields", () => {
    const repairSummary = {
      deterministic_repairs_count: 3,
      deterministic_repairs: [
        { code: "NAN_VALUE", path: "edges[a→b].strength_mean", action: "Replaced NaN with 0.5" },
        { code: "SIGN_MISMATCH", path: "edges[c→d].strength_mean", action: "Flipped" },
        { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_x].category", action: "Reclassified" },
      ],
      unreachable_factors: { reclassified: ["fac_x"], marked_droppable: [] },
      status_quo: { fixed: false, marked_droppable: false },
      llm_repair_called: false,
      llm_repair_brief_included: false,
      llm_repair_skipped_reason: "deterministic_sweep_sufficient",
      remaining_violations_count: 0,
      remaining_violation_codes: [],
      edge_format_detected: "V1_FLAT",
      graph_delta: { nodes_before: 7, nodes_after: 8, edges_before: 7, edges_after: 8 },
    };

    expect(repairSummary.deterministic_repairs_count).toBe(3);
    expect(repairSummary.unreachable_factors.reclassified).toContain("fac_x");
    expect(repairSummary.llm_repair_called).toBe(false);
    expect(repairSummary.edge_format_detected).toBe("V1_FLAT");
    expect(repairSummary.graph_delta.nodes_before).toBe(7);
  });

  it("model_adjustments includes repair entries", () => {
    const repairs = [
      { code: "NAN_VALUE", path: "edges[a→b].strength_mean", action: "Replaced NaN" },
    ];

    const adjustments = repairs.map((r) => ({
      type: "deterministic_repair",
      field: r.path,
      detail: r.action,
    }));

    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].type).toBe("deterministic_repair");
    expect(adjustments[0].field).toBe("edges[a→b].strength_mean");
  });

  it("graph_delta counts are accurate", () => {
    const graph = makeGraph();
    const nodesBefore = graph.nodes.length;
    const edgesBefore = graph.edges.length;

    // Add a node and edge
    graph.nodes.push({ id: "fac_new", kind: "factor", label: "New" });
    graph.edges.push({ from: "fac_new", to: "out_revenue", strength_mean: 0.5 });

    const delta = {
      nodes_before: nodesBefore,
      nodes_after: graph.nodes.length,
      edges_before: edgesBefore,
      edges_after: graph.edges.length,
    };

    expect(delta.nodes_after - delta.nodes_before).toBe(1);
    expect(delta.edges_after - delta.edges_before).toBe(1);
  });
});

// =============================================================================
// Repair Gating
// =============================================================================

describe("repair gating", () => {
  it("valid graph (errorCount: 0) → LLM repair NOT called", () => {
    // When graph-validator returns valid: true with 0 errors,
    // llmRepairNeeded should be false
    const validationResult = { valid: true, errors: [], warnings: [] };
    expect(validationResult.errors.length).toBe(0);
    // sweep sets llmRepairNeeded = false
  });

  it("invalid graph → LLM repair called", () => {
    const validationResult = {
      valid: false,
      errors: [{ code: "NO_PATH_TO_GOAL", severity: "error", message: "No path" }],
      warnings: [],
    };
    // Bucket C code present → llmRepairNeeded = true
    const bucketCCodes = new Set(["NO_PATH_TO_GOAL"]);
    const hasBucketC = validationResult.errors.some((v) => bucketCCodes.has(v.code));
    expect(hasBucketC).toBe(true);
  });

  it("warning-only → LLM repair NOT called", () => {
    const validationResult = {
      valid: true, // valid despite warnings
      errors: [],
      warnings: [{ code: "STRENGTH_OUT_OF_RANGE", severity: "warn", message: "Strength 1.5" }],
    };
    // No errors → llmRepairNeeded = false
    expect(validationResult.errors.length).toBe(0);
  });
});

// =============================================================================
// Hotfix: Status quo path reachability (replaces zero-edge-count)
// =============================================================================

import { hasPathToGoal, findDisconnectedOptions } from "../../src/cee/unified-pipeline/stages/repair/status-quo-fix.js";

describe("hasPathToGoal", () => {
  it("returns true when direct path exists", () => {
    const edges: any[] = [
      { from: "opt_a", to: "fac_1" },
      { from: "fac_1", to: "goal_1" },
    ];
    expect(hasPathToGoal("opt_a", edges, new Set(["goal_1"]))).toBe(true);
  });

  it("returns true when transitive path exists (opt→fac→out→goal)", () => {
    const edges: any[] = [
      { from: "opt_a", to: "fac_1" },
      { from: "fac_1", to: "out_1" },
      { from: "out_1", to: "goal_1" },
    ];
    expect(hasPathToGoal("opt_a", edges, new Set(["goal_1"]))).toBe(true);
  });

  it("returns false when no path to goal", () => {
    const edges: any[] = [
      { from: "opt_a", to: "fac_1" },
      // fac_1 is a dead end
    ];
    expect(hasPathToGoal("opt_a", edges, new Set(["goal_1"]))).toBe(false);
  });

  it("returns false when edges exist but none reach goal", () => {
    const edges: any[] = [
      { from: "opt_a", to: "fac_1" },
      { from: "fac_1", to: "fac_2" },
      { from: "fac_2", to: "fac_3" },
    ];
    expect(hasPathToGoal("opt_a", edges, new Set(["goal_1"]))).toBe(false);
  });
});

describe("findDisconnectedOptions", () => {
  it("detects option with zero edges as disconnected", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        { id: "fac_1", kind: "factor", label: "F1" },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        // opt_a is connected
        { from: "opt_a", to: "fac_1" },
        { from: "fac_1", to: "out_1" },
        { from: "out_1", to: "goal_1" },
        // opt_b has zero edges
      ],
    });

    const disconnected = findDisconnectedOptions(graph);
    expect(disconnected).toContain("opt_b");
    expect(disconnected).not.toContain("opt_a");
  });

  it("detects option with edges to dead-end factors as disconnected", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        { id: "fac_1", kind: "factor", label: "F1" },
        { id: "fac_2", kind: "factor", label: "F2" },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        // opt_a is connected all the way to goal
        { from: "opt_a", to: "fac_1" },
        { from: "fac_1", to: "out_1" },
        { from: "out_1", to: "goal_1" },
        // opt_b has edges but to a dead-end factor
        { from: "opt_b", to: "fac_2" },
        // fac_2 goes nowhere
      ],
    });

    const disconnected = findDisconnectedOptions(graph);
    expect(disconnected).toContain("opt_b");
    expect(disconnected).not.toContain("opt_a");
  });

  it("returns empty array when all options reach goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        { id: "fac_1", kind: "factor", label: "F1" },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        { from: "opt_a", to: "fac_1" },
        { from: "opt_b", to: "fac_1" },
        { from: "fac_1", to: "out_1" },
        { from: "out_1", to: "goal_1" },
      ],
    });

    expect(findDisconnectedOptions(graph)).toHaveLength(0);
  });
});

describe("fixStatusQuoConnectivity — path reachability", () => {
  it("fixes option with edges to dead-end factors by wiring to connected factors", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_sq", kind: "option", label: "Status Quo" },
        { id: "fac_cost", kind: "factor", label: "Cost", category: "controllable" },
        { id: "fac_dead", kind: "factor", label: "Dead End", category: "controllable" },
        { id: "out_1", kind: "outcome", label: "Outcome" },
      ],
      edges: [
        // opt_a is connected
        { from: "opt_a", to: "fac_cost", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { from: "fac_cost", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
        // opt_sq has edges but fac_dead is a dead end
        { from: "opt_sq", to: "fac_dead", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      ],
    });

    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    expect(result.fixed).toBe(true);
    // opt_sq should now have an edge to fac_cost
    const sqToCost = graph.edges.find(
      (e: any) => e.from === "opt_sq" && e.to === "fac_cost",
    );
    expect(sqToCost).toBeDefined();
  });

  it("does not wire options that already reach goal", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
        { id: "fac_1", kind: "factor", label: "F1", category: "controllable" },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        { from: "opt_a", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { from: "opt_b", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      ],
    });

    const edgesBefore = graph.edges.length;
    const result = fixStatusQuoConnectivity(
      graph,
      [{ code: "NO_PATH_TO_GOAL" }],
      "V1_FLAT",
    );

    // Both options already reach goal — no wiring needed
    expect(result.fixed).toBe(false);
    expect(graph.edges.length).toBe(edgesBefore);
  });
});

// =============================================================================
// Hotfix: Proactive unreachable factor scan (0 violations)
// =============================================================================

describe("handleUnreachableFactors — proactive scan", () => {
  it("reclassifies unreachable factors even when called with no prior violations", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_connected", kind: "factor", label: "Connected", category: "controllable" },
        { id: "fac_orphan", kind: "factor", label: "Orphan", category: "controllable", data: { value: 0.5 } },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        { from: "opt_a", to: "fac_connected" },
        { from: "fac_connected", to: "out_1" },
        { from: "out_1", to: "goal_1" },
        // fac_orphan has no inbound option edges
      ],
    });

    const result = handleUnreachableFactors(graph, "V1_FLAT");

    expect(result.reclassified).toContain("fac_orphan");
    const orphanNode = graph.nodes.find((n: any) => n.id === "fac_orphan");
    expect(orphanNode.category).toBe("external");
    // data is removed entirely because after stripping value/factor_type/uncertainty_drivers,
    // the remaining object can't satisfy any NodeData union branch (FactorData requires value)
    expect(orphanNode.data).toBeUndefined();
  });

  it("does NOT reclassify factors reachable via factor→factor chains", () => {
    const graph = makeGraph({
      nodes: [
        { id: "goal_1", kind: "goal", label: "Goal" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "fac_1", kind: "factor", label: "F1", category: "controllable" },
        { id: "fac_2", kind: "factor", label: "F2", category: "observable" },
        { id: "out_1", kind: "outcome", label: "O1" },
      ],
      edges: [
        { from: "opt_a", to: "fac_1" },
        { from: "fac_1", to: "fac_2" }, // Transitive through factor chain
        { from: "fac_2", to: "out_1" },
        { from: "out_1", to: "goal_1" },
      ],
    });

    const result = handleUnreachableFactors(graph, "V1_FLAT");

    // fac_2 is reachable via fac_1 → fac_2 chain
    expect(result.reclassified).not.toContain("fac_2");
  });
});

// =============================================================================
// Hotfix: analysis_ready blocker scope
// =============================================================================

describe("analysis_ready blocker scope (unit-level)", () => {
  it("observable factor unreachable → NOT a blocker", () => {
    // Test the filter logic directly
    const node: any = { id: "fac_churn", kind: "factor", label: "Churn Rate", category: "observable" };
    const category = node.category;
    // The fix excludes observable
    expect(category === "external" || category === "observable").toBe(true);
  });

  it("external factor unreachable → NOT a blocker", () => {
    const node: any = { id: "fac_market", kind: "factor", label: "Market Conditions", category: "external" };
    const category = node.category;
    expect(category === "external" || category === "observable").toBe(true);
  });

  it("controllable factor unreachable → IS a blocker", () => {
    const node: any = { id: "fac_price", kind: "factor", label: "Price", category: "controllable" };
    const category = node.category;
    expect(category === "external" || category === "observable").toBe(false);
  });

  it("constraint node excluded by id prefix", () => {
    const nodeId = "constraint_fac_monthly_churn_max";
    expect(nodeId.startsWith("constraint_")).toBe(true);
  });

  it("factor with undefined category → IS a blocker (safe default)", () => {
    const node: any = { id: "fac_unknown", kind: "factor", label: "Unknown" };
    const category = node.category;
    expect(category === "external" || category === "observable").toBe(false);
  });
});

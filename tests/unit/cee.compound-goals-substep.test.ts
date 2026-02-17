/**
 * Compound Goals Substep — Tests
 *
 * Verifies that the compound goals substep (Stage 4 Substep 5) correctly
 * extracts constraints, remaps targets against actual graph nodes, and
 * emits goal_constraints[] WITHOUT adding constraint nodes/edges to the graph.
 *
 * Constraint data lives only in goal_constraints[] — constraints are metadata,
 * not causal factors (F.6: CEE generates, PLoT computes, UI displays).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the compound-goal module to provide controlled constraint outputs
vi.mock("../../src/cee/compound-goal/index.js", () => ({
  extractCompoundGoals: vi.fn(),
  toGoalConstraints: vi.fn(),
  remapConstraintTargets: vi.fn(),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runCompoundGoals } from "../../src/cee/unified-pipeline/stages/repair/compound-goals.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  remapConstraintTargets,
} from "../../src/cee/compound-goal/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Record<string, any>): any {
  return {
    requestId: "test-compound-goals",
    effectiveBrief: "Grow revenue to £1M while keeping churn under 5%",
    graph: {
      nodes: [
        { id: "g1", kind: "goal", label: "Grow Revenue" },
        { id: "d1", kind: "decision", label: "Strategy" },
        { id: "o1", kind: "option", label: "Option A" },
        { id: "fac_retention_rate", kind: "factor", label: "Customer Retention Rate" },
        { id: "fac_monthly_churn", kind: "factor", label: "Monthly Churn Rate" },
        { id: "out_revenue", kind: "outcome", label: "Revenue" },
      ],
      edges: [
        { from: "d1", to: "o1", strength_mean: 1 },
        { from: "o1", to: "fac_retention_rate", strength_mean: 0.7 },
        { from: "fac_retention_rate", to: "out_revenue", strength_mean: 0.8 },
      ],
    },
    goalConstraints: undefined,
    ...overrides,
  };
}

function setupMocksForConstraints(opts: {
  /** Constraints returned after remapping */
  remappedConstraints?: Array<{ targetName: string; targetNodeId: string; operator?: string; value?: number }>;
  remapResult?: { remapped: number; rejected_junk: number; rejected_no_match: number };
}) {
  const extractedConstraints = [{ targetName: "churn", targetNodeId: "fac_churn", operator: "<=", value: 0.05 }];
  const validConstraints = opts.remappedConstraints ?? extractedConstraints;

  (extractCompoundGoals as any).mockReturnValue({
    constraints: extractedConstraints,
    isCompound: true,
    warnings: [],
  });
  (remapConstraintTargets as any).mockReturnValue({
    constraints: validConstraints,
    ...(opts.remapResult ?? { remapped: 0, rejected_junk: 0, rejected_no_match: 0 }),
  });
  (toGoalConstraints as any).mockReturnValue(
    validConstraints.map((c: any) => ({
      constraint_id: `constraint_${c.targetNodeId}_max`,
      node_id: c.targetNodeId,
      operator: c.operator ?? "<=",
      value: c.value ?? 0.05,
    })),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runCompoundGoals — constraint extraction (no graph mutation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits goal_constraints when remapConstraintTargets returns valid constraints", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
      remapResult: { remapped: 1, rejected_junk: 0, rejected_no_match: 0 },
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // goal_constraints should be populated
    expect(ctx.goalConstraints).toHaveLength(1);
    expect(ctx.goalConstraints[0].node_id).toBe("fac_monthly_churn");
  });

  it("does NOT add constraint nodes to the graph", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
      remapResult: { remapped: 1, rejected_junk: 0, rejected_no_match: 0 },
    });

    const ctx = makeCtx();
    const originalNodeCount = ctx.graph.nodes.length;
    const originalEdgeCount = ctx.graph.edges.length;
    runCompoundGoals(ctx);

    // Graph must not be mutated — no constraint_ nodes or edges
    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
    expect(ctx.graph.nodes.every((n: any) => !n.id.startsWith("constraint_"))).toBe(true);
    expect(ctx.graph.edges.every((e: any) => !e.from.startsWith("constraint_"))).toBe(true);
  });

  it("drops all constraints when remapConstraintTargets returns empty", () => {
    (extractCompoundGoals as any).mockReturnValue({
      constraints: [{ targetName: "unknown", targetNodeId: "fac_totally_unknown", operator: "<=", value: 0.05 }],
      isCompound: true,
      warnings: [],
    });
    (remapConstraintTargets as any).mockReturnValue({
      constraints: [],
      remapped: 0,
      rejected_junk: 0,
      rejected_no_match: 1,
    });

    const ctx = makeCtx();
    const originalEdgeCount = ctx.graph.edges.length;
    const originalNodeCount = ctx.graph.nodes.length;
    runCompoundGoals(ctx);

    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
    expect(ctx.goalConstraints).toBeUndefined();
  });

  it("emits goal_constraints for exact match constraints", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "retention_rate", targetNodeId: "fac_retention_rate", operator: ">=", value: 0.85 }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    expect(ctx.goalConstraints).toHaveLength(1);
    expect(ctx.goalConstraints[0].node_id).toBe("fac_retention_rate");
  });

  it("handles multiple constraints with mixed outcomes after remapping", () => {
    const validConstraints = [
      { targetName: "customer_retention", targetNodeId: "fac_retention_rate" },
      { targetName: "retention_rate", targetNodeId: "fac_retention_rate" },
    ];
    (extractCompoundGoals as any).mockReturnValue({
      constraints: [
        { targetName: "customer_retention", targetNodeId: "fac_customer_retention" },
        { targetName: "retention_rate", targetNodeId: "fac_retention_rate" },
        { targetName: "unknown_metric", targetNodeId: "fac_unknown_metric" },
      ],
      isCompound: true,
      warnings: [],
    });
    (remapConstraintTargets as any).mockReturnValue({
      constraints: validConstraints,
      remapped: 1,
      rejected_junk: 0,
      rejected_no_match: 1,
    });
    (toGoalConstraints as any).mockReturnValue([
      { constraint_id: "c1", node_id: "fac_retention_rate" },
      { constraint_id: "c2", node_id: "fac_retention_rate" },
    ]);

    const ctx = makeCtx();
    const originalNodeCount = ctx.graph.nodes.length;
    const originalEdgeCount = ctx.graph.edges.length;
    runCompoundGoals(ctx);

    // goal_constraints should have 2 entries
    expect(ctx.goalConstraints).toHaveLength(2);

    // Graph must not be mutated
    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
  });

  it("passes graph node IDs and labels to remapConstraintTargets", () => {
    const extractedConstraints = [
      { targetName: "churn", targetNodeId: "fac_churn", operator: "<=", value: 0.05 },
    ];
    (extractCompoundGoals as any).mockReturnValue({
      constraints: extractedConstraints,
      isCompound: true,
      warnings: [],
    });
    (remapConstraintTargets as any).mockReturnValue({
      constraints: extractedConstraints,
      remapped: 0,
      rejected_junk: 0,
      rejected_no_match: 0,
    });
    (toGoalConstraints as any).mockReturnValue([]);

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    expect(remapConstraintTargets).toHaveBeenCalledWith(
      extractedConstraints,
      expect.arrayContaining(["fac_retention_rate", "fac_monthly_churn", "out_revenue"]),
      expect.any(Map),
      "test-compound-goals",
      "g1", // goalNodeId — goal node from the test graph
    );

    const labelMap = (remapConstraintTargets as any).mock.calls[0][2] as Map<string, string>;
    expect(labelMap.get("fac_retention_rate")).toBe("Customer Retention Rate");
    expect(labelMap.get("fac_monthly_churn")).toBe("Monthly Churn Rate");
  });

  it("no-op when extractCompoundGoals returns empty constraints", () => {
    (extractCompoundGoals as any).mockReturnValue({
      constraints: [],
      isCompound: false,
      warnings: [],
    });

    const ctx = makeCtx();
    const originalNodeCount = ctx.graph.nodes.length;
    const originalEdgeCount = ctx.graph.edges.length;
    runCompoundGoals(ctx);

    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
    expect(ctx.goalConstraints).toBeUndefined();
  });

  it("no-op when ctx.graph is undefined", () => {
    (extractCompoundGoals as any).mockReturnValue({
      constraints: [{ targetName: "x" }],
      isCompound: true,
    });

    const ctx = makeCtx({ graph: undefined });
    runCompoundGoals(ctx);

    expect(extractCompoundGoals).not.toHaveBeenCalled();
  });

  // ── Safeguard tests (Brief 2 acceptance criteria) ────────────────────────

  it("removing constraint nodes does not change goal_node_id", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
    });

    const ctx = makeCtx();
    const goalNodes = ctx.graph.nodes.filter((n: any) => n.kind === "goal");
    runCompoundGoals(ctx);

    // Goal nodes are unchanged
    const goalNodesAfter = ctx.graph.nodes.filter((n: any) => n.kind === "goal");
    expect(goalNodesAfter).toEqual(goalNodes);
  });

  it("removing constraint nodes does not change option interventions", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
    });

    const ctx = makeCtx();
    const optionNodes = ctx.graph.nodes.filter((n: any) => n.kind === "option");
    runCompoundGoals(ctx);

    const optionNodesAfter = ctx.graph.nodes.filter((n: any) => n.kind === "option");
    expect(optionNodesAfter).toEqual(optionNodes);
  });

  it("removing constraint nodes does not alter factor/edge IDs", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
    });

    const ctx = makeCtx();
    const edgesBefore = ctx.graph.edges.map((e: any) => `${e.from}->${e.to}`);
    const factorIdsBefore = ctx.graph.nodes.filter((n: any) => n.kind === "factor").map((n: any) => n.id);
    runCompoundGoals(ctx);

    const edgesAfter = ctx.graph.edges.map((e: any) => `${e.from}->${e.to}`);
    const factorIdsAfter = ctx.graph.nodes.filter((n: any) => n.kind === "factor").map((n: any) => n.id);
    expect(edgesAfter).toEqual(edgesBefore);
    expect(factorIdsAfter).toEqual(factorIdsBefore);
  });

  it("no node ID starts with constraint_ after compound goal processing", () => {
    setupMocksForConstraints({
      remappedConstraints: [
        { targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 },
        { targetName: "revenue", targetNodeId: "out_revenue", operator: ">=", value: 1000000 },
      ],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    for (const node of ctx.graph.nodes) {
      expect(node.id).not.toMatch(/^constraint_/);
    }
  });

  it("goal_constraints still contains all constraint data with valid node_id references", () => {
    setupMocksForConstraints({
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    expect(ctx.goalConstraints).toHaveLength(1);
    const gc = ctx.goalConstraints[0];
    expect(gc.node_id).toBe("fac_monthly_churn");
    // node_id must reference an existing graph node
    const nodeIds = new Set(ctx.graph.nodes.map((n: any) => n.id));
    expect(nodeIds.has(gc.node_id)).toBe(true);
  });
});

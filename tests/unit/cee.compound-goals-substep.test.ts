/**
 * Compound Goals Substep — Fuzzy Remapping Tests
 *
 * Verifies that the compound goals substep (Stage 4 Substep 5) correctly
 * fuzzy-remaps constraint edge targets when the extractor-generated IDs
 * don't exactly match the LLM-generated node IDs.
 *
 * Root cause: For complex briefs, the extractor generates target IDs like
 * "fac_customer_retention" but the LLM names the node "fac_retention_rate".
 * Without fuzzy matching, all constraint edges are silently dropped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the compound-goal module to provide controlled constraint/edge outputs
vi.mock("../../src/cee/compound-goal/index.js", () => ({
  extractCompoundGoals: vi.fn(),
  toGoalConstraints: vi.fn(),
  remapConstraintTargets: vi.fn(),
  generateConstraintNodes: vi.fn(),
  generateConstraintEdges: vi.fn(),
  constraintNodesToGraphNodes: vi.fn(),
  constraintEdgesToGraphEdges: vi.fn(),
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
  generateConstraintNodes,
  generateConstraintEdges,
  constraintNodesToGraphNodes,
  constraintEdgesToGraphEdges,
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
  constraintEdges: Array<{ from: string; to: string }>;
  constraintNodes: Array<{ id: string }>;
  /** Constraints returned after remapping (if different from extracted) */
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
  (generateConstraintNodes as any).mockReturnValue(opts.constraintNodes);
  (generateConstraintEdges as any).mockReturnValue([]);
  (constraintNodesToGraphNodes as any).mockReturnValue(
    opts.constraintNodes.map((n) => ({ ...n, kind: "constraint", label: "Constraint" })),
  );
  (constraintEdgesToGraphEdges as any).mockReturnValue(
    opts.constraintEdges.map((e) => ({ ...e, strength_mean: 1, belief_exists: 1 })),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runCompoundGoals — fuzzy remapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds constraint nodes/edges when remapConstraintTargets returns valid constraints", () => {
    // remapConstraintTargets has already remapped fac_churn → fac_monthly_churn
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_monthly_churn_max", to: "fac_monthly_churn" }],
      constraintNodes: [{ id: "constraint_fac_monthly_churn_max" }],
      remappedConstraints: [{ targetName: "churn", targetNodeId: "fac_monthly_churn", operator: "<=", value: 0.05 }],
      remapResult: { remapped: 1, rejected_junk: 0, rejected_no_match: 0 },
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // Edge should point to fac_monthly_churn (post-remap)
    const constraintEdges = ctx.graph.edges.filter(
      (e: any) => e.from === "constraint_fac_monthly_churn_max",
    );
    expect(constraintEdges).toHaveLength(1);
    expect(constraintEdges[0].to).toBe("fac_monthly_churn");

    // Constraint node should also be added
    const constraintNodes = ctx.graph.nodes.filter(
      (n: any) => n.id === "constraint_fac_monthly_churn_max",
    );
    expect(constraintNodes).toHaveLength(1);
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

    // No constraint edge or node should be added
    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
    expect(ctx.goalConstraints).toBeUndefined();
  });

  it("keeps constraint edge as-is when target is an exact match", () => {
    // remapConstraintTargets keeps exact matches unchanged
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_retention_rate_min", to: "fac_retention_rate" }],
      constraintNodes: [{ id: "constraint_fac_retention_rate_min" }],
      remappedConstraints: [{ targetName: "retention_rate", targetNodeId: "fac_retention_rate", operator: ">=", value: 0.85 }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    const constraintEdges = ctx.graph.edges.filter(
      (e: any) => e.from === "constraint_fac_retention_rate_min",
    );
    expect(constraintEdges).toHaveLength(1);
    expect(constraintEdges[0].to).toBe("fac_retention_rate");
  });

  it("handles multiple constraints with mixed outcomes after remapping", () => {
    // remapConstraintTargets has already filtered: c1 remapped, c2 exact, c3 dropped
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
    (generateConstraintNodes as any).mockReturnValue([
      { id: "c1" }, { id: "c2" },
    ]);
    (generateConstraintEdges as any).mockReturnValue([]);
    (constraintNodesToGraphNodes as any).mockReturnValue([
      { id: "c1", kind: "constraint", label: "C1" },
      { id: "c2", kind: "constraint", label: "C2" },
    ]);
    (constraintEdgesToGraphEdges as any).mockReturnValue([
      { from: "c1", to: "fac_retention_rate", strength_mean: 1 },
      { from: "c2", to: "fac_retention_rate", strength_mean: 1 },
    ]);

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // Both c1 and c2 should have edges to fac_retention_rate
    const c1Edges = ctx.graph.edges.filter((e: any) => e.from === "c1");
    expect(c1Edges).toHaveLength(1);
    expect(c1Edges[0].to).toBe("fac_retention_rate");

    const c2Edges = ctx.graph.edges.filter((e: any) => e.from === "c2");
    expect(c2Edges).toHaveLength(1);
    expect(c2Edges[0].to).toBe("fac_retention_rate");

    // Both constraint nodes should be added
    const constraintNodes = ctx.graph.nodes.filter((n: any) => ["c1", "c2"].includes(n.id));
    expect(constraintNodes).toHaveLength(2);
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
    (generateConstraintNodes as any).mockReturnValue([]);
    (generateConstraintEdges as any).mockReturnValue([]);
    (constraintNodesToGraphNodes as any).mockReturnValue([]);
    (constraintEdgesToGraphEdges as any).mockReturnValue([]);

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // Verify remapConstraintTargets was called with the correct arguments
    expect(remapConstraintTargets).toHaveBeenCalledWith(
      extractedConstraints,
      expect.arrayContaining(["fac_retention_rate", "fac_monthly_churn", "out_revenue"]),
      expect.any(Map),
      "test-compound-goals",
    );

    // Verify label map was passed
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
});

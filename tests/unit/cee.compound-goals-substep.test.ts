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
  generateConstraintNodes: vi.fn(),
  generateConstraintEdges: vi.fn(),
  constraintNodesToGraphNodes: vi.fn(),
  constraintEdgesToGraphEdges: vi.fn(),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Do NOT mock structural-reconciliation — we want real fuzzyMatchNodeId

import { runCompoundGoals } from "../../src/cee/unified-pipeline/stages/repair/compound-goals.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
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
}) {
  (extractCompoundGoals as any).mockReturnValue({
    constraints: [{ targetName: "churn", targetNodeId: "fac_churn", operator: "<=", value: 0.05 }],
    isCompound: true,
    warnings: [],
  });
  (toGoalConstraints as any).mockReturnValue([
    { constraint_id: "constraint_fac_churn_max", node_id: "fac_churn", operator: "<=", value: 0.05 },
  ]);
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

  it("remaps constraint edge target via stem substring match", () => {
    // Constraint targets "fac_churn" → stem "churn"
    // Graph has "fac_monthly_churn" → stem "monthly_churn" which CONTAINS "churn"
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_churn_max", to: "fac_churn" }],
      constraintNodes: [{ id: "constraint_fac_churn_max" }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // Edge should be remapped to fac_monthly_churn
    const constraintEdges = ctx.graph.edges.filter(
      (e: any) => e.from === "constraint_fac_churn_max",
    );
    expect(constraintEdges).toHaveLength(1);
    expect(constraintEdges[0].to).toBe("fac_monthly_churn");

    // Constraint node should also be added
    const constraintNodes = ctx.graph.nodes.filter(
      (n: any) => n.id === "constraint_fac_churn_max",
    );
    expect(constraintNodes).toHaveLength(1);
  });

  it("remaps constraint edge target via label matching", () => {
    // Constraint targets "fac_customer_retention" → stem "customer_retention"
    // Graph has "fac_retention_rate" → stem "retention_rate"
    // Stem: "customer_retention" doesn't substring-match "retention_rate" → fail
    // Label: "Customer Retention Rate" → normalised "customer_retention_rate"
    //   "customer_retention" IS substring of "customer_retention_rate" → MATCH
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_customer_retention_min", to: "fac_customer_retention" }],
      constraintNodes: [{ id: "constraint_fac_customer_retention_min" }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    const constraintEdges = ctx.graph.edges.filter(
      (e: any) => e.from === "constraint_fac_customer_retention_min",
    );
    expect(constraintEdges).toHaveLength(1);
    expect(constraintEdges[0].to).toBe("fac_retention_rate");
  });

  it("drops constraint edge when no match found (exact, stem, or label)", () => {
    // Constraint targets "fac_totally_unknown" — no node matches
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_totally_unknown_max", to: "fac_totally_unknown" }],
      constraintNodes: [{ id: "constraint_fac_totally_unknown_max" }],
    });

    const ctx = makeCtx();
    const originalEdgeCount = ctx.graph.edges.length;
    const originalNodeCount = ctx.graph.nodes.length;
    runCompoundGoals(ctx);

    // No constraint edge or node should be added
    expect(ctx.graph.edges.length).toBe(originalEdgeCount);
    expect(ctx.graph.nodes.length).toBe(originalNodeCount);
  });

  it("keeps constraint edge as-is when target is an exact match", () => {
    // Constraint targets "fac_retention_rate" — exact match exists
    setupMocksForConstraints({
      constraintEdges: [{ from: "constraint_fac_retention_rate_min", to: "fac_retention_rate" }],
      constraintNodes: [{ id: "constraint_fac_retention_rate_min" }],
    });

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    const constraintEdges = ctx.graph.edges.filter(
      (e: any) => e.from === "constraint_fac_retention_rate_min",
    );
    expect(constraintEdges).toHaveLength(1);
    expect(constraintEdges[0].to).toBe("fac_retention_rate");
  });

  it("handles multiple constraints with mixed match outcomes", () => {
    // One constraint matches via label, another matches exactly, one drops
    (extractCompoundGoals as any).mockReturnValue({
      constraints: [
        { targetName: "customer_retention", targetNodeId: "fac_customer_retention" },
        { targetName: "retention_rate", targetNodeId: "fac_retention_rate" },
        { targetName: "unknown_metric", targetNodeId: "fac_unknown_metric" },
      ],
      isCompound: true,
      warnings: [],
    });
    (toGoalConstraints as any).mockReturnValue([
      { constraint_id: "c1", node_id: "fac_customer_retention" },
      { constraint_id: "c2", node_id: "fac_retention_rate" },
      { constraint_id: "c3", node_id: "fac_unknown_metric" },
    ]);
    (generateConstraintNodes as any).mockReturnValue([
      { id: "c1" }, { id: "c2" }, { id: "c3" },
    ]);
    (generateConstraintEdges as any).mockReturnValue([]);
    (constraintNodesToGraphNodes as any).mockReturnValue([
      { id: "c1", kind: "constraint", label: "C1" },
      { id: "c2", kind: "constraint", label: "C2" },
      { id: "c3", kind: "constraint", label: "C3" },
    ]);
    (constraintEdgesToGraphEdges as any).mockReturnValue([
      { from: "c1", to: "fac_customer_retention", strength_mean: 1 },   // label match → fac_retention_rate
      { from: "c2", to: "fac_retention_rate", strength_mean: 1 },        // exact match
      { from: "c3", to: "fac_unknown_metric", strength_mean: 1 },        // no match → dropped
    ]);

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // c1 should be remapped to fac_retention_rate via label
    const c1Edges = ctx.graph.edges.filter((e: any) => e.from === "c1");
    expect(c1Edges).toHaveLength(1);
    expect(c1Edges[0].to).toBe("fac_retention_rate");

    // c2 should be exact match
    const c2Edges = ctx.graph.edges.filter((e: any) => e.from === "c2");
    expect(c2Edges).toHaveLength(1);
    expect(c2Edges[0].to).toBe("fac_retention_rate");

    // c3 should be dropped (no match)
    const c3Edges = ctx.graph.edges.filter((e: any) => e.from === "c3");
    expect(c3Edges).toHaveLength(0);

    // Only c1 and c2 constraint nodes should be added (c3 has no valid edge)
    const constraintNodes = ctx.graph.nodes.filter((n: any) => ["c1", "c2"].includes(n.id));
    expect(constraintNodes).toHaveLength(2);
    expect(ctx.graph.nodes.find((n: any) => n.id === "c3")).toBeUndefined();
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

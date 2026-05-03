/**
 * Deterministic Graph Enforcement — Unit Tests
 *
 * Covers: applyBudgetRescale, fixBridgeChaining, applyDeterministicEnforcement,
 * edge value readers, all 6 benchmark violation cases, feature flag gating,
 * sign-correct goal bridges, non-finite handling, EPSILON tolerance,
 * deterministic ordering, internal-language audit.
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
  config: { cee: { deterministicEnforcementEnabled: true }, features: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

// Mock the graph validator so post-enforcement validation is a no-op in tests.
vi.mock("../../src/validators/graph-validator.js", () => ({
  validateGraph: vi.fn(() => ({ errors: [], warnings: [] })),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  readEdgeMean,
  readEdgeStd,
  applyBudgetRescale,
  fixBridgeChaining,
  applyDeterministicEnforcement,
} from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import type { EdgeFormat } from "../../src/cee/unified-pipeline/utils/edge-format.js";
import { log } from "../../src/utils/telemetry.js";
import { config } from "../../src/config/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(overrides: { nodes?: any[]; edges?: any[] } = {}): any {
  return {
    version: "1",
    default_seed: 17,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
    nodes: overrides.nodes ?? [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "fac_1", kind: "factor", label: "Factor 1" },
      { id: "fac_2", kind: "factor", label: "Factor 2" },
      { id: "out_1", kind: "outcome", label: "Outcome 1" },
      { id: "risk_1", kind: "risk", label: "Risk 1" },
      { id: "goal_1", kind: "goal", label: "Goal" },
    ],
    edges: overrides.edges ?? [
      { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_2", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_1", to: "out_1", strength_mean: 0.4, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "fac_2", to: "out_1", strength_mean: 0.3, strength_std: 0.08, belief_exists: 0.85, effect_direction: "positive" },
      { from: "fac_1", to: "risk_1", strength_mean: -0.3, strength_std: 0.1, belief_exists: 0.8, effect_direction: "negative" },
      { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: "positive" },
      { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15, belief_exists: 0.9, effect_direction: "negative" },
    ],
  };
}

function makeCtx(graph: any): any {
  return {
    graph,
    requestId: "test-req-001",
    detectedEdgeFormat: "V1_FLAT" as EdgeFormat,
    deterministicRepairs: [],
    repairTrace: {},
  };
}

function sumAbsCausalInbound(edges: any[], nodes: any[], targetId: string): number {
  const kindMap = new Map(nodes.map((n: any) => [n.id, n.kind]));
  return edges
    .filter((e: any) => e.to === targetId && (kindMap.get(e.from) === "factor" || kindMap.get(e.from) === "action"))
    .reduce((sum: number, e: any) => sum + Math.abs(e.strength_mean ?? 0), 0);
}

// =============================================================================
// readEdgeMean / readEdgeStd
// =============================================================================

describe("readEdgeMean", () => {
  it("returns strength_mean for V1_FLAT format", () => {
    expect(readEdgeMean({ from: "a", to: "b", strength_mean: 0.6 } as any, "V1_FLAT")).toBe(0.6);
  });

  it("returns weight for LEGACY format", () => {
    expect(readEdgeMean({ from: "a", to: "b", weight: 0.7 } as any, "LEGACY")).toBe(0.7);
  });

  it("returns undefined when field is absent", () => {
    expect(readEdgeMean({ from: "a", to: "b" } as any, "V1_FLAT")).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(readEdgeMean({ from: "a", to: "b", strength_mean: NaN } as any, "V1_FLAT")).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(readEdgeMean({ from: "a", to: "b", strength_mean: Infinity } as any, "V1_FLAT")).toBeUndefined();
  });

  it("returns undefined for -Infinity", () => {
    expect(readEdgeMean({ from: "a", to: "b", strength_mean: -Infinity } as any, "V1_FLAT")).toBeUndefined();
  });
});

describe("readEdgeStd", () => {
  it("returns strength_std for V1_FLAT", () => {
    expect(readEdgeStd({ from: "a", to: "b", strength_std: 0.15 } as any, "V1_FLAT")).toBe(0.15);
  });

  it("returns 0 for LEGACY", () => {
    expect(readEdgeStd({ from: "a", to: "b", strength_std: 0.15 } as any, "LEGACY")).toBe(0);
  });

  it("returns 0 for non-finite std", () => {
    expect(readEdgeStd({ from: "a", to: "b", strength_std: NaN } as any, "V1_FLAT")).toBe(0);
  });
});

// =============================================================================
// applyBudgetRescale
// =============================================================================

describe("applyBudgetRescale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Threshold and edge cases ─────────────────────────────────────────────

  it("does not rescale when sum ≤ 1.0", () => {
    const graph = makeGraph(); // out_1 inbound sum = 0.7
    const { repairs, nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(0);
    expect(repairs).toHaveLength(0);
  });

  it("does not rescale when sum is exactly 1.0", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "fac_2", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(0);
  });

  it("does not rescale at sum = 1.00000001 (within EPSILON tolerance)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "fac_2", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.50000001, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(0);
  });

  it("rescales at sum = 1.0001 (outside EPSILON)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 1.0001, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
  });

  // ── 6 benchmark violation cases ──────────────────────────────────────────

  it("Benchmark 1/6 — Hiring: out_feature_delivery (1.09, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "out_feature_delivery", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_feature_delivery", strength_mean: 0.35, strength_std: 0.08 },
        { from: "fac_b", to: "out_feature_delivery", strength_mean: 0.30, strength_std: 0.10 },
        { from: "fac_c", to: "out_feature_delivery", strength_mean: 0.24, strength_std: 0.06 },
        { from: "fac_d", to: "out_feature_delivery", strength_mean: 0.20, strength_std: 0.05 },
        { from: "out_feature_delivery", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });

    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT", "hiring");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_feature_delivery")).toBeCloseTo(0.95, 5);

    const inbound = graph.edges.filter((e: any) => e.to === "out_feature_delivery");
    expect(inbound[0].strength_mean / inbound[1].strength_mean).toBeCloseTo(0.35 / 0.30, 5);
    expect(inbound[1].strength_mean / inbound[2].strength_mean).toBeCloseTo(0.30 / 0.24, 5);
    for (const e of inbound) expect(e.strength_mean).toBeGreaterThan(0);

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.draft_graph.inbound_sum_rescaled",
        node_id: "out_feature_delivery",
        node_kind: "outcome",
        scaled_sum: 0.95,
      }),
      expect.any(String),
    );
  });

  it("Benchmark 2/6 — Pricing: risk_smb_churn (1.16, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "risk_smb_churn", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_smb_churn", strength_mean: 0.40, strength_std: 0.10 },
        { from: "fac_b", to: "risk_smb_churn", strength_mean: 0.32, strength_std: 0.08 },
        { from: "fac_c", to: "risk_smb_churn", strength_mean: 0.26, strength_std: 0.07 },
        { from: "fac_d", to: "risk_smb_churn", strength_mean: 0.18, strength_std: 0.05 },
        { from: "risk_smb_churn", to: "goal_1", strength_mean: -0.6, strength_std: 0.12 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_smb_churn")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 3/6 — Contradictory: out_revenue_growth (1.50, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "out_revenue_growth", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_revenue_growth", strength_mean: 0.50, strength_std: 0.12 },
        { from: "fac_b", to: "out_revenue_growth", strength_mean: 0.40, strength_std: 0.10 },
        { from: "fac_c", to: "out_revenue_growth", strength_mean: 0.35, strength_std: 0.09 },
        { from: "fac_d", to: "out_revenue_growth", strength_mean: 0.25, strength_std: 0.06 },
        { from: "out_revenue_growth", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_revenue_growth")).toBeCloseTo(0.95, 5);
    const inbound = graph.edges.filter((e: any) => e.to === "out_revenue_growth");
    expect(inbound[0].strength_mean / inbound[1].strength_mean).toBeCloseTo(0.50 / 0.40, 5);
  });

  it("Benchmark 4/6 — Contradictory: risk_burn_acceleration (1.35, 3 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" },
        { id: "risk_burn_acceleration", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_burn_acceleration", strength_mean: 0.55, strength_std: 0.12 },
        { from: "fac_b", to: "risk_burn_acceleration", strength_mean: 0.45, strength_std: 0.10 },
        { from: "fac_c", to: "risk_burn_acceleration", strength_mean: 0.35, strength_std: 0.08 },
        { from: "risk_burn_acceleration", to: "goal_1", strength_mean: -0.7, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_burn_acceleration")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 5/6 — Rambling: out_error_reduction (1.27, 2 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_error_reduction", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_error_reduction", strength_mean: 0.70, strength_std: 0.15 },
        { from: "fac_b", to: "out_error_reduction", strength_mean: 0.57, strength_std: 0.12 },
        { from: "out_error_reduction", to: "goal_1", strength_mean: 0.6, strength_std: 0.1 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_error_reduction")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 6/6 — Rambling: risk_margin_erosion (1.28, 3 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" },
        { id: "risk_margin_erosion", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_margin_erosion", strength_mean: 0.50, strength_std: 0.10 },
        { from: "fac_b", to: "risk_margin_erosion", strength_mean: 0.42, strength_std: 0.09 },
        { from: "fac_c", to: "risk_margin_erosion", strength_mean: 0.36, strength_std: 0.08 },
        { from: "risk_margin_erosion", to: "goal_1", strength_mean: -0.5, strength_std: 0.12 },
      ],
    });
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_margin_erosion")).toBeCloseTo(0.95, 5);
  });

  // ── Sign / structure / format ────────────────────────────────────────────

  it("scales single edge with |mean| > 1.0 via pure proportional scaling", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 1.5, strength_std: 0.2 },
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });
    applyBudgetRescale(graph, "V1_FLAT");
    const edge = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "out_1");
    // 1.5 * (0.95/1.5) = 0.95
    expect(edge.strength_mean).toBeCloseTo(0.95, 5);
  });

  it("preserves sign on single negative edge with |mean| > 1.0", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" },
        { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_1", strength_mean: -1.5, strength_std: 0.2 },
        { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.1 },
      ],
    });
    applyBudgetRescale(graph, "V1_FLAT");
    const edge = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "risk_1");
    expect(edge.strength_mean).toBeCloseTo(-0.95, 5);
  });

  it("preserves signs and ratios with mixed positive/negative inbound", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: -0.6, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });
    applyBudgetRescale(graph, "V1_FLAT");
    const a = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "out_1");
    const b = graph.edges.find((e: any) => e.from === "fac_b" && e.to === "out_1");
    expect(a.strength_mean).toBeGreaterThan(0);
    expect(b.strength_mean).toBeLessThan(0);
    expect(Math.abs(a.strength_mean) + Math.abs(b.strength_mean)).toBeCloseTo(0.95, 5);
  });

  it("scales std proportionally with mean", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
      ],
    });
    const scale = 0.95 / 1.2;
    applyBudgetRescale(graph, "V1_FLAT");
    const a = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "out_1");
    expect(a.strength_std).toBeCloseTo(0.1 * scale, 5);
  });

  // ── Excluded edges ───────────────────────────────────────────────────────

  it("skips nodes with all zero-strength edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0, strength_std: 0 },
        { from: "fac_b", to: "out_1", strength_mean: 0, strength_std: 0 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("excludes goal nodes from rescaling", () => {
    const graph = makeGraph({
      nodes: [
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
        { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
    expect(graph.edges[0].strength_mean).toBe(0.8);
    expect(graph.edges[1].strength_mean).toBe(-0.5);
  });

  it("excludes factor nodes from rescaling", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt_a", kind: "option" }, { id: "opt_b", kind: "option" },
        { id: "fac_1", kind: "factor" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "opt_a", to: "fac_1", strength_mean: 0.6, strength_std: 0.01 },
        { from: "opt_b", to: "fac_1", strength_mean: 0.6, strength_std: 0.01 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("excludes structural edges (option→factor) from inbound sum to outcome", () => {
    // Construct outcome with both a factor inbound (causal) and an inappropriate
    // option inbound (option→outcome would be a forbidden shortcut, but we model
    // it here to verify the source-kind filter would exclude it from the sum).
    const graph = makeGraph({
      nodes: [
        { id: "opt_a", kind: "option" }, { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "opt_a", to: "out_1", strength_mean: 1.0, strength_std: 0.01 },
        { from: "fac_1", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });

    // Causal inbound = 0.6 (only factor counts) → no rescale
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
    const factorEdge = graph.edges.find((e: any) => e.from === "fac_1" && e.to === "out_1");
    expect(factorEdge.strength_mean).toBe(0.6);
  });

  it("excludes outcome→goal bridge edges from rescaling (when goal sum > 1)", () => {
    // Confirms goal nodes are not budget-enforced.
    const graph = makeGraph({
      nodes: [
        { id: "out_1", kind: "outcome" }, { id: "out_2", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.1 },
        { from: "out_2", to: "goal_1", strength_mean: 0.9, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("excludes bidirected edges from rescalable inbound", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" }, { id: "fac_2", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.7, strength_std: 0.1, edge_type: "bidirected" },
      ],
    });
    // Only the directed edge counts → sum 0.7, no rescale
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  // ── Non-finite handling ──────────────────────────────────────────────────

  it("skips edges with NaN strength and emits telemetry", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: NaN, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
      ],
    });
    const { edgesSkipped } = applyBudgetRescale(graph, "V1_FLAT", "test-nan");
    expect(edgesSkipped).toBe(1);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.draft_graph.enforcement_edge_skipped",
        edge_from: "fac_a",
        edge_to: "out_1",
        reason: "non_finite_strength",
      }),
      expect.any(String),
    );
  });

  it("skips edges with Infinity strength", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: Infinity, strength_std: 0.1 },
      ],
    });
    const { edgesSkipped, nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(edgesSkipped).toBe(1);
    expect(nodesRescaled).toBe(0);
  });

  // ── LEGACY format ────────────────────────────────────────────────────────

  it("handles LEGACY edge format (weight field)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", weight: 0.7, belief: 0.9 },
        { from: "fac_b", to: "out_1", weight: 0.5, belief: 0.8 },
      ],
    });
    applyBudgetRescale(graph, "LEGACY");
    const a = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "out_1");
    const b = graph.edges.find((e: any) => e.from === "fac_b" && e.to === "out_1");
    expect(Math.abs(a.weight) + Math.abs(b.weight)).toBeCloseTo(0.95, 5);
  });
});

// =============================================================================
// fixBridgeChaining
// =============================================================================

describe("fixBridgeChaining", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes outcome→risk edge and adds positive outcome→goal, negative risk→goal bridges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });

    const { removedCount, goalEdgesAdded } = fixBridgeChaining(graph, "V1_FLAT", "test");
    expect(removedCount).toBe(1);
    expect(goalEdgesAdded).toBe(2);

    expect(graph.edges.find((e: any) => e.from === "out_1" && e.to === "risk_1")).toBeUndefined();

    // outcome→goal: positive
    const outGoal = graph.edges.find((e: any) => e.from === "out_1" && e.to === "goal_1");
    expect(outGoal.strength_mean).toBeCloseTo(0.3, 5); // 0.6 * 0.5
    expect(outGoal.strength_mean).toBeGreaterThan(0);
    expect(outGoal.effect_direction).toBe("positive");

    // risk→goal: negative (sign forced by kind, NOT inbound mean)
    const riskGoal = graph.edges.find((e: any) => e.from === "risk_1" && e.to === "goal_1");
    expect(riskGoal.strength_mean).toBeCloseTo(-0.2, 5); // -|−0.4 * 0.5|
    expect(riskGoal.strength_mean).toBeLessThan(0);
    expect(riskGoal.effect_direction).toBe("negative");
  });

  it("risk→goal bridge is negative even when inbound mean is positive", () => {
    // Edge case: a risk node receives a positive-mean factor inbound
    // (uncommon but possible). Bridge sign must still be negative.
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "risk_1", kind: "risk" }, { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "risk_1", strength_mean: 0.6, strength_std: 0.1 }, // positive!
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "risk_1", to: "out_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });

    fixBridgeChaining(graph, "V1_FLAT");
    const riskGoal = graph.edges.find((e: any) => e.from === "risk_1" && e.to === "goal_1");
    expect(riskGoal.strength_mean).toBeLessThan(0);
    expect(riskGoal.effect_direction).toBe("negative");
  });

  it("outcome→goal bridge is positive even when inbound mean is negative", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: -0.6, strength_std: 0.1 }, // negative
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });
    fixBridgeChaining(graph, "V1_FLAT");
    const outGoal = graph.edges.find((e: any) => e.from === "out_1" && e.to === "goal_1");
    expect(outGoal.strength_mean).toBeGreaterThan(0);
    expect(outGoal.effect_direction).toBe("positive");
  });

  it("removes risk→outcome edge", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "risk_1", to: "out_1", strength_mean: -0.3, strength_std: 0.08 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(1);
    expect(graph.edges.find((e: any) => e.from === "risk_1" && e.to === "out_1")).toBeUndefined();
  });

  it("removes outcome→outcome (belt-and-suspenders)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "out_2", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "out_1", to: "out_2", strength_mean: 0.4, strength_std: 0.08 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(1);
  });

  it("removes risk→risk (belt-and-suspenders)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "risk_1", kind: "risk" }, { id: "risk_2", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "risk_1", to: "risk_2", strength_mean: -0.3, strength_std: 0.08 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(1);
  });

  it("preserves outcome→goal edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(0);
    expect(graph.edges).toHaveLength(2);
  });

  it("preserves risk→goal edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(0);
  });

  it("preserves factor→risk edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15 },
      ],
    });
    expect(fixBridgeChaining(graph, "V1_FLAT").removedCount).toBe(0);
  });

  it("does not duplicate goal edge when source already has one", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });
    const { goalEdgesAdded } = fixBridgeChaining(graph, "V1_FLAT");
    expect(goalEdgesAdded).toBe(1); // only risk_1 needs one
    const goalEdges = graph.edges.filter((e: any) => e.to === "goal_1");
    expect(goalEdges).toHaveLength(2);
  });

  it("handles missing goal node gracefully", () => {
    const graph = makeGraph({
      nodes: [{ id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" }],
      edges: [{ from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 }],
    });
    const { removedCount, goalEdgesAdded } = fixBridgeChaining(graph, "V1_FLAT");
    expect(removedCount).toBe(0);
    expect(goalEdgesAdded).toBe(0);
  });

  it("handles multiple forbidden edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "out_2", kind: "outcome" },
        { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_1", to: "out_2", strength_mean: 0.4, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.3, strength_std: 0.08 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
        { from: "out_2", to: "risk_1", strength_mean: 0.2, strength_std: 0.06 },
      ],
    });
    const { removedCount, goalEdgesAdded } = fixBridgeChaining(graph, "V1_FLAT");
    expect(removedCount).toBe(2);
    expect(goalEdgesAdded).toBe(3);
  });

  it("uses default strength when bridge node has no other inbound", () => {
    // out_1 has no inbound at all → orphan path → ORPHAN_BRIDGE_MEAN.
    // risk_1's only "inbound" is the edge being removed → derives from
    //   that edge's strength (the bridge edge IS valid causal data even
    //   though it points to the wrong target).
    const graph = makeGraph({
      nodes: [
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [{ from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 }],
    });
    fixBridgeChaining(graph, "V1_FLAT");

    // out_1 has no inbound → orphan → +ORPHAN_BRIDGE_MEAN (positive, outcome)
    const outGoal = graph.edges.find((e: any) => e.from === "out_1" && e.to === "goal_1");
    expect(outGoal.strength_mean).toBe(0.3);
    expect(outGoal.effect_direction).toBe("positive");

    // risk_1 derives from the bridge edge it's losing: |0.3| * 0.5 = 0.15, negative
    const riskGoal = graph.edges.find((e: any) => e.from === "risk_1" && e.to === "goal_1");
    expect(riskGoal.strength_mean).toBeCloseTo(-0.15, 5);
    expect(riskGoal.effect_direction).toBe("negative");
  });

  it("uses orphan defaults when both bridge endpoints are fully orphan", () => {
    // Two outcome/risk nodes connected only to each other, with another edge
    // to keep both endpoints reachable in the orphan-mean computation. The
    // forbidden edge between them is the only edge each node has → after
    // removal, both fall into the orphan path.
    const graph = makeGraph({
      nodes: [
        { id: "out_orphan", kind: "outcome" },
        { id: "risk_orphan", kind: "risk" },
        { id: "out_other", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        // forbidden bridge: out_orphan → out_other  (outcome→outcome)
        { from: "out_orphan", to: "out_other", strength_mean: 0.0, strength_std: 0.0 },
        // forbidden bridge: risk_orphan → out_other  (risk→outcome)
        { from: "risk_orphan", to: "out_other", strength_mean: 0.0, strength_std: 0.0 },
      ],
    });
    fixBridgeChaining(graph, "V1_FLAT");

    // Both source nodes have only zero-strength inbound elsewhere
    // → strongestAbs = 0 → orphan defaults fire.
    const outGoal = graph.edges.find((e: any) => e.from === "out_orphan" && e.to === "goal_1");
    expect(outGoal.strength_mean).toBe(0.3);
    const riskGoal = graph.edges.find((e: any) => e.from === "risk_orphan" && e.to === "goal_1");
    expect(riskGoal.strength_mean).toBe(-0.3);
  });

  it("emits telemetry with edge_from, edge_to, repair_method", () => {
    const graph = makeGraph({
      nodes: [
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [{ from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 }],
    });
    fixBridgeChaining(graph, "V1_FLAT", "tele-test");
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.draft_graph.bridge_chain_repaired",
        edge_from: "out_1",
        edge_to: "risk_1",
        repair_method: "remove_and_bridge",
      }),
      expect.any(String),
    );
  });

  it("leaves no forbidden bridge chains after repair (full sweep)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "out_2", kind: "outcome" },
        { id: "risk_1", kind: "risk" }, { id: "risk_2", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
        { from: "risk_2", to: "out_2", strength_mean: -0.2, strength_std: 0.06 },
        { from: "out_2", to: "out_1", strength_mean: 0.1, strength_std: 0.05 },
        { from: "risk_1", to: "risk_2", strength_mean: -0.1, strength_std: 0.05 },
      ],
    });
    fixBridgeChaining(graph, "V1_FLAT");
    const kindOf = (id: string) => graph.nodes.find((n: any) => n.id === id)?.kind;
    const remaining = graph.edges.filter((e: any) => {
      const fk = kindOf(e.from), tk = kindOf(e.to);
      return ["outcome", "risk"].includes(fk) && ["outcome", "risk"].includes(tk) && e.to !== "goal_1";
    });
    expect(remaining).toHaveLength(0);
  });

  it("produces deterministic output across runs (sorted bridge additions)", () => {
    const buildGraph = () => makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" },
        { id: "out_z", kind: "outcome" }, { id: "out_a", kind: "outcome" },
        { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_z", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_1", to: "out_a", strength_mean: 0.4, strength_std: 0.1 },
        { from: "fac_1", to: "risk_1", strength_mean: -0.3, strength_std: 0.08 },
        { from: "out_z", to: "out_a", strength_mean: 0.2, strength_std: 0.05 },
      ],
    });

    const g1 = buildGraph();
    const g2 = buildGraph();
    fixBridgeChaining(g1, "V1_FLAT");
    fixBridgeChaining(g2, "V1_FLAT");

    expect(JSON.stringify(g1.edges)).toBe(JSON.stringify(g2.edges));
  });
});

// =============================================================================
// applyDeterministicEnforcement (integration)
// =============================================================================

describe("applyDeterministicEnforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).cee.deterministicEnforcementEnabled = true;
  });

  it("skips when feature flag is off", () => {
    (config as any).cee.deterministicEnforcementEnabled = false;
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_a", to: "risk_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);
    expect(graph.edges).toHaveLength(3);
    expect(ctx.deterministicRepairs).toHaveLength(0);
    expect(ctx.repairTrace.deterministic_enforcement).toBeUndefined();
  });

  it("skips when ctx.graph is undefined", () => {
    applyDeterministicEnforcement(makeCtx(undefined));
    expect(log.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "cee.draft_graph.enforcement_completed" }),
      expect.any(String),
    );
  });

  it("repairs both bridge chain and budget violation in correct order", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.5, strength_std: 0.08 },
        { from: "fac_a", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);

    expect(graph.edges.find((e: any) => e.from === "out_1" && e.to === "risk_1")).toBeUndefined();
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_1")).toBeCloseTo(0.95, 5);
    expect(ctx.repairTrace.deterministic_enforcement).toEqual(expect.objectContaining({
      ran: true,
      bridge_chains_removed: 1,
      nodes_rescaled: 1,
    }));
    expect(ctx.deterministicRepairs.length).toBeGreaterThanOrEqual(2);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cee.draft_graph.enforcement_completed" }),
      expect.any(String),
    );
  });

  it("is a no-op on clean graph (ran=true, zero repairs)", () => {
    const graph = makeGraph();
    const ctx = makeCtx(graph);
    const edgesBefore = graph.edges.length;
    applyDeterministicEnforcement(ctx);
    expect(graph.edges).toHaveLength(edgesBefore);
    expect(ctx.deterministicRepairs).toHaveLength(0);
    expect(ctx.repairTrace.deterministic_enforcement).toEqual(expect.objectContaining({
      ran: true,
      bridge_chains_removed: 0,
      nodes_rescaled: 0,
      total_repairs: 0,
    }));
  });

  it("appends to existing deterministicRepairs without overwriting", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });
    const ctx = makeCtx(graph);
    ctx.deterministicRepairs = [{ code: "EXISTING", path: "test", action: "pre-existing" }];
    applyDeterministicEnforcement(ctx);
    expect(ctx.deterministicRepairs[0].code).toBe("EXISTING");
    expect(ctx.deterministicRepairs.length).toBeGreaterThan(1);
  });

  it("records edges_skipped in repairTrace for non-finite handling", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" },
        { id: "out_1", kind: "outcome" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: NaN, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);
    expect(ctx.repairTrace.deterministic_enforcement.edges_skipped_non_finite).toBe(1);
  });

  // ── Internal-language audit ──────────────────────────────────────────────

  it("does not write internal enforcement language to user-facing graph fields", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "risk_1", kind: "risk" },
        { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_a", to: "risk_1", strength_mean: -0.4, strength_std: 0.1 },
        { from: "out_1", to: "risk_1", strength_mean: 0.3, strength_std: 0.08 },
      ],
    });
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);

    // User-facing surfaces are node labels/bodies and edge effect_direction —
    // these should NEVER contain enforcement mechanics terms.
    const forbidden = ["budget rescale", "inbound sum", "strength sum", "rescale"];
    for (const node of graph.nodes) {
      const userText = `${node.label ?? ""} ${node.body ?? ""}`.toLowerCase();
      for (const term of forbidden) expect(userText).not.toContain(term);
    }
    for (const edge of graph.edges) {
      const ed = (edge as any).effect_direction;
      if (typeof ed === "string") {
        for (const term of forbidden) expect(ed.toLowerCase()).not.toContain(term);
      }
    }
  });
});

/**
 * Deterministic Graph Enforcement — Unit Tests (Commit 1)
 *
 * Covers: readEdgeMean / readEdgeStd readers, applyBudgetRescale algorithm,
 * all 6 v194c benchmark violation cases, EPSILON tolerance, non-finite
 * handling, sign / ratio preservation, kind / structural / bidirected
 * exclusions, and LEGACY format support.
 *
 * Subsequent commits add fixBridgeChaining and integration tests.
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
  config: { cee: {}, features: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  readEdgeMean,
  readEdgeStd,
  applyBudgetRescale,
} from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { log } from "../../src/utils/telemetry.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(overrides: { nodes?: any[]; edges?: any[] } = {}): any {
  return {
    version: "1",
    default_seed: 17,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
    nodes: overrides.nodes ?? [
      { id: "dec_1", kind: "decision" },
      { id: "opt_a", kind: "option" },
      { id: "fac_1", kind: "factor" },
      { id: "fac_2", kind: "factor" },
      { id: "out_1", kind: "outcome" },
      { id: "risk_1", kind: "risk" },
      { id: "goal_1", kind: "goal" },
    ],
    edges: overrides.edges ?? [
      { from: "fac_1", to: "out_1", strength_mean: 0.4, strength_std: 0.1 },
      { from: "fac_2", to: "out_1", strength_mean: 0.3, strength_std: 0.08 },
      { from: "fac_1", to: "risk_1", strength_mean: -0.3, strength_std: 0.1 },
      { from: "out_1", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      { from: "risk_1", to: "goal_1", strength_mean: -0.5, strength_std: 0.15 },
    ],
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
  it("returns strength_mean for V1_FLAT", () => {
    expect(readEdgeMean({ from: "a", to: "b", strength_mean: 0.6 } as any, "V1_FLAT")).toBe(0.6);
  });

  it("returns weight for LEGACY", () => {
    expect(readEdgeMean({ from: "a", to: "b", weight: 0.7 } as any, "LEGACY")).toBe(0.7);
  });

  it("returns undefined when field absent", () => {
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
// applyBudgetRescale — threshold and edge cases
// =============================================================================

describe("applyBudgetRescale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not rescale when sum ≤ 1.0", () => {
    const graph = makeGraph(); // out_1 sum = 0.7
    const { nodesRescaled } = applyBudgetRescale(graph, "V1_FLAT");
    expect(nodesRescaled).toBe(0);
  });

  it("does not rescale when sum exactly 1.0", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" }, { id: "fac_2", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("does not rescale at sum = 1.00000001 (within EPSILON tolerance)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_1", kind: "factor" }, { id: "fac_2", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.5, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.50000001, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("rescales at sum = 1.0001 (outside EPSILON)", () => {
    const graph = makeGraph({
      nodes: [{ id: "fac_1", kind: "factor" }, { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" }],
      edges: [{ from: "fac_1", to: "out_1", strength_mean: 1.0001, strength_std: 0.1 }],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
  });

  // ── 6 benchmark violation cases ──────────────────────────────────────────

  it("Benchmark 1/6 — Hiring: out_feature_delivery (1.09, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "out_feature_delivery", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_feature_delivery", strength_mean: 0.35, strength_std: 0.08 },
        { from: "fac_b", to: "out_feature_delivery", strength_mean: 0.30, strength_std: 0.10 },
        { from: "fac_c", to: "out_feature_delivery", strength_mean: 0.24, strength_std: 0.06 },
        { from: "fac_d", to: "out_feature_delivery", strength_mean: 0.20, strength_std: 0.05 },
        { from: "out_feature_delivery", to: "goal_1", strength_mean: 0.8, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT", "hiring").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_feature_delivery")).toBeCloseTo(0.95, 5);
    const inbound = graph.edges.filter((e: any) => e.to === "out_feature_delivery");
    expect(inbound[0].strength_mean / inbound[1].strength_mean).toBeCloseTo(0.35 / 0.30, 5);
    for (const e of inbound) expect(e.strength_mean).toBeGreaterThan(0);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.draft_graph.inbound_sum_rescaled",
        node_id: "out_feature_delivery", node_kind: "outcome", scaled_sum: 0.95,
      }),
      expect.any(String),
    );
  });

  it("Benchmark 2/6 — Pricing: risk_smb_churn (1.16, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "risk_smb_churn", kind: "risk" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_smb_churn", strength_mean: 0.40, strength_std: 0.10 },
        { from: "fac_b", to: "risk_smb_churn", strength_mean: 0.32, strength_std: 0.08 },
        { from: "fac_c", to: "risk_smb_churn", strength_mean: 0.26, strength_std: 0.07 },
        { from: "fac_d", to: "risk_smb_churn", strength_mean: 0.18, strength_std: 0.05 },
        { from: "risk_smb_churn", to: "goal_1", strength_mean: -0.6, strength_std: 0.12 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_smb_churn")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 3/6 — Contradictory: out_revenue_growth (1.50, 4 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" }, { id: "fac_d", kind: "factor" },
        { id: "out_revenue_growth", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_revenue_growth", strength_mean: 0.50, strength_std: 0.12 },
        { from: "fac_b", to: "out_revenue_growth", strength_mean: 0.40, strength_std: 0.10 },
        { from: "fac_c", to: "out_revenue_growth", strength_mean: 0.35, strength_std: 0.09 },
        { from: "fac_d", to: "out_revenue_growth", strength_mean: 0.25, strength_std: 0.06 },
        { from: "out_revenue_growth", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_revenue_growth")).toBeCloseTo(0.95, 5);
    const inbound = graph.edges.filter((e: any) => e.to === "out_revenue_growth");
    expect(inbound[0].strength_mean / inbound[1].strength_mean).toBeCloseTo(0.50 / 0.40, 5);
  });

  it("Benchmark 4/6 — Contradictory: risk_burn_acceleration (1.35, 3 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" },
        { id: "risk_burn_acceleration", kind: "risk" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_burn_acceleration", strength_mean: 0.55, strength_std: 0.12 },
        { from: "fac_b", to: "risk_burn_acceleration", strength_mean: 0.45, strength_std: 0.10 },
        { from: "fac_c", to: "risk_burn_acceleration", strength_mean: 0.35, strength_std: 0.08 },
        { from: "risk_burn_acceleration", to: "goal_1", strength_mean: -0.7, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_burn_acceleration")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 5/6 — Rambling: out_error_reduction (1.27, 2 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_error_reduction", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_error_reduction", strength_mean: 0.70, strength_std: 0.15 },
        { from: "fac_b", to: "out_error_reduction", strength_mean: 0.57, strength_std: 0.12 },
        { from: "out_error_reduction", to: "goal_1", strength_mean: 0.6, strength_std: 0.1 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "out_error_reduction")).toBeCloseTo(0.95, 5);
  });

  it("Benchmark 6/6 — Rambling: risk_margin_erosion (1.28, 3 edges) → 0.95", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "fac_c", kind: "factor" },
        { id: "risk_margin_erosion", kind: "risk" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "risk_margin_erosion", strength_mean: 0.50, strength_std: 0.10 },
        { from: "fac_b", to: "risk_margin_erosion", strength_mean: 0.42, strength_std: 0.09 },
        { from: "fac_c", to: "risk_margin_erosion", strength_mean: 0.36, strength_std: 0.08 },
        { from: "risk_margin_erosion", to: "goal_1", strength_mean: -0.5, strength_std: 0.12 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(1);
    expect(sumAbsCausalInbound(graph.edges, graph.nodes, "risk_margin_erosion")).toBeCloseTo(0.95, 5);
  });

  // ── Sign / structure / format ────────────────────────────────────────────

  it("scales single edge with |mean| > 1.0 via pure proportional scaling", () => {
    const graph = makeGraph({
      nodes: [{ id: "fac_a", kind: "factor" }, { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" }],
      edges: [{ from: "fac_a", to: "out_1", strength_mean: 1.5, strength_std: 0.2 }],
    });
    applyBudgetRescale(graph, "V1_FLAT");
    expect(graph.edges[0].strength_mean).toBeCloseTo(0.95, 5); // 1.5 * (0.95/1.5)
  });

  it("preserves sign on single negative edge with |mean| > 1.0", () => {
    const graph = makeGraph({
      nodes: [{ id: "fac_a", kind: "factor" }, { id: "risk_1", kind: "risk" }, { id: "goal_1", kind: "goal" }],
      edges: [{ from: "fac_a", to: "risk_1", strength_mean: -1.5, strength_std: 0.2 }],
    });
    applyBudgetRescale(graph, "V1_FLAT");
    expect(graph.edges[0].strength_mean).toBeCloseTo(-0.95, 5);
  });

  it("preserves signs and ratios with mixed positive/negative inbound", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
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
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "fac_b", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
      ],
    });
    const scale = 0.95 / 1.2;
    applyBudgetRescale(graph, "V1_FLAT");
    expect(graph.edges[0].strength_std).toBeCloseTo(0.1 * scale, 5);
  });

  // ── Excluded edges / kinds ───────────────────────────────────────────────

  it("skips nodes with all zero-strength edges", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", strength_mean: 0, strength_std: 0 },
        { from: "fac_b", to: "out_1", strength_mean: 0, strength_std: 0 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("excludes goal nodes from rescaling (goal sum > 1.0 untouched)", () => {
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
        { id: "fac_1", kind: "factor" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "opt_a", to: "fac_1", strength_mean: 0.6, strength_std: 0.01 },
        { from: "opt_b", to: "fac_1", strength_mean: 0.6, strength_std: 0.01 },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  it("excludes non-causal sources (option→outcome) from inbound sum", () => {
    const graph = makeGraph({
      nodes: [
        { id: "opt_a", kind: "option" }, { id: "fac_1", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "opt_a", to: "out_1", strength_mean: 1.0, strength_std: 0.01 },
        { from: "fac_1", to: "out_1", strength_mean: 0.6, strength_std: 0.1 },
        { from: "out_1", to: "goal_1", strength_mean: 0.7, strength_std: 0.1 },
      ],
    });
    // Causal inbound sum = 0.6 (only factor counts) → no rescale
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
    expect(graph.edges.find((e: any) => e.from === "fac_1" && e.to === "out_1").strength_mean).toBe(0.6);
  });

  it("excludes outcome→goal bridge edges (goal not budget-enforced)", () => {
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
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_1", to: "out_1", strength_mean: 0.7, strength_std: 0.1 },
        { from: "fac_2", to: "out_1", strength_mean: 0.7, strength_std: 0.1, edge_type: "bidirected" },
      ],
    });
    expect(applyBudgetRescale(graph, "V1_FLAT").nodesRescaled).toBe(0);
  });

  // ── Non-finite handling ──────────────────────────────────────────────────

  it("skips NaN strength edges and emits telemetry", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
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
        edge_from: "fac_a", edge_to: "out_1", reason: "non_finite_strength",
      }),
      expect.any(String),
    );
  });

  it("skips Infinity strength edges", () => {
    const graph = makeGraph({
      nodes: [{ id: "fac_a", kind: "factor" }, { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" }],
      edges: [{ from: "fac_a", to: "out_1", strength_mean: Infinity, strength_std: 0.1 }],
    });
    const result = applyBudgetRescale(graph, "V1_FLAT");
    expect(result.edgesSkipped).toBe(1);
    expect(result.nodesRescaled).toBe(0);
  });

  // ── LEGACY format ────────────────────────────────────────────────────────

  it("handles LEGACY edge format (weight field)", () => {
    const graph = makeGraph({
      nodes: [
        { id: "fac_a", kind: "factor" }, { id: "fac_b", kind: "factor" },
        { id: "out_1", kind: "outcome" }, { id: "goal_1", kind: "goal" },
      ],
      edges: [
        { from: "fac_a", to: "out_1", weight: 0.7 },
        { from: "fac_b", to: "out_1", weight: 0.5 },
      ],
    });
    applyBudgetRescale(graph, "LEGACY");
    const a = graph.edges.find((e: any) => e.from === "fac_a" && e.to === "out_1");
    const b = graph.edges.find((e: any) => e.from === "fac_b" && e.to === "out_1");
    expect(Math.abs(a.weight) + Math.abs(b.weight)).toBeCloseTo(0.95, 5);
  });
});

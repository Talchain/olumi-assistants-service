import { describe, it, expect } from "vitest";
import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import { computeQuality, getCeeQualityBand, type CeeQualityBand } from "../../src/cee/quality/index.js";

function makeGraph(nodes: Array<{ id: string; kind: string; label?: string }>, edges: Array<{ from: string; to: string }>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: nodes as any,
    edges: edges as any,
    meta: { roots: [nodes[0]?.id ?? "root"], leaves: [nodes[nodes.length - 1]?.id ?? "root"], suggested_positions: {}, source: "assistant" },
  } as any;
}

describe("CEE quality helper - computeQuality", () => {
  it("derives overall from confidence and populates structure/coverage/safety/structural_proxy", () => {
    const graph = makeGraph(
      [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "opt_a", kind: "option", label: "Premium pricing" },
        { id: "opt_b", kind: "option", label: "Freemium" },
        { id: "out", kind: "outcome", label: "Revenue impact" },
      ],
      [
        { from: "goal", to: "opt_a" },
        { from: "goal", to: "opt_b" },
        { from: "opt_a", to: "out" },
      ]
    );

    const quality = computeQuality({
      graph,
      confidence: 0.8,
      engineIssueCount: 0,
      ceeIssues: [],
    });

    expect(quality.overall).toBe(8);
    expect(quality.structure).toBeGreaterThanOrEqual(1);
    expect(quality.structure).toBeLessThanOrEqual(10);
    expect(quality.coverage).toBeGreaterThanOrEqual(1);
    expect(quality.coverage).toBeLessThanOrEqual(10);
    expect(quality.safety).toBeGreaterThanOrEqual(1);
    expect(quality.safety).toBeLessThanOrEqual(10);
    expect(quality.structural_proxy).toBe(quality.structure);

    expect(quality.details).toBeDefined();
    expect(quality.details?.node_count).toBe(4);
    expect(quality.details?.edge_count).toBe(3);
    expect(quality.details?.option_count).toBe(2);
  });

  it("penalises tiny graphs and many CEE validation issues in safety score", () => {
    const tinyGraph = makeGraph([{ id: "goal", kind: "goal", label: "Tiny" }], []);

    const withoutIssues = computeQuality({
      graph: tinyGraph,
      confidence: 0.7,
      engineIssueCount: 0,
      ceeIssues: [],
    });

    const withIssues = computeQuality({
      graph: tinyGraph,
      confidence: 0.7,
      engineIssueCount: 0,
      ceeIssues: [
        { code: "CEE_GRAPH_INVALID", severity: "error", message: "x", details: {} },
        { code: "CEE_GRAPH_INVALID", severity: "error", message: "y", details: {} },
        { code: "CEE_GRAPH_INVALID", severity: "error", message: "z", details: {} },
      ],
    });

    expect(withoutIssues.safety).toBeDefined();
    expect(withIssues.safety).toBeDefined();

    expect(withIssues.safety!).toBeLessThanOrEqual(withoutIssues.safety!);
    expect(withIssues.safety!).toBeGreaterThanOrEqual(1);

    expect(withIssues.details?.cee_issue_count).toBe(3);
  });

  it("handles missing graph and non-finite confidence gracefully", () => {
    const quality = computeQuality({
      graph: undefined,
      confidence: Number.NaN,
      engineIssueCount: 2,
      ceeIssues: [],
    });

    expect(quality.overall).toBeGreaterThanOrEqual(1);
    expect(quality.overall).toBeLessThanOrEqual(10);
    expect(quality.structure).toBeGreaterThanOrEqual(1);
    expect(quality.coverage).toBeGreaterThanOrEqual(1);
    expect(quality.safety).toBeGreaterThanOrEqual(1);
    expect(quality.structural_proxy).toBe(quality.structure);
  });

  it("maps overall scores into deterministic quality bands", () => {
    const expectBand = (score: number, band: CeeQualityBand) => {
      expect(getCeeQualityBand(score)).toBe(band);
    };

    expectBand(1, "low_confidence");
    expectBand(3, "low_confidence");
    expectBand(4, "uncertain");
    expectBand(6, "uncertain");
    expectBand(7, "confident");
    expectBand(10, "confident");

    // Non-integer scores are clamped and rounded before banding.
    expectBand(6.6, "confident");
    expectBand(3.7, "uncertain");
  });
});

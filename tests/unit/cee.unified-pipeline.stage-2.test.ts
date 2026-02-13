/**
 * Stage 2: Normalise — Unit Tests
 *
 * Verifies STRP + risk coefficient normalisation + edge count invariant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock STRP
vi.mock("../../src/validators/structural-reconciliation.js", () => ({
  reconcileStructuralTruth: vi.fn(),
}));

// Mock risk normalisation
vi.mock("../../src/cee/transforms/risk-normalisation.js", () => ({
  normaliseRiskCoefficients: vi.fn(),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { reconcileStructuralTruth } from "../../src/validators/structural-reconciliation.js";
import { normaliseRiskCoefficients } from "../../src/cee/transforms/risk-normalisation.js";
import { log, emit } from "../../src/utils/telemetry.js";

function makeCtx(graph?: any): any {
  return {
    requestId: "test-req",
    graph: graph ?? {
      nodes: [
        { id: "g1", kind: "goal", label: "Goal" },
        { id: "r1", kind: "risk", label: "Risk" },
      ],
      edges: [
        { id: "e1", from: "r1", to: "g1", strength_mean: 0.5 },
      ],
      version: "1.2",
    },
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
  };
}

describe("runStageNormalise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls STRP then risk coefficients in order", async () => {
    const ctx = makeCtx();
    const callOrder: string[] = [];

    (reconcileStructuralTruth as any).mockImplementation((graph: any) => {
      callOrder.push("strp");
      return { graph, mutations: [] };
    });

    (normaliseRiskCoefficients as any).mockImplementation((nodes: any, edges: any) => {
      callOrder.push("risk");
      return { edges, corrections: [] };
    });

    await runStageNormalise(ctx);

    expect(callOrder).toEqual(["strp", "risk"]);
    expect(ctx.strpResult).toBeDefined();
    expect(ctx.strpResult.mutations).toEqual([]);
  });

  it("applies STRP mutations to ctx.graph", async () => {
    const ctx = makeCtx();
    const mutatedGraph = {
      ...ctx.graph,
      nodes: [...(ctx.graph as any).nodes, { id: "f1", kind: "factor" }],
    };

    (reconcileStructuralTruth as any).mockReturnValue({
      graph: mutatedGraph,
      mutations: [{ rule: "R1", code: "category_fixed", field: "category", before: "x", after: "y", reason: "test", severity: "info" }],
    });

    (normaliseRiskCoefficients as any).mockReturnValue({ edges: mutatedGraph.edges, corrections: [] });

    await runStageNormalise(ctx);

    expect(ctx.graph).toBe(mutatedGraph);
    expect(ctx.strpResult.mutations).toHaveLength(1);
  });

  it("applies risk coefficient corrections", async () => {
    const ctx = makeCtx();

    (reconcileStructuralTruth as any).mockImplementation((graph: any) => ({
      graph,
      mutations: [],
    }));

    const flippedEdge = { id: "e1", from: "r1", to: "g1", strength_mean: -0.5 };
    (normaliseRiskCoefficients as any).mockReturnValue({
      edges: [flippedEdge],
      corrections: [{ edgeId: "e1", field: "strength_mean", before: 0.5, after: -0.5 }],
    });

    await runStageNormalise(ctx);

    expect(ctx.riskCoefficientCorrections).toHaveLength(1);
    expect((ctx.graph as any).edges[0].strength_mean).toBe(-0.5);
  });

  it("no-ops when ctx.graph is undefined", async () => {
    const ctx = makeCtx(undefined);
    ctx.graph = undefined;

    await runStageNormalise(ctx);

    expect(reconcileStructuralTruth).not.toHaveBeenCalled();
    expect(normaliseRiskCoefficients).not.toHaveBeenCalled();
  });

  it("edge count invariant: no error when count unchanged", async () => {
    const ctx = makeCtx();

    (reconcileStructuralTruth as any).mockImplementation((graph: any) => ({
      graph,
      mutations: [],
    }));

    (normaliseRiskCoefficients as any).mockImplementation((_n: any, edges: any) => ({
      edges,
      corrections: [],
    }));

    await runStageNormalise(ctx);

    expect(log.error).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith("cee.stage2.edge_count_invariant_violated", expect.anything());
  });

  it("edge count invariant: allows STRP-recorded decreases", async () => {
    const ctx = makeCtx();

    // STRP removes one edge and records it
    (reconcileStructuralTruth as any).mockImplementation((graph: any) => ({
      graph: { ...graph, edges: [] },
      mutations: [{ rule: "R4", code: "edge_removed", field: "edge", before: "e1", after: null, reason: "test", severity: "warn" }],
    }));

    (normaliseRiskCoefficients as any).mockImplementation((_n: any, edges: any) => ({
      edges,
      corrections: [],
    }));

    await runStageNormalise(ctx);

    // Should NOT log error — the loss is accounted for
    expect(log.error).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith("cee.stage2.edge_count_invariant_violated", expect.anything());
  });

  it("edge count invariant: fires when unaccounted loss detected", async () => {
    const ctx = makeCtx();

    // STRP removes one edge but does NOT record it
    (reconcileStructuralTruth as any).mockImplementation((graph: any) => ({
      graph: { ...graph, edges: [] },
      mutations: [],
    }));

    (normaliseRiskCoefficients as any).mockImplementation((_n: any, edges: any) => ({
      edges,
      corrections: [],
    }));

    await runStageNormalise(ctx);

    // Should log error — 1 edge lost with no STRP record
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.stage2.edge_count_invariant_violated",
        unaccounted_loss: 1,
      }),
      expect.any(String),
    );
    expect(emit).toHaveBeenCalledWith(
      "cee.stage2.edge_count_invariant_violated",
      expect.objectContaining({ unaccounted_loss: 1 }),
    );
  });
});

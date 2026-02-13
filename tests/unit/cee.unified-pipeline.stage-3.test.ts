/**
 * Stage 3: Enrich — Unit Tests
 *
 * Verifies factor enrichment, post-enrich invariant, cycle detection,
 * stabilisation, simpleRepair, and enrichmentTrace.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock enricher
vi.mock("../../src/cee/factor-extraction/enricher.js", () => ({
  enrichGraphWithFactorsAsync: vi.fn(),
}));

// Mock graphGuards
vi.mock("../../src/utils/graphGuards.js", () => ({
  detectCycles: vi.fn(),
}));

// Mock orchestrator
vi.mock("../../src/orchestrator/index.js", () => ({
  stabiliseGraph: vi.fn(),
  ensureDagAndPrune: vi.fn(),
}));

// Mock repair
vi.mock("../../src/services/repair.js", () => ({
  simpleRepair: vi.fn(),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { enrichGraphWithFactorsAsync } from "../../src/cee/factor-extraction/enricher.js";
import { detectCycles } from "../../src/utils/graphGuards.js";
import { stabiliseGraph, ensureDagAndPrune } from "../../src/orchestrator/index.js";
import { simpleRepair } from "../../src/services/repair.js";
import { log, emit } from "../../src/utils/telemetry.js";

const baseGraph = {
  nodes: [
    { id: "g1", kind: "goal", label: "Goal" },
    { id: "o1", kind: "option", label: "Option" },
  ],
  edges: [
    { id: "e1", from: "o1", to: "g1" },
  ],
  version: "1.2",
};

function makeCtx(graph?: any): any {
  return {
    requestId: "test-req",
    graph: graph ?? { ...baseGraph },
    effectiveBrief: "Test brief",
    input: { brief: "Test brief" },
    collector: { add: vi.fn(), addByStage: vi.fn() },
    enrichmentResult: undefined,
    hadCycles: false,
    enrichmentTrace: undefined,
  };
}

function setupMocks(overrides?: { enrichResult?: any; cycles?: any; stabiliseResult?: any; repairResult?: any }) {
  const enrichResult = overrides?.enrichResult ?? {
    graph: { ...baseGraph },
    factorsAdded: 2,
    factorsEnhanced: 1,
    factorsSkipped: 0,
    extractionMode: "llm-first",
    llmSuccess: true,
    warnings: [],
  };

  (enrichGraphWithFactorsAsync as any).mockResolvedValue(enrichResult);
  (detectCycles as any).mockReturnValue(overrides?.cycles ?? []);

  const stabilised = overrides?.stabiliseResult ?? { ...baseGraph };
  (ensureDagAndPrune as any).mockReturnValue(stabilised);
  (stabiliseGraph as any).mockReturnValue(stabilised);

  const repaired = overrides?.repairResult ?? { ...baseGraph };
  (simpleRepair as any).mockReturnValue(repaired);

  return enrichResult;
}

describe("runStageEnrich", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls enrichGraphWithFactorsAsync exactly once", async () => {
    const ctx = makeCtx();
    setupMocks();

    await runStageEnrich(ctx);

    expect(enrichGraphWithFactorsAsync).toHaveBeenCalledTimes(1);
    expect(enrichGraphWithFactorsAsync).toHaveBeenCalledWith(
      ctx.graph,
      ctx.effectiveBrief,
      expect.objectContaining({ collector: ctx.collector }),
    );
  });

  it("sets ctx.enrichmentResult from enricher output", async () => {
    const ctx = makeCtx();
    const enrichResult = setupMocks();

    await runStageEnrich(ctx);

    expect(ctx.enrichmentResult).toBe(enrichResult);
  });

  it("calls stabilise → simpleRepair → stabilise in order", async () => {
    const ctx = makeCtx();
    setupMocks();
    const callOrder: string[] = [];

    (ensureDagAndPrune as any).mockImplementation((g: any) => {
      callOrder.push("ensureDag");
      return g;
    });
    (stabiliseGraph as any).mockImplementation((g: any) => {
      callOrder.push("stabilise");
      return g;
    });
    (simpleRepair as any).mockImplementation((g: any) => {
      callOrder.push("simpleRepair");
      return g;
    });

    await runStageEnrich(ctx);

    // Order: ensureDag+stabilise (first), simpleRepair, ensureDag+stabilise (second)
    expect(callOrder).toEqual([
      "ensureDag", "stabilise",
      "simpleRepair",
      "ensureDag", "stabilise",
    ]);
  });

  it("sets ctx.hadCycles when cycles detected", async () => {
    const ctx = makeCtx();
    setupMocks({ cycles: [["a", "b", "a"]] });

    await runStageEnrich(ctx);

    expect(ctx.hadCycles).toBe(true);
  });

  it("sets ctx.hadCycles = false when no cycles", async () => {
    const ctx = makeCtx();
    setupMocks({ cycles: [] });

    await runStageEnrich(ctx);

    expect(ctx.hadCycles).toBe(false);
  });

  it("builds enrichmentTrace from enrichmentResult directly (change 4)", async () => {
    const ctx = makeCtx();
    setupMocks({
      enrichResult: {
        graph: { ...baseGraph },
        factorsAdded: 3,
        factorsEnhanced: 1,
        factorsSkipped: 2,
        extractionMode: "regex-only",
        llmSuccess: false,
        warnings: [],
      },
    });

    await runStageEnrich(ctx);

    expect(ctx.enrichmentTrace).toEqual({
      called_count: 1,
      extraction_mode: "regex-only",
      factors_added: 3,
      factors_enhanced: 1,
      factors_skipped: 2,
      llm_success: false,
    });
  });

  it("fires post-enrich invariant for factors without data.value", async () => {
    const ctx = makeCtx();
    setupMocks({
      enrichResult: {
        graph: {
          ...baseGraph,
          nodes: [
            ...baseGraph.nodes,
            { id: "f1", kind: "factor", category: "controllable", data: {} },
            { id: "f2", kind: "factor", category: "controllable", data: { value: 42 } },
          ],
        },
        factorsAdded: 2,
        factorsEnhanced: 0,
        factorsSkipped: 0,
        extractionMode: "llm-first",
        llmSuccess: true,
        warnings: [],
      },
    });

    await runStageEnrich(ctx);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.post_enrich.controllable_without_value",
        without_value: 1,
        total_controllable: 2,
      }),
      expect.any(String),
    );
    expect(emit).toHaveBeenCalledWith(
      "cee.post_enrich.invariant_violation",
      expect.objectContaining({ without_value: 1 }),
    );
  });

  it("no-ops when ctx.graph is undefined", async () => {
    const ctx = makeCtx(undefined);
    ctx.graph = undefined;

    await runStageEnrich(ctx);

    expect(enrichGraphWithFactorsAsync).not.toHaveBeenCalled();
    expect(ctx.enrichmentTrace).toBeUndefined();
  });

  it("updates ctx.graph to stabilised result", async () => {
    const ctx = makeCtx();
    const finalGraph = { nodes: [{ id: "g1" }], edges: [], version: "1.2" };
    setupMocks({ stabiliseResult: finalGraph, repairResult: finalGraph });

    // The second stabilise call should produce the final graph
    let callCount = 0;
    (stabiliseGraph as any).mockImplementation(() => {
      callCount++;
      return callCount === 2 ? finalGraph : { ...baseGraph };
    });

    await runStageEnrich(ctx);

    expect(ctx.graph).toBe(finalGraph);
  });
});

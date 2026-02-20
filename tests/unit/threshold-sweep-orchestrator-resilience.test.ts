/**
 * Orchestrator resilience: Stage 4b (threshold sweep) crash → pipeline continues.
 *
 * Verifies the defensive try/catch wrapper in the orchestrator ensures
 * a threshold sweep failure does not crash the pipeline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all stage modules
vi.mock("../../src/cee/unified-pipeline/stages/parse.js", () => ({
  runStageParse: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/normalise.js", () => ({
  runStageNormalise: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/enrich.js", () => ({
  runStageEnrich: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/repair/index.js", () => ({
  runStageRepair: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/package.js", () => ({
  runStagePackage: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/boundary.js", () => ({
  runStageBoundary: vi.fn(),
}));

// Mock threshold sweep to THROW
vi.mock("../../src/cee/unified-pipeline/stages/threshold-sweep.js", () => ({
  runStageThresholdSweep: vi.fn().mockRejectedValue(new TypeError("nodes is not iterable")),
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { pipelineCheckpointsEnabled: false } },
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/cee/corrections.js", () => ({
  createCorrectionCollector: () => ({
    add: vi.fn(),
    addByStage: vi.fn(),
    getCorrections: () => [],
    getSummary: () => ({ total: 0, by_layer: {}, by_type: {} }),
    hasCorrections: () => false,
    count: () => 0,
  }),
}));

vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: () => "test-request-id",
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string) => ({ error: { code, message: msg } }),
}));

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { log } from "../../src/utils/telemetry.js";

const mockRequest = { id: "test", headers: {}, query: {}, raw: { destroyed: false } } as any;
const baseInput = { brief: "Test brief" };
const baseOpts = { schemaVersion: "v3" as const };

describe("Orchestrator resilience: Stage 4b throws", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pipeline completes with 200 when threshold sweep throws", async () => {
    const preExistingRepairs = [{ code: "NAN_VALUE", path: "edges[e1].strength_mean", action: "replaced" }];
    const preExistingTrace = { deterministic_sweep: { sweep_ran: true, goal_threshold_stripped: 0 } };

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {});
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      // Simulate pre-existing repairs/trace from Stage 4
      ctx.deterministicRepairs = [...preExistingRepairs];
      ctx.repairTrace = structuredClone(preExistingTrace);
    });
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      // Capture state seen by Package for assertions below
      (ctx as any)._packageSawRepairs = [...(ctx.deterministicRepairs ?? [])];
      (ctx as any)._packageSawTrace = structuredClone(ctx.repairTrace);
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = { graph: { nodes: [], edges: [] } };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    // Pipeline completes despite Stage 4b failure
    expect(result.statusCode).toBe(200);

    // Package and Boundary still ran
    expect(runStagePackage).toHaveBeenCalledTimes(1);
    expect(runStageBoundary).toHaveBeenCalledTimes(1);

    // Warning was logged
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "cee.threshold_sweep.failed",
        error: "nodes is not iterable",
      }),
      expect.stringContaining("Stage 4b"),
    );

    // Pre-existing repairs and trace were not modified by the failed sweep
    const ctx = (runStagePackage as any).mock.calls[0][0];
    expect(ctx._packageSawRepairs).toEqual(preExistingRepairs);
    expect(ctx._packageSawTrace).toEqual(preExistingTrace);
  });
});

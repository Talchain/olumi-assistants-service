/**
 * Unified Pipeline Orchestrator Tests
 *
 * Verifies the orchestrator correctly sequences stages,
 * handles early returns, and maps errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all stage modules before importing orchestrator
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

// Mock config
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      pipelineCheckpointsEnabled: false,
    },
  },
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

// Mock corrections
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

// Mock request-id
vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: () => "test-request-id",
  generateRequestId: () => "test-plan-id-0000-0000-000000000000",
}));

// Mock error response builder
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
import { LLMTimeoutError, RequestBudgetExceededError } from "../../src/adapters/llm/errors.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseInput = {
  brief: "Test brief",
};

const baseOpts = {
  schemaVersion: "v3" as const,
};

describe("runUnifiedPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls all 6 stages in order for a successful pipeline run", async () => {
    const callOrder: string[] = [];

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      callOrder.push("parse");
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => callOrder.push("normalise"));
    (runStageEnrich as any).mockImplementation(async () => callOrder.push("enrich"));
    (runStageRepair as any).mockImplementation(async () => callOrder.push("repair"));
    (runStagePackage as any).mockImplementation(async () => callOrder.push("package"));
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      callOrder.push("boundary");
      ctx.finalResponse = { test: true };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ test: true });
    expect(callOrder).toEqual(["parse", "normalise", "enrich", "repair", "package", "boundary"]);
  });

  it("returns early when parse sets earlyReturn", async () => {
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.earlyReturn = { statusCode: 400, body: { error: "bad input" } };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({ error: "bad input" });
    expect(runStageNormalise).not.toHaveBeenCalled();
  });

  it("returns raw output when rawOutput option is set", async () => {
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [{ id: "g1" }], edges: [], version: "1.2" };
      ctx.rationales = [{ target: "g1", why: "test" }];
      ctx.confidence = 0.8;
    });

    const result = await runUnifiedPipeline(
      baseInput as any,
      {},
      mockRequest,
      { ...baseOpts, rawOutput: true },
    );

    expect(result.statusCode).toBe(200);
    expect((result.body as any).graph).toBeDefined();
    expect((result.body as any).rationales).toHaveLength(1);
    expect(runStageNormalise).not.toHaveBeenCalled();
  });

  it("returns early when repair sets earlyReturn", async () => {
    const callOrder: string[] = [];

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      callOrder.push("parse");
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => callOrder.push("normalise"));
    (runStageEnrich as any).mockImplementation(async () => callOrder.push("enrich"));
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      callOrder.push("repair");
      ctx.earlyReturn = { statusCode: 422, body: { error: "invalid graph" } };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(422);
    expect(callOrder).toEqual(["parse", "normalise", "enrich", "repair"]);
    expect(runStagePackage).not.toHaveBeenCalled();
  });

  it("maps LLMTimeoutError to 504", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new LLMTimeoutError("timeout", "model-x", 30000, 35000, "corr-1");
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(504);
    expect((result.body as any).error.code).toBe("CEE_TIMEOUT");
  });

  it("maps RequestBudgetExceededError to 429", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new RequestBudgetExceededError("budget exceeded", 90000, 95000, "parse", "test-req");
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(429);
    expect((result.body as any).error.code).toBe("CEE_RATE_LIMIT");
  });

  it("returns 501 when stages produce no finalResponse (incomplete wiring guard)", async () => {
    // All stages are no-ops — no stage sets ctx.finalResponse
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {});
    (runStageRepair as any).mockImplementation(async () => {});
    (runStagePackage as any).mockImplementation(async () => {});
    (runStageBoundary as any).mockImplementation(async () => {});

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(501);
    expect((result.body as any).error.code).toBe("CEE_SERVICE_UNAVAILABLE");
  });

  it("returns early when boundary sets earlyReturn (strict-mode 422)", async () => {
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {});
    (runStageRepair as any).mockImplementation(async () => {});
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      ctx.ceeResponse = { graph: { nodes: [], edges: [] } };
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.earlyReturn = {
        statusCode: 422,
        body: {
          error: {
            code: "CEE_V3_VALIDATION_FAILED",
            message: "Missing required field: edges",
          },
        },
      };
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(422);
    expect((result.body as any).error.code).toBe("CEE_V3_VALIDATION_FAILED");
    // Should NOT fall through to the 501 guard
    expect(result.statusCode).not.toBe(501);
  });

  it("maps unknown errors to 500", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("something broke");
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(500);
    expect((result.body as any).error.code).toBe("CEE_INTERNAL_ERROR");
  });
});

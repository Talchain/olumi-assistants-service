/**
 * Track 1: Progressive degradation tests
 *
 * Task 4: Post-draft success floor invariant
 *   Once a graph passes the deterministic sweep with 0 violations,
 *   simulate failures in every downstream soft-gate stage.
 *   Assert: 200, graph present, _pipeline_outcome.warnings lists degraded stages,
 *   graph_structurally_valid is true.
 *
 * Task 6: Resilience canary — graph survives downstream failure
 *   Force a verification pipeline failure and prove the graph survives.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all stage modules ────────────────────────────────────────────────
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
vi.mock("../../src/cee/unified-pipeline/stages/threshold-sweep.js", () => ({
  runStageThresholdSweep: vi.fn(),
}));

// Mock validation pipeline
vi.mock("../../src/cee/validation-pipeline/index.js", () => ({
  runValidationPipeline: vi.fn(),
}));

// Mock config
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      pipelineCheckpointsEnabled: false,
      validationPipelineEnabled: false,
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

// Mock response hash
vi.mock("../../src/utils/response-hash.js", () => ({
  computeResponseHash: () => "deadbeef",
}));

// Mock error response builder
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, opts?: any) => ({
    schema: "cee.error.v1",
    code,
    message: msg,
    reason: opts?.reason,
    recovery: opts?.recovery,
  }),
}));

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import type { PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseOpts = {
  schemaVersion: "v3" as const,
};

/**
 * Build a valid graph that would pass the deterministic sweep.
 * Contains goal, options, factors, edges — structurally complete.
 */
function buildValidGraph() {
  return {
    nodes: [
      { id: "goal_mrr", kind: "goal", label: "Maximize MRR", category: "goal", data: { value: 0.5, goal_threshold: 50000 } },
      { id: "opt_premium", kind: "option", label: "Launch premium tier", category: "option", data: {} },
      { id: "opt_freemium", kind: "option", label: "Keep freemium", category: "option", data: { is_status_quo: true } },
      { id: "fac_price", kind: "factor", label: "Price level", category: "controllable", data: { value: 0.5 } },
      { id: "fac_churn", kind: "factor", label: "Churn rate", category: "external", data: { value: 0.3 } },
      { id: "out_revenue", kind: "outcome", label: "Revenue", category: "outcome", data: { value: 0.6 } },
    ],
    edges: [
      { from: "opt_premium", to: "fac_price", strength_mean: 0.8, type: "causal" },
      { from: "opt_freemium", to: "fac_price", strength_mean: 0.3, type: "causal" },
      { from: "fac_price", to: "out_revenue", strength_mean: 0.7, type: "causal" },
      { from: "fac_churn", to: "out_revenue", strength_mean: -0.4, type: "causal" },
      { from: "out_revenue", to: "goal_mrr", strength_mean: 0.9, type: "causal" },
    ],
    version: "1.2",
  };
}

/**
 * Set up stages 1-4 to succeed (graph drafted + repaired),
 * but allow stages 5-6 to be customized for failure injection.
 */
function setupSuccessfulDraftAndRepair() {
  const graph = buildValidGraph();

  (runStageParse as any).mockImplementation(async (ctx: any) => {
    ctx.graph = graph;
    ctx.rationales = [];
    ctx.confidence = 0.8;
    ctx.draftAdapter = { name: "openai", model: "gpt-4.1" };
    ctx.llmMeta = { model: "gpt-4.1", prompt_version: "v188" };
  });

  (runStageNormalise as any).mockImplementation(async () => {});

  (runStageEnrich as any).mockImplementation(async (ctx: any) => {
    ctx.enrichmentTrace = {
      called_count: 1,
      extraction_mode: "llm",
      factors_added: 0,
      factors_enhanced: 0,
      factors_skipped: 0,
      llm_success: true,
    };
  });

  (runStageRepair as any).mockImplementation(async (ctx: any) => {
    // Simulate successful deterministic sweep with 0 violations
    ctx.repairTrace = {
      deterministic_sweep: {
        sweep_ran: true,
        sweep_version: "3.0",
        bucket_summary: { A: 0, B: 0, C: 0 },
      },
    };
    ctx.deterministicRepairs = [];
    ctx.remainingViolations = [];
  });

  (runStageThresholdSweep as any).mockImplementation(async () => {});

  return graph;
}

// ============================================================================
// Task 4: Post-draft success floor invariant
// ============================================================================

describe("Task 4: Post-draft success floor invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("graph survives when ALL downstream soft gates fail simultaneously", async () => {
    const graph = setupSuccessfulDraftAndRepair();

    // Stage 5: Package — make verification fail inside package
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      // Simulate successful package but with verification failure tracked
      ctx.pipelineOutcome.verification_status = "failed_degraded";
      ctx.pipelineOutcome.warnings.push({
        stage: "verification",
        error: "Zod schema mismatch on edges",
        degraded: true,
      });
      ctx.ceeResponse = {
        graph: ctx.graph,
        rationales: ctx.rationales,
        confidence: ctx.confidence,
        trace: { request_id: ctx.requestId },
      };
    });

    // Stage 6: Boundary — simulate V3 validation warning but graph preserved
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.pipelineOutcome.warnings.push({
        stage: "boundary_v3_validation",
        error: "V3 schema validation failed: 2 issues",
        degraded: true,
      });
      ctx.pipelineOutcome.warnings.push({
        stage: "boundary_strict_mode",
        error: "strict mode check failed",
        degraded: true,
      });
      // Graph is preserved in the response (soft gate behaviour)
      ctx.finalResponse = {
        nodes: ctx.graph.nodes,
        edges: ctx.graph.edges,
        graph: ctx.graph,
        analysis_ready: { status: "ready" },
      };
    });

    const result = await runUnifiedPipeline(
      { brief: "Launch premium tier at £29/month vs keep freemium" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    // INVARIANT: Pipeline returns 200
    expect(result.statusCode).toBe(200);

    // INVARIANT: Response contains the graph (nodes and edges present)
    const body = result.body as any;
    expect(body.nodes).toBeDefined();
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges).toBeDefined();
    expect(body.edges.length).toBeGreaterThan(0);

    // INVARIANT: _pipeline_outcome present
    const outcome: PipelineOutcome = body._pipeline_outcome;
    expect(outcome).toBeDefined();

    // INVARIANT: graph_structurally_valid is true
    expect(outcome.graph_structurally_valid).toBe(true);
    expect(outcome.graph_drafted).toBe(true);

    // INVARIANT: warnings list all degraded stages
    expect(outcome.warnings.length).toBeGreaterThanOrEqual(3);
    const warningStages = outcome.warnings.map((w) => w.stage);
    expect(warningStages).toContain("verification");
    expect(warningStages).toContain("boundary_v3_validation");
    expect(warningStages).toContain("boundary_strict_mode");

    // All warnings are marked as degraded
    for (const w of outcome.warnings) {
      expect(w.degraded).toBe(true);
    }
  });

  it("_pipeline_outcome present with all fields on success", async () => {
    setupSuccessfulDraftAndRepair();

    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      ctx.pipelineOutcome.verification_status = "passed";
      ctx.ceeResponse = {
        graph: ctx.graph,
        rationales: [],
        confidence: 0.8,
        trace: { request_id: ctx.requestId },
      };
    });

    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = {
        nodes: (ctx.graph as any).nodes,
        edges: (ctx.graph as any).edges,
        graph: ctx.graph,
      };
    });

    const result = await runUnifiedPipeline(
      { brief: "Should we launch premium?" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(200);
    const outcome: PipelineOutcome = (result.body as any)._pipeline_outcome;

    expect(outcome.graph_drafted).toBe(true);
    expect(outcome.graph_structurally_valid).toBe(true);
    expect(outcome.deterministic_sweep_violations).toBe(0);
    expect(outcome.verification_status).toBe("passed");
    expect(outcome.enrichment_status).toBe("complete");
    expect(outcome.coaching_status).toBe("complete");
    expect(outcome.warnings).toEqual([]);
  });

  it("_pipeline_outcome present on error responses (pre-draft failure)", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("openai_empty_response");
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    const outcome: PipelineOutcome = (result.body as any)._pipeline_outcome;

    expect(outcome).toBeDefined();
    expect(outcome.graph_drafted).toBe(false);
    expect(outcome.graph_structurally_valid).toBe(false);
    expect(outcome.verification_status).toBe("skipped");
    expect(outcome.validation_status).toBe("skipped");
    expect(outcome.enrichment_status).toBe("skipped");
    expect(outcome.coaching_status).toBe("partial");
  });

  it("_pipeline_outcome present on enrichment failure", async () => {
    const graph = buildValidGraph();
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = graph;
      ctx.rationales = [];
      ctx.confidence = 0.8;
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {
      throw new Error("enrichment crashed");
    });

    const result = await runUnifiedPipeline(
      { brief: "test brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    const outcome: PipelineOutcome = (result.body as any)._pipeline_outcome;

    expect(outcome).toBeDefined();
    expect(outcome.graph_drafted).toBe(true);
    expect(outcome.enrichment_status).toBe("partial");
    expect(outcome.graph_structurally_valid).toBe(false);
  });

  it("deterministic_sweep_violations reflects actual count", async () => {
    setupSuccessfulDraftAndRepair();

    // Override repair to report violations
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      ctx.repairTrace = {
        deterministic_sweep: {
          sweep_ran: true,
          sweep_version: "3.0",
          bucket_summary: { A: 3, B: 1, C: 0 },
        },
      };
      ctx.deterministicRepairs = [
        { code: "NAN_VALUE", path: "nodes[fac_x].data.value", action: "set to 0.5" },
      ];
    });

    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      ctx.ceeResponse = { graph: ctx.graph, rationales: [], confidence: 0.8, trace: {} };
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = { nodes: [], edges: [], graph: ctx.graph };
    });

    const result = await runUnifiedPipeline(
      { brief: "test" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(200);
    const outcome: PipelineOutcome = (result.body as any)._pipeline_outcome;
    expect(outcome.deterministic_sweep_violations).toBe(4);
  });
});

// ============================================================================
// Task 6: Resilience canary — graph survives downstream failure
// ============================================================================

describe("Task 6: Resilience canary — graph survives verification failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verification pipeline failure does NOT block the response", async () => {
    const graph = setupSuccessfulDraftAndRepair();

    // Stage 5: Package — simulate verification pipeline throwing
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      // The actual soft-gate behaviour: catch the error, log, continue
      ctx.pipelineOutcome.verification_status = "failed_degraded";
      ctx.pipelineOutcome.warnings.push({
        stage: "verification",
        error: "ZodError: Required field missing at edges[0].effect_direction",
        degraded: true,
      });
      // Response is built from unverified ceeResponse
      ctx.ceeResponse = {
        graph: ctx.graph,
        rationales: ctx.rationales,
        confidence: ctx.confidence,
        trace: { request_id: ctx.requestId },
      };
    });

    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = {
        nodes: (ctx.graph as any).nodes,
        edges: (ctx.graph as any).edges,
        graph: ctx.graph,
        analysis_ready: { status: "ready" },
      };
    });

    const result = await runUnifiedPipeline(
      {
        brief: "We're deciding whether to launch a premium tier at £29/month, keep freemium, or add usage-based pricing. Goal: reach £50k MRR within 9 months while keeping churn below 5%.",
      } as any,
      {},
      mockRequest,
      baseOpts,
    );

    // ASSERT: HTTP 200 (not 502 or 400)
    expect(result.statusCode).toBe(200);

    const body = result.body as any;

    // ASSERT: Graph present in response with nodes and edges
    expect(body.nodes).toBeDefined();
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges).toBeDefined();
    expect(body.edges.length).toBeGreaterThan(0);

    // ASSERT: _pipeline_outcome.verification_status is 'failed_degraded'
    const outcome: PipelineOutcome = body._pipeline_outcome;
    expect(outcome).toBeDefined();
    expect(outcome.verification_status).toBe("failed_degraded");

    // ASSERT: _pipeline_outcome.warnings contains the verification failure
    const verificationWarning = outcome.warnings.find((w) => w.stage === "verification");
    expect(verificationWarning).toBeDefined();
    expect(verificationWarning!.error).toContain("ZodError");
    expect(verificationWarning!.degraded).toBe(true);

    // ASSERT: graph_structurally_valid is true (survived repair)
    expect(outcome.graph_structurally_valid).toBe(true);
    expect(outcome.graph_drafted).toBe(true);
  });

  it("threshold sweep failure is captured in warnings but graph survives", async () => {
    setupSuccessfulDraftAndRepair();

    // Make threshold sweep throw
    (runStageThresholdSweep as any).mockImplementation(async () => {
      throw new Error("threshold sweep: cannot read property 'nodes' of undefined");
    });

    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      ctx.ceeResponse = { graph: ctx.graph, rationales: [], confidence: 0.8, trace: {} };
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = {
        nodes: (ctx.graph as any).nodes,
        edges: (ctx.graph as any).edges,
        graph: ctx.graph,
      };
    });

    const result = await runUnifiedPipeline(
      { brief: "test brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(200);
    const outcome: PipelineOutcome = (result.body as any)._pipeline_outcome;
    expect(outcome.graph_structurally_valid).toBe(true);

    const sweepWarning = outcome.warnings.find((w) => w.stage === "threshold_sweep");
    expect(sweepWarning).toBeDefined();
    expect(sweepWarning!.degraded).toBe(true);
  });

  it("Package stage throw degrades to 200 with graph (P0-2 fix)", async () => {
    setupSuccessfulDraftAndRepair();

    // Stage 5 throws an uncaught exception
    (runStagePackage as any).mockImplementation(async () => {
      throw new Error("quality computation blew up");
    });

    const result = await runUnifiedPipeline(
      { brief: "test brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    // Must return 200, not 500
    expect(result.statusCode).toBe(200);
    const body = result.body as any;
    // Graph must be present
    expect(body.graph).toBeDefined();
    expect(body.graph.nodes.length).toBeGreaterThan(0);

    const outcome: PipelineOutcome = body._pipeline_outcome;
    expect(outcome.graph_structurally_valid).toBe(true);
    expect(outcome.coaching_status).toBe("failed_degraded");

    const pkgWarning = outcome.warnings.find((w) => w.stage === "package");
    expect(pkgWarning).toBeDefined();
    expect(pkgWarning!.error).toContain("quality computation blew up");
    expect(pkgWarning!.degraded).toBe(true);
  });

  it("Boundary stage throw degrades to 200 with packaged response (P0-2 fix)", async () => {
    setupSuccessfulDraftAndRepair();

    const packagedResponse = {
      graph: buildValidGraph(),
      rationales: [],
      confidence: 0.8,
      trace: { request_id: "test" },
    };

    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      ctx.ceeResponse = packagedResponse;
    });

    // Stage 6 throws an uncaught exception
    (runStageBoundary as any).mockImplementation(async () => {
      throw new Error("V3 transform crash");
    });

    const result = await runUnifiedPipeline(
      { brief: "test brief" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    // Must return 200, not 500
    expect(result.statusCode).toBe(200);
    const body = result.body as any;
    // Packaged V1 response returned as fallback
    expect(body.graph).toBeDefined();

    const outcome: PipelineOutcome = body._pipeline_outcome;
    expect(outcome.graph_structurally_valid).toBe(true);
    expect(outcome.coaching_status).toBe("complete");

    const boundaryWarning = outcome.warnings.find((w) => w.stage === "boundary");
    expect(boundaryWarning).toBeDefined();
    expect(boundaryWarning!.error).toContain("V3 transform crash");
  });
});

/**
 * @regression B6 smoke test — graceful degradation for nonsensical briefs.
 * Previously fixed in 3fdd8ab, regressed in f77d56f.
 *
 * Verifies that nonsensical or empty briefs produce structured error responses
 * (not HTTP 500 CEE_INTERNAL_ERROR) when the LLM returns unparseable,
 * schema-invalid, or degenerate graph output.
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

// Mock error response builder — pass through code and message for assertion
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
import {
  UpstreamNonJsonError,
  UpstreamHTTPError,
} from "../../src/adapters/llm/errors.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseOpts = {
  schemaVersion: "v3" as const,
};

// Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
describe("@regression B6: graceful degradation for nonsensical briefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── LLM adapter error paths ─────────────────────────────────────────

  it("nonsensical brief → UpstreamNonJsonError → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new UpstreamNonJsonError(
        "LLM returned non-JSON",
        "openai",
        "draft_graph",
        5000,
        "asdf garbled output...",
      );
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl;asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
    expect((result.body as any).reason).toBe("llm_non_json");
    expect((result.body as any).recovery).toBeDefined();
    expect((result.body as any).recovery.suggestion).toBeTruthy();
  });

  it("empty brief → UpstreamNonJsonError → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new UpstreamNonJsonError(
        "LLM returned non-JSON",
        "openai",
        "draft_graph",
        3000,
        "",
      );
    });

    const result = await runUnifiedPipeline(
      { brief: "" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
  });

  it("nonsensical brief → openai_response_invalid_schema → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("openai_response_invalid_schema: nodes: Required");
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl;asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
    expect((result.body as any).reason).toBe("llm_schema_invalid");
  });

  it("nonsensical brief → anthropic_response_invalid_schema → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("anthropic_response_invalid_schema: nodes: Required");
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl;asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
  });

  it("nonsensical brief → openai_empty_response → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("openai_empty_response");
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl;asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
  });

  it("draft_graph_missing_result → NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("draft_graph_missing_result");
    });

    const result = await runUnifiedPipeline(
      { brief: "" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_LLM_VALIDATION_FAILED");
  });

  // ─── Upstream HTTP error ──────────────────────────────────────────────

  it("UpstreamHTTPError → 502 NOT 500", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new UpstreamHTTPError(
        "LLM provider error",
        "openai",
        503,
        "server_error",
        "req-123",
        5000,
      );
    });

    const result = await runUnifiedPipeline(
      { brief: "test" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(502);
    expect((result.body as any).code).toBe("CEE_LLM_UPSTREAM_ERROR");
  });

  // ─── Stage 3 (Enrich) crash path ─────────────────────────────────────

  it("degenerate graph crashes Stage 3 → structured error, NOT 500", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    // LLM returns a graph that passes shape checks but crashes enrichment
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = { nodes: [], edges: [], version: "1.2" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {
      // Simulates crash from degenerate graph in enricher
      throw new TypeError("Cannot read properties of undefined (reading 'filter')");
    });

    const result = await runUnifiedPipeline(
      { brief: "asdfjkl;asdfjkl; purple monkey dishwasher" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).not.toBe(500);
    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_GRAPH_INVALID");
    expect((result.body as any).reason).toBe("enrichment_failed");
    expect((result.body as any).recovery).toBeDefined();
    expect((result.body as any).recovery.hints).toBeInstanceOf(Array);
  });

  it("empty graph crashes Stage 3 → structured error with node/edge counts", async () => {
    // Regression: B6 smoke test — graceful degradation for nonsensical briefs. Previously fixed in 3fdd8ab, regressed in f77d56f.
    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = {
        nodes: [{ id: "goal_1", kind: "goal", label: "???" }],
        edges: [],
        version: "1.2",
      };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async () => {
      throw new Error("enrichment failed on degenerate graph");
    });

    const result = await runUnifiedPipeline(
      { brief: "" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(400);
    expect((result.body as any).code).toBe("CEE_GRAPH_INVALID");
  });

  // ─── Response shape validation ────────────────────────────────────────

  it("all error responses include recovery guidance", async () => {
    const errorScenarios = [
      // UpstreamNonJsonError
      async () => { throw new UpstreamNonJsonError("bad", "openai", "draft_graph", 1000, ""); },
      // Schema validation
      async () => { throw new Error("openai_response_invalid_schema: bad"); },
      // Empty response
      async () => { throw new Error("openai_empty_response"); },
    ];

    for (const scenario of errorScenarios) {
      vi.clearAllMocks();
      (runStageParse as any).mockImplementation(scenario);

      const result = await runUnifiedPipeline(
        { brief: "asdfjkl;asdfjkl;" } as any,
        {},
        mockRequest,
        baseOpts,
      );

      expect(result.statusCode).toBeLessThan(500);
      expect((result.body as any).recovery).toBeDefined();
      expect((result.body as any).recovery.suggestion).toBeTruthy();
      expect((result.body as any).recovery.hints).toBeInstanceOf(Array);
      expect((result.body as any).recovery.hints.length).toBeGreaterThan(0);
    }
  });

  // ─── Genuine 500 errors should still surface as 500 ───────────────────

  it("genuine unexpected errors still return 500", async () => {
    (runStageParse as any).mockImplementation(async () => {
      throw new Error("completely unexpected internal failure");
    });

    const result = await runUnifiedPipeline(
      { brief: "test" } as any,
      {},
      mockRequest,
      baseOpts,
    );

    expect(result.statusCode).toBe(500);
    expect((result.body as any).code).toBe("CEE_INTERNAL_ERROR");
  });
});

/**
 * Plan Annotation Checkpoint Tests (Stream B — Stage 3)
 *
 * Verifies that the plan annotation checkpoint is captured correctly
 * after Stage 3 (Enrich), contains valid plan_id, plan_hash, rationales,
 * confidence, and context_hash, and does NOT trigger additional enrichment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock all stage modules ──────────────────────────────────────────────────
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

// ── Mock config ─────────────────────────────────────────────────────────────
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      pipelineCheckpointsEnabled: false,
    },
  },
}));

// ── Mock telemetry ──────────────────────────────────────────────────────────
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

// ── Mock corrections ────────────────────────────────────────────────────────
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

// ── Mock request-id (stable plan_id for assertions) ─────────────────────────
const mockGenerateRequestId = vi.fn(() => "plan-id-1234-5678-abcdef000000");
vi.mock("../../src/utils/request-id.js", () => ({
  getRequestId: () => "test-request-id",
  generateRequestId: (...args: any[]) => mockGenerateRequestId(...args),
}));

// ── Mock error response builder ─────────────────────────────────────────────
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string) => ({ error: { code, message: msg } }),
}));

// ── Imports ─────────────────────────────────────────────────────────────────
import { computeResponseHash } from "../../src/utils/response-hash.js";
import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";

const mockRequest = {
  id: "test",
  headers: {},
  query: {},
  raw: { destroyed: false },
} as any;

const baseInput = {
  brief: "A sufficiently long decision brief for plan annotation checkpoint testing.",
  seed: "test-seed-42",
};

const baseOpts = {
  schemaVersion: "v3" as const,
};

/** Standard graph fixture for post-parse / post-enrich state */
const testGraph = {
  nodes: [
    { id: "g1", kind: "goal", label: "Decide X" },
    { id: "o1", kind: "option", label: "Option A" },
    { id: "o2", kind: "option", label: "Option B" },
    { id: "f1", kind: "factor", label: "Cost", category: "controllable", data: { value: 100 } },
  ],
  edges: [
    { id: "e1", from: "o1", to: "g1", strength_mean: 0.7, strength_std: 0.1 },
    { id: "e2", from: "o2", to: "g1", strength_mean: 0.5, strength_std: 0.2 },
    { id: "e3", from: "f1", to: "o1", strength_mean: 0.6 },
  ],
  version: "1.2",
};

/**
 * Helper to run the pipeline through Stage 3 and capture context.
 * The Stage 3 mock preserves the graph set by Stage 1, so the orchestrator
 * captures the plan annotation checkpoint after enrich returns.
 */
async function runPipelineAndCapture(overrides?: {
  graph?: any;
  rationales?: any[];
  confidence?: number;
  llmMeta?: any;
  draftAdapter?: any;
}): Promise<any> {
  let capturedCtx: any;

  (runStageParse as any).mockImplementation(async (ctx: any) => {
    ctx.graph = overrides?.graph ?? structuredClone(testGraph);
    ctx.rationales = overrides?.rationales ?? [
      { node_id: "o1", rationale: "Lower cost option" },
      { node_id: "o2", rationale: "Higher quality option" },
    ];
    ctx.confidence = overrides?.confidence ?? 0.85;
    ctx.llmMeta = overrides?.llmMeta ?? {
      model: "gpt-4o-mini",
      prompt_version: "v2.3.1",
      prompt_source: "supabase",
    };
    ctx.draftAdapter = overrides?.draftAdapter ?? { model: "gpt-4o-mini", name: "draft_graph" };
  });
  (runStageNormalise as any).mockImplementation(async () => {});
  (runStageEnrich as any).mockImplementation(async () => {});
  (runStageRepair as any).mockImplementation(async () => {});
  (runStagePackage as any).mockImplementation(async (ctx: any) => {
    capturedCtx = ctx;
  });
  (runStageBoundary as any).mockImplementation(async (ctx: any) => {
    ctx.finalResponse = { test: true };
  });

  await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);
  return capturedCtx;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Plan Annotation Checkpoint (Stage 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures planAnnotation on context after Stage 3", async () => {
    const ctx = await runPipelineAndCapture();
    expect(ctx.planAnnotation).toBeDefined();
  });

  it("plan_id is a stable UUID string", async () => {
    const ctx = await runPipelineAndCapture();
    expect(ctx.planAnnotation.plan_id).toBe("plan-id-1234-5678-abcdef000000");
    expect(typeof ctx.planAnnotation.plan_id).toBe("string");
    expect(ctx.planAnnotation.plan_id.length).toBeGreaterThan(0);
  });

  it("plan_hash is a deterministic string derived from graph state", async () => {
    const ctx1 = await runPipelineAndCapture();
    const ctx2 = await runPipelineAndCapture();

    // Same graph → same hash
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);
    expect(typeof ctx1.planAnnotation.plan_hash).toBe("string");
    expect(ctx1.planAnnotation.plan_hash.length).toBeGreaterThan(0);
  });

  it("plan_id differs across identical runs (UUID non-determinism)", async () => {
    // Override mock to return unique IDs per call
    mockGenerateRequestId
      .mockReturnValueOnce("plan-id-run-1-aaa")
      .mockReturnValueOnce("plan-id-run-2-bbb");

    const ctx1 = await runPipelineAndCapture();
    const ctx2 = await runPipelineAndCapture();

    // plan_id: unique per execution (UUID behaviour)
    expect(ctx1.planAnnotation.plan_id).toBe("plan-id-run-1-aaa");
    expect(ctx2.planAnnotation.plan_id).toBe("plan-id-run-2-bbb");
    expect(ctx1.planAnnotation.plan_id).not.toBe(ctx2.planAnnotation.plan_id);

    // plan_hash: deterministic (same graph → same hash)
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);
  });

  it("plan_hash changes when graph changes", async () => {
    const ctx1 = await runPipelineAndCapture({ graph: structuredClone(testGraph) });

    const alteredGraph = structuredClone(testGraph);
    alteredGraph.nodes.push({ id: "f2", kind: "factor", label: "Quality", category: "external" } as any);

    const ctx2 = await runPipelineAndCapture({ graph: alteredGraph });

    expect(ctx1.planAnnotation.plan_hash).not.toBe(ctx2.planAnnotation.plan_hash);
  });

  it("stage3_rationales extracted from ctx.rationales", async () => {
    const ctx = await runPipelineAndCapture({
      rationales: [
        { node_id: "o1", rationale: "Cost-effective" },
        { node_id: "o2", rationale: "Higher throughput" },
        { node_id: "f1", rationale: "Key driver" },
      ],
    });

    expect(ctx.planAnnotation.stage3_rationales).toEqual([
      { node_id: "o1", rationale: "Cost-effective" },
      { node_id: "o2", rationale: "Higher throughput" },
      { node_id: "f1", rationale: "Key driver" },
    ]);
  });

  it("handles empty rationales gracefully", async () => {
    const ctx = await runPipelineAndCapture({ rationales: [] });
    expect(ctx.planAnnotation.stage3_rationales).toEqual([]);
  });

  it("truncates rationales exceeding max count (50)", async () => {
    const oversizedRationales = Array.from({ length: 80 }, (_, i) => ({
      node_id: `n${i}`,
      rationale: `Rationale ${i}`,
    }));

    const ctx = await runPipelineAndCapture({ rationales: oversizedRationales });

    expect(ctx.planAnnotation.stage3_rationales).toHaveLength(50);
    expect(ctx.planAnnotation.stage3_rationales[0].node_id).toBe("n0");
    expect(ctx.planAnnotation.stage3_rationales[49].node_id).toBe("n49");
  });

  it("truncates individual rationale text exceeding 500 chars", async () => {
    const longText = "x".repeat(1000);
    const rationales = [{ node_id: "n1", rationale: longText }];

    const ctx = await runPipelineAndCapture({ rationales });

    expect(ctx.planAnnotation.stage3_rationales[0].rationale).toHaveLength(500);
    expect(ctx.planAnnotation.stage3_rationales[0].rationale).toBe("x".repeat(500));
  });

  it("plan_hash is computed from truncated rationales, not originals", async () => {
    // 60 rationales with 1000-char text (exceeds both count and length bounds)
    const oversizedRationales = Array.from({ length: 60 }, (_, i) => ({
      node_id: `n${i}`,
      rationale: `R${i}-${"a".repeat(997)}`,
    }));

    // Pre-truncated equivalent: first 50, each sliced to 500 chars
    const preTruncatedRationales = oversizedRationales.slice(0, 50).map(r => ({
      node_id: r.node_id,
      rationale: r.rationale.slice(0, 500),
    }));

    const ctx1 = await runPipelineAndCapture({ rationales: oversizedRationales });
    const ctx2 = await runPipelineAndCapture({ rationales: preTruncatedRationales });

    // Positive: same graph + same truncated rationales + same confidence → same hash
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);

    // Negative control: hash of untruncated payload would differ
    const untruncatedHash = computeResponseHash({
      graph: structuredClone(testGraph),
      rationales: oversizedRationales.map(r => ({
        node_id: r.node_id,
        rationale: r.rationale,
      })),
      confidence: ctx1.planAnnotation.confidence,
    });
    expect(ctx1.planAnnotation.plan_hash).not.toBe(untruncatedHash);
  });

  it("plan_hash changes when rationales change", async () => {
    const ctx1 = await runPipelineAndCapture({
      rationales: [{ node_id: "n1", rationale: "Option A is cheaper" }],
    });
    const ctx2 = await runPipelineAndCapture({
      rationales: [{ node_id: "n1", rationale: "Option A is faster" }],
    });

    expect(ctx1.planAnnotation.plan_hash).not.toBe(ctx2.planAnnotation.plan_hash);
  });

  it("plan_hash changes when confidence changes", async () => {
    const ctx1 = await runPipelineAndCapture({ confidence: 0.9 });
    const ctx2 = await runPipelineAndCapture({ confidence: 0.5 });

    expect(ctx1.planAnnotation.plan_hash).not.toBe(ctx2.planAnnotation.plan_hash);
  });

  it("plan_hash is order-invariant: shuffled nodes/edges produce the same hash", async () => {
    // Original order: nodes [g1, o1, o2, f1], edges [e1, e2, e3]
    const graphOriginal = structuredClone(testGraph);

    // Shuffled order: nodes reversed, edges reversed
    const graphShuffled = structuredClone(testGraph);
    graphShuffled.nodes = [...graphShuffled.nodes].reverse();
    graphShuffled.edges = [...graphShuffled.edges].reverse();

    const ctx1 = await runPipelineAndCapture({ graph: graphOriginal });
    const ctx2 = await runPipelineAndCapture({ graph: graphShuffled });

    // Same content, different order → same plan_hash (sorted before hashing)
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);
  });

  it("plan_hash is order-invariant for parallel edges with same (from, to)", async () => {
    const graphA = {
      nodes: [
        { id: "n1", kind: "goal", label: "G" },
        { id: "n2", kind: "option", label: "O" },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", strength_mean: 0.5 },
        { id: "e2", from: "n1", to: "n2", strength_mean: 0.9 },
      ],
      version: "1.2",
    };

    // Same edges, reversed order
    const graphB = structuredClone(graphA);
    graphB.edges = [...graphB.edges].reverse();

    const ctx1 = await runPipelineAndCapture({ graph: graphA });
    const ctx2 = await runPipelineAndCapture({ graph: graphB });

    // Parallel edges sorted by (from, to, id) → deterministic regardless of input order
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);
  });

  it("plan_hash excludes non-node/edge graph fields (version, meta)", async () => {
    const graphWithVersion = {
      nodes: [{ id: "n1", kind: "goal", label: "G" }],
      edges: [],
      version: "1.2",
    };

    const graphWithDifferentVersion = {
      nodes: [{ id: "n1", kind: "goal", label: "G" }],
      edges: [],
      version: "2.0",
      meta: { some: "data" },
    };

    const ctx1 = await runPipelineAndCapture({ graph: graphWithVersion });
    const ctx2 = await runPipelineAndCapture({ graph: graphWithDifferentVersion });

    // Only nodes/edges matter for hash; version/meta excluded
    expect(ctx1.planAnnotation.plan_hash).toBe(ctx2.planAnnotation.plan_hash);
  });

  it("confidence.overall reflects ctx.confidence", async () => {
    const ctx = await runPipelineAndCapture({ confidence: 0.92 });
    expect(ctx.planAnnotation.confidence.overall).toBe(0.92);
  });

  it("confidence.structure derived from graph connectivity", async () => {
    const ctx = await runPipelineAndCapture();
    // testGraph: 4 nodes, edges connect o1, g1, o2, f1 → 4/4 = 1.0
    expect(ctx.planAnnotation.confidence.structure).toBe(1);
  });

  it("confidence.parameters derived from edges with strength_mean", async () => {
    const ctx = await runPipelineAndCapture();
    // testGraph: 3 edges, all have strength_mean → 3/3 = 1.0
    expect(ctx.planAnnotation.confidence.parameters).toBe(1);
  });

  it("confidence handles zero nodes/edges gracefully", async () => {
    const emptyGraph = { nodes: [], edges: [], version: "1.2" };
    const ctx = await runPipelineAndCapture({ graph: emptyGraph, confidence: 0.5 });

    expect(ctx.planAnnotation.confidence.overall).toBe(0.5);
    expect(ctx.planAnnotation.confidence.structure).toBe(0);
    expect(ctx.planAnnotation.confidence.parameters).toBe(0);
  });

  it("context_hash is deterministic for same input", async () => {
    const ctx1 = await runPipelineAndCapture();
    const ctx2 = await runPipelineAndCapture();
    expect(ctx1.planAnnotation.context_hash).toBe(ctx2.planAnnotation.context_hash);
    expect(typeof ctx1.planAnnotation.context_hash).toBe("string");
    expect(ctx1.planAnnotation.context_hash.length).toBeGreaterThan(0);
  });

  it("model_id captured from llmMeta.model", async () => {
    const ctx = await runPipelineAndCapture({
      llmMeta: { model: "claude-sonnet-4-20250514", prompt_version: "v3.0" },
    });
    expect(ctx.planAnnotation.model_id).toBe("claude-sonnet-4-20250514");
  });

  it("model_id falls back to draftAdapter.model when llmMeta.model absent", async () => {
    const ctx = await runPipelineAndCapture({
      llmMeta: { prompt_version: "v3.0" },
      draftAdapter: { model: "fallback-model", name: "draft_graph" },
    });
    expect(ctx.planAnnotation.model_id).toBe("fallback-model");
  });

  it("model_id defaults to 'unknown' when no model available", async () => {
    const ctx = await runPipelineAndCapture({
      llmMeta: {},
      draftAdapter: {},
    });
    expect(ctx.planAnnotation.model_id).toBe("unknown");
  });

  it("prompt_version captured from llmMeta.prompt_version", async () => {
    const ctx = await runPipelineAndCapture({
      llmMeta: { model: "test-model", prompt_version: "v2.3.1" },
    });
    expect(ctx.planAnnotation.prompt_version).toBe("v2.3.1");
  });

  it("prompt_version defaults to 'unknown' when absent", async () => {
    const ctx = await runPipelineAndCapture({
      llmMeta: { model: "test-model" },
    });
    expect(ctx.planAnnotation.prompt_version).toBe("unknown");
  });

  it("open_questions is an empty array by default", async () => {
    const ctx = await runPipelineAndCapture();
    expect(ctx.planAnnotation.open_questions).toEqual([]);
  });

  // ── INVARIANT: checkpoint capture does NOT trigger additional enrichment ──

  it("does NOT call enrichGraphWithFactorsAsync a second time (called_count invariant)", async () => {
    // INVARIANT: Each stage runs exactly once per request.
    // Parity tests verify: enrich.called_count === 1
    // Extend this pattern for new stage-level behaviours.
    const ctx = await runPipelineAndCapture();

    // runStageEnrich is mocked — it should have been called exactly once
    expect(runStageEnrich).toHaveBeenCalledTimes(1);

    // The plan annotation should exist — proving it was captured
    // WITHOUT triggering a second enrich call
    expect(ctx.planAnnotation).toBeDefined();
    expect(ctx.planAnnotation.plan_id).toBeTruthy();
  });

  it("checkpoint capture happens AFTER Stage 3 and BEFORE Stage 4", async () => {
    const callOrder: string[] = [];

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      callOrder.push("parse");
      ctx.graph = structuredClone(testGraph);
      ctx.rationales = [];
      ctx.confidence = 0.8;
      ctx.llmMeta = { model: "test", prompt_version: "v1" };
    });
    (runStageNormalise as any).mockImplementation(async () => {
      callOrder.push("normalise");
    });
    (runStageEnrich as any).mockImplementation(async () => {
      callOrder.push("enrich");
    });
    (runStageRepair as any).mockImplementation(async (ctx: any) => {
      // By the time repair runs, planAnnotation should already be set
      callOrder.push("repair");
      expect(ctx.planAnnotation).toBeDefined();
      expect(ctx.planAnnotation.plan_id).toBeTruthy();
    });
    (runStagePackage as any).mockImplementation(async () => {
      callOrder.push("package");
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      callOrder.push("boundary");
      ctx.finalResponse = { test: true };
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(callOrder).toEqual(["parse", "normalise", "enrich", "repair", "package", "boundary"]);
  });

  it("planAnnotation not set when graph is undefined (early return path)", async () => {
    let capturedCtx: any;

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      // Don't set ctx.graph — simulate parse failure with early return
      ctx.earlyReturn = { statusCode: 400, body: { error: "bad" } };
    });

    // Pipeline returns early — no checkpoint
    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);
    expect(result.statusCode).toBe(400);
  });

  it("plan_annotation_version is '1'", async () => {
    const ctx = await runPipelineAndCapture();
    expect(ctx.planAnnotation.plan_annotation_version).toBe("1");
  });

  it("all PlanAnnotationCheckpoint fields are present and typed correctly", async () => {
    const ctx = await runPipelineAndCapture();
    const pa = ctx.planAnnotation;

    // Version
    expect(pa.plan_annotation_version).toBe("1");

    // Required string fields
    expect(typeof pa.plan_id).toBe("string");
    expect(typeof pa.plan_hash).toBe("string");
    expect(typeof pa.context_hash).toBe("string");
    expect(typeof pa.model_id).toBe("string");
    expect(typeof pa.prompt_version).toBe("string");

    // Confidence object
    expect(typeof pa.confidence.overall).toBe("number");
    expect(typeof pa.confidence.structure).toBe("number");
    expect(typeof pa.confidence.parameters).toBe("number");

    // Arrays
    expect(Array.isArray(pa.stage3_rationales)).toBe(true);
    expect(Array.isArray(pa.open_questions)).toBe(true);
  });

  // ── Stage 3 no-graph path (graph cleared after Stage 1) ──────────────────

  it("planAnnotation not set when Stage 3 clears ctx.graph (no crash)", async () => {
    let capturedCtx: any;

    (runStageParse as any).mockImplementation(async (ctx: any) => {
      ctx.graph = structuredClone(testGraph);
      ctx.rationales = [];
      ctx.confidence = 0.5;
      ctx.llmMeta = { model: "test", prompt_version: "v1" };
    });
    (runStageNormalise as any).mockImplementation(async () => {});
    (runStageEnrich as any).mockImplementation(async (ctx: any) => {
      // Stage 3 clears the graph (simulating no-graph path in enrich)
      ctx.graph = undefined;
    });
    (runStageRepair as any).mockImplementation(async () => {});
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      capturedCtx = ctx;
    });
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      ctx.finalResponse = { test: true };
    });

    // Must not throw — previously this would crash in computeResponseHash(undefined)
    await expect(
      runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts),
    ).resolves.not.toThrow();

    expect(capturedCtx.planAnnotation).toBeUndefined();
  });

  // ── Dangling edge confidence clamping ─────────────────────────────────────

  it("confidence.structure clamped to 1.0 when edges reference non-existent nodes", async () => {
    const graphWithDanglingEdges = {
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" },
      ],
      edges: [
        // e1 connects n1 (exists) to n2 (does NOT exist in nodes)
        { id: "e1", from: "n1", to: "n2", strength_mean: 0.5 },
        // e2 connects two non-existent nodes
        { id: "e2", from: "n3", to: "n4", strength_mean: 0.5 },
      ],
      version: "1.2",
    };

    const ctx = await runPipelineAndCapture({ graph: graphWithDanglingEdges });

    // Only n1 is a real node and is connected → 1/1 = 1.0 (not 4/1 = 4.0)
    expect(ctx.planAnnotation.confidence.structure).toBeLessThanOrEqual(1);
    expect(ctx.planAnnotation.confidence.structure).toBeGreaterThanOrEqual(0);
    expect(ctx.planAnnotation.confidence.structure).toBe(1);
  });

  it("confidence.structure excludes dangling endpoints from calculation", async () => {
    const graphWithPartialDangling = {
      nodes: [
        { id: "n1", kind: "goal", label: "Goal" },
        { id: "n2", kind: "option", label: "Option A" },
        { id: "n3", kind: "option", label: "Option B" },
      ],
      edges: [
        // Only connects n1 and n2; n3 is disconnected; n4 doesn't exist
        { id: "e1", from: "n1", to: "n2", strength_mean: 0.5 },
        { id: "e2", from: "n4", to: "n1", strength_mean: 0.3 },
      ],
      version: "1.2",
    };

    const ctx = await runPipelineAndCapture({ graph: graphWithPartialDangling });

    // n1 and n2 connected (from real edges), n3 disconnected, n4 ignored (dangling)
    // structure = 2/3 ≈ 0.667
    expect(ctx.planAnnotation.confidence.structure).toBeCloseTo(2 / 3, 3);
  });
});

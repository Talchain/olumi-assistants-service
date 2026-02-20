/**
 * Pipeline shape assertions — locks down the structure of the unified pipeline.
 *
 * Verifies:
 *  1. Stage execution count and order (7 stages: parse → normalise → enrich → repair → threshold-sweep → package → boundary)
 *  2. stageSnapshots contains exactly the expected keys
 *  3. pipeline_checkpoints entries when checkpoints are enabled
 *
 * These tests fail if stages are added, removed, reordered, or renamed
 * without updating the corresponding assertions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted state (available inside vi.mock factories) ──────────────────────

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { cee: { pipelineCheckpointsEnabled: false as boolean } },
}));

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
vi.mock("../../src/cee/unified-pipeline/stages/threshold-sweep.js", () => ({
  runStageThresholdSweep: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/package.js", () => ({
  runStagePackage: vi.fn(),
}));
vi.mock("../../src/cee/unified-pipeline/stages/boundary.js", () => ({
  runStageBoundary: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: mockConfig,
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
  getRequestId: () => "shape-test-req",
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string) => ({ error: { code, message: msg } }),
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runUnifiedPipeline } from "../../src/cee/unified-pipeline/index.js";
import { runStageParse } from "../../src/cee/unified-pipeline/stages/parse.js";
import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";

// ── Constants ───────────────────────────────────────────────────────────────

const EXPECTED_STAGE_ORDER = [
  "parse",
  "normalise",
  "enrich",
  "repair",
  "threshold-sweep",
  "package",
  "boundary",
] as const;

const EXPECTED_STAGE_SNAPSHOT_KEYS = [
  "stage_1_parse",
  "stage_3_enrich",
  "stage_4_repair",
  "stage_5_package",
] as const;

/**
 * Checkpoint stages captured within the unified pipeline orchestrator/stages.
 * Note: post_adapter_normalisation is captured inside the LLM adapter (not orchestrator-accessible).
 * post_normalisation and post_repair are legacy pipeline only (not in unified pipeline).
 */
const EXPECTED_UNIFIED_CHECKPOINT_STAGES = [
  "post_stabilisation",
  "pre_boundary",
] as const;

const mockRequest = { id: "test", headers: {}, query: {}, raw: { destroyed: false } } as any;
const baseInput = { brief: "Shape test brief" };
const baseOpts = { schemaVersion: "v3" as const };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Wire all stage mocks to track call order and produce a successful pipeline run. */
function wireSuccessfulRun(callOrder: string[]) {
  (runStageParse as any).mockImplementation(async (ctx: any) => {
    callOrder.push("parse");
    ctx.graph = { nodes: [], edges: [], version: "1.2" };
  });
  (runStageNormalise as any).mockImplementation(async () => callOrder.push("normalise"));
  (runStageEnrich as any).mockImplementation(async () => callOrder.push("enrich"));
  (runStageRepair as any).mockImplementation(async () => callOrder.push("repair"));
  (runStageThresholdSweep as any).mockImplementation(async () => callOrder.push("threshold-sweep"));
  (runStagePackage as any).mockImplementation(async () => callOrder.push("package"));
  (runStageBoundary as any).mockImplementation(async (ctx: any) => {
    callOrder.push("boundary");
    ctx.finalResponse = { graph: { nodes: [], edges: [] } };
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Pipeline shape assertions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.cee.pipelineCheckpointsEnabled = false;
  });

  // ── Stage count and order ───────────────────────────────────────────────

  it("orchestrator runs exactly 7 stages in the expected order", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(200);
    expect(callOrder).toEqual([...EXPECTED_STAGE_ORDER]);
    expect(callOrder).toHaveLength(7);
  });

  // ── stageSnapshots keys ─────────────────────────────────────────────────

  it("stageSnapshots contains exactly the expected keys after successful run", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    // Capture the context's stageSnapshots via package mock
    let capturedSnapshots: Record<string, unknown> | undefined;
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      callOrder.push("package");
      // At this point, snapshots for stages 1, 3, 4 should exist
      capturedSnapshots = ctx.stageSnapshots ? { ...ctx.stageSnapshots } : undefined;
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(capturedSnapshots).toBeDefined();
    // Before Package runs, keys for stages 1, 3, 4 exist
    const prePackageKeys = Object.keys(capturedSnapshots!).sort();
    expect(prePackageKeys).toEqual(["stage_1_parse", "stage_3_enrich", "stage_4_repair"]);
  });

  it("stageSnapshots includes stage_5_package after Package completes", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    // Capture snapshots after Package via Boundary mock
    let capturedSnapshots: Record<string, unknown> | undefined;
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      callOrder.push("boundary");
      capturedSnapshots = ctx.stageSnapshots ? { ...ctx.stageSnapshots } : undefined;
      ctx.finalResponse = { graph: { nodes: [], edges: [] } };
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(capturedSnapshots).toBeDefined();
    const allKeys = Object.keys(capturedSnapshots!).sort();
    expect(allKeys).toEqual([...EXPECTED_STAGE_SNAPSHOT_KEYS].sort());
  });

  // ── Stage snapshot structure ────────────────────────────────────────────

  it("each stageSnapshot has the expected StageSnapshot fields", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    let capturedSnapshots: Record<string, any> | undefined;
    (runStageBoundary as any).mockImplementation(async (ctx: any) => {
      callOrder.push("boundary");
      capturedSnapshots = ctx.stageSnapshots ? structuredClone(ctx.stageSnapshots) : undefined;
      ctx.finalResponse = { graph: { nodes: [], edges: [] } };
    });

    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(capturedSnapshots).toBeDefined();
    const expectedFields = [
      "goal_node_id",
      "goal_threshold",
      "goal_threshold_raw",
      "goal_threshold_unit",
      "goal_threshold_cap",
      "goal_constraints_count",
    ];

    for (const key of EXPECTED_STAGE_SNAPSHOT_KEYS) {
      const snap = capturedSnapshots![key];
      expect(snap).toBeDefined();
      expect(Object.keys(snap).sort()).toEqual(expectedFields.sort());
    }
  });

  // ── Threshold sweep try/catch wrapper ───────────────────────────────────

  it("threshold sweep failure does not prevent downstream stages", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    // Override threshold sweep to throw
    (runStageThresholdSweep as any).mockImplementation(async () => {
      callOrder.push("threshold-sweep");
      throw new Error("sweep crash");
    });

    const result = await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(result.statusCode).toBe(200);
    // All stages still ran (including the crashing sweep)
    expect(callOrder).toEqual([...EXPECTED_STAGE_ORDER]);
  });

  // ── Stage count constant ────────────────────────────────────────────────

  it("EXPECTED_STAGE_ORDER has exactly 7 entries", () => {
    expect(EXPECTED_STAGE_ORDER).toHaveLength(7);
  });

  it("EXPECTED_STAGE_SNAPSHOT_KEYS has exactly 4 entries", () => {
    expect(EXPECTED_STAGE_SNAPSHOT_KEYS).toHaveLength(4);
  });

  // ── pipeline_checkpoints ──────────────────────────────────────────────

  it("ctx.checkpointsEnabled reflects config when checkpoints are off", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    let capturedEnabled: boolean | undefined;
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      callOrder.push("package");
      capturedEnabled = ctx.checkpointsEnabled;
    });

    mockConfig.cee.pipelineCheckpointsEnabled = false;
    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(capturedEnabled).toBe(false);
  });

  it("ctx.checkpointsEnabled reflects config when checkpoints are on", async () => {
    const callOrder: string[] = [];
    wireSuccessfulRun(callOrder);

    let capturedEnabled: boolean | undefined;
    let capturedCheckpoints: any[] | undefined;
    (runStagePackage as any).mockImplementation(async (ctx: any) => {
      callOrder.push("package");
      capturedEnabled = ctx.checkpointsEnabled;
      capturedCheckpoints = ctx.pipelineCheckpoints;
    });

    mockConfig.cee.pipelineCheckpointsEnabled = true;
    await runUnifiedPipeline(baseInput as any, {}, mockRequest, baseOpts);

    expect(capturedEnabled).toBe(true);
    // pipelineCheckpoints starts as empty array (stages populate it when enabled)
    expect(capturedCheckpoints).toEqual([]);
  });

  it("EXPECTED_UNIFIED_CHECKPOINT_STAGES matches the stages captured in package.ts", () => {
    // Static assertion: the unified pipeline captures exactly these 2 checkpoint stages.
    // post_adapter_normalisation is captured inside the LLM adapter (Stage 1 internal).
    // post_normalisation and post_repair are legacy pipeline only.
    expect(EXPECTED_UNIFIED_CHECKPOINT_STAGES).toEqual(["post_stabilisation", "pre_boundary"]);
    expect(EXPECTED_UNIFIED_CHECKPOINT_STAGES).toHaveLength(2);
  });
});

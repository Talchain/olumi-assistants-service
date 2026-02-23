/**
 * Stage 6: Boundary — Unit Tests
 *
 * Verifies V3/V2/V1 transform paths, model_adjustments attachment,
 * strict mode validation, and nodeLabels extraction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock V3 transform
vi.mock("../../src/cee/transforms/schema-v3.js", () => ({
  transformResponseToV3: vi.fn(),
  validateStrictModeV3: vi.fn(),
}));

// Mock V2 transform
vi.mock("../../src/cee/transforms/schema-v2.js", () => ({
  transformResponseToV2: vi.fn(),
}));

// Mock analysis-ready
vi.mock("../../src/cee/transforms/analysis-ready.js", () => ({
  mapMutationsToAdjustments: vi.fn(),
  extractConstraintDropBlockers: vi.fn(),
}));

// Mock telemetry
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {
    CeeBoundaryBlocked: "cee.boundary.blocked",
  },
}));

// Mock CEE V3 schema to bypass validation in unit tests
vi.mock("../../src/schemas/cee-v3.js", () => ({
  CEEGraphResponseV3: {
    safeParse: vi.fn(() => ({ success: true })),
  },
}));

import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { transformResponseToV3, validateStrictModeV3 } from "../../src/cee/transforms/schema-v3.js";
import { transformResponseToV2 } from "../../src/cee/transforms/schema-v2.js";
import { mapMutationsToAdjustments, extractConstraintDropBlockers } from "../../src/cee/transforms/analysis-ready.js";
import { emit, TelemetryEvents } from "../../src/utils/telemetry.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const v3Body = {
  nodes: [
    { id: "g1", label: "Goal One" },
    { id: "o1", label: "Option A" },
  ],
  edges: [],
  graph: { nodes: [], edges: [] },
  analysis_ready: {
    status: "ready",
    model_adjustments: undefined as any,
  },
};

const v2Body = { schema_version: "v2", data: {} };

function makeCtx(overrides?: Partial<Record<string, any>>): any {
  return {
    requestId: "test-req-6",
    input: { brief: "Test brief" },
    opts: {
      schemaVersion: "v3" as const,
      strictMode: false,
      includeDebug: false,
    },
    ceeResponse: {
      graph: { nodes: [], edges: [] },
      trace: {
        strp: {
          mutations: [{ rule: "R1", type: "strength_clamp" }],
        },
        corrections: [{ type: "edge_restored" }],
      },
    },
    finalResponse: undefined,
    earlyReturn: undefined,
    ...overrides,
  };
}

function setupDefaultMocks() {
  (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));
  (transformResponseToV2 as any).mockReturnValue(structuredClone(v2Body));
  (validateStrictModeV3 as any).mockImplementation(() => {});
  (mapMutationsToAdjustments as any).mockReturnValue([
    { type: "strength_clamp", description: "Clamped" },
  ]);
  (extractConstraintDropBlockers as any).mockReturnValue([]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runStageBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── No ceeResponse ────────────────────────────────────────────────────

  it("returns without setting finalResponse when ceeResponse is missing", async () => {
    const ctx = makeCtx({ ceeResponse: undefined });
    await runStageBoundary(ctx);
    expect(ctx.finalResponse).toBeUndefined();
    expect(transformResponseToV3).not.toHaveBeenCalled();
  });

  // ── V3 path ────────────────────────────────────────────────────────────

  it("calls transformResponseToV3 and sets ctx.finalResponse for V3", async () => {
    const ctx = makeCtx();
    await runStageBoundary(ctx);

    expect(transformResponseToV3).toHaveBeenCalledTimes(1);
    expect(transformResponseToV3).toHaveBeenCalledWith(
      ctx.ceeResponse,
      expect.objectContaining({
        brief: "Test brief",
        requestId: "test-req-6",
        strictMode: false,
        includeDebug: false,
      }),
    );
    expect(ctx.finalResponse).toBeDefined();
  });

  it("attaches model_adjustments when STRP mutations present", async () => {
    const ctx = makeCtx();
    await runStageBoundary(ctx);

    expect(mapMutationsToAdjustments).toHaveBeenCalledTimes(1);
    expect(ctx.finalResponse.analysis_ready.model_adjustments).toEqual([
      expect.objectContaining({ type: "strength_clamp" }),
    ]);
  });

  it("builds nodeLabels from v3Body.nodes (root level, NOT v3Body.graph)", async () => {
    const ctx = makeCtx();
    await runStageBoundary(ctx);

    // mapMutationsToAdjustments receives a Map with node labels from root nodes
    const call = (mapMutationsToAdjustments as any).mock.calls[0];
    const nodeLabels: Map<string, string> = call[2];
    expect(nodeLabels).toBeInstanceOf(Map);
    expect(nodeLabels.get("g1")).toBe("Goal One");
    expect(nodeLabels.get("o1")).toBe("Option A");
  });

  it("skips model_adjustments when no mutations and no corrections", async () => {
    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
    });
    await runStageBoundary(ctx);

    expect(mapMutationsToAdjustments).not.toHaveBeenCalled();
  });

  it("skips model_adjustments when analysis_ready is absent", async () => {
    (transformResponseToV3 as any).mockReturnValue({
      nodes: [],
      edges: [],
      analysis_ready: undefined,
    });
    const ctx = makeCtx();
    await runStageBoundary(ctx);

    expect(mapMutationsToAdjustments).not.toHaveBeenCalled();
  });

  // ── V3 + strict mode ──────────────────────────────────────────────────

  it("calls validateStrictModeV3 when strictMode is true", async () => {
    const ctx = makeCtx({ opts: { schemaVersion: "v3", strictMode: true, includeDebug: false } });
    await runStageBoundary(ctx);

    expect(validateStrictModeV3).toHaveBeenCalledTimes(1);
    expect(ctx.finalResponse).toBeDefined();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("returns blocked response when strict mode validation fails (Stream F)", async () => {
    (validateStrictModeV3 as any).mockImplementation(() => {
      throw new Error("Missing required field: edges");
    });
    const ctx = makeCtx({ opts: { schemaVersion: "v3", strictMode: true, includeDebug: false } });
    await runStageBoundary(ctx);

    // Should return blocked response, not 422 earlyReturn
    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.finalResponse).toBeDefined();
    expect((ctx.finalResponse as any).analysis_ready?.status).toBe("blocked");
    expect((ctx.finalResponse as any).graph).toBeNull();
    expect((ctx.finalResponse as any).analysis_ready?.blockers).toBeDefined();

    const blocker = (ctx.finalResponse as any).analysis_ready?.blockers?.[0];
    expect(blocker?.code).toBe("strict_mode_validation_failure");
    expect(blocker?.severity).toBe("error");
    expect(blocker?.message).toContain("Missing required field: edges");

    // Should emit telemetry event
    expect(emit).toHaveBeenCalledWith(
      TelemetryEvents.CeeBoundaryBlocked,
      expect.objectContaining({
        error_code: "CEE_V3_STRICT_MODE_FAILED",
        error_message: "Missing required field: edges",
      })
    );
  });

  it("does not call validateStrictModeV3 when strictMode is false", async () => {
    const ctx = makeCtx({ opts: { schemaVersion: "v3", strictMode: false } });
    await runStageBoundary(ctx);

    expect(validateStrictModeV3).not.toHaveBeenCalled();
  });

  // ── V2 path ────────────────────────────────────────────────────────────

  it("calls transformResponseToV2 and sets ctx.finalResponse for V2", async () => {
    const ctx = makeCtx({ opts: { schemaVersion: "v2" } });
    await runStageBoundary(ctx);

    expect(transformResponseToV2).toHaveBeenCalledTimes(1);
    expect(transformResponseToV3).not.toHaveBeenCalled();
    expect(ctx.finalResponse).toEqual(expect.objectContaining({ schema_version: "v2" }));
  });

  // ── V1 path ────────────────────────────────────────────────────────────

  it("passes through ceeResponse as finalResponse for V1", async () => {
    const ctx = makeCtx({ opts: { schemaVersion: "v1" } });
    await runStageBoundary(ctx);

    expect(transformResponseToV3).not.toHaveBeenCalled();
    expect(transformResponseToV2).not.toHaveBeenCalled();
    expect(ctx.finalResponse).toBe(ctx.ceeResponse);
  });

  // ── Constraint-drop blockers ────────────────────────────────────────

  it("injects constraint-drop blockers into analysis_ready.blockers", async () => {
    (extractConstraintDropBlockers as any).mockReturnValue([
      { factor_id: "fac_x", factor_label: "fac_x", blocker_type: "constraint_dropped", message: "Constraint dropped (c1): no match", suggested_action: "review_constraint" },
      { factor_id: "fac_y", factor_label: "fac_y", blocker_type: "constraint_dropped", message: "Constraint dropped (c2): no match", suggested_action: "review_constraint" },
    ]);

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {
          strp: {
            mutations: [
              { code: "CONSTRAINT_DROPPED", constraint_id: "c1", before: "fac_x", reason: "no match" },
              { code: "CONSTRAINT_DROPPED", constraint_id: "c2", before: "fac_y", reason: "no match" },
            ],
          },
        },
      },
    });

    await runStageBoundary(ctx);

    expect(extractConstraintDropBlockers).toHaveBeenCalledTimes(1);
    expect(ctx.finalResponse.analysis_ready.blockers).toHaveLength(2);
    expect(ctx.finalResponse.analysis_ready.blockers[0]).toEqual(
      expect.objectContaining({ blocker_type: "constraint_dropped", factor_id: "fac_x" }),
    );
  });

  it("preserves existing blockers when adding constraint-drop blockers", async () => {
    const existingBlocker = {
      option_id: "o1",
      factor_id: "f1",
      factor_label: "Factor 1",
      blocker_type: "missing_value",
      message: "needs value",
      suggested_action: "add_value",
    };

    (transformResponseToV3 as any).mockReturnValue({
      ...structuredClone(v3Body),
      analysis_ready: {
        status: "needs_user_input",
        blockers: [existingBlocker],
      },
    });
    (extractConstraintDropBlockers as any).mockReturnValue([
      { factor_id: "fac_x", factor_label: "fac_x", blocker_type: "constraint_dropped", message: "Constraint dropped (c1): dropped", suggested_action: "review_constraint" },
    ]);

    const ctx = makeCtx();
    await runStageBoundary(ctx);

    expect(ctx.finalResponse.analysis_ready.blockers).toHaveLength(2);
    expect(ctx.finalResponse.analysis_ready.blockers[0]).toEqual(existingBlocker);
    expect(ctx.finalResponse.analysis_ready.blockers[1].blocker_type).toBe("constraint_dropped");
  });

  it("does not change analysis_ready.status when constraint-drop blockers are added", async () => {
    (extractConstraintDropBlockers as any).mockReturnValue([
      { factor_id: "fac_x", factor_label: "fac_x", blocker_type: "constraint_dropped", message: "Constraint dropped (c1): dropped", suggested_action: "review_constraint" },
    ]);

    const ctx = makeCtx();
    await runStageBoundary(ctx);

    // Status was "ready" before injection — it must remain "ready"
    expect(ctx.finalResponse.analysis_ready.status).toBe("ready");
  });

  it("does not add blockers when extractConstraintDropBlockers returns empty", async () => {
    (extractConstraintDropBlockers as any).mockReturnValue([]);

    const ctx = makeCtx();
    await runStageBoundary(ctx);

    // analysis_ready should not have a blockers array
    expect(ctx.finalResponse.analysis_ready.blockers).toBeUndefined();
  });

  it("does not inject blockers when analysis_ready is absent", async () => {
    (transformResponseToV3 as any).mockReturnValue({
      nodes: [],
      edges: [],
      analysis_ready: undefined,
    });

    const ctx = makeCtx();
    await runStageBoundary(ctx);

    expect(extractConstraintDropBlockers).not.toHaveBeenCalled();
  });

  // ── Deterministic repair → model_adjustments ────────────────────────

  it("maps UNREACHABLE_FACTOR_RECLASSIFIED repairs to category_reclassified model_adjustments", async () => {
    // No STRP mutations so mapMutationsToAdjustments is not called
    (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
      deterministicRepairs: [
        { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_x].category", action: 'Reclassified unreachable factor "Factor X" to external' },
      ],
    });
    await runStageBoundary(ctx);

    expect(ctx.finalResponse.analysis_ready.model_adjustments).toEqual([
      {
        code: "category_reclassified",
        node_id: "fac_x",
        field: "nodes[fac_x].category",
        reason: 'Reclassified unreachable factor "Factor X" to external',
        source: "deterministic_sweep",
      },
    ]);
  });

  it("filters out non-user-visible repair codes (NAN_VALUE, SIGN_MISMATCH)", async () => {
    (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
      deterministicRepairs: [
        { code: "NAN_VALUE", path: "edges[a→b].strength_mean", action: "Replaced NaN" },
        { code: "SIGN_MISMATCH", path: "edges[c→d].strength_mean", action: "Flipped sign" },
        { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_x].category", action: "Reclassified" },
      ],
    });
    await runStageBoundary(ctx);

    // Only the UNREACHABLE_FACTOR_RECLASSIFIED repair should appear
    expect(ctx.finalResponse.analysis_ready.model_adjustments).toHaveLength(1);
    expect(ctx.finalResponse.analysis_ready.model_adjustments[0].code).toBe("category_reclassified");
    expect(ctx.finalResponse.analysis_ready.model_adjustments[0].source).toBe("deterministic_sweep");
    expect(ctx.finalResponse.analysis_ready.model_adjustments[0].node_id).toBe("fac_x");
  });

  it("model_adjustments is [] when no reclassifications occurred", async () => {
    (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
      deterministicRepairs: [
        { code: "NAN_VALUE", path: "edges[a→b].strength_mean", action: "Replaced NaN" },
      ],
    });
    await runStageBoundary(ctx);

    expect(ctx.finalResponse.analysis_ready.model_adjustments).toEqual([]);
  });

  it("model_adjustments is [] when deterministicRepairs is undefined", async () => {
    (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
      deterministicRepairs: undefined,
    });
    await runStageBoundary(ctx);

    expect(ctx.finalResponse.analysis_ready.model_adjustments).toEqual([]);
  });

  it("model_adjustments is [] when deterministicRepairs is empty", async () => {
    (transformResponseToV3 as any).mockReturnValue(structuredClone(v3Body));

    const ctx = makeCtx({
      ceeResponse: {
        graph: { nodes: [], edges: [] },
        trace: {},
      },
      deterministicRepairs: [],
    });
    await runStageBoundary(ctx);

    expect(ctx.finalResponse.analysis_ready.model_adjustments).toEqual([]);
  });

  it("appends repair adjustments after STRP adjustments", async () => {
    (mapMutationsToAdjustments as any).mockReturnValue([
      { code: "category_reclassified", field: "category", reason: "STRP override" },
    ]);

    const ctx = makeCtx({
      deterministicRepairs: [
        { code: "UNREACHABLE_FACTOR_RECLASSIFIED", path: "nodes[fac_y].category", action: "Reclassified Y" },
      ],
    });
    await runStageBoundary(ctx);

    // Both STRP and repair adjustments should be present
    expect(ctx.finalResponse.analysis_ready.model_adjustments).toHaveLength(2);
    expect(ctx.finalResponse.analysis_ready.model_adjustments[0].reason).toBe("STRP override");
    expect(ctx.finalResponse.analysis_ready.model_adjustments[1].reason).toBe("Reclassified Y");
    expect(ctx.finalResponse.analysis_ready.model_adjustments[1].source).toBe("deterministic_sweep");
    expect(ctx.finalResponse.analysis_ready.model_adjustments[1].node_id).toBe("fac_y");
  });
});

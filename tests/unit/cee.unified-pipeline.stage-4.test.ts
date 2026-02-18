/**
 * Stage 4: Repair — Unit Tests
 *
 * Tests the repair orchestrator and all 10 substeps.
 * Covers: call ordering, early-return rules, each substep's logic,
 * fallback reasons, edge restoration trace, nodeRenames threading.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must be before imports) ──────────────────────────────────────────

vi.mock("../../src/cee/graph-orchestrator.js", () => ({
  validateAndRepairGraph: vi.fn(),
  GraphValidationError: class GraphValidationError extends Error {
    errors: any[];
    attempts: number;
    lastGraph?: any;
    constructor(msg: string, errors: any[], attempts: number, lastGraph?: any) {
      super(msg);
      this.name = "GraphValidationError";
      this.errors = errors;
      this.attempts = attempts;
      this.lastGraph = lastGraph;
    }
  },
}));

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      orchestratorValidationEnabled: false,
      enforceSingleGoal: true,
      clarifierEnabled: false,
    },
  },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0.005),
  TelemetryEvents: {
    GuardViolation: "GuardViolation",
    RepairStart: "RepairStart",
    RepairSuccess: "RepairSuccess",
    RepairPartial: "RepairPartial",
    RepairFallback: "RepairFallback",
    CeeGraphGoalsMerged: "CeeGraphGoalsMerged",
    CeeGoalInferred: "CeeGoalInferred",
    CeeClarifierFailed: "CeeClarifierFailed",
  },
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, meta?: any) => ({
    error: { code, message: msg },
    trace: meta?.requestId ? { request_id: meta.requestId, correlation_id: meta.requestId } : undefined,
    details: meta?.details,
  }),
  integrateClarifier: vi.fn(),
  isAdminAuthorized: () => false,
}));

vi.mock("../../src/services/validateClientWithCache.js", () => ({
  validateGraph: vi.fn(),
}));

vi.mock("../../src/routes/assist.draft-graph.js", () => ({
  preserveFieldsFromOriginal: vi.fn().mockImplementation((norm: any) => norm),
}));

vi.mock("../../src/services/repair.js", () => ({
  simpleRepair: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/orchestrator/index.js", () => ({
  stabiliseGraph: vi.fn().mockImplementation((g: any) => g),
  ensureDagAndPrune: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/utils/graph-determinism.js", () => ({
  enforceStableEdgeIds: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  validateAndFixGraph: vi.fn(),
  ensureGoalNode: vi.fn(),
  hasGoalNode: vi.fn().mockReturnValue(false),
  wireOutcomesToGoal: vi.fn().mockImplementation((g: any) => g),
  normaliseDecisionBranchBeliefs: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/cee/compound-goal/index.js", () => ({
  extractCompoundGoals: vi.fn().mockReturnValue({ constraints: [], isCompound: false }),
  toGoalConstraints: vi.fn().mockReturnValue([]),
  remapConstraintTargets: vi.fn().mockReturnValue({ constraints: [], remapped: 0, rejected_junk: 0, rejected_no_match: 0 }),
}));

vi.mock("../../src/validators/structural-reconciliation.js", () => ({
  reconcileStructuralTruth: vi.fn().mockReturnValue({ graph: {}, mutations: [] }),
}));

vi.mock("../../src/cee/unified-pipeline/edge-identity.js", () => ({
  restoreEdgeFields: vi.fn().mockReturnValue({ edges: [], restoredCount: 0 }),
}));

vi.mock("../../src/cee/transforms/structure-checks.js", () => ({
  validateMinimumStructure: vi.fn().mockReturnValue({
    valid: true,
    missing: [],
    counts: { goal: 1, decision: 1, option: 1 },
    connectivity_failed: false,
  }),
  MINIMUM_STRUCTURE_REQUIREMENT: { goal: 1, decision: 1, option: 1 },
}));

vi.mock("../../src/cee/transforms/graph-normalisation.js", () => ({
  normaliseCeeGraphVersionAndProvenance: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn().mockReturnValue({ overall: 7, structure: 7, coverage: 7, safety: 7, causality: 7 }),
}));

vi.mock("../../src/schemas/assist.js", () => ({
  DraftGraphOutput: {
    parse: vi.fn().mockImplementation(() => ({})),
  },
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runOrchestratorValidation } from "../../src/cee/unified-pipeline/stages/repair/orchestrator-validation.js";
import { runPlotValidation } from "../../src/cee/unified-pipeline/stages/repair/plot-validation.js";
import { runEdgeStabilisation } from "../../src/cee/unified-pipeline/stages/repair/edge-stabilisation.js";
import { runGoalMerge } from "../../src/cee/unified-pipeline/stages/repair/goal-merge.js";
import { runCompoundGoals } from "../../src/cee/unified-pipeline/stages/repair/compound-goals.js";
import { runLateStrp } from "../../src/cee/unified-pipeline/stages/repair/late-strp.js";
import { runEdgeRestoration } from "../../src/cee/unified-pipeline/stages/repair/edge-restoration.js";
import { runConnectivity } from "../../src/cee/unified-pipeline/stages/repair/connectivity.js";
import { runClarifier } from "../../src/cee/unified-pipeline/stages/repair/clarifier.js";
import { runStructuralParse } from "../../src/cee/unified-pipeline/stages/repair/structural-parse.js";

import { validateAndRepairGraph, GraphValidationError } from "../../src/cee/graph-orchestrator.js";
import { getAdapter } from "../../src/adapters/llm/router.js";
import { config, isProduction } from "../../src/config/index.js";
import { validateGraph } from "../../src/services/validateClientWithCache.js";
import { simpleRepair } from "../../src/services/repair.js";
import { enforceStableEdgeIds } from "../../src/utils/graph-determinism.js";
import { validateAndFixGraph, ensureGoalNode, hasGoalNode, wireOutcomesToGoal } from "../../src/cee/structure/index.js";
import { extractCompoundGoals, toGoalConstraints, remapConstraintTargets } from "../../src/cee/compound-goal/index.js";
import { reconcileStructuralTruth } from "../../src/validators/structural-reconciliation.js";
import { restoreEdgeFields } from "../../src/cee/unified-pipeline/edge-identity.js";
import { validateMinimumStructure } from "../../src/cee/transforms/structure-checks.js";
import { integrateClarifier } from "../../src/cee/validation/pipeline.js";
import { computeQuality } from "../../src/cee/quality/index.js";
import { DraftGraphOutput } from "../../src/schemas/assist.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const validGraph = {
  nodes: [
    { id: "g1", kind: "goal", label: "Goal" },
    { id: "d1", kind: "decision", label: "Decision" },
    { id: "o1", kind: "option", label: "Option" },
  ],
  edges: [
    { id: "e1", from: "o1", to: "g1", strength_mean: 0.7 },
    { id: "e2", from: "d1", to: "o1", strength_mean: 0.5 },
  ],
  version: "1.2",
};

function makeCtx(overrides?: Partial<Record<string, any>>): any {
  return {
    requestId: "test-req",
    input: { brief: "Test brief for compound goals", flags: null, include_debug: false },
    rawBody: {},
    request: { id: "req-1", headers: {}, query: {}, raw: { destroyed: false } },
    opts: { schemaVersion: "v3" as const, requestStartMs: Date.now() },
    start: Date.now(),
    graph: { ...validGraph, nodes: [...validGraph.nodes], edges: [...validGraph.edges] },
    rationales: [{ target: "g1", why: "test" }],
    draftCost: 0.01,
    draftAdapter: { name: "openai", model: "gpt-4o" },
    llmMeta: { model: "gpt-4o" },
    confidence: 0.85,
    clarifierStatus: "confident",
    effectiveBrief: "Test brief for compound goals",
    edgeFieldStash: {
      byEdgeId: { e1: { strength_mean: 0.7 } },
      byFromTo: { "o1::g1": { strength_mean: 0.7 } },
    },
    skipRepairDueToBudget: false,
    repairTimeoutMs: 10_000,
    draftDurationMs: 1000,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: undefined,
    hadCycles: false,
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    repairCost: 0,
    repairFallbackReason: undefined,
    clarifierResult: undefined,
    structuralMeta: undefined,
    validationSummary: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,
    finalResponse: undefined,
    collector: { add: vi.fn(), addByStage: vi.fn() },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    ...overrides,
  };
}

function setupDefaults(): void {
  vi.clearAllMocks();

  // PLoT validation passes
  (validateGraph as any).mockResolvedValue({ ok: true, normalized: { ...validGraph } });

  // Goal merge returns graph as-is
  (validateAndFixGraph as any).mockReturnValue({
    graph: { ...validGraph },
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  });

  // Connectivity passes
  (validateMinimumStructure as any).mockReturnValue({
    valid: true,
    missing: [],
    counts: { goal: 1, decision: 1, option: 1 },
    connectivity_failed: false,
  });

  // Goal inference returns safe default (no goal added)
  (ensureGoalNode as any).mockReturnValue({ goalAdded: false });

  // STRP returns graph as-is
  (reconcileStructuralTruth as any).mockReturnValue({
    graph: { ...validGraph },
    mutations: [],
  });

  // Edge restoration no-op
  (restoreEdgeFields as any).mockReturnValue({
    edges: [...validGraph.edges],
    restoredCount: 0,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Stage 4: Repair Orchestrator", () => {
  beforeEach(setupDefaults);

  it("calls all 10 substeps in order", async () => {
    const callOrder: string[] = [];

    (validateAndRepairGraph as any).mockResolvedValue({
      graph: { ...validGraph }, repairUsed: false, repairAttempts: 0, warnings: [],
    });
    (config as any).cee.orchestratorValidationEnabled = true;

    (validateGraph as any).mockImplementation(async () => {
      callOrder.push("2_plot");
      return { ok: true, normalized: { ...validGraph } };
    });

    (enforceStableEdgeIds as any).mockImplementation((g: any) => {
      callOrder.push("3_edge_stab");
      return g;
    });

    (validateAndFixGraph as any).mockImplementation(() => {
      callOrder.push("4_goal_merge");
      return { graph: { ...validGraph }, valid: true, fixes: { singleGoalApplied: false, outcomeBeliefsFilled: 0, decisionBranchesNormalized: false }, warnings: [] };
    });

    (extractCompoundGoals as any).mockImplementation(() => {
      callOrder.push("5_compound");
      return { constraints: [], isCompound: false };
    });

    (reconcileStructuralTruth as any).mockImplementation((g: any) => {
      callOrder.push("6_late_strp");
      return { graph: g, mutations: [] };
    });

    (restoreEdgeFields as any).mockImplementation((edges: any) => {
      callOrder.push("7_restore");
      return { edges, restoredCount: 0 };
    });

    (validateMinimumStructure as any).mockImplementation(() => {
      callOrder.push("8_connectivity");
      return { valid: true, missing: [], counts: { goal: 1, decision: 1, option: 1 }, connectivity_failed: false };
    });

    (DraftGraphOutput as any).parse.mockImplementation(() => {
      callOrder.push("10_structural");
    });

    // Mock orchestrator validation to track ordering
    (validateAndRepairGraph as any).mockImplementation(async () => {
      callOrder.push("1_orchestrator");
      return { graph: { ...validGraph }, repairUsed: false, repairAttempts: 0, warnings: [] };
    });

    const ctx = makeCtx();
    await runStageRepair(ctx);

    expect(callOrder[0]).toBe("1_orchestrator");
    expect(callOrder[1]).toBe("2_plot");
    expect(callOrder[2]).toBe("3_edge_stab");
    expect(callOrder[3]).toBe("4_goal_merge");
    expect(callOrder[4]).toBe("5_compound");
    expect(callOrder[5]).toBe("6_late_strp");
    expect(callOrder[6]).toBe("7_restore");
    expect(callOrder[7]).toBe("8_connectivity");
    // Note: substep 9 (clarifier) is no-op when config.cee.clarifierEnabled=false
    expect(callOrder[8]).toBe("10_structural");

    (config as any).cee.orchestratorValidationEnabled = false;
  });

  it("earlyReturn from substep 1b when llmRepairNeeded is false", async () => {
    (config as any).cee.orchestratorValidationEnabled = true;
    const error = new (GraphValidationError as any)("test", [{ code: "ERR", message: "fail" }], 1);
    (validateAndRepairGraph as any).mockRejectedValue(error);

    const ctx = makeCtx();
    // Force llmRepairNeeded=false so orchestrator validation produces a hard 422.
    // In production, this happens when the sweep resolves all Bucket C violations.
    ctx.llmRepairNeeded = false;
    await runOrchestratorValidation(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(422);

    (config as any).cee.orchestratorValidationEnabled = false;
  });

  it("substep 1b defers to PLoT when llmRepairNeeded is true", async () => {
    (config as any).cee.orchestratorValidationEnabled = true;
    const lastGraph = { nodes: [{ id: "g1", kind: "goal" }], edges: [] };
    const error = new (GraphValidationError as any)(
      "test", [{ code: "INVALID_EDGE_TYPE", message: "factor→goal" }], 2, lastGraph,
    );
    (validateAndRepairGraph as any).mockRejectedValue(error);

    const ctx = makeCtx();
    ctx.llmRepairNeeded = true;
    await runOrchestratorValidation(ctx);

    // Should NOT early-return — defers to PLoT repair (substep 2)
    expect(ctx.earlyReturn).toBeUndefined();
    // Should preserve the best graph from the orchestrator for PLoT
    expect(ctx.graph).toBe(lastGraph);

    (config as any).cee.orchestratorValidationEnabled = false;
  });

  it("substep 2 (PLoT) never sets earlyReturn — always falls back to simpleRepair", async () => {
    // PLoT validation uses try/catch fallback, never sets earlyReturn
    (validateGraph as any).mockResolvedValue({ ok: false, violations: ["err1"] });
    // Make LLM repair throw
    const mockRepairAdapter = { name: "openai", model: "gpt-4o", repairGraph: vi.fn().mockRejectedValue(new Error("fail")) };
    (getAdapter as any).mockReturnValue(mockRepairAdapter);
    // simpleRepair fallback validates
    (validateGraph as any).mockResolvedValueOnce({ ok: false, violations: ["err1"] }).mockResolvedValueOnce({ ok: true, normalized: { ...validGraph } });

    const ctx = makeCtx();
    await runPlotValidation(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(simpleRepair).toHaveBeenCalled();
  });

  it("returns early when ctx.graph is undefined", async () => {
    const ctx = makeCtx({ graph: undefined });
    await runStageRepair(ctx);

    expect(validateGraph).not.toHaveBeenCalled();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("substeps 3-7 and 9 never set earlyReturn (early-return rules)", async () => {
    // Run all substeps individually and verify no earlyReturn set
    const ctx = makeCtx();

    runEdgeStabilisation(ctx);
    expect(ctx.earlyReturn).toBeUndefined();

    runGoalMerge(ctx);
    expect(ctx.earlyReturn).toBeUndefined();

    runCompoundGoals(ctx);
    expect(ctx.earlyReturn).toBeUndefined();

    runLateStrp(ctx);
    expect(ctx.earlyReturn).toBeUndefined();

    runEdgeRestoration(ctx);
    expect(ctx.earlyReturn).toBeUndefined();

    await runClarifier(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
  });
});

// ── Substep 1: Orchestrator validation ──────────────────────────────────────

describe("Substep 1: Orchestrator validation", () => {
  beforeEach(setupDefaults);

  it("no-op when feature flag off", async () => {
    (config as any).cee.orchestratorValidationEnabled = false;
    const ctx = makeCtx();
    await runOrchestratorValidation(ctx);

    expect(validateAndRepairGraph).not.toHaveBeenCalled();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("calls validateAndRepairGraph when feature flag on", async () => {
    (config as any).cee.orchestratorValidationEnabled = true;
    (validateAndRepairGraph as any).mockResolvedValue({
      graph: { ...validGraph }, repairUsed: false, repairAttempts: 0, warnings: [],
    });

    const ctx = makeCtx();
    await runOrchestratorValidation(ctx);

    expect(validateAndRepairGraph).toHaveBeenCalledOnce();
    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.orchestratorRepairUsed).toBe(false);

    (config as any).cee.orchestratorValidationEnabled = false;
  });

  it("sets earlyReturn 422 on GraphValidationError", async () => {
    (config as any).cee.orchestratorValidationEnabled = true;
    const error = new (GraphValidationError as any)(
      "validation failed",
      [{ code: "ERR_01", message: "bad structure", path: "nodes[0]" }],
      2,
    );
    (validateAndRepairGraph as any).mockRejectedValue(error);

    const ctx = makeCtx();
    await runOrchestratorValidation(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(422);
    expect((ctx.earlyReturn.body as any).error.code).toBe("CEE_GRAPH_INVALID");

    (config as any).cee.orchestratorValidationEnabled = false;
  });

  it("422 trace has sweep diagnostics at top-level trace.details (not details.trace)", async () => {
    (config as any).cee.orchestratorValidationEnabled = true;
    const error = new (GraphValidationError as any)(
      "validation failed",
      [{ code: "NO_PATH_TO_GOAL", message: "no path", path: "nodes[opt_sq]" }],
      1,
    );
    (validateAndRepairGraph as any).mockRejectedValue(error);

    const ctx = makeCtx();
    ctx.repairTrace = {
      deterministic_sweep: { sweep_ran: true, sweep_version: "v3", bucket_summary: { a: 0, b: 0, c: 1 } },
    };
    await runOrchestratorValidation(ctx);

    const body = ctx.earlyReturn.body as any;
    // Sweep trace should be at top-level trace.details, not nested in details.trace
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBeDefined();
    expect(body.trace.details.deterministic_sweep_ran).toBe(true);
    expect(body.trace.details.deterministic_sweep_version).toBe("v3");
    expect(body.trace.details.last_phase).toBe("orchestrator_validation");
    // details should NOT contain a nested trace
    expect(body.details?.trace).toBeUndefined();

    (config as any).cee.orchestratorValidationEnabled = false;
  });
});

// ── Substep 2: PLoT validation ──────────────────────────────────────────────

describe("Substep 2: PLoT validation", () => {
  beforeEach(setupDefaults);

  it("preserves fields on validation pass", async () => {
    (validateGraph as any).mockResolvedValue({ ok: true, normalized: { ...validGraph } });
    const ctx = makeCtx();
    await runPlotValidation(ctx);

    expect(ctx.graph).toBeDefined();
    expect(ctx.repairFallbackReason).toBeUndefined();
  });

  it("sets repairFallbackReason='budget_exceeded' when skipRepairDueToBudget", async () => {
    (validateGraph as any)
      .mockResolvedValueOnce({ ok: false, violations: ["err1"] })
      .mockResolvedValueOnce({ ok: true, normalized: { ...validGraph } });

    const ctx = makeCtx({ skipRepairDueToBudget: true });
    await runPlotValidation(ctx);

    expect(ctx.repairFallbackReason).toBe("budget_exceeded");
    expect(simpleRepair).toHaveBeenCalled();
  });

  it("sets repairFallbackReason='revalidation_failed' when LLM repair succeeds but revalidation fails", async () => {
    const mockRepairAdapter = {
      name: "openai",
      model: "gpt-4o",
      repairGraph: vi.fn().mockResolvedValue({
        graph: { ...validGraph },
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
    (getAdapter as any).mockReturnValue(mockRepairAdapter);

    (validateGraph as any)
      .mockResolvedValueOnce({ ok: false, violations: ["err1"] })
      .mockResolvedValueOnce({ ok: false, violations: ["still_broken"] });

    const ctx = makeCtx();
    await runPlotValidation(ctx);

    expect(ctx.repairFallbackReason).toBe("revalidation_failed");
  });

  it("sets repairFallbackReason='llm_repair_error' when LLM repair throws", async () => {
    const mockRepairAdapter = {
      name: "openai",
      model: "gpt-4o",
      repairGraph: vi.fn().mockRejectedValue(new Error("LLM API failed")),
    };
    (getAdapter as any).mockReturnValue(mockRepairAdapter);

    (validateGraph as any)
      .mockResolvedValueOnce({ ok: false, violations: ["err1"] })
      .mockResolvedValueOnce({ ok: true, normalized: { ...validGraph } });

    const ctx = makeCtx();
    await runPlotValidation(ctx);

    expect(ctx.repairFallbackReason).toBe("llm_repair_error");
    expect(simpleRepair).toHaveBeenCalled();
  });

  it("sets repairFallbackReason='dag_transform_failed' when DAG stabilisation fails", async () => {
    const { stabiliseGraph } = await import("../../src/orchestrator/index.js");
    const { ensureDagAndPrune } = await import("../../src/orchestrator/index.js");

    const mockRepairAdapter = {
      name: "openai",
      model: "gpt-4o",
      repairGraph: vi.fn().mockResolvedValue({
        graph: { ...validGraph },
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
    (getAdapter as any).mockReturnValue(mockRepairAdapter);

    (validateGraph as any).mockResolvedValueOnce({ ok: false, violations: ["err1"] });
    // Make ensureDagAndPrune throw to trigger dag_transform_failed
    (ensureDagAndPrune as any).mockImplementationOnce(() => {
      throw new Error("Cycle detected in DAG");
    });
    // After fallback: simpleRepair → validateGraph succeeds
    (validateGraph as any).mockResolvedValueOnce({ ok: true, normalized: { ...validGraph } });

    const ctx = makeCtx();
    await runPlotValidation(ctx);

    expect(ctx.repairFallbackReason).toBe("dag_transform_failed");
    expect(simpleRepair).toHaveBeenCalled();
  });
});

// ── Substep 3: Edge stabilisation ───────────────────────────────────────────

describe("Substep 3: Edge stabilisation", () => {
  beforeEach(setupDefaults);

  it("calls enforceStableEdgeIds and updates ctx.graph", () => {
    const stableGraph = { ...validGraph, edges: [{ id: "o1::g1::0", from: "o1", to: "g1" }] };
    (enforceStableEdgeIds as any).mockReturnValue(stableGraph);

    const ctx = makeCtx();
    runEdgeStabilisation(ctx);

    expect(enforceStableEdgeIds).toHaveBeenCalledOnce();
    expect(ctx.graph).toBe(stableGraph);
  });
});

// ── Substep 4: Goal merge ───────────────────────────────────────────────────

describe("Substep 4: Goal merge", () => {
  beforeEach(setupDefaults);

  it("calls validateAndFixGraph exactly once", () => {
    const ctx = makeCtx();
    runGoalMerge(ctx);

    expect(validateAndFixGraph).toHaveBeenCalledOnce();
  });

  it("populates nodeRenames when goals are merged", () => {
    const renames = new Map([["g2", "g1"]]);
    (validateAndFixGraph as any).mockReturnValue({
      graph: { ...validGraph },
      valid: true,
      fixes: {
        singleGoalApplied: true,
        originalGoalCount: 2,
        mergedGoalIds: ["g1", "g2"],
        nodeRenames: renames,
        outcomeBeliefsFilled: 0,
        decisionBranchesNormalized: false,
      },
      warnings: [],
    });

    const ctx = makeCtx();
    runGoalMerge(ctx);

    expect(ctx.nodeRenames).toBe(renames);
    expect(ctx.nodeRenames.size).toBe(1);
  });

  it("does not populate nodeRenames when single goal present", () => {
    const ctx = makeCtx();
    runGoalMerge(ctx);

    // nodeRenames stays as the empty Map from makeCtx
    expect(ctx.nodeRenames.size).toBe(0);
  });
});

// ── Substep 5: Compound goals ───────────────────────────────────────────────

describe("Substep 5: Compound goals", () => {
  beforeEach(setupDefaults);

  it("no-op when no constraints found", () => {
    (extractCompoundGoals as any).mockReturnValue({ constraints: [], isCompound: false });
    const ctx = makeCtx();
    runCompoundGoals(ctx);

    expect(toGoalConstraints).not.toHaveBeenCalled();
    expect(ctx.goalConstraints).toBeUndefined();
  });

  it("emits goal_constraints without adding constraint nodes/edges to graph", () => {
    const constraints = [{ metric: "cost", operator: "<=", threshold: 1000, targetNodeId: "g1" }];
    (extractCompoundGoals as any).mockReturnValue({ constraints, isCompound: true });
    (remapConstraintTargets as any).mockReturnValue({
      constraints,
      remapped: 0,
      rejected_junk: 0,
      rejected_no_match: 0,
    });
    (toGoalConstraints as any).mockReturnValue([{ node_id: "c1" }]);

    const ctx = makeCtx();
    runCompoundGoals(ctx);

    // goal_constraints should be populated
    expect(ctx.goalConstraints).toEqual([{ node_id: "c1" }]);
    // Graph must NOT be mutated — constraints are metadata, not graph nodes
    expect((ctx.graph as any).nodes.length).toBe(validGraph.nodes.length);
    expect((ctx.graph as any).edges.length).toBe(validGraph.edges.length);
  });
});

// ── Substep 6: Late STRP ───────────────────────────────────────────────────

describe("Substep 6: Late STRP", () => {
  beforeEach(setupDefaults);

  it("calls reconcileStructuralTruth with fillControllableData: true", () => {
    const ctx = makeCtx({ goalConstraints: [{ node_id: "c1" }] });
    runLateStrp(ctx);

    expect(reconcileStructuralTruth).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fillControllableData: true }),
    );
    expect(ctx.constraintStrpResult).toBeDefined();
  });

  it("updates goalConstraints when STRP returns them", () => {
    const updatedConstraints = [{ node_id: "c1", normalized: true }];
    (reconcileStructuralTruth as any).mockReturnValue({
      graph: { ...validGraph },
      mutations: [],
      goalConstraints: updatedConstraints,
    });

    const ctx = makeCtx();
    runLateStrp(ctx);

    expect(ctx.goalConstraints).toBe(updatedConstraints);
  });
});

// ── Substep 7: Edge restoration ─────────────────────────────────────────────

describe("Substep 7: Edge restoration", () => {
  beforeEach(setupDefaults);

  it("restores V4 fields and writes to repairTrace (RISK-06)", () => {
    (restoreEdgeFields as any).mockReturnValue({
      edges: [{ id: "e1", from: "o1", to: "g1", strength_mean: 0.7 }],
      restoredCount: 1,
    });

    const ctx = makeCtx();
    runEdgeRestoration(ctx);

    expect(restoreEdgeFields).toHaveBeenCalledOnce();
    expect(ctx.repairTrace).toEqual({
      edge_restore: { restoredCount: 1 },
    });
  });

  it("writes restoredCount=0 to repairTrace when no restoration needed", () => {
    (restoreEdgeFields as any).mockReturnValue({
      edges: [...validGraph.edges],
      restoredCount: 0,
    });

    const ctx = makeCtx();
    runEdgeRestoration(ctx);

    expect(ctx.repairTrace).toEqual({
      edge_restore: { restoredCount: 0 },
    });
  });

  it("no-op when edgeFieldStash is undefined", () => {
    const ctx = makeCtx({ edgeFieldStash: undefined });
    runEdgeRestoration(ctx);

    expect(restoreEdgeFields).not.toHaveBeenCalled();
    expect(ctx.repairTrace).toBeUndefined();
  });

  it("passes nodeRenames to restoreEdgeFields for stash reversal", () => {
    const renames = new Map([["g2", "g1"]]);
    const ctx = makeCtx({ nodeRenames: renames });
    runEdgeRestoration(ctx);

    expect(restoreEdgeFields).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      renames,
    );
  });
});

// ── Substep 8: Connectivity ─────────────────────────────────────────────────

describe("Substep 8: Connectivity", () => {
  beforeEach(setupDefaults);

  it("ensures goal node when missing", () => {
    (validateMinimumStructure as any)
      .mockReturnValueOnce({ valid: false, missing: ["goal"], counts: { goal: 0, decision: 1, option: 1 }, connectivity_failed: false })
      .mockReturnValueOnce({ valid: true, missing: [], counts: { goal: 1, decision: 1, option: 1 }, connectivity_failed: false });

    (ensureGoalNode as any).mockReturnValue({
      graph: { ...validGraph },
      goalAdded: true,
      goalNodeId: "g1",
      inferredFrom: "brief",
    });

    const ctx = makeCtx();
    runConnectivity(ctx);

    expect(ensureGoalNode).toHaveBeenCalledOnce();
    expect(ctx.validationSummary.status).toBe("valid");
  });

  it("wires outcomes to goal when unreachable", () => {
    (validateMinimumStructure as any)
      .mockReturnValueOnce({
        valid: false, missing: [], counts: { goal: 1, decision: 1, option: 1 },
        connectivity_failed: true, connectivity: { reachable_goals: [] },
      })
      .mockReturnValueOnce({
        valid: true, missing: [], counts: { goal: 1, decision: 1, option: 1 },
        connectivity_failed: false,
      });
    (hasGoalNode as any).mockReturnValue(true);

    const wiredGraph = { ...validGraph, edges: [...validGraph.edges, { id: "new", from: "o1", to: "g1" }] };
    (wireOutcomesToGoal as any).mockReturnValue(wiredGraph);

    const ctx = makeCtx();
    runConnectivity(ctx);

    expect(ctx.validationSummary.status).toBe("valid");
  });

  it("sets validationSummary when structure invalid", () => {
    (validateMinimumStructure as any).mockReturnValue({
      valid: false,
      missing: ["decision"],
      counts: { goal: 1, option: 1 },
      connectivity_failed: false,
    });

    const ctx = makeCtx();
    runConnectivity(ctx);

    expect(ctx.validationSummary).toBeDefined();
    expect(ctx.validationSummary.status).toBe("invalid");
    expect(ctx.validationSummary.missing_kinds).toContain("decision");
  });

  it("fault injection only in non-production", () => {
    (isProduction as any).mockReturnValue(false);
    const ctx = makeCtx({
      request: { id: "req-1", headers: { "x-debug-force-missing-kinds": "goal" }, query: {}, raw: { destroyed: false } },
    });
    runConnectivity(ctx);

    // Graph should have goal nodes stripped
    const goalNodes = (ctx.graph as any).nodes.filter((n: any) => n.kind === "goal");
    expect(goalNodes.length).toBe(0);

    (isProduction as any).mockReturnValue(true);
  });
});

// ── Substep 9: Clarifier ────────────────────────────────────────────────────

describe("Substep 9: Clarifier", () => {
  beforeEach(setupDefaults);

  it("no-op when feature flag off", async () => {
    (config as any).cee.clarifierEnabled = false;
    const ctx = makeCtx();
    await runClarifier(ctx);

    expect(integrateClarifier).not.toHaveBeenCalled();
    expect(ctx.quality).toBeUndefined();
  });

  it("computes quality before calling clarifier", async () => {
    (config as any).cee.clarifierEnabled = true;
    (integrateClarifier as any).mockResolvedValue({});

    const ctx = makeCtx();
    await runClarifier(ctx);

    expect(computeQuality).toHaveBeenCalledOnce();
    expect(ctx.quality).toBeDefined();
    expect(integrateClarifier).toHaveBeenCalledOnce();

    (config as any).cee.clarifierEnabled = false;
  });

  it("updates graph on clarifier success with refinedGraph", async () => {
    (config as any).cee.clarifierEnabled = true;
    const refinedGraph = { ...validGraph, nodes: [...validGraph.nodes, { id: "new", kind: "factor", label: "New" }] };
    (integrateClarifier as any).mockResolvedValue({ refinedGraph });

    const ctx = makeCtx();
    await runClarifier(ctx);

    expect(ctx.clarifierResult).toBeDefined();
    expect(ctx.graph).toBeDefined();

    (config as any).cee.clarifierEnabled = false;
  });

  it("catches error and continues (non-fatal)", async () => {
    (config as any).cee.clarifierEnabled = true;
    (integrateClarifier as any).mockRejectedValue(new Error("clarifier boom"));

    const ctx = makeCtx();
    await runClarifier(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    // Quality was still computed before the error
    expect(ctx.quality).toBeDefined();

    (config as any).cee.clarifierEnabled = false;
  });
});

// ── Substep 10: Structural parse ────────────────────────────────────────────

describe("Substep 10: Structural parse", () => {
  beforeEach(setupDefaults);

  it("passes through on valid graph", () => {
    const ctx = makeCtx();
    runStructuralParse(ctx);

    expect(DraftGraphOutput.parse).toHaveBeenCalledOnce();
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("sets earlyReturn 400 on Zod parse failure", () => {
    (DraftGraphOutput.parse as any).mockImplementation(() => {
      throw { issues: [{ message: "bad field" }] };
    });

    const ctx = makeCtx();
    runStructuralParse(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(400);
    expect((ctx.earlyReturn.body as any).error.code).toBe("CEE_GRAPH_INVALID");
  });
});

// ── nodeRenames threading through validateAndFixGraph (real behavior) ────────

describe("Prereq 0a: nodeRenames in validateAndFixGraph", () => {
  it("real validateAndFixGraph returns nodeRenames only when multiple goals merged", async () => {
    const actual = await vi.importActual<typeof import("../../src/cee/structure/index.js")>("../../src/cee/structure/index.js");

    // Two goal nodes → merge triggers nodeRenames
    const multiGoalGraph = {
      version: "1.2",
      default_seed: 17,
      nodes: [
        { id: "g1", kind: "goal", label: "Goal A" },
        { id: "g2", kind: "goal", label: "Goal B" },
        { id: "o1", kind: "option", label: "Opt" },
      ],
      edges: [
        { id: "e1", from: "o1", to: "g1", strength_mean: 0.5 },
        { id: "e2", from: "o1", to: "g2", strength_mean: 0.6 },
      ],
    };

    const result = actual.validateAndFixGraph(multiGoalGraph as any, undefined, {
      enforceSingleGoal: true,
      checkSizeLimits: false,
    });

    expect(result.fixes.singleGoalApplied).toBe(true);
    expect(result.fixes.nodeRenames).toBeDefined();
    expect(result.fixes.nodeRenames!.size).toBeGreaterThan(0);
  });

  it("real validateAndFixGraph returns undefined nodeRenames when single goal", async () => {
    const actual = await vi.importActual<typeof import("../../src/cee/structure/index.js")>("../../src/cee/structure/index.js");

    const singleGoalGraph = {
      version: "1.2",
      default_seed: 17,
      nodes: [
        { id: "g1", kind: "goal", label: "Goal" },
        { id: "o1", kind: "option", label: "Opt" },
      ],
      edges: [
        { id: "e1", from: "o1", to: "g1", strength_mean: 0.5 },
      ],
    };

    const result = actual.validateAndFixGraph(singleGoalGraph as any, undefined, {
      enforceSingleGoal: true,
      checkSizeLimits: false,
    });

    expect(result.fixes.singleGoalApplied).toBe(false);
    expect(result.fixes.nodeRenames).toBeUndefined();
  });

  it("goal-merge substep threads nodeRenames to ctx when present", () => {
    setupDefaults();
    const renames = new Map([["g2", "g1"]]);
    (validateAndFixGraph as any).mockReturnValue({
      graph: { ...validGraph },
      valid: true,
      fixes: {
        singleGoalApplied: true,
        nodeRenames: renames,
        outcomeBeliefsFilled: 0,
        decisionBranchesNormalized: false,
      },
      warnings: [],
    });

    const ctx = makeCtx();
    runGoalMerge(ctx);

    expect(ctx.nodeRenames).toBe(renames);
    expect(ctx.nodeRenames.get("g2")).toBe("g1");
  });

  it("goal-merge substep leaves ctx.nodeRenames empty when no merge", () => {
    setupDefaults();
    const ctx = makeCtx();
    runGoalMerge(ctx);

    expect(ctx.nodeRenames.size).toBe(0);
  });
});

/**
 * Stage 4 (Repair) — field preservation contract test.
 *
 * Verifies: fields present at stage input are present at stage output
 * unless the contract explicitly declares the drop.
 *
 * Strategy:
 * - Well-connected graph so no edges are legitimately removed in the main test
 * - Separate focused test for the edge-removal path
 * - Deep-clone baseline before running stage to guard against in-place mutation masking
 * - Sentinel fields at all depths including nested objects (e.g., edge.provenance._sentinel_prov)
 * - Mocks configured to pass through graph fields (not replace them)
 *
 * Mocks: orchestrator validation OFF, PLoT validates OK, clarifier OFF.
 * Real: deterministic sweep, edge stabilisation, goal merge (single goal → no-op),
 *       compound goals (no compound → no-op), late STRP, edge restoration, connectivity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { STAGE_CONTRACT } from "../../src/cee/unified-pipeline/stages/repair/repair.contract.js";
import {
  assertSentinel,
  assertPreservationGuarantees,
  validateContractCompliance,
  type StageContract,
} from "./stage-contract-harness.js";

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
      debugLoggingEnabled: false,
    },
  },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {
    GuardViolation: "GuardViolation",
    CeeGraphGoalsMerged: "CeeGraphGoalsMerged",
    CeeGoalInferred: "CeeGoalInferred",
    CeeClarifierFailed: "CeeClarifierFailed",
  },
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, meta?: any) => ({
    error: { code, message: msg },
  }),
  integrateClarifier: vi.fn(),
  isAdminAuthorized: () => false,
}));

// PLoT validation → always passes
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

// Use real enforceStableEdgeIds — it mutates in place, should preserve fields
vi.mock("../../src/utils/graph-determinism.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

// Goal merge — pass through graph with all fields
vi.mock("../../src/cee/structure/index.js", () => ({
  validateAndFixGraph: vi.fn(),
  ensureGoalNode: vi.fn(),
  hasGoalNode: vi.fn().mockReturnValue(false),
  wireOutcomesToGoal: vi.fn().mockImplementation((g: any) => g),
  normaliseDecisionBranchBeliefs: vi.fn().mockImplementation((g: any) => g),
  detectZeroExternalFactors: vi.fn().mockReturnValue({ detected: false, factorCount: 0, externalCount: 0 }),
}));

vi.mock("../../src/cee/compound-goal/index.js", () => ({
  extractCompoundGoals: vi.fn().mockReturnValue({ constraints: [], isCompound: false }),
  toGoalConstraints: vi.fn().mockReturnValue([]),
  remapConstraintTargets: vi.fn().mockReturnValue({ constraints: [], remapped: 0, rejected_junk: 0, rejected_no_match: 0 }),
}));

// Use real reconcileStructuralTruth — it mutates in place, should preserve fields
vi.mock("../../src/validators/structural-reconciliation.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

// Use real restoreEdgeFields — it uses spread
vi.mock("../../src/cee/unified-pipeline/edge-identity.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

vi.mock("../../src/cee/transforms/structure-checks.js", () => ({
  validateMinimumStructure: vi.fn().mockReturnValue({
    valid: true,
    missing: [],
    counts: { goal: 1, decision: 1, option: 1, factor: 1 },
    connectivity_failed: false,
  }),
  MINIMUM_STRUCTURE_REQUIREMENT: { goal: 1, decision: 1, option: 1 },
}));

vi.mock("../../src/cee/transforms/graph-normalisation.js", () => ({
  normaliseCeeGraphVersionAndProvenance: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn().mockReturnValue({ overall: 7, structure: 7, coverage: 7, safety: 7, structural_proxy: 7 }),
}));

vi.mock("../../src/schemas/assist.js", () => ({
  DraftGraphOutput: {
    parse: vi.fn().mockImplementation((input: any) => input),
  },
}));

vi.mock("../../src/cee/constants/versions.js", () => ({
  DETERMINISTIC_SWEEP_VERSION: "test-v1",
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { validateGraph } from "../../src/services/validateClientWithCache.js";
import {
  validateAndFixGraph,
  ensureGoalNode,
  hasGoalNode,
} from "../../src/cee/structure/index.js";
import { validateMinimumStructure } from "../../src/cee/transforms/structure-checks.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a well-connected test graph with sentinel fields at every depth.
 * Topology: decision → option → factor → goal (single goal, well-connected)
 * This avoids triggering edge removal or complex repair paths.
 */
function buildSentinelGraph() {
  return {
    version: "1",
    default_seed: 17,
    _sentinel_top: "top_repair_marker",
    nodes: [
      {
        id: "goal_1",
        kind: "goal",
        label: "Achieve revenue growth",
        description: "Grow revenue by 20%",
        _sentinel_node: "goal_1_marker",
      },
      {
        id: "dec_1",
        kind: "decision",
        label: "Market expansion strategy",
        _sentinel_node: "dec_1_marker",
      },
      {
        id: "opt_1",
        kind: "option",
        label: "Expand to Europe",
        data: {
          interventions: { fac_cost: 80000 },
          _sentinel_option_data: "opt_1_data_marker",
        },
        _sentinel_node: "opt_1_marker",
      },
      {
        id: "fac_cost",
        kind: "factor",
        label: "Implementation Cost",
        category: "controllable",
        data: {
          value: 50000,
          baseline: 40000,
          unit: "USD",
          factor_type: "cost",
          _sentinel_data: "fac_cost_data_marker",
        },
        _sentinel_node: "fac_cost_marker",
      },
    ],
    edges: [
      {
        id: "e_dec_opt",
        from: "dec_1",
        to: "opt_1",
        strength_mean: 1.0,
        strength_std: 0.05,
        belief_exists: 1.0,
        effect_direction: "positive",
        _sentinel_edge: "e_dec_opt_marker",
      },
      {
        id: "e_opt_fac",
        from: "opt_1",
        to: "fac_cost",
        strength_mean: 0.8,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "brief_extraction", _sentinel_prov: "prov_opt_fac_marker" },
        _sentinel_edge: "e_opt_fac_marker",
      },
      {
        id: "e_fac_goal",
        from: "fac_cost",
        to: "goal_1",
        strength_mean: -0.6,
        strength_std: 0.15,
        belief_exists: 0.85,
        effect_direction: "negative",
        _sentinel_edge: "e_fac_goal_marker",
      },
      {
        id: "e_opt_goal",
        from: "opt_1",
        to: "goal_1",
        strength_mean: 0.7,
        strength_std: 0.12,
        belief_exists: 0.8,
        effect_direction: "positive",
        provenance: { source: "cee_hypothesis", _sentinel_prov: "prov_opt_goal_marker" },
        _sentinel_edge: "e_opt_goal_marker",
      },
    ],
    meta: {
      roots: ["dec_1"],
      leaves: ["goal_1"],
      suggested_positions: {},
      source: "assistant",
    },
  };
}

function makeCtx(graphOverride?: any): any {
  const graph = graphOverride ?? buildSentinelGraph();
  return {
    requestId: "contract-repair-test",
    input: { brief: "Should we expand to Europe?", flags: null, include_debug: false },
    rawBody: {},
    request: { id: "req-1", headers: {}, query: {}, raw: { destroyed: false } },
    opts: { schemaVersion: "v3" as const, requestStartMs: Date.now() },
    start: Date.now(),
    graph,
    rationales: [{ target: "goal_1", why: "test rationale" }],
    draftCost: 0.01,
    draftAdapter: { name: "openai", model: "gpt-4o" },
    llmMeta: { model: "gpt-4o" },
    confidence: 0.85,
    clarifierStatus: "confident",
    effectiveBrief: "Should we expand to Europe?",
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 20_000,
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
  };
}

/**
 * Build a graph with an external factor that has data.value, data.factor_type,
 * and data.uncertainty_drivers — fields that the graph-validator flags as
 * EXTERNAL_HAS_DATA and the deterministic sweep strips.
 *
 * The non-external nodes carry sentinel fields that must survive.
 */
function buildExternalDataGraph() {
  return {
    version: "1",
    default_seed: 17,
    _sentinel_top: "ext_top_marker",
    nodes: [
      {
        id: "goal_1",
        kind: "goal",
        label: "Grow revenue",
        description: "Increase annual revenue",
        _sentinel_node: "goal_1_ext_marker",
      },
      {
        id: "dec_1",
        kind: "decision",
        label: "Pricing strategy",
        _sentinel_node: "dec_1_ext_marker",
      },
      {
        id: "opt_1",
        kind: "option",
        label: "Premium pricing",
        data: {
          interventions: { fac_ctrl: 100 },
          _sentinel_option_data: "opt_1_ext_marker",
        },
        _sentinel_node: "opt_1_ext_marker",
      },
      {
        // Controllable factor — connected to option, should keep its data
        id: "fac_ctrl",
        kind: "factor",
        label: "Price level",
        category: "controllable",
        data: {
          value: 0.7,
          baseline: 0.5,
          factor_type: "cost",
          uncertainty_drivers: ["Market volatility"],
          _sentinel_data: "fac_ctrl_data_marker",
        },
        _sentinel_node: "fac_ctrl_ext_marker",
      },
      {
        // External factor WITH prohibited data fields — triggers EXTERNAL_HAS_DATA
        id: "fac_ext",
        kind: "factor",
        label: "Competitor pricing",
        category: "external",
        data: {
          value: 0.6,
          factor_type: "price",
          uncertainty_drivers: ["Market uncertainty"],
          _sentinel_data: "fac_ext_data_marker",
        },
        _sentinel_node: "fac_ext_ext_marker",
      },
      {
        id: "outcome_1",
        kind: "outcome",
        label: "Revenue impact",
        _sentinel_node: "outcome_1_ext_marker",
      },
    ],
    edges: [
      {
        id: "e_dec_opt",
        from: "dec_1",
        to: "opt_1",
        strength_mean: 1.0,
        strength_std: 0.01,
        belief_exists: 1.0,
        effect_direction: "positive",
        _sentinel_edge: "e_dec_opt_ext_marker",
      },
      {
        id: "e_opt_fac",
        from: "opt_1",
        to: "fac_ctrl",
        strength_mean: 0.8,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        _sentinel_edge: "e_opt_fac_ext_marker",
      },
      {
        id: "e_fac_out",
        from: "fac_ctrl",
        to: "outcome_1",
        strength_mean: 0.7,
        strength_std: 0.12,
        belief_exists: 0.8,
        effect_direction: "positive",
        _sentinel_edge: "e_fac_out_ext_marker",
      },
      {
        id: "e_ext_out",
        from: "fac_ext",
        to: "outcome_1",
        strength_mean: -0.4,
        strength_std: 0.15,
        belief_exists: 0.7,
        effect_direction: "negative",
        _sentinel_edge: "e_ext_out_ext_marker",
      },
      {
        id: "e_out_goal",
        from: "outcome_1",
        to: "goal_1",
        strength_mean: 0.8,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        _sentinel_edge: "e_out_goal_ext_marker",
      },
    ],
    meta: {
      roots: ["dec_1"],
      leaves: ["goal_1"],
      suggested_positions: {},
      source: "assistant",
    },
  };
}

function setupDefaults(): void {
  vi.clearAllMocks();

  // PLoT validation passes, returning graph as-is
  (validateGraph as any).mockImplementation(async (g: any) => ({
    ok: true,
    violations: [],
    normalized: undefined,
  }));

  // Goal merge returns graph with all fields preserved
  (validateAndFixGraph as any).mockImplementation((g: any) => ({
    graph: g,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Stage 4 (Repair) — field preservation contract", () => {
  beforeEach(setupDefaults);

  it("contract name matches stage", () => {
    expect(STAGE_CONTRACT.name).toBe("repair");
  });

  describe("full repair pass — sentinel field preservation", () => {
    it("preserves unknown top-level graph fields", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      assertSentinel(
        (ctx.graph as any)._sentinel_top,
        baseline._sentinel_top,
        "graph._sentinel_top",
      );
    });

    it("preserves unknown node-level fields on all nodes", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      for (const baselineNode of baseline.nodes) {
        // Nodes may be renamed (goal merge) — look up by label as fallback
        let outputNode = (ctx.graph as any).nodes.find(
          (n: any) => n.id === baselineNode.id,
        );
        if (!outputNode) {
          outputNode = (ctx.graph as any).nodes.find(
            (n: any) => n.label === baselineNode.label,
          );
        }
        if (!outputNode) {
          throw new Error(
            `UNEXPECTED REMOVAL at nodes[${baselineNode.id}]: node missing from output entirely`,
          );
        }
        assertSentinel(
          outputNode._sentinel_node,
          baselineNode._sentinel_node,
          `nodes[${baselineNode.id}]._sentinel_node`,
        );
      }
    });

    it("preserves unknown node.data fields", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      for (const baselineNode of baseline.nodes) {
        if (!baselineNode.data?._sentinel_data && !baselineNode.data?._sentinel_option_data) continue;
        const outputNode = (ctx.graph as any).nodes.find(
          (n: any) => n.id === baselineNode.id || n.label === baselineNode.label,
        );
        if (!outputNode) continue;

        if (baselineNode.data._sentinel_data) {
          assertSentinel(
            outputNode.data?._sentinel_data,
            baselineNode.data._sentinel_data,
            `nodes[${baselineNode.id}].data._sentinel_data`,
          );
        }
        if (baselineNode.data._sentinel_option_data) {
          assertSentinel(
            outputNode.data?._sentinel_option_data,
            baselineNode.data._sentinel_option_data,
            `nodes[${baselineNode.id}].data._sentinel_option_data`,
          );
        }
      }
    });

    it("preserves unknown edge-level fields on surviving edges", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      const outputEdges = (ctx.graph as any).edges;
      // With well-connected graph, no edges should be removed
      expect(outputEdges.length).toBeGreaterThanOrEqual(baseline.edges.length);

      for (const baselineEdge of baseline.edges) {
        // Edge IDs may be stabilised — match by from::to as fallback
        let outputEdge = outputEdges.find(
          (e: any) => e.id === baselineEdge.id,
        );
        if (!outputEdge) {
          outputEdge = outputEdges.find(
            (e: any) => e.from === baselineEdge.from && e.to === baselineEdge.to,
          );
        }
        if (!outputEdge) {
          // Edge removal is allowed per contract — skip
          if (STAGE_CONTRACT.allowedRemovals.edges) continue;
          throw new Error(
            `UNEXPECTED REMOVAL at edges[${baselineEdge.id}]: ` +
            `edge ${baselineEdge.from}→${baselineEdge.to} missing from output`,
          );
        }
        assertSentinel(
          outputEdge._sentinel_edge,
          baselineEdge._sentinel_edge,
          `edges[${baselineEdge.id}]._sentinel_edge`,
        );
      }
    });

    it("preserves nested sentinel in edge.provenance", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      const outputEdges = (ctx.graph as any).edges;
      for (const baselineEdge of baseline.edges) {
        if (!baselineEdge.provenance?._sentinel_prov) continue;
        let outputEdge = outputEdges.find(
          (e: any) => e.id === baselineEdge.id,
        );
        if (!outputEdge) {
          outputEdge = outputEdges.find(
            (e: any) => e.from === baselineEdge.from && e.to === baselineEdge.to,
          );
        }
        if (!outputEdge) continue; // edge removed, allowed per contract
        assertSentinel(
          outputEdge.provenance?._sentinel_prov,
          baselineEdge.provenance._sentinel_prov,
          `edges[${baselineEdge.id}].provenance._sentinel_prov`,
        );
      }
    });

    it("allowedModifications: edge fields may change value but must remain present", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      const outputEdges = (ctx.graph as any).edges;
      for (const baselineEdge of baseline.edges) {
        let outputEdge = outputEdges.find(
          (e: any) => e.id === baselineEdge.id,
        );
        if (!outputEdge) {
          outputEdge = outputEdges.find(
            (e: any) => e.from === baselineEdge.from && e.to === baselineEdge.to,
          );
        }
        if (!outputEdge) continue;

        for (const field of STAGE_CONTRACT.allowedModifications.edge) {
          if (baselineEdge[field] !== undefined) {
            if (outputEdge[field] === undefined) {
              throw new Error(
                `UNEXPECTED DROP at edges[${baselineEdge.id}].${field}: ` +
                `field is in allowedModifications (value change OK) but was removed`,
              );
            }
          }
        }
      }
    });
  });

  describe("edge removal path (separate graph with invalid refs)", () => {
    it("deterministic sweep may remove edges with invalid node refs", async () => {
      const graph = buildSentinelGraph();
      // Add an edge pointing to a non-existent node
      graph.edges.push({
        id: "e_invalid",
        from: "fac_cost",
        to: "nonexistent_node",
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.8,
        effect_direction: "positive",
        _sentinel_edge: "invalid_edge_marker",
      } as any);

      const ctx = makeCtx(graph);
      const baselineEdgeCount = ctx.graph.edges.length;
      await runStageRepair(ctx);

      // Contract allows edge removal
      expect(STAGE_CONTRACT.allowedRemovals.edges).toBe(true);
      // The invalid edge may have been removed (or kept — depends on sweep logic)
      // We just verify surviving edges still have their sentinels
      for (const edge of (ctx.graph as any).edges) {
        if (edge._sentinel_edge) {
          expect(typeof edge._sentinel_edge).toBe("string");
        }
      }
    });
  });

  describe("EXTERNAL_HAS_DATA path (external factor with prohibited data fields)", () => {
    it("strips prohibited data fields from external factor (contract-declared drop)", async () => {
      const graph = buildExternalDataGraph();
      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      const extFactor = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_ext");
      expect(extFactor).toBeDefined();

      // Fixture's external factor has data: { value, factor_type, uncertainty_drivers, _sentinel_data }
      // After stripping the 3 prohibited fields, no union-surviving key remains
      // (no interventions, operator, or value), so node.data is cleared entirely
      // per allowedDataClear.externalFactors (supersedes per-field allowedDrops).
      expect(extFactor.data).toBeUndefined();
    });

    it("preserves sentinel fields on non-external nodes through EXTERNAL_HAS_DATA path", async () => {
      const graph = buildExternalDataGraph();
      const baseline = structuredClone(graph);
      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      // Top-level sentinel
      assertSentinel(
        (ctx.graph as any)._sentinel_top,
        baseline._sentinel_top,
        "graph._sentinel_top",
      );

      // Non-external node sentinels must survive
      for (const baselineNode of baseline.nodes) {
        // node.data cleared under allowedDataClear.externalFactors — per-field drop checks skipped for this node
        if (baselineNode.id === "fac_ext") continue;
        const outputNode = (ctx.graph as any).nodes.find(
          (n: any) => n.id === baselineNode.id || n.label === baselineNode.label,
        );
        if (!outputNode) {
          throw new Error(
            `UNEXPECTED REMOVAL at nodes[${baselineNode.id}]: node missing from output`,
          );
        }
        assertSentinel(
          outputNode._sentinel_node,
          (baselineNode as any)._sentinel_node,
          `nodes[${baselineNode.id}]._sentinel_node`,
        );
      }

      // Controllable factor data sentinel must survive
      const ctrlFactor = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_ctrl");
      assertSentinel(
        ctrlFactor?.data?._sentinel_data,
        "fac_ctrl_data_marker",
        "nodes[fac_ctrl].data._sentinel_data",
      );
    });

    it("edge sentinels survive through EXTERNAL_HAS_DATA path", async () => {
      const graph = buildExternalDataGraph();
      const baseline = structuredClone(graph);
      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      const outputEdges = (ctx.graph as any).edges;
      for (const baselineEdge of baseline.edges) {
        let outputEdge = outputEdges.find((e: any) => e.id === baselineEdge.id);
        if (!outputEdge) {
          outputEdge = outputEdges.find(
            (e: any) => e.from === baselineEdge.from && e.to === baselineEdge.to,
          );
        }
        if (!outputEdge) {
          if (STAGE_CONTRACT.allowedRemovals.edges) continue;
          throw new Error(
            `UNEXPECTED REMOVAL at edges[${baselineEdge.id}]: ` +
            `edge ${baselineEdge.from}→${baselineEdge.to} missing from output`,
          );
        }
        assertSentinel(
          outputEdge._sentinel_edge,
          baselineEdge._sentinel_edge,
          `edges[${baselineEdge.id}]._sentinel_edge`,
        );
      }
    });
  });

  // ── Preservation guarantees (via shared harness) ──────────────────────────

  describe("preservationGuarantees (harness)", () => {
    it("all preservation-guaranteed fields survive unchanged", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      const violations = assertPreservationGuarantees(
        STAGE_CONTRACT as unknown as StageContract,
        baseline,
        ctx.graph,
      );
      expect(violations).toEqual([]);
    });

    it("version and default_seed are always preserved", async () => {
      const ctx = makeCtx();
      await runStageRepair(ctx);

      expect((ctx.graph as any).version).toBe("1");
      expect((ctx.graph as any).default_seed).toBe(17);
    });
  });

  // ── Full contract compliance via harness ──────────────────────────────────

  describe("full contract compliance (harness)", () => {
    it("representative fixture passes full contract validation", async () => {
      const ctx = makeCtx();
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      // External factors may have data cleared — identify them for skip
      const externalNodeIds = baseline.nodes
        .filter((n: any) => n.category === "external")
        .map((n: any) => n.id);

      const violations = validateContractCompliance(
        STAGE_CONTRACT as unknown as StageContract,
        baseline,
        ctx.graph,
        { skipDataForNodeIds: externalNodeIds },
      );
      expect(violations).toEqual([]);
    });

    it("EXTERNAL_HAS_DATA fixture passes full contract validation", async () => {
      const graph = buildExternalDataGraph();
      const baseline = structuredClone(graph);
      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      // External factor fac_ext has data cleared entirely — skip per-field data checks
      const violations = validateContractCompliance(
        STAGE_CONTRACT as unknown as StageContract,
        baseline,
        ctx.graph,
        { skipDataForNodeIds: ["fac_ext"] },
      );
      expect(violations).toEqual([]);
    });
  });

  // ── Mutation-occurs proof (prove stage ran) ───────────────────────────────

  describe("mutation-occurs proof", () => {
    it("deterministic sweep fixes NaN strength_mean (allowedModifications.edge)", async () => {
      const graph = buildSentinelGraph();
      // Inject NaN strength_mean — deterministic sweep should fix to 0.5
      const nanEdge = graph.edges.find((e: any) => e.id === "e_opt_fac");
      if (nanEdge) (nanEdge as any).strength_mean = NaN;

      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      const outputEdge = (ctx.graph as any).edges.find(
        (e: any) => e.from === "opt_1" && e.to === "fac_cost",
      );
      expect(outputEdge).toBeDefined();
      // NaN must have been replaced with a valid number
      expect(Number.isNaN(outputEdge.strength_mean)).toBe(false);
      expect(typeof outputEdge.strength_mean).toBe("number");
    });

    it("edge stabilisation assigns deterministic IDs (allowedModifications.edge includes id)", async () => {
      const ctx = makeCtx();
      const baselineIds = ctx.graph.edges.map((e: any) => e.id);
      await runStageRepair(ctx);

      // Edge IDs are stabilised to from::to::index format
      const outputIds = (ctx.graph as any).edges.map((e: any) => e.id);
      // At least one edge should have a deterministic from::to format
      const hasDeterministicId = outputIds.some(
        (id: string) => id.includes("::"),
      );
      expect(hasDeterministicId).toBe(true);
    });
  });

  // ── Drop path coverage ────────────────────────────────────────────────────

  describe("drop path coverage", () => {
    it("EXTERNAL_HAS_DATA strips value/factor_type/uncertainty_drivers from external factor", async () => {
      const graph = buildExternalDataGraph();
      const ctx = makeCtx(graph);
      await runStageRepair(ctx);

      const extFactor = (ctx.graph as any).nodes.find(
        (n: any) => n.id === "fac_ext",
      );
      expect(extFactor).toBeDefined();
      // After stripping prohibited fields and clearing data per allowedDataClear:
      // data.value, data.factor_type, data.uncertainty_drivers are all in allowedDrops.nodeData
      expect(extFactor.data).toBeUndefined();
    });
  });

  // ── Harness sanity (wrong contract → violations detected) ─────────────────

  describe("harness sanity", () => {
    it("detects violations when contract is too strict (no modifications allowed)", async () => {
      const graph = buildSentinelGraph();
      // Inject NaN to guarantee a mutation occurs
      const nanEdge = graph.edges.find((e: any) => e.id === "e_opt_fac");
      if (nanEdge) (nanEdge as any).strength_mean = NaN;

      const ctx = makeCtx(graph);
      const baseline = structuredClone(ctx.graph);
      await runStageRepair(ctx);

      // Use a deliberately wrong contract: no edge modifications allowed
      const wrongContract: StageContract = {
        name: "repair-wrong",
        allowedDrops: {
          topLevel: [],
          node: [],
          edge: [],
          option: [],
          nodeData: [],
        },
        allowedModifications: {
          topLevel: [],
          node: [],
          edge: [],      // id and strength_mean NOT declared → should catch deterministic sweep + stabilisation
          option: [],
          nodeData: [],
        },
        preservationGuarantees: {
          topLevel: [],
          node: [],
          edge: [],
          option: [],
          nodeData: [],
        },
        allowedRemovals: { nodes: false, edges: true },
      };

      const violations = validateContractCompliance(
        wrongContract,
        baseline,
        ctx.graph,
      );
      // Wrong contract should detect at least one violation
      // (edge IDs were stabilised + NaN was fixed → undeclared modifications)
      expect(violations.length).toBeGreaterThan(0);
      // Should have an edge modification violation (strength_mean or id)
      const edgeViolation = violations.find(
        (v) => v.path.includes("edges[") && v.type === "unexpected_modification",
      );
      expect(edgeViolation).toBeDefined();
    });
  });
});

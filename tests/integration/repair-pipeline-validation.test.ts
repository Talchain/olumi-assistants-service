/**
 * Brief 1: Production Pipeline Validation for Repaired gpt-4o Graphs
 *
 * Loads 4 failed gpt-4o v2 response JSONs from the evaluator results,
 * converts them to production edge format (flat strength_mean/strength_std),
 * runs through the real production Stage 4 repair pipeline, and asserts
 * structural validity post-repair.
 *
 * External services (PLoT, LLM adapter) are mocked; deterministic substeps
 * (sweep, connectivity, goal merge, etc.) run with real code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Mocks (must be before dynamic imports) ─────────────────────────────────

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
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      orchestratorValidationEnabled: false,
      enforceSingleGoal: true,
      clarifierEnabled: false,
    },
    features: { optionShortcutRepair: true },
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
    trace: meta?.requestId
      ? { request_id: meta.requestId, correlation_id: meta.requestId }
      : undefined,
    details: meta?.details,
  }),
  integrateClarifier: vi.fn(),
  isAdminAuthorized: () => false,
}));

vi.mock("../../src/services/validateClientWithCache.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, normalized: null, violations: [] }),
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

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { validateStructural } from "../../tools/graph-evaluator/src/validator.js";

// ── Helpers ────────────────────────────────────────────────────────────────

interface EvaluatorEdge {
  from: string;
  to: string;
  strength?: { mean: number; std: number };
  exists_probability?: number;
  effect_direction?: string;
  edge_type?: string;
  [key: string]: unknown;
}

interface EvaluatorNode {
  id: string;
  kind: string;
  label?: string;
  category?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Convert evaluator nested edge format { strength: { mean, std } }
 * to production flat format { strength_mean, strength_std }.
 */
function convertEdgeFormat(edge: EvaluatorEdge): Record<string, unknown> {
  const { strength, ...rest } = edge;
  return {
    ...rest,
    strength_mean: strength?.mean ?? 0.5,
    strength_std: strength?.std ?? 0.1,
    exists_probability: edge.exists_probability ?? 0.9,
    effect_direction: edge.effect_direction ?? "positive",
  };
}

function loadFailedGraph(briefId: string): {
  nodes: EvaluatorNode[];
  edges: EvaluatorEdge[];
  productionGraph: { nodes: EvaluatorNode[]; edges: Record<string, unknown>[] };
} {
  const responsePath = path.resolve(
    import.meta.dirname!,
    `../../tools/graph-evaluator/results/dg4-gpt4o-v2/gpt-4o/${briefId}/response.json`
  );
  const raw = JSON.parse(fs.readFileSync(responsePath, "utf-8"));
  const pg = raw.parsed_graph ?? raw;
  const nodes: EvaluatorNode[] = pg.nodes ?? [];
  const edges: EvaluatorEdge[] = pg.edges ?? [];
  return {
    nodes,
    edges,
    productionGraph: {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: edges.map(convertEdgeFormat),
    },
  };
}

function makeCtx(graph: any): StageContext {
  return {
    requestId: "test-repair-validation",
    input: { brief: "Test brief for repair pipeline validation" } as any,
    rawBody: {},
    request: { id: "req-1", headers: {}, query: {}, raw: { destroyed: false } } as any,
    opts: { schemaVersion: "v3" as const, requestStartMs: Date.now() } as any,
    start: Date.now(),

    graph,

    rationales: [{ target: "g1", why: "test rationale" }],
    draftCost: 0.01,
    draftAdapter: { name: "openai", model: "gpt-4o" },
    llmMeta: { model: "gpt-4o" },
    confidence: 0.85,
    clarifierStatus: "confident",
    effectiveBrief: "Test brief for repair pipeline validation",
    edgeFieldStash: undefined,
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

    collector: { add: vi.fn(), addByStage: vi.fn() } as any,
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
  } as unknown as StageContext;
}

// ── Test cases ─────────────────────────────────────────────────────────────

const FAILED_BRIEFS = [
  {
    briefId: "02-multi-option-constrained",
    preViolations: ["ORPHAN_NODE"],
    description: "disconnected observable factor",
    expectClean: true,
  },
  {
    briefId: "09-nested-subdecision",
    preViolations: ["CONTROLLABLE_NO_OPTION_EDGE", "ORPHAN_NODE"],
    description: "controllable missing option edge + disconnected observable",
    expectClean: true,
  },
  {
    briefId: "10-many-observables",
    preViolations: ["ORPHAN_NODE"],
    description: "5 disconnected observable factors",
    expectClean: true,
  },
  {
    briefId: "11-feedback-loop-trap",
    preViolations: ["FORBIDDEN_EDGE", "FORBIDDEN_EDGE"],
    description: "2 forbidden edges — Bucket C (outcome→outcome, outcome→risk), needs LLM repair",
    // Production deterministic sweep does NOT remove FORBIDDEN_EDGE (Bucket C).
    // These remain for the PLoT/LLM repair substep which is mocked in this test.
    expectClean: false,
    expectedRemainingViolations: ["FORBIDDEN_EDGE"],
  },
];

describe("Production Pipeline Validation — gpt-4o v2 failed graphs", () => {
  for (const brief of FAILED_BRIEFS) {
    describe(`${brief.briefId} (${brief.description})`, () => {
      let ctx: StageContext;
      let evaluatorNodes: EvaluatorNode[];
      let evaluatorEdges: EvaluatorEdge[];

      beforeEach(() => {
        vi.clearAllMocks();
        const loaded = loadFailedGraph(brief.briefId);
        evaluatorNodes = loaded.nodes;
        evaluatorEdges = loaded.edges;
        ctx = makeCtx(loaded.productionGraph);
      });

      it("loads graph with expected pre-repair violations", () => {
        // Validate using evaluator validator (nested format)
        const preResult = validateStructural({
          nodes: evaluatorNodes,
          edges: evaluatorEdges,
        } as any);
        expect(preResult.valid).toBe(false);
        for (const v of brief.preViolations) {
          expect(preResult.violations.some((viol: string) => viol.includes(v))).toBe(true);
        }
      });

      it("runs production repair pipeline without early return", async () => {
        await runStageRepair(ctx);
        expect(ctx.earlyReturn).toBeUndefined();
      });

      it("graph structural state matches expectations after repair", async () => {
        await runStageRepair(ctx);
        const graph = ctx.graph as any;
        expect(graph).toBeDefined();
        expect(graph.nodes.length).toBeGreaterThan(0);
        expect(graph.edges.length).toBeGreaterThan(0);

        // Convert back to evaluator format for structural validation
        const evalGraph = {
          nodes: graph.nodes,
          edges: graph.edges.map((e: any) => ({
            ...e,
            strength: { mean: e.strength_mean ?? 0.5, std: e.strength_std ?? 0.1 },
          })),
        };
        const postResult = validateStructural(evalGraph as any);

        if (brief.expectClean) {
          expect(postResult.valid).toBe(true);
          expect(postResult.violations).toHaveLength(0);
        } else {
          // Bucket C violations remain — they need LLM repair (mocked away)
          expect(postResult.valid).toBe(false);
          for (const v of brief.expectedRemainingViolations!) {
            expect(postResult.violations.some((viol: string) => viol.includes(v))).toBe(true);
          }
        }
      });

      it("repairTrace.deterministic_sweep is populated", async () => {
        await runStageRepair(ctx);
        const trace = ctx.repairTrace as any;
        expect(trace).toBeDefined();
        expect(trace.deterministic_sweep).toBeDefined();
        expect(trace.deterministic_sweep.sweep_ran).toBe(true);
      });

      it("preserves all required node kinds", async () => {
        await runStageRepair(ctx);
        const graph = ctx.graph as any;
        const kinds = new Set(graph.nodes.map((n: any) => n.kind));
        expect(kinds.has("goal")).toBe(true);
        expect(kinds.has("decision")).toBe(true);
        expect(kinds.has("option")).toBe(true);
      });

      it("all edges reference valid nodes", async () => {
        await runStageRepair(ctx);
        const graph = ctx.graph as any;
        const nodeIds = new Set(graph.nodes.map((n: any) => n.id));
        for (const edge of graph.edges) {
          expect(nodeIds.has(edge.from)).toBe(true);
          expect(nodeIds.has(edge.to)).toBe(true);
        }
      });

      it("interventions remain Record<string, number>", async () => {
        await runStageRepair(ctx);
        const graph = ctx.graph as any;
        const options = graph.nodes.filter((n: any) => n.kind === "option");
        for (const opt of options) {
          if (opt.data?.interventions) {
            expect(typeof opt.data.interventions).toBe("object");
            for (const [key, val] of Object.entries(opt.data.interventions as Record<string, unknown>)) {
              expect(typeof key).toBe("string");
              expect(typeof val).toBe("number");
            }
          }
        }
      });
    });
  }

  it("all 4 graphs survive repair without early return", async () => {
    let survivedCount = 0;
    for (const brief of FAILED_BRIEFS) {
      const loaded = loadFailedGraph(brief.briefId);
      const ctx = makeCtx(loaded.productionGraph);
      await runStageRepair(ctx);
      if (!ctx.earlyReturn && ctx.graph) {
        survivedCount++;
      }
    }
    // All 4 graphs pass through repair without earlyReturn (422).
    // Brief 11 still has Bucket C violations but the pipeline doesn't 422 on them
    // because orchestratorValidationEnabled=false and PLoT falls back to simpleRepair.
    expect(survivedCount).toBe(4);
  });

  it("3 of 4 graphs are structurally clean after deterministic repair", async () => {
    let cleanCount = 0;
    for (const brief of FAILED_BRIEFS) {
      const loaded = loadFailedGraph(brief.briefId);
      const ctx = makeCtx(loaded.productionGraph);
      await runStageRepair(ctx);
      const graph = ctx.graph as any;
      if (!graph) continue;
      const evalGraph = {
        nodes: graph.nodes,
        edges: graph.edges.map((e: any) => ({
          ...e,
          strength: { mean: e.strength_mean ?? 0.5, std: e.strength_std ?? 0.1 },
        })),
      };
      const result = validateStructural(evalGraph as any);
      if (result.valid) cleanCount++;
    }
    expect(cleanCount).toBe(3);
  });
});

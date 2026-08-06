/**
 * Regression — sweep pre-check must gate on effect_direction, not numerics only.
 *
 * The validator's strict canonical check (STRUCTURAL_EDGE_NOT_CANONICAL_ERROR,
 * graph-validator.ts) requires option→factor edges to have mean=1, std=0.01,
 * prob=1 AND effect_direction="positive". The sweep's "already canonical"
 * pre-check (fixStructuralEdgesNotCanonical, deterministic-sweep.ts) used to
 * test the NUMERICS only, so an option→factor edge with canonical numerics but
 * a MISSING (or negative) effect_direction was skipped entirely: the validator
 * error survived the sweep, post-enforcement re-validation failed closed, and
 * the request 422'd (CEE_GRAPH_INVALID) — the same bug class as the
 * canonicalStructuralEdge fix, one layer up.
 *
 * RED before the pre-check fix: the edge bypasses repair, keeps no
 * effect_direction, and re-validation still reports the violation.
 * GREEN after: the edge enters the repair path, gains
 * effect_direction="positive", and re-validation is clean.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    features: {
      optionShortcutRepair: true,
    },
  },
}));

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ── Harness (mirrors deterministic-sweep-mixed-fixture.test.ts) ─────────────

function makePipelineOutcome(): PipelineOutcome {
  return {
    graph_drafted: true,
    graph_structurally_valid: false,
    deterministic_sweep_violations: 0,
    verification_status: "skipped",
    validation_status: "skipped",
    enrichment_status: "skipped",
    coaching_status: "partial",
    warnings: [],
    rescue_score: 0,
    factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
    edge_strength_unique_count: 0,
    llm_repair: { triggered: false, outcome: "skipped", fallback_reason: null, attempts: 0 },
    repair_provenance: [],
  };
}

function makeMinimalStageContext(graph: GraphT): StageContext {
  return {
    input: { brief: "Canonical-direction regression brief" } as any,
    rawBody: {},
    request: {} as any,
    requestId: "test-canonical-direction",
    opts: { schemaVersion: "v3" },
    start: Date.now(),
    graph: graph as any,
    rationales: [],
    draftCost: 0,
    draftAdapter: null,
    llmMeta: null,
    confidence: undefined,
    effectiveBrief: "test",
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 30000,
    draftDurationMs: 0,
    strpResult: null,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: null,
    hadCycles: false,
    nodeRenames: new Map(),
    goalConstraints: null,
    constraintStrpResult: null,
    repairCost: 0,
    structuralMeta: null,
    validationSummary: null,
    quality: undefined,
    archetype: null,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: null,
    finalResponse: undefined,
    collector: { addCorrection: vi.fn(), all: () => [] },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    pipelineOutcome: makePipelineOutcome(),
  } as unknown as StageContext;
}

/**
 * Well-formed V4 topology (decision → option → factor → outcome → goal)
 * whose ONLY defect is the option→factor edge: canonical numerics
 * (mean=1, std=0.01, prob=1) with the given effect_direction.
 */
function buildGraph(optFacDirection: "positive" | "negative" | undefined): GraphT {
  const optFacEdge: Record<string, unknown> = {
    from: "opt_a",
    to: "fac_price",
    strength_mean: 1.0,
    strength_std: 0.01,
    belief_exists: 1.0,
  };
  if (optFacDirection !== undefined) {
    optFacEdge.effect_direction = optFacDirection;
  }
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Pricing decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "fac_price", kind: "factor", label: "Price level", category: "controllable", data: { value: 0.5, extractionType: "observed" } },
      { id: "out_rev", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Hit revenue target" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
      optFacEdge as any,
      { from: "fac_price", to: "out_rev", strength_mean: 0.5, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
      { from: "out_rev", to: "goal_1", strength_mean: 0.8, strength_std: 0.05, belief_exists: 1.0, effect_direction: "positive" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  } as GraphT;
}

function optFacEdgeOf(graph: GraphT): any {
  return (graph.edges as any[]).find((e) => e.from === "opt_a" && e.to === "fac_price");
}

function canonicalViolations(graph: GraphT) {
  const result = validateGraph({
    graph,
    requestId: "test-canonical-direction-revalidate",
    phase: "post_enforcement",
  });
  return result.errors.filter((e) => e.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sweep pre-check gates on effect_direction (canonical-numerics bypass)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("repairs an option→factor edge with canonical numerics but MISSING effect_direction", async () => {
    const graph = buildGraph(undefined);
    // Sanity: the defect is visible to the validator before the sweep.
    expect(canonicalViolations(graph).length).toBeGreaterThan(0);

    const ctx = makeMinimalStageContext(graph);
    await runDeterministicSweep(ctx);

    // The edge must have entered the repair path and gained the canonical direction…
    expect(optFacEdgeOf(graph).effect_direction).toBe("positive");
    const repairCodes = (ctx.deterministicRepairs ?? []).map((r) => r.code);
    expect(repairCodes).toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
    // …so the validator error no longer survives to fail packaging closed.
    expect(canonicalViolations(graph)).toEqual([]);
  });

  it("repairs an option→factor edge with canonical numerics but NEGATIVE effect_direction", async () => {
    const graph = buildGraph("negative");
    expect(canonicalViolations(graph).length).toBeGreaterThan(0);

    const ctx = makeMinimalStageContext(graph);
    await runDeterministicSweep(ctx);

    expect(optFacEdgeOf(graph).effect_direction).toBe("positive");
    expect(canonicalViolations(graph)).toEqual([]);
  });

  it("leaves a fully canonical option→factor edge untouched (no repair recorded)", async () => {
    const graph = buildGraph("positive");
    expect(canonicalViolations(graph)).toEqual([]);

    const ctx = makeMinimalStageContext(graph);
    await runDeterministicSweep(ctx);

    expect(optFacEdgeOf(graph).effect_direction).toBe("positive");
    const canonRepairs = (ctx.deterministicRepairs ?? []).filter(
      (r) => r.code === "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR" && r.path.includes("opt_a"),
    );
    expect(canonRepairs).toEqual([]);
  });
});

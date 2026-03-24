/**
 * Mixed-Fixture Regression Test — Deterministic Sweep
 *
 * A single graph containing ALL of these violations simultaneously:
 * 1. A cycle (factor A → factor B → factor A)
 * 2. A fuzzy intervention ref ("fac_churn" when node is "fac_churn_rate")
 * 3. A forbidden edge (outcome→outcome)
 * 4. A missing controllable baseline (factor with no data.value)
 * 5. A structural edge with exists_probability: 0.33
 *
 * Runs through the full deterministic sweep. Asserts all violations are repaired.
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
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";
import type { GraphT } from "../../src/schemas/graph.js";

// ============================================================================
// Helpers
// ============================================================================

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
    input: { brief: "Test brief for regression" } as any,
    rawBody: {},
    request: {} as any,
    requestId: "test-mixed-fixture",
    opts: { schemaVersion: "v3" },
    start: Date.now(),
    graph: graph as any,
    rationales: [],
    draftCost: 0,
    draftAdapter: null,
    llmMeta: null,
    confidence: undefined,
    clarifierStatus: undefined,
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
    repairFallbackReason: undefined,
    clarifierResult: null,
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
 * Build a graph with ALL five violation types:
 *
 * 1. Cycle: fac_retention → fac_satisfaction → fac_retention
 * 2. Fuzzy intervention ref: option has intervention key "fac_churn" but node is "fac_churn_rate"
 * 3. Forbidden edge: out_revenue → out_growth (outcome→outcome)
 * 4. Missing controllable baseline: fac_price has no data.value
 * 5. Structural edge: dec_pricing → opt_raise has exists_probability: 0.33
 */
function buildMixedViolationGraph(): GraphT {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_pricing", kind: "decision", label: "Pricing Decision" },
      { id: "opt_keep", kind: "option", label: "Keep Current Price", data: { interventions: { fac_price: 0.5 } } },
      { id: "opt_raise", kind: "option", label: "Raise Price", data: {
        interventions: {
          fac_price: 0.8,
          // VIOLATION 2: fuzzy ref — "fac_churn" should be "fac_churn_rate"
          fac_churn: 0.3,
        },
      }},
      // VIOLATION 4: controllable factor with no data.value
      { id: "fac_price", kind: "factor", label: "Price Level", category: "controllable", data: { extractionType: "inferred", factor_type: "price" } },
      { id: "fac_churn_rate", kind: "factor", label: "Churn Rate", category: "observable", data: { value: 0.15, extractionType: "observed" } },
      // VIOLATION 1: cycle participants
      { id: "fac_retention", kind: "factor", label: "Customer Retention", category: "observable", data: { value: 0.7, extractionType: "observed" } },
      { id: "fac_satisfaction", kind: "factor", label: "Customer Satisfaction", category: "observable", data: { value: 0.6, extractionType: "observed" } },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "out_growth", kind: "outcome", label: "Growth" },
      { id: "goal_mrr", kind: "goal", label: "Achieve MRR Target" },
    ],
    edges: [
      // VIOLATION 5: structural decision→option edge with exists_probability: 0.33
      { from: "dec_pricing", to: "opt_keep", strength_mean: 1.0, strength_std: 0.01, belief_exists: 0.33, effect_direction: "positive" },
      { from: "dec_pricing", to: "opt_raise", strength_mean: 1.0, strength_std: 0.01, belief_exists: 0.33, effect_direction: "positive" },
      // Standard structural edges
      { from: "opt_keep", to: "fac_price", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
      { from: "opt_raise", to: "fac_price", strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0, effect_direction: "positive" },
      // Causal edges
      { from: "fac_price", to: "fac_churn_rate", strength_mean: 0.4, strength_std: 0.15, belief_exists: 0.8, effect_direction: "positive" },
      { from: "fac_churn_rate", to: "out_revenue", strength_mean: -0.6, strength_std: 0.1, belief_exists: 0.9, effect_direction: "negative" },
      { from: "out_revenue", to: "goal_mrr", strength_mean: 0.8, strength_std: 0.05, belief_exists: 1.0, effect_direction: "positive" },
      // VIOLATION 1: cycle — retention ↔ satisfaction
      { from: "fac_retention", to: "fac_satisfaction", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.7, effect_direction: "positive" },
      { from: "fac_satisfaction", to: "fac_retention", strength_mean: 0.3, strength_std: 0.1, belief_exists: 0.4, effect_direction: "positive" },
      // Connect cycle participants to goal path
      { from: "fac_retention", to: "out_revenue", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
      // VIOLATION 3: forbidden outcome→outcome edge
      { from: "out_revenue", to: "out_growth", strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
      { from: "out_growth", to: "goal_mrr", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.8, effect_direction: "positive" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Mixed-fixture deterministic sweep regression", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("resolves all five violation types in a single sweep", async () => {
    const graph = buildMixedViolationGraph();
    const ctx = makeMinimalStageContext(graph);

    await runDeterministicSweep(ctx);

    const repairs = ctx.deterministicRepairs ?? [];
    const repairCodes = repairs.map((r) => r.code);

    // 1. Cycle broken — graph is now a DAG
    expect(repairCodes).toContain("CYCLE_DETECTED");
    // Verify no cycle remains: simple DFS check
    const adj = new Map<string, string[]>();
    for (const n of graph.nodes) adj.set(n.id, []);
    for (const e of graph.edges) {
      const list = adj.get(e.from);
      if (list) list.push(e.to);
    }
    const visited = new Set<string>();
    const inStack = new Set<string>();
    let hasCycle = false;
    function dfs(nodeId: string) {
      if (inStack.has(nodeId)) { hasCycle = true; return; }
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      inStack.add(nodeId);
      for (const next of adj.get(nodeId) ?? []) dfs(next);
      inStack.delete(nodeId);
    }
    for (const n of graph.nodes) dfs(n.id);
    expect(hasCycle).toBe(false);

    // 2. Fuzzy intervention ref remapped: "fac_churn" → "fac_churn_rate"
    expect(repairCodes).toContain("INVALID_INTERVENTION_REF");
    const optRaise = graph.nodes.find((n) => n.id === "opt_raise") as any;
    expect(optRaise.data.interventions).toHaveProperty("fac_churn_rate");
    expect(optRaise.data.interventions).not.toHaveProperty("fac_churn");

    // 3. Forbidden outcome→outcome edge removed
    expect(repairCodes).toContain("FORBIDDEN_EDGE_AUTO_FIXED");
    const hasOutcomeToOutcome = graph.edges.some(
      (e) => {
        const fromKind = graph.nodes.find((n) => n.id === e.from)?.kind;
        const toKind = graph.nodes.find((n) => n.id === e.to)?.kind;
        return fromKind === "outcome" && toKind === "outcome";
      },
    );
    expect(hasOutcomeToOutcome).toBe(false);

    // 4. Missing controllable baseline defaulted to 0.5
    expect(repairCodes).toContain("CONTROLLABLE_MISSING_DATA");
    const facPrice = graph.nodes.find((n) => n.id === "fac_price") as any;
    expect(facPrice.data.value).toBe(0.5);

    // 5. Structural decision→option edges corrected to existence=1.0
    expect(repairCodes).toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
    const decOptionEdges = graph.edges.filter((e) => e.from === "dec_pricing");
    for (const edge of decOptionEdges) {
      expect(edge.belief_exists).toBe(1);
      expect(edge.strength_mean).toBe(1);
      expect(edge.strength_std).toBe(0.01);
    }

    // Repair trace should have rescue_score > 0
    const sweepTrace = (ctx.repairTrace as any)?.deterministic_sweep;
    expect(sweepTrace).toBeDefined();
    expect(sweepTrace.rescue_score).toBeGreaterThan(0);
    expect(sweepTrace.repairs_count).toBeGreaterThan(0);
  });

  it("populates deterministicRepairs and repairTrace on context", async () => {
    const graph = buildMixedViolationGraph();
    const ctx = makeMinimalStageContext(graph);

    await runDeterministicSweep(ctx);

    // deterministicRepairs populated with all repair entries
    expect(ctx.deterministicRepairs).toBeDefined();
    expect(ctx.deterministicRepairs!.length).toBeGreaterThan(0);

    // repairTrace populated with sweep summary data
    expect(ctx.repairTrace).toBeDefined();
    const trace = (ctx.repairTrace as any)?.deterministic_sweep;
    expect(trace).toBeDefined();
    expect(trace.sweep_version).toBeDefined();
    expect(trace.sweep_ran).toBe(true);
  });
});

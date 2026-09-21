/**
 * ROADMAP 2.1099 — R2: re-canonicalise structural edges at the gate.
 *
 * THE MECHANISM, SETTLED BY EXECUTION (13 Aug 2026), not by ranking candidates:
 *
 *   `STRUCTURAL_EDGE_NOT_CANONICAL_ERROR` is emitted by `validateSemantic`,
 *   which RETURNS EARLY when the graph has no goal node
 *   (`graph-validator.ts:816` — `if (goals.length === 0) return issues;`).
 *   `fixStructuralEdgesNotCanonical` repairs `option→factor` edges ONLY when a
 *   pre-sweep violation cites them (`decision→option` alone is proactive).
 *
 *   So when the drafter omits the goal: pre-sweep emits zero citations → the
 *   sweep canonicalises nothing → `ensureGoalNode` mints the goal at substep 8 →
 *   the gate validates a graph that now HAS a goal and reports one error per
 *   option→factor edge. The code the system classifies "Bucket A — always
 *   auto-fix" is the code that kills the draft.
 *
 * The discriminating measurement is the pair below: goal ABSENT ⇒ the codes
 * survive to the gate at pristine; goal PRESENT ⇒ they do not. A single
 * direction would not have named the mechanism.
 */
import { describe, it, expect } from "vitest";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { canonicaliseStructuralEdgesAtGate } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { CANONICAL_EDGE } from "../../src/validators/graph-validator.types.js";
import { createEdgeFieldStash } from "../../src/cee/unified-pipeline/edge-identity.js";

const BRIEF = "Our goal is to improve net revenue retention. We could raise prices or invest in customer success.";

function buildGraph(opts: { includeGoal: boolean; legacyEdges?: boolean }): any {
  const { includeGoal, legacyEdges = false } = opts;
  const nodes: any[] = [
    { id: "dec_main", kind: "decision", label: "How to improve NRR" },
    { id: "opt_raise", kind: "option", label: "Raise prices" },
    { id: "opt_cs", kind: "option", label: "Invest in customer success" },
    { id: "fac_arpu", kind: "factor", category: "controllable", label: "ARPU", data: { value: 400, unit: "other" } },
    { id: "fac_churn", kind: "factor", category: "controllable", label: "Churn", data: { value: 0.12, unit: "other" } },
  ];
  if (includeGoal) nodes.push({ id: "goal_nrr", kind: "goal", label: "Improve NRR" });

  const structural = legacyEdges
    ? [
        // LEGACY shape: weight/belief, NO strength_std anywhere.
        { id: "e_r_a", from: "opt_raise", to: "fac_arpu", weight: 0.8, belief: 0.9, effect_direction: "positive" },
        { id: "e_c_c", from: "opt_cs", to: "fac_churn", weight: 0.6, belief: 0.85, effect_direction: "positive" },
      ]
    : [
        { id: "e_r_a", from: "opt_raise", to: "fac_arpu", strength_mean: 0.8, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" },
        { id: "e_c_c", from: "opt_cs", to: "fac_churn", strength_mean: 0.6, strength_std: 0.2, belief_exists: 0.85, effect_direction: "positive" },
      ];

  const decisionEdges = legacyEdges
    ? [
        { id: "e_d_r", from: "dec_main", to: "opt_raise", weight: 1, belief: 1, effect_direction: "positive" },
        { id: "e_d_c", from: "dec_main", to: "opt_cs", weight: 1, belief: 1, effect_direction: "positive" },
      ]
    : [
        { id: "e_d_r", from: "dec_main", to: "opt_raise", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
        { id: "e_d_c", from: "dec_main", to: "opt_cs", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      ];

  return { version: "v1", nodes, edges: [...decisionEdges, ...structural] };
}

function makeCtx(graph: any): any {
  return {
    input: { brief: BRIEF, context: {} },
    rawBody: {},
    request: { headers: {} },
    requestId: "test-r2",
    opts: {},
    start: Date.now(),
    graph,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: {},
    confidence: undefined,
    effectiveBrief: BRIEF,
    edgeFieldStash: createEdgeFieldStash(graph.edges),
    skipRepairDueToBudget: false,
    repairTimeoutMs: 30_000,
    draftDurationMs: 0,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: undefined,
    hadCycles: false,
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    structuralMeta: {},
    validationSummary: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: {},
    finalResponse: undefined,
    collector: { addByStage: () => {}, add: () => {}, getCorrections: () => [], getSummary: () => ({}) },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    pipelineOutcome: {},
  };
}

function gateCodes(graph: any): string[] {
  return validateGraph({ graph, requestId: "test", phase: "post_enforcement" as any }).errors.map((e) => e.code);
}

describe("ROADMAP 2.1099 — R2: structural edges re-canonicalised at the gate", () => {
  describe("the mechanism, as a discriminating pair", () => {
    it("goal ABSENT: the pre-sweep validation emits NO structural citation (validateSemantic returns early)", () => {
      const graph = buildGraph({ includeGoal: false });
      const preSweep = validateGraph({ graph, requestId: "t", phase: "pre_sweep_diagnostic" as any });
      // The edges ARE non-canonical — the citation is missing, not the defect.
      expect(preSweep.errors.map((e) => e.code)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      expect(preSweep.errors.map((e) => e.code)).toContain("MISSING_GOAL");
    });

    it("goal PRESENT: the same edges ARE cited — so the suppression is the goal's absence, nothing else", () => {
      const graph = buildGraph({ includeGoal: true });
      const preSweep = validateGraph({ graph, requestId: "t", phase: "pre_sweep_diagnostic" as any });
      expect(preSweep.errors.map((e) => e.code)).toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
    });
  });

  describe("the guard the old spec could not provide — asserted at the GATE, through runStageRepair", () => {
    it("a goal-less draft reaches the gate with ZERO structural errors", async () => {
      const ctx = makeCtx(buildGraph({ includeGoal: false }));
      await runStageRepair(ctx);

      expect(gateCodes(ctx.graph)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      expect(ctx.earlyReturn).toBeUndefined();
    });

    it("a draft that already has a goal also reaches the gate clean", async () => {
      const ctx = makeCtx(buildGraph({ includeGoal: true }));
      await runStageRepair(ctx);

      expect(gateCodes(ctx.graph)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      expect(ctx.earlyReturn).toBeUndefined();
    });
  });

  describe("the repair itself", () => {
    it("writes exactly the tuple the VALIDATOR reads, derived from CANONICAL_EDGE", () => {
      const graph = buildGraph({ includeGoal: true });
      const result = canonicaliseStructuralEdgesAtGate(graph as any);

      expect(result.canonicalisedCount).toBe(2);
      for (const e of graph.edges.filter((x: any) => x.from.startsWith("opt_"))) {
        expect(e.strength_mean).toBe(CANONICAL_EDGE.mean);
        expect(e.strength_std).toBe(CANONICAL_EDGE.std);
        expect(e.belief_exists).toBe(CANONICAL_EDGE.prob);
        expect(e.effect_direction).toBe(CANONICAL_EDGE.direction);
      }
    });

    it("is idempotent — a second pass canonicalises nothing", () => {
      const graph = buildGraph({ includeGoal: true });
      canonicaliseStructuralEdgesAtGate(graph as any);
      const snapshot = JSON.parse(JSON.stringify(graph));

      const second = canonicaliseStructuralEdgesAtGate(graph as any);

      expect(second.canonicalisedCount).toBe(0);
      expect(second.repairs).toEqual([]);
      expect(graph).toEqual(snapshot);
    });

    it("LEGACY: writes strength_std, which a format-aware repair provably cannot", () => {
      // `patchEdgeNumeric` under LEGACY writes weight/belief and skips std
      // ("LEGACY has no std equivalent"), while the validator reads
      // `edge.strength_std` with NO fallback and demands exactly 0.01. A repair
      // that only patches the format-native fields can therefore NEVER satisfy
      // this gate — the latent limb of the same defect already fixed once for
      // `effect_direction` (edge-format.ts). This pins the other limb.
      const graph = buildGraph({ includeGoal: true, legacyEdges: true });
      expect(gateCodes(graph)).toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR"); // precondition, in-test

      canonicaliseStructuralEdgesAtGate(graph as any);

      expect(gateCodes(graph)).not.toContain("STRUCTURAL_EDGE_NOT_CANONICAL_ERROR");
      for (const e of graph.edges.filter((x: any) => x.from.startsWith("opt_"))) {
        expect(e.strength_std).toBe(CANONICAL_EDGE.std);
        // the LEGACY mirrors are kept in step, not left holding a stale number
        expect(e.weight).toBe(CANONICAL_EDGE.mean);
        expect(e.belief).toBe(CANONICAL_EDGE.prob);
      }
    });

    it("leaves non-structural edges alone", () => {
      const graph = buildGraph({ includeGoal: true });
      graph.nodes.push({ id: "out_x", kind: "outcome", label: "X" });
      graph.edges.push({
        id: "e_causal", from: "fac_arpu", to: "out_x",
        strength_mean: 0.42, strength_std: 0.17, belief_exists: 0.83, effect_direction: "positive",
      });

      canonicaliseStructuralEdgesAtGate(graph as any);

      const causal = graph.edges.find((e: any) => e.id === "e_causal");
      expect(causal.strength_mean).toBe(0.42);
      expect(causal.strength_std).toBe(0.17);
      expect(causal.belief_exists).toBe(0.83);
    });

    it("no-ops on an already-canonical graph", () => {
      const graph = buildGraph({ includeGoal: true });
      for (const e of graph.edges) {
        if (!e.from.startsWith("opt_")) continue;
        e.strength_mean = 1; e.strength_std = 0.01; e.belief_exists = 1; e.effect_direction = "positive";
      }
      const snapshot = JSON.parse(JSON.stringify(graph));

      const result = canonicaliseStructuralEdgesAtGate(graph as any);

      expect(result.canonicalisedCount).toBe(0);
      expect(graph).toEqual(snapshot);
    });
  });
});

/**
 * OPTION_NO_OP MUST NOT COST THE USER THE DRAFT.
 *
 * ── THE MEASURED BREAK ────────────────────────────────────────────────────
 * 11 Sep 2026, on the day the PoC was shared with collaborators.
 *
 *   POST https://cee-staging.onrender.com/proxy/v5/turn -> HTTP 500 in 65.6s
 *   { "validator": "draft_graph_pipeline",
 *     "reason": "draft_graph_cee_graph_invalid",
 *     "validation_error_codes": ["OPTION_NO_OP"],
 *     "last_phase": "deterministic_enforcement",
 *     "auto_retry": { "attempted": true, "attempts": 2 } }
 *
 * A user submits a brief and NO GRAPH APPEARS. Measured at 3 failures in 10
 * attempts on the same brief. `OPTION_NO_OP` (#1446, merged 03:43Z) is a true
 * finding and is KEPT — the predicate is not touched by the fix these tests
 * pin. Only its CONSEQUENCE changes.
 *
 * ── WHY THE REAL VALIDATOR, NOT A MOCK ───────────────────────────────────
 * The sibling enforcement suite mocks `graph-validator.js` to a no-op. That is
 * right for testing the budget/bridge repairs and WRONG here: a mocked
 * validator would let this file pass while #1446's predicate stopped firing,
 * i.e. it would agree with itself (trap 16 — a fixture you wrote yourself is
 * not evidence about the producer). The validator runs for real, and
 * `it("the fixture DOES trigger #1446's predicate")` pins the precondition so
 * a GREEN here is provably the gate's doing and not the fixture failing to
 * reproduce the defect.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {
    CeeInboundSumRescaled: "cee.draft_graph.inbound_sum_rescaled",
    CeeBridgeChainRepaired: "cee.draft_graph.bridge_chain_repaired",
    CeeEnforcementCompleted: "cee.draft_graph.enforcement_completed",
    CeeEnforcementEdgeSkipped: "cee.draft_graph.enforcement_edge_skipped",
    CeeEnforcementPostValidationErrors: "cee.draft_graph.enforcement_post_validation_errors",
    CeeEnforcementPostValidationWarnings: "cee.draft_graph.enforcement_post_validation_warnings",
    CeeEnforcementPostValidationFailed: "cee.draft_graph.enforcement_post_validation_failed",
    CeeEnforcementBlocked: "cee.draft_graph.enforcement_blocked",
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { deterministicEnforcementEnabled: true }, features: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn((code: string, msg: string, meta?: any) => ({
    code,
    message: msg,
    details: meta?.details ?? {},
  })),
  isAdminAuthorized: vi.fn(() => false),
}));

import { applyDeterministicEnforcement } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { DRAFT_NON_FATAL_CODES } from "../../src/cee/unified-pipeline/stages/repair/draft-non-fatal-codes.js";

/** The factor baseline in the measured session, on the model's 0-1 scale. */
const BASELINE = 0.49;

/**
 * The measured graph, reduced to what the gate and the predicate read.
 * `opt_noop` is labelled with the user's own question sentence verbatim and
 * sets the only factor it touches to the level that factor already has.
 * Every other tier is satisfied, so anything that fires here is THIS defect.
 */
function paulsGraph(): any {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Which option?" },
      {
        id: "opt_noop",
        kind: "option",
        label: "increase the Pro plan price from £49 to £59 per month with the next Pro feature release",
        data: { interventions: { fac_price: BASELINE } },
      },
      { id: "opt_59", kind: "option", label: "Raise Price to £59 at Feature Launch", data: { interventions: { fac_price: 0.59 } } },
      { id: "opt_54", kind: "option", label: "Raise Price to £54 (Soft Increase)", data: { interventions: { fac_price: 0.54 } } },
      {
        id: "fac_price",
        kind: "factor",
        label: "Pro Plan Monthly Price",
        category: "controllable",
        observed_state: { value: BASELINE, raw_value: 49 },
        // A controllable factor needs value + extractionType + factor_type +
        // uncertainty_drivers or `CONTROLLABLE_MISSING_DATA` blocks the gate
        // for a reason unrelated to this defect. In the pipeline the sweep's
        // Bucket B fills these BEFORE enforcement runs; this unit test calls
        // enforcement directly, so the fixture must already satisfy them —
        // otherwise the assertions below would be measuring the wrong error.
        data: {
          value: BASELINE,
          raw_value: 49,
          extractionType: "explicit",
          factor_type: "continuous",
          uncertainty_drivers: ["price elasticity"],
        },
      },
      { id: "outcome_1", kind: "outcome", label: "MRR" },
      { id: "goal_1", kind: "goal", label: "£20k MRR" },
    ],
    edges: [
      { from: "decision_1", to: "opt_noop", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "decision_1", to: "opt_59", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "decision_1", to: "opt_54", strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "opt_noop", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_59", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_54", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.8, strength_std: 0.05, belief_exists: 0.9, effect_direction: "positive" },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function makeCtx(graph: any): any {
  return {
    requestId: "req-option-no-op-p0",
    graph,
    detectedEdgeFormat: "V1_FLAT",
    riskCoefficientCorrections: [],
    nodeRenames: new Map(),
    pipelineOutcome: { warnings: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OPTION_NO_OP is reported, never fatal to the draft", () => {
  // ── PRECONDITION, PINNED IN-TEST (trap 13b) ─────────────────────────────
  // Without this, every assertion below would also pass on a fixture that
  // stopped reproducing the defect — a guard agreeing with itself.
  it("the fixture DOES trigger #1446's predicate, on the measured option, and only it", () => {
    const result = validateGraph({ graph: paulsGraph() as any });
    const noOps = result.errors.filter((e) => e.code === "OPTION_NO_OP");
    expect(noOps).toHaveLength(1);
    expect((noOps[0].context as { optionId?: string }).optionId).toBe("opt_noop");
  });

  // ── THE P0 ──────────────────────────────────────────────────────────────
  // RED at pristine: the gate sets a 422 earlyReturn, the pipeline skips
  // packaging, route-v2 wraps it as the measured HTTP 500, and the user sees
  // no graph.
  it("does NOT withhold the draft — no earlyReturn, the graph survives", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.graph.nodes.map((n: any) => n.id)).toContain("opt_noop");
  });

  it("does not count the no-op as a blocking error in the repair trace", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx);
    expect(ctx.repairTrace.deterministic_enforcement.blocked).toBe(false);
    expect(ctx.repairTrace.deterministic_enforcement.post_validation_error_count).toBe(0);
  });

  // ── CARRIED, NOT SWALLOWED ──────────────────────────────────────────────
  it("carries the finding on the pipeline's soft-degrade channel, naming the option", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx);
    const carried = ctx.pipelineOutcome.warnings.filter((w: any) =>
      typeof w.error === "string" && w.error.includes("OPTION_NO_OP"),
    );
    expect(carried).toHaveLength(1);
    expect(carried[0].degraded).toBe(true);
    expect(carried[0].error).toContain("opt_noop");
  });

  // ── THE DISCRIMINATING TWIN ─────────────────────────────────────────────
  // Proves the change SUBTRACTS ONE NAMED CODE and did not disable the gate.
  // Without this pair, "no earlyReturn" above is equally consistent with the
  // fail-closed gate having been removed outright.
  it("STILL blocks a genuinely invalid graph — one option with no path to the goal", () => {
    const graph = paulsGraph();
    // Sever the only causal route to the goal. opt_noop's no-op finding is
    // unchanged; what is added is a real topology defect.
    graph.edges = graph.edges.filter((e: any) => !(e.from === "outcome_1" && e.to === "goal_1"));
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(422);
    expect(ctx.repairTrace.deterministic_enforcement.blocked).toBe(true);
  });

  // ⭐ THE TWO GUARDS ARE NOT REDUNDANT AND NEITHER SUPERSEDES THE OTHER
  // (trap 12d). The DERIVED one below proves the gate AGREES with the set;
  // it is structurally blind to the set being wrong, because widening the set
  // widens its own expectation too. Only the HAND-WRITTEN one notices that.
  //
  // Measured, not reasoned about: with only the derived guard present, a
  // mutant that added `NO_PATH_TO_GOAL` to the set left all six tests GREEN —
  // i.e. the whole fail-closed gate could be hollowed out one code at a time
  // with nothing going red. The pair below was written in response.
  it("the non-fatal set contains EXACTLY the one code this P0 is about", () => {
    expect([...DRAFT_NON_FATAL_CODES].sort()).toEqual(["OPTION_NO_OP"]);
  });

  it("subtracts the set and NOTHING ELSE — derived from the validator, not restated", () => {
    const graph = paulsGraph();
    graph.edges = graph.edges.filter((e: any) => !(e.from === "outcome_1" && e.to === "goal_1"));
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);

    const reported = new Set<string>(
      validateGraph({ graph: ctx.graph, phase: "post_enforcement" as any }).errors.map((e) => e.code),
    );
    const blocked = new Set<string>(ctx.earlyReturn.body.details.validation_error_codes);

    // Precondition pinned in-test: the exception is genuinely exercised here,
    // so a pass is the subtraction's doing and not an absent finding.
    expect(reported.has("OPTION_NO_OP")).toBe(true);
    expect(blocked.has("OPTION_NO_OP")).toBe(false);

    const expected = [...reported].filter((c) => !DRAFT_NON_FATAL_CODES.has(c)).sort();
    expect([...blocked].sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("when it blocks, the wire codes name the BLOCKING defect and never OPTION_NO_OP", () => {
    const graph = paulsGraph();
    graph.edges = graph.edges.filter((e: any) => !(e.from === "outcome_1" && e.to === "goal_1"));
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx);
    const codes: string[] = ctx.earlyReturn.body.details.validation_error_codes;
    expect(codes.length).toBeGreaterThan(0);
    expect(codes).not.toContain("OPTION_NO_OP");
    expect(ctx.earlyReturn.body.details.validation_errors.every((e: any) => e.code !== "OPTION_NO_OP")).toBe(true);
  });
});
